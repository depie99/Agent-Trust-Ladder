import fs from "node:fs";
import https from "node:https";
import path from "node:path";

// Spec 021 — "My Tasks": read-only Azure DevOps work items assigned to the
// authenticated account, kept in an independent local store and refreshed by a
// server-side scheduler. This module never writes to Azure, never creates ATL
// executive tasks, and never exposes the PAT: tokens arrive through the
// control plane's currentAzureToken closure and stay in call scope.

export const MY_TASKS_API_VERSION = "6.0";
export const MY_TASKS_BATCH_SIZE = 200; // workitemsbatch hard limit per call
const BACKOFF_MINUTES = [1, 2, 4, 8, 15];
const BACKOFF_CAP_MS = 15 * 60_000;
const STORE_DIR = path.join(".trust", "manager", "my-tasks");
const STORE_VERSION = 1;
const STATE_CATEGORIES = new Set(["proposed", "inprogress", "complete", "removed"]);
const VISIBLE_CATEGORIES = new Set(["proposed", "inprogress", "complete"]);
// Azure's states API category is authoritative; the aliases only absorb server
// spelling drift ("Completed" on-prem). A missing/unknown category falls back
// to terminal state names only — anything else stays "inprogress" so an exotic
// state never hides assigned work from the owner (Spec 022 baseline repair:
// owner report 2026-11-14 — Done items were categorized as In Progress).
const STATE_CATEGORY_ALIASES = new Map([
  ["proposed", "proposed"], ["new", "proposed"],
  ["inprogress", "inprogress"], ["active", "inprogress"], ["committed", "inprogress"],
  ["complete", "complete"], ["completed", "complete"], ["finished", "complete"],
  ["removed", "removed"], ["deleted", "removed"],
]);
const TERMINAL_STATE_NAME = /^(done|closed|complete[d]?|finished|archived)$/i;

export function normalizeStateCategory(rawCategory, stateName = "") {
  const category = String(rawCategory || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliased = STATE_CATEGORY_ALIASES.get(category);
  if (aliased) return aliased;
  return TERMINAL_STATE_NAME.test(String(stateName || "").trim()) ? "complete" : "inprogress";
}
const NEW_WINDOW_MS = 24 * 3600_000;

function requestJson(urlString, { method = "GET", headers = {}, body = null, allowUntrusted = false } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const request = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: { Accept: "application/json", ...headers },
      rejectUnauthorized: !allowUntrusted,
    }, (response) => {
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { /* the HTTP status carries the failure */ }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`HTTP ${response.statusCode} from ${url.host}: ${parsed?.message || data.slice(0, 300)}`);
          error.status = response.statusCode;
          error.retryAfter = Number(response.headers?.["retry-after"]) > 0 ? Number(response.headers["retry-after"]) : null;
          reject(error);
        } else {
          resolve({ data: parsed, headers: response.headers, status: response.statusCode });
        }
      });
    });
    request.on("error", reject);
    if (body) request.write(typeof body === "string" ? body : JSON.stringify(body));
    request.end();
  });
}

