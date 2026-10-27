import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { emptyState, saveState } from "../../../runtime/lib/state.mjs";
import { snapshot } from "../../../runtime/lib/handoffs.mjs";

export function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-change-review-"));
  const workspace = path.join(root, "workspace"); fs.mkdirSync(workspace);
  execFileSync("git", ["init", "--quiet"], { cwd: workspace, windowsHide: true });
  const write = (name, text) => { const file = path.join(workspace, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  write("inherited.txt", "pre-existing dirty source\n");
  write("runtime/example.js", "const message = 'before';\n");
  write("deleted.txt", "deleted baseline evidence\n");
  const baseline = snapshot(root, workspace);
  const task = { id: "T-001", title: "Review fixture", status: "blocked", objective: "Inspect the captured change", workspace, packet_revision: 1, completion_checks: ["behavior"], evidence: [], handoff_baseline: baseline, blocker: { reason: "Needs review" }, input_revisions: { "T-000": "predecessor-revision" } };
  const persist = () => { const state = emptyState(); state.tasks[task.id] = task; saveState(root, state); };
  const edit = () => {
    write("runtime/example.js", "const message = 'after';\n");
    write("docs/فارسی.txt", "سلام\n");
    write("binary.bin", Buffer.from([0, 1, 2]));
    write(".env", "ordinary test value\n");
    fs.unlinkSync(path.join(workspace, "deleted.txt"));
  };
  persist();
  return { root, workspace, task, write, persist, edit, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
