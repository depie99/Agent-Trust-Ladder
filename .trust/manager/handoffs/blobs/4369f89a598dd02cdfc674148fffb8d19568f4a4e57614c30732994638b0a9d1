// history_test.mjs — the unified agent chat-history viewer.
// Run from the repo root: node verification/history_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { historySources, listHistory, readTranscript, renderHistoryList, renderTranscript, resolveHistoryRef } from "../runtime/lib/history.mjs";

// ---------- fixtures: a fake home with one Codex session and one ZCode session
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-history-home-"));

const codexId = "01a15de3-5dbe-7063-bd90-ced32fc9e91b";
const codexDir = path.join(home, ".codex", "sessions", "2026", "10", "21");
fs.mkdirSync(codexDir, { recursive: true });
const codexFile = path.join(codexDir, `rollout-2026-10-21T13-25-44-${codexId}.jsonl`);
const codexLine = (type, payload, at) => JSON.stringify({ timestamp: at, type, payload });
fs.writeFileSync(codexFile, [
  codexLine("session_meta", { session_id: codexId, timestamp: "2026-10-21T09:55:44.192Z", cwd: "D:\\Projects\\Agentic", originator: "Codex Desktop", cli_version: "0.149.1", model_provider: "openai" }, "2026-10-21T09:55:45.634Z"),
  codexLine("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <cwd>D:\\Projects\\Agentic</cwd>\n</environment_context>" }] }, "2026-10-21T09:55:50.000Z"),
  codexLine("response_item", { type: "message", role: "developer", content: [{ type: "input_text", text: "You are Codex." }] }, "2026-10-21T09:55:51.000Z"),
  codexLine("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "حافظه و تاریخچه بین codex و cli مشترکه؟" }] }, "2026-10-21T09:56:00.000Z"),
  codexLine("response_item", { type: "reasoning", payload_note: "skipped", summary: [] }, "2026-10-21T09:56:05.000Z"),
  codexLine("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "نه، هر ابزار تاریخچه‌ی خودش را محلی نگه می‌دارد." }] }, "2026-10-21T09:56:30.000Z"),
].join("\n"));
fs.writeFileSync(path.join(home, ".codex", "session_index.jsonl"), `${JSON.stringify({ id: codexId, thread_name: "تاریخچه بین codex و cli", updated_at: "2026-10-21T09:55:49.634Z" })}\n`);

const zcodeId = "sess_ec916c64-c84f-4095-a801-59d852d4fb81";
const zcodeFile = path.join(home, ".zcode", "cli", "rollout", `model-io-${zcodeId}.jsonl`);
fs.mkdirSync(path.dirname(zcodeFile), { recursive: true });
const zcodeLine = (extra) => JSON.stringify({ type: "model_io", sessionId: zcodeId, startedAt: "2026-10-22T05:31:30.000Z", completedAt: "2026-10-22T05:31:35.630Z", model: { modelId: "GLM-5.3-Flash", providerId: "zai-api" }, ...extra });
fs.writeFileSync(zcodeFile, [
  zcodeLine({
    request: { messages: [
      { role: "user", content: "<system-reminder>As you answer the user's questions…</system-reminder>" },
      { role: "user", content: "memory و context بین codex و cli اشتراک داره؟" },
    ] },
    error: { name: "TerminalStreamChunkError", message: "Insufficient balance or no resource package." },
  }),
  zcodeLine({
    startedAt: "2026-10-22T05:33:19.917Z",
    completedAt: "2026-10-22T05:33:44.972Z",
    request: { messages: [] },
    response: { finishReason: "stop", text: "نه — تاریخچه سمت کلاینت ذخیره می‌شود.", usage: { inputTokens: 23698, outputTokens: 3151, totalTokens: 26849 } },
  }),
].join("\n"));

// ---------- sources + list
const sources = historySources(home);
assert.deepEqual(sources.map((s) => s.id), ["codex", "zcode"]);
assert.ok(sources.every((s) => s.available), "both fixture dirs detected as available");