export function azureHeaders(token) {
  return { Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`, "Content-Type": "application/json" };
}

export function collectionBase(cfg) {
  const organization = new URL(String(cfg?.org_url || ""));
  if (organization.protocol !== "https:" || organization.username || organization.password || organization.search || organization.hash || /\/_workitems|\/_sprints/i.test(organization.pathname)) {
    throw new Error("Azure collection URL must be a plain HTTPS URL before the project or taskboard path");
  }
  return organization.href.replace(/\/$/, "");
}

// The connection part of a record key: the collection URL (lowercased, no
// trailing slash) — stable across intake project changes.
export function myTasksConnectionKey(cfg) {
  return collectionBase(cfg).toLowerCase();
}

export function workItemKey(connection, project, id) {
  return `${connection}|${project}|${id}`;
}

// ---------- settings (.trust/manager/my-tasks/settings.json)

// Settings deliberately live in the git-ignored local store next to store.json,
// NOT in config/manager.json: manager.json is git-tracked, so saved settings
// survived only as an uncommitted diff and every checkout/reset wave in this
// repo silently reverted them to the committed defaults (owner report
// 2026-11-11: "saved once, must remain until I change it"). The manager.json
// "myTasks" key is still honored as a read-only legacy fallback so existing
// saves migrate on first read; it is never written again.

export function defaultMyTasksSettings(azure = {}) {
  const connectedProject = azure?.org_url && azure?.project ? String(azure.project).trim() : "";
  return {
    enabled: Boolean(connectedProject),
    startup_mode: "runtime",
    schedule_on: true,
    interval_minutes: 15,
    projects: connectedProject ? [connectedProject] : [],
  };
}

function normalizeSettings(value, defaults = defaultMyTasksSettings()) {
  const merged = { ...defaults, ...(value || {}) };
  const interval = Number(merged.interval_minutes);
  merged.interval_minutes = Number.isSafeInteger(interval) ? Math.min(1440, Math.max(1, interval)) : 15;
  merged.enabled = merged.enabled === true;
  merged.startup_mode = merged.startup_mode === "windows" ? "windows" : "runtime";
  merged.schedule_on = merged.schedule_on !== false;
  merged.projects = Array.isArray(merged.projects)
    ? [...new Set(merged.projects.map((name) => String(name).trim()).filter((name) => name && name.length <= 128 && !/[\r\n]/.test(name)))].slice(0, 50)
    : [];
  return merged;
}

function readManagerConfigFile(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, "config", "manager.json"), "utf8")); } catch { return {}; }
}

export function myTasksSettingsFile(root) {
  return path.join(root, STORE_DIR, "settings.json");
}

function readLocalSettingsFile(root) {
  try { return JSON.parse(fs.readFileSync(myTasksSettingsFile(root), "utf8")); } catch { return null; }
}

function readLegacySettings(root, readConfig) {
  const config = readConfig ? readConfig(root) : readManagerConfigFile(root);
  return config?.myTasks || null;
}

export function readMyTasksSettings(root, { readConfig = null } = {}) {
  const config = readConfig ? readConfig(root) : readManagerConfigFile(root);
  const defaults = defaultMyTasksSettings(config?.intake?.azure);
  const local = readLocalSettingsFile(root);
  const saved = local && typeof local === "object" ? local : config?.myTasks;
  const settings = normalizeSettings(saved, defaults);
  // The scheduler is now managed as an always-on runtime service. Preserve the
  // old request shape as accepted input, but never surface a schedule-off state.
  if (!settings.schedule_on) return normalizeSettings({ ...settings, schedule_on: true }, defaults);
  // With a configured Azure connection, My Tasks always follows its selected
  // runtime/Windows startup mode. Legacy disabled values must not silently
  // survive a runtime restart and make the UI report “off”.
  if (defaults.enabled && !settings.enabled) {
    return normalizeSettings({ ...settings, enabled: true, projects: settings.projects.length ? settings.projects : defaults.projects }, defaults);
  }
  return settings;
}

export function saveMyTasksSettings(root, patch, { writeRaw = null } = {}) {
  if (patch?.interval_minutes !== undefined) {
    const interval = Number(patch.interval_minutes);
    if (!Number.isSafeInteger(interval) || interval < 1 || interval > 1440) throw new Error("Interval must be a whole number of minutes between 1 and 1440.");
  }
  if (patch?.projects !== undefined && !Array.isArray(patch.projects)) throw new Error("Selected projects must be a list of project names.");
  if (patch?.startup_mode !== undefined && !["runtime", "windows"].includes(patch.startup_mode)) throw new Error("Startup mode must be runtime or windows.");
  if (patch?.startup_mode === "windows" && process.platform !== "win32") throw new Error("Starting My Tasks at login is currently supported on Windows only.");
  const write = writeRaw || ((target, value) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2) + "\n");
    fs.renameSync(`${target}.tmp`, target);
  });
  const config = readManagerConfigFile(root);
  const defaults = defaultMyTasksSettings(config?.intake?.azure);
  const current = readLocalSettingsFile(root) || config?.myTasks || {};
  const merged = normalizeSettings({ ...defaults, ...current, ...patch, enabled: defaults.enabled ? true : patch?.enabled === true, schedule_on: true }, defaults);
  write(myTasksSettingsFile(root), merged);
  return merged;
}

// ---------- independent local store

export function myTasksStoreFile(root) {
  return path.join(root, STORE_DIR, "store.json");
}

export function emptyMyTasksStore() {
  return {
    version: STORE_VERSION, connection: null, identity: null,
    records: {}, projects: {}, states_cache: {},
    runs: { last: null, next_due_at: null, backoff: { failures: 0, until: null }, paused: null },
  };
}

export function readMyTasksStore(root) {
  try {
    const store = JSON.parse(fs.readFileSync(myTasksStoreFile(root), "utf8"));
    if (!store || typeof store !== "object" || !store.records || typeof store.records !== "object") return emptyMyTasksStore();
    return { ...emptyMyTasksStore(), ...store, records: store.records, projects: store.projects || {}, states_cache: store.states_cache || {}, runs: { ...emptyMyTasksStore().runs, ...(store.runs || {}) } };
  } catch {
    return emptyMyTasksStore(); // crash recovery: a torn or missing file reads as empty
  }
}

export function writeMyTasksStore(root, store) {
  const file = myTasksStoreFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(temporary, file);
}

// ---------- HTML sanitation (server-side, before storage and serving)

const ALLOWED_TAGS = new Set(["p", "br", "div", "span", "ul", "ol", "li", "strong", "b", "em", "i", "u", "code", "pre", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "td", "th", "a"]);
const VOID_TAGS = new Set(["br"]);
const DROP_CONTENT_TAGS = new Set(["script", "style", "iframe", "object", "embed", "noscript", "title", "svg", "math"]);

export function sanitizeWorkItemHtml(html) {
  const source = String(html || "");
  if (!source.trim()) return "";
  let output = "";
  let insideDropped = null; // raw-text container whose entire content is dropped
  const token = /<!--[\s\S]*?-->|<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?>|[^<]+/g;
  let match;
  while ((match = token.exec(source))) {
    const piece = match[0];
    if (insideDropped) {
      const closing = new RegExp(`</\\s*${insideDropped}\\s*>`, "i").exec(piece);
      if (closing) insideDropped = null;
      continue;
    }
    if (piece.startsWith("<!--")) continue;
    if (!piece.startsWith("<")) { output += piece; continue; }
    const closing = piece.startsWith("</");
    const name = (closing ? piece.slice(2, piece.indexOf(">")) : piece.slice(1, /[\s>]/.exec(piece.slice(1))?.index + 1)).trim().toLowerCase();
    if (!ALLOWED_TAGS.has(name)) {
      if (!closing && !VOID_TAGS.has(name) && DROP_CONTENT_TAGS.has(name)) insideDropped = name;
      continue;
    }
    if (closing) { output += `</${name}>`; continue; }
    if (name === "a") {
      const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(piece);
      const value = (href?.[1] ?? href?.[2] ?? "").trim();
      if (/^https?:\/\//i.test(value)) output += `<a href="${value.replaceAll('"', "&quot;")}" target="_blank" rel="noopener noreferrer">`;
      else output += "<a>";
      continue;
    }
    output += VOID_TAGS.has(name) ? `<${name}>` : `<${name}>`;
  }
  return output;
}

