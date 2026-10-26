import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createControlPlaneSnapshot } from "./control-plane.mjs";
import { dispatchTuiCommand } from "./command-console.mjs";
import { buildLaunchPlan, executeLaunchQueue, globalMaxConcurrent, mergeQueues, multiQueueDryRun, queueDryRun, readManagerConfig, readOvernightRun, readRunLock, requestRunAbort } from "./launch.mjs";
import { addProposal, addProposalFeedback, editProposal, loadPlanDraft, planDraftLabel, regenerateProposal, removeProposal, reorderProposals, runPlanProvider } from "./plan-studio.mjs";
import { invokePlanningProvider } from "./plan-model.mjs";
import { builtinProviderStatus } from "./providers.mjs";
import { getProvider, loadUserProviders, normalizeThinkingLevel, PROVIDER_TEMPLATES, providerChoices, removeProvider, requireReadyProvider, saveUserProviders, templateById, upsertProvider, wireMismatches } from "./userProviders.mjs";
import { paths } from "./state.mjs";
import { providerUsageAdapter, recordRemoteUsage } from "./usage.mjs";
import { approveClaim, promoteSkill, registerRoutine, validateSkill } from "./governance.mjs";

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTROL_PLANE_FILE = path.join(RUNTIME_DIR, "..", "control-plane.html");

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("request body is too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function sendHtml(res, root) {
  const source = fs.readFileSync(CONTROL_PLANE_FILE, "utf8");
  // The downloaded artifact contains its own demo controller. The live ATL
  // client is the single controller for the served surface; leaving both
  // document listeners active makes route clicks race and can make Tasks
  // appear to open another page. Keep the artifact's DOM/CSS intact while
  // removing only that stale inline controller at the HTTP boundary.
  let bodyText = source.replace(/<script(?: type="application\/x-atl-legacy-disabled")?>\s*\(\(\)=>[\s\S]*?<\/script><script src="\.\/control-plane-client\.js"><\/script>/, '<script src="./control-plane-client.js"></script>');
  // The checked-in standalone artifact predates the live client and places
  // the body inside the flex topbar. Close that shell boundary for the live
  // surface; otherwise the header's flex rules squeeze and center the page.
  bodyText = bodyText.replace('<div id="mobile" class="mobile">', '</header><div id="mobile" class="mobile">');
  // The artifact's footer and topbar pill honestly describe its offline demo
  // mode. The served surface reads and drives the real workspace, so relabel
  // them here; the standalone file keeps its mock banner.
  bodyText = bodyText
    .replace("<span>● Interactive mock · No provider calls, skill execution or real ATL actions</span>", `<span>● Live · connected to ${escapeText(path.basename(root))}</span>`)
    .replace('<span class="pill hotkey">INTERACTIVE DEMO</span>', '<span class="pill hotkey">LIVE</span>');
  const body = Buffer.from(bodyText, "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": body.length,
  });
  res.end(body);
}

function sendJavascript(res) {
  const body = fs.readFileSync(path.join(RUNTIME_DIR, "..", "control-plane-client.js"));
  res.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-store",
    "content-length": body.length,
  });
  res.end(body);
}

function previewLines(preview) {
  const lines = [
    `Dry run · ${preview.queueName || "ad-hoc task run"} · ${preview.items.length} task(s) · ${preview.readyCount} ready · ${preview.blockedCount} blocked`,
    preview.runGate
      ? `Run gate: ${preview.runGate.active ? `ACTIVE (${preview.runGate.queueId})` : "free"} · global concurrency ${preview.globalMaxConcurrent} · budget ${preview.budget.maxMinutes}m/${preview.budget.maxSessions} sessions`
      : `Budget ${preview.budget.maxMinutes}m overall · ${preview.budget.maxSessions} sessions per task · strictly sequential · stops at every human gate`,
  ];
  for (const skip of preview.skipped || []) lines.push(`  queue ${skip.id}: ${skip.reason}`);
  for (const item of preview.items) {
    lines.push(`  ${item.taskId} [${item.status}] -> ${item.role || "-"} ${item.blockers.length ? `BLOCKED: ${item.blockers[0]}` : "ready"}`);
  }
  return lines;
}

