import http from "node:http";
import { createTaskTriage } from './task-triage.mjs';
import { createJiraMcp } from './jira-mcp.mjs';
import fs from "node:fs";
import crypto from 'node:crypto';
import path from "node:path";
import pathTools from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createControlPlaneSnapshot } from "./control-plane.mjs";
import { dispatchTuiCommand } from "./command-console.mjs";
import { buildLaunchPlan, executeLaunchQueue, globalMaxConcurrent, mergeQueues, multiQueueDryRun, queueDryRun, readManagerConfig, reconcileOvernightRun, readRunLock, requestRunAbort } from "./launch.mjs";
import { addProposal, addProposalFeedback, editProposal, generateLocalPlan, savePlanDraft, normalizeProposals, loadPlanDraft, listPlanDrafts, archivePlanDraft, repairPlanDraft, planDraftLabel, regenerateProposal, removeProposal, reorderProposals, runPlanProvider, reviewPlanArtifact, answerPlanQuestion, planningEvidence, approvePlanDraft, validatePlanArtifact, validatePlanGrounding, resolvePlanRepository, repositoryStamp, planDraftIndex, requestRepositoryIds } from "./plan-studio.mjs";
import { invokePlanningProvider } from "./plan-model.mjs";
import { builtinProviderStatus, discoverProvider, providerProfile, providerNames, resolvePlanningModel } from "./providers.mjs";
import { getProvider, loadUserProviders, normalizeThinkingLevel, PROVIDER_TEMPLATES, providerChoices, removeProvider, requireReadyProvider, saveUserProviders, templateById, upsertProvider, wireMismatches } from "./userProviders.mjs";
import { paths, loadState, saveState, logEvent, createTask } from "./state.mjs";
import { providerUsageAdapter, recordRemoteUsage } from "./usage.mjs";
import { approveClaim, registerRoutine, validateSkill } from "./governance.mjs";
import { approvalSnapshot, authorizeAction, decideProposal, proposeAction, recordActionOutcome, revokeGrant } from "./approvals.mjs";
import { registerProject, removeProject, setSupervisorDefaults, supervisorSnapshot } from "./supervisor.mjs";
import { projectWorkMap } from "./project-map.mjs";
import { createBackup, listBackups, previewRestore, restoreBackup } from "./backup.mjs";
import { listRoutineRuns, recoverScheduler, runRoutine, schedulerStatus, schedulerTick } from "./routines.mjs";
import { buildDispatchPlan } from "./dispatcher.mjs";
import { executeSupervisor, requestSupervisorStop } from "./supervisor-runner.mjs";
import { batchMorningSummary, batchSummary, listBatches, readBatch, reconcileBatch, resumeStoppedBatch, runBatch, startBatch, stopBatchRun, validateBatch } from "./batch-runner.mjs";
import { latestFailureSignatures, preventionStatus, recoverMemory, selectContext } from "./operational-memory.mjs";
import { clearOwnerSession, ensureOwnerSession, ownerSessionCookie, rotateOwnerSession, validateOwnerSession } from "./session-auth.mjs";
import { approveDraftPr, createDeliveryPacket, listDeliveryPackets, taskDeliveryReceiptFromRecord } from "./delivery.mjs";
import { inspectHandoffChain } from "./handoffs.mjs";
import { ChangeReviewError, describeChanges, fileDiff } from "./task-changes.mjs";
import { captureChangeReview, listChangeReviews, readChangeReview, unavailableReview } from "./change-review-store.mjs";
import { buildExecutionProjection } from "./execution-projection.mjs";
import { taskStatechart } from "./task-statechart.mjs";
import { createAssistant, assistantContext, assistantMessageDigest, assistantWorkspace } from "./control-assistant.mjs";
import { previewPlanPublish, publishPlan, verifyImportedSource, refreshImportedAzureSource } from "./plan-publish.mjs";
import { runEgmReview, runGlmGoldfishReview, readEgmReviewConfig, parseEgmReports, egmReviewBudgetGate } from "./egm-review.mjs";
import { acquireReviewLock, releaseReviewLock, reviewPolicyCheck } from "./plan-studio.mjs";
import { installSkill, designateSkill } from "./skill-install.mjs";
import { executionAccess, saveExecutionAccess, probeWorkspaceAccess } from "./execution-access.mjs";
import { browserAccess, saveBrowserAccess, checkBrowserRuntime } from "./browser-access.mjs";
import { resourcePolicy, resourceView, saveResourcePolicy, taskResourcePreview, routeTask, assertModelAllowed } from "./resource-policy.mjs";
import {recordExecution,publishPlanningExecution} from './execution-report.mjs';
import {recordQuotaFailure, quotaStatus} from './provider-quota.mjs';
import { runIntake, normalizeGitHubRepo, intakeFromAzure, intakeFromGitHub } from './intake.mjs';
import { loadConnections, saveConnections, validateConnection, sameConnection, connectionIdentity } from './issue-connections.mjs';
import { importCandidates } from './composer.mjs';
import { queueCreate, queueAdd, loadQueueBook } from './queue.mjs';
import { azureIdentity, saveAzureConnection, readAzureConnection, forgetAzureConnection } from './azure-connection.mjs';
import { createMyTasksEngine } from './my-tasks.mjs';
import { createMyTasksReviews } from './my-tasks-reviews.mjs';
import { acquireLease, releaseLease } from './leases.mjs';
import { assertPreparationReady, addManualInvestigation, addPreparationQuestion, answerPreparationQuestion, beginDiscoveryRun, buildDiscoveryPrompt, finishDiscoveryRun, handoffPreparation, parseDiscoveryJson, preparationInventory, preparationSeedContext, preparationView, readPreparation, savePreparationBrief } from './task-preparation.mjs';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTROL_PLANE_FILE = path.join(RUNTIME_DIR, "..", "control-plane.html");
const builtinOperations = new Map();
// Batch ids with a runner active in this process. The checkpoint lease remains
// the durable authority across processes.
const runningBatches = new Set();

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
      throw new Error("GapGPT installation is unavailable until the provider publishes a versioned installer with a verifiable checksum. Install it using the provider's documented release process.");
    } else {
      command = process.platform === "win32" ? "npm.cmd" : "npm";
      args = ["install", "--global", `${id === "codex" ? "@openai/codex" : "@anthropic-ai/claude-code"}@${id === "codex" ? "0.169.0" : "2.1.326"}`];
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

function isLoopbackHost(hostname) {
  const value = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function isSameLoopbackOrigin(req, server) {
  try {
    const origin = new URL(String(req.headers.origin));
    const request = new URL(`http://${req.headers.host}`);
    const address = server.address();
    return origin.protocol === "http:" && request.protocol === "http:" &&
      isLoopbackHost(origin.hostname) && isLoopbackHost(request.hostname) &&
      Number(origin.port || 80) === address.port && Number(request.port || 80) === address.port &&
      origin.origin === request.origin;
  } catch { return false; }
}

function sendHtml(res, root, assetRoot = path.dirname(CONTROL_PLANE_FILE), embedded = false) {
  const source = fs.readFileSync(path.join(assetRoot, "control-plane.html"), "utf8");
  // The downloaded artifact contains its own demo controller. The live ATL
  // client is the single controller for the served surface; leaving both
  // document listeners active makes route clicks race and can make Tasks
  // appear to open another page. Keep the artifact's DOM/CSS intact while
  // removing only that stale inline controller at the HTTP boundary.
  let bodyText = source.replace(/<script(?: type="application\/x-atl-legacy-disabled")?>\s*\(\(\)=>[\s\S]*?<\/script><script src="\.\/control-plane-client\.js"><\/script>/, '<script src="./control-plane-i18n.js"></script><script src="./control-plane-client.js"></script>');
  bodyText = bodyText.replace('<script src="./control-plane-client.js">', '<script src="./control-plane-changes.js"></script><script src="./control-plane-client.js">');
  bodyText = bodyText.replace('<script src="./control-plane-client.js">', '<script src="./control-plane-my-tasks.js"></script><script src="./control-plane-client.js">');
  // The checked-in standalone artifact predates the live client and places
  // the body inside the flex topbar. Close that shell boundary for the live
  // surface; otherwise the header's flex rules squeeze and center the page.
  bodyText = bodyText.replace('<div id="mobile" class="mobile">', '</header><div id="mobile" class="mobile">');
  // The artifact's footer and topbar pill honestly describe its offline demo
  // mode. The served surface reads and drives the real workspace, so relabel
  // them here; the standalone file keeps its mock banner.
  bodyText = bodyText
    .replace("<span>● Interactive mock · No provider calls, skill execution or real ATL actions</span>", `<span>● Live · connected to ${escapeText(path.basename(root))}</span>`)
    .replace('<span class="pill hotkey">INTERACTIVE DEMO</span>', '<span class="pill hotkey">LIVE</span>')
    // The sidebar workspace card describes the served project, not the demo
    // checkout (#32): every surface that reads it (plugin chip included) must
    // show the real workspace.
    .replace('<div class="workspace"><div class="row between"><strong>agent-trust-ladder</strong><span class="green">●</span></div><div class="muted tiny">main · control-plane / demo</div></div>', `<div class="workspace"><div class="row between"><strong>${escapeText(path.basename(root))}</strong><span class="green">●</span></div><div class="muted tiny">${escapeText(root)}</div></div>`);
  // A browser surface opened by the plugin (valid panel capability) presents
  // the compact plugin layout, exactly like the in-panel app does (#33).
  if (embedded) bodyText = bodyText.replace('<html lang="en">', '<html lang="en" data-atl-context="plugin">');
  const session = ensureOwnerSession(root);
  bodyText = bodyText.replace("</head>", `<meta name="atl-csrf" content="${escapeText(session.csrf)}"></head>`);
  const body = Buffer.from(bodyText, "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": body.length,
    "set-cookie": ownerSessionCookie(session.token, { embedded }),
    "referrer-policy": "no-referrer",
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

// The overnight-run gate serializes planning provider calls (generate,
// review, regenerate) against queue runs so quota-limited providers are not
// shared mid-run. Owners who accept sharing the provider with an active run
// set planning.concurrentWithQueueRun=true in manager settings and the gate
// stops refusing planning and review calls while a run is active.
function planningConcurrentAllowed(root) {
  try { return readManagerConfig(root).planning?.concurrentWithQueueRun === true; } catch { return false; }
}
function planningRunActive(root) {
  const lock = readRunLock(root);
  if (!lock?.pid) return false;
  try { process.kill(lock.pid, 0); return true; } catch { return false; }
}

// The browser Studio draft response: artifact plus the honest source label.
function draftResponse(loaded, root) {
  const policyView = (() => { try { return reviewPolicyCheck(root, loaded.artifact, loaded.review || loaded.artifact?.review); } catch { return { required: false, reasons: [] }; } })();
  const { dir, intentPath, artifactPath, ...safe } = loaded;
  const config=readManagerConfig(root);
  const resources=loaded.stage === "repair" ? {} : Object.fromEntries(normalizeProposals(loaded.artifact).map(p=>[p.id,taskResourcePreview(config,{...p,risk:loaded.artifact?.risk||'normal'})]));
  // Repository binding surfaced for badges: null when unassigned (project root
  // inspects as before), bindingError set when the binding can no longer be
  // resolved so the UI can show the blocker instead of hiding it.
  const repositoryView = (() => {
    try {
      const resolved = resolvePlanRepository(root, loaded);
      if (!resolved.repository_id) return null;
      return { id: resolved.repository_id, name: resolved.repository_name, root: resolved.repository_root, revision: loaded.repository?.revision || resolved.repository_revision || null, bindingError: null };
    } catch (error) {
      return { id: loaded?.repository?.id || loaded?.repository_id || null, name: loaded?.repository?.name || null, root: loaded?.repository?.root || null, revision: null, bindingError: error.message };
    }
  })();
  return { ...safe, resources, policy: policyView, repository: repositoryView, intent: loaded.intent ?? (loaded.intentPath && fs.existsSync(loaded.intentPath) ? fs.readFileSync(loaded.intentPath, "utf8") : null), label: planDraftLabel(loaded) };
}

// The planning invoke seam: production spawns the configured user provider;
// verification injects a deterministic fake so no real CLI is ever launched.
async function planningCall({ planningInvoke, planningRoot }, entry, call) {
  const start={id:`planning:${crypto.randomUUID()}`,draftId:path.basename(path.dirname(call.logPath)),role:call.request.task_triage?'task-triage':call.request.my_tasks_review?'my-tasks-review':call.request.review?'planning-review':call.request.current_proposal?'planning-regenerate':'planning',provider:entry.id,model:entry.model,startedAt:new Date().toISOString(),logPath:call.logPath};
  recordExecution(planningRoot,start);
  try {
    const result=planningInvoke?await planningInvoke({ ...call, root: planningRoot }):await invokePlanningProvider(planningRoot, entry, { request: call.request, logPath: call.logPath, timeoutMs: call.timeoutMs, unsetEnv: call.unsetEnv });
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
    const worker = builtinProviderStatus({providers:providerConfig(root)}).find((item)=>item.id===route.worker);
    if(!worker?.installed)throw Error(`${route.worker} CLI is not installed — see Settings → Providers`);
    if(!worker.signedIn)throw Error(`${route.worker} CLI is not signed in — see Settings → Providers`);
    return {id:route.worker,worker:route.worker,model:resolvePlanningModel(worker,route.model),builtin:true,command:route.provider.command,resource_decision:route.decision};
  }
  const registry=loadUserProviders();
  // Signed-in subscription CLIs (codex / gapgpt / claude) plan directly with
  // no key; a same-named registry entry always wins.
  if(id&&!registry.providers?.[id]&&['codex','gapgpt','claude'].includes(id)){
    const worker=builtinProviderStatus({providers:providerConfig(root)}).find((item)=>item.id===id);
    if(!worker?.installed)throw Error(`${id} CLI is not installed — see Settings → Providers`);
    if(!worker.signedIn)throw Error(`${id} CLI is not signed in — see Settings → Providers`);
    return {id,worker:id,model:resolvePlanningModel(worker,payload.model),builtin:true,command:worker.command};
  }
  return requireReadyProvider(id,{registry}).withModel(payload.model);
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

function assertDraftUsesCurrentImportedSource(root, draft) {
  if (!draft.source_task_id) return;
  const task = loadState(root).tasks[draft.source_task_id];
  if (task?.source_refreshed_at && String(draft.source_revision_at_creation || "") !== String(task.source?.revision || "")) {
    const error = new Error("This draft was created before the imported request was refreshed. Generate a new plan from the updated request, then review it.");
    error.statusCode = 409;
    throw error;
  }
}

async function handlePlanEndpoint(root, res, pathname, req, seam = {}) {
  const payload = JSON.parse(await readBody(req) || "{}");
  if (pathname === "/api/plan/source-refresh") {
    try { return json(res, 200, { ok: true, source: await refreshImportedAzureSource(root, String(payload.taskId || ""), { fetchImpl: seam.publishFetch, azureToken: await seam.azureToken?.() }) }); }
    catch (error) { return json(res, 409, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/archive") {
    try { return json(res, 200, { ok: true, archived: archivePlanDraft(root, String(payload.draftId || "")) }); }
    catch (error) { return json(res, 409, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/drafts") {
    try {
      if (payload.draftId) return json(res, 200, { ok: true, draft: draftResponse(loadPlanDraft(root, String(payload.draftId)), root) });
      return json(res, 200, { ok: true, drafts: listPlanDrafts(root).slice(0, 20).map((draft) => ({ id: draft.id, title: draft.artifact?.title || draft.intent.trim().split("\n")[0], stage: draft.stage, saved_at: draft.saved_at })) });
    } catch (error) { return json(res, 400, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/repair") {
    try {
      const draft = repairPlanDraft(root, String(payload.draftId || ""), payload.response, { expectedRevision: payload.revision });
      return json(res, 200, { ok: true, draft: draftResponse(draft, root) });
    } catch (error) { return json(res, 400, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/local") {
    const intent = String(payload.intent || "").trim();
    if (!intent) return json(res, 400, { ok: false, error: "plan generation needs an intent" });
    try {
      // A local skeleton inherits the source request's repository binding (or
      // the explicitly chosen linked repository) so later model completion,
      // review, and approval ground against that repo.
      const repository = payload.sourceTaskId || payload.repositoryId ? repositoryStamp(root, { source_task_id: payload.sourceTaskId || null, repository_id: payload.repositoryId ? String(payload.repositoryId) : null }) : null;
      const draft = savePlanDraft(root, { intent, artifact: generateLocalPlan(intent), stage: "frame", sourceTaskId: payload.sourceTaskId || null, repository });
      return json(res, 200, { ok: true, draft: draftResponse(draft, root) });
    }
    catch (error) { return json(res, error.statusCode || 400, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/generate") {
    const intent = String(payload.intent || "").trim();
    if (!intent) return json(res, 400, { ok: false, error: "plan generation needs an intent" });
    try {
      // Spec 022 first: a prepared request stays locked until its preparation
      // record is ready (every consequential question answered) and the Azure
      // revision has not drifted — this is cheaper than provider resolution
      // and names the real blocker instead of "provider id required".
      try { assertPreparationReady(root, payload.sourceTaskId ? String(payload.sourceTaskId) : null); }
      catch (error) { return json(res, 409, { ok: false, error: error.message, preparation: error.preparation || null }); }
      if (!planningConcurrentAllowed(root) && planningRunActive(root)) return json(res, 409, { ok: false, error: "an overnight queue run is active — planning calls wait until the run gate is free (or set planning.concurrentWithQueueRun=true in manager settings)" });
      // Provider-backed generation is always an explicit, bounded spend: the
      // provider must be configured and ready, no queue run may be active,
      // and the call itself is one confirmed planning session with a timeout.
      const entry = planningEntry(root,payload,{title:intent});
      if (payload.thinking_level !== undefined && payload.thinking_level !== null) entry.thinking_level = normalizeThinkingLevel(payload.thinking_level);
      const draft = await runPlanProvider(root, intent, {
        confirm: payload.confirm === true,
        role: "pip",
        provider: entry.id,
        sourceTaskId: payload.sourceTaskId || null,
        repositoryId: payload.repositoryId ? String(payload.repositoryId) : null,
        invoke: (call) => planningCall(seam, entry, call),
      });
      return json(res, 200, { ok: true, draft: draftResponse(draft, root) });
    } catch (error) {
      return json(res, error.statusCode || 400, { ok: false, error: error.message, providerResponse: error.providerResponse || null, providerLogLines: providerLogTail(error), recoveryDraft: error.recoveryDraft ? draftResponse(error.recoveryDraft, root) : null });
    }
  }
  if (pathname === "/api/plan/review-progress") {
    try {
      const loaded = loadPlanDraft(root, String(payload.draftId || ""));
      const egmRoot = path.join(loaded.dir, "egm");
      let latest = null;
      if (fs.existsSync(egmRoot)) for (const run of fs.readdirSync(egmRoot).sort()) {
        const progressFile = path.join(egmRoot, run, "progress.json");
        if (fs.existsSync(progressFile)) latest = { run, entries: JSON.parse(fs.readFileSync(progressFile, "utf8")), cancelled: fs.existsSync(path.join(egmRoot, run, "cancel.flag")) };
      }
      return json(res, 200, { ok: true, progress: latest });
    } catch (error) { return json(res, error.statusCode || 400, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/review-cancel") {
    try {
      const loaded = loadPlanDraft(root, String(payload.draftId || ""));
      const egmRoot = path.join(loaded.dir, "egm");
      let flagged = false;
      if (fs.existsSync(egmRoot)) for (const run of fs.readdirSync(egmRoot).sort()) {
        const dir = path.join(egmRoot, run);
        if (fs.existsSync(path.join(dir, "progress.json")) && !fs.existsSync(path.join(dir, "cancel.flag"))) { fs.writeFileSync(path.join(dir, "cancel.flag"), new Date().toISOString()); flagged = true; }
      }
      return json(res, flagged ? 202 : 409, { ok: flagged, error: flagged ? null : "no cancellable deep review is in flight for this draft" });
    } catch (error) { return json(res, error.statusCode || 400, { ok: false, error: error.message }); }
  }
  if (pathname === "/api/plan/review") {
    const draftId = String(payload.draftId || "");
    if (String(payload.reviewType || "") === "egm") {
      let reviewKey = null;
      let reviewDir = null;
      try {
        const loaded = loadPlanDraft(root, draftId);
        assertDraftUsesCurrentImportedSource(root, loaded);
        const artifact = loaded.artifact;
        const repoRoot = resolvePlanRepository(root, loaded).repoRoot;
        if (!artifact || artifact.plan_contract_version !== 2) return json(res, 409, { ok: false, error: "local skeleton and legacy drafts need a version 2 model plan first — use Complete with model, then review" });
        validatePlanArtifact(artifact);
        validatePlanGrounding(root, artifact, { repoRoot });
        if (!planningConcurrentAllowed(root) && planningRunActive(root)) return json(res, 409, { ok: false, error: "an overnight queue run is active — plan review waits until the run gate is free (or set planning.concurrentWithQueueRun=true in manager settings)" });
        const config = readEgmReviewConfig(readManagerConfig(root));
        if (!config.enabled) return json(res, 409, { ok: false, error: "EGM deep review is not usable: " + config.problems.join(" ") });
        const egmProviderId = payload.provider || loaded.provider;
        if (config.backend === "glm-goldfish" && !egmProviderId) return json(res, 400, { ok: false, error: "select a configured provider for the glm-goldfish EGM review" });
        acquireReviewLock(loaded.dir);
        reviewKey = "acquired";
        reviewDir = loaded.dir;
        // Budget gate runs after the lock: a review refused because another one
        // is running must not consume the daily deep-review budget.
        const budget = egmReviewBudgetGate(root, config);
        if (!budget.ok) return json(res, budget.status, { ok: false, error: budget.reason });
        const projectEvidence = planningEvidence(root, artifact, { repoRoot });
        const configOnly = readManagerConfig(root);
        const run = config.backend === "glm-goldfish"
          ? await (seam.egmRunner || runGlmGoldfishReview)(root, { draft: loaded, config, call: ({ stage, request, logPath }) => { void stage; const providerId = payload.provider || loaded.provider; if (!providerId) { const refusal = new Error("select a configured provider for the glm-goldfish EGM review"); refusal.statusCode = 400; throw refusal; } const entry = planningEntry(root, payload, { ...artifact, title: artifact.title || loaded.intent }, "planning-review", providerId); return planningCall(seam, entry, { logPath, request }); } })
          : await (seam.egmRunner || runEgmReview)(root, { cfg: configOnly, draft: loaded });
        if (run.timedOut || run.exitCode !== 0) {
          const failure = new Error(`EGM review failed (exit ${run.exitCode}). The raw run is preserved at ${run.workdir}; no review was recorded.`);
          failure.statusCode = 502;
          failure.workdir = run.workdir;
          throw failure;
        }
        // Staleness first: an edit during the review is a 409 even when the
        // provider also returned an unreadable report.
        const current = loadPlanDraft(root, draftId);
        if ((Number(current.revision) || 1) !== (loaded.revision || 1)) {
          const stale = new Error("plan review is stale because the draft changed while the provider was reviewing it");
          stale.statusCode = 409;
          throw stale;
        }
        const parsed = parseEgmReports(run.workdir);
        if (parsed.missingReports.length) {
          const failure = new Error(`EGM review incomplete — missing report files: ${parsed.missingReports.join(", ")}. The raw run is preserved at ${run.workdir}; no review was recorded.`);
          failure.statusCode = 502;
          failure.workdir = run.workdir;
          throw failure;
        }
        if (parsed.verdictHint !== "passed" && parsed.findings.length === 0) {
          const failure = new Error(`EGM review produced an unreadable consolidated report (verdict hint "${parsed.verdictHint ?? "none"}", zero parseable findings${parsed.severitySectionsSeen ? " despite severity sections being present" : ""}). The raw run is preserved at ${run.workdir}; no review was recorded.`);
          failure.statusCode = 502;
          failure.workdir = run.workdir;
          throw failure;
        }
        const verdict = parsed.verdictHint === "passed" && !parsed.findings.some((finding) => ["blocker", "major"].includes(finding.severity)) ? "passed" : "blocked";
        const updated = reviewPlanArtifact(root, loaded, { verdict, findings: parsed.findings, kind: "egm", provider: config.backend === "glm-goldfish" ? ((run.stageRuns || []).map((stage) => stage.provider).find(Boolean) || egmProviderId) : "codex-egm", model: config.model, egm: { backend: config.backend, version_sha: config.versionSha, model: config.model || (run.stageRuns || []).map((stage) => stage.model).find(Boolean) || null, workdir: run.workdir, duration_ms: run.durationMs, exit_code: run.exitCode, last_message: run.lastMessage, stage_runs: run.stageRuns || null } }, { expectedRevision: loaded.revision || 1, evidenceSnapshot: projectEvidence, repoRoot });
        return json(res, 200, { ok: true, draft: draftResponse(updated, root), review: updated.review });
      } catch (error) { return json(res, error.statusCode || 400, { ok: false, error: error.message, workdir: error.workdir || null }); }
      finally { if (reviewKey) releaseReviewLock(reviewDir); }
    }
    let reviewKey = null;
    let reviewDir = null;
    try {
      const loaded = loadPlanDraft(root, draftId);
      assertDraftUsesCurrentImportedSource(root, loaded);
      const artifact = loaded.artifact;
      if (loaded.stage === "repair") return json(res, 409, { ok: false, error: "Repair and validate this saved response before requesting accuracy review" });
      const repoRoot = resolvePlanRepository(root, loaded).repoRoot;
      const providerId = payload.provider || loaded.provider;
      if (!providerId) return json(res, 400, { ok: false, error: "select a configured provider for the separate accuracy review" });
      if (artifact.plan_contract_version !== 2) return json(res, 409, { ok: false, error: "local skeleton and legacy drafts need a version 2 model plan first — use Complete with model, then review" });
      validatePlanArtifact(artifact);
      validatePlanGrounding(root, artifact, { repoRoot });
      const entry = planningEntry(root,payload,{...artifact,title:artifact.title||loaded.intent},'planning-review',providerId);
      if (!planningConcurrentAllowed(root) && planningRunActive(root)) return json(res, 409, { ok: false, error: "an overnight queue run is active — plan review waits until the run gate is free (or set planning.concurrentWithQueueRun=true in manager settings)" });
      acquireReviewLock(loaded.dir);
      reviewKey = "acquired";
      reviewDir = loaded.dir;
      const sourceRevision = loaded.source_task_id ? await verifyImportedSource(root, loaded.source_task_id, { fetchImpl: seam.publishFetch, azureToken: await seam.azureToken?.() }) : null;
      const logPath = path.join(loaded.dir, "review.log");
      const projectEvidence = planningEvidence(root, artifact, { repoRoot });
      const evidence = { ...projectEvidence, external_source: sourceRevision };
      const response = await planningCall(seam, entry, { logPath, request: { review: true, task: "Review the proposed plan only. Return JSON with verdict ('passed' or 'blocked') and findings [{severity, requirement_id, task_id, message, correction}]. Do not edit files or claim checks passed.", intent: loaded.intent, artifact, project_evidence: evidence, required: ["verdict", "findings"], rule: "Be strict and evidence-based. Findings must identify the affected requirement or task. Any blocker or major finding means blocked." } });
      if (!response || response.code !== 0) throw new Error(response?.providerFailure?.reason || `Plan review provider failed (code ${response?.code ?? "unknown"})`);
      const text = String(response.text || response.output || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      const result = JSON.parse(text);
      if (!["passed", "blocked"].includes(result.verdict) || !Array.isArray(result.findings)) throw new Error("review response must contain verdict and findings");
      const updated = reviewPlanArtifact(root, loaded, { ...result, source_revision: sourceRevision, provider: response.provider || providerId, model: response.model || payload.model || null }, { expectedRevision: loaded.revision || 1, evidenceSnapshot: projectEvidence, repoRoot });
      return json(res, 200, { ok: true, draft: draftResponse(updated, root), review: updated.review });
    } catch (error) { return json(res, error.statusCode || 400, { ok: false, error: error.message }); }
    finally { if (reviewKey) releaseReviewLock(reviewDir); }
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
      if (draft.stage === "repair") return json(res, 409, { ok: false, error: "Repair and validate this saved response before approval or queueing" });
      if (draft.artifact?.plan_skeleton) { const refusal = new Error("Local skeleton drafts are not approvable — complete the plan with a model, pass a review, then approve"); refusal.statusCode = 409; throw refusal; }
      if (draft.source_task_id) {
        const current = await verifyImportedSource(root, draft.source_task_id, { fetchImpl: seam.publishFetch, azureToken: await seam.azureToken?.() });
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
      if (!planningConcurrentAllowed(root) && planningRunActive(root)) return json(res, 409, { ok: false, error: "an overnight queue run is active — planning calls wait until the run gate is free (or set planning.concurrentWithQueueRun=true in manager settings)" });
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

// Spec 021 "My Tasks" endpoints. Reads serve the dashboard from the local
// store; the manual check and the clock hook mirror /api/routines semantics.
// The PAT never enters any response: it stays inside the engine's call scope.
async function handleMyTasksEndpoint(root, res, url, req, myTasks, azureToken, reviews, triage, jira, seam) {
  const path = url.pathname;
  const fail = (error) => {
    // Preparation errors carry an explicit statusCode (409 conflict, 404 gone)
    // that must survive; everything else keeps the My Tasks mapping.
    const status = error?.statusCode ? error.statusCode : error?.code === "ATL_MYTASKS_AUTH" ? 401 : error?.code === "ATL_MYTASKS_FORBIDDEN" ? 403 : 400;
    json(res, status, { ok: false, error: error?.message || "My Tasks request failed.", code: error?.code || null, ...(error?.preparation ? { preparation: error.preparation } : {}) });
  };
  try {
    const locale = url.searchParams.get('locale');
    if (path.startsWith('/api/my-tasks/triage')) {
      if (req.method === 'GET') return json(res, 200, { ok: true, ...(path.endsWith('/status') || path.endsWith('/settings') ? triage.status() : { triage: triage.get(url.searchParams.get('key'), locale) }) });
      const payload = JSON.parse(await readBody(req) || '{}');
      if (path.endsWith('/settings')) { await triage.validateSettings(payload); triage.saveSettings(payload); }
      else triage.ensure(payload.key);
      void triage.tick(); return json(res, 200, { ok: true, ...triage.status() });
    }
    if (path.startsWith('/api/my-tasks/jira/')) {
      const action = path.split('/').pop();
      if (req.method === 'GET' && action === 'callback') { await jira.finish(url.searchParams.get('code'), url.searchParams.get('state')); res.writeHead(302, { Location: '/?page=mytasks', 'Cache-Control': 'no-store' }); res.end(); return; }
      if (req.method === 'GET') {
        const result = action === 'sites' ? { sites: await jira.sites() } : action === 'projects' ? { projects: await jira.projects(url.searchParams.get('site')) } : { jira: jira.status(), proposals: jira.proposals() };
        return json(res, 200, { ok: true, ...result });
      }
      const payload = JSON.parse(await readBody(req) || '{}'); let result;
      if (action === 'authorize') result = await jira.authorize(`http://${req.headers.host}`);
      else if (action === 'settings') { result = await jira.saveSettings(payload); void jira.sync(); }
      else if (action === 'disconnect') { await jira.disconnect(); result = {}; }
      else if (action === 'sync') result = await jira.sync();
      else if (action === 'preview') result = await jira.preview(payload.operation, payload.issueKey, payload.changes);
      else if (action === 'read') result = await jira.read(payload.operation, payload.arguments || {});
      else if (action === 'commit') {
        if (req.headers.origin !== `http://${req.headers.host}`) throw Error('Approve Jira writes in the ATL browser.');
        result = await jira.commit(payload.id, payload.approved);
      } else throw Error('Unknown Jira action');
      return json(res, 200, { ok: true, result });
    }
    if (req.method === 'GET' && path === '/api/my-tasks/repository-bindings') {
      return json(res, 200, { ok: true, bindings: reviews.bindings(), repositories: supervisorSnapshot().projects.map(({ id, name }) => ({ id, name })) });
    }
    if (req.method === 'POST' && path === '/api/my-tasks/repository-bindings') {
      const bindings = reviews.saveBindings(JSON.parse(await readBody(req) || '{}'));
      void reviews.tick();
      return json(res, 200, { ok: true, bindings });
    }
    if (req.method === 'GET' && path === '/api/my-tasks/review') {
      const key = url.searchParams.get('key');
      if (!myTasks.item(key)) return json(res, 404, { ok: false, error: 'Task is no longer assigned.' });
      return json(res, 200, { ok: true, review: reviews.get(key, locale || undefined) });
    }
    if (req.method === 'GET' && path === '/api/my-tasks/reviews/status') return json(res, 200, { ok: true, ...reviews.status(locale || undefined) });
    if (req.method === 'POST' && ['/api/my-tasks/reviews/ensure', '/api/my-tasks/review/retry'].includes(path)) {
      const payload = JSON.parse(await readBody(req) || '{}');
      if (payload.locale && !['fa-IR', 'en-US'].includes(payload.locale)) throw new Error('Unsupported review language.');
      if (path.endsWith('/retry') && !myTasks.item(payload.key)) throw new Error('Task is no longer assigned.');
      const status = reviews.ensure(payload.locale, { retryKey: path.endsWith('/retry') ? payload.key : null, resume: payload.resume === true });
      void reviews.tick();
      return json(res, 200, { ok: true, ...status });
    }
    if (req.method === "GET" && path === "/api/my-tasks/projects") {
      const tokenInfo = await azureToken();
      const settings = myTasks.settings();
      const cfg = readManagerConfig(root).intake?.azure || {};
      if (!tokenInfo) return json(res, 200, { ok: true, connected: false, token_present: false, identity: null, projects: [] });
      const listed = await myTasks.projects();
      json(res, 200, { ok: true, connected: true, token_present: true, credential_source: Boolean(cfg.org_url && cfg.project) ? "saved-connection" : "saved-connection", org_url: cfg.org_url || "", project: cfg.project || "", identity: listed.identity, projects: listed.projects, settings });
      return;
    }
    if (req.method === "GET" && path === "/api/my-tasks/settings") {
      const tokenInfo = await azureToken();
      const cfg = readManagerConfig(root).intake?.azure || {};
      json(res, 200, { ok: true, settings: myTasks.settings(), connection: { org_url: cfg.org_url || "", project: cfg.project || "", token_present: Boolean(tokenInfo), remember_supported: process.platform === "win32" } });
      return;
    }
    if (req.method === "POST" && path === "/api/my-tasks/settings") {
      const payload = JSON.parse(await readBody(req) || "{}");
      if (payload.startup_mode === "windows" && process.platform !== "win32") {
        json(res, 400, { ok: false, error: "Starting My Tasks at login is currently supported on Windows only. Choose runtime startup instead." });
        return;
      }
      const previousSettings = myTasks.settings();
      const wasPaused = Boolean(myTasks.status().paused);
      const saved = myTasks.saveSettings({
        enabled: true,
        schedule_on: true,
        ...(payload.startup_mode !== undefined ? { startup_mode: payload.startup_mode } : {}),
        ...(payload.interval_minutes !== undefined ? { interval_minutes: payload.interval_minutes } : {}),
        ...(payload.projects !== undefined ? { projects: payload.projects } : {}),
      });
      if (process.platform === "win32" && payload.startup_mode !== undefined) {
        const startupDir = pathTools.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
        const startupFile = pathTools.join(startupDir, "ATL My Tasks.vbs");
        if (saved.startup_mode === "windows") {
          if (!process.env.APPDATA) throw new Error("The Windows startup folder is unavailable for this account.");
          const runtimeEntry = pathTools.resolve(pathTools.dirname(fileURLToPath(import.meta.url)), "..", "atl-manager.mjs");
          const script = buildWindowsMyTasksStartupScript({ nodePath: process.execPath, runtimeEntry, projectRoot: root });
          fs.mkdirSync(startupDir, { recursive: true });
          fs.writeFileSync(startupFile, script, "utf8");
        } else {
          try { fs.rmSync(startupFile, { force: true }); } catch { /* no prior startup entry */ }
        }
      }
      if (saved.enabled) {
        myTasks.start();
        // Saving selected projects must fetch them immediately even when the
        // scheduler was already running from runtime startup.
        const projectsChanged = JSON.stringify(previousSettings.projects) !== JSON.stringify(saved.projects);
        if (saved.schedule_on && (projectsChanged || !previousSettings.enabled || !previousSettings.schedule_on || wasPaused)) {
          void myTasks.check({ reason: "settings" }).catch(() => {});
        }
      } else myTasks.stop();
      json(res, 200, { ok: true, settings: saved, status: myTasks.status() });
      return;
    }
    if (req.method === "POST" && path === "/api/my-tasks/check") {
      const [azureResult, jiraResult] = await Promise.allSettled([myTasks.settings().enabled ? myTasks.check({ reason: 'manual' }) : Promise.resolve({ skipped: true }), jira.sync()]);
      if (azureResult.status === 'rejected' && !jira.config().enabled) throw azureResult.reason;
      json(res, 200, { ok: true, ...(azureResult.status === 'fulfilled' ? azureResult.value : { azure_error: 'Azure refresh failed; cached tasks are retained.' }), jira: jiraResult.status === 'fulfilled' ? jiraResult.value : { status: 'error' } });
      return;
    }
    if (req.method === "POST" && path === "/api/my-tasks/tick") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const result = await myTasks.tick(payload.now ? new Date(payload.now) : new Date());
      json(res, 200, { ok: true, ...result });
      return;
    }
    if (req.method === "GET" && path === "/api/my-tasks/status") {
      json(res, 200, { ok: true, ...myTasks.status() });
      return;
    }
    if (req.method === "GET" && path === "/api/my-tasks/items") {
      const result = myTasks.items();
      json(res, 200, { ok: true, ...result, workspace_key: crypto.createHash('sha256').update(root).digest('hex').slice(0, 16), items: triage.decorate(reviews.decorate(result.items, locale || undefined)), reviews: reviews.status(locale || undefined) });
      return;
    }
    if (req.method === "GET" && path === "/api/my-tasks/item") {
      const record = myTasks.item(url.searchParams.get("key") || "");
      if (!record) { json(res, 404, { ok: false, error: "Work item not found in the local store." }); return; }
      json(res, 200, { ok: true, item: record });
      return;
    }
    // Spec 022: persistent per-task preparation between My Tasks and Plan
    // Studio. Reads render from the saved record only, so a provider failure
    // never blanks the preview; writes are revision-guarded (409 on conflict).
    if (req.method === "GET" && path === "/api/my-tasks/preparations") {
      const result = myTasks.items();
      const items = triage.decorate(reviews.decorate(result.items, locale || undefined));
      return json(res, 200, { ok: true, ...preparationInventory(root, { items, seed: url.searchParams.get("seed") !== "off", seedContext: preparationSeedContext(root) }) });
    }
    if (req.method === "GET" && path === "/api/my-tasks/preparation") {
      return json(res, 200, { ok: true, ...preparationView(root, url.searchParams.get("key") || "") });
    }
    if (path.startsWith("/api/my-tasks/preparation/")) {
      if (req.method !== "POST") { json(res, 404, { ok: false, error: "not found" }); return; }
      const payload = JSON.parse(await readBody(req) || "{}");
      const key = String(payload.key || "");
      if (!myTasks.item(key)) return json(res, 404, { ok: false, error: "Task is no longer assigned." });
      const action = path.split("/").pop();
      const view = () => preparationView(root, key);
      if (action === "save") {
        savePreparationBrief(root, key, payload.patch || {}, { expectedRevision: payload.revision });
        return json(res, 200, { ok: true, ...view() });
      }
      if (action === "question") {
        addPreparationQuestion(root, key, payload.question || {}, { expectedRevision: payload.revision });
        return json(res, 200, { ok: true, ...view() });
      }
      if (action === "answer") {
        answerPreparationQuestion(root, key, String(payload.questionId || ""), payload.answer, { expectedRevision: payload.revision });
        return json(res, 200, { ok: true, ...view() });
      }
      if (action === "investigate") {
        const record = readPreparation(root, key);
        if (!record) return json(res, 409, { ok: false, error: "Open the preparation tab and save the brief first." });
        if (payload.mode === "manual") {
          addManualInvestigation(root, key, payload.notes, { expectedRevision: payload.revision });
          return json(res, 200, { ok: true, ...view() });
        }
        // Bounded discovery: provider readiness is refused BEFORE any spend, a
        // second click cannot start a parallel run, and a failure keeps an
        // error run on the record instead of touching the brief.
        const cfg = readManagerConfig(root);
        const profile = cfg.providers || {};
        let entry;
        try {
          entry = planningEntry(root, { provider: payload.provider, model: payload.model }, { title: `Discovery #${myTasks.item(key).id}`, risk: "normal" }, "prep-discovery", profile.use || profile.default);
        } catch (error) {
          return json(res, 400, { ok: false, error: `Discovery provider is not ready — no request was sent: ${error.message}` });
        }
        const repositories = (record.repositories || []).map((id) => {
          const project = supervisorSnapshot().projects.find((candidate) => candidate.id === id);
          return project ? { id: project.id, name: project.name } : { id, name: id };
        });
        const runId = beginDiscoveryRun(root, key, { expectedRevision: payload.revision });
        const logDir = pathTools.join(root, ".trust", "manager", "my-tasks", "preparation-runs");
        fs.mkdirSync(logDir, { recursive: true });
        try {
          const response = await planningCall(seam, entry, { request: { task_preparation_discovery: true, prompt: buildDiscoveryPrompt(myTasks.item(key), record, repositories) }, logPath: pathTools.join(logDir, `${runId}.log`), timeoutMs: 180000, unsetEnv: [cfg.intake?.azure?.token_env || "AZDO_PAT", "AZDO_PAT", "GH_TOKEN", "GITHUB_TOKEN", "JIRA_TOKEN"] });
          if (response.code && response.code !== 0) throw new Error(response.timedOut ? "Discovery timed out at the 3-minute cap; the brief is unchanged." : "Discovery provider could not complete the request.");
          finishDiscoveryRun(root, key, runId, { provider: response.provider, model: response.model, output: parseDiscoveryJson(response.result || response.text || response.stdout || response) });
        } catch (error) {
          finishDiscoveryRun(root, key, runId, { error: error.message });
        }
        return json(res, 200, { ok: true, ...view() });
      }
      if (action === "handoff") {
        const handoff = handoffPreparation(root, key, { azureCfg: readManagerConfig(root).intake?.azure || {}, repositoryIds: Array.isArray(payload.repository_ids) ? payload.repository_ids.map(String) : null });
        return json(res, 200, { ok: true, handoff, ...view() });
      }
      json(res, 404, { ok: false, error: "not found" });
      return;
    }
    json(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    fail(error);
  }
}

export function buildWindowsMyTasksStartupScript({ nodePath, runtimeEntry, projectRoot }) {
  for (const [label, value] of Object.entries({ nodePath, runtimeEntry, projectRoot })) {
    if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) throw new Error(`${label} must be a single-line path.`);
  }
  const quoteVbs = (value) => value.replace(/"/g, '""');
  const node = quoteVbs(nodePath), entry = quoteVbs(runtimeEntry), root = quoteVbs(projectRoot);
  return `Set shell = CreateObject("WScript.Shell")\r\nshell.CurrentDirectory = "${root}"\r\nshell.Environment("PROCESS").Item("ATL_NO_OPEN") = "1"\r\nshell.Run """${node}"" """${entry}"" ui", 0, False\r\n`;
}

// Snapshot fingerprint with per-build volatile stamps removed: build timestamps
// must not make an unchanged dashboard look changed to delta clients.
// observed_at is derived (newest evidence stamp, falling back to the volatile
// state.updated_at), so scheduler rewrites would otherwise dirty every tick.
const VOLATILE_SNAPSHOT_KEYS = ['captured_at', 'checked_at', 'created_at', 'updated_at', 'observed_at'];
const stableSnapshotFingerprint = value => {
  if (Array.isArray(value)) return value.map(stableSnapshotFingerprint);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) if (!VOLATILE_SNAPSHOT_KEYS.includes(key)) out[key] = stableSnapshotFingerprint(value[key]);
    return out;
  }
  return value;
};

export function createControlPlaneServer(root, { host = "127.0.0.1", planningInvoke = null, planningRoot = null, usageFetch = globalThis.fetch, publishFetch = globalThis.fetch, assetRoot = path.dirname(CONTROL_PLANE_FILE), readOnlyPreview = false, intakeAdapters = {}, egmRunner = null, myTasksFetch = null, myTasksReviewInvoke = null, taskTriageInvoke = null, jiraTransportCall = null, azureFetch = globalThis.fetch } = {}) {
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(host)) throw new Error("control plane only supports loopback hosts");
  const ownerSession = rotateOwnerSession(root);
  const seam = { planningInvoke, planningRoot: planningRoot || root, usageFetch, publishFetch, intakeAdapters, egmRunner, azureFetch };
  const intakePreviews = new Map();
  const azureConnectionTokens = new Map();
  const azureCredentialDir = id => path.join(root, '.trust', 'manager', 'credentials', id);
  const redactConnectionSecrets = value => {
    let message = String(value ?? '');
    const secrets = [azureUiToken, ...azureConnectionTokens.values(), ...Object.values(process.env).filter((item, index) => item && /(?:PAT|TOKEN|SECRET|CREDENTIAL)/i.test(Object.keys(process.env)[index] || ''))].filter(Boolean);
    for (const secret of secrets) message = message.split(secret).join('[redacted]');
    return message;
  };
  async function connectionAzureToken(connection) {
    if (!connection || connection.provider !== 'azure') return null;
    if (azureConnectionTokens.has(connection.id)) return azureConnectionTokens.get(connection.id);
    if (connection.credential_ref === 'os-protected') {
      const token = await readAzureConnection(connection.settings, { dir: azureCredentialDir(connection.id) });
      if (token) { azureConnectionTokens.set(connection.id, token); return token; }
    }
    return process.env[connection.settings.token_env || 'AZDO_PAT'] || null;
  }
  // UI-entered Azure PATs live only in this server instance's memory. They
  // are never added to process.env, config files, child worker environments,
  // logs, or API responses.
  let azureUiToken = null;
  let azureTokenIdentity = null, azureLoadedIdentity = null, azureRemembered = false;
  let githubUiToken = null; // session-scoped token from the UI; GITHUB_TOKEN stays untouched
  async function currentAzureToken() {
    const cfg = readManagerConfig(root).intake?.azure || {}, identity = azureIdentity(cfg);
    if (azureTokenIdentity !== identity) { azureUiToken = null; azureRemembered = false; }
    if (azureLoadedIdentity !== identity) {
      azureLoadedIdentity = identity;
      try { azureUiToken = await readAzureConnection(cfg); azureRemembered = Boolean(azureUiToken); } catch { /* UI can reconnect if the OS user cannot decrypt. */ }
      azureTokenIdentity = identity;
    }
    return azureUiToken || process.env[cfg.token_env || 'AZDO_PAT'] || null;
  }
  seam.azureToken = currentAzureToken;
  // Spec 021 "My Tasks": the scheduler lives in this server process. It keeps
  // polling while the browser tab is closed and stops with the service.
  let reviews, triage;
  const jira = createJiraMcp(root, { transportCall: jiraTransportCall, onSynced: () => { if (!readOnlyPreview) { reviews?.ensure(); triage?.ensure(); } } });
  const myTasks = createMyTasksEngine(root, { token: currentAzureToken, onSynced: () => { if (!readOnlyPreview) { reviews?.ensure(); triage?.ensure(); void reviews?.tick(); } }, ...(myTasksFetch ? { requestImpl: myTasksFetch } : {}) });
  const azureItems = myTasks.items.bind(myTasks), azureItem = myTasks.item.bind(myTasks);
  myTasks.items = () => { const data = azureItems(); return { ...data, items: [...data.items, ...(jira.config().enabled ? jira.items() : [])], jira: jira.status() }; };
  myTasks.item = key => azureItem(key) || (jira.config().enabled ? jira.items().find(i => i.key === key) : null);
  seam.myTasks = myTasks;
  myTasks.start();
  const backgroundCanRun = () => {
      if (readOnlyPreview || planningRunActive(root)) return false;
      const supervisor = supervisorSnapshot();
      const roots = new Set([root, ...supervisor.projects.map(p => p.root)]);
      let active = 0;
      for (const directory of roots) {
        try { active += Object.values(JSON.parse(fs.readFileSync(path.join(directory, '.trust/manager/leases.json'), 'utf8')).sessions || {}).filter(l => l.status === 'active' && l.expires_at > Date.now()).length; } catch { /* no live leases */ }
      }
      return active < Math.min(globalMaxConcurrent(root), supervisor.defaults?.maxConcurrent || 2);
    };
  reviews = createMyTasksReviews(root, {
    getItems: () => myTasks.items().items,
    canRun: backgroundCanRun,
    invoke: myTasksReviewInvoke || (async packet => {
      const cfg = readManagerConfig(root), profile = cfg.providers || {};
      if (!profile.use && !profile.default) throw Object.assign(new Error('Review provider is not configured.'), { code: 'REVIEW_PROVIDER_UNAVAILABLE' });
      const entry = planningEntry(root, {}, { title: packet.item.title, risk: 'normal', skill: 'atl-audit' }, 'sage', profile.use || profile.default);
      assertModelAllowed(cfg, entry.id, entry.model);
      if (quotaStatus(root, entry.id, entry.model).status === 'exhausted') throw Object.assign(new Error('Review provider quota exhausted.'), { code: 'REVIEW_PROVIDER_UNAVAILABLE' });
      const request = { my_tasks_review: true, locale: packet.locale, validation_feedback: packet.validation_feedback, task: { id: packet.item.id, title: packet.item.title, state: packet.item.state, description: String(packet.item.description_text || '').slice(0, 16000), acceptance_criteria: String(packet.item.acceptance_criteria || '').slice(0, 8000) }, evidence: packet.evidence, repositories: packet.repositories, skills: packet.skills };
      const lease = acquireLease(root, { project: 'my-tasks', task: 'my-tasks-review', role: 'sage', run: crypto.randomUUID(), ttlMs: packet.timeoutMs + 20000 });
      try { return await planningCall(seam, entry, { request, logPath: packet.logPath, timeoutMs: packet.timeoutMs, unsetEnv: [cfg.intake?.azure?.token_env || 'AZDO_PAT', 'AZDO_PAT', 'GH_TOKEN', 'GITHUB_TOKEN', 'JIRA_TOKEN'] }); }
      finally { releaseLease(root, lease); }
    }),
  });
  triage = createTaskTriage(root, {
    items: () => myTasks.items().items,
    canRun: () => backgroundCanRun() && (!triage?.settings().enabled || quotaStatus(root, triage.settings().provider, triage.settings().model).status !== 'exhausted'),
    invoke: taskTriageInvoke || (async packet => {
      const cfg = readManagerConfig(root), selected = packet.settings;
      const entry = planningEntry(root, { provider: selected.provider, model: selected.model }, { title: 'Task urgency', risk: 'normal' }, 'task-triage', selected.provider);
      if (entry.id !== selected.provider || entry.model !== selected.model) throw Error('Configured GLM Flash model is unavailable; fallback is disabled.');
      assertModelAllowed(cfg, entry.id, entry.model);
      if (quotaStatus(root, entry.id, entry.model).status === 'exhausted') throw Error('Provider quota exhausted');
      const lease = acquireLease(root, { project: 'my-tasks', task: 'task-triage', role: 'sage', run: crypto.randomUUID(), ttlMs: 80000 });
      try { return await planningCall(seam, entry, { request: { task_triage: true, input: packet.input }, logPath: packet.logPath, timeoutMs: packet.timeoutMs, unsetEnv: [cfg.intake?.azure?.token_env || 'AZDO_PAT', 'AZDO_PAT', 'JIRA_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] }); }
      finally { releaseLease(root, lease); }
    })
  });
  triage.validateSettings = async selected => {
    if (!selected.enabled) return;
    if (taskTriageInvoke) return;
    const listed = [...providerView(root).providers, ...providerView(root).builtin].find(p => p.id === selected.provider);
    const models = [listed?.model, ...(listed?.models || []).map(m => typeof m === 'string' ? m : m.id)];
    if (!listed || !models.includes(selected.model) || !/glm.*flash/i.test(selected.model)) throw Error('Select a GLM Flash model listed by the configured provider.');
    const entry = planningEntry(root, { provider: selected.provider, model: selected.model }, { title: 'Task urgency', risk: 'normal' }, 'task-triage', selected.provider);
    if (entry.id !== selected.provider || entry.model !== selected.model) throw Error('Select an available GLM Flash model; fallback is disabled.');
    assertModelAllowed(readManagerConfig(root), entry.id, entry.model);
  };
  if (!readOnlyPreview) { reviews.start(); triage.start(); jira.start(); }
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
  // Build the snapshot once per tick and push it to connected streams only when
  // it actually changed: an idle dashboard then costs one in-process build and
  // zero wire bytes per tick instead of a full snapshot per client every 2 s.
  // Each changed frame gets a monotonically increasing version; reconnecting
  // clients echo the version they hold and receive a tiny liveness block while
  // they are already up to date.
  let cachedFrame = null; // { cursor, content, json } of the latest built snapshot
  let frameVersion = 0;
  let forceFullNextConnect = false; // set on any content change, even without version growth
  const streamTimer = setInterval(() => {
    let snapshot, content;
    try { snapshot = createControlPlaneSnapshot(root); content = JSON.stringify(stableSnapshotFingerprint(snapshot)); } catch { return; }
    if (cachedFrame && cachedFrame.content === content) return;
    frameVersion += 1;
    forceFullNextConnect = Boolean(cachedFrame); // a real change; the first cached build is not one
    cachedFrame = { cursor: frameVersion, content, json: JSON.stringify({ cursor: frameVersion, snapshot }) };
    for (const stream of streams) { try { stream.res.write(`event: snapshot\ndata: ${cachedFrame.json}\n\n`); } catch { streams.delete(stream); } }
  }, 2000);
  streamTimer.unref?.();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}`);
      if (readOnlyPreview && !["GET", "HEAD", "OPTIONS"].includes(req.method || "GET")) { json(res, 403, { ok: false, error: "Synthetic UI preview is read-only; live task actions are unavailable." }); return; }
      // A browser may only mutate this loopback service from its own origin.
      // Command-line clients have no Origin header and remain supported.
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method || "GET") && req.headers.origin) {
        if (!isSameLoopbackOrigin(req, server)) { json(res, 403, { ok: false, error: "cross-origin control-plane mutation refused" }); return; }
        const token = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("atl_owner="))?.slice("atl_owner=".length);
        if (!validateOwnerSession(root, decodeURIComponent(token || ""), String(req.headers["x-atl-csrf"] || ""))) { json(res, 403, { ok: false, error: "owner session or CSRF token is invalid" }); return; }
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const embedToken = process.env.ATL_PLUGIN_EMBED_TOKEN;
        const supplied = url.searchParams.get('atl_embed');
        // A panel receives a process-local capability. Ordinary browser visits
        // retain strict owner cookies; arbitrary query strings cannot relax them.
        const embedded = Boolean(embedToken && supplied && supplied === embedToken);
        if (supplied && !embedded) { json(res, 403, { ok: false, error: 'invalid panel capability' }); return; }
        sendHtml(res, root, assetRoot, embedded);
        return;
      }
      if (req.method === "GET" && url.pathname === "/control-plane-client.js") {
        sendJavascript(res, assetRoot);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/control-plane-my-tasks.js') { sendJavascript(res, assetRoot, 'control-plane-my-tasks.js'); return; }
      if (req.method === 'GET' && url.pathname === '/assets/mermaid.min.js') { sendJavascript(res, path.join(assetRoot, 'assets'), 'mermaid.min.js'); return; }
      if (req.method === "GET" && url.pathname === "/assets/atl-logo.svg") {
        const logo = fs.readFileSync(path.join(assetRoot, "assets", "atl-logo.svg"));
        res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-cache", "content-length": logo.length });
        res.end(logo);
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
        const cursor = Number(url.searchParams.get("cursor") || 0);
        if (cachedFrame && !forceFullNextConnect && cursor > 0 && cursor === cachedFrame.cursor) {
          json(res, 200, { unchanged: true, cursor });
        } else {
          // A fresh read (no cursor) must never serve a pre-mutation cached
          // frame: build current state so recent mutations are visible
          // immediately; only cursor-holding pollers ride the cache.
          const payload = cursor > 0 && cachedFrame ? JSON.parse(cachedFrame.json).snapshot : createControlPlaneSnapshot(root);
          json(res, 200, { ...payload, cursor: cachedFrame?.cursor ?? 1 });
          forceFullNextConnect = false;
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/memory") {
        // Same module the skills-only surface uses, so the Control Plane cannot
        // explain a selection differently from the portable helper.
        const budgetChars = Math.max(120, Math.min(4000, Number(url.searchParams.get("budget")) || 1200));
        const selection = selectContext(root, { query: url.searchParams.get("q") || "", budgetChars });
        json(res, 200, {
          ok: true,
          query: selection.query,
          coverage: selection.coverage,
          status: selection.status,
          items: selection.items,
          recovery: recoverMemory(root),
          preventions: preventionStatus(root),
          signatures: latestFailureSignatures(root, { limit: 5 }),
        });
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
          const taskState = loadState(root);
          const task = taskState.tasks[capture ? payload.task_id : url.searchParams.get("taskId")];
          if (!task) { json(res, 404, { error: "Task not found", availability: "task_missing" }); return; }
          const record = capture ? captureChangeReview(root, task) : readChangeReview(root, task, url.searchParams.get("changeSetId"));
          if (url.pathname === "/api/task-change-diff") {
            if (!url.searchParams.get("changeSetId") || !record) throw new ChangeReviewError("change_set_missing", "A pinned change set is required", 400);
            json(res, 200, { change_set_id: record.id, ...fileDiff(root, record, url.searchParams.get("fileId")) }); return;
          }
          const review = record ? { ...describeChanges(task, record, { cursor: url.searchParams.get("cursor"), limit: url.searchParams.get("limit"), root }), revisions: listChangeReviews(root, task) } : unavailableReview(task);
          const delivery = record ? taskDeliveryReceiptFromRecord(task, record) : null;
          json(res, 200, {
            ...review,
            delivery: delivery ? { contract_version: delivery.receipt.version, verdict: delivery.verdict, receipt: delivery.receipt } : null,
            statechart: taskStatechart(task, taskState.log),
          });
        } catch (error) {
          json(res, error instanceof ChangeReviewError ? error.status : 409, { error: error instanceof ChangeReviewError ? error.message : "Source inspection failed; no task state was changed", availability: error instanceof ChangeReviewError ? error.code : "inspection_unavailable" });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/task-execution") {
        // Same posture as source previews: the projection joins workspace
        // paths, session log paths and evidence, so the owner session is
        // required even on GET.
        const token = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("atl_owner="))?.slice("atl_owner=".length);
        if (!validateOwnerSession(root, decodeURIComponent(token || ""), String(req.headers["x-atl-csrf"] || ""))) { json(res, 403, { error: "Owner session is required for execution inspection", availability: "forbidden" }); return; }
        const taskId = String(url.searchParams.get("taskId") || "");
        const taskState = loadState(root);
        if (!taskState.tasks[taskId]) { json(res, 404, { error: "Task not found", availability: "task_missing" }); return; }
        try { json(res, 200, buildExecutionProjection(root, taskId, { state: taskState })); }
        catch (error) { json(res, 409, { error: "Execution projection failed; no task state was changed", availability: "projection_unavailable", message: error.message }); }
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
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
        const cursor = Number(url.searchParams.get("cursor") || 0);
        // A reconnecting client that already holds the current frame gets a tiny
        // liveness block; anything else (fresh client, drifted cursor, content
        // that changed after its last poll) receives the full snapshot.
        if (cachedFrame && cursor > 0 && !forceFullNextConnect && cursor === cachedFrame.cursor) {
          res.write(`event: unchanged\ndata: {}\n\n`);
        } else if (cachedFrame) {
          res.write(`event: snapshot\ndata: ${cachedFrame.json}\n\n`);
          forceFullNextConnect = false;
        } else {
          const snapshot = createControlPlaneSnapshot(root);
          const content = JSON.stringify(stableSnapshotFingerprint(snapshot));
          frameVersion += 1;
          cachedFrame = { cursor: frameVersion, content, json: JSON.stringify({ cursor: frameVersion, snapshot }) };
          res.write(`event: snapshot\ndata: ${cachedFrame.json}\n\n`);
        }
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
      if (req.method === "GET" && url.pathname === "/api/projects/map") {
        try { json(res, 200, { ok: true, ...projectWorkMap(root) }); } catch (error) { json(res, 500, { ok: false, error: error.message }); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/projects/assign-task") {
        // Direct assignment from a Projects/Issue-sources card: bind an
        // existing task to a repository or create a new task there, so it
        // plans, verifies and runs against that codebase.
        try {
          const payload = JSON.parse(await readBody(req) || "{}");
          const project = supervisorSnapshot().projects.find((entry) => entry.id === String(payload.repositoryId || ""));
          if (!project) { json(res, 400, { ok: false, error: "Unknown target repository. Register it under Projects first." }); return; }
          try { fs.realpathSync(project.root); } catch { json(res, 409, { ok: false, error: `Repository "${project.name}" is missing on disk (${project.root}). Fix or re-register it before assigning work.` }); return; }
          const state = loadState(root);
          const title = String(payload.title || "").trim();
          let task = state.tasks[String(payload.taskId || "")] || null;
          if (!task && title) task = Object.values(state.tasks).find((entry) => !entry.intake_only && !["archived", "rejected"].includes(entry.status) && entry.title.toLowerCase() === title.toLowerCase()) || null;
          let created = false;
          if (!task) {
            if (!title) { json(res, 400, { ok: false, error: "Pick an existing task or write a new task title." }); return; }
            task = createTask(state, { title, completion_checks: [], resources: [] });
            created = true;
            logEvent(state, { task: task.id, actor: "owner", event: "task_created", detail: `created from a repository card for ${project.name}` });
          }
          if (["archived", "rejected"].includes(task.status)) { json(res, 409, { ok: false, error: `${task.id} is archived or rejected and cannot be assigned.` }); return; }
          task.repository_id = project.id;
          task.repository_name = project.name;
          if (!Array.isArray(task.repository_ids) || !task.repository_ids.length) task.repository_ids = [project.id];
          if (["mira", "pip", "rowan", "sage", "beacon"].includes(String(payload.worker || ""))) task.proposed_worker = String(payload.worker);
          logEvent(state, { task: task.id, actor: "owner", event: "task_repository_assigned", detail: `${project.name}${payload.worker ? ` · worker ${payload.worker}` : ""}${created ? " · new task" : ""}` });
          state.updated_at = new Date().toISOString();
          saveState(root, state, { expectedRevision: state.revision || 0 });
          json(res, 200, { ok: true, taskId: task.id, created, repository: { id: project.id, name: project.name } });
        } catch (error) { json(res, error.statusCode || 400, { ok: false, error: error.message }); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/supervisor") {
        const payload = JSON.parse(await readBody(req) || "{}"); let result;
        if (payload.action === "register-project" || payload.action === "register") {
          if (typeof payload.root !== "string" || !payload.root.trim()) { json(res, 400, { ok: false, error: "project root is required" }); return; }
          try { result = registerProject(payload.root, payload.project || { name: payload.name, maxConcurrent: payload.maxConcurrent }); }
          catch (error) { json(res, error.statusCode || 400, { ok: false, error: error.message }); return; }
        }
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
      if (url.pathname === "/api/batch") {
        if (req.method === "GET") {
          const id = url.searchParams.get("id");
          if (!id) { json(res, 200, { ok: true, batches: listBatches(root), running: [...runningBatches] }); return; }
          const batch = readBatch(root, id);
          if (!batch) { json(res, 404, { ok: false, error: `unknown batch ${id}` }); return; }
          const summary = batchSummary(batch);
          let morning = null;
          try { morning = JSON.parse(fs.readFileSync(path.join(root, ".trust", "manager", "batches", `${id}-summary.json`), "utf8")); } catch { morning = null; }
          json(res, 200, { ok: true, summary, morning, running: runningBatches.has(id) }); return;
        }
        if (req.method !== "POST") { json(res, 405, { ok: false, error: "Method not allowed" }); return; }
        const payload = JSON.parse(await readBody(req) || "{}");
        const id = String(payload.id || payload.batch_id || "");
        try {
          if (payload.action === "start") {
            const batch = startBatch(root, {
              id,
              tasks: Array.isArray(payload.tasks) ? payload.tasks : String(payload.task_ids || "").split(",").map((value) => value.trim()).filter(Boolean),
              limits: { max_minutes: payload.max_minutes ?? 240, max_attempts: payload.max_attempts ?? 2, max_sessions: payload.max_sessions ?? null },
              project: payload.project || null,
            });
            json(res, 200, { ok: true, summary: batchSummary(batch) }); return;
          }
          if (payload.action === "run") {
            if (payload.confirm !== true) { json(res, 400, { ok: false, error: "batch execution requires explicit confirmation" }); return; }
            if (runningBatches.has(id)) { json(res, 409, { ok: false, error: `batch ${id} is already running in this process` }); return; }
            const batch = readBatch(root, id);
            if (!batch) { json(res, 404, { ok: false, error: `unknown batch ${id}` }); return; }
            const check = validateBatch(batch);
            if (!check.ok) { json(res, 409, { ok: false, error: `batch checkpoint is invalid: ${check.reason}` }); return; }
            if (batch.status === "recovery_required") { json(res, 409, { ok: false, error: "batch needs reconciliation before it can run" }); return; }
            if (batch.status !== "running") { json(res, 409, { ok: false, error: `batch is ${batch.status}` }); return; }
            runningBatches.add(id);
            runBatch(root, id, { onProgress: () => {} }).catch(() => {}).finally(() => runningBatches.delete(id));
            json(res, 202, { ok: true, status: "running" }); return;
          }
          if (payload.action === "stop") { json(res, 200, { ok: true, summary: batchSummary(stopBatchRun(root, id, { reason: String(payload.reason || "stopped by owner") })) }); return; }
          if (payload.action === "reconcile") { json(res, 200, { ok: true, summary: batchSummary(reconcileBatch(root, id)) }); return; }
          if (payload.action === "resume") { json(res, 200, { ok: true, summary: batchSummary(resumeStoppedBatch(root, id)) }); return; }
          if (payload.action === "summary") { const morning = batchMorningSummary(root, id); json(res, 200, { ok: true, summary: morning.summary, markdown: morning.markdown, files: { json: path.relative(root, morning.files.json), markdown: path.relative(root, morning.files.markdown) } }); return; }
          json(res, 400, { ok: false, error: "unknown batch action" }); return;
        } catch (error) {
          json(res, 409, { ok: false, error: error.message });
          return;
        }
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
        // A mutation must be readable immediately: drop the cached delta frame
        // so the next read and the next stream tick rebuild post-mutation state.
        cachedFrame = null;
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
      if (url.pathname === '/api/intake/connections' && ['GET', 'POST'].includes(req.method) || /^\/api\/intake\/connections\/[0-9a-f-]+(?:\/(?:check|credential))?$/.test(url.pathname) && ['PATCH', 'DELETE', 'POST'].includes(req.method)) {
        try {
          const ownerCookie = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('atl_owner='))?.slice(10);
          if (!validateOwnerSession(root, decodeURIComponent(ownerCookie || ''), String(req.headers['x-atl-csrf'] || '')) || req.headers.origin && !isSameLoopbackOrigin(req, server)) { json(res, 403, { ok: false, error: 'An authenticated owner session is required for issue connections.' }); return; }
          const data = loadConnections(root, readManagerConfig(root).intake || {});
          const parts = url.pathname.split('/');
          const id = parts[4];
          const index = id ? data.connections.findIndex(c => c.id === id) : -1;
          if (id && index < 0) { json(res, 404, { ok: false, error: 'Connection not found.' }); return; }
          if (req.method === 'GET') { json(res, 200, { ok: true, ...data, connections: data.connections.map(c => ({ ...c, token_present: c.provider === 'github' ? Boolean(githubUiToken || process.env.GITHUB_TOKEN) : Boolean(process.env[c.settings.token_env]) || c.provider === 'azure' && (c.credential_ref === 'os-protected' || azureConnectionTokens.has(c.id) || c.id === data.defaults.azure && Boolean(azureUiToken)) })) }); return; }
          if (run.status === 'running' || planningRunActive(root)) { json(res, 409, { ok: false, error: 'Wait for the active run before changing issue sources.' }); return; }
          const payload = JSON.parse(await readBody(req) || '{}');
          if (payload.revision !== data.revision) { json(res, 409, { ok: false, error: 'Connections changed. Refresh and try again.' }); return; }
          if (req.method === 'POST' && !id) {
            const parsed = validateConnection(payload);
            if (data.connections.some(c => sameConnection(c, parsed))) { json(res, 409, { ok: false, error: 'This location is already connected.' }); return; }
            const record = { id: crypto.randomUUID(), ...parsed, status: 'unchecked', checked_at: null };
            data.connections.push(record);
            data.defaults[record.provider] ||= record.id;
            saveConnections(root, data, payload.revision);
            json(res, 201, { ok: true, connection: record, revision: data.revision }); return;
          }
          if (req.method === 'POST' && parts[5] === 'credential') {
            if (!req.headers.origin || !isSameLoopbackOrigin(req, server)) { json(res, 403, { ok: false, error: 'Credentials can only be changed from the authenticated ATL UI.' }); return; }
            const record = data.connections[index];
            if (record.provider !== 'azure') throw new Error('Credential entry is available for Azure Boards.');
            if (payload.action === 'disconnect') {
              azureConnectionTokens.delete(id);
              forgetAzureConnection(record.settings, { dir: azureCredentialDir(id) });
              record.credential_ref = null;
            } else {
              const token = String(payload.token || '').trim();
              if (!token || token.length > 4096 || /[\r\n]/.test(token)) throw new Error('Enter a valid Azure PAT.');
              if (payload.remember === true) await saveAzureConnection(record.settings, token, { dir: azureCredentialDir(id) });
              else forgetAzureConnection(record.settings, { dir: azureCredentialDir(id) });
              azureConnectionTokens.set(id, token);
              record.credential_ref = payload.remember === true ? 'os-protected' : 'session';
            }
            saveConnections(root, data, payload.revision);
            json(res, 200, { ok: true, revision: data.revision, credential_source: record.credential_ref }); return;
          }
          if (req.method === 'PATCH' && id) {
            const previous = data.connections[index];
            const parsed = validateConnection({ ...previous.settings, ...previous, ...payload, provider: previous.provider });
            if (data.connections.some(c => c.id !== id && sameConnection(c, parsed))) { json(res, 409, { ok: false, error: 'This location is already connected.' }); return; }
            if (previous.provider === 'azure' && connectionIdentity(previous) !== connectionIdentity(parsed)) {
              azureConnectionTokens.delete(id);
              forgetAzureConnection(previous.settings, { dir: azureCredentialDir(id) });
              previous.credential_ref = null;
            }
            data.connections[index] = { ...previous, ...parsed, status: 'unchecked', checked_at: null };
            if (data.defaults[previous.provider] === id && previous.legacy && previous.enabled !== parsed.enabled) {
              const manager = readManagerConfig(root);
              manager.intake[previous.provider].enabled = parsed.enabled;
              const file = path.join(root, 'config', 'manager.json'), temp = `${file}.${crypto.randomUUID()}.tmp`;
              fs.writeFileSync(temp, JSON.stringify(manager, null, 2) + '\n'); fs.renameSync(temp, file);
            }
          } else if (req.method === 'DELETE' && id) {
            const record = data.connections[index];
            if (data.defaults[record.provider] === id) {
              const replacement = data.connections.find(c => c.id !== id && c.provider === record.provider);
              if (replacement) {
                data.defaults[record.provider] = replacement.id;
                const manager = readManagerConfig(root); manager.intake ||= {};
                manager.intake[record.provider] = record.provider === 'github' ? { enabled: replacement.enabled, repos: [replacement.settings.repo] } : { ...replacement.settings, enabled: replacement.enabled };
                const file = path.join(root, 'config', 'manager.json'), temp = `${file}.${crypto.randomUUID()}.tmp`;
                fs.writeFileSync(temp, JSON.stringify(manager, null, 2) + '\n'); fs.renameSync(temp, file);
              }
              else if (!record.enabled) data.defaults[record.provider] = null;
              else { json(res, 409, { ok: false, error: 'Pause this default connection or add another connection before removing it.' }); return; }
            }
            if (record.legacy) data.dismissed_legacy.push(connectionIdentity(record));
            if (record.provider === 'azure') { azureConnectionTokens.delete(id); forgetAzureConnection(record.settings, { dir: azureCredentialDir(id) }); }
            data.connections.splice(index, 1);
          } else if (req.method === 'POST' && parts[5] === 'check') {
            const record = data.connections[index];
            const config = readManagerConfig(root);
            config.intake ||= {};
            config.intake[record.provider] = record.provider === 'github' ? { enabled: true, repos: [record.settings.repo] } : { ...record.settings, enabled: true };
            const token = await connectionAzureToken(record) || (record.provider === 'azure' && record.id === data.defaults.azure ? await currentAzureToken() : null);
            let adapters = record.provider === 'azure' && token ? { ...seam.intakeAdapters, azure: cfg => seam.intakeAdapters.azure ? seam.intakeAdapters.azure(cfg, { token }) : intakeFromAzure(cfg, { token }) } : seam.intakeAdapters;
            // The session GitHub token is account-scoped: it authenticates the
            // access check of every github connection, not one saved location.
            if (record.provider === 'github' && githubUiToken) adapters = { ...adapters, github: cfg => seam.intakeAdapters.github ? seam.intakeAdapters.github(cfg, { token: githubUiToken }) : intakeFromGitHub(cfg, { token: githubUiToken }) };
            try { await runIntake(config, record.provider, adapters); record.status = 'verified'; record.error = null; }
            catch (error) { const message = redactConnectionSecrets(error.message); record.status = /auth|token|credential|unauthori|forbidden|401|403/i.test(message) ? 'needs-auth' : 'unavailable'; record.error = message.slice(0, 240); }
            record.checked_at = new Date().toISOString();
          } else { json(res, 405, { ok: false, error: 'Unsupported connection action.' }); return; }
          saveConnections(root, data, payload.revision);
          json(res, 200, { ok: true, connection: data.connections[index] || null, revision: data.revision });
        } catch (error) { json(res, error.status || 400, { ok: false, error: redactConnectionSecrets(error.message) }); }
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
          await currentAzureToken();
          json(res, 200, { ok: true, sources: { github: { enabled: Boolean(intake.github?.enabled), repos: intake.github?.repos || [], token_present: Boolean(githubUiToken || process.env.GITHUB_TOKEN), credential_source: githubUiToken ? "ui-memory" : process.env.GITHUB_TOKEN ? "environment" : "none" }, jira: { enabled: Boolean(intake.jira?.enabled), base_url: intake.jira?.base_url || "", projects: intake.jira?.projects || [], token_env: intake.jira?.token_env || "JIRA_TOKEN", token_present: Boolean(process.env[intake.jira?.token_env || "JIRA_TOKEN"]) }, azure: { enabled: Boolean(intake.azure?.enabled), org_url: intake.azure?.org_url || "", project: intake.azure?.project || "", iteration_path: intake.azure?.iteration_path || "", token_env: intake.azure?.token_env || "AZDO_PAT", token_present: Boolean(azureUiToken || process.env[intake.azure?.token_env || "AZDO_PAT"]), remember_supported: process.platform === "win32", credential_source: azureUiToken ? (azureRemembered ? "os-protected" : "ui-memory") : process.env[intake.azure?.token_env || "AZDO_PAT"] ? "environment" : "none" } } });
        } catch (error) { json(res, 400, { ok: false, error: error.message }); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/intake/credentials/azure") {
        try {
          const expectedOrigin = `http://${req.headers.host}`;
          const ownerCookie = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("atl_owner="))?.slice("atl_owner=".length);
          if (req.headers.origin !== expectedOrigin || !validateOwnerSession(root, decodeURIComponent(ownerCookie || ""), String(req.headers["x-atl-csrf"] || ""))) {
            json(res, 403, { ok: false, error: "Azure credentials can only be changed from the authenticated ATL UI." }); return;
          }
          const payload = JSON.parse(await readBody(req) || "{}");
          const cfg = readManagerConfig(root).intake?.azure || {};
          if (payload.action === "disconnect") { forgetAzureConnection(cfg); azureUiToken = null; azureRemembered = false; }
          else {
            const token = String(payload.token || "").trim();
            if (!token || token.length > 4096 || /[\r\n]/.test(token)) throw new Error("Enter a valid Azure PAT.");
            if (!cfg.org_url || !cfg.project) throw new Error('Save the Azure collection and project first.');
            if (payload.remember === true) await saveAzureConnection(cfg, token);
            else forgetAzureConnection(cfg);
            azureUiToken = token; azureRemembered = payload.remember === true;
          }
          azureTokenIdentity = azureLoadedIdentity = azureIdentity(cfg);
          myTasks.resume(); // a reconnect lifts the scheduler's auth pause
          const envToken = process.env[readManagerConfig(root).intake?.azure?.token_env || "AZDO_PAT"];
          json(res, 200, { ok: true, token_present: Boolean(azureUiToken || envToken), remember_supported: process.platform === "win32", credential_source: azureUiToken ? (azureRemembered ? "os-protected" : "ui-memory") : envToken ? "environment" : "none" });
        } catch (error) { json(res, 400, { ok: false, error: error.message }); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/intake/credentials/github") {
        // Session-scoped GitHub token entry for private repositories: held in
        // server memory only — never written to config, state, or disk. The
        // persistent paths stay "gh auth login" and the GITHUB_TOKEN variable.
        try {
          const expectedOrigin = `http://${req.headers.host}`;
          const ownerCookie = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("atl_owner="))?.slice("atl_owner=".length);
          if (req.headers.origin !== expectedOrigin || !validateOwnerSession(root, decodeURIComponent(ownerCookie || ""), String(req.headers["x-atl-csrf"] || ""))) {
            json(res, 403, { ok: false, error: "GitHub credentials can only be changed from the authenticated ATL UI." }); return;
          }
          const payload = JSON.parse(await readBody(req) || "{}");
          if (payload.action === "disconnect") githubUiToken = null;
          else {
            const token = String(payload.token || "").trim();
            if (!token || token.length > 255 || /[\r\n]/.test(token)) throw new Error("Enter a valid GitHub token.");
            githubUiToken = token;
          }
          json(res, 200, { ok: true, token_present: Boolean(githubUiToken || process.env.GITHUB_TOKEN), credential_source: githubUiToken ? "ui-memory" : process.env.GITHUB_TOKEN ? "environment" : "none" });
        } catch (error) { json(res, 400, { ok: false, error: error.message }); }
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/intake/azure/iterations") {
        // Sprint combobox feed: the read-only iteration tree from the saved
        // connection. Names, paths and dates only — never credentials.
        try {
          const cfg = readManagerConfig(root).intake?.azure || {};
          if (!cfg.org_url || !cfg.project) throw new Error("Save the Azure collection and project first.");
          await currentAzureToken();
          const token = azureUiToken || process.env[cfg.token_env || "AZDO_PAT"];
          if (!token) throw new Error("Connect Azure Boards first — the sprint list comes from your saved connection.");
          const iterationsUrl = `${cfg.org_url.replace(/\/$/, "")}/${encodeURIComponent(cfg.project)}/_apis/wit/classificationnodes/iterations?$depth=2&api-version=7.1-preview.1`;
          const authHeaders = { authorization: "Basic " + Buffer.from(`:${token}`).toString("base64") };
          const callAzure = (link) => (seam.azureFetch || fetch)(link, { headers: authHeaders, signal: AbortSignal.timeout(15000) });
          // Seam contract: fetch-compatible (Response). Transport-style seams
          // ({ data, status }) — the myTasksFetch convention — are accepted too.
          const readJson = async (response) => (typeof response.json === "function" ? await response.json().catch(() => ({})) : (response.data ?? {}));
          let response = await callAzure(iterationsUrl);
          let data = await readJson(response);
          if (!response.ok) {
            // Some organizations gate classificationnodes; the default team's
            // teamsettings iterations is the equivalent read that usually works.
            const fallbackUrl = `${cfg.org_url.replace(/\/$/, "")}/${encodeURIComponent(cfg.project)}/_apis/work/teamsettings/iterations?api-version=7.1-preview.1`;
            const fallback = await callAzure(fallbackUrl);
            const fallbackData = await readJson(fallback);
            if (!fallback.ok) throw new Error(data.message || fallbackData.message || `Azure returned ${response.status} for the iteration tree.`);
            response = fallback; data = { children: fallbackData.value || [] };
          }
          const iterations = [];
          const walk = (node, prefix) => {
            for (const child of node.children || []) {
              const iterationPath = `${prefix}\\${child.name}`;
              iterations.push({ name: child.name, path: iterationPath, start: child.attributes?.startDate || null, finish: child.attributes?.finishDate || null });
              if (child.hasChildren) walk(child, iterationPath);
            }
          };
          walk(data, cfg.project);
          json(res, 200, { ok: true, iterations });
        } catch (error) {
          const message = String(error?.message || "Could not list Azure sprints");
          json(res, 400, { ok: false, error: azureUiToken ? message.split(azureUiToken).join("[redacted]") : message });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/intake/preview") {
        try {
          const payload = JSON.parse(await readBody(req) || "{}");
          const connections = payload.connection_id ? loadConnections(root, readManagerConfig(root).intake || {}) : null;
          const connection = connections?.connections.find(c => c.id === payload.connection_id);
          if (payload.connection_id && !connection) throw new Error('Connection not found. Refresh sources.');
          const source = connection?.provider || String(payload.source || "");
          if (!["github", "jira", "azure"].includes(source)) throw new Error("Choose GitHub, Jira, or Azure Boards.");
          const config = readManagerConfig(root);
          if (connection) { config.intake ||= {}; config.intake[source] = source === 'github' ? { enabled: connection.enabled, repos: [connection.settings.repo] } : { ...connection.settings, enabled: connection.enabled }; }
          if (!config.intake?.[source]?.enabled) throw new Error(`${source} source is not enabled.`);
          if (source === 'azure') {
            await currentAzureToken();
            const cfg = { ...config.intake.azure };
            if (payload.work_item) {
              let value = String(payload.work_item).trim();
              if (/^https:\/\//i.test(value)) {
                const link = new URL(value), base = new URL(`${cfg.org_url.replace(/\/$/, '')}/${encodeURIComponent(cfg.project)}/`);
                if (link.origin !== base.origin || !decodeURIComponent(link.pathname).toLowerCase().startsWith(decodeURIComponent(base.pathname).toLowerCase())) throw new Error('The work item link must belong to the connected Azure collection and project.');
                value = link.searchParams.get('workitem') || /\/_workitems\/edit\/(\d+)/i.exec(link.pathname)?.[1] || '';
              }
              if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Enter a positive work item number or an Azure work item link.');
              cfg.work_item_id = Number(value); delete cfg.wiql;
            } else if (payload.iteration_path != null) {
              const iteration = String(payload.iteration_path).trim();
              // A pasted taskboard URL like .../_sprints/taskboard/…/Sprint%2074?workitem=6340
              // carries the work item in its query; treat it as a work-item search, not an iteration filter.
              const sprintLink = /^https?:\/\//i.test(iteration) ? new URL(iteration) : null;
              const linkItem = sprintLink ? (sprintLink.searchParams.get('workitem') || /\/_workitems\/edit\/(\d+)/i.exec(sprintLink.pathname)?.[1] || '') : '';
              if (sprintLink && !/^[1-9]\d*$/.test(linkItem)) throw new Error('The pasted sprint link has no ?workitem= number. Paste the taskboard URL while a work item is selected, or enter a plain sprint like 74 or Project\\Sprint 74.');
              if (sprintLink) {
                cfg.work_item_id = Number(linkItem); delete cfg.wiql;
              } else {
                cfg.iteration_path = iteration && !iteration.includes('\\') ? `${cfg.project}\\${/^\d+$/.test(iteration) ? 'Sprint ' + iteration : iteration}` : iteration;
                delete cfg.wiql; delete cfg.work_item_id;
              }
            }
            config.intake = { ...config.intake, azure: cfg };
          }
          const connectionToken = connection ? await connectionAzureToken(connection) : null;
          let adapters = source === "azure" && connection && connectionToken
            ? { ...seam.intakeAdapters, azure: cfg => seam.intakeAdapters.azure ? seam.intakeAdapters.azure(cfg, { token: connectionToken }) : intakeFromAzure(cfg, { token: connectionToken }) }
            : source === "azure" && azureUiToken && (!connection || connection.id === connections.defaults.azure)
            ? { ...seam.intakeAdapters, azure: (cfg) => seam.intakeAdapters.azure ? seam.intakeAdapters.azure(cfg, { token: azureUiToken }) : intakeFromAzure(cfg, { token: azureUiToken }) }
            : seam.intakeAdapters;
          if (source === "github" && githubUiToken) adapters = { ...adapters, github: (cfg) => seam.intakeAdapters.github ? seam.intakeAdapters.github(cfg, { token: githubUiToken }) : intakeFromGitHub(cfg, { token: githubUiToken }) };
          const results = await runIntake(config, source, adapters);
          const candidates = results.flatMap((entry) => entry.tasks);
          const token = crypto.randomUUID(); intakePreviews.set(token, { source, connection_id: connection?.id || null, connection_identity: connection ? connectionIdentity(connection) : null, candidates, at: Date.now(), selection: { work_item: source === 'azure' ? String(payload.work_item || '') : '', iteration: config.intake[source]?.iteration_path || '', project: config.intake[source]?.project || '' } });
          json(res, 200, { ok: true, token, candidates: candidates.map((item, index) => ({ index, title: item.title, objective_hint: item.objective_hint, source: item.source, priority: item.priority })) });
        } catch (error) {
          let message = String(error?.message || "Issue search failed");
          // Never echo a session credential or a saved connection secret back
          // in an error message.
          if (azureUiToken) message = message.split(azureUiToken).join("[redacted]");
          if (githubUiToken) message = message.split(githubUiToken).join("[redacted]");
          json(res, 400, { ok: false, error: redactConnectionSecrets(message) });
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/intake/history') {
        const state = loadState(root);
        const history = Array.isArray(state.intake_history) ? state.intake_history : [];
        const recordedTaskIds = new Set(history.flatMap(record => (Array.isArray(record.items) ? record.items : []).map(item => item.taskId).filter(Boolean)));
        // Older imports predate durable batch history. Reconstruct only what
        // the task record proves and label it so we never imply a known batch
        // destination or exact import event that was not stored at the time.
        const legacy = Object.values(state.tasks).filter(task => ['azure', 'jira', 'github'].includes(task.source?.type) && !recordedTaskIds.has(task.id)).map(task => ({
          at: task.imported_at || task.created_at || null,
          source: task.source.type,
          added: 1,
          skipped: 0,
          selection: { work_item: task.source.remote_id == null ? '' : String(task.source.remote_id), iteration: task.source.iteration || '' },
          destination: 'Legacy import · original destination not recorded',
          legacy: true,
          items: [{ taskId: task.id, title: task.title, source: task.source }],
        }));
        const chronological = [...history, ...legacy].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
        // Clearing hides everything recorded up to the clear point; it never
        // touches the imported tasks themselves.
        const clearedAt = state.intake_history_cleared_at || null;
        const visibleHistory = clearedAt ? chronological.filter(record => record.at && String(record.at) > clearedAt) : chronological;
        const projects = supervisorSnapshot().projects;
        const draftIndex = planDraftIndex(root);
        const requestView = task => {
          const repositories = requestRepositoryIds(task).map(id => ({ id, name: projects.find(entry => entry.id === id)?.name || null, registered: projects.some(entry => entry.id === id) }));
          return ({ id: task.id, title: task.title, source: task.source, imported_at: task.imported_at || task.created_at, repository: { id: task.repository_id || null, name: task.repository_name || null }, repositories, plans: draftIndex.filter(draft => draft.source_task_id === task.id).map(draft => ({ draftId: draft.id, title: draft.title, repositoryId: draft.repository?.id || null, repositoryName: draft.repository?.name || null, stage: draft.stage, approved: draft.approved, queueId: draft.queue_id, savedAt: draft.saved_at })), objective: task.objective_hint || task.objective || '', completion_checks: task.completion_checks || [], snapshot: task.intake_snapshot || null, needs_plan: Boolean(task.plan_review_required), draftId: task.plan_reviewed_by_draft || null });
        };
        json(res, 200, { ok: true, history: visibleHistory, cleared_at: clearedAt, requests: Object.values(state.tasks).filter(task => ['azure', 'jira', 'github'].includes(task.source?.type) && task.status !== 'archived').map(requestView) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/intake/history/clear') {
        const state = loadState(root);
        state.intake_history_cleared_at = new Date().toISOString();
        saveState(root, state, { expectedRevision: state.revision || 0 });
        json(res, 200, { ok: true, cleared_at: state.intake_history_cleared_at });
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
          if (preview.connection_id) {
            const connection = loadConnections(root, readManagerConfig(root).intake || {}).connections.find(c => c.id === preview.connection_id);
            if (!connection || !connection.enabled || connectionIdentity(connection) !== preview.connection_identity) throw new Error('Connection changed or was removed. Preview again.');
            for (const candidate of selected) candidate.source = { ...candidate.source, connection_id: connection.id, connection_name: connection.name };
          }
          // Optional repository bindings (spec 020 / multi-repo): an import
          // may target several registered repositories at once — one request
          // from a product team can affect frontend and backend together.
          // The first target is the primary binding; each linked repository
          // later gets its own plan and queue.
          const registered = supervisorSnapshot().projects;
          const repositoryIds = [...new Set([...(Array.isArray(payload.repository_ids) ? payload.repository_ids : []), ...(payload.repository_id ? [String(payload.repository_id)] : [])].map(String).filter(Boolean))];
          if (repositoryIds.some((id) => !registered.some((entry) => entry.id === id))) { json(res, 400, { ok: false, error: "Unknown target repository. Register it under Projects first." }); return; }
          const imported = importCandidates(root, state, selected, { cfg: readManagerConfig(root), repositoryIds });
          state.intake_history ||= [];
          const repositoryNames = (id) => ({ id, name: registered.find((entry) => entry.id === id)?.name || null });
          const record = { id: crypto.randomUUID(), at: new Date().toISOString(), source: preview.source, connection_id: preview.connection_id || null, selection: preview.selection || {}, destination: payload.destination === 'planning' ? 'planning' : queueId, repository: repositoryIds[0] || null, repositories: repositoryIds.map(repositoryNames), added: imported.added, skipped: imported.skipped, items: selected.map(c => ({ title: c.title, source: c.source, taskId: Object.values(state.tasks).find(t => t.intake_key === c.intake_key)?.id || null })) };
          state.intake_history.push(record);
          saveState(root, state, { expectedRevision: state.revision || 0 });
          if (payload.destination !== 'planning') {
            if (!loadQueueBook(root).queues[queueId]) queueCreate(root, queueId, { name: `${preview.source.toUpperCase()} intake` });
            for (const item of imported.created) queueAdd(root, item.task.id, { queueId });
          }
          intakePreviews.delete(String(payload.token));
          // A mutation must be readable immediately (same contract as
          // /api/command): drop the cached delta frame so a cursor-holding
          // poller cannot be told "unchanged" across this import — otherwise
          // a Plan click on the fresh card silently misses the new task.
          cachedFrame = null;
          json(res, 200, { ok: true, queueId: payload.destination === 'planning' ? null : queueId, added: imported.added, skipped: imported.skipped, taskIds: imported.created.map((item) => item.task.id), record });
        } catch (error) { json(res, 400, { ok: false, error: error.message }); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/intake/repository") {
        // Link an imported request to the registered repositories it affects
        // (spec 020, multi-repository). `repositoryIds` is the full ordered
        // list (empty unassigns); a single `repositoryId` still works. Planning
        // work pins its repository: unlinking a repository that already has a
        // draft or an approved plan for this request is refused, so a plan is
        // never silently moved to another codebase.
        try {
          const payload = JSON.parse(await readBody(req) || "{}");
          const state = loadState(root);
          const task = state.tasks[String(payload.taskId || "")];
          if (!task || ["archived", "rejected"].includes(task.status)) { json(res, 404, { ok: false, error: "Imported request not found." }); return; }
          if (!task.intake_only) { json(res, 409, { ok: false, error: "Only imported requests awaiting a plan can be reassigned." }); return; }
          const projects = supervisorSnapshot().projects;
          const requested = Array.isArray(payload.repositoryIds) ? [...new Set(payload.repositoryIds.map(String).filter(Boolean))] : payload.repositoryId ? [String(payload.repositoryId)] : [];
          const targets = [];
          for (const id of requested) {
            const project = projects.find((entry) => entry.id === id);
            if (!project) { json(res, 400, { ok: false, error: "Unknown target repository. Register it under Projects first." }); return; }
            try { fs.realpathSync(project.root); } catch { json(res, 409, { ok: false, error: `Repository "${project.name}" is missing on disk (${project.root}). Fix or re-register it before assigning.` }); return; }
            targets.push(project);
          }
          const previous = requestRepositoryIds(task);
          const drafts = planDraftIndex(root).filter((entry) => entry.source_task_id === task.id);
          const nameOf = (id) => projects.find((entry) => entry.id === id)?.name || (id === task.repository_id ? task.repository_name : null) || id;
          const pinned = previous.filter((id) => !requested.includes(id)).map((id) => ({ id, drafts: drafts.filter((entry) => entry.repository?.id === id) })).filter((entry) => entry.drafts.length);
          if (pinned.length) {
            const detail = pinned.map((entry) => `${nameOf(entry.id)} (${entry.drafts.map((draft) => `${draft.id}${draft.approved ? `, approved → queue ${draft.queue_id}` : ""}`).join("; ")})`).join(", ");
            json(res, 409, { ok: false, error: `Cannot unlink ${detail}: that repository still has plan draft(s) for this request. Delete or replace the draft (and remove an approved plan's queue) before unlinking — a plan is never silently moved to another codebase.` });
            return;
          }
          // A draft without a frozen binding resolves through the request's
          // links, so any change to the list would re-point it.
          const floating = drafts.filter((entry) => !entry.repository || entry.repository.inferred);
          const changed = previous.length !== requested.length || previous.some((id, index) => id !== requested[index]);
          if (floating.length && changed) {
            json(res, 409, { ok: false, error: `This request already has plan draft(s) without a frozen repository binding (${floating.map((entry) => entry.id).join(", ")}). Delete or replace the draft before changing linked repositories, so the plan is never silently moved to another codebase.` });
            return;
          }
          if (targets.length) {
            task.repository_ids = targets.map((project) => project.id);
            task.repository_id = targets[0].id;
            task.repository_name = targets[0].name;
          } else { delete task.repository_ids; delete task.repository_id; delete task.repository_name; }
          // Linking a repository without an approved plan reopens planning for
          // a request that was already planned elsewhere.
          if (task.plan_reviewed_by_draft) {
            const planned = new Set(drafts.filter((entry) => entry.approved && entry.repository?.id).map((entry) => entry.repository.id));
            task.plan_review_required = targets.some((project) => !planned.has(project.id));
          }
          logEvent(state, { task: task.id, actor: "owner", event: "intake_repository_changed", detail: `${previous.map(nameOf).join(", ") || "unassigned"} -> ${targets.map((project) => project.name).join(", ") || "unassigned"}` });
          state.updated_at = new Date().toISOString();
          saveState(root, state, { expectedRevision: state.revision || 0 });
          cachedFrame = null; // immediate readability, same contract as /api/command
          json(res, 200, { ok: true, taskId: task.id, repositoryIds: targets.map((project) => project.id), repositories: targets.map((project) => ({ id: project.id, name: project.name })), repositoryId: targets[0]?.id || null, repositoryName: targets[0]?.name || null, previousRepositoryId: previous[0] || null, previousRepositoryIds: previous, needsPlan: Boolean(task.plan_review_required) });
        } catch (error) { json(res, error.statusCode || 400, { ok: false, error: error.message }); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/tasks/repository") {
        try {
          if (run.status === "running" || planningRunActive(root)) { json(res, 409, { ok: false, error: "Wait for the active run or planning session to finish before changing task assignment." }); return; }
          const payload = JSON.parse(await readBody(req) || "{}"), state = loadState(root);
          const task = state.tasks[String(payload.taskId || "")];
          if (!task || ["archived", "rejected", "done"].includes(task.status)) { json(res, 404, { ok: false, error: "Task is unavailable." }); return; }
          if (["azure", "github", "jira"].includes(task.source?.type) || task.intake_only) { json(res, 409, { ok: false, error: "Imported requests use multi-repository assignment in Sources or Projects." }); return; }
          if (task.plan_draft_id || task.workspace || task.worktree || task.run_id || !["queued", "pending", "new", "triaged"].includes(task.status)) { json(res, 409, { ok: false, error: "Repository assignment is locked after planning or execution starts. Create a new task if it must target another repository." }); return; }
          const repositoryId = payload.repositoryId ? String(payload.repositoryId) : null;
          const project = repositoryId ? supervisorSnapshot().projects.find((entry) => entry.id === repositoryId) : null;
          if (repositoryId && !project) { json(res, 400, { ok: false, error: "Unknown repository. Register it under Projects first." }); return; }
          if (project) {
            let canonical;
            try { canonical = fs.realpathSync(project.root); } catch { json(res, 409, { ok: false, error: `Repository ${project.name} is missing on disk (${project.root}).` }); return; }
            if (!fs.statSync(canonical).isDirectory() || !fs.existsSync(path.join(canonical, ".git"))) { json(res, 409, { ok: false, error: `Repository ${project.name} is not an available Git checkout.` }); return; }
          }
          const previous = task.repository_id || null;
          if (previous === repositoryId) { json(res, 200, { ok: true, taskId: task.id, repositoryId, repositoryName: task.repository_name || null }); return; }
          if (project) { task.repository_id = project.id; task.repository_name = project.name; }
          else { delete task.repository_id; delete task.repository_name; }
          logEvent(state, { task: task.id, actor: "owner", event: "task_repository_changed", detail: `${previous || "workspace"} -> ${project?.name || "workspace"}` });
          state.updated_at = new Date().toISOString();
          saveState(root, state, { expectedRevision: state.revision || 0 });
          json(res, 200, { ok: true, taskId: task.id, repositoryId: project?.id || null, repositoryName: project?.name || null, previousRepositoryId: previous });
        } catch (error) { json(res, error.statusCode || 400, { ok: false, error: error.message }); }
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
      if (url.pathname === "/api/my-tasks" || url.pathname.startsWith("/api/my-tasks/")) {
         await handleMyTasksEndpoint(root, res, url, req, myTasks, currentAzureToken, reviews, triage, jira, seam);
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/plan/")) {
        await handlePlanEndpoint(root, res, url.pathname, req, seam);
        return;
      }
      json(res, 404, { ok: false, error: "not found" });
    } catch (error) {
      if (!res.headersSent) json(res, 500, { ok: false, error: error.message });
      else console.error("[control-plane] post-response error:", error && error.stack || error);
    }
  });
  server.once("close", () => { myTasks.stop(); reviews.stop(); triage.stop(); void jira.stop(); clearOwnerSession(root, ownerSession.token); }); // schedulers and owner session die with the service
  return server;
}

export async function startControlPlaneServer(root, { host = "127.0.0.1", port = 0, planningInvoke = null, usageFetch = globalThis.fetch, publishFetch = globalThis.fetch, assetRoot = path.dirname(CONTROL_PLANE_FILE), readOnlyPreview = false, intakeAdapters = {}, egmRunner = null, myTasksFetch = null, myTasksReviewInvoke = null, taskTriageInvoke = null, jiraTransportCall = null, azureFetch = globalThis.fetch } = {}) {
  const server = createControlPlaneServer(root, { host, planningInvoke, usageFetch, publishFetch, assetRoot, readOnlyPreview, intakeAdapters, egmRunner, myTasksFetch, myTasksReviewInvoke, taskTriageInvoke, jiraTransportCall, azureFetch });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port }, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return { server, host, port: actualPort, url: `http://${host}:${actualPort}/` };
}
