// Copied into the worker workspace. This client needs no shared-state writes
// or network access; the manager executes each permitted command and replies.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export async function requestWorkerCommand(argv, { directory = process.env.ATL_WORKER_CHANNEL, token = process.env.ATL_WORKER_CHANNEL_TOKEN, timeoutMs = 90000 } = {}) {
  if (!directory || !token) throw new Error("Worker handoff channel is unavailable; start the task through ATL.");
  const id = crypto.randomUUID();
  const request = path.join(directory, `${id}.request.json`);
  const temporary = `${request}.tmp`;
  const reply = path.join(directory, `${id}.response.json`);
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, id, token, argv, expiresAt: Date.now() + timeoutMs }), { flag: "wx" });
  fs.renameSync(temporary, request);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      try {
        const response = JSON.parse(fs.readFileSync(reply, "utf8"));
        if (response.id !== id || response.version !== 1) throw new Error("Invalid worker handoff response.");
        return response;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      const status = JSON.parse(fs.readFileSync(path.join(directory, "status.json"), "utf8"));
      if (status.state !== "ready" || Date.now() - status.heartbeat > 15000) throw new Error("Worker handoff channel closed or manager stopped; no command was retried.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Worker handoff response timed out; inspect the manager session before retrying this command.");
  } finally {
    try { fs.rmSync(reply, { force: true }); } catch { /* manager may have closed */ }
  }
}

if (process.env.ATL_WORKER_CHANNEL_CLIENT === "1") {
  requestWorkerCommand(process.argv.slice(2)).then((result) => {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.code;
  }).catch((error) => { console.error(`error: ${error.message}`); process.exitCode = 1; });
}