function resolvePreview(root, { taskIds = null, queueId = null, queueIds = null, maxMinutes = 120, maxSessions = 8 } = {}) {
  if (Array.isArray(taskIds) && taskIds.length) {
    const state = createControlPlaneSnapshot(root).state?.tasks || {};
    const unknown = taskIds.filter((id) => !state[id] || state[id].status === "archived");
    if (unknown.length) return { error: `unknown task id(s): ${unknown.join(", ")}` };
    return {
      preview: {
        ...buildLaunchPlan(root, { taskIds, maxMinutes, maxSessions }),
        queueId: null,
        queueName: "ad-hoc task run",
        queueStatus: "active",
        globalMaxConcurrent: globalMaxConcurrent(root),
        runGate: null,
      },
    };
  }
  if (Array.isArray(queueIds) && queueIds.length) return { preview: multiQueueDryRun(root, { queueIds, maxMinutes, maxSessions }) };
  return { preview: queueDryRun(root, { queueId, maxMinutes, maxSessions }) };
}

function resolvePreviewSafe(root, options) {
  try {
    return resolvePreview(root, options);
  } catch (error) {
    return { error: error.message };
  }
}

function planningRunActive(root) {
  const lock = readRunLock(root);
  if (!lock?.pid) return false;
  try { process.kill(lock.pid, 0); return true; } catch { return false; }
}

// The browser Studio draft response: artifact plus the honest source label.
function draftResponse(loaded) {
  const { dir, intentPath, artifactPath, ...safe } = loaded;
  return { ...safe, label: planDraftLabel(loaded) };
}

// The planning invoke seam: production spawns the configured user provider;
// verification injects a deterministic fake so no real CLI is ever launched.
function planningCall({ planningInvoke, planningRoot }, entry, call) {
  if (planningInvoke) return planningInvoke({ ...call, root: planningRoot });
  return invokePlanningProvider(planningRoot, entry, { request: call.request, logPath: call.logPath });
}

// Browser provider management: add / key / use / remove against the
// machine-wide ~/.atl/providers.json registry, mirroring the CLI. Responses
// NEVER contain an api_key — the masked ready/problems summary is the only
// view anyone gets through HTTP.
function sanitizedTemplates() {
  return PROVIDER_TEMPLATES.map((template) => ({
    id: template.id,
    label: template.label,
    protocol: template.protocol || "custom",
    worker: template.worker,
    models: template.models,
    thinkingLevels: template.thinkingLevels || [],
    baseUrl: template.baseUrl,
  }));
}

function providerConfig(root) {
  try { return readManagerConfig(root).providers || {}; } catch { return {}; }
}

function writeProviderDefault(root, id) {
  const file = paths(root).config;
  let config = {};
  try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { config = {}; }
  config.providers = config.providers || {};
  config.providers.by_role = config.providers.by_role || {};
  config.providers.model_by_role = config.providers.model_by_role || {};
  config.providers.catalog = config.providers.catalog || {};
  config.providers.use = id;
  const tmp = file + ".tmp";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function clearProviderDefault(root, id) {
  const file = paths(root).config;
  let config = {};
  try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return; }
  if (config.providers?.use === id) {
    delete config.providers.use;
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
    fs.renameSync(tmp, file);
  }
}

function providerView(root) {
  // `builtin` carries the built-in subscription workers (codex/claude) with
  // their sign-in state — the zero-key connection path the registry section
  // cannot show. Read-only local evidence; no secret material is included.
  return { providers: providerChoices(loadUserProviders()), templates: sanitizedTemplates(), defaultProvider: providerConfig(root).use || null, builtin: builtinProviderStatus() };
}

function navigationView(root) {
  const navigation = readManagerConfig(root).navigation || {};
  return {
    mode: navigation.mode === "on" ? "on" : "off",
    max_tokens: Number.isFinite(Number(navigation.max_tokens)) ? Number(navigation.max_tokens) : 800,
    build_on_launch: navigation.build_on_launch !== false,
  };
}

function writeNavigationConfig(root, payload) {
  const mode = String(payload.mode || "").toLowerCase();
  if (!new Set(["off", "on"]).has(mode)) throw new Error("navigation mode must be on or off");
  const maxTokens = Number(payload.max_tokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 100 || maxTokens > 4000) throw new Error("navigation token budget must be a whole number from 100 to 4000");
  if (typeof payload.build_on_launch !== "boolean") throw new Error("build_on_launch must be true or false");
  const file = paths(root).config;
  let config = {};
  try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { config = {}; }
  config.navigation = { ...(config.navigation || {}), mode, max_tokens: maxTokens, build_on_launch: payload.build_on_launch };
  const tmp = file + ".tmp";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return navigationView(root);
}

