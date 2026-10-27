import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { prepareInputs, startBaseline } from "./handoffs.mjs";

function inside(workspace, relative) {
  const file = path.resolve(workspace, relative);
  if (!file.startsWith(path.resolve(workspace) + path.sep)) throw new Error(`prerequisite outside workspace: ${relative}`);
  return file;
}
export function dispatchPreflight(root, task, tasks, { providerReady = true, provisionLocal = false, execute = spawnSync, allowIntegration = false } = {}) {
  if (!providerReady) return { ready: false, cause: "provider-unavailable", recovery_owner: "owner", reason: "provider executable or credentials unavailable" };
  if (!task.workspace || !fs.existsSync(task.workspace)) return { ready: false, cause: "workspace", reason: "isolated workspace unavailable" };
  const prepared = prepareInputs(root, task, tasks);
  const integration = !prepared.ready && prepared.cause === "overlapping-edits" && allowIntegration;
  if (!prepared.ready && !integration) return prepared;
  const contract = task.dispatch_contract || {};
  for (const artifact of contract.artifacts || []) {
    if (!fs.existsSync(inside(task.workspace, artifact))) return { ready: false, cause: "missing-artifact", reason: `missing prerequisite artifact: ${artifact}` };
  }
  const manifest = path.join(task.workspace, "package.json");
  if (fs.existsSync(manifest)) {
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    for (const [name, specifier] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (!String(specifier).startsWith("file:")) continue;
      const dependency = path.resolve(task.workspace, specifier.slice(5));
      const canonical = fs.existsSync(dependency) ? fs.realpathSync(dependency) : dependency;
      const relative = path.relative(fs.realpathSync(task.workspace), canonical);
      if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) return { ready: false, cause: "dependency-scope", recovery_owner: "owner", reason: `local dependency ${name} is outside the worker workspace` };
    }
    if (Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length) {
      if (!fs.existsSync(path.join(task.workspace, "package-lock.json"))) return { ready: false, cause: "locked-dependencies", reason: "package-lock.json required for reproducible dependency preparation" };
      const lock = fs.readFileSync(path.join(task.workspace, "package-lock.json"));
      const dependencyReceipt = JSON.stringify({ lock: lock.toString("base64"), manifest: pkg });
      const installed = path.join(task.workspace, "node_modules", ".package-lock.json");
      const receipt = path.join(task.workspace, ".atl-dependencies.json");
      let fresh = false;
      try { fresh = fs.existsSync(installed) && fs.readFileSync(receipt, "utf8") === dependencyReceipt; } catch { /* requires preparation */ }
      if (!fresh && provisionLocal) {
        const args = ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"];
        const env = { ...process.env, npm_config_cache: path.join(root, ".trust", "manager", "npm-cache") };
        const result = process.platform === "win32"
          ? execute(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm " + args.join(" ")], { cwd: task.workspace, encoding: "utf8", timeout: 120000, windowsHide: true, env })
          : execute("npm", args, { cwd: task.workspace, encoding: "utf8", timeout: 120000, env });
        if (result.status !== 0) return { ready: false, cause: "local-dependencies-unavailable", recovery_owner: "owner", reason: `locked packages unavailable in local cache; network is not authorized: ${String(result.stderr || result.error || "npm ci failed").slice(-2000)}` };
        fs.writeFileSync(receipt, dependencyReceipt); fresh = true;
      }
      if (!fresh) return { ready: false, cause: "local-dependencies", reason: "locked local dependencies require runtime preparation" };
    }
  }
  for (const command of contract.commands || []) {
    if (!Array.isArray(command) || !command.length || !command.every((part) => typeof part === "string")) return { ready: false, cause: "verifier-contract", reason: "verification commands must be executable argument arrays" };
    const result = execute(command[0], command.slice(1), { cwd: task.workspace, encoding: "utf8", timeout: 30000, windowsHide: true });
    if (result.status !== 0) return { ready: false, cause: "verifier-assumption", reason: `preflight command failed: ${command.join(" ")}: ${String(result.stderr || result.error || result.status).slice(-2000)}` };
  }
  startBaseline(root, task);
  task.dispatch_preflight = { version: 1, ready: true, input_revisions: task.input_revisions, at: new Date().toISOString() };
  return { ready: true, integration };
}
