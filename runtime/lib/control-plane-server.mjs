import http from "node:http";
import fs from "node:fs";
import crypto from 'node:crypto';
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createControlPlaneSnapshot } from "./control-plane.mjs";
import { dispatchTuiCommand } from "./command-console.mjs";
import { buildLaunchPlan, executeLaunchQueue, globalMaxConcurrent, mergeQueues, multiQueueDryRun, queueDryRun, readManagerConfig, reconcileOvernightRun, readRunLock, requestRunAbort } from "./launch.mjs";
import { addProposal, addProposalFeedback, editProposal, generateLocalPlan, savePlanDraft, normalizeProposals, loadPlanDraft, planDraftLabel, regenerateProposal, removeProposal, reorderProposals, runPlanProvider, reviewPlanArtifact, answerPlanQuestion, planningEvidence, approvePlanDraft, validatePlanArtifact, validatePlanGrounding } from "./plan-studio.mjs";
import { invokePlanningProvider } from "./plan-model.mjs";
import { builtinProviderStatus, discoverProvider, providerProfile, providerNames } from "./providers.mjs";
import { getProvider, loadUserProviders, normalizeThinkingLevel, PROVIDER_TEMPLATES, providerChoices, removeProvider, requireReadyProvider, saveUserProviders, templateById, upsertProvider, wireMismatches } from "./userProviders.mjs";
import { paths, loadState, saveState, logEvent } from "./state.mjs";
import { providerUsageAdapter, recordRemoteUsage } from "./usage.mjs";
import { approveClaim, registerRoutine, validateSkill } from "./governance.mjs";
import { approvalSnapshot, authorizeAction, decideProposal, proposeAction, recordActionOutcome, revokeGrant } from "./approvals.mjs";
import { registerProject, removeProject, setSupervisorDefaults, supervisorSnapshot } from "./supervisor.mjs";
import { createBackup, listBackups, previewRestore, restoreBackup } from "./backup.mjs";
import { listRoutineRuns, recoverScheduler, runRoutine, schedulerStatus, schedulerTick } from "./routines.mjs";
import { buildDispatchPlan } from "./dispatcher.mjs";
import { executeSupervisor, requestSupervisorStop } from "./supervisor-runner.mjs";
import { ensureOwnerSession, ownerSessionCookie, validateOwnerSession } from "./session-auth.mjs";
import { approveDraftPr, createDeliveryPacket, listDeliveryPackets } from "./delivery.mjs";
import { inspectHandoffChain } from "./handoffs.mjs";
import { ChangeReviewError, describeChanges, fileDiff } from "./task-changes.mjs";
import { captureChangeReview, listChangeReviews, readChangeReview, unavailableReview } from "./change-review-store.mjs";
import { createAssistant, assistantContext, assistantMessageDigest, assistantWorkspace } from "./control-assistant.mjs";
import { previewPlanPublish, publishPlan, verifyImportedSource } from "./plan-publish.mjs";
import { installSkill, designateSkill } from "./skill-install.mjs";
import { executionAccess, saveExecutionAccess, probeWorkspaceAccess } from "./execution-access.mjs";
import { browserAccess, saveBrowserAccess, checkBrowserRuntime } from "./browser-access.mjs";
import { resourcePolicy, resourceView, saveResourcePolicy, taskResourcePreview, routeTask } from "./resource-policy.mjs";
import {recordExecution,publishPlanningExecution} from './execution-report.mjs';
import {recordQuotaFailure} from './provider-quota.mjs';
import { runIntake, normalizeGitHubRepo } from './intake.mjs';
import { importCandidates } from './composer.mjs';
import { queueCreate, queueAdd, loadQueueBook } from './queue.mjs';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTROL_PLANE_FILE = path.join(RUNTIME_DIR, "..", "control-plane.html");
const builtinOperations = new Map();

