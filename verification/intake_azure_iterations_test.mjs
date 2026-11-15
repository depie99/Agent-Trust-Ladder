import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// Sprint combobox feed: GET /api/intake/azure/iterations flattens the saved
// connection's iteration tree (names + paths + dates, no credentials) and
// fails with an actionable message when Azure is not connected.
const savedPat = process.env.AZDO_PAT;
process.env.AZDO_PAT = "synthetic-iterations-token";
const tree = {
  id: 1, name: "Alpha", hasChildren: true, children: [
    { id: 2, name: "Sprint 73", hasChildren: false, attributes: { startDate: "2026-10-30Z", finishDate: "2026-11-13Z" } },
    { id: 3, name: "Sprint 74", hasChildren: true, attributes: { startDate: "2026-11-13Z", finishDate: "2026-11-27Z" }, children: [
      { id: 4, name: "Sprint 74 Buffer", hasChildren: false, attributes: {} },
    ] },
  ],
};
const azureFetch = async (url) => {
  assert.ok(!String(url).includes("synthetic-iterations-token"), "token never travels in the URL");
  if (url.includes("classificationnodes/iterations")) return { ok: true, status: 200, json: async () => tree };
  throw new Error(`unexpected iteration call ${url}`);
};
const gatedAzureFetch = async (url) => {
  // Organizations that gate classificationnodes: first call 404s, the
  // teamsettings fallback answers with the default team's iterations.
  if (url.includes("classificationnodes/iterations")) return { ok: false, status: 404, json: async () => ({ message: "not found" }) };
  if (url.includes("teamsettings/iterations")) return { ok: true, status: 200, json: async () => ({ value: [{ name: "Sprint 74", path: "Alpha\\Sprint 74", attributes: { finishDate: "2026-11-27Z" } }] }) };
  throw new Error(`unexpected iteration call ${url}`);
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-azure-iterations-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
let running;
try {
  // NOTE: running.url carries a trailing slash — normalize before concatenating.
  const baseUrl = () => running.url.replace(/\/$/, "");
  // Not connected yet: no config, no token → actionable failure, not a crash.
  fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));
  running = await startControlPlaneServer(root, { azureFetch });
  const missing = await fetch(`${baseUrl()}/api/intake/azure/iterations`);
  const missingBody = await missing.json();
  assert.equal(missing.status, 400);
  assert.match(missingBody.error, /Save the Azure collection and project first/);

  fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { enabled: true, org_url: "https://devops.example.invalid/Collection", project: "Alpha", token_env: "AZDO_PAT" } } }));
  const response = await fetch(`${baseUrl()}/api/intake/azure/iterations`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.iterations.map((it) => it.path), ["Alpha\\Sprint 73", "Alpha\\Sprint 74", "Alpha\\Sprint 74\\Sprint 74 Buffer"]);
  assert.equal(body.iterations[0].finish, "2026-11-13Z");
  assert.equal(body.iterations[1].finish, "2026-11-27Z");
  console.log("PASS: Azure sprint combobox feed flattens the iteration tree and fails actionably when unconnected");

  // Fallback: gated classificationnodes falls back to teamsettings iterations.
  fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { enabled: true, org_url: "https://devops.example.invalid/Collection", project: "Alpha", token_env: "AZDO_PAT" } } }));
  running.server.closeAllConnections?.();
  await new Promise((resolve) => running.server.close(resolve));
  const gated = await startControlPlaneServer(root, { azureFetch: gatedAzureFetch });
  try {
    const fallbackResponse = await fetch(`${baseUrl2(gated)}/api/intake/azure/iterations`);
    const fallbackBody = await fallbackResponse.json();
    assert.deepEqual(fallbackBody.iterations.map((it) => it.path), ["Alpha\\Sprint 74"], "teamsettings fallback flattens correctly");
    console.log("PASS: gated classificationnodes falls back to teamsettings iterations");
  } finally { await new Promise((resolve) => gated.server.close(resolve)); }
  function baseUrl2(server) { return server.url.replace(/\/$/, ""); }
} finally {
  if (savedPat === undefined) delete process.env.AZDO_PAT; else process.env.AZDO_PAT = savedPat;
  if (running) { running.server.closeAllConnections?.(); await new Promise((resolve) => running.server.close(resolve)); }
  fs.rmSync(root, { recursive: true, force: true });
}
