import fs from "node:fs";
import path from "node:path";

const value = fs.readFileSync(path.resolve("src/value.txt"), "utf8").trim();
if (value !== "ok") {
  process.stderr.write(`value=${value}\n`);
  process.exit(1);
}
fs.mkdirSync(path.resolve(".atl-evidence"), { recursive: true });
fs.writeFileSync(path.resolve(".atl-evidence/result.json"), `${JSON.stringify({ value })}\n`);
process.stdout.write("value=ok\n");