async function handleNavigationEndpoint(root, res, req) {
  try {
    if (req.method === "GET") return json(res, 200, { ok: true, navigation: navigationView(root) });
    const payload = JSON.parse(await readBody(req) || "{}");
    return json(res, 200, { ok: true, navigation: writeNavigationConfig(root, payload) });
  } catch (error) { return json(res, 400, { ok: false, error: error.message }); }
}

async function handleProvidersEndpoint(root, res, req) {
  const payload = JSON.parse(await readBody(req) || "{}");
  const action = String(payload.action || "");
  try {
    const registry = loadUserProviders();
    if (action === "add") {
      const id = String(payload.id || "").trim();
      if (!id) return json(res, 400, { ok: false, error: "provider add needs an id" });
      const template = payload.template ? templateById(payload.template) : null;
      const worker = String(payload.worker || template?.worker || "claude").toLowerCase();
      const baseUrl = String(payload.base_url ?? (template ? template.baseUrl?.[worker] : "") ?? "").trim();
      const wireProblems = wireMismatches(worker, baseUrl);
      if (wireProblems.length) return json(res, 400, { ok: false, error: `refusing to save "${id}": ${wireProblems.join("; ")}` });
      upsertProvider(registry, id, {
        label: String(payload.label || template?.label || id),
        protocol: String(payload.protocol || template?.protocol || "custom").toLowerCase(),
        worker,
        base_url: baseUrl,
        model: String(payload.model || template?.models?.[0] || "").trim(),
        models: Array.isArray(payload.models) ? payload.models : (template?.models || []),
        thinking_level: String(payload.thinking_level || "").trim(),
        thinking_levels: Array.isArray(payload.thinking_levels) ? payload.thinking_levels : (template?.thinkingLevels || []),
        api_key: payload.key ? String(payload.key).trim() : undefined,
      });
      saveUserProviders(registry);
      return json(res, 200, { ok: true, ...providerView(root) });
    }
    if (action === "key") {
      const id = String(payload.id || "").trim();
      const key = String(payload.key || "").trim();
      if (!id || !key) return json(res, 400, { ok: false, error: "provider key needs an id and the key" });
      if (!getProvider(registry, id)) return json(res, 400, { ok: false, error: `no provider named "${id}" — add it first` });
      upsertProvider(registry, id, { api_key: key });
      saveUserProviders(registry);
      return json(res, 200, { ok: true, ...providerView(root) });
    }
    if (action === "use") {
      const id = String(payload.id || "").trim();
      if (!getProvider(registry, id)) return json(res, 400, { ok: false, error: `no provider named "${id}" in the registry` });
      writeProviderDefault(root, id);
      return json(res, 200, { ok: true, ...providerView(root) });
    }
    if (action === "update") {
      const id = String(payload.id || "").trim();
      if (!getProvider(registry, id)) return json(res, 400, { ok: false, error: `no provider named "${id}" in the registry` });
      const patch = {};
      if (payload.label !== undefined) patch.label = String(payload.label).trim() || id;
      if (payload.worker !== undefined) patch.worker = String(payload.worker).trim().toLowerCase();
      if (payload.protocol !== undefined) patch.protocol = String(payload.protocol).trim().toLowerCase();
      if (payload.base_url !== undefined) patch.base_url = String(payload.base_url).trim();
      if (payload.model !== undefined) patch.model = String(payload.model).trim();
      if (payload.models !== undefined) patch.models = Array.isArray(payload.models) ? payload.models.map(String) : [];
      if (payload.thinking_level !== undefined) patch.thinking_level = String(payload.thinking_level).trim();
      if (!Object.keys(patch).length) return json(res, 400, { ok: false, error: "provider update needs at least one of label, worker, protocol, base_url, model, models" });
      const updated = upsertProvider(registry, id, patch);
      const wireProblems = wireMismatches(updated.worker, updated.base_url);
      if (wireProblems.length) return json(res, 400, { ok: false, error: `refusing to update "${id}": ${wireProblems.join("; ")}` });
      saveUserProviders(registry);
      return json(res, 200, { ok: true, ...providerView(root) });
    }
    // 9router-style model discovery: query the endpoint's model list with the
    // STORED key, server-side only, so the manager picks a real model id
    // instead of typing one blind. The key never leaves this process.
    if (action === "models") {
      const id = String(payload.id || "").trim();
      const entry = getProvider(registry, id);
      if (!entry) return json(res, 400, { ok: false, error: `no provider named "${id}" in the registry` });
      if (!entry.base_url) return json(res, 400, { ok: false, error: `${id} has no base URL stored — set it before loading models` });
      if (!entry.api_key) return json(res, 400, { ok: false, error: `${id} has no API key stored — save the key before loading models` });
      const base = String(entry.base_url).replace(/\/+$/, "");
      const protocol = String(entry.protocol || (entry.worker === "claude" ? "anthropic" : "openai")).toLowerCase();
      const candidates = protocol === "anthropic"
        ? [{ url: `${base}/v1/models`, headers: { "x-api-key": entry.api_key, "authorization": `Bearer ${entry.api_key}`, "anthropic-version": "2023-06-01" } }]
        : protocol === "openai"
          ? [{ url: `${base}/models`, headers: { "authorization": `Bearer ${entry.api_key}` } }]
          : [{ url: `${base}/models`, headers: { "authorization": `Bearer ${entry.api_key}` } }, { url: `${base}/v1/models`, headers: { "x-api-key": entry.api_key, "authorization": `Bearer ${entry.api_key}`, "anthropic-version": "2023-06-01" } }];
      let lastProblem = "the endpoint returned no model ids";
      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate.url, { headers: candidate.headers, signal: AbortSignal.timeout(15000) });
          if (!response.ok) {
            lastProblem = `HTTP ${response.status} from ${candidate.url}`;
            continue;
          }
          const body = await response.json();
          const raw = Array.isArray(body) ? body : (Array.isArray(body?.data) ? body.data : (Array.isArray(body?.models) ? body.models : []));
          const models = raw.map((item) => (typeof item === "string" ? item : item?.id || item?.name)).filter(Boolean).map(String).sort();
          if (!models.length) continue;
          return json(res, 200, { ok: true, models, source: candidate.url });
        } catch (error) {
          lastProblem = error.name === "TimeoutError" ? `timeout after 15s calling ${candidate.url}` : `${error.message} (${candidate.url})`;
        }
      }
      return json(res, 400, { ok: false, error: `model list request failed: ${lastProblem}` });
    }
    if (action === "remove") {
      const id = String(payload.id || "").trim();
      removeProvider(registry, id);
      saveUserProviders(registry);
      clearProviderDefault(root, id);
      return json(res, 200, { ok: true, ...providerView(root) });
    }
    return json(res, 400, { ok: false, error: "provider action must be add, update, key, models, use, or remove" });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
}