const rows = listHistory({ home, limit: 10 });
assert.equal(rows.length, 2);
assert.equal(rows[0].source, "zcode", "newest session sorts first");
assert.equal(rows[0].n, 1);
assert.equal(rows[0].title, "memory و context بین codex و cli اشتراک داره؟", "zcode title comes from the first real user delta");
assert.equal(rows[0].model, "GLM-5.3-Flash");
assert.equal(rows[1].source, "codex");
assert.equal(rows[1].title, "تاریخچه بین codex و cli", "codex title comes from session_index.jsonl");
assert.equal(rows[1].cwd, "D:\\Projects\\Agentic");
console.log("PASS: list merges both sources, newest first, with real titles");

const listed = renderHistoryList(rows, { sources });
assert.ok(listed.includes("local transcripts"), "list explains where transcripts live");
assert.ok(listed.includes("1  "), "list shows reference numbers");
console.log("PASS: list renders with numbers and source paths");

// ---------- codex transcript
const codexT = await readTranscript({ source: "codex", file: codexFile });
assert.deepEqual(codexT.messages.map((m) => m.role), ["user", "assistant"], "synthetic and developer messages filtered");
assert.equal(codexT.messages[0].text, "حافظه و تاریخچه بین codex و cli مشترکه؟");
assert.equal(codexT.cwd, "D:\\Projects\\Agentic");
const codexRender = renderTranscript(codexT, { width: 90 });
assert.ok(codexRender.includes("SESSION codex"), "transcript header names the source");
assert.ok(codexRender.includes("you") && codexRender.includes("agent"), "speaker labels present");
console.log("PASS: codex transcript keeps the real conversation and drops the wrappers");

// ---------- zcode transcript
const zcodeT = await readTranscript({ source: "zcode", file: zcodeFile });
assert.deepEqual(zcodeT.messages.map((m) => m.role), ["user", "system", "assistant"], "user delta, then the error, then the reply");
assert.equal(zcodeT.messages[0].text, "memory و context بین codex و cli اشتراک داره؟");
assert.ok(zcodeT.messages[1].text.includes("Insufficient balance"), "provider errors are recorded honestly");
assert.equal(zcodeT.messages[2].tokens, "23698→3151", "token usage rides along with assistant turns");
assert.equal(zcodeT.model, "GLM-5.3-Flash");
console.log("PASS: zcode transcript reconstructs turns from the model-io deltas");

// ---------- reference resolution
assert.equal(resolveHistoryRef(rows, "latest").source, "zcode");
assert.equal(resolveHistoryRef(rows, "2").source, "codex");
assert.equal(resolveHistoryRef(rows, "ec916c64").source, "zcode", "id prefixes resolve");
assert.throws(() => resolveHistoryRef(rows, "99"), /no session number 99/);
assert.throws(() => resolveHistoryRef(rows, "nope"), /no session matches/);
assert.throws(() => resolveHistoryRef([], "latest"), /no sessions found/);
console.log("PASS: references resolve by number, id prefix, and latest");

// ---------- CLI smoke: the command needs no project scaffold, any cwd works
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "runtime", "atl-manager.mjs");
const project = fs.mkdtempSync(path.join(os.tmpdir(), "atl-history-project-"));
const out = execFileSync(process.execPath, [cli, "history", "--n", "5"], { cwd: project, encoding: "utf8" });
assert.ok(out.includes("Agent chat history"), "atl history runs scaffold-free and prints the list");
const bad = (() => {
  try {
    execFileSync(process.execPath, [cli, "history", "show", "definitely-not-a-session"], { cwd: project, encoding: "utf8" });
    return null;
  } catch (e) {
    return e;
  }
})();
assert.ok(bad, "unknown show reference exits non-zero");
assert.ok(String(bad.stderr).includes("error:"), "the failure names itself as an error");
console.log("PASS: atl history CLI lists and refuses unknown references");

console.log("ALL OK: history viewer");
