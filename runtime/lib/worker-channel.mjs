import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validateWorkerCredential } from "./session-auth.mjs";
import { leaseAllows } from "./leases.mjs";

const executeFile = promisify(execFile);
const runner = fileURLToPath(new URL("../atl-manager.mjs", import.meta.url));
const optionSets = {
  update: ["actor", "set", "check", "objective", "evidence-pass", "evidence-fail", "review", "note", "checkpoint", "priority", "risk", "to"],
  move: ["actor", "note"], block: ["actor", "reason", "wake-in"], escalate: ["actor", "reason"],
  assign: ["actor", "to", "note"], observe: ["actor"], "contract-repair": ["actor"],
  revision: [], show: [], role: [], wake: [], feed: ["task", "n"],
};

export function scopedWorkerArguments(argv, { task, role }) {
  if (!Array.isArray(argv) || argv.length > 256 || !argv.every((item) => typeof item === "string" && !item.includes("\0")) || JSON.stringify(argv).length > 262144) throw new Error("Invalid worker command arguments.");
  const [command, ...rest] = argv;
  if (!Object.hasOwn(optionSets, command)) throw new Error(`Worker channel does not permit ${command || "an empty command"}.`);
  const positional = []; const options = {}; const optionArgs = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (!optionSets[command].includes(key) || i + 1 >= rest.length || rest[i + 1].startsWith("--")) throw new Error(`Worker channel does not permit option ${arg}.`);
    const value = rest[++i];
    (options[key] ||= []).push(value);
    optionArgs.push(arg, value);
  }
  if (options.actor && options.actor.some((actor) => actor !== role)) throw new Error("Worker channel cannot impersonate another actor.");
  if (command === "role") {
    if (positional.length !== 1 || positional[0] !== role) throw new Error("Worker channel is restricted to its assigned role.");
  } else if (["wake", "feed"].includes(command)) {
    if (positional.length || options.task?.some((id) => id !== task)) throw new Error("Worker channel is restricted to its assigned task.");
    if (command === "wake") return ["show", task];
  } else {
    const count = ["move", "observe", "contract-repair"].includes(command) ? 2 : 1;
    if (command === "show" && !positional.length) return ["show", task];
    if (positional.length !== count || positional[0] !== task) throw new Error("Worker channel is restricted to its assigned task.");
  }
  // Status and evidence must pass their explicit state/evidence gates.
  if (options.set?.some((value) => /^(?:status|evidence)(?:\.|=)/.test(value))) throw new Error("Use move or evidence commands to pass the task gates.");
  const result = [command, ...positional, ...optionArgs];
  if (optionSets[command].includes("actor") && !options.actor) result.push("--actor", role);
  if (command === "feed" && !options.task) result.push("--task", task);
  return result;
}

function packetArguments(args, workspace) {
  if (!["observe", "contract-repair"].includes(args[0])) return args;
  const file = path.resolve(workspace, args[2]);
  const canonical = fs.realpathSync(file);
  const relative = path.relative(fs.realpathSync(workspace), canonical);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) throw new Error("Worker observation packet must remain inside its workspace.");
  if (path.dirname(file) !== path.resolve(workspace)) checkDirectory(workspace, path.dirname(file));
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error("Worker observation packet cannot be a symlink.");
  const result = [...args]; result[2] = file; return result;
}

function publish(file, value) {
  // Exclusive creation prevents a worker from pre-planting a temporary-file
  // symlink and turning the manager's response into an outside-workspace write.
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { flag: "wx" });
  try { fs.renameSync(temporary, file); } finally { fs.rmSync(temporary, { force: true }); }
}

function checkDirectory(workspace, directory) {
  const base = path.resolve(workspace); let current = path.resolve(directory);
  if (!current.startsWith(base + path.sep)) throw new Error("Worker channel must be inside its workspace.");
  while (current !== base) {
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Worker channel cannot follow symlinks.");
    current = path.dirname(current);
  }
}

