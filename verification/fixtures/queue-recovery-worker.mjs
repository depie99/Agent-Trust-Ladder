// Deterministic local provider fixture. Real child processes and real gates;
// assertions represent the work an actual role must observe before advancing.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadState, saveState, transition, addEvidence } from "../../runtime/lib/state.mjs";
import { snapshot } from "../../runtime/lib/handoffs.mjs";
import { repairContract } from "../../runtime/lib/queue-recovery.mjs";

const [root, id, role] = process.argv.slice(2);
let state = loadState(root); let task = state.tasks[id];
const workspace = task.workspace;
if (role === "pip") {
  repairContract(root, id, {
    check_owners: Object.fromEntries(task.completion_checks.map((check) => [check, id])),
    dispatch_contract: { ...task.dispatch_contract, commands: [[process.execPath, "-e", `require('node:fs').accessSync('${id === "T-001" ? "client.html" : "catalog.json"}')`]] },
  }, { objective: task.objective, budgetApproved: true, evidence: "Observed catalog.json is the upstream artifact; the old verifier incorrectly assumed products.json. Ownership applies to this stage's checks only." });
  process.exit(0);
}
if (role === "rowan") {
  if (id === "T-001" && !task.pip_repair) {
    task.blocker = { reason: "contract conflict: downstream stage owns the filter check; keep this stage's catalog check and record its owner", actor: "rowan" };
    transition(state, id, "blocked", { actor: "rowan", note: task.blocker.reason });
    saveState(root, state); process.exit(0);
  }
  if (task.status === "assigned") transition(state, id, "in_progress", { actor: "rowan", note: "fixture implementation" });
  if (task.labels?.includes("independent")) {
    fs.writeFileSync(path.join(workspace, "independent.txt"), "independent output preserved");
  } else if (id === "T-001") {
    fs.writeFileSync(path.join(workspace, "catalog.json"), JSON.stringify(["Apple", "Pear"]));
    fs.writeFileSync(path.join(workspace, "client.html"), '<button id="old" onclick="this.textContent=\'Preserved\'">Original</button><input id="search"><div id="results">Apple Pear</div>');
  } else {
    assert.ok(fs.existsSync(path.join(workspace, "catalog.json")), "supervisor supplied missing catalog");
    assert.ok(fs.existsSync(path.join(workspace, ".atl-inputs", "T-001", "files", "client.html")), "overlap inputs are inside the worker workspace");
    const previous = fs.readFileSync(path.join(workspace, ".atl-inputs", "T-001", "files", "client.html"), "utf8");
    fs.writeFileSync(path.join(workspace, "client.html"), previous + '<button id="filter" onclick="document.querySelector(\'#results\').textContent=\'Apple\'">Filter</button><script>document.querySelector("#search").oninput=e=>document.querySelector("#results").textContent=["Apple","Pear"].filter(x=>x.toLowerCase().includes(e.target.value.toLowerCase())).join(" ")</script>');
  }
  const revision = snapshot(root, workspace).revision;
  for (const check of task.completion_checks) addEvidence(state, id, { kind: "check", check, result: "pass", coverage: "complete", code_revision: revision, command: "fixture source assertions", exit_code: 0 }, "rowan");
  transition(state, id, "in_review", { actor: "rowan", note: "implementation ready" });
} else if (role === "sage") {
  assert.match(fs.readFileSync(path.join(workspace, "client.html"), "utf8"), /id="old"/);
  addEvidence(state, id, { kind: "review", result: "approve", detail: "Original behavior preserved in composed source", code_revision: snapshot(root, workspace).revision }, "sage");
  transition(state, id, "verifying", { actor: "sage", note: "independent review complete" });
} else if (role === "beacon") {
  const revision = snapshot(root, workspace).revision;
  if (task.integrated_delivery) {
    assert.equal(fs.readFileSync(path.join(workspace, "independent.txt"), "utf8"), "independent output preserved");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(new URL(`file:///${workspace.replace(/\\/g, "/")}/client.html`).href);
      await page.locator("#old").click(); assert.equal(await page.locator("#old").textContent(), "Preserved");
      await page.locator("#search").fill("pear"); assert.equal(await page.locator("#results").textContent(), "Pear");
      await page.locator("#filter").click(); assert.equal(await page.locator("#results").textContent(), "Apple");
      for (const check of task.integrated_checks) addEvidence(state, id, { kind: "check", check, result: "pass", coverage: "complete", code_revision: revision, command: "Playwright original/search/filter journey", exit_code: 0 }, "beacon");
      addEvidence(state, id, { kind: "browser-journey", result: "pass", coverage: "complete", code_revision: revision, detail: "Original interaction, catalog search and client filter observed in one composed browser journey" }, "beacon");
    } finally { await browser.close(); }
  }
  transition(state, id, "done", { actor: "beacon", note: "observed verification complete" });
}
saveState(root, state);
