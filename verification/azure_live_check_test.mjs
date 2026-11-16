import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readAzureConfig, redactItem, runAzureLiveCheck, renderLiveCheckMarkdown } from "../scripts/atl-azure-live-check.mjs";

const fixture = (id, revision, title) => ({
  id,
  fields: {
    "System.Id": id,
    "System.Rev": revision,
    "System.Title": title,
    "System.State": "Active",
    "System.WorkItemType": "Bug",
    "System.Description": "Internal reproduction steps that must never be copied into the redacted evidence.",
  },
});

function fakeAzure(items) {
  const calls = [];
  const requestImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    if (/\/workitems\/\d+\?/.test(url)) return items.find((item) => String(item.id) === url.match(/\/workitems\/(\d+)\?/)[1]) || null;
    if (url.includes("/wiql")) return { workItems: items.map((item) => ({ id: item.id })) };
    if (url.includes("/workitemsbatch")) return { value: items };
    throw new Error(`unexpected Azure call: ${url}`);
  };
  return { requestImpl, calls };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-azure-live-check-"));
const previousToken = process.env.AZDO_PAT;
try {
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({
    intake: { azure: { org_url: "https://devops.example.invalid:32678/example-org", project: "example-project", iteration_path: "example-project\\Sprint 73", token_env: "AZDO_PAT", tls_allow_untrusted: true } },
  }));
  const cfg = readAzureConfig(root);
  assert.equal(cfg.project, "example-project");
  assert.deepEqual(readAzureConfig(root, { types: ["Feature"] }).types, ["Feature"], "explicit work item types can include Azure Features");
  assert.equal(cfg.tls_allow_untrusted, true);
  assert.equal(readAzureConfig(root, { iteration_path: "example-project\\Sprint 74" }).iteration_path, "example-project\\Sprint 74", "an explicit override wins over stored config");
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "atl-azure-live-bare-"));
  try {
    assert.throws(() => readAzureConfig(bare), /collection URL/, "a project without Azure settings reports the missing collection instead of guessing");
  } finally {
    fs.rmSync(bare, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  delete process.env.AZDO_PAT;
  await assert.rejects(
    runAzureLiveCheck({ cfg, env: {}, root }),
    (error) => error.code === "ATL_AZURE_TOKEN_MISSING" && error.gate === "open",
    "an absent credential is reported as an open gate, never as a pass",
  );

  process.env.AZDO_PAT = "synthetic-token";
  const healthy = fakeAzure([fixture(741, 3, "Broken middleware retry")]);
  const record = await runAzureLiveCheck({
    cfg,
    env: { AZDO_PAT: "synthetic-token" },
    root,
    itemId: 741,
    requestImpls: { controlPlane: healthy.requestImpl, skillsOnly: healthy.requestImpl },
    now: () => "2026-11-04T00:00:00.000Z",
  });
  assert.equal(record.gate, "passed");
  assert.equal(record.parity.same_identity, true);
  assert.deepEqual(record.item, {
    remote_id: 741,
    revision: 3,
    iteration: "example-project\\Sprint 73",
    intake_key: "azure:https://devops.example.invalid:32678/example-org:example-project:741:3",
    title_sha256: redactItem({ title: "Bug 741: Broken middleware retry" }).title_sha256,
    title_length: 32,
    work_item_type: "Bug 741",
    frozen: false,
  });
  const serialized = JSON.stringify(record) + renderLiveCheckMarkdown(record);
  assert.ok(!serialized.includes("Broken middleware retry"), "the raw work-item title is not reproduced in evidence");
  assert.ok(!serialized.includes("Internal reproduction steps"), "the raw work-item description is not reproduced in evidence");
  assert.match(record.host.remote_mutation, /read-only/);
  assert.ok(healthy.calls.every((call) => /_apis\/wit\//.test(call.url)), "the live check only touches work-item read endpoints");
  assert.equal(healthy.calls.filter((call) => call.method === "POST").length, 0, "single-item checks use only direct GET requests");
  assert.equal(healthy.calls.filter((call) => /workitems\/741\?/.test(call.url)).length, 2, "both entry points directly read the requested item");
  assert.equal(record.item.iteration, "example-project\\Sprint 73", "the live item iteration is reported separately from the configured iteration");

  const drifted = fakeAzure([fixture(741, 4, "Broken middleware retry")]);
  const failed = await runAzureLiveCheck({
    cfg,
    env: { AZDO_PAT: "synthetic-token" },
    root,
    itemId: 741,
    requestImpls: { controlPlane: healthy.requestImpl, skillsOnly: drifted.requestImpl },
    now: () => "2026-11-04T00:00:00.000Z",
  });
  assert.equal(failed.gate, "failed", "revision drift between surfaces cannot be reported as parity");
  assert.equal(failed.parity.differences[0].field, "revision");
  assert.equal(failed.parity.same_identity, false);

  const mixed = fakeAzure([fixture(741, 3, "Broken middleware retry"), fixture(742, 1, "Second item")]);
  const selected = await runAzureLiveCheck({
    cfg,
    env: { AZDO_PAT: "synthetic-token" },
    root,
    itemId: 742,
    requestImpls: { controlPlane: mixed.requestImpl, skillsOnly: mixed.requestImpl },
  });
  assert.equal(selected.item.remote_id, 742);
  assert.equal(selected.surfaces.control_plane.items, 1);
  await assert.rejects(
    runAzureLiveCheck({ cfg, env: { AZDO_PAT: "synthetic-token" }, root, itemId: 999, requestImpls: { controlPlane: mixed.requestImpl, skillsOnly: mixed.requestImpl } }),
    /was not returned by direct read/,
  );
  console.log("azure live check tests passed");
} finally {
  if (previousToken === undefined) delete process.env.AZDO_PAT; else process.env.AZDO_PAT = previousToken;
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
