import { programTaskReady } from './programs.mjs';
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { prepareInputs, startBaseline } from "./handoffs.mjs";
import { checkProjectReadiness, validateProjectVerifier } from "../../skills/atl/scripts/project-verifier.mjs";

function inside(workspace, relative) {
  const file = path.resolve(workspace, relative);
  if (!file.startsWith(path.resolve(workspace) + path.sep)) throw new Error(`prerequisite outside workspace: ${relative}`);
  return file;
}
export function dispatchPreflight(root, task, tasks, { providerReady = true, provisionLocal = false, execute = spawnSync, allowIntegration = false } = {}) {
  if (!programTaskReady(task)) return { ready: false, cause: "program-dependency", recovery_owner: "owner", reason: "program milestone prerequisites are not verified or authorization is paused" };
  if (!providerReady) return { ready: false, cause: "provider-unavailable", recovery_owner: "owner", reason: "provider executable or credentials unavailable" };
  if (!task.workspace || !fs.existsSync(task.workspace)) return { ready: false, cause: "workspace", reason: "isolated workspace unavailable" };
  const verifierPath = task.verifier_manifest || ".atl-verifier.json";
  const verifierFile = inside(task.workspace, verifierPath);
  let verifier = null;
  if (fs.existsSync(verifierFile)) {
    try {
      verifier = validateProjectVerifier(JSON.parse(fs.readFileSync(verifierFile, "utf8")));
    } catch (error) {
      return { ready: false, cause: "verifier-contract", recovery_owner: "owner", reason: `invalid project verifier: ${error.message}` };
    }
    const capabilities = {
      execution: true,
      ...(task.host_capabilities || task.dispatch_contract?.capabilities || {}),
    };
    const readiness = checkProjectReadiness(verifier, task.workspace, { execute, capabilities });
    if (!readiness.ready) return readiness;
  }
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
      // Lockfile-polyglot preparation: honor whichever lockfile the repository
      // actually ships (npm ci --offline, yarn install --frozen-lockfile, or
      // pnpm install --frozen-lockfile). An untracked dependency tree without
      // any lockfile stays blocked — reproducibility is the point.
      const npmLock = path.join(task.workspace, "package-lock.json");
      const yarnLock = path.join(task.workspace, "yarn.lock");
      const pnpmLock = path.join(task.workspace, "pnpm-lock.yaml");
      const manager = fs.existsSync(npmLock) ? "npm" : fs.existsSync(yarnLock) ? "yarn" : fs.existsSync(pnpmLock) ? "pnpm" : null;
      if (!manager) return { ready: false, cause: "locked-dependencies", recovery_owner: "owner", reason: "package-lock.json, yarn.lock, or pnpm-lock.yaml required for reproducible dependency preparation" };
      const lockFile = manager === "npm" ? npmLock : manager === "yarn" ? yarnLock : pnpmLock;
      const lock = fs.readFileSync(lockFile);
      const dependencyReceipt = JSON.stringify({ lock: lock.toString("base64"), manifest: pkg, manager });
      const installedMarker = manager === "npm"
        ? path.join(task.workspace, "node_modules", ".package-lock.json")
        : manager === "yarn"
          ? path.join(task.workspace, "node_modules", ".yarn-integrity")
          : path.join(task.workspace, "node_modules", ".pnpm");
      const receipt = path.join(task.workspace, ".atl-dependencies.json");
      let fresh = false;
      try { fresh = fs.existsSync(installedMarker) && fs.readFileSync(receipt, "utf8") === dependencyReceipt; } catch { /* requires preparation */ }
      if (!fresh && provisionLocal) {
        const env = { ...process.env, npm_config_cache: path.join(root, ".trust", "manager", "npm-cache") };
        const args = manager === "npm"
          ? ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"]
          : ["install", "--frozen-lockfile", "--ignore-scripts"];
        const command = manager === "npm" ? "npm" : manager;
        const result = process.platform === "win32"
          ? execute(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `${command} ${args.join(" ")}`], { cwd: task.workspace, encoding: "utf8", timeout: 600000, windowsHide: true, env })
          : execute(command, args, { cwd: task.workspace, encoding: "utf8", timeout: 600000, env });
        if (result.status !== 0) return { ready: false, cause: "local-dependencies-unavailable", recovery_owner: "owner", reason: `locked packages unavailable (${manager}); ${manager === "npm" ? "network is not authorized" : "install failed"}: ${String(result.stderr || result.error || `${command} install failed`).slice(-2000)}` };
        fs.writeFileSync(receipt, dependencyReceipt); fresh = true;
      }
      if (!fresh) return { ready: false, cause: "local-dependencies", reason: `Locked dependencies are not prepared in this task workspace (${manager} lockfile): the install marker or the matching .atl-dependencies.json receipt is missing or stale. Automatic preparation is disabled (workspaces.provisionLocal is not true). Enable workspaces.provisionLocal and run recovery; ATL will run ${manager} install ${manager === "npm" ? "ci --offline" : "--frozen-lockfile"} --ignore-scripts without a model session.` };
    }
  }
  for (const command of contract.commands || []) {
    if (!Array.isArray(command) || !command.length || !command.every((part) => typeof part === "string")) return { ready: false, cause: "verifier-contract", reason: "verification commands must be executable argument arrays" };
    const result = execute(command[0], command.slice(1), { cwd: task.workspace, encoding: "utf8", timeout: 30000, windowsHide: true });
    if (result.status !== 0) return { ready: false, cause: "verifier-assumption", reason: `preflight command failed: ${command.join(" ")}: ${String(result.stderr || result.error || result.status).slice(-2000)}` };
  }
  startBaseline(root, task);
  task.dispatch_preflight = {
    version: 1,
    ready: true,
    input_revisions: task.input_revisions,
    at: new Date().toISOString(),
    verifier: verifier ? { id: verifier.id, version: verifier.version, manifest: verifierPath } : null,
  };
  return { ready: true, integration };
}
