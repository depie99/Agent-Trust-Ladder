import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { driveTaskUntilGate, requestRunAbort } from "../runtime/lib/launch.mjs";
import { createTask, emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { setVerificationPolicy, setVerifier, testEvidence, verificationArtifact } from "../runtime/lib/test-evidence.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-verification-e2e-"));
const workspace = path.join(root, "workspace");
const evidenceDir = path.resolve(".atl-evidence/workflow-verification");
fs.mkdirSync(path.join(workspace, "verification"), { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });
const state = emptyState();
const task = createTask(state, { title: "Verify the report", completion_checks: ["The report is generated"] });
Object.assign(task, { workspace, status: "verifying", completion_checks: ["The report is generated"] });
setVerifier(task, task.completion_checks[0], "integration", ["verification/report.mjs"]);
const script = path.join(workspace, task.verifiers[0].args[0]);
fs.writeFileSync(script, 'console.error("report missing"); process.exitCode = 1;');
saveState(root, state);
const run = () => driveTaskUntilGate(root, task.id, { maxSessions: 1, deadline: Date.now() + 30000 }, {
  overnight: true, resolveWorker: () => assert.fail("Deterministic checks must not use a model"),
});
let browser;
let server;
try {
  const failure = await run();
  assert.equal(failure.blocker, "verification-required");
  assert.equal(failure.evidence.checks[0].status, "failed");
  const failedAttempt = failure.evidence.checks[0].attempts.at(-1);
  assert.match(verificationArtifact(root, failedAttempt.output_id).toString(), /report missing/);

  const started = await startControlPlaneServer(root);
  server = started.server;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "en-US", colorScheme: "light" });
  page.setDefaultTimeout(8000);
  const openEvidence = async (route = "tasks") => {
    await page.goto(started.url);
    await page.locator(`[data-page="${route}"]:visible`).first().click();
    await page.locator(`[data-task="${task.id}"] .task-main-copy`).click();
    const panel = page.locator("[data-test-evidence]:visible").first();
    await panel.waitFor();
    await panel.locator("summary").first().click();
    return panel;
  };
  let panel = await openEvidence();
  await panel.locator('[data-test-status="failed"]').waitFor({ timeout: 5000 });
  await panel.screenshot({ path: path.join(evidenceDir, "before.png") });

  fs.writeFileSync(script, 'console.log("report generated");');
  assert.equal(testEvidence(loadState(root).tasks[task.id], "changed-source").checks[0].status, "stale");
  const success = await run();
  assert.equal(success.status, "done");
  assert.equal(success.evidence.verified, true);
  assert.equal(success.evidence.checks[0].attempts.length, 2);
  panel = await openEvidence("shipped");
  await panel.locator('[data-test-status="passed"]').waitFor({ timeout: 5000 });
  await panel.screenshot({ path: path.join(evidenceDir, "after.png") });
  const output = await panel.getByRole("link", { name: "Test output" }).first().getAttribute("href");
  assert.match(await (await page.request.get(new URL(output, started.url).href)).text(), /report generated/);
  panel = page.locator("[data-test-evidence]:visible").first();
  fs.writeFileSync(script, 'console.log("different source");');
  await panel.locator("[data-refresh-test-evidence]").click();
  await panel.locator('[data-test-status="stale"]').waitFor();
  const policyResponse = await panel.locator("select").selectOption("allow");
  assert.deepEqual(policyResponse, ["allow"]);
  await panel.getByText("Saved", { exact: true }).waitFor();
  assert.equal(loadState(root).tasks[task.id].verification_policy, "allow");

  const next = loadState(root);
  setVerificationPolicy(next, null, "allow");
  setVerificationPolicy(next, next.tasks[task.id], "inherit");
  Object.assign(next.tasks[task.id], { status: "verifying", run_verification_policy: null });
  saveState(root, next);
  fs.writeFileSync(script, 'process.exitCode = 1;');
  const allowed = await run();
  assert.equal(allowed.status, "done");
  assert.equal(allowed.evidence.verified, false);
  assert.equal(allowed.evidence.policy, "allow");
  const visualState = loadState(root);
  const visual = createTask(visualState, { title: "Verify a browser interaction" });
  Object.assign(visual, { workspace, status: "verifying", completion_checks: ["Click updates the page"] });
  setVerifier(visual, visual.completion_checks[0], "browser", ["verification/visual.mjs"]);
  fs.writeFileSync(path.join(workspace, "verification/visual.mjs"), `
    import assert from "node:assert/strict";
    import path from "node:path";
    import { chromium } from ${JSON.stringify(import.meta.resolve("playwright"))};
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 }, locale: "en-US" });
      await page.setContent(${JSON.stringify('<button onclick="this.textContent=&quot;Done&quot;">Start</button>')});
      await page.screenshot({ path: path.join(process.env.ATL_TEST_EVIDENCE_DIR, "before.png") });
      await page.getByRole("button", { name: "Start" }).click();
      assert.equal(await page.getByRole("button").textContent(), "Done");
      await page.screenshot({ path: path.join(process.env.ATL_TEST_EVIDENCE_DIR, "after.png") });
    } finally { await browser.close(); }
  `);
  saveState(root, visualState);
  const visualOutcome = await driveTaskUntilGate(root, visual.id, { maxSessions: 1, deadline: Date.now() + 30000 }, {
    overnight: true, resolveWorker: () => assert.fail("Browser tests must not use a model"),
  });
  assert.equal(visualOutcome.evidence.verified, true, JSON.stringify(visualOutcome.evidence));
  const visualAttempt = visualOutcome.evidence.checks[0].attempts.at(-1);
  assert.deepEqual(visualAttempt.screenshots, ["before.png", "after.png"]);
  for (const name of visualAttempt.screenshots) {
    const result = await page.request.get(new URL(`/api/test-evidence?id=${visualAttempt.output_id}&file=${name}`, started.url).href);
    assert.equal(result.status(), 200);
    assert.equal(result.headers()["content-type"], "image/png");
    fs.writeFileSync(path.join(evidenceDir, `browser-${name}`), await result.body());
  }
  const cancelledState = loadState(root);
  const cancelled = cancelledState.tasks[visual.id];
  cancelled.status = "verifying";
  saveState(root, cancelledState);
  fs.writeFileSync(path.join(workspace, "verification/visual.mjs"), 'setTimeout(() => {}, 20000);');
  const stopping = driveTaskUntilGate(root, visual.id, { maxSessions: 1, deadline: Date.now() + 30000 }, {
    overnight: true, resolveWorker: () => assert.fail("Cancelled deterministic checks must not use a model"),
  });
  setTimeout(requestRunAbort, 500);
  const stopped = await stopping;
  assert.equal(stopped.aborted, true);
  assert.equal(stopped.evidence.checks[0].status, "skipped");
  assert.equal(stopped.evidence.checks[0].attempts.length, 2);
  const passedAttempt = success.evidence.checks[0].attempts.at(-1);
  fs.writeFileSync(path.join(evidenceDir, "before.txt"), verificationArtifact(root, failedAttempt.output_id));
  fs.writeFileSync(path.join(evidenceDir, "after.txt"), verificationArtifact(root, passedAttempt.output_id));
  fs.writeFileSync(path.join(evidenceDir, "results.json"), JSON.stringify({ failure, success, allowed, visualOutcome, stopped }, null, 2));
  fs.writeFileSync(path.join(evidenceDir, "index.html"), `<!doctype html><html lang="en">
    <meta charset="utf-8"><title>ATL workflow verification evidence</title>
    <style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:0 1rem}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem}img{width:100%}code{overflow-wrap:anywhere}</style>
    <h1>ATL workflow verification evidence</h1>
    <p>Playwright fixture at 1440 by 1000, light browser color scheme, en-US locale.</p>
    <p>Run <code>node verification/workflow_verification_e2e_test.mjs</code> to replay.
    The task verifier runs <code>node verification/report.mjs</code> inside its fixture workspace.</p>
    <main><section><h2>Before repair</h2><p>Failed check, exit 1. Completion blocked.</p>
    <p>Revision <code>${failedAttempt.code_revision}</code> · <a href="before.txt">Verifier output</a></p>
    <img src="before.png" alt="Test Evidence panel showing the failed check"></section>
    <section><h2>After repair</h2><p>Passing check, exit 0. Completion verified.</p>
    <p>Revision <code>${passedAttempt.code_revision}</code> · <a href="after.txt">Verifier output</a></p>
    <img src="after.png" alt="Test Evidence panel showing the passing check and prior attempt"></section></main>
    <h2>Browser verifier artifacts</h2><main><img src="browser-before.png" alt="Start button before click">
    <img src="browser-after.png" alt="Done button after click"></main>
    <p><a href="results.json">Recorded results including allow-with-gaps</a></p></html>`);
  console.log(`PASS: zero-model verification, block/allow policies, stale evidence, retained attempts, Playwright inspection, output links, screenshots in ${evidenceDir}`);
} finally {
  await browser?.close();
  server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
