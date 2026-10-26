import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promoteSkill, registerRoutine } from "../runtime/lib/governance.mjs";
import { runRoutine } from "../runtime/lib/routines.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-routines-")); const skill = { id: "audit", version: "1", input_contract: "repo", validation: "checks", approval_boundary: "owner", rollback: "disable", fixtures: ["f"], capabilities: ["repo.read"], validation_evidence: { runs: [{ result: "pass", artifact_hash: "h" }], independent_review: { verdict: "approve" } } }; promoteSkill(root, skill); registerRoutine(root, { id: "nightly", project: "p", skill_id: "audit", skill_version: "1", schedule: "cron", idempotency_key: "source", retry_limit: 2 }); const store = JSON.parse(fs.readFileSync(path.join(root, ".trust", "manager", "brain", "skills.json"), "utf8")); assert.equal(store.skills.length, 1); assert.throws(() => runRoutine(root, "nightly", { sourceFingerprint: "x" }), /disabled/); fs.rmSync(root, { recursive: true, force: true }); console.log("PASS: routines require approved skills, remain disabled, and preserve idempotency records");
