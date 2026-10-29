import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { needsUiReview, probeUiReviewRuntime, uiReviewPrompt, uiReviewProviderArgs, UI_BROWSER_TOOLS } from "../runtime/lib/ui-review-runtime.mjs";
import { buildInvocation } from "../runtime/lib/worker.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-browser-tools-"));
const task = { id: "T-022", title: "Bidi", objective: "Local regression", completion_checks: ["rendered Persian log inspection"], selected_skills: [] };
for (const role of ["rowan", "sage", "beacon"]) assert.equal(needsUiReview(task, role), true);
assert.equal(needsUiReview(task, "pip"), false);
assert.equal(needsUiReview({ completion_checks: ["node unit_test.mjs"] }, "rowan"), false);
assert.equal(needsUiReview({ integrated_delivery: true }, "beacon"), true);
let child;
try {
  fs.mkdirSync(path.join(root, "runtime"));
  for (const name of ["control-plane.html", "control-plane-client.js", "control-plane-i18n.js", "control-plane-changes.js"]) fs.copyFileSync(path.join(project, "runtime", name), path.join(root, "runtime", name));
  const runtime = probeUiReviewRuntime(project, root);
  assert.equal(runtime.available, true, runtime.reason);
  runtime.localToolsApproved = false; // This branch tests unapproved tools independently of live project settings.
  runtime.prompt = uiReviewPrompt(runtime);
  assert.match(runtime.prompt, /not a visual PASS/);
  for (const worker of ["gapgpt", "codex", "claude"]) {
    const invocation = buildInvocation(worker, { root, workspace: root, role: "rowan", task, uiReviewRuntime: runtime });
    assert.ok(invocation.args.some((arg) => arg.includes("atl_browser")), `${worker} gets actual MCP configuration`);
    assert.match(invocation.prompt, /browser_screenshot/);
    assert.ok(!invocation.args.some((arg) => /approval_mode|dangerously/.test(arg)), "host approval policy is preserved");
  }
  assert.throws(() => uiReviewProviderArgs("custom", runtime), /not configured/);
  const authorizedConfig = uiReviewProviderArgs("gapgpt", { ...runtime, localToolsApproved: true }).join(" ");
  for (const name of UI_BROWSER_TOOLS) assert.ok(authorizedConfig.includes(`${name}={approval_mode="approve"}`));
  assert.doesNotMatch(authorizedConfig, /default_tools_approval_mode|approval_policy/);
  const pending = new Map(); let seq = 0; let diagnostic = "";
  child = spawn(process.execPath, [fileURLToPath(new URL("../runtime/lib/ui-review-mcp.mjs", import.meta.url)), project, root], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stderr.on("data", (chunk) => { diagnostic += chunk; });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const response = JSON.parse(line); pending.get(response.id)?.(response); pending.delete(response.id);
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}: ${diagnostic}`)); }, 20000);
    pending.set(id, (response) => { clearTimeout(timer); response.error ? reject(new Error(response.error.message)) : resolve(response.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const call = (name, args = {}) => request("tools/call", { name, arguments: args });
  const initialized = await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "atl-test", version: "1" } });
  assert.equal(initialized.serverInfo.name, "atl-browser");
  assert.deepEqual((await request("tools/list")).tools.map((tool) => tool.name), UI_BROWSER_TOOLS);
  const preview = await call("browser_preview");
  assert.ok(!preview.isError, JSON.stringify(preview));
  assert.match(preview.content[0].text, /گزارش در مسیر/);
  const action = await call("browser_action", { action: "click", selector: "#localeBtn" });
  // Selector is discovered from source only for this automated regression;
  // model sessions must discover it from browser_snapshot.
  assert.ok(!action.isError, JSON.stringify(action));
  const inspected = await call("browser_inspect", { selector: ".event" });
  assert.ok(!inspected.isError, JSON.stringify(inspected));
  const nodes = JSON.parse(inspected.content[0].text).nodes;
  assert.ok(nodes.some((node) => node.text.includes("D:/Projects/Agentic/evidence/check.json")), JSON.stringify(nodes));
  const capture = await call("browser_screenshot");
  assert.ok(!capture.isError, JSON.stringify(capture));
  assert.equal(capture.content[1].type, "image", "model receives an image, not just a path");
  const receipt = JSON.parse(capture.content[0].text);
  assert.equal(receipt.result, "NOT OBSERVED", "capture cannot invent a model verdict");
  assert.equal(receipt.synthetic, true);
  assert.ok(fs.statSync(receipt.screenshot).size > 1000);
  assert.equal(receipt.locale.dir, "rtl");
  assert.ok(receipt.assets["control-plane-client.js"]);
  assert.equal(fs.existsSync(path.join(root, ".trust/manager/state.json")), false, "browser cannot mutate live manager state");
  assert.equal((await call("browser_viewport", { width: 1, height: 800 })).isError, true);
  assert.equal((await call("browser_action", { action: "evaluate", selector: "body" })).isError, true);
  fs.appendFileSync(path.join(root, "runtime/control-plane-client.js"), "\n// source changed after page load\n");
  const stale = await call("browser_screenshot");
  assert.equal(stale.isError, true, "old rendered pages cannot be attributed to new source");
  assert.match(stale.content[0].text, /browser_reload/);
  const exit = new Promise((resolve) => child.once("exit", resolve));
  child.stdin.end();
  assert.equal(await exit, 0, diagnostic);
  console.log("PASS: worker MCP injection across providers/roles; real browser handshake, Persian fixture, image + hashed evidence, preserved policy and cleanup");
} finally {
  if (child?.exitCode === null) child.kill();
  fs.rmSync(root, { recursive: true, force: true });
}
