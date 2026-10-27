// Content-addressed handoffs include dirty and untracked source, without committing
// or changing the user's branch. Records are published only after their blobs.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const store = (root) => path.join(root, ".trust", "manager", "handoffs");
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}
function safeFile(dir, name) {
  const target = path.resolve(dir, name);
  if (!name || path.isAbsolute(name) || !target.startsWith(path.resolve(dir) + path.sep)) throw new Error(`unsafe handoff path: ${name}`);
  // Do not follow a workspace symlink outside its sandbox.
  let cursor = target;
  while (cursor !== path.resolve(dir)) {
    if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`symlink in handoff path: ${name}`);
    cursor = path.dirname(cursor);
  }
  return target;
}
function fileHash(file) { return fs.existsSync(file) ? hash(fs.readFileSync(file)) : null; }
export function snapshot(root, workspace) {
  let names;
  const trackedModes = {};
  try {
    const entries = execFileSync("git", ["ls-files", "--stage", "-z"], { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0");
    for (const entry of entries) { const match = entry.match(/^(\d+) [a-f0-9]+ \d\t([\s\S]+)$/); if (match) trackedModes[match[2]] = match[1]; }
  } catch { /* scratch workspace */ }
  try { names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0"); }
  catch {
    const walk = (dir, prefix = "") => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if ([".git", "node_modules", ".atl-inputs", ".atl-evidence"].includes(entry.name) || (prefix === ".trust/" && entry.name === "manager")) return [];
      const name = prefix + entry.name;
      return entry.isDirectory() ? walk(path.join(dir, entry.name), name + "/") : [name];
    });
    names = walk(workspace);
  }
  const files = {}; const modes = {};
  for (const name of [...new Set(names)].sort()) {
    if (!name || /^(?:\.trust\/manager\/|node_modules\/|\.atl-inputs\/|\.atl-evidence\/|\.atl-(?:workspace|dependencies)\.json$)/.test(name)) continue;
    const file = safeFile(workspace, name);
    if (trackedModes[name] === "160000") throw new Error(`owner capability required: submodule handoff is unavailable for ${name}`);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) continue;
    const bytes = fs.readFileSync(file); const digest = hash(bytes);
    const blob = path.join(store(root), "blobs", digest);
    fs.mkdirSync(path.dirname(blob), { recursive: true });
    if (fileHash(blob) !== digest) {
      const temporary = `${blob}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, blob);
    }
    files[name] = digest;
    modes[name] = process.platform === "win32" ? trackedModes[name] || "100644" : fs.statSync(file).mode & 0o111 ? "100755" : "100644";
  }
  return { revision: hash(JSON.stringify({ files, modes })), files, modes };
}
export function startBaseline(root, task) {
  if (!task.handoff_baseline) task.handoff_baseline = snapshot(root, task.workspace);
  return task.handoff_baseline;
}
export function recordHandoff(root, task) {
  if (task.status !== "done" || !task.handoff_baseline) throw new Error(`${task.id}: completed task and baseline required`);
  const revision = task.packet_revision || 1;
  const output = snapshot(root, task.workspace);
  const evidence = (task.evidence || []).filter((e) => (e.packet_revision || 1) === revision && !e.invalidated);
  for (const check of task.completion_checks || []) {
    if (!evidence.some((e) => e.kind === "check" && e.check === check && e.result === "pass" && e.coverage === "complete" && e.code_revision === output.revision)) throw new Error(`${task.id}: missing complete evidence for output revision: ${check}`);
  }
  const baseline = task.handoff_baseline;
  const changed_files = [...new Set([...Object.keys(baseline.files), ...Object.keys(output.files)])].filter((name) => baseline.files[name] !== output.files[name] || baseline.modes?.[name] !== output.modes[name]);
  const record = { version: 1, task: task.id, packet_revision: revision, baseline, output, changed_files, evidence, input_revisions: task.input_revisions || {}, created_at: new Date().toISOString() };
  atomic(path.join(store(root), `${task.id}.json`), record);
  task.handoff = { version: 1, revision: output.revision, record_hash: hash(JSON.stringify(record)), changed_files };
  task.revalidation_requested = null;
  return record;
}
export function readHandoff(root, task) {
  const record = JSON.parse(fs.readFileSync(path.join(store(root), `${task.id}.json`), "utf8"));
  if (record.version !== 1 || record.task !== task.id || record.packet_revision !== (task.packet_revision || 1)) throw new Error(`${task.id}: stale handoff contract`);
  if (task.handoff?.record_hash && hash(JSON.stringify(record)) !== task.handoff.record_hash) throw new Error(`${task.id}: corrupt handoff record`);
  if (hash(JSON.stringify({ files: record.output.files, modes: record.output.modes })) !== record.output.revision) throw new Error(`${task.id}: corrupt handoff manifest`);
  if (hash(JSON.stringify({ files: record.baseline.files, modes: record.baseline.modes })) !== record.baseline.revision) throw new Error(`${task.id}: corrupt baseline manifest`);
  const changed = [...new Set([...Object.keys(record.baseline.files), ...Object.keys(record.output.files)])].filter((name) => record.baseline.files[name] !== record.output.files[name] || record.baseline.modes?.[name] !== record.output.modes[name]);
  if (JSON.stringify(changed) !== JSON.stringify(record.changed_files)) throw new Error(`${task.id}: corrupt changed-file manifest`);
  for (const check of task.completion_checks || []) if (!record.evidence.some((e) => e.kind === "check" && e.check === check && e.result === "pass" && e.coverage === "complete" && e.code_revision === record.output.revision && !e.invalidated)) throw new Error(`${task.id}: unverified handoff check: ${check}`);
  for (const digest of Object.values(record.output.files)) {
    if (!/^[a-f0-9]{64}$/.test(digest) || fileHash(path.join(store(root), "blobs", digest)) !== digest) throw new Error(`${task.id}: corrupt handoff blob`);
  }
  return record;
}
export function inspectHandoffChain(root, task, tasks, { includeFiles = false } = {}) {
  const items = []; const seen = new Set(); const visiting = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`handoff prerequisite cycle: ${id}`);
    if (seen.has(id)) return;
    visiting.add(id);
    const predecessor = tasks[id];
    if (predecessor) for (const parent of predecessor.plan_depends_on || []) visit(parent);
    visiting.delete(id); seen.add(id);
    if (!predecessor) { items.push({ id, status: "missing", reason: `Unknown prerequisite ${id}` }); return; }
    const item = { id, title: predecessor.title, status: predecessor.status, workspace: predecessor.workspace || null, workspaceAvailable: Boolean(predecessor.workspace && fs.existsSync(predecessor.workspace)), checks: predecessor.completion_checks || [], evidenceCount: (predecessor.evidence || []).length, baselineAvailable: Boolean(predecessor.handoff_baseline), handoff: "unavailable", files: [] };
    if (includeFiles && item.workspaceAvailable) {
      try { item.files = execFileSync("git", ["status", "--short", "--untracked-files=normal"], { cwd: predecessor.workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 }).split(/\r?\n/).filter(Boolean).slice(0, 200); } catch { item.filesUnavailable = true; }
    }
    if (predecessor.status !== "done") item.reason = `Waiting for prerequisite ${id} to complete.`;
    else {
      try { const record = readHandoff(root, predecessor); item.handoff = "verified"; item.outputRevision = record.output.revision; }
      catch (error) { item.handoff = predecessor.handoff_baseline ? "invalid" : "legacy"; item.reason = item.handoff === "legacy" ? `${id} needs a trustworthy baseline and revision-bound evidence; revalidation is required.` : `${id} handoff cannot be verified: ${error.message}`; }
    }
    items.push(item);
  };
  for (const id of task.plan_depends_on || []) visit(id);
  return { taskId: task.id, ready: items.every((item) => item.handoff === "verified"), items, actions: ["Preserve existing workspaces and acceptance checks.", "Review each unavailable handoff in dependency order; recover only evidence-backed baselines or revalidate the output.", "Obtain approval before reopening tasks or starting provider work.", "Verify each handoff and rerun dispatch preflight before resuming."] };
}
export function prepareInputs(root, task, tasks) {
  const inputs = {}; const operations = new Map(); const conflicts = [];
  const ordered = []; const visited = new Set();
  const collect = (id, visiting = new Set()) => {
    if (visiting.has(id)) throw new Error(`handoff prerequisite cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of tasks[id]?.plan_depends_on || []) collect(parent, visiting);
    visiting.delete(id); visited.add(id); ordered.push(id);
  };
  for (const id of task.plan_depends_on || []) collect(id);
  for (const id of ordered) {
    const predecessor = tasks[id];
    if (predecessor?.status !== "done") return { ready: false, cause: "prerequisite", reason: `waiting for prerequisite: ${id}` };
    if (!predecessor.handoff_baseline && !fs.existsSync(path.join(store(root), `${id}.json`))) return { ready: false, cause: "handoff", recovery_owner: "owner", reason: `${id}: completed before verified handoffs were recorded. Its baseline and revision-bound evidence are unavailable; revalidate the predecessor and produce a verified handoff before resuming ${task.id}. Increasing the session budget or unblocking alone will not fix this.` };
    let record;
    try { record = readHandoff(root, predecessor); } catch (error) { return { ready: false, cause: "handoff", reason: error.message }; }
    inputs[id] = record.output.revision;
    for (const name of record.changed_files) {
      const next = record.output.files[name] || null;
      const previous = record.baseline.files[name] || null;
      const earlier = operations.get(name);
      if (earlier && earlier.next !== next && earlier.next !== previous) conflicts.push(name);
      else operations.set(name, { next, mode: record.output.modes[name], previous: earlier ? earlier.previous : previous });
    }
  }
  if (task.handoff_baseline && JSON.stringify(task.input_revisions || {}) === JSON.stringify(inputs)
      && task.integration_inputs?.status !== "required") return { ready: true, input_revisions: inputs };
  for (const [name, op] of operations) {
    const current = fileHash(safeFile(task.workspace, name));
    if (current !== op.previous && current !== op.next) conflicts.push(name);
  }
  if (task.integration_inputs?.status === "composed" && JSON.stringify(task.integration_inputs.input_revisions) === JSON.stringify(inputs)) {
    task.input_revisions = inputs;
    return { ready: true, integrated: true, input_revisions: inputs };
  }
  if (conflicts.length) {
    // Unrelated prerequisite artifacts remain usable while Rowan owns only
    // the overlap. Never overwrite any of the conflicting destinations.
    const conflicted = new Set(conflicts);
    for (const [name, op] of operations) {
      if (conflicted.has(name)) continue;
      const target = safeFile(task.workspace, name);
      if (op.next === null) fs.rmSync(target, { force: true });
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(store(root), "blobs", op.next), target); if (process.platform !== "win32") fs.chmodSync(target, op.mode === "100755" ? 0o755 : 0o644); }
    }
    task.integration_inputs = { version: 1, owner: "rowan", input_revisions: inputs, files: [...new Set(conflicts)], status: "required", sessions: task.integration_inputs?.sessions || 0 };
    for (const id of ordered) {
      const record = readHandoff(root, tasks[id]);
      atomic(path.join(task.workspace, ".atl-inputs", id, "handoff.json"), record);
      for (const name of record.changed_files) {
        const digest = record.output.files[name];
        if (!digest) continue;
        const target = safeFile(task.workspace, `.atl-inputs/${id}/files/${name}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(store(root), "blobs", digest), target);
      }
    }
    for (const [name, op] of operations) {
      if (!op.next) continue;
      const target = safeFile(task.workspace, `.atl-inputs/${op.next}/${name}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(store(root), "blobs", op.next), target);
    }
    atomic(path.join(task.workspace, ".atl-inputs", "integration.json"), { ...task.integration_inputs, operations: [...operations] });
    task.input_revisions = inputs;
    return { ready: false, cause: "overlapping-edits", recovery_owner: "rowan", reason: `Rowan integration required: ${task.integration_inputs.files.join(", ")}` };
  }
  // This journal precedes writes; replay compares each destination to both
  // baseline and output, making an interrupted preparation idempotent.
  atomic(path.join(store(root), `${task.id}.preparation.json`), { version: 1, status: "preparing", inputs, operations: [...operations] });
  for (const [name, op] of operations) {
    const target = safeFile(task.workspace, name);
    if (op.next === null) fs.rmSync(target, { force: true });
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(store(root), "blobs", op.next), target); if (process.platform !== "win32") fs.chmodSync(target, op.mode === "100755" ? 0o755 : 0o644); }
  }
  task.input_revisions = inputs;
  atomic(path.join(store(root), `${task.id}.preparation.json`), { version: 1, status: "prepared", inputs });
  return { ready: true, input_revisions: inputs };
}