// Post-invoke planning failures carry the transcript path; surface a bounded
// tail of that provider.log so the browser can show the raw model response
// next to the error — no file digging. Keys never appear in the transcript
// (credentials travel in the spawned process's environment, not its output).
function providerLogTail(error) {
  const file = error?.providerLogPath;
  if (!file || !fs.existsSync(file)) return null;
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim()).slice(-40).map((line) => (line.length > 500 ? `${line.slice(0, 500)}…` : line));
  } catch {
    return null;
  }
}

async function handlePlanEndpoint(root, res, pathname, req, seam = {}) {
  const payload = JSON.parse(await readBody(req) || "{}");
  if (pathname === "/api/plan/generate") {
    const intent = String(payload.intent || "").trim();
    if (!intent) return json(res, 400, { ok: false, error: "plan generation needs an intent" });
    try {
      // Provider-backed generation is always an explicit, bounded spend: the
      // provider must be configured and ready, no queue run may be active,
      // and the call itself is one confirmed planning session with a timeout.
      const selected = requireReadyProvider(payload.provider, { registry: loadUserProviders() });
      const entry = selected.withModel(payload.model);
      if (payload.thinking_level !== undefined && payload.thinking_level !== null) entry.thinking_level = normalizeThinkingLevel(payload.thinking_level);
      if (planningRunActive(root)) return json(res, 409, { ok: false, error: "an overnight queue run is active — planning calls wait until the run gate is free" });
      const draft = await runPlanProvider(root, intent, {
        confirm: payload.confirm === true,
        role: "pip",
        provider: entry.id,
        invoke: (call) => planningCall(seam, entry, call),
      });
      return json(res, 200, { ok: true, draft: draftResponse(draft) });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message, providerResponse: error.providerResponse || null, providerLogLines: providerLogTail(error) });
    }
  }
  if (pathname === "/api/plan/regenerate") {
    const draftId = String(payload.draftId || "");
    const proposalId = String(payload.proposalId || "");
    if (!draftId || !proposalId) return json(res, 400, { ok: false, error: "regeneration needs a draft id and a proposal id" });
    try {
      const loaded = loadPlanDraft(root, draftId);
      const providerId = payload.provider || loaded.provider;
      if (!providerId) return json(res, 400, { ok: false, error: "this draft has no retained provider — select one before regenerating" });
      const selected = requireReadyProvider(providerId, { registry: loadUserProviders() });
      const entry = selected.withModel(payload.model);
      if (planningRunActive(root)) return json(res, 409, { ok: false, error: "an overnight queue run is active — planning calls wait until the run gate is free" });
      const updated = await regenerateProposal(root, draftId, proposalId, {
        confirm: payload.confirm === true,
        role: "pip",
        provider: entry.id,
        model: payload.model || null,
        invoke: (call) => planningCall(seam, entry, call),
      });
      return json(res, 200, { ok: true, draft: draftResponse(updated) });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message, providerResponse: error.providerResponse || null, providerLogLines: providerLogTail(error) });
    }
  }
  if (pathname === "/api/plan/card") {
    const draftId = String(payload.draftId || "");
    const proposalId = payload.proposalId != null ? String(payload.proposalId) : null;
    try {
      let updated;
      if (payload.action === "edit") updated = editProposal(root, draftId, proposalId, payload.patch || {});
      else if (payload.action === "add") updated = addProposal(root, draftId, payload.patch || {});
      else if (payload.action === "remove") updated = removeProposal(root, draftId, proposalId);
      else if (payload.action === "reorder") updated = reorderProposals(root, draftId, proposalId, Number(payload.position) || 0);
      else if (payload.action === "feedback") updated = addProposalFeedback(root, draftId, proposalId, payload.text);
      else return json(res, 400, { ok: false, error: "card action must be edit, add, remove, reorder, or feedback" });
      return json(res, 200, { ok: true, draft: draftResponse(updated) });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }
  return json(res, 404, { ok: false, error: "not found" });
}

