import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const [id, role] = process.argv.slice(2);
if (process.env.ATL_WORKER_CREDENTIAL) throw new Error("Manager mutation credential leaked into worker environment");
const call = (...args) => run(process.execPath, ["--permission", "--allow-fs-read=*", `--allow-fs-write=${process.cwd()}`, process.env.ATL_BIN, ...args], { env: process.env, windowsHide: true });
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