function startBuiltinOperation(id, action, config) {
  if (!["codex", "claude", "gapgpt"].includes(id)) throw new Error("Unknown built-in provider");
  const previous = builtinOperations.get(id);
  if (previous?.status === "running") throw new Error("An operation is already in progress for this provider");
  let command;
  let args;
  if (action === "login") {
    const worker = builtinProviderStatus({ providers: config }).find((item) => item.id === id);
    const executable = discoverProvider(id, { command: worker.command });
    if (!executable.available) throw new Error("Install the provider before signing in");
    command = executable.path;
    args = id === "claude" ? ["auth", "login", "--claudeai"] : ["login"];
  } else if (action === "install") {
    if (id === "gapgpt") {
      if (process.platform === "win32") {
        command = "powershell.exe";
        args = ["-NoProfile", "-NonInteractive", "-Command", "& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://gapgpt.app/install.ps1').Content))"];
      } else {
        command = "sh";
        args = ["-c", "curl -fsSL https://gapgpt.app/install.sh | sh"];
      }
    } else {
      command = process.platform === "win32" ? "npm.cmd" : "npm";
      args = ["install", "--global", id === "codex" ? "@openai/codex" : "@anthropic-ai/claude-code"];
    }
  } else throw new Error("Unknown provider operation");
  const operation = { action, status: "running", message: action === "login" ? "Opening sign-in. Complete the provider's sign-in in your browser." : "Installing provider…", url: null };
  builtinOperations.set(id, operation);
  const isCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const child = isCmd
    ? spawn("cmd.exe", ["/d", "/s", "/c", `""${command}" ${args.map((arg) => `"${arg}"`).join(" ")}"`], { windowsHide: true, windowsVerbatimArguments: true, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const timeout = setTimeout(() => { operation.status = "error"; operation.message = "Operation timed out. Please try again."; child.kill(); }, action === "install" ? 900000 : 300000);
  timeout.unref();
  let pending = "";
  const capture = (chunk) => {
    if (action !== "login") return;
    pending = (pending + chunk.toString()).slice(-8192);
    const match = pending.match(/https:\/\/[^\s<>"']+/);
    if (match) operation.url = match[0].replace(/[),.;]+$/, "");
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("error", () => { clearTimeout(timeout); operation.status = "error"; operation.message = `Could not start ${action}.`; });
  child.on("close", (code) => {
    clearTimeout(timeout);
    if (operation.status !== "running") return;
    operation.status = code === 0 ? "complete" : "error";
    operation.message = code === 0 ? (action === "login" ? "Sign-in completed. Refresh the provider status." : "Installation completed. Refresh the provider status.") : `${action === "login" ? "Sign-in" : "Installation"} failed or was cancelled.`;
  });
  return operation;
}

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

function sendHtml(res, root, assetRoot = path.dirname(CONTROL_PLANE_FILE)) {
  const source = fs.readFileSync(path.join(assetRoot, "control-plane.html"), "utf8");
  // The downloaded artifact contains its own demo controller. The live ATL
  // client is the single controller for the served surface; leaving both
  // document listeners active makes route clicks race and can make Tasks
  // appear to open another page. Keep the artifact's DOM/CSS intact while
  // removing only that stale inline controller at the HTTP boundary.
  let bodyText = source.replace(/<script(?: type="application\/x-atl-legacy-disabled")?>\s*\(\(\)=>[\s\S]*?<\/script><script src="\.\/control-plane-client\.js"><\/script>/, '<script src="./control-plane-i18n.js"></script><script src="./control-plane-client.js"></script>');
  bodyText = bodyText.replace('<script src="./control-plane-client.js">', '<script src="./control-plane-changes.js"></script><script src="./control-plane-client.js">');
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
  const session = ensureOwnerSession(root);
  bodyText = bodyText.replace("</head>", `<meta name="atl-csrf" content="${escapeText(session.csrf)}"></head>`);
  const body = Buffer.from(bodyText, "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": body.length,
    "set-cookie": ownerSessionCookie(session.token),
  });
  res.end(body);
}

function sendJavascript(res, assetRoot = path.dirname(CONTROL_PLANE_FILE), file = "control-plane-client.js") {
  const body = fs.readFileSync(path.join(assetRoot, file));
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
    if(item.resources)lines.push(`    ${item.resources.budget.max_sessions} task sessions (ceiling ${item.resources.budget.ceiling}); ${item.provider.worker}/${item.provider.model||'provider default'}; ${item.resources.routing.reasons.join('; ')}`);
  }
  return lines;
}

function resolvePreview(root, { taskIds = null, queueId = null, queueIds = null, maxMinutes = 120, maxSessions = null } = {}) {
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
function draftResponse(loaded, root) {
  const { dir, intentPath, artifactPath, ...safe } = loaded;
  const config=readManagerConfig(root);
  const resources=Object.fromEntries(normalizeProposals(loaded.artifact).map(p=>[p.id,taskResourcePreview(config,{...p,risk:loaded.artifact?.risk||'normal'})]));
  return { ...safe, resources, intent: loaded.intent ?? (loaded.intentPath && fs.existsSync(loaded.intentPath) ? fs.readFileSync(loaded.intentPath, "utf8") : null), label: planDraftLabel(loaded) };
}

// The planning invoke seam: production spawns the configured user provider;
// verification injects a deterministic fake so no real CLI is ever launched.
async function planningCall({ planningInvoke, planningRoot }, entry, call) {
  const start={id:`planning:${crypto.randomUUID()}`,draftId:path.basename(path.dirname(call.logPath)),role:call.request.review?'planning-review':call.request.current_proposal?'planning-regenerate':'planning',provider:entry.id,model:entry.model,startedAt:new Date().toISOString(),logPath:call.logPath};
  recordExecution(planningRoot,start);
  try {
    const result=planningInvoke?await planningInvoke({ ...call, root: planningRoot }):await invokePlanningProvider(planningRoot, entry, { request: call.request, logPath: call.logPath });
    recordExecution(planningRoot,{...start,finishedAt:result.finishedAt||new Date().toISOString(),exitCode:result.code??0,timedOut:result.timedOut,tokens:result.tokens,providerFailure:result.providerFailure});
    if(result.providerFailure?.kind==='provider-quota')recordQuotaFailure(planningRoot,{provider:entry.id,model:entry.model,...result.providerFailure});
    try{publishPlanningExecution(planningRoot,start.draftId);}catch(error){result.knowledge_error=error.message;}
    return {...result,provider:entry.id,model:entry.model,resource_decision:entry.resource_decision||null};
  }catch(error){recordExecution(planningRoot,{...start,finishedAt:new Date().toISOString(),exitCode:1});throw error;}
}

function planningEntry(root,payload,task,role='planning',fallback=null) {
  const config=readManagerConfig(root),p=resourcePolicy(config);
  const id=payload.provider||fallback;
  if(id==='auto' || p.enabled&&p.auto_models) {
    if(!p.enabled||!p.auto_models)throw Error('Enable automatic model routing in Settings first');
    const profile=providerProfile(config);
    if(id&&id!=='auto') {profile.byRole[role]=id;if(payload.model)profile.modelByRole[role]=String(payload.model);}
    const route=routeTask(config,task,role,{profile});
    if(route.decision.blocked)throw Error(route.decision.blocked);
    if(route.userProvider)return {...route.userProvider,resource_decision:route.decision};
    if(!['codex','gapgpt','claude'].includes(route.worker))throw Error('This custom adapter does not support model planning; select a built-in or configured key provider');
    return {id:route.worker,worker:route.worker,model:route.model,builtin:true,command:route.provider.command,resource_decision:route.decision};
  }
  return requireReadyProvider(id,{registry:loadUserProviders()}).withModel(payload.model);
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
  if ((config.providers.use || config.providers.default || "codex") !== id) delete config.providers.model;
  config.providers.use = id;
  const tmp = file + ".tmp";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function writeBuiltinModel(root, id, model) {
  const file = paths(root).config;
  let config = {};
  try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { config = {}; }
  config.providers = config.providers || {};
  config.providers.use = id;
  config.providers.model = model;
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
  const config = providerConfig(root);
  const builtin = builtinProviderStatus({ providers: config }).map((worker) => ({ ...worker, operation: builtinOperations.get(worker.id) || null }));
  return { providers: providerChoices(loadUserProviders()), templates: sanitizedTemplates(), defaultProvider: config.use || null, builtin };
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
    if (action === "builtin-login" || action === "builtin-install") {
      const id = String(payload.id || "").trim().toLowerCase();
      startBuiltinOperation(id, action === "builtin-login" ? "login" : "install", providerConfig(root));
      return json(res, 200, { ok: true, ...providerView(root) });
    }
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
      const builtin = new Set(["codex", "claude", "gapgpt"]);
      if (!getProvider(registry, id) && !builtin.has(id.toLowerCase())) return json(res, 400, { ok: false, error: `no provider named "${id}" in the registry or built-in workers` });
      writeProviderDefault(root, id);
      return json(res, 200, { ok: true, ...providerView(root) });
    }
    if (action === "update") {
      const id = String(payload.id || "").trim();
      if (!getProvider(registry, id) && ["codex", "claude", "gapgpt"].includes(id.toLowerCase())) {
        if (payload.model === undefined || !String(payload.model).trim()) return json(res, 400, { ok: false, error: "built-in provider update needs a model" });
        writeBuiltinModel(root, id.toLowerCase(), String(payload.model).trim());
        return json(res, 200, { ok: true, ...providerView(root) });
      }
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
  if (pathname === "/api/plan/local") {
    const intent = String(payload.intent || "").trim();
    if (!intent) return json(res, 400, { ok: false, error: "plan generation needs an intent" });
    try { const artifact = generateLocalPlan(intent); artifact.task_proposals = normalizeProposals(artifact); const draft = savePlanDraft(root, { intent, artifact, stage: "plan", sourceTaskId: payload.sourceTaskId || null }); return json(res, 200, { ok: true, draft: draftResponse(draft, root) }); }
    catch (error) { return json(res, 400, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/generate") {
    const intent = String(payload.intent || "").trim();
    if (!intent) return json(res, 400, { ok: false, error: "plan generation needs an intent" });
    try {
      // Provider-backed generation is always an explicit, bounded spend: the
      // provider must be configured and ready, no queue run may be active,
      // and the call itself is one confirmed planning session with a timeout.
      const entry = planningEntry(root,payload,{title:intent});
      if (payload.thinking_level !== undefined && payload.thinking_level !== null) entry.thinking_level = normalizeThinkingLevel(payload.thinking_level);
      if (planningRunActive(root)) return json(res, 409, { ok: false, error: "an overnight queue run is active — planning calls wait until the run gate is free" });
      const draft = await runPlanProvider(root, intent, {
        confirm: payload.confirm === true,
        role: "pip",
        provider: entry.id,
        sourceTaskId: payload.sourceTaskId || null,
        invoke: (call) => planningCall(seam, entry, call),
      });
      return json(res, 200, { ok: true, draft: draftResponse(draft, root) });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message, providerResponse: error.providerResponse || null, providerLogLines: providerLogTail(error) });
    }
  }
  if (pathname === "/api/plan/review") {
    const draftId = String(payload.draftId || "");
    try {
      const loaded = loadPlanDraft(root, draftId);
      const artifact = loaded.artifact;
      const providerId = payload.provider || loaded.provider;
      if (!providerId) return json(res, 400, { ok: false, error: "select a configured provider for the separate accuracy review" });
      if (artifact.plan_contract_version !== 2) return json(res, 409, { ok: false, error: "legacy and local template drafts need a version 2 model plan before accuracy review" });
      validatePlanArtifact(artifact);
      validatePlanGrounding(root, artifact);
      const entry = planningEntry(root,payload,{...artifact,title:artifact.title||loaded.intent},'planning-review',providerId);
      if (planningRunActive(root)) return json(res, 409, { ok: false, error: "an overnight queue run is active — plan review waits until the run gate is free" });
      const sourceRevision = loaded.source_task_id ? await verifyImportedSource(root, loaded.source_task_id, { fetchImpl: seam.publishFetch }) : null;
      const logPath = path.join(loaded.dir, "review.log");
      const evidence = { ...planningEvidence(root, artifact), external_source: sourceRevision };
      const response = await planningCall(seam, entry, { logPath, request: { review: true, task: "Review the proposed plan only. Return JSON with verdict ('passed' or 'blocked') and findings [{severity, requirement_id, task_id, message, correction}]. Do not edit files or claim checks passed.", intent: loaded.intent, artifact, project_evidence: evidence, required: ["verdict", "findings"], rule: "Be strict and evidence-based. Findings must identify the affected requirement or task. Any blocker or major finding means blocked." } });
      if (!response || response.code !== 0) throw new Error(`Plan review provider failed (code ${response?.code ?? "unknown"})`);
      const text = String(response.text || response.output || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      const result = JSON.parse(text);
      if (!["passed", "blocked"].includes(result.verdict) || !Array.isArray(result.findings)) throw new Error("review response must contain verdict and findings");
      const updated = reviewPlanArtifact(root, loaded, { ...result, source_revision: sourceRevision, provider: response.provider || providerId, model: response.model || payload.model || null });
      return json(res, 200, { ok: true, draft: draftResponse(updated, root), review: updated.review });
    } catch (error) { return json(res, 400, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/clarify") {
    try {
      const updated = answerPlanQuestion(root, String(payload.draftId || ""), String(payload.questionId || ""), payload.answer);
      return json(res, 200, { ok: true, draft: draftResponse(updated, root) });
    } catch (error) { return json(res, 400, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/publish-preview") {
      try { return json(res, 200, { ok: true, preview: await previewPlanPublish(root, String(payload.draftId || ""), payload.destination || {}, { fetchImpl: seam.publishFetch }) }); }
    catch (error) { return json(res, 400, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/approve") {
    try {
      const draftId = String(payload.draftId || "");
      const draft = loadPlanDraft(root, draftId);
      if (draft.source_task_id) {
        const current = await verifyImportedSource(root, draft.source_task_id, { fetchImpl: seam.publishFetch });
        const reviewed = draft.review?.source_revision || draft.artifact.review?.source_revision;
        if (!reviewed?.current || current.remote_id !== reviewed.remote_id || current.revision !== reviewed.revision) throw new Error("Imported source revision changed after review; reconcile the task and review the plan again");
      }
      const approved = approvePlanDraft(root, draft, { sourceRevisionCurrent: Boolean(draft.source_task_id) });
      return json(res, 200, { ok: true, approved: { queueId: approved.queueId, taskIds: approved.taskIds, created: approved.created, draft: draftResponse(approved.draft, root) } });
    } catch (error) { return json(res, 409, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/publish") {
    try {
      const result = await publishPlan(root, String(payload.draftId || ""), payload.destination || {}, payload.previewToken, { confirm: payload.confirm === true, fetchImpl: seam.publishFetch });
      return json(res, 200, { ok: true, result });
    } catch (error) { return json(res, 409, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/regenerate") {
    const draftId = String(payload.draftId || "");
    const proposalId = String(payload.proposalId || "");
    if (!draftId || !proposalId) return json(res, 400, { ok: false, error: "regeneration needs a draft id and a proposal id" });
    try {
      const loaded = loadPlanDraft(root, draftId);
      const providerId = payload.provider || loaded.provider;
      if (!providerId) return json(res, 400, { ok: false, error: "this draft has no retained provider — select one before regenerating" });
      const entry = planningEntry(root,payload,normalizeProposals(loaded.artifact).find(p=>p.id===proposalId)||{title:loaded.intent},'planning',providerId);
      if (planningRunActive(root)) return json(res, 409, { ok: false, error: "an overnight queue run is active — planning calls wait until the run gate is free" });
      const updated = await regenerateProposal(root, draftId, proposalId, {
        confirm: payload.confirm === true,
        role: "pip",
        provider: entry.id,
        model: payload.model || null,
        invoke: (call) => planningCall(seam, entry, call),
      });
      return json(res, 200, { ok: true, draft: draftResponse(updated, root) });
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
      return json(res, 200, { ok: true, draft: draftResponse(updated, root) });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }
  return json(res, 404, { ok: false, error: "not found" });
}

export function createControlPlaneServer(root, { host = "127.0.0.1", planningInvoke = null, planningRoot = null, usageFetch = globalThis.fetch, publishFetch = globalThis.fetch, assetRoot = path.dirname(CONTROL_PLANE_FILE), readOnlyPreview = false, intakeAdapters = {} } = {}) {
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(host)) throw new Error("control plane only supports loopback hosts");
  const seam = { planningInvoke, planningRoot: planningRoot || root, usageFetch, publishFetch, intakeAdapters };
  const intakePreviews = new Map();
  const assistant = createAssistant(root, { providerConfig: () => readManagerConfig(root) });
  // A browser server can start after its runner has died. Reconcile the
  // durable run ledger before projecting it, otherwise the UI can show a
  // permanently-running task/progress bar with no live provider process.
  const durable = reconcileOvernightRun(root).run;
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
  const streams = new Set();
  const streamTimer = setInterval(() => { for (const stream of streams) { try { const snapshot = createControlPlaneSnapshot(root); stream.res.write(`event: snapshot\ndata: ${JSON.stringify({ cursor: snapshot.state?.log?.length || 0, snapshot })}\n\n`); } catch { streams.delete(stream); } } }, 2000);
  streamTimer.unref?.();
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}`);
      if (readOnlyPreview && !["GET", "HEAD", "OPTIONS"].includes(req.method || "GET")) { json(res, 403, { ok: false, error: "Synthetic UI preview is read-only; live task actions are unavailable." }); return; }
      // A browser may only mutate this loopback service from its own origin.
      // Command-line clients have no Origin header and remain supported.
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method || "GET") && req.headers.origin) {
        const expected = `http://${req.headers.host}`;
        if (req.headers.origin !== expected) { json(res, 403, { ok: false, error: "cross-origin control-plane mutation refused" }); return; }
        const token = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("atl_owner="))?.slice("atl_owner=".length);
        if (!validateOwnerSession(root, decodeURIComponent(token || ""), String(req.headers["x-atl-csrf"] || ""))) { json(res, 403, { ok: false, error: "owner session or CSRF token is invalid" }); return; }
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        sendHtml(res, root, assetRoot);
        return;
      }
      if (req.method === "GET" && url.pathname === "/control-plane-client.js") {
        sendJavascript(res, assetRoot);
        return;
      }
      if (req.method === "GET" && url.pathname === "/control-plane-i18n.js") {
        sendJavascript(res, assetRoot, "control-plane-i18n.js");
        return;
      }
      if (req.method === "GET" && url.pathname === "/control-plane-changes.js") {
        sendJavascript(res, assetRoot, "control-plane-changes.js"); return;
      }
      if (req.method === "GET" && url.pathname === "/api/snapshot") {
        json(res, 200, createControlPlaneSnapshot(root));
        return;
      }
      if (["/api/task-changes", "/api/task-change-diff", "/api/task-changes/capture"].includes(url.pathname)) {
        // Source previews require the owner session even on GET, including a
        // CSRF header a cross-origin page cannot obtain through a simple request.
        const token = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("atl_owner="))?.slice("atl_owner=".length);
        if (!validateOwnerSession(root, decodeURIComponent(token || ""), String(req.headers["x-atl-csrf"] || ""))) { json(res, 403, { error: "Owner session is required for source inspection", availability: "forbidden" }); return; }
        try {
          const capture = url.pathname.endsWith("/capture");
          if (req.method !== (capture ? "POST" : "GET")) { json(res, 405, { error: "Method not allowed" }); return; }
          const payload = capture ? JSON.parse(await readBody(req) || "{}") : null;
          const task = loadState(root).tasks[capture ? payload.task_id : url.searchParams.get("taskId")];
          if (!task) { json(res, 404, { error: "Task not found", availability: "task_missing" }); return; }
          const record = capture ? captureChangeReview(root, task) : readChangeReview(root, task, url.searchParams.get("changeSetId"));
          if (url.pathname === "/api/task-change-diff") {
            if (!url.searchParams.get("changeSetId") || !record) throw new ChangeReviewError("change_set_missing", "A pinned change set is required", 400);
            json(res, 200, { change_set_id: record.id, ...fileDiff(root, record, url.searchParams.get("fileId")) }); return;
          }
          json(res, 200, record ? { ...describeChanges(task, record, { cursor: url.searchParams.get("cursor"), limit: url.searchParams.get("limit") }), revisions: listChangeReviews(root, task) } : unavailableReview(task));
        } catch (error) {
          json(res, error instanceof ChangeReviewError ? error.status : 409, { error: error instanceof ChangeReviewError ? error.message : "Source inspection failed; no task state was changed", availability: error instanceof ChangeReviewError ? error.code : "inspection_unavailable" });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/task-recovery") {
        const state = loadState(root); const task = state.tasks[String(url.searchParams.get("taskId") || "")];
        if (!task) { json(res, 404, { error: "Task not found." }); return; }
        json(res, 200, { ok: true, proposal: inspectHandoffChain(root, task, state.tasks, { includeFiles: true }) }); return;
      }
      if (url.pathname === "/api/browser-access" && ["GET", "POST"].includes(req.method)) {
        try {
          if (req.method === "GET") { json(res, 200, { ok: true, access: browserAccess(root, url.searchParams.get("task") || null) }); return; }
          const payload = JSON.parse(await readBody(req) || "{}");
          if (payload.action === "check") { json(res, 200, { ok: true, check: await checkBrowserRuntime(root, payload.task ?? null) }); return; }
          if (payload.action !== "save") throw new Error("Unknown browser access action.");
          json(res, 200, { ok: true, access: saveBrowserAccess(root, { task: payload.task ?? null, mode: payload.mode }) });
        } catch (error) { json(res, 400, { ok: false, error: error.message }); }
        return;
      }
      if (url.pathname === "/api/execution-access" && ["GET", "POST"].includes(req.method)) {
        try {
          if (req.method === "GET") { json(res, 200, { ok: true, access: executionAccess(root, url.searchParams.get("task") || null) }); return; }
          const payload = JSON.parse(await readBody(req) || "{}");
          if (payload.action === "check") { json(res, 200, { ok: true, check: await probeWorkspaceAccess(root, String(payload.task || ""), { provider: payload.provider || "gapgpt" }) }); return; }
          if (payload.action !== "save") throw new Error("Unknown access action.");
          json(res, 200, { ok: true, access: saveExecutionAccess(root, { task: payload.task || null, mode: payload.mode }) });
        } catch (error) { json(res, 400, { ok: false, error: error.message }); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/assistant") {
        const payload = JSON.parse(await readBody(req) || "{}"); const scope = String(payload.scope || "global");
        if (payload.action === "read") { const context = assistantContext(root, scope); json(res, 200, { ok: true, guidance: context.guidance, recovery: context.recovery_plan || null, access: executionAccess(root, scope === "global" ? null : scope), session: assistant.read(scope), providers: builtinProviderStatus(readManagerConfig(root)).filter((item) => ["codex", "gapgpt"].includes(item.id)) }); return; }
        if (payload.action === "cancel") { json(res, 200, { ok: true, session: assistant.cancel(scope) }); return; }
        if (payload.action !== "send") { json(res, 400, { error: "Unknown assistant action." }); return; }
        const context = assistantContext(root, scope); const message = String(payload.message || "");
        const mode = payload.mode || "diagnose";
        if (!["diagnose", "fix"].includes(mode)) { json(res, 400, { error: "Unknown assistant mode." }); return; }
        const workspace = mode === "fix" ? assistantWorkspace(root, scope) : null;
        const access = executionAccess(root, scope === "global" ? null : scope);
        if (mode === "fix" && access.mode !== "workspace-write") { json(res, 409, { ok: false, error: "Task access is read-only. Authorize workspace writes in Workspace access before retrying." }); return; }
        if (!message.trim() || message.length > 12000) { json(res, 400, { error: "Enter a message under 12,000 characters." }); return; }
        const action = { project: path.resolve(root), task: scope === "global" ? null : scope, operation: mode === "fix" ? "assistant.fix" : "assistant.diagnose", target: String(payload.provider || ""), args: { scope, model: String(payload.model || ""), messageDigest: assistantMessageDigest(message), contextDigest: assistantMessageDigest(JSON.stringify(context)), mode, workspace, access: mode === "fix" ? access.mode : "read-only" }, policyVersion: 1 };
        const approval = authorizeAction(root, action);
        if (!approval.allowed) { const proposal = proposeAction(root, action, { principal: "owner" }); json(res, 202, { ok: true, approvalRequired: true, proposal }); return; }
        const session = assistant.start({ scope, provider: String(payload.provider || ""), model: String(payload.model || ""), message, mode, workspace });
        recordActionOutcome(root, action, { status: "started" }); json(res, 202, { ok: true, session }); return;
      }
      if (req.method === "GET" && url.pathname === "/api/events") {
        const snapshot = createControlPlaneSnapshot(root); res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: snapshot\ndata: ${JSON.stringify({ cursor: Number(url.searchParams.get("cursor") || 0), snapshot })}\n\n`);
        const stream = { res }; streams.add(stream); req.on("close", () => streams.delete(stream)); return;
      }
      if (req.method === "GET" && url.pathname === "/api/approvals") { json(res, 200, approvalSnapshot(root)); return; }
      if (req.method === "POST" && url.pathname === "/api/approvals") {
        const payload = JSON.parse(await readBody(req) || "{}"); let result;
        if (payload.action === "propose") result = proposeAction(root, payload.proposal || {}, { principal: "owner" });
        else if (payload.action === "decide") result = decideProposal(root, String(payload.proposal_id || ""), payload.decision, { principal: "owner", expiresInSeconds: Number(payload.expires_in_seconds || 600) });
        else if (payload.action === "revoke") result = revokeGrant(root, String(payload.grant_id || ""), { principal: "owner" });
        else { json(res, 400, { ok: false, error: "unknown approval action" }); return; }
        json(res, 200, { ok: true, result, approvals: approvalSnapshot(root) }); return;
      }
      if (req.method === "GET" && url.pathname === "/api/supervisor") { json(res, 200, supervisorSnapshot()); return; }
      if (req.method === "POST" && url.pathname === "/api/supervisor") {
        const payload = JSON.parse(await readBody(req) || "{}"); let result;
        if (payload.action === "register-project" || payload.action === "register") result = registerProject(String(payload.root || root), payload.project || { name: payload.name, maxConcurrent: payload.maxConcurrent });
        else if (["remove", "remove-project", "delete", "delete-project"].includes(payload.action)) result = removeProject(String(payload.id || payload.project_id || ""), { force: false });
        else if (payload.action === "defaults") result = setSupervisorDefaults(payload.defaults || {});
        else { json(res, 400, { ok: false, error: "unknown supervisor action" }); return; }
        json(res, 200, { ok: true, result, supervisor: supervisorSnapshot() }); return;
      }
      if (req.method === "GET" && url.pathname === "/api/backups") { json(res, 200, { backups: listBackups(root) }); return; }
      if (req.method === "GET" && url.pathname === "/api/backups/preview") { json(res, 200, { ok: true, preview: previewRestore(root, String(url.searchParams.get("id") || "")) }); return; }
      if (req.method === "POST" && url.pathname === "/api/backups") { const payload = JSON.parse(await readBody(req) || "{}"); const result = payload.action === "restore" ? restoreBackup(root, String(payload.id || payload.backup_id || "")) : createBackup(root, { label: String(payload.label || "manual") }); json(res, 200, { ok: true, result, backups: listBackups(root) }); return; }
      if (req.method === "GET" && url.pathname === "/api/delivery") { json(res, 200, { packets: listDeliveryPackets(root) }); return; }
      if (req.method === "POST" && url.pathname === "/api/delivery") { const payload = JSON.parse(await readBody(req) || "{}"); const result = payload.action === "approve-draft-pr" ? approveDraftPr(root, payload.packet_id, payload) : createDeliveryPacket(root, payload.task_id, payload); json(res, 200, { ok: true, result, packets: listDeliveryPackets(root) }); return; }
      if (req.method === "GET" && url.pathname === "/api/routines/runs") { json(res, 200, { runs: listRoutineRuns(root), scheduler: schedulerStatus(root) }); return; }
      if (req.method === "POST" && url.pathname === "/api/routines/run") { const payload = JSON.parse(await readBody(req) || "{}"); const result = runRoutine(root, String(payload.id || ""), { sourceFingerprint: String(payload.source_fingerprint || "manual"), dryRun: payload.dry_run !== false }); json(res, 200, { ok: true, result }); return; }
      if (req.method === "POST" && url.pathname === "/api/routines/tick") { const payload = JSON.parse(await readBody(req) || "{}"); const result = schedulerTick(root, { now: payload.now ? new Date(payload.now) : new Date(), event: payload.event || null, sourceFingerprint: payload.source_fingerprint || null }); json(res, 200, { ok: true, result }); return; }
      if (req.method === "POST" && url.pathname === "/api/routines/recover") { json(res, 200, { ok: true, scheduler: recoverScheduler(root) }); return; }
      if (req.method === "GET" && url.pathname === "/api/dispatch/preview") { const supervisor = supervisorSnapshot(); const projects = supervisor.projects.map((project) => ({ ...project, eligible: true })); json(res, 200, { ok: true, plan: buildDispatchPlan(projects, { maxConcurrent: supervisor.defaults.maxConcurrent }) }); return; }
      if (req.method === "POST" && url.pathname === "/api/supervisor/run") {
        const payload = JSON.parse(await readBody(req) || "{}"); const supervisor = supervisorSnapshot();
        if (payload.confirm !== true) { json(res, 400, { ok: false, error: "supervisor execution requires explicit confirmation" }); return; }
        executeSupervisor(root, { projects: supervisor.projects, maxMinutes: Number(payload.max_minutes || 120), maxSessions: payload.max_sessions===undefined?null:Number(payload.max_sessions), onProgress: () => {} }).catch(() => {});
        json(res, 202, { ok: true, status: "running", cap: supervisor.defaults.maxConcurrent }); return;
      }
      if (req.method === "POST" && url.pathname === "/api/supervisor/stop") { requestSupervisorStop(); json(res, 202, { ok: true, status: "stopping" }); return; }
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
        if (payload.action === "install-skill") result = await installSkill(root, payload.source);
        else if (payload.action === "designate-skill") result = designateSkill(root, payload.id);
        else if (payload.action === "approve-claim") result = approveClaim(root, String(payload.claim_id || ""), { actor: "manager", note: String(payload.note || "") });
        else if (payload.action === "validate-skill") result = validateSkill(payload.skill || {});
        else if (payload.action === "promote-skill") { json(res, 409, { ok: false, error: "Promotion is unavailable: the control plane cannot verify validation runs or independent reviews yet." }); return; }
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
        // Read the shared ledger on every poll: another CLI can own the run,
        // or its worker can have died since this browser server started.
        const latest = reconcileOvernightRun(root).run;
        if (latest) Object.assign(run, {
          status: latest.status === "finished" ? (latest.resumableTaskIds?.length ? "stopped" : "complete") : latest.status,
          queueId: latest.queueId || null, queueIds: latest.queueIds || [],
          taskIds: latest.taskOrder || [], currentTaskId: latest.currentTaskId || null,
          startedAt: latest.startedAt, finishedAt: latest.endedAt || null,
          results: latest.results || [], reason: latest.reason || latest.recovery || null,
          resumableTaskIds: latest.resumableTaskIds || [],
        });
        json(res, 200, run);
        return;
      }
      if (url.pathname === "/api/intake/sources" && ["GET", "POST"].includes(req.method)) {
        try {
          if (req.method === "POST") {
            if (run.status === "running" || planningRunActive(root)) { json(res, 409, { ok: false, error: "Wait for the active run before changing issue sources." }); return; }
            const payload = JSON.parse(await readBody(req) || "{}"), source = String(payload.source || "");
            const config = readManagerConfig(root); config.intake ||= {};
            if (source === "github") {
              const repos = [...new Set(String(payload.repos || "").split(/[\s,]+/).map(normalizeGitHubRepo).filter(Boolean))];
              if (repos.length > 20 || repos.some((repo) => !/^[\w.-]+\/[\w.-]+$/.test(repo))) throw new Error("Enter up to 20 GitHub repositories as owner/name.");
              config.intake.github = { enabled: Boolean(payload.enabled), repos };
            } else if (source === "jira") {
              const base = new URL(String(payload.base_url || ""));
              if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Jira needs a plain HTTPS base URL.");
              const projects = [...new Set(String(payload.projects || "").split(/[\s,]+/).map((key) => key.toUpperCase()).filter(Boolean))];
              if (!projects.length || projects.length > 20 || projects.some((key) => !/^[A-Z][A-Z0-9_]{1,19}$/.test(key))) throw new Error("Enter 1?20 Jira project keys.");
              const token_env = String(payload.token_env || "JIRA_TOKEN").trim();
              if (!/^[A-Z_][A-Z0-9_]*$/.test(token_env)) throw new Error("Choose a valid token environment variable name.");
              config.intake.jira = { enabled: Boolean(payload.enabled), base_url: base.href.replace(/\/$/, ""), projects, token_env };
            } else if (source === "azure") {
              const base = new URL(String(payload.org_url || ""));
              if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || /\/_workitems|\/_sprints/i.test(base.pathname)) throw new Error("Azure needs a plain HTTPS collection URL, before the project and taskboard path.");
              const project = String(payload.project || "").trim();
              if (!project || project.length > 128 || /[\\/\r\n]/.test(project)) throw new Error("Enter an Azure project name.");
              const token_env = String(payload.token_env || "AZDO_PAT").trim();
              if (!/^[A-Z_][A-Z0-9_]*$/.test(token_env)) throw new Error("Choose a valid token environment variable name.");
              const iteration_path = String(payload.iteration_path || "").trim();
              config.intake.azure = { ...config.intake.azure, enabled: Boolean(payload.enabled), org_url: base.href.replace(/\/$/, ""), project, iteration_path, token_env };
            } else throw new Error("Unknown issue source.");
            const file = path.join(root, "config", "manager.json"); fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(`${file}.tmp`, JSON.stringify(config, null, 2) + "\n"); fs.renameSync(`${file}.tmp`, file);
          }
          const intake = readManagerConfig(root).intake || {};
          json(res, 200, { ok: true, sources: { github: { enabled: Boolean(intake.github?.enabled), repos: intake.github?.repos || [] }, jira: { enabled: Boolean(intake.jira?.enabled), base_url: intake.jira?.base_url || "", projects: intake.jira?.projects || [], token_env: intake.jira?.token_env || "JIRA_TOKEN", token_present: Boolean(process.env[intake.jira?.token_env || "JIRA_TOKEN"]) }, azure: { enabled: Boolean(intake.azure?.enabled), org_url: intake.azure?.org_url || "", project: intake.azure?.project || "", iteration_path: intake.azure?.iteration_path || "", token_env: intake.azure?.token_env || "AZDO_PAT", token_present: Boolean(process.env[intake.azure?.token_env || "AZDO_PAT"]) } } });
        } catch (error) { json(res, 400, { ok: false, error: error.message }); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/intake/preview") {
        try {
          const payload = JSON.parse(await readBody(req) || "{}"), source = String(payload.source || "");
          if (!["github", "jira", "azure"].includes(source)) throw new Error("Choose GitHub, Jira, or Azure Boards.");
          const config = readManagerConfig(root);
          if (!config.intake?.[source]?.enabled) throw new Error(`${source} source is not enabled.`);
          const results = await runIntake(config, source, seam.intakeAdapters);
          const candidates = results.flatMap((entry) => entry.tasks);
          const token = crypto.randomUUID(); intakePreviews.set(token, { source, candidates, at: Date.now() });
          json(res, 200, { ok: true, token, candidates: candidates.map((item, index) => ({ index, title: item.title, objective_hint: item.objective_hint, source: item.source, priority: item.priority })) });
        } catch (error) { json(res, 400, { ok: false, error: error.message }); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/intake/import") {
        try {
          if (run.status === "running" || planningRunActive(root)) { json(res, 409, { ok: false, error: "Wait for the active run before importing issues." }); return; }
          const payload = JSON.parse(await readBody(req) || "{}"), preview = intakePreviews.get(String(payload.token || ""));
          if (!preview || Date.now() - preview.at > 600000) throw new Error("Issue preview expired. Refresh it before importing.");
          const ids = [...new Set(payload.indices || [])];
          if (!Array.isArray(payload.indices) || ids.some((id) => !Number.isInteger(id) || id < 0 || id >= preview.candidates.length)) throw new Error("Choose valid previewed issues.");
          const queueId = String(payload.queueId || `${preview.source}-intake`).toLowerCase();
          if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(queueId)) throw new Error("Queue id must use letters, numbers, _ or -.");
          const state = loadState(root), selected = ids.map((id) => preview.candidates[id]);
          const imported = importCandidates(root, state, selected, { cfg: readManagerConfig(root) });
          saveState(root, state, { expectedRevision: state.revision || 0 });
          if (!loadQueueBook(root).queues[queueId]) queueCreate(root, queueId, { name: `${preview.source.toUpperCase()} intake` });
          for (const item of imported.created) queueAdd(root, item.task.id, { queueId });
          intakePreviews.delete(String(payload.token));
          json(res, 200, { ok: true, queueId, added: imported.added, skipped: imported.skipped, taskIds: imported.created.map((item) => item.task.id) });
        } catch (error) { json(res, 400, { ok: false, error: error.message }); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/tasks/provider-route") {
        const payload = JSON.parse(await readBody(req) || "{}");
        if (run.status === "running" || planningRunActive(root)) { json(res, 409, { ok: false, error: "Wait for the active run to finish before changing a task route." }); return; }
        const state = loadState(root), task = state.tasks[String(payload.taskId || "")];
        if (!task || ["archived", "rejected"].includes(task.status)) { json(res, 404, { ok: false, error: "Task is unavailable." }); return; }
        let route = null;
        if (payload.provider !== null) {
          const provider = String(payload.provider || "").trim().toLowerCase(), model = String(payload.model || "").trim();
          if (!provider || !model || model.length > 200 || !/^[a-z0-9][a-z0-9._-]*$/.test(provider)) { json(res, 400, { ok: false, error: "Choose a configured provider and exact model id." }); return; }
          const config = readManagerConfig(root);
          if (!providerNames(providerProfile(config)).includes(provider)) { json(res, 400, { ok: false, error: "Provider is not configured." }); return; }
          const preview = routeTask(config, { ...task, provider_route: { provider, model } }, "rowan");
          if (preview.decision.blocked) { json(res, 400, { ok: false, error: preview.decision.blocked }); return; }
          route = { provider, model };
        }
        const previous = task.provider_route || null;
        if (route) task.provider_route = route; else delete task.provider_route;
        logEvent(state, { task: task.id, actor: "owner", event: "task_provider_route_changed", detail: `${previous ? `${previous.provider}/${previous.model}` : "automatic/project route"} ? ${route ? `${route.provider}/${route.model}` : "automatic/project route"}` });
        saveState(root, state, { expectedRevision: state.revision || 0 });
        json(res, 200, { ok: true, route, preview: taskResourcePreview(readManagerConfig(root), task) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/tasks/session-budget") {
        const payload = JSON.parse(await readBody(req) || "{}");
        const additional = payload.additionalSessions;
        if (!Number.isInteger(additional) || additional < 1 || additional > 20) { json(res, 400, { error: "Add between 1 and 20 sessions." }); return; }
        if (run.status === "running" || planningRunActive(root)) { json(res, 409, { error: "Stop the active queue run before changing a task budget." }); return; }
        const state = loadState(root);
        const task = state.tasks[String(payload.taskId || "")];
        const budget = task?.execution_budget;
        if (!task || ["done", "archived", "rejected"].includes(task.status) || !budget || !Number.isInteger(budget.used) || !Number.isInteger(budget.max_sessions) || budget.used < 0 || budget.max_sessions < 1 || budget.max_sessions + additional > 1000) { json(res, 400, { error: "This task has no adjustable session budget, or the limit would exceed 1000." }); return; }
        const previous = budget.max_sessions;
        budget.max_sessions += additional;
        budget.source = 'owner';
        logEvent(state, { task: task.id, actor: "owner", event: "session_budget_increased", detail: `Limit increased from ${previous} to ${budget.max_sessions}; ${budget.used} already used` });
        saveState(root, state, { expectedRevision: state.revision || 0 });
        json(res, 200, { ok: true, budget });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/run/preview") {
        const payload = JSON.parse(await readBody(req) || "{}");
        const resolved = resolvePreviewSafe(root, {
          taskIds: Array.isArray(payload.taskIds) ? payload.taskIds.map((id) => String(id)) : null,
          queueId: payload.queueId || null,
          queueIds: Array.isArray(payload.queueIds) ? payload.queueIds.map((id) => String(id)) : null,
          maxMinutes: Number(payload.maxMinutes || 120),
          maxSessions: payload.maxSessions === undefined ? null : Number(payload.maxSessions),
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
        const policy=resourcePolicy(readManagerConfig(root));
        const maxSessions = payload.maxSessions === undefined ? (policy.enabled?policy.max_sessions:policy.default_sessions) : Number(payload.maxSessions);
        if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 50) { json(res, 400, { error: "Sessions per task must be between 1 and 50." }); return; }
        const action = { project: path.resolve(root), task: null, operation: "run.queue", target: payload.queueId || "selected", args: { taskIds: payload.taskIds || null, queueIds: payload.queueIds || null, maxSessions, maxMinutes: Number(payload.maxMinutes || (payload.taskIds?.length ? 60 : 120)) }, revision: createControlPlaneSnapshot(root).state.revision, policyVersion: 1 };
        let approval = authorizeAction(root, action);
        if (!approval.allowed) {
          // Browser confirmation proposes the exact action. The owner must
          // decide in Approval Center before any provider starts.
          const proposal = proposeAction(root, action, { principal: "owner" });
          if (req.headers.origin) { json(res, 202, { ok: true, approvalRequired: true, proposal, error: "owner approval required before execution" }); return; }
          // Legacy non-browser callers retain the explicit CLI confirmation
          // boundary; browser actions always use the visible approval flow.
          decideProposal(root, proposal.id, "allow-once", { principal: "owner" });
          approval = authorizeAction(root, action);
          if (!approval.allowed) { json(res, 403, { ok: false, error: approval.reason, proposal }); return; }
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
          maxSessions,
          onProgress: (line) => { run.progress.push(String(line)); run.progress = run.progress.slice(-200); },
        }).then((outcome) => {
          recordActionOutcome(root, action, outcome);
          Object.assign(run, { status: outcome.status || "complete", delivery: outcome.delivery || null, finishedAt: new Date().toISOString(), results: outcome.results || [], reason: outcome.reason || null });
        }).catch((error) => {
          recordActionOutcome(root, action, { status: "failed", reason: error.message, failed: true });
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
      if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/resource-policy') {
        try {
          if(req.method==='POST') {
            if(planningRunActive(root))return json(res,409,{ok:false,error:'Resource policy applies to new sessions. Wait for the active queue run to finish before changing it.'});
            saveResourcePolicy(root,JSON.parse(await readBody(req)||'{}'));
          }
          return json(res,200,{ok:true,...resourceView(root)});
        }catch(error){return json(res,400,{ok:false,error:error.message});}
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

export async function startControlPlaneServer(root, { host = "127.0.0.1", port = 0, planningInvoke = null, usageFetch = globalThis.fetch, publishFetch = globalThis.fetch, assetRoot = path.dirname(CONTROL_PLANE_FILE), readOnlyPreview = false, intakeAdapters = {} } = {}) {
  const server = createControlPlaneServer(root, { host, planningInvoke, usageFetch, publishFetch, assetRoot, readOnlyPreview, intakeAdapters });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port }, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return { server, host, port: actualPort, url: `http://${host}:${actualPort}/` };
}
