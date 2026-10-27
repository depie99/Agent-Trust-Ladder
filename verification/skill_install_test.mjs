import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSkill, designateSkill, parseSkillSource } from "../runtime/lib/skill-install.mjs";
import { listSkills } from "../runtime/lib/governance.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-install-test-"));
try {
  assert.deepEqual(parseSkillSource("npx skills add owner/repo --skill hello"), {url:"https://github.com/owner/repo.git", name:"hello", ref:null, subpath:null});
  assert.equal(parseSkillSource("https://skills.sh/owner/repo/hello").name, "hello");
  for (const bad of ["npx skills add owner/repo; whoami", "https://evil.example/repo", "npx skills add owner/repo --all", "owner/../bad"]) assert.throws(() => parseSkillSource(bad));
  const clone = async (_source, dest) => { fs.mkdirSync(path.join(dest,"skills","hello"), {recursive:true}); fs.writeFileSync(path.join(dest,"skills","hello","SKILL.md"), "---\nname: hello\n---\nInstructions\n"); };
  const result = await installSkill(root, "npx skills add owner/repo --skill hello", { clone });
  assert.equal(result.id, "hello"); assert.ok(fs.existsSync(path.join(root, result.path, "SKILL.md")));
  await assert.rejects(installSkill(root, "owner/repo --skill hello", { clone }));
  await assert.rejects(installSkill(root, "npx skills add owner/repo --skill hello", { clone }), /already installed/);
  assert.throws(() => designateSkill(root, "missing"));
  const skill = designateSkill(root, "hello"); assert.equal(skill.evidence_verified, false); assert.equal(listSkills(root)[0].trust_basis, "user-designated");
  assert.throws(() => designateSkill(root, "hello"), /already/);
  console.log("PASS: skill source parsing, installation, duplicate handling, and honest designation");
} finally { fs.rmSync(root, {recursive:true,force:true}); }
