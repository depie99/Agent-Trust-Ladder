import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redactLocal } from "./redact.mjs";

const execute = promisify(execFile);
const types = ["unit", "integration", "browser", "e2e", "artifact"];
const integratedJourney = "Integrated browser journey";

export function verificationPolicy(state, task) {
  return task?.verification_policy || state.verification_policy || "block";
}

export function testEvidence(task, revision = task.verification_revision, root = null) {
  const scenarios = [...new Set([...(task.completion_checks || []), ...(task.integrated_checks || [])])];
  const required = scenarios.map((expected) => ({ expected, kind: "check" }));
  if (task.integrated_delivery) required.push({ expected: integratedJourney, kind: "browser-journey" });
  const checks = required.map(({ expected, kind }) => {
    const attempts = (task.evidence || []).filter((entry) =>
      entry.kind === kind && (kind !== "check" || entry.check === expected));
    const entry = attempts.at(-1);
    const stale = entry && (entry.invalidated || (entry.packet_revision || 1) !== (task.packet_revision || 1)
      || (revision && entry.code_revision !== revision));
    const verifier = task.verifiers?.find((check) => check.expected === expected);
    const executionMatches = !verifier || (entry?.output_id
      && JSON.stringify(entry.command) === JSON.stringify(["node", ...verifier.args]));
    const files = entry?.output_id ? ["output.txt", ...(entry.screenshots || [])] : [];
    const artifactsAvailable = !root || files.every((name) =>
      validArtifact(entry.output_id, name) && fs.existsSync(path.join(artifactDirectory(root, entry.output_id), name)));
    let status = "missing";
    if (stale) status = "stale";
    else if (entry?.result === "skip") status = "skipped";
    else if (entry?.result === "fail" || (entry?.exit_code != null && entry.exit_code !== 0)) status = "failed";
    else if (executionMatches && artifactsAvailable && entry?.result === "pass" && entry.coverage === "complete" && entry.code_revision
      && (entry.test_type !== "browser" || entry.screenshots?.length === 2)) status = "passed";
    const baseline = task.verification_baseline?.packet_revision === (task.packet_revision || 1)
      ? task.verification_baseline.observations.find((observation) => observation.check === expected) || null
      : null;
    return { expected, type: verifier?.type || null, status, attempts, baseline };
  });
  return { policy: task.run_verification_policy || null, run_id: task.verification_run_id || null, revision: revision || null, verified: checks.length > 0 && checks.every(({ status }) => status === "passed"), checks };
}

export function setVerificationPolicy(state, task, policy) {
  if (!["block", "allow"].includes(policy) && !(task && policy === "inherit")) {
    throw new Error("Use block or allow, or inherit on a task.");
  }
  const target = task || state;
  if (policy === "inherit") delete target.verification_policy;
  else target.verification_policy = policy;
}

export function setVerifier(task, expected, type, args) {
  const journey = task.integrated_delivery && expected === integratedJourney && type === "browser";
  const acceptance = [...(task.completion_checks || []), ...(task.integrated_checks || [])];
  if ((!journey && !acceptance.includes(expected)) || !types.includes(type)
      || !args.length || !/^verification\/[\w/-]+\.m?js$/.test(args[0])) {
    throw new Error("Use an exact completion check, a test type, and a Node script under verification/.");
  }
  task.verifiers = [...(task.verifiers || []).filter((check) => check.expected !== expected), { expected, type, args, kind: journey ? "browser-journey" : "check" }];
}

function artifactDirectory(root, id) {
  return path.join(root, ".trust", "manager", "test-evidence", id);
}

function validArtifact(id, name) {
  return /^[0-9a-f-]{36}$/.test(id) && ["output.txt", "before.png", "after.png"].includes(name);
}

export function verificationArtifact(root, id, name = "output.txt") {
  if (!validArtifact(id, name)) return null;
  const file = path.join(artifactDirectory(root, id), name);
  try { return fs.readFileSync(file); } catch { return null; }
}

export async function runVerifier(root, workspace, verifier, revision, timeout, signal) {
  const id = crypto.randomUUID();
  const command = ["node", ...verifier.args];
  const started = Date.now();
  const capture = fs.mkdtempSync(path.join(os.tmpdir(), "atl-verifier-"));
  let output;
  let exitCode;
  try {
    const result = await execute(process.execPath, verifier.args, { cwd: workspace, timeout, signal, maxBuffer: 1024 * 1024,
      env: { ATL_TEST_EVIDENCE_DIR: capture, ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PLAYWRIGHT_BROWSERS_PATH)$/i.test(key))) } });
    output = result.stdout + result.stderr;
    exitCode = 0;
  } catch (error) {
    output = [error.message, error.stdout, error.stderr].filter(Boolean).join("\n");
    exitCode = Number.isInteger(error.code) ? error.code : 1;
  }
  const directory = artifactDirectory(root, id);
  const screenshots = [];
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "output.txt"), redactLocal(output, { root }), { flag: "wx" });
    if (["browser", "e2e"].includes(verifier.type)) for (const name of ["before.png", "after.png"]) {
      const file = path.join(capture, name);
      const stat = fs.lstatSync(file, { throwIfNoEntry: false });
      if (!stat?.isFile() || stat.size > 10 * 1024 * 1024) continue;
      const image = fs.readFileSync(file);
      if (!image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) continue;
      fs.writeFileSync(path.join(directory, name), image, { flag: "wx" });
      screenshots.push(name);
    }
  } finally {
    fs.rmSync(capture, { recursive: true, force: true });
  }
  return {
    kind: verifier.kind || "check", check: verifier.expected, result: signal?.aborted ? "skip" : exitCode === 0 ? "pass" : "fail", coverage: "complete",
    command, exit_code: exitCode, code_revision: revision, duration_ms: Date.now() - started, output_id: id,
    test_type: verifier.type, screenshots, detail: "Executed by ATL without a model",
  };
}
