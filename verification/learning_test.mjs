import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { forgetLocal, learnLocal, learningStatus, recallLocal } from "../runtime/lib/learning.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-learning-"));
const learned = learnLocal(root, { kind: "style", text: "Prefer concise Persian explanations with direct evidence.", source: "explicit-feedback" });
learnLocal(root, { kind: "lesson", text: "Do not add third-party directories to the repository.", source: "explicit-feedback" });
const hits = recallLocal(root, "concise evidence explanation");
assert.equal(hits.results[0].id, learned.id);
assert.equal(learningStatus(root).entries, 2);
assert.equal(forgetLocal(root, learned.id).removed, true);
assert.equal(learningStatus(root).entries, 1);
fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: local learning stores, recalls, reports, and forgets explicit feedback");
