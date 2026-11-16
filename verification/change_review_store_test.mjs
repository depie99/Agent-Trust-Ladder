import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fixture } from "./fixtures/task-changes/project.mjs";
import { captureChangeReview, listChangeReviews, readChangeReview, unavailableReview } from "../runtime/lib/change-review-store.mjs";
import { snapshot, recordHandoff } from "../runtime/lib/handoffs.mjs";
import { describeChanges, fileDiff, digest } from "../runtime/lib/task-changes.mjs";

const f = fixture();
try {
  f.edit();
  const stateBefore = fs.readFileSync(path.join(f.root, ".trust/manager/state.json"), "utf8");
  const a = captureChangeReview(f.root, f.task), again = captureChangeReview(f.root, f.task);
  assert.equal(a.id, again.id); assert.equal(a.captured_at, again.captured_at, "unchanged captures are idempotent");
  f.write("runtime/example.js", "newer source\n");
  const b = captureChangeReview(f.root, f.task);
  assert.notEqual(a.id, b.id);
  assert.equal(listChangeReviews(f.root, f.task).length, 2);
  assert.equal(readChangeReview(f.root, f.task, a.id).output.revision, a.output.revision);
  assert.match(fileDiff(f.root, a, digest("runtime/example.js")).patch, /after/);
  assert.doesNotMatch(fileDiff(f.root, a, digest("runtime/example.js")).patch, /newer/);
  assert.throws(() => readChangeReview(f.root, { ...f.task, id: "T-002" }, a.id), /unavailable/);
  assert.throws(() => readChangeReview(f.root, f.task, "../outside"), /Invalid/);
  assert.equal(unavailableReview({ id: "T-002" }).availability, "baseline_missing");
  assert.throws(() => captureChangeReview(f.root, { ...f.task, handoff_baseline: null }), /baseline/);
  assert.equal(fs.readFileSync(path.join(f.root, ".trust/manager/state.json"), "utf8"), stateBefore, "capture does not mutate task state or evidence");
  let n = 0;
  assert.throws(() => captureChangeReview(f.root, f.task, { takeSnapshot: () => n++ ? a.baseline : a.output }), /Source changed/);
  assert.equal(listChangeReviews(f.root, f.task).length, 2, "inconsistent capture publishes no record");
  const directory = path.join(f.root, ".trust/manager/change-reviews", f.task.id);
  fs.writeFileSync(path.join(directory, "interrupted.tmp"), "partial data");
  assert.equal(listChangeReviews(f.root, f.task).length, 2, "incomplete writes are ignored");
  fs.writeFileSync(path.join(directory, `${a.id}.json`), JSON.stringify(b));
  assert.throws(() => readChangeReview(f.root, f.task, a.id), /identifier does not match/);
  fs.writeFileSync(path.join(directory, `${a.id}.json`), JSON.stringify(a));
  const bigFile = path.join(f.workspace, "over-budget.bin");
  const handle = fs.openSync(bigFile, "w"); fs.ftruncateSync(handle, 33 * 1024 * 1024); fs.closeSync(handle);
  assert.throws(() => captureChangeReview(f.root, f.task), /source budget/);
  fs.unlinkSync(bigFile);
  f.task.status = "done";
  const output = snapshot(f.root, f.workspace);
  f.task.evidence = [{ kind: "check", check: "behavior", result: "pass", coverage: "complete", code_revision: output.revision, packet_revision: 1 }];
  recordHandoff(f.root, f.task);
  fs.renameSync(f.workspace, `${f.workspace}-archived`);
  const completed = readChangeReview(f.root, f.task);
  assert.equal(completed.output.revision, output.revision);
  assert.match(fileDiff(f.root, completed, digest("runtime/example.js")).patch, /newer source/, "archived workspace is not needed for stored review");
  const target = path.join(f.root, "outside"); fs.mkdirSync(target);
  const link = path.join(directory, "junction"); fs.symlinkSync(target, link, "junction");
  assert.throws(() => readChangeReview(f.root, { ...f.task, id: "T-001/junction" }), /Invalid/);
  const { safePath } = await import("../runtime/lib/task-changes.mjs");
  assert.throws(() => safePath(directory, "junction/file.json"), /Symlinked/);
  fs.writeFileSync(path.join(directory, `${a.id}.json`), "broken");
  assert.throws(() => readChangeReview(f.root, f.task, a.id), /cannot be read/);
} finally { f.cleanup(); }

// Regression 2026-11-16: git-tracked symlinks (mode 120000). With Windows
// core.symlinks=false they check out as plain files holding their link
// target, so both the stored baseline and fresh captures carry 120000. They
// used to fail every capture with "Invalid snapshot entry" (S2H workspaces).
const g = fixture();
try {
  const linkName = ".claude/skills/ask-matt";
  fs.mkdirSync(path.join(g.workspace, ".claude/skills"), { recursive: true });
  fs.writeFileSync(path.join(g.workspace, linkName), "../../../skills/ask-matt");
  const blob = execFileSync("git", ["hash-object", linkName], { cwd: g.workspace, encoding: "utf8", windowsHide: true }).trim();
  execFileSync("git", ["update-index", "--add", "--cacheinfo", `120000,${blob},${linkName}`], { cwd: g.workspace, windowsHide: true });
  g.write("target-notes.md", "real file\n");
  execFileSync("git", ["add", "target-notes.md"], { cwd: g.workspace, windowsHide: true });
  const baseline = snapshot(g.root, g.workspace);
  assert.equal(baseline.modes[linkName], "120000", "git's symlink mode is recorded as captured");
  g.task.handoff_baseline = baseline; g.persist();
  const first = captureChangeReview(g.root, g.task);
  assert.ok(first.output.files[linkName], "tracked symlink survives capture");
  g.write("target-notes.md", "changed file\n");
  const second = captureChangeReview(g.root, g.task);
  const described = describeChanges(g.task, second, { root: g.root });
  const notes = described.files.find((file) => file.path === "target-notes.md");
  assert.equal(notes.additions, 1); assert.equal(notes.deletions, 1);
  assert.equal(described.additions, 1); assert.equal(described.deletions, 1);
  assert.equal(described.stats_complete, true);
  const diff = fileDiff(g.root, second, digest("target-notes.md"));
  assert.match(diff.patch, /changed file/);
} finally { g.cleanup(); }
console.log("PASS: change review store — stable captures, history, crash isolation, archive and containment");
