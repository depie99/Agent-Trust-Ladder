// Usage telemetry: persistence with source/freshness, local budget math,
// warning thresholds, explicit unknown limits, verified-only remote adapters,
// the provider-action gate, and threshold notifications.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { checkUsageThresholds, latestUsage, loadUsage, localBudgetUsage, providerUsageAdapter, recordRemoteUsage, recordUsage, usageFreshness, usageGate, usageRisk } from "../runtime/lib/usage.mjs";
import { listNotifications } from "../runtime/lib/notifications.mjs";

const local = localBudgetUsage({ sessions: 4, maxSessions: 5, elapsedMs: 30 * 60000, maxMinutes: 60 });
assert.equal(local.sessionsRemaining, 1, "local session budget reports remaining sessions");
assert.equal(local.minutesRemaining, 30, "local time budget reports remaining minutes");
assert.equal(usageRisk({ used: 4, limit: 5 }).status, "warning", "near exhaustion is a warning");
assert.equal(usageRisk({ used: 5, limit: 5 }).status, "exhausted", "full budget is exhausted");
assert.equal(usageRisk({ used: 1, limit: null }).status, "unknown", "unknown limits are never presented as available");

// Persistence: snapshots keep source/status/confidence and round-trip.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-usage-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());
recordUsage(root, {
  provider: "codex", model: "glm-5.3", source: "atl-session", status: "observed", confidence: "high",
  used: { sessions: 1, elapsed_ms: 42000 }, remaining: null,
  detail: "local session observed; remote provider quota is not exposed by this adapter",
});
const persisted = loadUsage(root);
assert.equal(persisted.snapshots.length, 1);
assert.equal(persisted.snapshots[0].source, "atl-session");
assert.equal(persisted.snapshots[0].confidence, "high");
assert.equal(persisted.snapshots[0].remaining, null);
assert.ok(persisted.snapshots[0].captured_at, "captured_at supplies freshness");
assert.equal(latestUsage(root, { provider: "codex" }).model, "glm-5.3", "latest filters by provider");
assert.equal(latestUsage(root, { provider: "claude" }), null);

// Freshness: recent is fresh, old is stale, absent is explicit.
const freshNow = usageFreshness(persisted.snapshots[0]);
assert.equal(freshNow.fresh, true);
const stale = usageFreshness({ captured_at: new Date(Date.now() - 90 * 60000).toISOString() }, { maxAgeMs: 60000 });
assert.equal(stale.fresh, false);
assert.match(stale.label, /stale/);
assert.equal(usageFreshness(null).label, "never captured");

// Remote adapter: only verified results may produce a remaining number.
await recordRemoteUsage(root, {
  provider: "codex", adapter: async () => ({ verified: true, remaining: 42000, reset_at: "2026-10-23T00:00:00.000Z", detail: "provider dashboard" }),
});
const verified = latestUsage(root, { provider: "codex", model: null });
assert.equal(verified.source, "provider-adapter");
assert.equal(verified.confidence, "verified");
assert.equal(verified.remaining, 42000, "adapter-verified remaining is recorded");
await recordRemoteUsage(root, { provider: "codex", adapter: async () => ({ remaining: 100 }) });
assert.equal(latestUsage(root, { provider: "codex" }).remaining, null, "an unverified payload never produces a number");
assert.equal(latestUsage(root, { provider: "codex" }).status, "unknown");
await recordRemoteUsage(root, { provider: "codex", adapter: async () => { throw new Error("401 unauthorized"); } });
const failed = latestUsage(root, { provider: "codex" });
assert.equal(failed.status, "unknown", "a failed adapter records explicit unknown");
assert.match(failed.detail, /401 unauthorized/);
await assert.rejects(() => recordRemoteUsage(root, { adapter: "not-a-function" }), /adapter function/);

// Concrete provider adapter: supported provider responses become verified
// snapshots; a protocol-compatible but unsupported provider remains unknown.
let probeRequest = null;
const openRouter = { id: "openrouter", base_url: "https://openrouter.ai/api/v1", api_key: "test-key", model: "test-model" };
await recordRemoteUsage(root, {
  provider: openRouter.id, model: openRouter.model,
  adapter: providerUsageAdapter(openRouter, { fetchImpl: async (url, options) => {
    probeRequest = { url, options };
    return { ok: true, json: async () => ({ data: { limit: 20, usage: 7, limit_reset: "2026-10-24T00:00:00.000Z" } }) };
  } }),
});
assert.equal(probeRequest.url, "https://openrouter.ai/api/v1/auth/key", "OpenRouter telemetry uses its authenticated key endpoint");
assert.equal(probeRequest.options.headers.Authorization, "Bearer test-key", "provider key is sent only to the provider request");
assert.equal(latestUsage(root, { provider: "openrouter" }).remaining, 13, "verified provider usage computes remaining capacity from provider facts");
const unsupported = await providerUsageAdapter({ id: "zai", base_url: "https://api.z.ai", api_key: "test-key" })();
assert.equal(unsupported.verified, false, "unsupported providers cannot manufacture a quota");

// Gate: exhausted local budgets refuse provider work; unknown remote never does.
assert.equal(usageGate({ sessions: 5, maxSessions: 5 }).ok, false);
assert.match(usageGate({ sessions: 5, maxSessions: 5 }).reason, /exhausted/);
assert.equal(usageGate({ sessions: 1, maxSessions: 5, elapsedMs: 10 * 60000, maxMinutes: 60 }).ok, true);
assert.equal(usageGate({ sessions: 1, maxSessions: null }).ok, true, "an unknown remote limit never blocks");
assert.equal(usageGate({ sessions: 4, maxSessions: 5 }).reason, "warning: budget is near exhaustion");

// Threshold notifications: warning/danger posted, deduped, unknown silent.
listNotifications(root).length && (() => { throw new Error("a fresh project starts quiet"); })();
assert.equal(checkUsageThresholds(root, { sessions: 1, maxSessions: 5, elapsedMs: 5 * 60000, maxMinutes: 60 }), null, "healthy budgets post nothing");
const warned = checkUsageThresholds(root, { sessions: 4, maxSessions: 5, elapsedMs: 10 * 60000, maxMinutes: 60 });
assert.equal(warned.severity, "warning", "near exhaustion posts a warning");
checkUsageThresholds(root, { sessions: 4, maxSessions: 5, elapsedMs: 10 * 60000, maxMinutes: 60 });
assert.equal(listNotifications(root, { severity: "warning" }).length, 1, "repeat warnings dedupe");
const exhausted = checkUsageThresholds(root, { sessions: 5, maxSessions: 5, elapsedMs: 61 * 60000, maxMinutes: 60 });
assert.equal(exhausted.severity, "danger", "exhaustion posts danger");
assert.equal(checkUsageThresholds(root, { sessions: 1, maxSessions: null }), null, "unknown limits never notify");

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: usage telemetry — persistence with freshness, verified-only remote adapters, gate, threshold notifications");
