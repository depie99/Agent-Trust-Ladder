import fs from "node:fs";
import path from "node:path";
import { paths } from "./state.mjs";
import { postNotification } from "./notifications.mjs";

export const USAGE_VERSION = 1;

function fileFor(root) {
  return paths(root).usage;
}

function normalize(snapshot) {
  return {
    version: USAGE_VERSION,
    captured_at: snapshot.captured_at || new Date().toISOString(),
    provider: snapshot.provider || null,
    model: snapshot.model || null,
    source: snapshot.source || "unknown",
    status: snapshot.status || "unknown",
    confidence: snapshot.confidence || "low",
    window: snapshot.window || null,
    used: snapshot.used ?? null,
    remaining: snapshot.remaining ?? null,
    reset_at: snapshot.reset_at || null,
    detail: snapshot.detail || "",
    estimate: snapshot.estimate || null,
  };
}

export function loadUsage(root) {
  const file = fileFor(root);
  if (!fs.existsSync(file)) return { version: USAGE_VERSION, updated_at: null, snapshots: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed.version !== USAGE_VERSION) throw new Error(`Unsupported usage version ${parsed.version}`);
    return { version: USAGE_VERSION, updated_at: parsed.updated_at || null, snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots.map(normalize) : [] };
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
}

export function recordUsage(root, snapshot) {
  const current = loadUsage(root);
  const item = normalize(snapshot);
  current.snapshots = [...current.snapshots, item].slice(-500);
  current.updated_at = new Date().toISOString();
  const file = fileFor(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(current, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return item;
}

export function latestUsage(root, { provider = null, model = null } = {}) {
  const rows = loadUsage(root).snapshots.filter((item) => (!provider || item.provider === provider) && (!model || item.model === model));
  return rows.at(-1) || null;
}

export function localBudgetUsage({ sessions = 0, maxSessions = null, elapsedMs = 0, maxMinutes = null } = {}) {
  return {
    source: "atl-local-budget",
    status: "observed",
    confidence: "high",
    sessions,
    maxSessions,
    sessionsRemaining: maxSessions == null ? null : Math.max(0, maxSessions - sessions),
    elapsedMs,
    maxMinutes,
    minutesRemaining: maxMinutes == null ? null : Math.max(0, maxMinutes - elapsedMs / 60000),
  };
}

export function usageRisk({ used = 0, limit = null, threshold = 0.8 } = {}) {
  const numericUsed = Number(used);
  const numericLimit = Number(limit);
  if (!Number.isFinite(numericUsed) || !Number.isFinite(numericLimit) || numericLimit <= 0) {
    return { status: "unknown", ratio: null, message: "remaining capacity is unknown" };
  }
  const ratio = numericUsed / numericLimit;
  return {
    status: ratio >= 1 ? "exhausted" : ratio >= threshold ? "warning" : "ok",
    ratio,
    message: ratio >= 1 ? "budget exhausted" : ratio >= threshold ? "budget is near exhaustion" : "budget available",
  };
}

// The provider-action gate for Plan Studio and launch. Local budgets are the
// only authoritative limits, so an exhausted local budget blocks provider
// work while an unknown remote quota never does — it must be surfaced, never
// guessed into a number.
export function usageGate({ sessions = 0, maxSessions = null, elapsedMs = 0, maxMinutes = null } = {}) {
  const risks = [
    usageRisk({ used: sessions, limit: maxSessions }),
    usageRisk({ used: elapsedMs / 60000, limit: maxMinutes }),
  ];
  const blocking = risks.find((risk) => risk.status === "exhausted");
  if (blocking) return { ok: false, reason: `local budget exhausted: ${blocking.message}`, risk: blocking };
  const warning = risks.find((risk) => risk.status === "warning");
  return { ok: true, reason: warning ? `warning: ${warning.message}` : "local budget available", risk: warning || risks[0] };
}

// Freshness: a snapshot older than maxAgeMs is stale and must be labeled so.
// A percentage without source/age is exactly the false confidence spec 017
// forbids.
export function usageFreshness(snapshot, { maxAgeMs = 60 * 60000, now = Date.now() } = {}) {
  if (!snapshot?.captured_at) return { fresh: false, ageMs: null, label: "never captured" };
  const ageMs = now - new Date(snapshot.captured_at).getTime();
  if (!Number.isFinite(ageMs)) return { fresh: false, ageMs: null, label: "unknown age" };
  return {
    fresh: ageMs <= maxAgeMs,
    ageMs,
    label: ageMs <= maxAgeMs ? "fresh" : `stale (${Math.round(ageMs / 60000)}m old)`,
  };
}

// Optional remote adapter: only adapter-verified numbers may ever be shown as
// remaining/reset. An absent flag, a failed call, or a malformed payload all
// record an explicit unknown — never a guessed percentage.
export async function recordRemoteUsage(root, { provider = null, model = null, adapter, window = "day" } = {}) {
  if (typeof adapter !== "function") throw new Error("a remote usage adapter function is required");
  try {
    const result = await adapter({ provider, model, window });
    const remaining = result?.remaining;
    const verified = result?.verified === true && (typeof remaining === "number" || result?.used != null);
    if (!verified) {
      return recordUsage(root, {
        provider, model, source: "provider-adapter", status: "unknown", confidence: "low",
        window, remaining: null, reset_at: result?.reset_at || null,
        detail: String(result?.detail || "the adapter returned no verified quota; refusing to display a number"),
      });
    }
    return recordUsage(root, {
      provider, model, source: "provider-adapter", status: "observed", confidence: "verified",
      window, used: result?.used ?? null, remaining: remaining ?? null, reset_at: result?.reset_at || null,
      detail: String(result?.detail || "verified by the provider adapter"),
    });
  } catch (error) {
    return recordUsage(root, {
      provider, model, source: "provider-adapter", status: "unknown", confidence: "low",
      window, remaining: null,
      detail: `adapter failed: ${error.message}`,
    });
  }
}

// Provider APIs are not interchangeable merely because they speak an
// OpenAI-compatible inference protocol. Keep every usage probe explicit so a
// missing or incompatible endpoint cannot become a guessed quota.
export function providerUsageAdapter(entry, { fetchImpl = globalThis.fetch } = {}) {
  const provider = String(entry?.id || "").toLowerCase();
  const baseUrl = String(entry?.base_url || "");
  const isOpenRouter = provider === "openrouter" || /^https:\/\/openrouter\.ai(?:\/|$)/i.test(baseUrl);
  return async () => {
    if (!isOpenRouter) return { verified: false, detail: `No usage adapter is available for ${provider || "this provider"}; local session observations remain available.` };
    if (typeof fetchImpl !== "function") return { verified: false, detail: "This runtime cannot make a provider usage request." };
    const response = await fetchImpl("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${entry.api_key}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`OpenRouter usage request failed (${response.status})`);
    const body = await response.json();
    const data = body?.data || body;
    const remaining = Number(data?.limit_remaining);
    const limit = Number(data?.limit);
    const spent = Number(data?.usage);
    const hasRemaining = Number.isFinite(remaining);
    const hasLimitAndUsage = Number.isFinite(limit) && Number.isFinite(spent);
    return {
      verified: hasRemaining || hasLimitAndUsage,
      remaining: hasRemaining ? remaining : Math.max(0, limit - spent),
      used: hasLimitAndUsage ? { spend: spent, limit } : null,
      reset_at: data?.limit_reset || null,
      detail: "OpenRouter authenticated key usage",
    };
  };
}

// Threshold watch: local budget risk posts a deduplicated notification so the
// manager sees a coming blocker before the team's tokens dry out. Unknown
// limits never notify — absence of data is not a warning.
export function checkUsageThresholds(root, { sessions = 0, maxSessions = null, elapsedMs = 0, maxMinutes = null } = {}) {
  const risks = [
    usageRisk({ used: sessions, limit: maxSessions }),
    usageRisk({ used: elapsedMs / 60000, limit: maxMinutes }),
  ];
  const worst = risks.find((risk) => risk.status === "exhausted") || risks.find((risk) => risk.status === "warning");
  if (!worst) return null;
  return postNotification(root, {
    severity: worst.status === "exhausted" ? "danger" : "warning",
    title: worst.status === "exhausted" ? "Local budget exhausted" : "Local budget near exhaustion",
    message: `${worst.message} — sessions ${sessions}${maxSessions != null ? `/${maxSessions}` : ""}, ${Math.round(elapsedMs / 60000)}m${maxMinutes != null ? `/${maxMinutes}` : " elapsed"}`,
    source: "usage-telemetry",
    action: "open the usage panel (U) or run queue inspect",
  });
}