export function createControlPlaneServer(root, { host = "127.0.0.1", planningInvoke = null, planningRoot = null, usageFetch = globalThis.fetch } = {}) {
  const seam = { planningInvoke, planningRoot: planningRoot || root, usageFetch };
  const durable = readOvernightRun(root);
  const run = durable ? {
    status: durable.status || "idle",
    queueId: durable.queueId || null,
    taskIds: durable.taskOrder || null,
    queueIds: durable.queueIds || null,
    startedAt: durable.startedAt || null,
    finishedAt: durable.endedAt || null,
    progress: [],
    results: durable.results || [],
    reason: durable.reason || null,
    resumableTaskIds: durable.resumableTaskIds || [],
    error: durable.error || null,
  } : { status: "idle", queueId: null, taskIds: null, queueIds: null, startedAt: null, finishedAt: null, progress: [], results: [], error: null };
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}`);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        sendHtml(res, root);
        return;
      }
      if (req.method === "GET" && url.pathname === "/control-plane-client.js") {
        sendJavascript(res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/snapshot") {
        json(res, 200, createControlPlaneSnapshot(root));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/usage/refresh") {
        const registry = loadUserProviders();
        const entries = Object.values(registry.providers || {}).filter((entry) => entry?.api_key && entry?.base_url);
        if (!entries.length) {
          json(res, 200, { ok: true, refreshed: [], message: "No configured provider credentials are available for a usage probe." });
          return;
        }
        const refreshed = await Promise.all(entries.map((entry) => recordRemoteUsage(root, {
          provider: entry.id,
          model: entry.model || null,
          adapter: providerUsageAdapter(entry, { fetchImpl: seam.usageFetch }),
        })));
        json(res, 200, { ok: true, refreshed, snapshot: createControlPlaneSnapshot(root) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/brain") {
        const payload = JSON.parse(await readBody(req) || "{}");
        let result;
        if (payload.action === "approve-claim") result = approveClaim(root, String(payload.claim_id || ""), { actor: "manager", note: String(payload.note || "") });
        else if (payload.action === "validate-skill") result = validateSkill(payload.skill || {});
        else if (payload.action === "promote-skill") result = promoteSkill(root, payload.skill || {}, { actor: "manager" });
        else if (payload.action === "register-routine") result = registerRoutine(root, payload.routine || {}, { actor: "manager" });
        else { json(res, 400, { ok: false, error: "unknown brain action" }); return; }
        json(res, 200, { ok: true, result, snapshot: createControlPlaneSnapshot(root) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/command") {
        const payload = JSON.parse(await readBody(req) || "{}");
        const command = String(payload.command || "").trim();
        const result = dispatchTuiCommand(root, command, { selectedTaskId: payload.selectedTaskId || null });
        json(res, result.ok ? 200 : 400, result);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/run") {
        json(res, 200, run);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/run/preview") {
        const payload = JSON.parse(await readBody(req) || "{}");
        const resolved = resolvePreviewSafe(root, {
          taskIds: Array.isArray(payload.taskIds) ? payload.taskIds.map((id) => String(id)) : null,
          queueId: payload.queueId || null,
          queueIds: Array.isArray(payload.queueIds) ? payload.queueIds.map((id) => String(id)) : null,
          maxMinutes: Number(payload.maxMinutes || 120),
          maxSessions: Number(payload.maxSessions || 8),
        });
        if (resolved.error) {
          json(res, 400, { ok: false, error: resolved.error });
          return;
        }
        json(res, 200, { ok: true, lines: previewLines(resolved.preview), preview: resolved.preview });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/run") {
        const payload = JSON.parse(await readBody(req) || "{}");
        if (payload.confirm !== true) {
          json(res, 400, { ok: false, error: "queue execution requires explicit confirmation" });
          return;
        }
        if (run.status === "running") {
          json(res, 409, { ok: false, error: "a queue run is already active", run });
          return;
        }
        const taskIds = Array.isArray(payload.taskIds) && payload.taskIds.length ? payload.taskIds.map((id) => String(id)) : null;
        const queueIds = !taskIds && Array.isArray(payload.queueIds) && payload.queueIds.length ? payload.queueIds.map((id) => String(id)) : null;
        let runQueueLabel = taskIds ? null : (payload.queueId || null);
        if (taskIds) {
          const resolved = resolvePreviewSafe(root, { taskIds });
          if (resolved.error) {
            json(res, 400, { ok: false, error: resolved.error });
            return;
          }
        }
        if (queueIds) {
          const resolved = resolvePreviewSafe(root, { queueIds });
          if (resolved.error) {
            json(res, 400, { ok: false, error: resolved.error });
            return;
          }
          runQueueLabel = resolved.preview.queueId;
        }
        // Per-task runs default to the CLI one-shot budget (1 session); the
        // A queue owns its complete bounded relay; multi-queue runs share one
        // budget across their selected queues.
        const defaultSessions = 8;
        Object.assign(run, { status: "running", queueId: runQueueLabel, taskIds, queueIds, startedAt: new Date().toISOString(), finishedAt: null, progress: [], results: [], error: null, reason: null });
        executeLaunchQueue(root, {
          confirm: true,
          queueId: taskIds || queueIds ? null : (payload.queueId || null),
          queueIds,
          taskIds,
          maxMinutes: Number(payload.maxMinutes || (taskIds ? 60 : 120)),
          maxSessions: Number(payload.maxSessions || defaultSessions),
          onProgress: (line) => { run.progress.push(String(line)); run.progress = run.progress.slice(-200); },
        }).then((outcome) => {
          Object.assign(run, { status: "complete", finishedAt: new Date().toISOString(), results: outcome.results || [], reason: outcome.reason || null });
        }).catch((error) => {
          Object.assign(run, { status: "failed", finishedAt: new Date().toISOString(), error: error.message });
        });
        json(res, 202, { ok: true, run });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/run/stop") {
        if (run.status !== "running") {
          json(res, 409, { ok: false, error: "no queue run is active", run });
          return;
        }
        requestRunAbort();
        run.progress.push("Manager requested a safe stop from the browser control plane.");
        json(res, 202, { ok: true, run });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        json(res, 200, { ok: true, service: "atl-control-plane" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/providers") {
        json(res, 200, { ok: true, ...providerView(root) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/providers") {
        await handleProvidersEndpoint(root, res, req);
        return;
      }
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/navigation") {
        await handleNavigationEndpoint(root, res, req);
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/plan/")) {
        await handlePlanEndpoint(root, res, url.pathname, req, seam);
        return;
      }
      json(res, 404, { ok: false, error: "not found" });
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
    }
  });
}

export async function startControlPlaneServer(root, { host = "127.0.0.1", port = 0, planningInvoke = null, usageFetch = globalThis.fetch } = {}) {
  const server = createControlPlaneServer(root, { host, planningInvoke, usageFetch });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port }, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return { server, host, port: actualPort, url: `http://${host}:${actualPort}/` };
}
