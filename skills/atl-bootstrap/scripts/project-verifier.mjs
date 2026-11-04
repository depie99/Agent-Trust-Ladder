#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deliveryContentRevision } from "./developer-delivery.mjs";

export const PROJECT_VERIFIER_VERSION = 1;
const SAFE_RELATIVE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]+$/;

function safePath(root, relative) {
  if (typeof relative !== "string" || !SAFE_RELATIVE.test(relative)) throw new Error(`unsafe project path: ${relative}`);
  const target = path.resolve(root, relative);
  if (target !== path.resolve(root) && !target.startsWith(path.resolve(root) + path.sep)) throw new Error(`project path escapes workspace: ${relative}`);
  return target;
}

function command(value, field) {
  if (!Array.isArray(value) || !value.length || !value.every((part) => typeof part === "string" && part.length)) {
    throw new Error(`${field} must be an executable argument array`);
  }
  return [...value];
}

export function validateProjectVerifier(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("verifier manifest missing");
  if (manifest.version !== PROJECT_VERIFIER_VERSION) throw new Error(`unsupported verifier manifest version: ${manifest.version ?? "unknown"}`);
  if (!String(manifest.id || "").trim()) throw new Error("verifier id is required");
  if (!String(manifest.owner || "").trim()) throw new Error("verifier owner is required");
  if (!Array.isArray(manifest.checks) || !manifest.checks.length) throw new Error("at least one acceptance check is required");
  const ids = new Set();
  for (const check of manifest.checks) {
    if (!String(check.id || "").trim()) throw new Error("acceptance check id is required");
    if (ids.has(check.id)) throw new Error(`duplicate acceptance check id: ${check.id}`);
    ids.add(check.id);
    check.command = command(check.command, `${check.id}.command`);
    if (check.readback) check.readback.command = command(check.readback.command, `${check.id}.readback.command`);
  }
  for (const prerequisite of manifest.prerequisites || []) command(prerequisite.command, "prerequisite.command");
  for (const entry of manifest.baseline?.commands || []) command(entry, "baseline.commands");
  for (const tool of manifest.tools || []) {
    if (typeof tool !== "string" || !/^[A-Za-z0-9._+-]+$/.test(tool)) throw new Error(`invalid required tool: ${tool}`);
  }
  for (const name of [...(manifest.content || []), ...(manifest.prerequisites || []).flatMap((item) => item.files || [])]) safePath("/fixture", name);
  if (manifest.evidence && !SAFE_RELATIVE.test(manifest.evidence)) throw new Error("evidence path must stay inside the project");
  return manifest;
}

function truncate(value, length = 4000) {
  return String(value || "").slice(-length);
}

