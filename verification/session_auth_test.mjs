import assert from "node:assert/strict";
import { createWorkerCredential, validateWorkerCredential } from "../runtime/lib/session-auth.mjs";
const expected = { project: "C:/project", task: "T-001", role: "rowan", run: "R-1", generation: 1 };
const credential = createWorkerCredential(expected, { expiresInSeconds: 60 });
assert.equal(validateWorkerCredential(credential, expected), true);
assert.equal(validateWorkerCredential(credential, { ...expected, role: "sage" }), false);
assert.equal(validateWorkerCredential({ ...credential, expires_at: "2020-01-01T00:00:00Z" }, expected), false);
console.log("PASS: scoped worker credentials bind role, task, run, and expiry");