export function deliveryGate(root, tasks, integratedTask) {
  if (!integratedTask?.workspace || !fs.existsSync(integratedTask.workspace)) return { version: 1, ready: false, reason: "integrated workspace unavailable", missing: [], reviewed: false, browser: false };
  const output = snapshot(root, integratedTask.workspace);
  const evidence = (integratedTask.evidence || []).filter((e) => (e.packet_revision || 1) === (integratedTask.packet_revision || 1));
  const required = [...new Set([...tasks.flatMap((task) => task.completion_checks || []), ...(integratedTask.integrated_checks || [])])];
  const missing = required.filter((check) => !evidence.some((e) => e.kind === "check" && ["beacon", "manager"].includes(e.actor) && e.check === check && e.result === "pass" && e.coverage === "complete" && e.code_revision === output.revision && !e.invalidated));
  const reviewed = evidence.some((e) => e.kind === "review" && ["sage", "manager"].includes(e.actor) && e.result === "approve" && e.code_revision === output.revision && !e.invalidated);
  const browser = evidence.some((e) => e.kind === "browser-journey" && ["beacon", "manager"].includes(e.actor) && e.result === "pass" && e.coverage === "complete" && e.code_revision === output.revision && !e.invalidated);
  const ready = !missing.length && reviewed && browser;
  const reason = ready ? null : `integrated evidence missing: ${[...missing, ...(!reviewed ? ["Sage review"] : []), ...(!browser ? ["complete browser journey"] : [])].join(", ")}`;
  return { version: 1, revision: output.revision, ready, missing, reviewed, browser, reason };
}

