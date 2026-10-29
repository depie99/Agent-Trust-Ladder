import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startUiReviewPreview } from "../runtime/lib/ui-review-preview.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-ui-preview-"));
let running;
try {
  fs.mkdirSync(path.join(root, "runtime"));
  for (const name of ["control-plane.html", "control-plane-client.js", "control-plane-i18n.js", "control-plane-changes.js"]) fs.copyFileSync(fileURLToPath(new URL(`../runtime/${name}`, import.meta.url)), path.join(root, "runtime", name));
  running = await startUiReviewPreview(root);
  const response = await fetch(`${running.url}api/snapshot`);
  assert.equal(response.status, 200, "empty task workspace receives valid isolated preview state");
  const snapshot = await response.json();
  assert.ok(JSON.stringify(snapshot).includes(running.sentence), "UTF-8 sample reaches the actual snapshot consumer");
  const client = await fetch(`${running.url}control-plane-client.js`).then((res) => res.text());
  assert.equal(client, fs.readFileSync(path.join(root, "runtime/control-plane-client.js"), "utf8"));
  assert.equal(fs.existsSync(path.join(root, ".trust/manager/state.json")), false, "task shared manager state is never initialized");
  const denied = await fetch(`${running.url}api/assistant`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "send", scope: "global", message: "launch" }) });
  assert.equal(denied.status, 403, "rendering fixture cannot launch a provider or mutate manager state");
  console.log("PASS: isolated UTF-8 task preview, matching assets, no live-state initialization and denied mutations");
} finally {
  if (running) await new Promise((resolve) => running.server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