export function createWorkerChannel(root, { workspace, task, role, credential, commandTimeoutMs = 60000 }) {
  if (!workspace || !fs.existsSync(workspace)) throw new Error("A writable worker workspace is required for the handoff channel.");
  const directory = path.join(workspace, ".atl-evidence", "worker-channel", crypto.randomUUID());
  checkDirectory(workspace, directory);
  fs.mkdirSync(directory, { recursive: true });
  const client = path.join(directory, "atl-worker.mjs");
  fs.copyFileSync(new URL("./worker-channel-client.mjs", import.meta.url), client);
  const token = crypto.randomBytes(32).toString("hex");
  const processed = new Set();
  let closed = false; let pending = Promise.resolve(); let timer; let lastHeartbeat = 0;
  const status = (state) => {
    checkDirectory(workspace, directory);
    publish(path.join(directory, "status.json"), { version: 1, state, heartbeat: Date.now() });
    lastHeartbeat = Date.now();
  };
  const authenticate = () => {
    if (!validateWorkerCredential(credential, { project: path.resolve(root), task, role, run: credential.run, generation: credential.generation }) || !leaseAllows(root, { key: credential.lease_key, id: credential.lease_id, generation: credential.generation })) throw new Error("Worker handoff rejected: expired credential or stale lease.");
  };
  authenticate(); status("ready");
  const handle = async (name) => {
    const id = name.slice(0, -".request.json".length);
    let response;
    try {
      checkDirectory(workspace, directory);
      const file = path.join(directory, name); const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw new Error("Invalid worker request file.");
      const packet = JSON.parse(fs.readFileSync(file, "utf8"));
      if (closed || packet.version !== 1 || packet.id !== id || typeof packet.token !== "string" || packet.token !== token) throw new Error("Worker handoff authentication failed.");
      authenticate();
      if (!Number.isFinite(packet.expiresAt) || packet.expiresAt <= Date.now()) throw new Error("Worker handoff request expired before execution; no command was retried.");
      const args = packetArguments(scopedWorkerArguments(packet.argv, { task, role }), workspace);
      const env = { ...process.env, ATL_PROJECT: root, ATL_WORKER_CREDENTIAL: JSON.stringify(credential) };
      for (const key of ["ATL_WORKER_CHANNEL", "ATL_WORKER_CHANNEL_TOKEN", "ATL_WORKER_CHANNEL_CLIENT"]) delete env[key];
      try {
        const result = await executeFile(process.execPath, [runner, ...args], { cwd: workspace, env, windowsHide: true, timeout: commandTimeoutMs, maxBuffer: 1024 * 1024 });
        response = { code: 0, stdout: result.stdout, stderr: result.stderr };
      } catch (error) { response = { code: Number.isInteger(error.code) ? error.code : 1, stdout: error.stdout || "", stderr: error.stderr || `error: ${error.message}\n` }; }
    } catch (error) { response = { code: 1, stdout: "", stderr: `error: ${error.message}\n` }; }
    checkDirectory(workspace, directory);
    publish(path.join(directory, `${id}.response.json`), { version: 1, id, ...response });
    fs.rmSync(path.join(directory, name), { force: true });
  };
  const poll = () => {
    if (closed) return;
    try {
      checkDirectory(workspace, directory);
      if (Date.now() - lastHeartbeat >= 1000) status("ready");
      for (const name of fs.readdirSync(directory).sort()) {
        if (!/^[a-f0-9-]{36}\.request\.json$/.test(name) || processed.has(name)) continue;
        processed.add(name);
        pending = pending.then(() => handle(name)).catch(() => { closed = true; clearInterval(timer); });
      }
    } catch { closed = true; clearInterval(timer); }
  };
  timer = setInterval(poll, 50);
  return {
    directory, client,
    env: { ATL_BIN: client, ATL_WORKER_CHANNEL: directory, ATL_WORKER_CHANNEL_TOKEN: token, ATL_WORKER_CHANNEL_CLIENT: "1" },
    async close() { closed = true; clearInterval(timer); await pending; try { status("closed"); } catch { /* unsafe or unavailable channel remains closed */ } },
  };
}