export function createDeliveryBranch(root, tasks, integratedTask) {
  const gate = deliveryGate(root, tasks, integratedTask);
  if (!gate.ready) throw new Error("integrated review, predecessor checks and browser journey are required");
  const workspace = integratedTask.workspace;
  const index = path.join(store(root), `delivery-${integratedTask.id}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: "ATL runtime", GIT_AUTHOR_EMAIL: "atl@localhost", GIT_COMMITTER_NAME: "ATL runtime", GIT_COMMITTER_EMAIL: "atl@localhost" };
  const git = (args, input) => execFileSync("git", args, { cwd: workspace, env, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const branch = `atl/delivery-${integratedTask.id}-${gate.revision.slice(0, 12)}`;
  git(["check-ref-format", `refs/heads/${branch}`]);
  try {
    git(["read-tree", "--empty"]);
    const output = snapshot(root, workspace);
    if (output.revision !== gate.revision) throw new Error("integrated output changed during delivery");
    for (const [name, digest] of Object.entries(output.files)) {
      const blob = git(["hash-object", "-w", "--stdin"], fs.readFileSync(path.join(store(root), "blobs", digest)));
      git(["update-index", "--add", "--cacheinfo", output.modes[name], blob, name]);
    }
    const tree = git(["write-tree"]); const parent = git(["rev-parse", "HEAD"]);
    const commit = git(["commit-tree", tree, "-p", parent], `ATL verified integrated output ${gate.revision}\n`);
    // Compare-and-create: a prior delivery branch is never overwritten.
    try { git(["update-ref", `refs/heads/${branch}`, commit, "0".repeat(parent.length)]); }
    catch (error) { if (git(["rev-parse", `${branch}^{tree}`]) !== tree) throw error; }
    const result = { ...gate, branch, commit: git(["rev-parse", branch]), tree };
    atomic(path.join(store(root), "delivery.json"), result);
    return result;
  } finally { fs.rmSync(index, { force: true }); }
}
