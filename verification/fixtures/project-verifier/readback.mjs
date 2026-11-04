import fs from "node:fs";
import path from "node:path";

const result = JSON.parse(fs.readFileSync(path.resolve(".atl-evidence/result.json"), "utf8"));
if (result.value !== "ok") process.exit(1);
process.stdout.write("persisted=ok\n");
