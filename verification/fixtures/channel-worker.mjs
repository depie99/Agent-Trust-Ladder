import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const [id, role] = process.argv.slice(2);
// Node's permission model compares canonical paths: on macOS the temp roots
// sit behind /var -> /private/var, so the allowances must be the resolved
// directories or every write outside them is denied. ATL writes session state
// under the project root while the worker's cwd is the task workspace.
const cwdReal = fs.realpathSync(process.cwd());
const projectReal = fs.realpathSync(process.env.ATL_PROJECT || path.join(cwdReal, ".."));
let step = 0;
// Allow both the raw and the canonical forms: Node's permission check compares
// the path as opened, and the channel client writes through the unresolved
// /var/... paths it was handed while macOS stores them under /private/var.
const writeAllows = [...new Set([process.cwd(), cwdReal, process.env.ATL_PROJECT, projectReal].filter(Boolean))];
const call = async (...args) => {
  step++;
  try { return await run(process.execPath, ["--permission", "--allow-fs-read=*", ...writeAllows.map((dir) => `--allow-fs-write=${dir}`), process.env.ATL_BIN, ...args], { env: process.env, windowsHide: true }); }
  catch (error) {
    // The parent fixture is not permission-sandboxed: persist the child's
    // streams so a platform-specific denial is diagnosable from CI logs.
    try { fs.writeFileSync(path.join(cwdReal, `worker-error-${step}.txt`), `args: ${JSON.stringify(args)}\nmessage: ${error?.message}\nstderr: ${error?.stderr || ""}\nstdout: ${error?.stdout || ""}`); } catch { /* best effort */ }
    throw error;
  }
};
try {
  if (process.env.ATL_WORKER_CREDENTIAL) throw new Error("Manager mutation credential leaked into worker environment");
  await call("show", id);
  if (role === "rowan") {
    await call("move", id, "in_progress");
    fs.writeFileSync(path.join(process.cwd(), "result.txt"), "output produced by contained worker\n");
    await call("update", id, "--evidence-pass", "worker result verified");
    await call("move", id, "in_review");
  } else if (role === "sage") {
    if (!fs.readFileSync("result.txt", "utf8").includes("contained worker")) throw new Error("Missing result");
    await call("update", id, "--review", "approve: fixture reviewer inspected contained output");
    await call("move", id, "verifying");
  } else if (role === "beacon") {
    if (!fs.readFileSync("result.txt", "utf8").includes("contained worker")) throw new Error("Missing result");
    await call("update", id, "--evidence-pass", "worker result verified");
    await call("move", id, "done");
  } else throw new Error(`Unexpected fixture role ${role}`);
} catch (error) {
  // Whole-body capture: an immediate exit without any worker-error file means
  // the failure was here, not inside an ATL call.
  try { fs.writeFileSync(path.join(cwdReal, `worker-fatal-${role}.txt`), `stage: ${step}\nmessage: ${error?.message}\nstack: ${error?.stack || ""}`); } catch { /* best effort */ }
  throw error;
}