function run(commandValue, cwd, execute) {
  const result = execute(commandValue[0], commandValue.slice(1), {
    cwd,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    command: commandValue,
    ok: !result.error && result.status === 0,
    exit_code: result.status ?? null,
    error: result.error ? String(result.error.message || result.error) : null,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  };
}

export function checkProjectReadiness(manifest, cwd, {
  execute = spawnSync,
  env = process.env,
  capabilities = {},
} = {}) {
  validateProjectVerifier(manifest);
  for (const tool of manifest.tools || []) {
    const probe = execute(tool, ["--version"], { cwd, encoding: "utf8", timeout: 10000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    if (probe.error) return { ready: false, cause: "tool-unavailable", recovery_owner: manifest.owner, reason: `required tool unavailable: ${tool}` };
  }
  const missingFiles = (manifest.prerequisites || []).flatMap((item) => item.files || []).filter((name) => !fs.existsSync(safePath(cwd, name)));
  if (missingFiles.length) return { ready: false, cause: "missing-prerequisite", recovery_owner: manifest.owner, reason: `missing project files: ${missingFiles.join(", ")}` };
  if (manifest.requiresLockfile && fs.existsSync(path.join(cwd, "package.json")) && !fs.existsSync(path.join(cwd, "package-lock.json"))) {
    return { ready: false, cause: "locked-dependencies", recovery_owner: "owner", reason: "package-lock.json is required for reproducible dependencies" };
  }
  const missingEnvironment = (manifest.auth?.environment || []).filter((name) => !env[name]);
  if (missingEnvironment.length) return { ready: false, cause: "authorization-unavailable", recovery_owner: "owner", reason: `required environment variables are not set: ${missingEnvironment.join(", ")}` };
  const missingCapabilities = Object.entries(manifest.capabilities || {}).filter(([name, required]) => required && capabilities[name] !== true).map(([name]) => name);
  if (missingCapabilities.length) return { ready: false, cause: "capability-unavailable", recovery_owner: "owner", reason: `host capabilities unavailable: ${missingCapabilities.join(", ")}` };
  for (const prerequisite of manifest.prerequisites || []) {
    const result = run(prerequisite.command, cwd, execute);
    if (!result.ok) return { ready: false, cause: prerequisite.cause || "prerequisite-command", recovery_owner: prerequisite.owner || manifest.owner, reason: `prerequisite failed: ${prerequisite.command.join(" ")}`, observation: result };
  }
  for (const baseline of manifest.baseline?.commands || []) {
    const result = run(baseline, cwd, execute);
    if (!result.ok) return { ready: false, cause: "baseline-failure", recovery_owner: manifest.owner, reason: `baseline health failed before dispatch: ${baseline.join(" ")}`, observation: result };
  }
  return { ready: true, cause: null, reason: null, recovery_owner: null };
}

function contentManifest(cwd, names) {
  const files = {};
  const modes = {};
  for (const name of [...new Set(names || [])].sort()) {
    const file = safePath(cwd, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`content path is not a file: ${name}`);
    files[name] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    modes[name] = process.platform !== "win32" && fs.statSync(file).mode & 0o111 ? "100755" : "100644";
  }
  return { revision: deliveryContentRevision(files, modes), files, modes };
}

function observationMatches(observation, expected = {}) {
  if (observation.exit_code !== (expected.exit_code ?? 0)) return false;
  if (expected.stdout_includes && !observation.stdout.includes(expected.stdout_includes)) return false;
  if (expected.stderr_includes && !observation.stderr.includes(expected.stderr_includes)) return false;
  return true;
}

export function runProjectVerifier(manifest, cwd, {
  execute = spawnSync,
  env = process.env,
  capabilities = {},
  writeEvidence = true,
} = {}) {
  const readiness = checkProjectReadiness(manifest, cwd, { execute, env, capabilities });
  const startedAt = new Date().toISOString();
  if (!readiness.ready) {
    const evidence = { version: PROJECT_VERIFIER_VERSION, verifier: { id: manifest.id }, started_at: startedAt, result: "blocked", readiness, checks: [], content: null };
    if (writeEvidence) persistEvidence(cwd, manifest, evidence);
    return { ...readiness, result: "blocked", evidence };
  }
  const content = contentManifest(cwd, manifest.content || []);
  const checks = [];
  for (const check of manifest.checks) {
    const observation = run(check.command, cwd, execute);
    const expected = check.expected || {};
    const passed = observationMatches(observation, expected);
    const readback = check.readback ? run(check.readback.command, cwd, execute) : null;
    const readbackPassed = !check.readback || observationMatches(readback, check.readback.expected || {});
    const missingArtifacts = (check.artifacts || []).filter((name) => !fs.existsSync(safePath(cwd, name)));
    checks.push({
      id: check.id,
      result: passed && readbackPassed && !missingArtifacts.length ? "pass" : "fail",
      observation,
      readback,
      missing_artifacts: missingArtifacts,
      content_revision: content.revision,
      verifier_version: PROJECT_VERIFIER_VERSION,
    });
  }
  const result = checks.every((check) => check.result === "pass") ? "pass" : "fail";
  const evidence = {
    version: PROJECT_VERIFIER_VERSION,
    verifier: { id: manifest.id, owner: manifest.owner, version: manifest.version },
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    result,
    command_context: checks.map((check) => check.observation.command),
    checks,
    content,
    artifact_paths: checks.flatMap((check) => (manifest.checks.find((entry) => entry.id === check.id)?.artifacts || [])),
  };
  if (writeEvidence) persistEvidence(cwd, manifest, evidence);
  return { ready: result === "pass", cause: result === "pass" ? null : "verifier-failure", reason: result === "pass" ? null : "one or more acceptance checks failed", recovery_owner: result === "pass" ? null : "rowan", result, evidence };
}

function persistEvidence(cwd, manifest, evidence) {
  const relative = manifest.evidence || ".atl-evidence/project-verifier.json";
  const file = safePath(cwd, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

export function cleanupOwned(root, pathsToRemove) {
  const resolvedRoot = path.resolve(root);
  const removed = [];
  for (const relative of pathsToRemove) {
    const target = safePath(resolvedRoot, relative);
    if (target === resolvedRoot) throw new Error("refusing to remove the project root");
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(relative);
  }
  return removed;
}

function loadManifest(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function main(args) {
  const commandName = args[0];
  const manifest = loadManifest(args[1] || ".atl-verifier.json");
  if (commandName === "check") {
    const result = checkProjectReadiness(manifest, process.cwd());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ready ? 0 : 2;
  }
  if (commandName === "run") {
    const result = runProjectVerifier(manifest, process.cwd());
    process.stdout.write(`${JSON.stringify({ ready: result.ready, result: result.result, evidence: result.evidence }, null, 2)}\n`);
    return result.ready ? 0 : 2;
  }
  process.stderr.write("Usage: project-verifier.mjs check [manifest.json] | run [manifest.json]\n");
  return 64;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