export function stripWorkItemHtml(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/(?:p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n• ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .split(/\r?\n/).map((line) => line.trim()).join("\n").trim();
}

// ---------- fetch

export function buildMyTasksWiql(project) {
  const safe = String(project).replace(/'/g, "''");
  return `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${safe}' AND [System.AssignedTo] = @Me`;
}

export async function fetchMyTasksIdentity(cfg, { token, requestImpl = requestJson } = {}) {
  const base = collectionBase(cfg);
  const response = await requestImpl(`${base}/_apis/ConnectionData`, { headers: azureHeaders(token), allowUntrusted: cfg.tls_allow_untrusted === true });
  const user = response.data?.authenticatedUser || {};
  return { id: String(user.id || ""), display_name: String(user.displayName || "") || null };
}

function classifyError(error) {
  if (error?.status === 401 || error?.status === 203) error.code = "ATL_MYTASKS_AUTH";
  else if (error?.status === 403) error.code = "ATL_MYTASKS_FORBIDDEN";
  else error.code = error?.code && String(error.code).startsWith("ATL_MYTASKS_") ? error.code : "ATL_MYTASKS_NETWORK";
  return error;
}

async function fetchProjectStates(cfg, project, type, { token, requestImpl }) {
  const base = collectionBase(cfg);
  const url = `${base}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=${MY_TASKS_API_VERSION}`;
  const response = await requestImpl(url, { headers: azureHeaders(token), allowUntrusted: cfg.tls_allow_untrusted === true });
  const map = {};
  for (const state of response.data?.value || []) {
    if (state?.name) map[state.name] = normalizeStateCategory(state?.category, state.name);
  }
  return map;
}

export function normalizeMyWorkItem(workItem, { connection, project, stateCategory }) {
  const fields = workItem?.fields || {};
  const assignee = fields["System.AssignedTo"] || null;
  const descriptionRaw = fields["System.Description"] || fields["Microsoft.VSTS.TCM.ReproSteps"] || "";
  const priorityRaw = fields["Microsoft.VSTS.Common.Priority"];
  return {
    key: workItemKey(connection, project, workItem.id),
    source: 'azure',
    connection,
    project,
    id: workItem.id,
    rev: fields["System.Rev"] ?? null,
    title: String(fields["System.Title"] || "").trim() || `Work item ${workItem.id}`,
    type: String(fields["System.WorkItemType"] || "Work item"),
    state: String(fields["System.State"] || ""),
    state_category: stateCategory,
    priority: Number.isSafeInteger(Number(priorityRaw)) ? Number(priorityRaw) : null,
    source_priority: { rank: priorityRaw == null ? null : Number(priorityRaw), label: priorityRaw == null ? null : `P${priorityRaw}` },
    due_at: fields['Microsoft.VSTS.Scheduling.DueDate'] || fields['Microsoft.VSTS.Scheduling.TargetDate'] || null,
    dependencies: (workItem.relations || []).filter(link => /Dependency/.test(link.rel || '')).map(link => ({ type: link.rel, id: String(link.url || '').split('/').pop() })),
    area_path: String(fields["System.AreaPath"] || "") || null,
    iteration_path: String(fields["System.IterationPath"] || "") || null,
    description_html: sanitizeWorkItemHtml(descriptionRaw),
    description_text: stripWorkItemHtml(descriptionRaw),
    acceptance_criteria: stripWorkItemHtml(fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || ""),
    assignee_id: assignee?.id ? String(assignee.id) : null,
    assignee_name: assignee?.displayName ? String(assignee.displayName) : null,
    tags: String(fields["System.Tags"] || "").split(";").map((tag) => tag.trim()).filter(Boolean),
    changed_at: fields["System.ChangedDate"] || null,
    url: `${connection}/${encodeURIComponent(project)}/_workitems/edit/${workItem.id}`,
  };
}

// One project = WIQL id list → chunked batch fetch (no 100-item cap) → per-type
// state categories → open-only records. Throws (typed) only when the whole
// project read fails; optional missing fields never fail an item.
export async function fetchProjectMyWorkItems(cfg, project, { token, requestImpl = requestJson, statesCache = {}, identity = null, onStatesCache = null } = {}) {
  const base = collectionBase(cfg);
  const headers = azureHeaders(token);
  const tls = { allowUntrusted: cfg.tls_allow_untrusted === true };
  try {
    const query = await requestImpl(`${base}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=${MY_TASKS_API_VERSION}`, {
      method: "POST", headers, body: { query: buildMyTasksWiql(project) }, ...tls,
    });
    const ids = (query.data?.workItems || []).map((entry) => entry.id).filter((id) => Number.isSafeInteger(id));
    if (!ids.length) return { records: [], excluded: 0, states_cache: { ...statesCache }, relations: { ok: true } };
    const fields = ["System.Id", "System.Rev", "System.Title", "System.State", "System.WorkItemType", "System.AssignedTo", "Microsoft.VSTS.Common.Priority", "System.IterationPath", "System.AreaPath", "System.Description", "Microsoft.VSTS.TCM.ReproSteps", "Microsoft.VSTS.Common.AcceptanceCriteria", "System.Tags", "System.ChangedDate"];
    // Custom/older Azure processes do not all define scheduling dates. Ask the
    // schema before requesting optional fields so a missing date cannot break sync.
    try {
      const available = await requestImpl(`${base}/_apis/wit/fields?api-version=${MY_TASKS_API_VERSION}`, { headers, ...tls });
      const names = new Set((available.data?.value || []).map(field => field.referenceName));
      for (const name of ['Microsoft.VSTS.Scheduling.DueDate', 'Microsoft.VSTS.Scheduling.TargetDate']) if (names.has(name)) fields.push(name);
    } catch { /* Deadlines stay unknown when optional schema access is unavailable. */ }
    const items = [];
    for (let start = 0; start < ids.length; start += MY_TASKS_BATCH_SIZE) {
      const chunk = ids.slice(start, start + MY_TASKS_BATCH_SIZE);
      // Azure Server (on-prem) rejects fields+$expand on workitemsbatch with
      // HTTP 400 ("The expand parameter can not be used with the fields
      // parameter"). Fields are fetched alone; dependency links arrive in a
      // second pass below.
      const batch = await requestImpl(`${base}/${encodeURIComponent(project)}/_apis/wit/workitemsbatch?api-version=${MY_TASKS_API_VERSION}`, {
        method: "POST", headers, body: { ids: chunk, fields }, ...tls,
      });
      items.push(...(batch.data?.value || []));
    }
    let relationsError = null;
    try {
      const byId = new Map(items.filter(Boolean).map((item) => [item.id, item]));
      for (let start = 0; start < ids.length; start += MY_TASKS_BATCH_SIZE) {
        const chunk = ids.slice(start, start + MY_TASKS_BATCH_SIZE);
        const linked = await requestImpl(`${base}/${encodeURIComponent(project)}/_apis/wit/workitemsbatch?api-version=${MY_TASKS_API_VERSION}`, {
          method: "POST", headers, body: { ids: chunk, $expand: "Relations" }, ...tls,
        });
        for (const item of linked.data?.value || []) {
          const target = byId.get(item.id);
          if (target && Array.isArray(item.relations)) target.relations = item.relations;
        }
      }
    } catch (error) {
      // Dependencies are optional context: a failed relations pass degrades to
      // empty dependency lists instead of failing the project read.
      relationsError = String(error?.message || error).slice(0, 200);
    }
    if (items.length !== ids.length) {
      const error = new Error(`Azure returned ${items.length} of ${ids.length} work items for ${project}`);
      error.code = "ATL_MYTASKS_INCOMPLETE";
      throw error;
    }
    const cache = { ...statesCache };
    const records = [];
    let excluded = 0;
    for (const item of items) {
      const type = String(item.fields?.["System.WorkItemType"] || "");
      const state = String(item.fields?.["System.State"] || "");
      // Categories re-derive on every fetch: cached mappings from older builds
      // normalized unknown categories to "inprogress" (Done items showed as In
      // Progress). Fresh values win; the cache only covers states the server's
      // response does not mention.
      const fresh = await fetchProjectStates(cfg, project, type, { token, requestImpl });
      cache[type] = { ...(cache[type] || {}), ...fresh };
      onStatesCache?.(type, cache[type]);
      const category = cache[type]?.[state] || "inprogress";
      // Keep completed work visible so the dashboard can distinguish it from
      // active assignments. Removed items remain excluded from the list.
      if (!VISIBLE_CATEGORIES.has(category)) { excluded += 1; continue; }
      // Assignment was already matched server-side with @Me; this guards the
      // identity comparison by Azure id, never by display name.
      if (identity?.id && item.fields?.["System.AssignedTo"]?.id && String(item.fields["System.AssignedTo"].id) !== String(identity.id)) { excluded += 1; continue; }
      records.push(normalizeMyWorkItem(item, { connection: myTasksConnectionKey(cfg), project, stateCategory: category }));
    }
    return { records, excluded, states_cache: cache, relations: relationsError ? { ok: false, error: relationsError } : { ok: true } };
  } catch (error) {
    throw classifyError(error);
  }
}

// ---------- merge (revision upsert; removal only after this project fetched fully)

export function mergeProjectRecords(store, project, records, { connection, now = new Date().toISOString() } = {}) {
  const seen = new Set();
  let added = 0, updated = 0;
  for (const record of records) {
    seen.add(record.key);
    const prior = store.records[record.key];
    if (!prior) {
      added += 1;
      store.records[record.key] = { ...record, first_seen_at: now, last_seen_at: now };
    } else {
      if (String(prior.rev) !== String(record.rev) || prior.title !== record.title || prior.state !== record.state || prior.assignee_id !== record.assignee_id) updated += 1;
      store.records[record.key] = { ...record, first_seen_at: prior.first_seen_at || now, last_seen_at: now };
    }
  }
  // An empty successful fetch legitimately empties this project's active list;
  // a failed fetch never reaches merge at all.
  let removed = 0;
  for (const [key, record] of Object.entries(store.records)) {
    if (record.connection === connection && record.project === project && !seen.has(key)) {
      delete store.records[key];
      removed += 1;
    }
  }
  return { added, updated, removed };
}

// ---------- check orchestration

export async function runMyTasksCheck(root, { settings, token, cfg, requestImpl = requestJson, now = new Date(), reason = "manual", runId = null } = {}) {
  const store = readMyTasksStore(root);
  const startedAt = now instanceof Date ? now : new Date(now);
  const startedIso = startedAt.toISOString();
  const id = runId || `mt-${startedAt.getTime()}`;
  const connection = cfg?.org_url ? myTasksConnectionKey(cfg) : null;
  store.connection = connection ? { org_url: collectionBase(cfg), key: connection } : store.connection;
  let identity = null;
  try {
    identity = await fetchMyTasksIdentity(cfg, { token, requestImpl });
    store.identity = identity;
  } catch (error) {
    const classified = classifyError(error);
    store.runs.last = { id, reason, status: "failed", error: { code: classified.code, message: String(classified.message).slice(0, 300) }, started_at: startedIso, finished_at: startedIso };
    if (classified.code === "ATL_MYTASKS_AUTH") store.runs.paused = { reason: "auth", at: startedIso };
    writeMyTasksStore(root, store);
    throw classified;
  }
  const summary = {};
  let failure = null;
  for (const project of settings.projects) {
    const prior = store.projects[project] || {};
    try {
      const result = await fetchProjectMyWorkItems(cfg, project, {
        token, requestImpl, identity,
        statesCache: store.states_cache[project] || {},
        onStatesCache: (type, map) => { store.states_cache[project] = { ...(store.states_cache[project] || {}), [type]: map }; },
      });
      const merged = mergeProjectRecords(store, project, result.records, { connection, now: startedIso });
      store.states_cache[project] = result.states_cache;
      const newCount = Object.values(store.records).filter((record) => record.project === project && record.connection === connection && startedAt.getTime() - new Date(record.first_seen_at).getTime() < NEW_WINDOW_MS).length;
      store.projects[project] = { ...prior, status: "fresh", error: null, last_success_at: startedIso, last_attempt_at: startedIso, item_count: result.records.length, new_count: newCount };
      summary[project] = { status: "fresh", ...merged, excluded: result.excluded, ...(result.relations?.ok === false ? { relations_warning: result.relations.error } : {}) };
    } catch (error) {
      // A failing project keeps its last successful records with a stale
      // badge; other projects continue.
      const classified = classifyError(error);
      store.projects[project] = { ...prior, status: prior.last_success_at ? "stale" : "error", error: { code: classified.code, message: String(classified.message).slice(0, 300) }, last_attempt_at: startedIso };
      summary[project] = { status: store.projects[project].status, error: classified.code, message: String(classified.message).slice(0, 200) };
      if (!failure || classified.code === "ATL_MYTASKS_AUTH") failure = classified;
    }
  }
  const finishedAt = new Date();
  const succeeded = Object.values(summary).filter((entry) => entry.status === "fresh").length;
  const allFailed = settings.projects.length > 0 && succeeded === 0;
  const anyFailed = settings.projects.length > 0 && succeeded < settings.projects.length;
  store.runs.last = { id, reason, status: allFailed ? "failed" : anyFailed ? "partial" : "complete", projects: summary, started_at: startedIso, finished_at: finishedAt.toISOString() };
  if (failure?.code === "ATL_MYTASKS_AUTH") store.runs.paused = { reason: "auth", at: finishedAt.toISOString() };
  if (failure && failure.code !== "ATL_MYTASKS_AUTH" && failure.code !== "ATL_MYTASKS_FORBIDDEN") {
    // Exponential backoff capped at 15 minutes; Retry-After is honored but
    // never extends past the same cap.
    const failures = (store.runs.backoff?.failures || 0) + 1;
    const schedule = (BACKOFF_MINUTES[Math.min(failures - 1, BACKOFF_MINUTES.length - 1)] || 15) * 60_000;
    const delay = failure.retryAfter ? Math.min(Math.max(schedule, failure.retryAfter * 1000), BACKOFF_CAP_MS) : Math.min(schedule, BACKOFF_CAP_MS);
    store.runs.backoff = { failures, until: new Date(finishedAt.getTime() + delay).toISOString() };
  } else if (!failure) {
    store.runs.backoff = { failures: 0, until: null };
  }
  writeMyTasksStore(root, store);
  return { id, summary, status: store.runs.last.status, store };
}

// ---------- scheduler engine (owned by the control plane server process)

export function createMyTasksEngine(root, { token: tokenProvider = null, connection = null, requestImpl = requestJson, readConfig = null, now = () => new Date(), intervalMs = 60_000, onSynced = () => {} } = {}) {
  let timer = null;
  let active = null; // in-flight run → a manual request during it joins, never doubles
  const readSettings = () => readMyTasksSettings(root, { readConfig });
  const azureCfg = () => (readConfig ? readConfig(root) : readManagerConfigFile(root))?.intake?.azure || {};
  const resolveConnection = connection || (async () => {
    const cfg = azureCfg();
    return { cfg, token: tokenProvider ? await tokenProvider() : process.env[cfg.token_env || "AZDO_PAT"] };
  });
  const dueAt = (settings, store, at) => {
    if (!settings.enabled || !settings.schedule_on || store.runs.paused) return null;
    // A transient failure replaces the normal polling interval with its
    // bounded retry window. Otherwise a long user interval can delay retries
    // far beyond Retry-After/backoff, while a short interval can retry early.
    if (store.runs.backoff?.until) return store.runs.backoff.until;
    const attempts = settings.projects
      .map((project) => store.projects[project])
      .filter(Boolean)
      .map((project) => project.last_attempt_at)
      .filter(Boolean)
      .sort();
    const last = attempts.at(-1);
    if (!last) return at.toISOString();
    return new Date(new Date(last).getTime() + settings.interval_minutes * 60_000).toISOString();
  };
  async function check({ reason = "manual", at = now() } = {}) {
    if (active) return { run_id: active.runId, joined: true };
    const runIdValue = `mt-${Date.now()}`;
    active = { runId: runIdValue };
    try {
      const settings = readSettings();
      if (!settings.projects.length) throw new Error("Select at least one project before checking.");
      const { cfg, token } = await resolveConnection();
      if (!token) { const error = new Error("No Azure connection token is available. Connect from Issue sources or My Tasks setup."); error.code = "ATL_MYTASKS_AUTH"; throw error; }
      const result = await runMyTasksCheck(root, { settings, token, cfg, requestImpl, now: at, reason, runId: runIdValue });
      try { onSynced(); } catch { /* review scheduling never fails the Azure sync */ }
      return { run_id: result.id, joined: false, status: result.status, summary: result.summary };
    } finally {
      if (active?.runId === runIdValue) active = null;
    }
  }
  const engine = {
    settings: readSettings,
    saveSettings: (patch) => {
      const saved = saveMyTasksSettings(root, patch, { writeRaw: null });
      const store = readMyTasksStore(root);
      // Re-enabling counts as a deliberate reconnect; an auth pause lifts.
      if (saved.enabled && store.runs.paused?.reason === "auth") store.runs.paused = null;
      store.runs.next_due_at = dueAt(saved, store, now());
      writeMyTasksStore(root, store);
      return saved;
    },
    resume: () => {
      const store = readMyTasksStore(root);
      store.runs.paused = null;
      writeMyTasksStore(root, store);
    },
    async projects(resolved = null) {
      const { cfg, token } = resolved || await resolveConnection();
      if (!token) { const error = new Error("No Azure connection token is available."); error.code = "ATL_MYTASKS_AUTH"; throw error; }
      const [identity, response] = await Promise.allSettled([
        fetchMyTasksIdentity(cfg, { token, requestImpl }),
        requestImpl(`${collectionBase(cfg)}/_apis/projects?api-version=${MY_TASKS_API_VERSION}`, { headers: azureHeaders(token), allowUntrusted: cfg.tls_allow_untrusted === true }),
      ]);
      if (identity.status === "rejected") throw classifyError(identity.reason);
      if (response.status === "rejected") throw classifyError(response.reason);
      return { identity: identity.value, projects: (response.value.data?.value || []).map((project) => ({ id: project.id, name: project.name, state: project.state })) };
    },
    status() {
      const settings = readSettings();
      const store = readMyTasksStore(root);
      return {
        enabled: settings.enabled,
        schedule_on: settings.schedule_on,
        interval_minutes: settings.interval_minutes,
        running: Boolean(active),
        active_run_id: active ? active.runId : null,
        paused: store.runs.paused,
        backoff_until: store.runs.backoff?.until || null,
        next_due_at: dueAt(settings, store, now()),
        last_run: store.runs.last,
        identity: store.identity || null,
        connection: store.connection,
      };
    },
    items() {
      const store = readMyTasksStore(root);
      const records = Object.values(store.records).map((record) => ({ ...record }));
      records.sort((left, right) => (left.priority ?? 99) - (right.priority ?? 99) || new Date(right.changed_at || 0) - new Date(left.changed_at || 0));
      return { items: records, projects: store.projects, connection: store.connection, generated_at: now().toISOString() };
    },
    item(key) { return readMyTasksStore(root).records[String(key)] || null; },
    check,
    async tick(at = now()) {
      const moment = at instanceof Date ? at : new Date(at);
      const settings = readSettings();
      const store = readMyTasksStore(root);
      if (!settings.enabled) return { ran: false, reason: "disabled" };
      if (!settings.schedule_on) return { ran: false, reason: "schedule_off" };
      if (store.runs.paused) return { ran: false, reason: "paused" };
      if (active) return { ran: false, reason: "running", run_id: active.runId };
      const due = dueAt(settings, store, moment);
      if (!due || moment < new Date(due)) return { ran: false, reason: "not_due", next_due_at: due };
      try {
        await check({ reason: "schedule", at: moment });
        return { ran: true };
      } catch (error) {
        return { ran: false, reason: "check_failed", error: String(error.message || error).slice(0, 200) };
      }
    },
    start() {
      if (timer) return;
      if (!readSettings().enabled) return; // independent feature flag: off ⇒ no scheduler
      timer = setInterval(() => { engine.tick().catch(() => {}); }, intervalMs);
      timer.unref?.();
      // Service start: exactly one catch-up check when overdue — missed
      // checks never accumulate into a backlog.
      void engine.tick().catch(() => {});
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
  return engine;
}
