import assert from "node:assert/strict";
import { parseIntakeFile } from "../runtime/lib/intake.mjs";

const tasks = parseIntakeFile(`
## Indented checks
@priority: high
Objective text.
Checks:
  - first observable check
  - second observable check
`, "test.md");

assert.equal(tasks.length, 1);
assert.deepEqual(tasks[0].completion_checks, [
  "first observable check",
  "second observable check",
]);
console.log("PASS: indented intake completion checks are parsed");
