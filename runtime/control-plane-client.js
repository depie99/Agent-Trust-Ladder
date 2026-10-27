(() => {
  "use strict";

  // All browser mutations carry the server-issued CSRF token. The owner
  // session itself is an HttpOnly cookie set when the live shell is served.
  const atlFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const headers = new Headers(init.headers || {});
      headers.set("x-atl-csrf", document.querySelector('meta[name="atl-csrf"]')?.content || "");
      init = { ...init, credentials: "same-origin", headers };
    }
    return atlFetch(input, init);
  };

  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const attachmentMarkup = () => {
    if (!studioAttachments.length) return '<span class="muted tiny">No references attached.</span>';
    return studioAttachments.map((file, index) => {
      const preview = file.preview
        ? `<img src="${escapeHtml(file.preview)}" alt="Preview of ${escapeHtml(file.name)}" class="attachment-preview">`
        : "";
      const kind = file.text ? "text included" : "visual reference";
      return `<div class="planout attachment-card"><div class="row between"><b class="truncate">${escapeHtml(file.name)}</b>${btn("Remove", `studio-file-remove:${index}`, "sm ghost")}</div><span class="muted tiny">${escapeHtml(file.type || "application/octet-stream")} · ${Math.ceil(file.size / 1024)} KB · ${kind}</span>${preview}</div>`;
    }).join("");
  };
  const taskLayoutStyle = document.createElement("style");
  taskLayoutStyle.textContent = `
    body.atl-rtl { direction:rtl; font-family:Tahoma,"Segoe UI",Arial,sans-serif; text-align:start; }
    body.atl-rtl .sidebar { border-inline-end:0; border-inline-start:1px solid var(--border); }
    body.atl-rtl .topbar, body.atl-rtl .pagehead, body.atl-rtl .paneltitle, body.atl-rtl .event,
    body.atl-rtl .row, body.atl-rtl .bar { direction:rtl; text-align:start; }
    body.atl-rtl .status-icon, body.atl-rtl .track .fill { direction:ltr; }
    body.atl-rtl input, body.atl-rtl textarea, body.atl-rtl select { text-align:start; }
    body.atl-rtl .btn { letter-spacing:0; font-family:inherit; }
    body.atl-rtl .eyebrow, body.atl-rtl .label { letter-spacing:.02em; }
    body.atl-rtl .bidi-isolate { unicode-bidi:isolate; text-align:start; }
    body.atl-rtl .terminal, body.atl-rtl code { font-family:"Cascadia Mono",Consolas,monospace; }
    .tableitem.task-row { grid-template-columns:minmax(0,1fr) minmax(220px,auto); align-items:center; gap:20px; overflow:hidden; }
    .task-main { display:grid; grid-template-columns:20px minmax(0,1fr); gap:9px; min-width:0; align-items:start; }
    .task-main-copy { min-width:0; overflow:hidden; }
    .task-main-copy > b { display:block; max-width:100%; }
    .task-controls { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; align-items:center; justify-self:end; min-width:220px; }
    .task-control-meta { display:flex; align-items:center; justify-content:flex-end; gap:9px; min-width:0; }
    .task-owner { display:grid; gap:1px; min-width:64px; }
    .task-owner-label { color:var(--muted); font-size:9px; letter-spacing:.08em; text-transform:uppercase; }
    .task-owner-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; font-weight:600; }
    .task-actions { display:flex; flex-wrap:nowrap; gap:7px; justify-content:flex-end; }
    .task-row .task-progress { min-width:180px; }
    .progress-evidence > .row { align-items:flex-start; gap:12px; margin-top:8px; }
    .progress-evidence > .row > span:first-child { min-width:0; overflow-wrap:anywhere; }
    .progress-evidence .status-badge { flex-shrink:0; }
    .approval-request { margin-top:12px; overflow-wrap:anywhere; }
    .approval-request .row, .approval-request .bar { flex-wrap:wrap; }
    .approval-request h3 { margin:0; font-size:17px; }
    .approval-scope { margin-block:12px; padding-inline-start:20px; }
    .approval-scope li { margin-block:7px; }
    .approval-request details { margin-top:12px; }
    .approval-request summary { cursor:pointer; }
    .approval-request pre { white-space:pre-wrap; overflow-wrap:anywhere; }
    .attachment-list { flex-wrap:wrap; }
    .attachment-card { margin:0; padding:8px; min-width:180px; max-width:260px; flex:1 1 180px; }
    .attachment-preview { display:block; width:100%; max-height:120px; object-fit:contain; margin-top:8px; border-radius:5px; background:var(--field-bg); }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    .status-icon { display:inline-grid; place-items:center; width:24px; height:24px; border:1px solid currentColor; border-radius:50%; font-size:12px; font-weight:800; line-height:1; flex:0 0 auto; }
    .status-icon.red { color:var(--red); background:color-mix(in srgb, var(--red) 12%, transparent); }
    .status-icon.amber { color:var(--amber); background:color-mix(in srgb, var(--amber) 12%, transparent); }
    .status-icon.green { color:var(--accent); background:color-mix(in srgb, var(--accent) 12%, transparent); }
    .status-icon.blue { color:var(--blue); background:color-mix(in srgb, var(--blue) 12%, transparent); }
    .status-icon.violet { color:var(--violet); background:color-mix(in srgb, var(--violet) 12%, transparent); }
    .diagram-story { display:grid; gap:0; }
    .diagram-story-step { position:relative; display:grid; grid-template-columns:36px minmax(0,1fr); gap:12px; padding:10px 0 24px; }
    .diagram-story-step:last-child { padding-bottom:0; }
    .diagram-node { width:30px; height:30px; display:grid; place-items:center; border-radius:50%; background:var(--accent); color:#071016; font-weight:800; font-size:11px; }
    .diagram-story-step .sub { margin:4px 0 0; }
    .diagram-arrow { position:absolute; left:11px; bottom:3px; color:var(--muted); font-size:16px; }
    .diagram-relationships { display:grid; gap:9px; }
    .diagram-relationship { display:grid; grid-template-columns:max-content 22px minmax(0,1fr); gap:8px; align-items:center; padding:10px; border:1px solid var(--border); border-radius:7px; }
    .diagram-connector { color:var(--accent); text-align:center; }
    .task-row .btn { min-height:32px; padding:6px 11px; border-radius:8px; font-weight:700; }
    .task-row .btn.primary { box-shadow:0 2px 0 color-mix(in srgb, var(--accent) 55%, transparent); }
    @media (max-width:760px) { .diagram-relationship { grid-template-columns:1fr; gap:4px; } .diagram-connector { display:none; } }
    @media (max-width:760px) {
      .tableitem.task-row { grid-template-columns:minmax(0,1fr); gap:12px; padding:13px 14px; }
      .task-controls { display:flex; width:100%; min-width:0; justify-self:stretch; justify-content:space-between; gap:12px; }
      .task-control-meta { justify-content:flex-start; }
      .task-owner { min-width:0; }
      .task-row .task-progress { min-width:0; }
      .task-row .task-progress .row { flex-wrap:wrap; gap:4px 8px; }
      .task-row .task-progress .row b { margin-left:auto; }
      .task-row .btn { min-height:34px; padding:7px 12px; font-size:12px; border-radius:8px; }
    }
  `;
  document.head.append(taskLayoutStyle);
  const routes = [
    ["overview", "▦", "Overview"], ["tasks", "☷", "Tasks"], ["studio", "◇", "Plan Studio"], ["queues", "≡", "Queues"],
    ["team", "♙", "Agent Team"], ["projects", "⌂", "Projects"], ["approvals", "✓", "Approvals"], ["operations", "▣", "Operations"], ["brain", "◈", "Knowledge"], ["activity", "▤", "Activity & Logs"], ["usage", "◉", "Usage & Limits"], ["settings", "⚙", "Settings"],
  ];
  const fallback = {
    state: { tasks: {}, log_tail: [] }, queues: { active_queue: "default", items: [] }, notifications: { unread: 0, items: [] },
    usage: { snapshots: [], latest: null }, team: [], brain: { sources: { total: 0, by_result: {}, sources: [] }, claims: [], stale: [], skills: [], routines: [] },
  };
  let snapshot = fallback;
  let page = (() => {
    try {
      const saved = sessionStorage.getItem("atl-cp-page");
      return routes.some((route) => route[0] === saved) ? saved : "overview";
    } catch { return "overview"; }
  })();
  let filter = "All";
  let query = "";
  let queueFilter = "All";
  let dialogOpen = false;
  let detailExecution = null;
  let cliHistory = ["ATL control plane connected. Type help."];
  let connected = false;
  let streamCursor = 0;
  let streamRetry = 1000;
  let stream;
  let currentDraft = null;
  let currentRun = { status: "idle", progress: [], results: [] };
  let pendingApprovalAction = null;
  let activityFilter = "";
  let studioGoal = "";
  let studioMode = "local";
  let studioProvider = "";
  let studioModel = "";
  let studioThinking = "";
  let studioProviders = null;
  let studioProvidersAt = 0;
  let studioBusy = false;
  let studioNotice = "";
  let studioErrorLog = null;
  let studioRejectedResponse = null;
  let studioStartedAt = null;
  let studioElapsedTimer = null;
  let studioAttachments = [];
  let locale = (() => { try { return localStorage.getItem("atl-cp-lang") || localStorage.getItem("atl-locale") || "en-US"; } catch { return "en-US"; } })();
  const selectedQueues = new Set();
  const selectedTasks = new Set();
  const selectedProjects = new Set();
  // Provider manager modal state (never holds key material — keys travel
  // once, from the password input straight into POST /api/providers).
  let pmTemplates = [];
  let builtinWorkers = [];
  let defaultProvider = null;
  let pmRemoveConfirm = null;
  let pmEditingId = null;
  let navigationSettings = null;
  let navigationNotice = "";
  let usageNotice = "";
  // Task-card editor state: the collapsed card shows title + data; "Edit"
  // opens the form (openCard/cardDraft). While the form is open the 2s
  // snapshot repaint is suppressed so in-progress edits are never wiped.
  const WORKER_ROLES = ["mira", "pip", "rowan", "sage", "beacon"];
  const SKILL_OPTIONS = ["atl-frame", "atl-specify", "atl-plan", "atl-implement", "atl-verify", "atl-audit", "atl-adr", "atl-bootstrap", "atl-team", "atl-diagrams", "atl-tech-docs", "atl-trust", "atl-ui-review", "atl-content-quality", "atl-formal-verification"];
  let openCard = null;
  let cardDraft = null;

  function openCardEditor(proposal) {
    openCard = proposal.id;
    cardDraft = {
      title: proposal.title || "",
      objective: proposal.objective || "",
      worker: proposal.proposed_worker || "pip",
      skills: [...(proposal.selected_skills || [])],
      checksText: (proposal.completion_checks || []).join("\n"),
      filesText: (proposal.files || []).join(", "),
      depsText: (proposal.depends_on || []).join(", "),
      verify: proposal.verify || "",
      feedback: "",
    };
  }

  function closeCardEditor() { openCard = null; cardDraft = null; }

  const sameList = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

  function studioElapsedLabel() {
    const seconds = Math.max(0, Math.floor((Date.now() - (studioStartedAt || Date.now())) / 1000));
    return seconds < 60 ? `${seconds}s elapsed` : `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
  }
  function updateStudioElapsed() {
    const elapsed = document.querySelector("[data-studio-elapsed]");
    if (elapsed) elapsed.textContent = studioElapsedLabel();
  }
  function startStudioProgress() {
    studioStartedAt = Date.now();
    clearInterval(studioElapsedTimer);
    studioElapsedTimer = setInterval(updateStudioElapsed, 1000);
  }
  function stopStudioProgress() {
    clearInterval(studioElapsedTimer);
    studioElapsedTimer = null;
    studioStartedAt = null;
  }
  function studioProgressPanel() {
    if (!studioBusy) return "";
    return `<div class="notice" role="status" aria-live="polite" aria-atomic="true" data-studio-status style="margin-bottom:14px;border-color:var(--accent)"><div class="row between"><b class="green">⟳ Model plan request in progress</b><span class="pill green" data-studio-elapsed>${escapeHtml(studioElapsedLabel())}</span></div><p class="sub" style="margin-top:8px">Request sent to ${escapeHtml((studioProviders || []).find((provider) => provider.id === studioProvider)?.label || "the selected provider")}. Waiting for its response; this page will update with editable task cards when the schema validates.</p><p class="muted tiny" style="margin-top:7px">Bounded to one planning session and 15 minutes. Your existing draft remains unchanged while this runs.</p></div>`;
  }
  function studioContext() {
    if (!studioAttachments.length) return studioGoal;
    const refs = studioAttachments.map((file) => file.text ? `\n\n--- Attached text: ${file.name} ---\n${file.text.slice(0, 50000)}` : `\n\n[Attached visual reference: ${file.name} (${file.type}, ${file.size} bytes). Inspect this reference in the Plan Studio UI.]`).join("");
    return `${studioGoal}${refs}`;
  }

  async function loadProviders(force = false) {
    if (!force && studioProviders && Date.now() - studioProvidersAt < 30000) return studioProviders;
    try {
      const response = await fetch("/api/providers", { cache: "no-store" });
      const result = await response.json();
      studioProviders = Array.isArray(result.providers) ? result.providers : [];
      pmTemplates = Array.isArray(result.templates) ? result.templates : pmTemplates;
      builtinWorkers = Array.isArray(result.builtin) ? result.builtin : builtinWorkers;
      defaultProvider = result.defaultProvider || null;
      studioProvidersAt = Date.now();
      if (!studioProvider) {
        const preferred = studioProviders.find((provider) => provider.id === defaultProvider && provider.ready) || studioProviders.find((provider) => provider.ready);
        if (preferred) {
          studioProvider = preferred.id;
          studioModel = preferred.model || preferred.models?.[0] || "";
          studioThinking = preferred.thinking_level || "";
        }
      }
    } catch { studioProviders = studioProviders || []; }
    return studioProviders;
  }

  async function planApi(pathname, body) {
    const csrf = document.querySelector('meta[name="atl-csrf"]')?.content || "";
    const response = await fetch(pathname, { method: "POST", headers: { "content-type": "application/json", "x-atl-csrf": csrf }, body: JSON.stringify(body || {}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || `plan API failed (${response.status})`), { providerResponse: result.providerResponse || null, providerLogLines: result.providerLogLines || null });
    return result;
  }

  async function loadNavigation() {
    const response = await fetch("/api/navigation", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "could not load navigation settings");
    navigationSettings = result.navigation;
    return navigationSettings;
  }

  function statusLabel(value) {
    const aliases = { new: "New", triaged: "Queued", assigned: "Queued", in_progress: "In progress", in_review: "Review", verifying: "Review", blocked: "Blocked", escalated: "Escalated", done: "Done", rejected: "Rejected", archived: "Archived" };
    return aliases[String(value || "unknown")] || String(value || "unknown").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
  }
  function badge(value) {
    const label = statusLabel(value);
    const token = { Blocked: "red", High: "amber", Running: "green", Done: "green", Queued: "blue", Review: "violet", InProgress: "green", InReview: "violet", PASS: "green", VERIFY: "violet", INFO: "blue", Idle: "blue", Unknown: "amber" }[label] || "";
    return `<span class="pill status-badge ${token}" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
  }
  const btn = (text, action, cls = "") => `<button class="btn ${cls}" data-action="${escapeHtml(action)}"${cls.includes("disabled") ? ' disabled aria-disabled="true"' : ""}>${text}</button>`;
  const head = (label, title, subtitle, buttons = "") => `<div class="pagehead"><div><div class="eyebrow">${label}</div><h1>${title}</h1><p class="sub">${subtitle}</p></div><div class="bar">${buttons}</div></div>`;
  const card = (title, html, extra = "", cls = "") => `<section class="panel${cls ? ` ${cls}` : ""}"><div class="paneltitle"><h2>${title}</h2>${extra}</div>${html}</section>`;
  const meter = (value, color = "var(--accent)") => `<div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, Number(value) || 0))}%;background:${color}"></div></div>`;
  const defaultChip = (isDefault) => isDefault
    ? '<span class="pill blue">default</span>'
    : `<button class="btn sm ghost" data-action="card-reset-defaults" title="Snap back to the generated plan's choice">↺ default</button>`;
  function cardEditor(proposal, draft) {
    const defaults = proposal.defaults || { proposed_worker: proposal.proposed_worker, selected_skills: proposal.selected_skills || [] };
    const workerIsDefault = draft.worker === defaults.proposed_worker;
    const skillsAreDefault = sameList(draft.skills, defaults.selected_skills);
    const skillChips = SKILL_OPTIONS.map((skill) => `<button class="btn sm ${draft.skills.includes(skill) ? "primary" : ""}" data-action="card-skill:${escapeHtml(skill)}">${escapeHtml(skill)}</button>`).join("");
    const workerOptions = WORKER_ROLES.map((role) => `<option value="${escapeHtml(role)}" ${draft.worker === role ? "selected" : ""}>${escapeHtml(role)}</option>`).join("");
    return `<div class="planout" style="margin-bottom:14px;border:1px solid var(--accent);border-radius:8px;padding:12px" data-proposal="${escapeHtml(proposal.id)}">
<div class="row between"><div class="bar"><b>◇ ${escapeHtml(proposal.id)}</b><span class="pill violet">editing · rev ${Number(proposal.revision) || 1}</span></div>${btn("✕", "card-cancel", "sm ghost")}</div>
<div class="field"><label class="label">Task title</label><input class="input" data-pfield="title" value="${escapeHtml(draft.title)}"></div>
<div class="field"><label class="label">Objective</label><textarea class="input" rows="2" data-pfield="objective">${escapeHtml(draft.objective)}</textarea></div>
<div class="grid two"><div class="field"><label class="label">Proposed worker</label><div class="bar" style="margin-bottom:6px">${defaultChip(workerIsDefault)}</div><select class="input" data-card-worker>${workerOptions}</select></div>
<div class="field"><label class="label">Skills (multi select)</label><div class="bar" style="margin-bottom:6px">${defaultChip(skillsAreDefault)}</div><div class="bar" style="flex-wrap:wrap;gap:6px">${skillChips}</div></div></div>
<div class="field"><label class="label">Completion checks (one per line)</label><textarea class="input" rows="2" data-pfield="checksText">${escapeHtml(draft.checksText)}</textarea></div>
<div class="grid two"><div class="field"><label class="label">Files (comma separated)</label><input class="input" data-pfield="filesText" value="${escapeHtml(draft.filesText)}"></div><div class="field"><label class="label">Verifier</label><input class="input" data-pfield="verify" value="${escapeHtml(draft.verify)}"></div></div>
<div class="field"><label class="label">Depends on (proposal ids, comma separated)</label><input class="input" data-pfield="depsText" value="${escapeHtml(draft.depsText)}"></div>
<div class="bar" style="margin-top:10px"><input class="input" style="flex:1" placeholder="Correction feedback for regeneration…" data-pfield="feedback" value="${escapeHtml(draft.feedback)}">${btn("Regenerate", `card-regen:${escapeHtml(proposal.id)}`, "sm")}</div>
<div class="actionrow">${btn("Confirm", `card-save:${escapeHtml(proposal.id)}`, "primary")}${btn("Cancel", "card-cancel", "sm")}</div>
</div>`;
  }
  function taskCard(proposal, index, total) {
    if (openCard === proposal.id && cardDraft) return cardEditor(proposal, cardDraft);
    const sourceToken = proposal.source === "model" ? "violet" : proposal.source === "manager-edit" ? "amber" : "blue";
    const defaults = proposal.defaults || { proposed_worker: proposal.proposed_worker, selected_skills: proposal.selected_skills || [] };
    const workerIsDefault = proposal.proposed_worker === defaults.proposed_worker;
    const skillsAreDefault = sameList(proposal.selected_skills, defaults.selected_skills);
    const meta = [
      `worker ${escapeHtml(proposal.proposed_worker)}${workerIsDefault ? " · default" : ""}`,
      `${(proposal.selected_skills || []).length ? escapeHtml(proposal.selected_skills.join(", ")) : "no skills"}${skillsAreDefault ? " · default" : ""}`,
      `${(proposal.completion_checks || []).length} check(s)`,
      (proposal.files || []).length ? `files: ${escapeHtml(proposal.files.join(", "))}` : "",
      proposal.verify ? `verify: ${escapeHtml(proposal.verify)}` : "",
      (proposal.depends_on || []).length ? `after ${escapeHtml(proposal.depends_on.join(", "))}` : "",
      (proposal.feedback || []).length ? `feedback on file: ${escapeHtml(proposal.feedback.map((item) => item.text).join(" | "))}` : "",
    ].filter(Boolean).join("  ·  ");
    return `<div class="planout" style="margin-bottom:14px;border:1px solid var(--line);border-radius:8px;padding:12px" data-proposal="${escapeHtml(proposal.id)}">
<div class="row between"><div class="bar"><b>◇ ${escapeHtml(proposal.id)}</b><span class="pill ${sourceToken}">rev ${Number(proposal.revision) || 1} · ${escapeHtml(proposal.source || "local")}</span></div><div class="bar">${btn("Edit", `card-edit:${escapeHtml(proposal.id)}`, "sm")}${index > 0 ? btn("↑", `card-up:${escapeHtml(proposal.id)}`, "sm") : ""}${index < total - 1 ? btn("↓", `card-down:${escapeHtml(proposal.id)}`, "sm") : ""}${btn("Remove", `card-remove:${escapeHtml(proposal.id)}`, "sm danger")}</div></div>
<b style="display:block;margin-top:6px">${escapeHtml(proposal.title)}</b>
<div class="muted tiny" style="margin-top:6px;line-height:1.7">${meta}</div>
</div>`;
  }
  function planPreview(draft) {
    const plan = draft?.artifact;
    if (!plan) return '<div class="planout muted">Generate a local preview or a model plan to review editable task cards here before creating or queueing anything.</div>';
    const label = draft.label || { mode: draft.provider ? "model" : "local", label: draft.provider ? "Model plan" : "Local structural draft" };
    const examples = (plan.acceptance_examples || []).map((item) => `<li><b>Given</b> ${escapeHtml(item.given)} <b>when</b> ${escapeHtml(item.when)} <b>then</b> ${escapeHtml(item.then)}</li>`).join("");
    const proposals = Array.isArray(plan.task_proposals) && plan.task_proposals.length ? plan.task_proposals : null;
    const cards = proposals
      ? `<h3>Task cards <span class="muted tiny">(${proposals.length} canonical tasks on approval)</span></h3>${proposals.map((proposal, index) => taskCard(proposal, index, proposals.length)).join("")}<div class="actionrow">${btn("+ Add task card", "card-add", "sm")}</div>`
      : `<div class="notice"><b class="amber">Legacy draft without editable cards</b><p class="sub">Regenerate this plan (model mode) to get typed, editable task cards. Approval currently maps its ${plan.implementation_steps?.length || 0} implementation step(s) 1:1 to canonical tasks.</p></div>`;
    const steps = (plan.implementation_steps || []).map((item, index) => `<div class="event"><span class="pill">${index + 1}</span><div><b>${escapeHtml(item.step)}</b><div class="muted tiny">Files: ${escapeHtml((item.files || []).join(", "))}</div><div class="green tiny">Verify: ${escapeHtml(item.verify)}</div></div></div>`).join("");
    return `<div class="planout"><div class="bar">${badge(draft.stage)}<span class="pill ${label.mode === "model" ? "violet" : "blue"}">${escapeHtml(label.label)}</span>${label.generated_at ? `<span class="muted tiny">generated ${escapeHtml(new Date(label.generated_at).toLocaleTimeString())}</span>` : ""}<span class="muted tiny">${escapeHtml(draft.id)}</span></div><h2>${escapeHtml(plan.title)}</h2><p>${escapeHtml(plan.objective)}</p><h3>Acceptance examples</h3><ol>${examples}</ol>${cards}<h3>Reference · implementation steps</h3>${steps}<h3>Verifier commands</h3><pre>${escapeHtml((plan.verifier_commands || []).join("\n"))}</pre><div class="notice"><b>Approval creates the Plan Queue</b><p class="sub">${proposals ? proposals.length : plan.implementation_steps?.length || 0} ordered canonical task(s) are created and queued — nothing executes until you preview the queue and confirm a run.</p></div><div class="actionrow">${btn("Approve and create Plan Queue", `plan-approve:${draft.id}`, "primary")}${btn("Approve, then open Queues", `plan-queue:${draft.id}`, "primary")}</div></div>`;
  }
  function rejectedPlanPreview(response) {
    if (response == null) return "";
    return `<div class="planout" data-rejected-plan-preview><div class="notice"><b class="amber">Model response needs repair — review only</b><p class="sub">The schema gate rejected this response. It is shown in full for correction, but it was not saved as a draft and cannot be approved or queued.</p></div><h3>Full generated plan response</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:70vh;overflow:auto">${escapeHtml(response)}</pre></div>`;
  }
  function runPanel() {
    const lines = [...(currentRun.progress || []), ...(currentRun.results || []).map((item) => `${item.id || item.taskId || "task"}: ${item.status} ${item.reason || ""}`)];
    const runLabel = currentRun.queueId || ((currentRun.taskIds || []).length ? `task run · ${currentRun.taskIds.join(", ")}` : snapshot.queues?.active_queue || "active queue");
    return `<section class="panel pad space"><div class="row between"><div><h2>Queue execution</h2><p class="sub">${escapeHtml(runLabel)} · ${escapeHtml(currentRun.status || "idle")}</p></div>${badge(currentRun.status || "idle")}</div><div class="terminal" style="max-height:320px;overflow:auto">${escapeHtml(lines.join("\n") || "No run started. Preview the queue before confirmation.")}</div>${currentRun.status === "running" ? `<div class="actionrow">${btn("Stop safely", "run-stop", "danger")}</div>` : ""}</section>`;
  }

  function taskProgress(task) {
    const checks = [...new Set((task.completion_checks || []).map((check) => String(check).trim()).filter(Boolean))];
    const revision = task.packet_revision || 1;
    const evidence = (task.evidence || []).filter((item) => (item.packet_revision || 1) === revision);
    const review = evidence.findLast((item) => item.kind === "review");
    const rejectedAt = review?.result === "changes-requested" ? evidence.lastIndexOf(review) : -1;
    const results = new Map();
    evidence.forEach((item, index) => {
      if (index > rejectedAt && item.kind === "check") results.set(String(item.check || "").trim(), item.result);
    });
    const checkResults = checks.map((check) => ({ check, result: results.get(check) || "pending" }));
    const passed = checkResults.filter((item) => item.result === "pass").length;
    const failed = checkResults.filter((item) => item.result === "fail").length;
    const reviewRequired = Boolean(task.review_required);
    const reviewPassed = review?.result === "approve";
    const finished = (task.rawStatus || task.status) === "done";
    const total = checks.length + (reviewRequired ? 1 : 0) + 1;
    const completed = passed + (reviewRequired && reviewPassed ? 1 : 0) + (finished ? 1 : 0);
    return { percent: checks.length ? Math.floor(completed * 100 / total) : null, completed, total, passed, failed,
      checks: checkResults, reviewRequired, reviewPassed, finished };
  }

  function taskProgressMarkup(task, detailed = false) {
    const progress = task.progressDetails || taskProgress(task);
    const label = progress.percent === null ? "Progress unknown" : `Acceptance progress · ${progress.completed}/${progress.total} gates`;
    const explanation = "Latest results for the current task revision: completion checks, required review, and final completion. Evidence rejected by review is excluded. This measures acceptance gates, not elapsed time or remaining effort.";
    const items = detailed ? `<div class="muted tiny" style="margin-top:8px">${escapeHtml(explanation)}</div><div class="progress-evidence">${progress.checks.map((item) => `<div class="row between"><span>${escapeHtml(item.check)}</span>${badge(item.result)}</div>`).join("")}${progress.reviewRequired ? `<div class="row between"><span>Required review</span>${badge(progress.reviewPassed ? "Approved" : "Pending")}</div>` : ""}<div class="row between"><span>Final completion</span>${badge(progress.finished ? "Done" : "Pending")}</div></div>` : "";
    return `<div class="task-progress" data-task-progress="${escapeHtml(task.id)}" title="${escapeHtml(explanation)}"><div class="row between muted"><span>${escapeHtml(label)}</span><b>${progress.percent === null ? "—" : `${progress.percent}%`}</b></div><div role="progressbar" aria-label="Acceptance progress" aria-valuemin="0" aria-valuemax="100"${progress.percent === null ? ' aria-valuetext="Progress unknown"' : ` aria-valuenow="${progress.percent}" aria-valuetext="${progress.completed}/${progress.total} acceptance gates"`}>${meter(progress.percent)}</div>${items}</div>`;
  }

  function taskExecution(task) {
    const live = liveRunState(task);
    if (live === "running") return { label: "Running", reason: "Worker is executing this task." };
    if (["done", "archived", "rejected", "blocked", "escalated"].includes(task.rawStatus || task.status)) return { label: statusLabel(task.rawStatus || task.status), reason: "" };
    if (live === "queued") return { label: "Queued", reason: "Waiting for its turn in the active run." };
    const result = [...(currentRun.results || [])].reverse().find((item) => item.id === task.id);
    const included = (currentRun.taskIds || []).includes(task.id) || Boolean(result);
    if (["in_progress", "in_review", "verifying"].includes(task.rawStatus || task.status) || (included && currentRun.status !== "running")) {
      const reason = result?.reason || (included && currentRun.reason) || "No active worker. Resume to continue.";
      return { label: "Stopped", reason: /session budget reached/i.test(reason) ? "Session budget exhausted. Resume to continue." : reason };
    }
    return { label: statusLabel(task.rawStatus || task.status), reason: "" };
  }

  function workerLabel(task) {
    const worker = String(task.assigned_worker || task.proposed_worker || "").toLowerCase();
    return WORKER_ROLES.includes(worker) ? statusLabel(worker) : "Unassigned";
  }

  function lifecycleDiagram(task) {
    const steps = [["new", "Created"], ["triaged", "Queued"], ["assigned", "Assigned"], ["in_progress", "Running"], ["in_review", "Review"], ["verifying", "Verify"], ["done", "Done"]];
    const current = Math.max(0, steps.findIndex(([status]) => status === task.rawStatus));
    return `<div class="flow" aria-label="Task lifecycle">${steps.map(([status, label], index) => `<span class="step ${index === current ? "current" : ""}">${index < current || task.rawStatus === "done" ? "✓" : index === current ? "●" : "○"} ${label}</span>`).join("")}</div>`;
  }

  function taskOutcome(task) {
    const evidence = task.evidence || [];
    const progress = task.progressDetails || taskProgress(task);
    const last = evidence.at(-1);
    return { passed: progress.passed, failed: progress.failed, total: progress.checks.length, summary: task.lastCheckpoint?.note || last?.detail || (task.rawStatus === "done" ? "Completed with no outcome summary recorded." : "No outcome recorded yet.") };
  }

  function derived() {
    const queueByTask = new Map();
    for (const queue of snapshot.queues?.items || []) for (const item of queue.items || []) queueByTask.set(item.id, queue.name || queue.id);
    const tasks = Object.values(snapshot.state?.tasks || {}).map((task) => ({
      id: task.id, title: task.title, desc: task.objective || "", status: taskExecution(task).label, rawStatus: task.status,
      agent: workerLabel(task), priority: statusLabel(task.priority || "normal"),
      queue: queueByTask.get(task.id) || "Unqueued", block: task.blocker?.reason || "", archived: task.status === "archived",
      stage: taskExecution(task).reason || task.last_checkpoint?.note || statusLabel(task.status), progress: taskProgress(task).percent,
      progressDetails: taskProgress(task), completion_checks: task.completion_checks || [], packet_revision: task.packet_revision || 1, review_required: task.review_required,
      logs: (snapshot.state?.log_tail || []).filter((entry) => entry.task === task.id).slice(-8),
      evidence: task.evidence || [], lastCheckpoint: task.last_checkpoint || null, workspace: task.workspace || null,
    })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const queues = (snapshot.queues?.items || []).map((queue) => ({ ...queue, label: queue.name || queue.id }));
    const agents = (snapshot.team || []).map((agent) => [
      statusLabel(agent.role), agent.mission || "ATL role", tasks.find((task) => task.id === agent.taskId)?.status || statusLabel(agent.phase || "idle"),
      agent.taskId ? `${agent.taskId} · ${agent.taskTitle || agent.phase || "assigned"}` : (agent.phase || "Ready for next task"),
      tasks.find((task) => task.id === agent.taskId)?.progress ?? null,
    ]);
    const events = (snapshot.state?.log_tail || []).slice().reverse().map((item) => [
      item.at ? new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--",
      String(item.event || "INFO").toUpperCase(), item.actor || "ATL", `${item.task ? `${item.task}: ` : ""}${item.detail || item.note || "state changed"}`,
    ]);
    return { tasks, queues, agents, events };
  }

  const taskRowActions = (task) => {
    const liveRun = liveRunState(task);
    if (liveRun === "running") return btn("Stop", "run-stop", "sm danger");
    if (liveRun === "queued") return '<span class="pill blue" title="This task is included in the confirmed queue run">In run</span>';
    if (["in_progress", "in_review", "verifying"].includes(task.rawStatus)) return btn("Resume", `run-task:${task.id}`, `sm primary${currentRun.status === "running" ? " disabled" : ""}`) + btn("Logs", `task-detail:${task.id}`, "sm");
    if (task.rawStatus === "blocked") return btn("Unblock", `unblock:${task.id}`, "sm") + btn("Logs", `task-detail:${task.id}`, "sm");
    if (["done", "archived"].includes(task.rawStatus)) return btn("Logs", `task-detail:${task.id}`, "sm") + btn("Delete", `task-delete:${task.id}`, "sm danger");
    return btn("Run", `run-task:${task.id}`, "sm primary") + btn("More", `task-actions:${task.id}`, "sm");
  };
  function liveRunState(task) {
    if (currentRun.status !== "running") return null;
    if (currentRun.currentTaskId === task.id) {
      const leases = snapshot.leases?.sessions;
      if (Array.isArray(leases) && !leases.some((lease) => lease.task === task.id && lease.status === "active" && lease.expires_at > Date.now())) return null;
      return "running";
    }
    if ((currentRun.results || []).some((entry) => entry.id === task.id && !entry.waiting)) return null;
    if (Array.isArray(currentRun.taskIds) && currentRun.taskIds.includes(task.id)) return "queued";
    const queueIds = Array.isArray(currentRun.queueIds) ? currentRun.queueIds : (currentRun.queueId ? [currentRun.queueId] : []);
    const queue = (snapshot.queues?.items || []).find((item) => queueIds.includes(item.id) || queueIds.includes(item.name));
    if (!queue || !(queue.items || []).some((item) => (item.id || item.taskId) === task.id)) return null;
    return "queued";
  }
  const taskRow = (task) => { const outcome = taskOutcome(task); return `<div class="tableitem task-row" data-task="${escapeHtml(task.id)}"><div class="task-main"><input type="checkbox" data-tsel="${escapeHtml(task.id)}" ${selectedTasks.has(task.id) ? "checked" : ""} aria-label="Select ${escapeHtml(task.id)}"><div class="task-main-copy"><b class="truncate">${liveRunState(task) === "running" ? '<span class="running-mark" aria-label="running"></span>' : task.rawStatus === "done" ? '<span class="green">✓ </span>' : ""}${escapeHtml(task.title)}</b><div class="muted tiny">${escapeHtml(task.id)} · ${escapeHtml(task.queue)} · ${escapeHtml(task.stage)}</div><div class="row between muted tiny"><span>${task.rawStatus === "done" ? `Accomplished · ${outcome.passed}/${outcome.total} checks passed` : `Stage: ${escapeHtml(statusLabel(task.rawStatus))} · ${escapeHtml(task.status)}`}</span><b>${task.logs.length} log${task.logs.length === 1 ? "" : "s"}</b></div>${taskProgressMarkup(task)}</div></div><div class="task-controls"><div class="task-control-meta">${badge(task.status)}<span class="task-owner"><span class="task-owner-label">Assigned to</span><span class="task-owner-name">${escapeHtml(task.agent)}</span></span></div><div class="task-actions">${taskRowActions(task)}</div></div></div>`; };
  const eventRow = (event) => `<div class="event"><span class="muted tiny" style="white-space:nowrap">${escapeHtml(event[0])}</span><div>${badge(event[1])} <span class="muted">${escapeHtml(event[2])}</span><div style="margin-top:5px">${escapeHtml(event[3])}</div></div></div>`;
  const stat = (name, value, detail) => `<div class="panel stat"><small>${name}</small><strong>${value}</strong><div class="muted tiny">${detail}</div></div>`;

  function approvalSummary(item) {
    const request = item.action || {};
    const args = request.args || {};
    const queues = snapshot.queues?.items || [];
    const taskIds = Array.isArray(args.taskIds) ? args.taskIds : [];
    const queueIds = Array.isArray(args.queueIds) && args.queueIds.length ? args.queueIds
      : taskIds.length ? [] : request.target && request.target !== "selected" ? [request.target] : [];
    const selectedQueues = queueIds.map((id) => queues.find((queue) => queue.id === id) || { id, name: id, missing: true });
    const ids = taskIds.length ? taskIds : selectedQueues.flatMap((queue) => (queue.items || []).map((task) => task.id || task.taskId));
    const tasks = [...new Set(ids)].map((id) => snapshot.state?.tasks?.[id] || { id, title: "Task unavailable", status: "unknown" });
    const grant = [...(snapshot.approvals?.grants || [])].reverse().find((entry) => entry.proposal_id === item.id);
    const permission = item.status === "pending" ? "Awaiting your decision" : item.status === "denied" ? "Denied"
      : !grant ? "Permission record unavailable" : grant.revoked_at ? "Revoked" : grant.used_at ? "Used"
      : !(new Date(grant.expires_at).getTime() > Date.now()) ? "Expired" : "Available once";
    const continueRun = item.status === "pending" && pendingApprovalAction?.proposalId === item.id;
    return { title: request.operation === "run.queue" ? (taskIds.length ? "Run selected tasks" : "Run selected queues") : "Other requested action",
      request, tasks, queues: selectedQueues, directTasks: Boolean(taskIds.length), grant, permission, continueRun,
      unknownScope: request.operation !== "run.queue" || (!taskIds.length && !queueIds.length) };
  }

  function approvalCard(item) {
    const view = approvalSummary(item);
    const scope = view.queues.map((queue) => `<li><b>Queue</b>: <span dir="auto">${escapeHtml(queue.name || queue.id)}</span>${queue.missing ? ' <span class="muted">Queue unavailable</span>' : ""}</li>`).join("");
    const tasks = view.tasks.map((task) => `<li><b>${escapeHtml(task.id)}</b> · <span dir="auto">${escapeHtml(task.title)}</span> ${badge(statusLabel(task.status))}</li>`).join("");
    const effect = view.unknownScope ? "The scope of this request is incomplete. Inspect the technical details before deciding."
      : "Allows ATL to start worker sessions for the tasks below, using the configured provider. Workers can edit task workspace files. Run limits and task gates still apply.";
    const next = item.status === "pending" ? (view.continueRun ? "Approving starts this waiting run immediately in this tab. Denying keeps it stopped."
      : "Approve once grants permission for 10 minutes. It does not start a run from this page. Return to the task or queue, preview it, and confirm Run.")
      : view.permission === "Available once" ? "Permission is ready for one matching run. Return to its task or queue to preview and start it."
      : view.permission === "Used" ? "This permission has been used. It does not confirm that the tasks finished."
      : view.permission === "Expired" || view.permission === "Revoked" ? "This permission cannot start another run. Preview a new run to request approval again."
      : item.status === "denied" ? "This request was denied. No permission was granted." : "Review the recorded decision and request details.";
    const outcome = !item.execution || item.execution.status === "unknown" ? "Run result not recorded"
      : ({ running: "Run in progress", complete: "Run ended", finished: "Run ended", failed: "Run failed", stopped: "Run stopped", aborted: "Run stopped" }[item.execution.status] || item.execution.status);
    const buttons = item.status === "pending" ? btn(view.continueRun ? "Approve and start this run" : "Approve once", `approval-approve:${item.id}`, "sm primary") + btn("Deny request", `approval-deny:${item.id}`, "sm danger")
      : view.permission === "Available once" ? btn("Revoke unused permission", `approval-revoke:${view.grant.id}`, "sm danger") : "";
    return `<article class="panel pad approval-request" data-approval="${escapeHtml(item.id)}"><div class="row between"><h3>${escapeHtml(view.title)}</h3>${badge(view.permission)}</div><p class="sub">${escapeHtml(effect)}</p><p class="muted tiny"><b>Project</b>: <span dir="ltr">${escapeHtml(view.request.project || "Not recorded")}</span></p>${scope ? `<ul class="approval-scope">${scope}</ul>` : ""}${!view.directTasks && view.tasks.length ? '<b>Current queue contents</b><p class="muted tiny">This task list reflects the queue now. Check the run preview if the queue has changed.</p>' : ""}${tasks ? `<ul class="approval-scope">${tasks}</ul>` : ""}<div class="notice"><p>${escapeHtml(next)}</p></div><div class="row between space"><div><b>Decision</b>: ${badge(item.status)}<div class="muted tiny"><b>Requested</b>: ${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : "Not recorded")}${view.grant ? `<br><b>Permission expires</b>: ${escapeHtml(new Date(view.grant.expires_at).toLocaleString())}` : ""}</div></div><div class="bar">${buttons}</div></div><p class="sub"><b>Execution</b>: <span>${escapeHtml(outcome)}</span>${item.execution?.status !== "unknown" && item.execution?.reason ? ` · ${escapeHtml(item.execution.reason)}` : ""}</p><details><summary>Technical details</summary><pre>${escapeHtml(JSON.stringify({ request_id: item.id, fingerprint: item.digest, action: item.action, execution: item.execution || null }, null, 2))}</pre></details></article>`;
  }

  function approvalCenter() {
    const proposals = snapshot.approvals?.proposals || [];
    const pending = proposals.filter((item) => item.status === "pending").reverse();
    const history = proposals.filter((item) => item.status !== "pending").reverse();
    const available = proposals.filter((item) => approvalSummary(item).permission === "Available once").length;
    return head("GOVERNANCE / APPROVALS", "Approval center", "Decide whether ATL may start a requested action. Approval is permission; task completion is shown in Tasks and Queues.", btn("Refresh", "refresh"))
      + `<div class="notice"><b>How this works</b><p>1. Review the project, queue and tasks. 2. Approve once or deny. 3. Check execution and task results separately.</p><p class="sub">Approve once creates a single-use permission valid for 10 minutes. A button labeled Approve and start this run also resumes the matching request waiting in this tab.</p></div><div class="grid three space">${stat("Needs your decision", pending.length, "Requests waiting for permission")}${stat("Available permissions", available, "Unused and not expired")}${stat("Past decisions", history.length, "Approval does not mean completion")}</div><section class="space"><h2>Needs your decision</h2>${pending.map(approvalCard).join("") || '<p class="muted">No requests are waiting for your decision.</p>'}</section><section class="space"><h2>Previous decisions and execution</h2>${history.map(approvalCard).join("") || '<p class="muted">No past decisions.</p>'}</section>`;
  }

  function showRunApproval(proposal, command) {
    pendingApprovalAction = { proposalId: proposal.id, command };
    popup("Review run permission", approvalCard(proposal), btn("Open approval center", "go:approvals") + btn("Close", "close"));
    applyLocale();
  }

  async function applyApprovalDecision(id, approve) {
    const continuation = pendingApprovalAction?.proposalId === id ? pendingApprovalAction.command : null;
    try {
      const response = await fetch("/api/approvals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "decide", proposal_id: id, decision: approve ? "allow-once" : "deny" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "approval decision failed");
      if (continuation) pendingApprovalAction = null;
      close(); await refresh(false); page = "approvals"; render();
      if (approve && continuation) await action(continuation);
    } catch (error) { popup("Approval decision failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); }
  }

  const panels = {
    overview: () => {
      const { tasks, events } = derived();
      const blocked = tasks.filter((task) => task.rawStatus === "blocked").length;
      const done = tasks.filter((task) => task.rawStatus === "done").length;
      return head("WORKSPACE / CONTROL ROOM", "Overview", "Tasks, execution health, decisions and live agent activity.", btn("⌕ Commands", "palette") + btn("CLI console", "cli"))
        + `<div class="bar" style="margin-bottom:14px"><span class="pill green">● Manager online · ${connected ? "live" : "offline"}</span><span class="pill amber">${blocked} blocked</span><span class="pill blue">SDD / TDD</span></div>`
        + `<div class="grid four">${stat("Portfolio", tasks.length, "Tracked tasks")}${stat("Active / available", `${tasks.filter((task) => !["done", "archived"].includes(task.rawStatus)).length} / 5`, "Agent snapshot")}${stat("Blocked", blocked, "Need intervention")}${stat("Shipped", done, "Verified work")}</div>`
        + `<div class="grid twocol space"><div>${card("Task portfolio", tasks.filter((task) => !task.archived).slice(0, 5).map(taskRow).join("") || '<div class="pad muted">No tasks yet.</div>', btn("Open tasks →", "go:tasks", "sm"))}<div class="space">${card("SDD / TDD lifecycle", '<div class="pad"><div class="flow">' + ["Intake", "Triaged", "Spec", "Tests", "Assigned", "Run", "Review", "Verify", "Done"].map((step, index) => `<span class="step ${index === 5 ? "current" : ""}">${step}</span>`).join("") + '</div><p class="sub" style="margin-top:13px">Every delivery is traceable from requirement to test and evidence.</p></div>')}</div></div>`
        + `<div>${card("Attention required", `<div class="pad"><b class="${blocked ? "red" : "green"}">${blocked} actionable blockers</b><p class="sub" style="margin:10px 0 15px">${blocked ? "Inspect the full blocker evidence and recover through the owner gate." : "No active blocker is waiting for the manager."}</p>${btn("Inspect blockers", "blockers")}</div>`)}<div class="space">${card("Live activity", `<div class="pad">${events.slice(0, 4).map(eventRow).join("") || '<span class="muted">No activity recorded yet.</span>'}</div>`, btn("All events →", "go:activity", "sm"))}</div></div></div>`;
    },
    tasks: () => {
      const { tasks } = derived();
      const allTasks = tasks.filter((task) => !task.archived);
      const queueTasks = allTasks.filter((task) => queueFilter === "All" || task.queue === queueFilter);
      const visible = queueTasks.filter((task) => (filter === "All" || task.status === filter) && [task.title, task.id, task.agent, task.desc].join(" ").toLowerCase().includes(query.toLowerCase()));
      const queueOptions = [...new Set(tasks.map((task) => task.queue).filter((queue) => queue !== "Unqueued"))];
      const scoped = queueFilter !== "All";
      const selectedQueue = derived().queues.find((queue) => queue.label === queueFilter);
      const taskPageActions = btn("+ Create task", "new", "primary") + (selectedQueue?.id === "default" ? btn("Clear Default queue", "queue-clear:default", "danger") : "");
      const bulkToolbar = `<div class="bar" style="margin-top:13px"><span class="muted tiny">${selectedTasks.size} selected</span>${btn("Select visible", "tasks-select-visible", "sm")}${selectedTasks.size ? btn("Clear selection", "tasks-clear-selection", "sm") + btn(`Archive ${selectedTasks.size}`, "tasks-archive-selected", "sm danger") : ""}</div>`;
      const countLabel = (status) => {
        const scopedCount = status === "All" ? queueTasks.length : queueTasks.filter((task) => task.status === status).length;
        const totalCount = status === "All" ? allTasks.length : allTasks.filter((task) => task.status === status).length;
        return scoped ? `${status} ${scopedCount} / ${totalCount}` : `${status} ${totalCount}`;
      };
      return head("WORKSPACE / TASKS", "Task management", "Author, prioritize, assign and inspect work without leaving the UI.", taskPageActions)
        + `<div class="panel"><div class="pad"><div class="bar"><input style="flex:1;min-width:180px" class="input" id="taskSearch" placeholder="Search tasks..." value="${escapeHtml(query)}"><select id="queueSelect" class="input" style="width:165px"><option>All</option>${queueOptions.map((queue) => `<option ${queue === queueFilter ? "selected" : ""}>${escapeHtml(queue)}</option>`).join("")}</select></div>${scoped ? `<div class="notice" style="margin-top:13px;padding:10px"><div class="row between"><span>Showing queue <b>${escapeHtml(queueFilter)}</b>. Counts are <b>this queue / all queues</b>.</span>${btn("Show all queues", "queue:All", "sm")}</div></div>` : ""}<div class="bar" style="margin-top:13px">${["All", "Queued", "Running", "Blocked", "Review", "Done"].map((status) => btn(countLabel(status), `filter:${status}`, `sm ${filter === status ? "primary" : ""}`)).join("")}</div>${bulkToolbar}</div>${visible.map(taskRow).join("") || '<div class="pad muted">No matching tasks in this scope.</div>'}</div>`;
    },
    studio: () => {
      const providers = studioProviders || [];
      const selected = providers.find((provider) => provider.id === studioProvider) || null;
      const modelReady = studioMode !== "model" || (selected && selected.ready);
      const generateLabel = studioBusy ? "Generating model plan…" : (studioMode === "model" ? "Generate with model · 1 confirmed planning session" : "Generate local preview · deterministic");
      const providerOptions = providers.length
        ? providers.map((provider) => `<option value="${escapeHtml(provider.id)}" ${provider.id === studioProvider ? "selected" : ""} ${provider.ready ? "" : "disabled"}>${escapeHtml(`${provider.label} · ${provider.worker}${provider.model ? ` · ${provider.model}` : ""}${provider.ready ? "" : " (not ready)"}`)}</option>`).join("")
        : '<option value="">No providers configured yet</option>';
      const modelSuggestions = selected?.models || [];
      const thinkingLevels = selected?.thinking_levels?.length ? selected.thinking_levels : ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
      const modeBody = studioMode === "local"
        ? '<p class="sub" style="margin-top:12px">Deterministic structural draft from the local SDD/TDD planner — free, offline, and clearly labelled as <b>not model output</b>.</p>'
        : `<p class="sub" style="margin-top:12px">One schema-validated planning call through a configured provider. The call spends a single confirmed planning session; failures and malformed answers leave the current draft untouched.</p>`
          + `<div class="field" style="margin-top:10px"><label class="label" for="providerSelect">Provider</label><select id="providerSelect" class="input">${providerOptions}</select></div>`
          + (selected ? `<div class="grid two"><div class="field"><label class="label" for="providerModel">Model</label><input id="providerModel" class="input" list="providerModelOptions" value="${escapeHtml(studioModel || selected.model || modelSuggestions[0] || "")}" placeholder="exact model id"><datalist id="providerModelOptions">${modelSuggestions.map((model) => `<option value="${escapeHtml(model)}">`).join("")}</datalist><p class="muted tiny">Preset suggestions are optional; enter any model id your endpoint accepts.</p></div><div class="field"><label class="label" for="providerThinking">Thinking / effort</label><select id="providerThinking" class="input">${thinkingLevels.map((level) => `<option value="${escapeHtml(level === "default" ? "" : level)}" ${((studioThinking || selected.thinking_level || "") === (level === "default" ? "" : level)) ? "selected" : ""}>${escapeHtml(level === "default" ? "Provider default" : level)}</option>`).join("")}</select><p class="muted tiny">Applied when the selected adapter supports reasoning controls; default leaves it unchanged.</p></div></div>` : "")
          + (selected && !selected.ready ? `<div class="notice"><b class="amber">${escapeHtml(selected.id)} is not ready</b><p class="sub">${escapeHtml((selected.problems || []).join(" · "))} — manage providers in <button class="btn sm" data-action="go:settings">Settings</button>.</p></div>` : "")
          + (providers.length ? "" : (() => {
            const codexBuiltin = (builtinWorkers || []).find((worker) => worker.id === "codex") || null;
            const runHint = !codexBuiltin ? ""
              : !codexBuiltin.installed ? `Queue runs need the codex CLI installed: ${codexBuiltin.installHint}.`
              : codexBuiltin.signedIn && codexBuiltin.method !== "api-key" ? "Queue and task runs already work through the built-in codex CLI (ChatGPT subscription) — only model planning needs a key provider."
              : `Queue runs need the built-in codex CLI signed in: run ${codexBuiltin.loginCommand} and choose Sign in with ChatGPT.`;
            return `<div class="notice"><b class="amber">No key providers yet — model mode stays disabled</b><p class="sub">Open <button class="btn sm" data-action="go:settings">Settings → Providers</button> and add one (template zai, then paste your GLM key). ${escapeHtml(runHint)} Terminal equivalent: <b>atl provider add zai --template zai --model glm-4.6</b>.</p></div>`;
          })())
          + '<p class="sub" style="margin-top:8px">Planning budget: 1 session · 15 minute cap · refused while an overnight run holds the gate.</p>';
      const noticeLine = studioNotice ? `<p class="sub ${studioNotice.startsWith("Error") ? "red" : "green"}" style="margin-top:8px" data-studio-notice>${escapeHtml(studioNotice)}</p>${studioErrorLog && studioNotice.startsWith("Error") ? `<div class="bar" style="margin-top:6px" data-studio-log-row>${btn("Show raw response", "show-provider-log", "sm")}</div>` : ""}` : "";
      // The button stays clickable with an empty objective or an unready
      // provider: a dead disabled click teaches nothing, while the generate
      // guard turns the same click into an actionable notice.
      return head("WORKSPACE / PLANNING", "Plan Studio", "Local draft or one bounded model plan → edit task cards → approve a Plan Queue → confirm a run.", btn(generateLabel, "generate", `primary ${studioBusy ? "disabled" : ""}`))
        + '<div class="grid two"><section class="panel pad"><h2>01 / Your objective</h2><p class="sub" style="margin:9px 0 14px">Describe the outcome, constraints, and acceptance behavior. Generation never queues or executes work.</p><div class="field"><label class="label" for="goal">Goal and constraints</label><textarea id="goal" class="input" rows="10" placeholder="Describe the bounded change you want ATL to plan and verify.">' + escapeHtml(studioGoal) + '</textarea></div><div class="field"><label class="label" for="studioFiles">Reference files and images</label><input id="studioFiles" class="input" type="file" multiple accept="image/*,.txt,.md,.json,.yaml,.yml,.csv,.log,.pdf"><p class="muted tiny" style="margin-top:6px">Text files are included in the planning context. Images are previewed and recorded as references; current providers are text-only.</p><div class="bar attachment-list" style="margin-top:8px;align-items:stretch">' + attachmentMarkup() + '</div></div><div class="bar" style="margin-top:10px">' + btn("Clear form", "studio-clear", `sm ${studioBusy ? "disabled" : ""}`) + '<span class="muted tiny">resets the objective, attachments, generation mode, and plan preview. Queued or approved work stays.</span></div><div class="field" style="margin-top:13px"><label class="label">ATL skill route</label><div class="bar">' + ["atl-frame", "atl-specify", "atl-plan", "atl-implement", "atl-verify"].map((skill) => `<span class="pill violet">◇ ${skill}</span>`).join("") + '</div></div></section>'
        + card("02 / Generation mode", `<div class="pad"><div class="bar">${btn("Local preview", "mode:local", `sm ${studioMode === "local" ? "primary" : ""}`)}${btn("Generate with model", "mode:model", `sm ${studioMode === "model" ? "primary" : ""}`)}</div>${modeBody}${noticeLine}</div>`)
        + '</div><div class="space">' + card("03 / Full plan preview — editable task cards", `<div class="pad" id="planOutput" ${studioBusy ? 'aria-busy="true"' : ''}>${studioProgressPanel()}${rejectedPlanPreview(studioRejectedResponse)}${planPreview(currentDraft)}</div>`) + '</div>';
    },
    queues: () => {
      const { tasks, queues } = derived();
      const liveQueueIds = new Set([...(currentRun.queueIds || []), currentRun.queueId].filter(Boolean));
      // The implicit default is an internal fallback, not a useful workstream.
      // Keep it off the board until it contains work or participates in a run.
      const visibleQueues = queues.filter((queue) => queue.id !== "default" || (queue.items || []).length > 0 || liveQueueIds.has(queue.id));
      const activeQueue = visibleQueues.find((queue) => queue.id === snapshot.queues?.active_queue);
      const selectedLabel = selectedQueues.size ? `Review selected (${selectedQueues.size})` : "";
      const queueCards = visibleQueues.map((queue) => {
        const itemCount = (queue.items || []).length;
        const active = queue.id === snapshot.queues?.active_queue;
        const queueTaskIds = new Set((queue.items || []).map((item) => item.id || item.taskId));
        const queueTasks = tasks.filter((task) => queueTaskIds.has(task.id));
        const running = queueTasks.filter((task) => liveRunState(task) === "running").length;
        const progress = queueTasks.length ? Math.round(queueTasks.filter((task) => task.rawStatus === "done").length * 100 / queueTasks.length) : 0;
        const latestLog = queueTasks.flatMap((task) => task.logs.map((log) => ({ ...log, taskId: task.id }))).at(-1);
        const queueRunning = currentRun.status === "running" && liveQueueIds.has(queue.id);
        const queueAction = queueRunning ? btn("Stop", "run-stop", "sm danger") : queue.id === "default" ? btn("Clear", "queue-clear:default", "sm danger") : btn("Delete", `queue-delete:${queue.id}`, "sm danger");
        return `<section class="panel pad" data-queue="${escapeHtml(queue.id)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(queue.label)} queue" style="text-align:left;cursor:pointer"><div class="row between"><div class="bar"><input type="checkbox" data-qsel="${escapeHtml(queue.id)}" ${selectedQueues.has(queue.id) ? "checked" : ""} aria-label="Select ${escapeHtml(queue.label)} for a multi-queue run"><h2 style="font-size:16px">${escapeHtml(queue.label)}${queue.plan_draft_id ? ' <span class="pill violet">plan queue</span>' : ""}</h2></div><div class="bar">${badge(queueRunning ? "Running" : queue.status)}${active ? '<span class="pill green">ACTIVE QUEUE</span>' : ""}${queueAction}</div></div><p class="sub">${active ? "Current active queue · " : ""}${queue.plan_draft_id ? "Approved plan workstream · " : ""}${itemCount} task${itemCount === 1 ? "" : "s"} · ${progress}% complete${running ? ` · ${running} running` : ""}</p>${meter(progress)}<div class="row between muted tiny" style="margin-top:8px"><span>${latestLog ? `${escapeHtml(latestLog.taskId)} · ${escapeHtml(latestLog.detail || latestLog.note || latestLog.event || "latest activity")}` : "No task logs yet"}</span><span>${queueTasks.reduce((sum, task) => sum + task.logs.length, 0)} logs</span></div>${queueRunning ? `<div class="running-line"><span class="running-mark"></span>Confirmed run active · tasks below show their live run state</div>` : running ? `<div class="running-line"><span class="running-mark"></span>Live execution · open queue for task logs</div>` : ""}</section>`;
      }).join("") || '<div class="pad muted">No queues found.</div>';
      return head("OPERATIONS / DISPATCH", "Multi-queue manager", "Open a queue to review, manage, or preview it. Every run remains explicitly confirmed.", btn("+ New queue", "newqueue", "primary") + (selectedQueues.size ? btn(selectedLabel, "run-confirm-multi") : ""))
        + `<div class="grid three">${stat("Global concurrency", "1", "Conservative default")}${stat("Runnable", tasks.filter((task) => task.rawStatus === "triaged" || task.rawStatus === "assigned").length, "Pending dependency checks")}${stat("Paused / blocked", tasks.filter((task) => ["paused", "blocked"].includes(task.rawStatus)).length, "Require intervention")}</div><div class="notice space"><b>${activeQueue ? `Active queue: ${escapeHtml(activeQueue.label)}` : "No active queue selected"}</b><p class="sub">A confirmed run appears below. Tasks included in it show <b>In run</b> or <b>Stop</b> instead of another Run button.</p></div><p class="muted tiny space">Select queue checkboxes for one shared-budget run; open a queue card for its individual actions.</p><div class="grid two space">${queueCards}</div>${runPanel()}`;
    },
    team: () => { const { agents } = derived(); return head("OPERATIONS / TEAM", "Five-agent team", "Understand what each bot is doing, why it is blocked and what comes next.", btn("Agent events →", "go:activity")) + `<div class="grid three">${agents.map((agent) => `<section class="panel pad"><div class="row between"><span class="avatar">${escapeHtml(agent[0][0] || "A")}</span>${badge(agent[2])}</div><h2 style="font-size:16px;margin-top:12px">${escapeHtml(agent[0])}</h2><p class="sub">${escapeHtml(agent[1])}</p><div class="lined muted tiny">CURRENT WORK</div><p style="min-height:42px">${escapeHtml(agent[3])}</p><div class="row between tiny"><span class="muted">Acceptance progress</span><b>${agent[4] === null ? "—" : `${agent[4]}%`}</b></div><div style="margin:9px 0 13px">${meter(agent[4], agent[2] === "Blocked" ? "var(--amber)" : "var(--accent)")}</div>${btn("Read agent brief", `agent:${escapeHtml(agent[0])}`, "sm")}</section>`).join("") || '<div class="pad muted">No team state recorded yet.</div>'}</div>`; },
    projects: () => { const projects = snapshot.supervisor?.projects || []; return head("WORKSPACE / PROJECTS", "Project rooms", "Repositories remain authoritative in their own local ATL state directories.", btn("Register repository", "project-register", "primary") + btn("Delete selected", "projects-delete-selected", "danger") + btn("Refresh", "refresh")) + `<div class="grid three">${stat("Registered", projects.length, "Local repositories")}${stat("Shared cap", snapshot.supervisor?.defaults?.maxConcurrent || 2, "Active provider sessions")}${stat("Hard cap", snapshot.supervisor?.defaults?.maxConcurrentCap || 5, "Maximum supported")}</div><div class="panel pad space">${projects.map((project) => `<div class="event between"><div class="row"><input type="checkbox" data-project-select="${escapeHtml(project.id)}"><span><b>${escapeHtml(project.name)}</b><div class="muted tiny">${escapeHtml(project.id)} · ${escapeHtml(project.root)}</div></span></div><span>${badge(`cap ${project.maxConcurrent}`)} ${btn("Delete", `project-delete:${escapeHtml(project.id)}`, "sm danger")}</span></div>`).join("") || '<span class="muted">No repositories registered yet.</span>'}</div>`; },
    approvals: approvalCenter,
    operations: () => { const leases = snapshot.leases?.sessions || []; const backups = snapshot.backups || []; const runs = snapshot.routine_runs || []; const scheduler = snapshot.scheduler || {}; return head("OPERATIONS / RECOVERY", "Runtime operations", "Inspect active sessions, durable leases, routine history, and recoverable backups.", btn("Refresh", "refresh")) + `<div class="grid three">${stat("Active leases", leases.filter((lease) => lease.status === "active").length, "Fenced task sessions")}${stat("Backups", backups.length, "Project snapshots")}${stat("Routine runs", runs.length, `Scheduler ${scheduler.status || "stopped"}`)}</div>${card("Leases / sessions", `<div class="pad">${leases.map((lease) => `<div class="event between"><span><b>${escapeHtml(lease.task)}</b><span class="muted tiny"> · ${escapeHtml(lease.role)} · generation ${lease.generation}</span></span>${badge(lease.status)}</div>`).join("") || '<span class="muted">No session leases recorded.</span>'}</div>`)}${card("Routine history", `<div class="pad">${runs.slice().reverse().map((run) => `<div class="event between"><span><b>${escapeHtml(run.routine_id)}</b><span class="muted tiny"> · ${escapeHtml(run.trigger_reason || "manual")} · ${escapeHtml(run.created_at || "")}</span></span>${badge(run.status)}</div>`).join("") || '<span class="muted">No routine runs recorded.</span>'}</div>`, "", "space")}${card("Backups", `<div class="pad">${backups.slice().reverse().map((backup) => `<div class="event between"><span><b>${escapeHtml(backup.label)}</b><span class="muted tiny"> · ${escapeHtml(backup.id)}</span></span>${btn("Restore", `backup-restore:${escapeHtml(backup.id)}`, "sm ghost")}</div>`).join("") || '<span class="muted">No backups recorded.</span>'}<div class="bar" style="margin-top:12px">${btn("Create backup", "backup-create", "sm primary")}</div></div>`, "", "space")}`; },
    activity: () => { const { events } = derived(); const filtered = events.filter((event) => !activityFilter || event.join(" ").toLowerCase().includes(activityFilter.toLowerCase())); return head("OPERATIONS / EVIDENCE", "Activity & Logs", "Searchable decisions, feedback, blockers, verification and overnight handoffs.", btn("Refresh", "refresh") + btn("Export", "export")) + `<div class="grid three">${stat("Events", filtered.length, activityFilter ? "Filtered events" : "Authoritative state log")}${stat("Blockers", derived().tasks.filter((task) => task.rawStatus === "blocked").length, "Actions awaiting owner")}${stat("Connection", connected ? "Live" : "Stale", "Runtime-backed feed")}</div><div class="panel pad"><label class="label" for="activitySearch">Filter audit events</label><input id="activitySearch" class="input" value="${escapeHtml(activityFilter)}" placeholder="actor, task, event, or text"></div><div class="grid twocol space">${card("Timeline", `<div class="pad">${filtered.map(eventRow).join("") || '<span class="muted">No matching events.</span>'}</div>`)}${card("Runtime handoff", `<div class="pad"><div class="row between"><strong>ATL state</strong>${badge(connected ? "Live" : "Unknown")}</div><p class="sub">The browser reads authoritative state through the local bridge and marks it stale when refreshes fail.</p><div class="lined row between"><span>Captured</span><b>${escapeHtml(snapshot.captured_at ? new Date(snapshot.captured_at).toLocaleTimeString() : "unknown")}</b></div></div>`)}</div>`; },
    usage: () => { const provider = snapshot.usage?.default_provider || "codex"; const rows = (snapshot.usage?.snapshots || []).filter((item) => item.provider === provider); const latest = rows.at(-1); const remote = rows.filter((item) => item.source === "provider-adapter").at(-1); const localSessions = rows.filter((item) => item.source === "atl-session").reduce((total, item) => total + Number(item.used?.sessions || 0), 0); const captured = latest?.captured_at ? new Date(latest.captured_at).toLocaleString() : "Never"; const probeState = remote?.confidence === "verified" ? "Provider telemetry verified" : "Provider telemetry unavailable"; const noticeTone = remote?.confidence === "verified" ? "green" : "amber"; const reset = remote?.reset_at ? new Date(remote.reset_at).toLocaleString() : "Not reported"; return head("OPERATIONS / RESOURCE MONITOR", "Usage & Limits", "Provider evidence, local run observations, and dispatch safeguards.", btn("Refresh providers", "usage-refresh", "primary") + btn("Refresh snapshot", "refresh")) + `<div class="notice"><b class="${noticeTone}">◈ ${escapeHtml(probeState)}</b><p class="sub">${escapeHtml(remote?.detail || `No verified quota data for ${provider}. Local session observations are shown separately.`)}</p></div><div class="grid three space">${stat("Default provider", provider, latest?.model || "No usage sample for this provider")}${stat("Quota remaining", remote?.remaining == null ? "Unknown" : String(remote.remaining), remote?.reset_at ? `Resets · ${reset}` : remote?.detail || "No verified provider quota")}${stat("Local sessions", localSessions, `${rows.length} recorded observations · latest ${captured}`)}</div><div class="grid two space">${card("Telemetry evidence", `<div class="pad"><div class="event between" style="justify-content:space-between"><span>Provider probe</span>${badge(remote?.confidence === "verified" ? "Observed" : "Unknown")}</div><div class="event between" style="justify-content:space-between"><span>Source</span><b class="muted">${escapeHtml(remote?.source || "No provider sample")}</b></div><div class="event between" style="justify-content:space-between"><span>Last capture</span><b class="muted">${escapeHtml(remote?.captured_at ? new Date(remote.captured_at).toLocaleString() : "Never")}</b></div><div class="event between" style="justify-content:space-between"><span>Recorded local runs</span><b>${localSessions}</b></div><p class="muted tiny" style="margin:13px 0 0">Provider quota is displayed only after a provider-specific authenticated response. Local sessions are separate evidence, not a quota estimate.</p></div>`)}${card("Preflight safeguards", '<div class="pad"><div class="row between"><span>Provider limit</span>' + badge(remote?.remaining == null ? "Unknown" : "Observed") + '</div><div class="lined row between"><span>Dispatch policy</span><span class="amber">Confirm risks</span></div><div class="lined row between"><span>Stop on rate-limit</span><span class="green">Required</span></div><div class="lined row between"><span>Quota provenance</span><span class="muted">Provider adapter only</span></div></div>')}</div>`; },
    settings: () => {
      const providers = studioProviders || [];
      const readyCount = providers.filter((provider) => provider.ready).length;
      const summary = providers.length
        ? `<div class="bar" style="flex-wrap:wrap">${providers.map((provider) => `<span class="pill ${provider.ready ? "green" : "amber"}" title="${escapeHtml((provider.problems || []).join(" · "))}">${escapeHtml(provider.id)}${provider.ready ? "" : " · not ready"}</span>`).join("")}<span class="muted tiny">${readyCount}/${providers.length} ready · default: ${escapeHtml(defaultProvider || "none")}</span></div>`
        : '<p class="sub">No key providers configured yet. Model planning in Plan Studio stays disabled until one is ready.</p>';
      const builtinLine = (builtinWorkers || []).length
        ? `<div class="bar" style="flex-wrap:wrap;margin-top:9px">${(builtinWorkers || []).map((worker) => { const state = builtinState(worker); return `<span class="pill ${state.tone}" title="${escapeHtml(worker.detail || "")}">${escapeHtml(worker.id)} · ${escapeHtml(state.label)}</span>`; }).join("")}<span class="muted tiny">built-in · subscription auth · queue runs</span></div>`
        : "";
      return head("WORKSPACE / SETTINGS", "Settings", "Safety defaults, providers, behavior and accessible keyboard shortcuts.")
        + '<div class="grid two">'
        + card("Providers", `<div class="pad">${summary}${builtinLine}<div class="bar" style="margin-top:12px">${btn("Manage providers", "provider-manager", "sm")}</div><p class="muted tiny" style="margin-top:10px">Built-in workers (codex, claude) connect with one CLI login — no key stored. Key providers live in ~/.atl/providers.json on this machine — never in a repo, always masked. The model planner spends one confirmed session per generate or regenerate call.</p></div>`)
        + card("Execution defaults", '<div class="pad">' + [["Global concurrency", "1"], ["Planning provider calls", "Owner confirms"], ["Delete behavior", "Archive before hard delete"], ["Minimum supported width", "Browser responsive"], ["Unreported quota", "Unknown"]].map((row) => `<div class="event between" style="justify-content:space-between"><span class="muted">${row[0]}</span><b>${row[1]}</b></div>`).join("") + '</div>')
        + card("Codebase navigation", (() => { const nav = navigationSettings || { mode: "off", max_tokens: 800, build_on_launch: true }; const state = nav.mode === "on" ? '<span class="pill green">enabled</span>' : '<span class="pill amber">off</span>'; const note = navigationNotice ? `<p class="sub ${navigationNotice.startsWith("Error") ? "red" : "green"}" style="margin-top:10px" role="status">${escapeHtml(navigationNotice)}</p>` : ""; return `<div class="pad"><div class="row between"><div><b>Token-efficient code map</b><p class="sub" style="margin:5px 0 0">Local navigation hints reduce repeated repository orientation. Source reads and verification still apply.</p></div>${state}</div><div class="grid two" style="margin-top:14px"><div class="field"><label class="label" for="navigationMode">Navigation mode</label><select id="navigationMode" class="input"><option value="off" ${nav.mode === "off" ? "selected" : ""}>Off - existing prompts</option><option value="on" ${nav.mode === "on" ? "selected" : ""}>On - bounded map hints</option></select></div><div class="field"><label class="label" for="navigationTokens">Prompt budget (tokens)</label><input id="navigationTokens" class="input" type="number" min="100" max="4000" step="50" value="${escapeHtml(nav.max_tokens)}"></div></div><label class="row muted" style="gap:8px;margin-top:4px"><input id="navigationBuild" type="checkbox" ${nav.build_on_launch ? "checked" : ""}> Refresh map before each enabled worker launch</label><div class="bar" style="margin-top:14px">${btn("Save navigation settings", "navigation-save", "primary")}</div><p class="muted tiny" style="margin-top:10px">Project-local only; no provider request or spend. Dynamic and unsupported code stays visibly partial.</p>${note}</div>`; })())
        + '</div>'
        + card("Keyboard reference", '<div class="pad">' + [["Ctrl / Cmd K", "Command palette"], ["N", "New task"], ["1–8", "Navigate pages"], ["Enter", "Run ATL command"], ["Esc", "Dismiss dialog"]].map((row) => `<div class="event between" style="justify-content:space-between"><span class="key">${row[0]}</span><span class="muted">${row[1]}</span></div>`).join("") + '</div>', "", "space");
    },
  };

  panels.brain = () => {
    const brain = snapshot.brain || fallback.brain;
    const claims = brain.claims || [], stale = brain.stale || [], skills = brain.skills || [], routines = brain.routines || [];
    const claimRows = claims.map((claim) => `<div class="event between" style="justify-content:space-between;gap:12px"><div>${badge(claim.status)} <b>${escapeHtml(claim.text)}</b><div class="muted tiny">${escapeHtml(claim.claim_id)} · source ${escapeHtml(claim.source_id)} · checked ${escapeHtml(claim.checked_at ? new Date(claim.checked_at).toLocaleString() : "never")}</div></div>${["UNKNOWN", "PARTIAL"].includes(claim.status) ? btn("Approve", `brain-approve:${claim.claim_id}`, "sm primary") : ""}</div>`).join("") || '<span class="muted">No claims recorded yet.</span>';
    const skillRows = skills.map((skill) => `<div class="event between"><span><b>${escapeHtml(skill.id)}</b> <span class="muted">v${escapeHtml(skill.version)}</span></span>${badge("Gold")}</div>`).join("") || '<span class="muted">No promoted skills.</span>';
    const routineRows = routines.map((routine) => `<div class="event between"><span><b>${escapeHtml(routine.id)}</b><span class="muted tiny"> · ${escapeHtml(routine.skill_id)} · ${escapeHtml(routine.schedule)}</span></span>${badge(routine.enabled ? "Enabled" : "Approval gated")}</div>`).join("") || '<span class="muted">No routines registered.</span>';
    return head("WORKSPACE / KNOWLEDGE", "Evidence & Automation", "Review source-linked claims, approve knowledge, validate skills, and register approval-gated routines.", btn("Refresh", "refresh")) + `<div class="grid four">${stat("Sources", brain.sources?.total || 0, "Content-addressed records")}${stat("Claims", claims.length, "Source-linked assertions")}${stat("Stale", stale.length, "30-day default")}${stat("Routines", routines.length, "Disabled until approved")}</div><div class="grid twocol space">${card("Claims & freshness", `<div class="pad">${claimRows}</div>`)}${card("Gold skills", `<div class="pad">${skillRows}<div class="bar" style="margin-top:12px">${btn("Validate / promote skill", "brain-skill-form", "sm primary")}</div></div>`)}</div><div class="grid twocol space">${card("Approval-gated routines", `<div class="pad">${routineRows}<div class="bar" style="margin-top:12px">${btn("Register routine", "brain-routine-form", "sm primary")}</div></div>`)}${card("Safety boundary", '<div class="pad"><div class="event between"><span>Approval owner</span><b>Manager</b></div><div class="event between"><span>Skill scheduling</span><b>Gold only</b></div><div class="event between"><span>Routine default</span><b>Disabled</b></div><p class="muted tiny">Knowledge remains advisory. Task evidence and explicit run confirmation stay authoritative.</p></div>')}</div>`;
  };

  function nav() {
    const rows = routes.map((route) => `<button class="nav ${page === route[0] ? "on" : ""}" data-page="${route[0]}"><span class="ico">${route[1]}</span>${route[2]}</button>`);
    $("#navA").innerHTML = rows.slice(0, 4).join("");
    $("#navB").innerHTML = rows.slice(4).join("");
    $("#mobile").innerHTML = routes.map((route) => `<button class="btn sm ${page === route[0] ? "primary" : ""}" data-page="${route[0]}">${route[2]}</button>`).join("");
    $("#crumb").textContent = routes.find((route) => route[0] === page)?.[2] || "Overview";
  }
  // One honest state per built-in subscription worker, shared by the top
  // chip, Settings, and the provider manager. API-key sign-in counts as NOT
  // connected: it spends platform credits instead of the user's plan.
  function builtinState(worker) {
    if (!worker?.installed) return { label: "not installed", tone: "red", connected: false };
    if (worker.signedIn && worker.method === "api-key") return { label: "API-key sign-in", tone: "amber", connected: false };
    if (worker.signedIn) return { label: worker.method === "chatgpt" ? "signed in · ChatGPT" : "signed in", tone: "green", connected: true };
    return { label: "not signed in", tone: "amber", connected: false };
  }
  function renderProviderStatus() {
    const mount = $("#provider-status");
    if (!mount) return;
    const providers = studioProviders || [];
    const configured = providers.find((provider) => provider.id === defaultProvider) || providers.find((provider) => provider.ready) || providers[0] || null;
    const builtinCodex = (builtinWorkers || []).find((worker) => worker.id === "codex") || (builtinWorkers || [])[0] || null;
    const builtin = builtinCodex ? builtinState(builtinCodex) : null;
    const usage = snapshot.usage?.latest;
    const quotaObserved = usage?.remaining != null;
    const status = !connected ? { label: "Offline", tone: "red" }
      : quotaObserved ? { label: "Observed", tone: "green" }
      : configured?.ready ? { label: "Ready", tone: "green" }
      : configured ? { label: "Setup needed", tone: "amber" }
      : builtin?.connected ? { label: "Ready · runs", tone: "green" }
      : builtin && !builtinCodex.installed ? { label: "Install CLI", tone: "amber" }
      : builtin ? { label: "Connect CLI", tone: "amber" }
      : { label: "Unlinked", tone: "amber" };
    const name = configured?.label || configured?.id
      || (builtinCodex ? `${builtinCodex.label} · built-in` : usage?.provider || "No provider configured");
    const detail = quotaObserved
      ? `Quota remaining · ${usage.remaining}${usage.model ? ` · ${usage.model}` : ""}`
      : configured?.ready
        ? `${configured.model || "Ready for planning"} · quota not reported`
        : configured
          ? (configured.problems || ["Finish provider setup to enable planning."]).join(" · ")
          : builtin?.connected
            ? `${builtinCodex.detail || "subscription sign-in"} · queue runs ready; model planning needs a key provider`
            : builtin
              ? (builtinCodex.installed ? `run ${builtinCodex.loginCommand} and sign in with ChatGPT to connect` : `install first: ${builtinCodex.installHint}`)
              : "Add a provider to enable model planning.";
    mount.innerHTML = `<button class="provider-summary" type="button" data-action="provider-manager" aria-label="Manage providers"><span class="row between tiny"><span class="muted">PROVIDER STATUS</span><span class="pill ${status.tone}">${escapeHtml(status.label)}</span></span><strong>${escapeHtml(name)}</strong><span class="muted tiny status-detail">${escapeHtml(detail)}</span></button><button class="provider-manager lined row" type="button" data-page="settings"><span class="avatar">M</span><span><b>Workspace Manager</b><span class="tiny muted" style="display:block">Owner / approvals · Settings</span></span></button>`;
  }
  function applyLocale() {
    const fa = locale === "fa-IR";
    document.documentElement.lang = fa ? "fa-IR" : "en-US";
    document.documentElement.dir = fa ? "rtl" : "ltr";
    document.body.classList.toggle("atl-rtl", fa);
    const control = document.querySelector("#localeBtn");
    if (control) { control.textContent = fa ? "English" : "فارسی"; control.setAttribute("aria-label", fa ? "Switch to English" : "تغییر به فارسی"); }
    if (!fa) return;
    const translator = window.ATL_I18N?.translateText || ((value) => value);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) node.nodeValue = translator(node.nodeValue, "fa-IR");
    for (const element of document.querySelectorAll("[placeholder]")) element.placeholder = translator(element.placeholder, "fa-IR");
    for (const element of document.querySelectorAll("[aria-label]")) element.setAttribute("aria-label", translator(element.getAttribute("aria-label"), "fa-IR"));
    for (const element of document.querySelectorAll(".task-main-copy b,.task-row .muted,.event .muted,.terminal,code,[data-bidi]")) {
      element.setAttribute("dir", "auto");
      element.classList.add("bidi-isolate");
    }
  }
  function ensureLocaleControl() {
    const topbar = document.querySelector(".topbar .row:last-child");
    if (!topbar || document.querySelector("#localeBtn")) return;
    const button = document.createElement("button");
    button.id = "localeBtn"; button.className = "btn ghost"; button.dataset.action = "toggle-locale";
    topbar.insertBefore(button, topbar.firstChild);
  }
  function syncRunSnapshot() {
    // Also consume the durable snapshot for existing servers that predate
    // live /api/run polling. A newer launch response must win until its
    // first snapshot arrives.
    const durable = snapshot.overnight;
    if (!durable || (currentRun.startedAt && new Date(durable.startedAt).getTime() < new Date(currentRun.startedAt).getTime())) return;
    Object.assign(currentRun, {
      status: durable.status === "finished" ? (durable.resumableTaskIds?.length ? "stopped" : "complete") : durable.status,
      queueId: durable.queueId || null, queueIds: durable.queueIds || [], taskIds: durable.taskOrder || [],
      currentTaskId: durable.currentTaskId || null, startedAt: durable.startedAt,
      results: durable.results || [], reason: durable.reason || durable.recovery || null,
    });
  }
  function render() { try { sessionStorage.setItem("atl-cp-page", page); } catch { /* storage may be unavailable */ } syncRunSnapshot(); nav(); renderProviderStatus(); $("#content").innerHTML = panels[page]?.() || panels.overview(); ensureLocaleControl(); applyLocale(); }
  function close() { detailExecution = null; dialogOpen = false; $("#modal").innerHTML = ""; }
  function popup(title, body, actions = "") { detailExecution = null; dialogOpen = true; $("#modal").innerHTML = `<div class="overlay" id="overlay"><section class="dialog" role="dialog" aria-modal="true"><div class="dialoghead"><h2 style="font-size:16px">${title}</h2>${btn("✕", "close", "ghost")}</div><div class="dialogbody">${body}</div>${actions ? `<div class="dialogfoot">${actions}</div>` : ""}</section></div>`; }
  function popupWide(title, body, actions = "") { dialogOpen = true; $("#modal").innerHTML = `<div class="overlay" id="overlay"><section class="dialog" style="width:min(820px,100%)" role="dialog" aria-modal="true"><div class="dialoghead"><h2 style="font-size:16px">${title}</h2>${btn("✕", "close", "ghost")}</div><div class="dialogbody" style="max-height:74vh">${body}</div>${actions ? `<div class="dialogfoot">${actions}</div>` : ""}</section></div>`; }
  function enhanceCurrentProviderModal() {
    // Save connection is intentionally disabled until an existing field changes.
    const current = document.querySelector(".provider-current");
    const modelInput = current?.querySelector("[data-pm-current-model]");
    const id = modelInput?.dataset.pmCurrentModel;
    const active = id && studioProviders?.find((provider) => provider.id === id);
    if (!current || !active || current.querySelector("[data-pm-current-label]")) return;
    const levels = active.thinking_levels?.length ? active.thinking_levels : ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
    const savedThinking = active.thinking_level === "default" ? "" : (active.thinking_level || "");
    const levelOptions = levels.map((level) => `<option value="${level === "default" ? "" : escapeHtml(level)}" ${savedThinking === (level === "default" ? "" : level) ? "selected" : ""}>${level === "default" ? "Provider default" : escapeHtml(level)}</option>`).join("");
    const button = [...current.querySelectorAll("button[data-action]")].find((item) => item.dataset.action === `pm-model:${id}`);
    if (button) {
      button.dataset.action = `pm-current-save:${id}`;
      button.dataset.pmModelSave = id;
      button.textContent = "Saved";
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
      button.classList.remove("primary");
      button.classList.add("ghost", "disabled");
    }
    current.insertAdjacentHTML("beforeend", `<div class="grid two" style="margin-top:12px"><div class="field"><label class="label" for="pmCurrentLabel">Display name</label><input class="input" id="pmCurrentLabel" data-pm-current-label data-saved-value="${escapeHtml(active.label || "")}" value="${escapeHtml(active.label || "")}" placeholder="Friendly provider name"></div><div class="field"><label class="label" for="pmCurrentThinking">Thinking / effort</label><select class="input" id="pmCurrentThinking" data-pm-current-thinking data-saved-value="${escapeHtml(savedThinking)}">${levelOptions}</select></div><div class="field"><label class="label" for="pmCurrentUrl">Base URL</label><input class="input" id="pmCurrentUrl" data-pm-current-url data-saved-value="${escapeHtml(active.base_url || "")}" value="${escapeHtml(active.base_url || "")}" placeholder="https://…"></div><div class="field"><label class="label" for="pmCurrentKey">API key</label><input type="password" class="input" id="pmCurrentKey" data-pm-current-key autocomplete="new-password" placeholder="Leave blank to keep the stored key"></div></div><p class="muted tiny" style="margin:8px 0 0">Provider id <code>${escapeHtml(active.id)}</code> · the key stays masked and blank means keep the current secret.</p>`);
  }

  function renderProviderCard(provider, activeId, projectDefault, editingId, removeConfirm, templates) {
    const id = String(provider.id || "");
    const isActive = id === activeId;
    const isDefault = id === projectDefault;
    const editing = id === editingId;
    const levels = provider.thinking_levels?.length ? provider.thinking_levels : ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
    const levelOptions = levels.map((level) => `<option value="${level === "default" ? "" : escapeHtml(level)}" ${provider.thinking_level === (level === "default" ? "" : level) ? "selected" : ""}>${level === "default" ? "Provider default" : escapeHtml(level)}</option>`).join("");
    const modelOptions = [...new Set([provider.model, ...(provider.models || [])].filter(Boolean))].map((model) => `<option value="${escapeHtml(model)}" ${model === provider.model ? "selected" : ""}>${escapeHtml(model)}</option>`).join("");
    const actions = `${!isDefault ? btn("Set as default", `pm-use:${escapeHtml(id)}`, "sm") : ""}${!editing ? btn("Edit", `pm-edit:${escapeHtml(id)}`, "sm") : btn("Cancel", "pm-cancel", "sm")}${btn(removeConfirm === id ? "Confirm remove?" : "Remove", `pm-remove:${escapeHtml(id)}`, `sm ${removeConfirm === id ? "danger" : "ghost"}`)}`;
    if (!editing) {
      return `<div class="provider-current" style="border:1px solid var(--line);border-radius:9px;padding:13px 15px;margin-bottom:10px;background:rgba(8,15,25,.35)"><div class="row between" style="gap:10px;flex-wrap:wrap"><div><b>${escapeHtml(provider.label || id)}</b><div class="muted tiny">${escapeHtml(id)} · ${escapeHtml(provider.worker || "provider")} · ${escapeHtml(provider.model || "no model")}</div></div><div class="bar">${isActive ? '<span class="pill violet">CURRENTLY CONNECTED</span>' : ""}${isDefault ? '<span class="pill green">project default</span>' : ""}<span class="pill ${provider.ready ? "green" : "amber"}">${provider.ready ? "ready" : "not ready"}</span></div></div>${provider.problems?.length ? `<p class="muted tiny" style="margin:7px 0 0">${escapeHtml(provider.problems.join(" · "))}</p>` : ""}<div class="bar" style="margin-top:9px;flex-wrap:wrap">${actions}</div></div>`;
    }
    return `<div class="provider-current" style="border:1px solid var(--accent);border-radius:9px;padding:13px 15px;margin-bottom:10px"><div class="eyebrow">${isActive ? "CURRENTLY CONNECTED" : "EDIT PROVIDER"}</div><div class="grid two" style="margin-top:10px"><div class="field"><label class="label">Display name</label><input class="input" data-pm-label="${escapeHtml(id)}" value="${escapeHtml(provider.label || "")}"></div><div class="field"><label class="label">Model</label><select class="input" data-pm-model="${escapeHtml(id)}" data-pm-current-model="${escapeHtml(id)}">${modelOptions}</select></div><div class="field"><label class="label">Thinking / effort</label><select class="input" data-pm-thinking-level="${escapeHtml(id)}" data-pm-current-thinking="${escapeHtml(id)}">${levelOptions}</select></div><div class="field"><label class="label">Base URL</label><input class="input" data-pm-url="${escapeHtml(id)}" data-pm-current-url="${escapeHtml(id)}" value="${escapeHtml(provider.base_url || "")}"></div></div><div class="field"><label class="label">API key</label><input type="password" class="input" data-pm-key="${escapeHtml(id)}" data-pm-current-key="${escapeHtml(id)}" autocomplete="new-password" placeholder="Leave blank to keep the stored key"></div><div class="bar">${btn("Save connection", `pm-save:${escapeHtml(id)}`, "primary")}${btn("Cancel", "pm-cancel", "sm")}</div><p class="muted tiny" style="margin-top:8px">Provider id <code>${escapeHtml(id)}</code> · keys remain masked and are never rendered back.</p></div>`;
  }
  // Provider manager: add / key / use / remove against ~/.atl/providers.json
  // through /api/providers. Key material never renders back — the password
  // field travels once to the server and only the masked ready state returns.
  function providerManagerModal(status) {
    const providers = studioProviders || [];
    const activeId = defaultProvider || studioProvider || providers.find((provider) => provider.ready)?.id || providers[0]?.id || null;
    const active = providers.find((provider) => provider.id === activeId) || null;
    const connectedSection = active
      ? renderProviderCard(active, activeId, defaultProvider, pmEditingId, pmRemoveConfirm, pmTemplates)
      : `<div class="notice" style="margin:14px 0 16px"><b class="amber">No connected model yet</b><p class="sub">Choose a provider below to make it the project default, or add a new provider.</p></div>`;
    const rows = providers.filter((provider) => provider.id !== activeId).map((provider) => {
      return renderProviderCard(provider, activeId, defaultProvider, pmEditingId, pmRemoveConfirm, pmTemplates);
    }).join("") || (active ? '<p class="muted tiny">No other providers configured. Add another below to switch between providers.</p>' : '<p class="muted">No providers configured yet — add the first one below.</p>');
    const templates = pmTemplates || [];
    const initialTemplateId = templates.find((template) => template.id === "zai")?.id || templates[0]?.id;
    const templateOptions = templates.map((template) => `<option value="${escapeHtml(template.id)}" ${template.id === initialTemplateId ? "selected" : ""}>${escapeHtml(`${template.label}${template.models?.length ? ` · ${template.models[0]}` : ""}`)}</option>`).join("");
    const firstTemplate = templates.find((template) => template.id === initialTemplateId) || templates[0];
    const workers = ["codex", "claude"].map((worker) => `<option value="${worker}" ${worker === firstTemplate?.worker ? "selected" : ""}>${worker === "codex" ? "Codex · OpenAI-compatible" : "Claude Code · Anthropic-compatible"}</option>`).join("");
    const protocols = ["openai", "anthropic", "custom"].map((protocol) => `<option value="${protocol}" ${protocol === (firstTemplate?.protocol || "custom") ? "selected" : ""}>${protocol === "openai" ? "OpenAI-compatible" : protocol === "anthropic" ? "Anthropic-compatible" : "Custom / gateway"}</option>`).join("");
    const levels = (firstTemplate?.thinkingLevels?.length ? firstTemplate.thinkingLevels : ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"]).map((level) => `<option value="${level === "default" ? "" : escapeHtml(level)}">${level === "default" ? "Provider default" : escapeHtml(level)}</option>`).join("");
    const addForm = templates.length
      ? `<div class="lined" style="margin:16px 0 0;padding-top:16px"><div class="eyebrow" style="margin-bottom:6px">ADD A PROVIDER</div><p class="sub">Presets are shortcuts. Endpoint, model, adapter, and thought level stay editable.</p><div class="grid two" style="margin-top:12px"><div class="field"><label class="label" for="pmTemplate">Preset</label><select class="input" id="pmTemplate" data-pm-template>${templateOptions}</select></div><div class="field"><label class="label" for="pmId">Provider id</label><input class="input" id="pmId" data-pm-id placeholder="e.g. zai-main"></div><div class="field"><label class="label" for="pmLabel">Display name</label><input class="input" id="pmLabel" data-pm-label placeholder="My Z.ai GLM"></div><div class="field"><label class="label" for="pmModel">Model</label><input class="input" id="pmModel" data-pm-model list="pmModelOptions" placeholder="e.g. glm-5.3"><datalist id="pmModelOptions">${(firstTemplate?.models || []).map((model) => `<option value="${escapeHtml(model)}">`).join("")}</datalist></div><div class="field"><label class="label" for="pmWorker">Adapter</label><select class="input" id="pmWorker" data-pm-worker>${workers}</select></div><div class="field"><label class="label" for="pmProtocol">Wire protocol</label><select class="input" id="pmProtocol" data-pm-protocol>${protocols}</select></div><div class="field"><label class="label" for="pmThinking">Thinking / effort</label><select class="input" id="pmThinking" data-pm-thinking>${levels}</select></div><div class="field"><label class="label" for="pmUrl">Base URL</label><input class="input" id="pmUrl" data-pm-url value="${escapeHtml(firstTemplate?.baseUrl?.[firstTemplate?.worker] || "")}" placeholder="https://…"></div></div><div class="field"><label class="label" for="pmKey">API key</label><input type="password" class="input" id="pmKey" data-pm-key-new autocomplete="new-password" placeholder="Stored outside the repository; never shown again"></div>${btn("Add provider", "pm-add", "primary")}</div>`
      : "";
    const statusLine = status ? `<p class="sub ${status.ok ? "green" : "red"}" style="margin-top:10px" role="status">${escapeHtml(status.text)}</p>` : "";
    // Built-in subscription workers first: one CLI login, no key, no registry
    // entry. This is the zero-config connection path; the registry form below
    // is only for external API-key endpoints.
    const builtinRows = (builtinWorkers || []).map((worker) => {
      const state = builtinState(worker);
      const meta = [`${escapeHtml(String(worker.auth || "subscription"))} auth`, worker.defaultModel ? `default model ${escapeHtml(worker.defaultModel)}` : "model: CLI default"].join(" · ");
      let connect;
      if (!worker.installed) {
        connect = `<div class="notice" style="margin-top:9px;padding:9px"><b class="amber">Install ${escapeHtml(worker.label)}</b><p class="sub" style="margin:4px 0 0">Run <code>${escapeHtml(worker.installHint || `install ${worker.id}`)}</code>, then <code>${escapeHtml(worker.loginCommand)}</code> to connect.</p></div>`;
      } else if (state.connected) {
        connect = `<p class="sub" style="margin-top:8px">${escapeHtml(worker.detail || "Connected via your subscription.")} Queue and task runs can use this CLI.</p>`;
      } else {
        connect = `<div class="notice" style="margin-top:9px;padding:9px"><b class="amber">${worker.method === "api-key" ? "Signed in with an API key — switch to your plan" : `Connect ${escapeHtml(worker.label)}`}</b><ol class="sub" style="margin:6px 0 0;padding-left:20px;line-height:1.9"><li>Run <code>${escapeHtml(worker.loginCommand)}</code> ${btn("Copy", `copy:${escapeHtml(worker.loginCommand)}`, "sm ghost")}</li><li>${escapeHtml(worker.loginNote)}</li><li>Press <b>Recheck</b>, then <code>${escapeHtml(worker.verifyCommand || "atl launch --dry-run")}</code> should list <b>${escapeHtml(worker.id)}</b> · subscription.</li></ol></div>`;
      }
      return `<div style="border:1px solid var(--line);border-radius:9px;padding:13px 15px;margin-bottom:10px;background:rgba(8,15,25,.35)"><div class="row between" style="gap:12px;flex-wrap:wrap"><div class="bar" style="gap:7px;min-width:0"><b>${escapeHtml(worker.label)}</b><span class="pill violet">${worker.id === "gapgpt" ? "project worker" : "built-in"}</span><span class="pill ${state.tone}">${escapeHtml(state.label)}</span>${worker.isDefault ? '<span class="pill green">project default</span>' : ""}</div><span class="muted tiny">${meta}</span></div>${connect}</div>`;
    }).join("");
    const builtinSection = (builtinWorkers || []).length
      ? `<div style="margin-bottom:6px"><div class="row between" style="margin-bottom:8px"><div class="eyebrow">BUILT-IN WORKERS · SUBSCRIPTION AUTH</div>${btn("Recheck", "provider-recheck", "sm")}</div><p class="sub" style="margin:0 0 10px">One CLI login connects these — no key is stored and nothing is added to the registry. <code>atl provider add</code> is only for external API providers (Z.ai, OpenRouter, Anthropic, custom) below.</p>${builtinRows}</div>`
      : "";
    popupWide("Providers", `<p class="sub" style="margin-bottom:14px">Built-in workers connect with a single CLI login. Below them: your connected key providers for model planning and alternative endpoints.</p>${builtinSection}${connectedSection}${rows ? `<div class="eyebrow" style="margin:16px 0 8px">OTHER CONNECTED PROVIDERS</div>${rows}` : rows}${addForm}${statusLine}`, btn("Close", "close"));
  }
  /* old provider modal body intentionally replaced above */
  /*
    const providers = studioProviders || [];
    const rows = providers.map((provider) => {
      const isDefault = provider.id === defaultProvider;
      const confirming = pmRemoveConfirm === provider.id;
      return `<div class="planout" style="border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:10px">
<div class="row between"><div class="bar"><b>${escapeHtml(provider.label)}</b><span class="muted tiny">${escapeHtml(provider.id)} · ${escapeHtml(provider.worker)} · ${escapeHtml(provider.model || "no model")}</span>${isDefault ? '<span class="pill green">project default</span>' : ""}${provider.ready ? '<span class="pill green">ready</span>' : '<span class="pill amber">not ready</span>'}</div></div>
${provider.ready ? "" : `<div class="muted tiny" style="margin-top:4px">${escapeHtml((provider.problems || []).join(" · "))}</div>`}
<div class="bar" style="margin-top:8px;flex-wrap:wrap"><input type="password" class="input" style="flex:1;min-width:150px" placeholder="Paste API key…" data-pm-key="${escapeHtml(provider.id)}">${btn("Save key", `pm-key:${escapeHtml(provider.id)}`, "sm")}${isDefault ? "" : btn("Set as default", `pm-use:${escapeHtml(provider.id)}`, "sm")}${btn(confirming ? "Confirm remove?" : "Remove", `pm-remove:${escapeHtml(provider.id)}`, `sm ${confirming ? "danger" : ""}`)}</div>
</div>`;
    }).join("") || '<p class="muted">No providers configured yet — add the first one below.</p>';
    const templates = pmTemplates || [];
    const templateOptions = templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(`${template.label}${template.models?.length ? ` · ${template.models[0]}` : ""}`)}</option>`).join("");
    const addForm = templates.length
      ? `<div class="lined muted tiny" style="margin:12px 0 8px">ADD A PROVIDER</div>
<div class="bar" style="flex-wrap:wrap"><select class="input" style="flex:1;min-width:170px" data-pm-template>${templateOptions}</select><input class="input" style="width:110px" data-pm-id placeholder="id (zai)"><input class="input" style="width:130px" data-pm-model placeholder="model (glm-4.6)"><input class="input" style="flex:1;min-width:170px" data-pm-url placeholder="base URL (prefilled by template)">${btn("Add provider", "pm-add", "sm primary")}</div>
<p class="muted tiny" style="margin-top:6px">The template prefills worker and endpoint. Save the key in the provider's row right after adding.</p>`
      : "";
    const statusLine = status ? `<p class="sub ${status.ok ? "green" : "red"}" style="margin-top:10px">${escapeHtml(status.text)}</p>` : "";
    popup("Providers", rows + addForm + statusLine, btn("Close", "close"));
  }
  */
  function taskForm(task) {
    const queues = derived().queues;
    const existingQueue = queues.find((queue) => queue.label === task?.queue)?.id;
    const defaultQueue = existingQueue || snapshot.queues?.active_queue || queues[0]?.id || "";
    popup(task ? `Edit ${escapeHtml(task.id)}` : "New ATL task", `<div class="field"><label class="label">Task title</label><input class="input" id="fTitle" value="${escapeHtml(task?.title || "")}" placeholder="Describe the task"></div><div class="field"><label class="label">Objective and acceptance criteria</label><textarea class="input" id="fDesc">${escapeHtml(task?.desc || "")}</textarea></div><div class="grid two"><div class="field"><label class="label">Queue</label><select class="input" id="fQueue"><option value="">Unqueued</option>${queues.map((queue) => `<option ${queue.id === defaultQueue ? "selected" : ""} value="${escapeHtml(queue.id)}">${escapeHtml(queue.label)}</option>`).join("")}</select></div><div class="field"><label class="label">Priority</label><select class="input" id="fPriority">${[["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]].map((row) => `<option value="${row[0]}" ${row[1] === task?.priority ? "selected" : ""}>${row[1]}</option>`).join("")}</select></div></div><p class="sub">New tasks are added to the active queue by default. Queue membership does not start execution.</p>`, btn("Cancel", "close") + btn(task ? "Save task" : "Create task", `save:${task?.id || ""}`, "primary")); $("#fTitle")?.focus(); }
  function taskDetail(task) {
    const logs = task.logs.length ? task.logs.map((entry) => `${entry.at ? new Date(entry.at).toLocaleTimeString() : "--:--:--"}  ${entry.event || "INFO"}  ${entry.detail || entry.note || "state changed"}`).join("\n") : "No task-specific logs recorded yet.";
    const outcome = taskOutcome(task);
    const outcomePanel = task.rawStatus === "done"
      ? `<div class="notice" style="margin-top:14px;border-color:var(--accent)"><b class="green">✓ Accomplished</b><p>${escapeHtml(outcome.summary)}</p><div class="bar"><span class="pill green">${outcome.passed} passed</span>${outcome.failed ? `<span class="pill red">${outcome.failed} failed</span>` : ""}<span class="pill">${outcome.total} checks</span></div></div>`
      : `<div class="notice" style="margin-top:14px"><b>${liveRunState(task) === "running" ? '<span class="running-mark"></span>Running now' : escapeHtml(task.status)}</b><p class="sub">${escapeHtml(task.stage)}</p></div>`;
    popup(`${escapeHtml(task.id)} / Task details`, `<div class="bar">${badge(task.status)}${badge(task.priority)}<span class="muted">${escapeHtml(task.queue)} · ${escapeHtml(task.agent)}</span></div><h2 style="font-size:18px;margin:17px 0">${escapeHtml(task.title)}</h2><p>${escapeHtml(task.desc)}</p>${lifecycleDiagram(task)}${taskProgressMarkup(task, true)}${outcomePanel}${task.block ? `<div class="notice" style="margin-top:14px"><b class="red">BLOCKER</b><p>${escapeHtml(task.block)}</p></div>` : ""}<h3 style="margin:18px 0 8px">Latest task activity</h3><pre class="terminal" style="max-height:230px;white-space:pre-wrap">${escapeHtml(logs)}</pre>`, btn("Diagram", `task-diagram:${task.id}`) + btn("Edit task", `edit:${task.id}`) + btn("Actions", `task-actions:${task.id}`, "primary"));
    detailExecution = { id: task.id, fingerprint: JSON.stringify(task) };
  }

  function refreshTaskDetail() {
    if (!dialogOpen || !detailExecution) return;
    syncRunSnapshot();
    const task = derived().tasks.find((item) => item.id === detailExecution.id);
    if (!task || JSON.stringify(task) === detailExecution.fingerprint) return;
    const scrollTop = $("#modal .dialogbody")?.scrollTop || 0;
    const focusedAction = document.activeElement?.dataset?.action;
    taskDetail(task);
    const body = $("#modal .dialogbody");
    if (body) body.scrollTop = scrollTop;
    if (focusedAction) [...document.querySelectorAll("#modal [data-action]")].find((node) => node.dataset.action === focusedAction)?.focus();
    applyLocale();
  }

  function taskDiagram(task) {
    detailExecution = null;
    const outcome = taskOutcome(task);
    const flow = `flowchart LR\n  A[Request] --> B[${task.agent}]\n  B --> C[${task.status}]\n  C --> D[${outcome.passed}/${outcome.total} checks passed]\n  D --> E[Outcome recorded]`;
    const model = `erDiagram\n  TASK ||--o{ LOG_EVENT : records\n  TASK ||--o{ EVIDENCE : proves\n  TASK }o--|| QUEUE : belongs_to\n  TASK }o--o| WORKSPACE : changes_in\n  TASK {\n    string id\n    string status\n    string assigned_worker\n    int attempt_count\n  }`;
    popupWide(`${escapeHtml(task.id)} / Change diagrams`, `<p class="sub">The lifecycle picture is derived from persisted task state. Mermaid source documents the underlying relationships; it communicates structure, not proof.</p><h3>What happened</h3>${lifecycleDiagram(task)}<div class="notice" style="margin-top:12px"><b>${escapeHtml(outcome.summary)}</b><p class="sub">${outcome.passed}/${outcome.total} checks passed · ${task.logs.length} recent events · ${escapeHtml(task.workspace || "no workspace recorded")}</p></div><h3 style="margin-top:18px">Change-flow Mermaid</h3><pre class="terminal" style="min-height:0;white-space:pre-wrap">${escapeHtml(flow)}</pre><h3 style="margin-top:18px">Task data model · Mermaid ER</h3><pre class="terminal" style="min-height:0;white-space:pre-wrap">${escapeHtml(model)}</pre>`, btn("Back to task", `task-detail:${task.id}`, "primary") + btn("Close", "close"));
  }
  // Plain-language replacement for the legacy raw-Mermaid diagram view.
  function taskDiagram(task) {
    const outcome = taskOutcome(task);
    const checksLabel = outcome.total ? `${outcome.passed}/${outcome.total} checks passed` : "No checks recorded";
    const story = [
      ["01", "Request received", `The task ${task.id} entered ATL as “${task.title}”.`],
      ["02", task.agent === "Unassigned" ? "Waiting for an owner" : `Worked by ${task.agent}`, task.agent === "Unassigned" ? "No worker is assigned yet." : "The assigned worker handled the change in an isolated workspace."],
      ["03", `Reached ${task.status}`, task.rawStatus === "done" ? "The lifecycle reached its terminal Done state." : "The task is currently at this lifecycle stage."],
      ["04", checksLabel, outcome.total ? "Completion evidence is recorded against the task." : "Add completion checks and evidence to make the outcome verifiable."],
      ["05", "Outcome recorded", outcome.summary],
    ];
    const storyMarkup = `<div class="diagram-story" aria-label="Task change flow">${story.map(([number, title, detail], index) => `<div class="diagram-story-step"><div class="diagram-node">${number}</div><div><b>${escapeHtml(title)}</b><p class="sub">${escapeHtml(detail)}</p></div>${index < story.length - 1 ? '<span class="diagram-arrow" aria-hidden="true">↓</span>' : ''}</div>`).join("")}</div>`;
    const relationships = [
      ["Task", "The central record: status, owner, queue, attempts, and objective."],
      ["Evidence", `${outcome.total ? `${outcome.total} completion check${outcome.total === 1 ? "" : "s"} linked to this task.` : "No completion checks are linked yet."}`],
      ["Activity logs", `${task.logs.length} recent event${task.logs.length === 1 ? "" : "s"} narrate state changes and worker activity.`],
      ["Queue", `${task.queue} determines the workstream and dispatch context.`],
      ["Workspace", task.workspace ? "An isolated workspace contains the change." : "No workspace path is recorded."],
    ];
    const relationshipMarkup = `<div class="diagram-relationships">${relationships.map(([title, detail]) => `<div class="diagram-relationship"><span class="pill blue">${escapeHtml(title)}</span><span class="diagram-connector" aria-hidden="true">→</span><span class="sub">${escapeHtml(detail)}</span></div>`).join("")}</div>`;
    popupWide(`${escapeHtml(task.id)} / Understand this task`, `<p class="sub">This view explains the task in plain language: what happened and which records support it.</p><h3>What happened</h3>${storyMarkup}<div class="notice" style="margin-top:14px"><b class="green">Current outcome</b><p>${escapeHtml(outcome.summary)}</p><div class="bar"><span class="pill green">${escapeHtml(checksLabel)}</span><span class="pill">${task.logs.length} recent log${task.logs.length === 1 ? "" : "s"}</span><span class="pill">${escapeHtml(task.queue)}</span></div></div><h3 style="margin-top:22px">What is connected to this task?</h3><p class="sub">These records explain the task and make its result auditable.</p>${relationshipMarkup}`, btn("Back to task", `task-detail:${task.id}`, "primary") + btn("Close", "close"));
  }

  function taskActions(task) {
    const runnable = !["done", "archived", "in_progress", "in_review", "verifying"].includes(task.rawStatus);
    popup(`${escapeHtml(task.id)} / More actions`, '<p class="sub">Planning and running always show their review step before work starts. Deletion archives the task so it can be restored from the CLI.</p>', btn("Back", `task-detail:${task.id}`) + (task.rawStatus === "blocked" ? btn("Unblock", `unblock:${task.id}`) : "") + btn("Plan task", `plan:${task.id}`) + (runnable ? btn("Review task run", `run-task:${task.id}`, "primary") : "") + btn("Delete task", `task-delete:${task.id}`, "danger"));
  }
  function queueDetail(queue) {
    const itemCount = (queue.items || []).length;
    const isActive = queue.id === snapshot.queues?.active_queue;
    const isRunning = currentRun.status === "running" && (currentRun.queueId === queue.id || currentRun.queueId === queue.label || (currentRun.queueIds || []).includes(queue.id));
    popup(`${escapeHtml(queue.label)} / Queue`, `<div class="bar">${badge(isRunning ? "Running" : queue.status)}${isActive ? '<span class="pill green">active</span>' : ""}${queue.plan_draft_id ? '<span class="pill violet">plan queue</span>' : ""}</div><p style="margin-top:14px"><b>${itemCount}</b> queued task${itemCount === 1 ? "" : "s"}. ${isRunning ? "Execution is active; progress and logs update on the Queues page." : "Preview before any run; confirmation is still required."}</p><p class="sub">${queue.id === "default" ? "The default queue cannot be deleted, but it can be reset safely." : "Deleting a named queue archives its board entry and keeps its tasks in the portfolio."}</p>`, (isRunning ? btn("Stop safely", "run-stop", "danger") : btn("Review run", `run-confirm:${queue.id}`, "primary")) + btn("View tasks", `queue:${encodeURIComponent(queue.label)}`) + btn("Queue actions", `queue-actions:${queue.id}`));
  }
  function queueActions(queue) {
    const isDefault = queue.id === "default";
    popup(`${escapeHtml(queue.label)} / Queue actions`, `<p class="sub">${isDefault ? "Reset removes only membership from the default queue; it does not delete tasks." : "Administrative changes never start work."}</p>`, btn("Back", `queue-detail:${queue.id}`) + (queue.id === snapshot.queues?.active_queue ? "" : btn("Set active", `queue-use:${queue.id}`)) + btn(queue.status === "paused" ? "Resume queue" : "Pause queue", `queue-toggle:${queue.id}`) + btn(isDefault ? "Reset default queue" : "Clear queue", `queue-clear:${queue.id}`, "danger") + (isDefault ? "" : btn("Delete queue", `queue-delete:${queue.id}`, "danger")));
  }
  function commandOptions(value = "") { return routes.map((route) => ["Go to " + route[2], "go:" + route[0]]).concat([["New task", "new"], ["Generate SDD/TDD plan", "go:studio"], ["Preview active queue", "run-preview"], ["Run active queue", "run-confirm"], ["Stop active run", "run-stop"], ["CLI console", "cli"], ["Refresh state", "refresh"]]).filter((item) => item[0].toLowerCase().includes(value.toLowerCase())).map((item) => `<button class="nav" data-action="${item[1]}">› ${item[0]}</button>`).join("") || '<p class="muted">No matching command</p>'; }
  function palette() { popup('Command palette <span class="muted tiny">Ctrl K</span>', '<input class="input" id="paletteQ" placeholder="Find a page or action..."/><div id="paletteItems">' + commandOptions() + '</div>'); $("#paletteQ")?.focus(); }
  function cli() { popup("ATL CLI · live", `<div class="terminal">${escapeHtml(cliHistory.join("\n"))}</div><div class="row space"><span class="green">atl ›</span><input id="cliInput" class="input" style="flex:1" placeholder="help"></div>`, btn("Close", "close")); $("#cliInput")?.focus(); }
  async function runCommand(raw) {
    const command = String(raw || "").trim();
    if (!command) return;
    cliHistory.push(`atl › ${command}`);
    try {
      const response = await fetch("/api/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command }) });
      const result = await response.json();
      cliHistory.push(...(result.lines || [result.error || "No output."]));
      if (result.refresh) await refresh(false);
      if (result.effect === "launch-preview") popup("Launch preview", `<div class="terminal">${escapeHtml((result.lines || []).join("\n"))}</div>`, btn("Close", "close"));
    } catch (error) { cliHistory.push(`Error: ${error.message}`); }
    cliHistory = cliHistory.slice(-40);
    cli();
  }
  async function apiCommand(command) {
    const response = await fetch("/api/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `command failed (${response.status})`);
    return result;
  }
  async function refreshRun(renderAfter = true) {
    try { currentRun = await fetch("/api/run", { cache: "no-store" }).then((response) => response.json()); } catch { /* snapshot health reports connection loss */ }
    refreshTaskDetail();
    if (renderAfter && page === "queues") render();
  }
  async function refresh(renderAfter = true) {
    try { const response = await fetch("/api/snapshot", { cache: "no-store" }); if (!response.ok) throw new Error(`snapshot ${response.status}`); snapshot = await response.json(); connected = true; }
    catch { connected = false; }
    refreshTaskDetail();
    const editing = dialogOpen || cardDraft || document.activeElement?.matches("input, textarea, select");
    if (renderAfter && !editing) render();
  }
  function connectStream() { if (stream) stream.close(); stream = new EventSource(`/api/events?cursor=${streamCursor}`); stream.onmessage = (event) => { try { const payload = JSON.parse(event.data); streamCursor = payload.cursor || streamCursor; snapshot = payload.snapshot || snapshot; connected = true; streamRetry = 1000; render(); } catch {} }; stream.onerror = () => { connected = false; stream.close(); setTimeout(connectStream, streamRetry); streamRetry = Math.min(streamRetry * 2, 15000); render(); }; }
  setInterval(() => { if (connected && snapshot.captured_at && Date.now() - new Date(snapshot.captured_at).getTime() > 10000) { connected = false; render(); } }, 1000);
  async function refreshProviderUsage() {
    usageNotice = "Refreshing configured provider telemetry…";
    render();
    try {
      const response = await fetch("/api/usage/refresh", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || `usage refresh failed (${response.status})`);
      if (result.snapshot) snapshot = result.snapshot;
      connected = true;
      usageNotice = result.message || (result.refreshed?.length ? `Checked ${result.refreshed.length} configured provider${result.refreshed.length === 1 ? "" : "s"}.` : "No provider usage samples were returned.");
    } catch (error) { usageNotice = `Usage refresh failed: ${error.message}`; }
    render();
  }
  async function mutation(command, after = page) { close(); await runCommand(command); await refresh(false); page = after; render(); }
  async function action(value) {
    if (value === "toggle-locale") {
      locale = locale === "fa-IR" ? "en-US" : "fa-IR";
      try { localStorage.setItem("atl-cp-lang", locale); localStorage.removeItem("atl-locale"); } catch { /* private browsing */ }
      window.location.reload();
      return;
    }
    const brainMutation = async (body) => {
      const response = await fetch("/api/brain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "knowledge action failed");
      if (result.snapshot) snapshot = result.snapshot;
      page = "brain"; render(); return result.result;
    };
    if (value.startsWith("brain-approve:")) { try { await brainMutation({ action: "approve-claim", claim_id: value.slice(14), note: "Approved in Control Plane" }); } catch (error) { popup("Approval refused", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); } return; }
    if (value.startsWith("approval-approve:") || value.startsWith("approval-deny:")) {
      const id = value.slice(value.indexOf(":") + 1);
      const approve = value.startsWith("approval-approve:");
      await applyApprovalDecision(id, approve);
      return;
    }
    if (value.startsWith("approval-revoke:")) { const id = value.slice(17); try { const response = await fetch("/api/approvals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revoke", grant_id: id }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "revocation failed"); await refresh(false); page = "approvals"; render(); } catch (error) { popup("Revocation failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); } return; }
    if (value === "project-register") { popup("Register repository", '<label class="label">Repository path<input id="projectRoot" class="input" placeholder="D:\\Projects\\MyRepo"></label><label class="label">Display name<input id="projectName" class="input"></label><label class="label">Project session cap<input id="projectCap" type="number" min="1" max="5" value="1" class="input"></label>', btn("Cancel", "close") + btn("Register", "project-register-save", "primary")); return; }
    if (value === "project-register-save") { try { const response = await fetch("/api/supervisor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "register", root: $("#projectRoot")?.value.trim(), name: $("#projectName")?.value.trim(), maxConcurrent: Number($("#projectCap")?.value || 1) }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "project registration failed"); close(); await refresh(false); page = "projects"; render(); } catch (error) { popup("Registration failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); } return; }
    if (value.startsWith("project-delete:")) { const id = value.slice(15); popup("Delete project?", `<p>This removes the project from the supervisor registry. Its local repository and task state remain on disk.</p>`, btn("Cancel", "close") + btn("Delete project", `project-delete-confirm:${id}`, "danger")); return; }
    if (value.startsWith("project-delete-confirm:")) { try { const response = await fetch("/api/supervisor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove", id: value.slice(23) }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "project deletion failed"); close(); selectedProjects.clear(); await refresh(false); page = "projects"; render(); } catch (error) { popup("Project deletion refused", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); } return; }
    if (value === "projects-delete-selected") { const ids = [...selectedProjects]; if (!ids.length) return popup("No projects selected", "<p>Select one or more projects first.</p>", btn("Close", "close")); popup(`Delete ${ids.length} project(s)?`, "<p>Projects are removed from the supervisor registry; their local state remains on disk.</p>", btn("Cancel", "close") + btn("Delete selected", "projects-delete-confirm", "danger")); return; }
    if (value === "projects-delete-confirm") { const ids = [...selectedProjects]; for (const id of ids) { const response = await fetch("/api/supervisor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove", id }) }); if (!response.ok) { const result = await response.json(); return popup("Bulk deletion stopped", `<p class="red">${escapeHtml(result.error || "deletion failed")}</p>`, btn("Close", "close")); } } close(); selectedProjects.clear(); await refresh(false); page = "projects"; render(); return; }
    if (value === "backup-create") { try { const response = await fetch("/api/backups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", label: "manual browser backup" }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "backup failed"); await refresh(false); page = "operations"; render(); } catch (error) { popup("Backup failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); } return; }
    if (value.startsWith("backup-preview:")) { const id = value.slice(15); try { const result = await fetch(`/api/backups/preview?id=${encodeURIComponent(id)}`).then((response) => response.json()); popup("Restore preview", `<p><b>${escapeHtml(id)}</b></p><p class="sub">Integrity: ${result.preview?.verified ? "verified" : "failed"}. ${result.preview?.files?.length || 0} files would be restored.</p>`, btn("Close", "close")); } catch (error) { popup("Preview failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); } return; }
    if (value.startsWith("backup-restore:")) { const id = value.slice(15); popup("Restore backup?", `<p>This stops recovery if active and replaces the project manager store with backup <b>${escapeHtml(id)}</b>.</p>`, btn("Preview", `backup-preview:${id}`, "ghost") + btn("Cancel", "close") + btn("Restore", `backup-restore-confirm:${id}`, "danger")); return; }
    if (value.startsWith("backup-restore-confirm:")) { try { const response = await fetch("/api/backups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "restore", backup_id: value.slice(23) }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "restore failed"); close(); await refresh(false); page = "operations"; render(); } catch (error) { popup("Restore failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); } return; }
    if (value === "brain-skill-form") { popup("Validate and promote Gold skill", '<div class="grid two"><label class="label">Skill id<input id="brainSkillId" class="input"></label><label class="label">Version<input id="brainSkillVersion" class="input" value="1.0.0"></label></div><label class="label">Input contract<input id="brainSkillInput" class="input"></label><label class="label">Regression fixtures (comma-separated)<input id="brainSkillFixtures" class="input"></label><div class="notice"><b>Gold gate</b><p class="sub">Promotion requires validation, approval boundary, rollback, fixtures, and explicit manager confirmation.</p></div>', btn("Cancel", "close") + btn("Promote Gold skill", "brain-skill-save", "primary")); return; }
    if (value === "brain-skill-save") { try { await brainMutation({ action: "promote-skill", skill: { id: $("#brainSkillId")?.value.trim(), version: $("#brainSkillVersion")?.value.trim(), input_contract: $("#brainSkillInput")?.value.trim(), validation: "deterministic fixtures", approval_boundary: "manager", rollback: "disable skill", fixtures: ($("#brainSkillFixtures")?.value || "").split(",").map((item) => item.trim()).filter(Boolean), gold_verified: true } }); close(); } catch (error) { popup("Skill promotion refused", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); } return; }
    if (value === "brain-routine-form") { const options = (snapshot.brain?.skills || []).map((skill) => `<option value="${escapeHtml(`${skill.id}@${skill.version}`)}">${escapeHtml(skill.id)} · ${escapeHtml(skill.version)}</option>`).join(""); popup("Register approval-gated routine", `<label class="label">Routine id<input id="brainRoutineId" class="input"></label><label class="label">Approved Gold skill<select id="brainRoutineSkill" class="input">${options}</select></label><label class="label">Schedule<input id="brainRoutineSchedule" class="input" placeholder="daily 09:00"></label><label class="label">Idempotency key<input id="brainRoutineKey" class="input" placeholder="routine+source+revision"></label><label class="label">Retry limit<input id="brainRoutineRetries" type="number" min="0" max="5" class="input" value="2"></label><div class="notice"><b>Registration does not enable execution.</b><p class="sub">The routine remains disabled until a separate manager approval gate exists.</p></div>`, btn("Cancel", "close") + btn("Register disabled routine", "brain-routine-save", "primary")); return; }
    if (value === "brain-routine-save") { try { const [skill_id, skill_version] = ($("#brainRoutineSkill")?.value || "@").split("@"); await brainMutation({ action: "register-routine", routine: { id: $("#brainRoutineId")?.value.trim(), skill_id, skill_version, schedule: $("#brainRoutineSchedule")?.value.trim(), idempotency_key: $("#brainRoutineKey")?.value.trim(), retry_limit: Number($("#brainRoutineRetries")?.value || 0) } }); close(); } catch (error) { popup("Routine registration refused", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); } return; }
    if (value === "close") return close();
    if (value === "new") return taskForm();
    if (value.startsWith("save:")) return saveTask(value.slice(5));
    if (value === "palette") return palette();
    if (value === "cli") return cli();
    if (value === "refresh") { await refresh(); return; }
    if (value === "usage-refresh") return refreshProviderUsage();
    if (value.startsWith("go:")) { close(); page = value.slice(3); render(); return; }
    if (value.startsWith("filter:")) { filter = value.slice(7); page = "tasks"; render(); return; }
    if (value === "blockers") { filter = "Blocked"; queueFilter = "All"; page = "tasks"; render(); return; }
    if (value.startsWith("edit:")) return taskForm(derived().tasks.find((task) => task.id === value.slice(5)));
    if (value.startsWith("task-detail:")) { const task = derived().tasks.find((item) => item.id === value.slice(12)); if (task) taskDetail(task); return; }
    if (value.startsWith("task-diagram:")) { const task = derived().tasks.find((item) => item.id === value.slice(13)); if (task) taskDiagram(task); return; }
    if (value.startsWith("task-actions:")) { const task = derived().tasks.find((item) => item.id === value.slice(13)); if (task) taskActions(task); return; }
    if (value.startsWith("task-delete:")) {
      const id = value.slice(12);
      const task = derived().tasks.find((item) => item.id === id);
      popup(`Delete ${escapeHtml(id)}?`, `<p><b>${escapeHtml(task?.title || id)}</b> will leave the active portfolio and all queues.</p><p class="sub">This is a recoverable archive; active sessions still refuse deletion until stopped or completed.</p>`, btn("Cancel", "close") + btn("Delete task", `task-delete-confirm:${id}`, "danger"));
      return;
    }
    if (value.startsWith("task-delete-confirm:")) return mutation(`task archive ${value.slice(20)} --note "deleted from browser control plane"`, "tasks");
    if (value === "tasks-select-visible") {
      const { tasks } = derived();
      for (const task of tasks) if (!task.archived && (queueFilter === "All" || task.queue === queueFilter) && (filter === "All" || task.status === filter) && [task.title, task.id, task.agent, task.desc].join(" ").toLowerCase().includes(query.toLowerCase())) selectedTasks.add(task.id);
      render();
      return;
    }
    if (value === "tasks-clear-selection") { selectedTasks.clear(); render(); return; }
    if (value === "tasks-archive-selected") {
      const ids = [...selectedTasks];
      popup(`Archive ${ids.length} task(s)?`, `<p>This removes the selected tasks from active lists and queues, but keeps them recoverable as archived records.</p><p class="sub">Running, review, and verification tasks are skipped for safety.</p>`, btn("Cancel", "close") + btn(`Archive ${ids.length}`, "tasks-archive-confirm", "danger"));
      return;
    }
    if (value === "tasks-archive-confirm") {
      const ids = [...selectedTasks];
      close();
      for (const id of ids) {
        const task = derived().tasks.find((item) => item.id === id);
        if (task && !["in_progress", "in_review", "verifying"].includes(task.rawStatus)) await apiCommand(`task archive ${id} --note "bulk archived from browser control plane"`);
      }
      selectedTasks.clear();
      await refresh(false);
      render();
      return;
    }
    if (value.startsWith("archive:")) return mutation(`task archive ${value.slice(8)} --note "archived from browser control plane"`, "tasks");
    if (value.startsWith("unblock:")) return mutation(`unblock ${value.slice(8)} --note "manager recovered from browser control plane"`, "tasks");
    if (value.startsWith("plan:")) { close(); page = "studio"; render(); const goal = $("#goal"); if (goal) goal.value = derived().tasks.find((task) => task.id === value.slice(5))?.desc || ""; return; }
    if (value === "mode:local" || value === "mode:model") { studioMode = value.slice(5); studioNotice = ""; if (studioMode === "model") await loadProviders(true); render(); return; }
    if (value === "studio-clear") {
      studioGoal = "";
      studioAttachments = [];
      studioMode = "local";
      studioProvider = "";
      studioModel = "";
      studioThinking = "";
      studioNotice = "";
      studioErrorLog = null;
      studioRejectedResponse = null;
      currentDraft = null;
      closeCardEditor();
      render();
      return;
    }
    if (value === "provider-manager") { pmRemoveConfirm = null; pmEditingId = null; await loadProviders(true); providerManagerModal(null); return; }
    if (value === "provider-recheck") { await loadProviders(true); providerManagerModal({ ok: true, text: "Rechecked built-in workers and registry providers." }); return; }
    if (value.startsWith("copy:")) {
      const text = value.slice(5);
      const button = document.querySelector(`[data-action="${value}"]`);
      const flash = (label) => { if (button) { const original = button.textContent; button.textContent = label; button.disabled = true; setTimeout(() => { button.textContent = original; button.disabled = false; }, 1400); } };
      try {
        navigator.clipboard.writeText(text).then(() => flash("Copied ✓"), () => flash("Copy failed — select the command text"));
      } catch { flash("Copy failed — select the command text"); }
      return;
    }
    if (value.startsWith("pm-edit:")) { pmEditingId = value.slice(8); providerManagerModal(null); return; }
    if (value === "pm-cancel") { pmEditingId = null; providerManagerModal(null); return; }
    if (value === "navigation-save") {
      const body = {
        mode: $("#navigationMode")?.value,
        max_tokens: Number($("#navigationTokens")?.value),
        build_on_launch: Boolean($("#navigationBuild")?.checked),
      };
      try {
        const result = await planApi("/api/navigation", body);
        navigationSettings = result.navigation;
        navigationNotice = `Saved: navigation ${result.navigation.mode === "on" ? "enabled" : "disabled"} with a ${result.navigation.max_tokens}-token budget.`;
      } catch (error) { navigationNotice = `Error: ${error.message}`; }
      render();
      return;
    }
    if (value === "pm-add") {
      const form = document.querySelector("[data-pm-template]");
      const id = document.querySelector("[data-pm-id]")?.value.trim();
      if (!id) return providerManagerModal({ ok: false, text: "Give the provider an id (e.g. zai)." });
      try {
        const result = await planApi("/api/providers", {
          action: "add",
          id,
          template: form?.value || null,
          label: document.querySelector("[data-pm-label]")?.value.trim() || null,
          protocol: document.querySelector("[data-pm-protocol]")?.value || null,
          worker: document.querySelector("[data-pm-worker]")?.value || null,
          model: document.querySelector("[data-pm-model]")?.value.trim() || null,
          base_url: document.querySelector("[data-pm-url]")?.value.trim() || null,
          thinking_level: document.querySelector("[data-pm-thinking]")?.value || null,
          key: document.querySelector("[data-pm-key-new]")?.value.trim() || null,
        });
        studioProviders = result.providers; pmTemplates = result.templates; defaultProvider = result.defaultProvider;
        studioProvider = studioProvider || (result.providers.find((provider) => provider.id === id)?.ready ? id : studioProvider);
        providerManagerModal({ ok: true, text: `${id} added${document.querySelector("[data-pm-key-new]")?.value.trim() ? " and key stored" : " — add its API key to finish setup"}.` });
      } catch (error) { providerManagerModal({ ok: false, text: error.message }); }
      return;
    }
    if (value.startsWith("pm-key:")) {
      const id = value.slice(7);
      const key = document.querySelector(`[data-pm-key="${id}"]`)?.value.trim();
      if (!key) return providerManagerModal({ ok: false, text: `Paste the API key for ${id} first.` });
      try {
        const result = await planApi("/api/providers", { action: "key", id, key });
        studioProviders = result.providers; pmTemplates = result.templates; defaultProvider = result.defaultProvider;
        providerManagerModal({ ok: true, text: `Key stored for ${id} — it is never echoed back, only the masked ready state.` });
      } catch (error) { providerManagerModal({ ok: false, text: error.message }); }
      return;
    }
    if (value.startsWith("pm-save:")) {
      const id = value.slice(8);
      const label = document.querySelector(`[data-pm-label="${id}"]`)?.value.trim() || "";
      const model = document.querySelector(`[data-pm-model="${id}"]`)?.value.trim() || "";
      const base_url = document.querySelector(`[data-pm-url="${id}"]`)?.value.trim() || "";
      const thinking_level = document.querySelector(`[data-pm-thinking-level="${id}"]`)?.value || "";
      const key = document.querySelector(`[data-pm-key="${id}"]`)?.value.trim() || "";
      if (!model) return providerManagerModal({ ok: false, text: "Choose a model first." });
      try {
        let result = await planApi("/api/providers", { action: "update", id, label, model, base_url, thinking_level });
        if (key) result = await planApi("/api/providers", { action: "key", id, key });
        studioProviders = result.providers; pmTemplates = result.templates; defaultProvider = result.defaultProvider;
        if (studioProvider === id || defaultProvider === id) { studioProvider = id; studioModel = model; studioThinking = thinking_level; }
        pmEditingId = null;
        providerManagerModal({ ok: true, text: `${label || id} connection settings saved${key ? " and API key updated" : ""}.` });
      } catch (error) { providerManagerModal({ ok: false, text: error.message }); }
      return;
    }
    if (value.startsWith("pm-thinking:")) {
      const id = value.slice(12);
      const thinking = document.querySelector(`[data-pm-thinking-existing="${id}"]`)?.value || "";
      try {
        const result = await planApi("/api/providers", { action: "update", id, thinking_level: thinking });
        studioProviders = result.providers; pmTemplates = result.templates; defaultProvider = result.defaultProvider;
        providerManagerModal({ ok: true, text: `${id} default thinking set to ${thinking || "provider default"}.` });
      } catch (error) { providerManagerModal({ ok: false, text: error.message }); }
      return;
    }
    if (value.startsWith("pm-model:")) {
      const id = value.slice(9);
      const model = document.querySelector(`[data-pm-current-model="${id}"]`)?.value || "";
      if (!model) return providerManagerModal({ ok: false, text: "Choose a model first." });
      try {
        const result = await planApi("/api/providers", { action: "update", id, model });
        studioProviders = result.providers; pmTemplates = result.templates; defaultProvider = result.defaultProvider;
        if (studioProvider === id || defaultProvider === id) { studioProvider = id; studioModel = model; studioThinking = result.providers.find((provider) => provider.id === id)?.thinking_level || ""; }
        providerManagerModal({ ok: true, text: `${id} is now connected to ${model}.` });
      } catch (error) { providerManagerModal({ ok: false, text: error.message }); }
      return;
    }
    if (value.startsWith("pm-use:")) {
      const id = value.slice(7);
      try {
        const result = await planApi("/api/providers", { action: "use", id });
        studioProviders = result.providers; pmTemplates = result.templates; defaultProvider = result.defaultProvider;
        studioProvider = id;
        studioModel = studioProviders.find((provider) => provider.id === id)?.model || "";
        studioThinking = studioProviders.find((provider) => provider.id === id)?.thinking_level || "";
        providerManagerModal({ ok: true, text: `${id} is now this project's default provider.` });
      } catch (error) { providerManagerModal({ ok: false, text: error.message }); }
      return;
    }
    if (value.startsWith("pm-remove:")) {
      const id = value.slice(10);
      if (pmRemoveConfirm !== id) {
        pmRemoveConfirm = id;
        providerManagerModal({ ok: false, text: `Click remove again to delete ${id} — its stored key is erased.` });
        return;
      }
      try {
        const result = await planApi("/api/providers", { action: "remove", id });
        pmRemoveConfirm = null;
        studioProviders = result.providers; pmTemplates = result.templates; defaultProvider = result.defaultProvider;
        if (studioProvider === id) studioProvider = studioProviders.find((provider) => provider.ready)?.id || "";
        providerManagerModal({ ok: true, text: `${id} removed from the machine registry.` });
      } catch (error) { pmRemoveConfirm = null; providerManagerModal({ ok: false, text: error.message }); }
      return;
    }
    if (value === "generate") {
      // A second click while fetch is pending would spend another bounded
      // provider session. The DOM is disabled too; this guard keeps the
      // safety rule true for synthetic or stale click events.
      if (studioBusy) return;
      const goal = $("#goal")?.value.trim();
      if (!goal) { studioNotice = "Error: write the objective first — generation needs a bounded goal and constraints."; render(); return; }
      const output = $("#planOutput");
      if (studioMode === "model") {
        const selected = (studioProviders || []).find((provider) => provider.id === studioProvider);
        if (!selected) { studioNotice = "Error: select a configured provider before model generation."; render(); return; }
        if (!selected.ready) { studioNotice = `Error: ${selected.id} is not ready — ${((selected.problems || []).join(" · "))}`; render(); return; }
      studioBusy = true; startStudioProgress(); studioNotice = `Generating with ${selected.label} — request sent; waiting for provider response (15 minute cap).`;
      if (output) output.innerHTML = studioProgressPanel();
      render();
      try {
        const result = await planApi("/api/plan/generate", { intent: studioContext(), provider: selected.id, model: studioModel || null, thinking_level: studioThinking || null, confirm: true });
        currentDraft = result.draft; studioBusy = false; stopStudioProgress();
        // Keep the source objective and references visible so the generated
        // plan remains auditable against the user's original intent. The
        // explicit Clear form action is still the only reset path.
        studioErrorLog = null; studioRejectedResponse = null;
        closeCardEditor();
        studioNotice = `Model plan ready — ${result.draft.label?.label || "provider plan"}. Edit the task cards below before approving.`;
      } catch (error) {
        studioBusy = false; stopStudioProgress();
        studioNotice = `Error: ${error.message} — the previous draft stays untouched.`;
        studioErrorLog = error.providerLogLines || null;
        studioRejectedResponse = error.providerResponse || null;
      }
      render();
      return;
    }
    studioBusy = true; render();
    try {
      const result = await apiCommand(`plan generate "${goal.replaceAll('"', '\\"')}"`);
      currentDraft = result.draft; studioBusy = false;
      closeCardEditor();
      studioNotice = "Local structural draft generated (deterministic — not model output). Task cards are editable below.";
    } catch (error) { studioBusy = false; studioNotice = `Error: ${error.message}`; }
    render();
    return;
  }
    if (value === "card-add") {
      if (!currentDraft) return;
      try {
        const result = await planApi("/api/plan/card", { draftId: currentDraft.id, action: "add" });
        currentDraft = result.draft;
        closeCardEditor();
        openCardEditor(currentDraft.artifact.task_proposals.at(-1));
        studioNotice = "Empty card added — fill the form and Confirm.";
      } catch (error) { studioNotice = `Error: ${error.message}`; }
      render();
      return;
    }
    if (value.startsWith("card-edit:")) {
      const id = value.slice(10);
      const proposal = (currentDraft?.artifact?.task_proposals || []).find((item) => item.id === id);
      if (!proposal) return;
      closeCardEditor();
      openCardEditor(proposal);
      render();
      return;
    }
    if (value === "card-cancel") { closeCardEditor(); studioNotice = ""; render(); return; }
    if (value === "card-reset-defaults") {
      if (!cardDraft || !currentDraft) return;
      const proposal = (currentDraft.artifact?.task_proposals || []).find((item) => item.id === openCard);
      const defaults = proposal?.defaults || { proposed_worker: proposal?.proposed_worker, selected_skills: proposal?.selected_skills || [] };
      cardDraft.worker = defaults.proposed_worker;
      cardDraft.skills = [...(defaults.selected_skills || [])];
      render();
      return;
    }
    if (value.startsWith("card-skill:")) {
      if (!cardDraft) return;
      const skill = value.slice(11);
      cardDraft.skills = cardDraft.skills.includes(skill) ? cardDraft.skills.filter((item) => item !== skill) : [...cardDraft.skills, skill];
      render();
      return;
    }
    if (value.startsWith("card-save:")) {
      if (!cardDraft || !currentDraft) return;
      const id = value.slice(10);
      const patch = {
        title: cardDraft.title,
        objective: cardDraft.objective,
        proposed_worker: cardDraft.worker,
        selected_skills: cardDraft.skills,
        completion_checks: cardDraft.checksText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        files: cardDraft.filesText.split(/[,;]/).map((item) => item.trim()).filter(Boolean),
        depends_on: cardDraft.depsText.split(/[,;]/).map((item) => item.trim()).filter(Boolean),
        verify: cardDraft.verify.trim(),
      };
      try {
        const result = await planApi("/api/plan/card", { draftId: currentDraft.id, action: "edit", proposalId: id, patch });
        currentDraft = result.draft;
        const card = (result.draft.artifact?.task_proposals || []).find((proposal) => proposal.id === id);
        closeCardEditor();
        studioNotice = `Card ${id} confirmed — rev ${card?.revision ?? "?"} saved.`;
      } catch (error) { studioNotice = `Error: ${error.message} — the form stays open with your edits.`; }
      render();
      return;
    }
    if (value.startsWith("card-regen:")) {
      if (!cardDraft || !currentDraft) return;
      const id = value.slice(11);
      try {
        const feedback = cardDraft.feedback.trim();
        if (feedback) await planApi("/api/plan/card", { draftId: currentDraft.id, action: "feedback", proposalId: id, text: feedback });
        studioBusy = true; studioNotice = `Regenerating card ${id} — one bounded model call; every other card stays untouched…`;
        render();
        const result = await planApi("/api/plan/regenerate", { draftId: currentDraft.id, proposalId: id, confirm: true });
        currentDraft = result.draft; studioBusy = false; studioErrorLog = null; studioRejectedResponse = null;
        closeCardEditor();
        studioNotice = `Card ${id} regenerated — its prior version is kept in the card's revision history; the default badge re-baselined to the new output.`;
      } catch (error) {
        studioBusy = false;
        studioNotice = `Error: ${error.message} — the card is unchanged and your form stays open.`;
        studioErrorLog = error.providerLogLines || null;
        studioRejectedResponse = error.providerResponse || null;
      }
      render();
      return;
    }
    if (value === "show-provider-log") {
      popup("Raw provider response (provider.log tail)", `<pre class="planout" style="white-space:pre-wrap;max-height:60vh;overflow:auto">${escapeHtml((studioErrorLog || []).join("\n"))}</pre><p class="muted tiny" style="margin-top:10px">Last 40 transcript lines from the failed planning call. The schema gate refused this output; your draft was untouched.</p>`, btn("Close", "close"));
      return;
    }
    if (value.startsWith("card-remove:")) {
      if (!currentDraft) return;
      const id = value.slice(12);
      try {
        const result = await planApi("/api/plan/card", { draftId: currentDraft.id, action: "remove", proposalId: id });
        currentDraft = result.draft;
        if (openCard === id) closeCardEditor();
        studioNotice = `Card ${id} removed.`;
      } catch (error) { studioNotice = `Error: ${error.message}`; }
      render();
      return;
    }
    if (value.startsWith("studio-file-remove:")) { studioAttachments.splice(Number(value.slice(19)), 1); render(); return; }
    if (value.startsWith("card-up:") || value.startsWith("card-down:")) {
      if (!currentDraft) return;
      const id = value.slice(value.indexOf(":") + 1);
      const proposals = currentDraft.artifact?.task_proposals || [];
      const index = proposals.findIndex((proposal) => proposal.id === id);
      const position = value.startsWith("card-up:") ? index - 1 : index + 1;
      if (position < 0 || position >= proposals.length) return;
      try { const result = await planApi("/api/plan/card", { draftId: currentDraft.id, action: "reorder", proposalId: id, position }); currentDraft = result.draft; } catch (error) { studioNotice = `Error: ${error.message}`; }
      render();
      return;
    }
    if (value.startsWith("queue-delete:")) {
      const id = value.slice(13);
      const queue = derived().queues.find((item) => item.id === id);
      popup(`Delete queue ${escapeHtml(id)}?`, `<p><b>${escapeHtml(queue?.label || id)}</b> is removed from the board (archived).</p><p class="sub">Its ${escapeHtml(String((queue?.items || []).length))} queued task(s) stay in the task portfolio untouched. Nothing executes, and the queue's record remains in queue.json.</p>`, btn("Cancel", "close") + btn("Delete queue", `queue-delete-confirm:${escapeHtml(id)}`, "danger"));
      return;
    }
    if (value.startsWith("queue-delete-confirm:")) {
      const id = value.slice(21);
      close();
      try {
        await apiCommand(`queue archive ${id}`);
        selectedQueues.delete(id);
        await refresh(false);
        render();
      } catch (error) { popup("Queue delete failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); }
      return;
    }
    if (value.startsWith("queue-clear:")) {
      const id = value.slice(12);
      const queue = derived().queues.find((item) => item.id === id);
      const isDefault = id === "default";
      popup(`${isDefault ? "Reset default queue" : "Clear queue"}?`, `<p>Remove <b>${escapeHtml(String((queue?.items || []).length))}</b> task reference(s) from <b>${escapeHtml(queue?.label || id)}</b>.</p><p class="sub">Tasks are not deleted or changed, and no work starts. Add tasks back later from their editor.</p>`, btn("Cancel", "close") + btn(isDefault ? "Reset queue" : "Clear queue", `queue-clear-confirm:${id}`, "danger"));
      return;
    }
    if (value.startsWith("queue-clear-confirm:")) return mutation(`queue clear --queue ${value.slice(20)}`, "queues");
    if (value.startsWith("queue-detail:")) { const queue = derived().queues.find((item) => item.id === value.slice(13)); if (queue) queueDetail(queue); return; }
    if (value.startsWith("queue-actions:")) { const queue = derived().queues.find((item) => item.id === value.slice(14)); if (queue) queueActions(queue); return; }
    if (value.startsWith("plan-approve:") || value.startsWith("plan-queue:")) {
      const queueAfter = value.startsWith("plan-queue:");
      const id = value.slice(value.indexOf(":") + 1);
      try {
        const approved = await apiCommand(`plan approve ${id}`);
        await refresh(false);
        if (queueAfter) { selectedQueues.clear(); if (approved.queueId) selectedQueues.add(approved.queueId); page = "queues"; } else { page = "tasks"; }
        render();
        popup("Plan approved — Plan Queue created", `<p>Queue <b>${escapeHtml(approved.queueId || "(unknown)")}</b> now holds ${escapeHtml(String((approved.taskIds || []).length))} ordered canonical task(s).</p><p class="sub">Nothing is executing. Preview the queue and confirm a run explicitly when you want the overnight gate opened.</p>`, btn("Open Queues", "go:queues", "primary") + btn("Close", "close"));
      } catch (error) { popup("Plan approval failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); }
      return;
    }
    if (value === "newqueue") return popup("Create named queue", '<label class="label">Queue id</label><input class="input" id="queueId" placeholder="e.g. security"><label class="label" style="margin-top:12px">Display name</label><input class="input" id="queueName" placeholder="Security">', btn("Cancel", "close") + btn("Create", "savequeue", "primary"));
    if (value === "savequeue") { const id = $("#queueId")?.value.trim().toLowerCase(); const name = $("#queueName")?.value.trim() || id; if (id) await mutation(`queue create ${id} --name "${name.replaceAll('"', '\\"')}"`, "queues"); return; }
    if (value.startsWith("queue-use:")) return mutation(`queue use ${value.slice(10)}`, "queues");
    if (value.startsWith("queue-toggle:")) { const id = value.slice(13); const queue = derived().queues.find((item) => item.id === id); return mutation(`queue ${queue?.status === "paused" ? "resume" : "pause"} ${id}`, "queues"); }
    if (value.startsWith("queue:")) { queueFilter = decodeURIComponent(value.slice(6)); filter = "All"; page = "tasks"; render(); return; }
    if (value === "run-preview" || value.startsWith("run-preview:")) { const id = value.includes(":") ? value.slice(value.indexOf(":") + 1) : snapshot.queues?.active_queue; try { const result = await apiCommand(`launch --dry-run${id ? ` --queue ${id}` : ""}`); popup("Launch preview", `<div class="terminal">${escapeHtml((result.lines || []).join("\n"))}</div><div class="notice"><b>Nothing has started.</b><p>Confirm only after reviewing providers, blockers, order, and budget.</p></div>`, btn("Cancel", "close") + btn("Run this queue", `run-start:${id || ""}`, "primary")); } catch (error) { popup("Preview failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); } return; }
    if (value === "run-confirm" || value.startsWith("run-confirm:")) { const id = value.includes(":") ? value.slice(value.indexOf(":") + 1) : snapshot.queues?.active_queue; return action(`run-preview:${id || ""}`); }
    if (value === "run-preview-multi" || value === "run-confirm-multi") {
      const ids = [...selectedQueues];
      if (!ids.length) return popup("No queues selected", '<p class="sub">Tick at least one queue first — multi-queue runs share one budget and execute strictly sequentially in round-robin order.</p>', btn("Close", "close"));
      try {
        const response = await fetch("/api/run/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queueIds: ids }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "preview failed");
        const encoded = encodeURIComponent(JSON.stringify(ids));
        const actions = value === "run-confirm-multi" ? btn("Cancel", "close") + btn("Run selected queues", `run-start-multi:${encoded}`, "primary") : btn("Close", "close");
        popup(`Multi-queue preview · ${ids.length} queue(s)`, `<div class="terminal">${escapeHtml((result.lines || []).join("\n"))}</div><div class="notice"><b>Nothing has started.</b><p>Selected queues run round-robin under one shared budget, strictly sequential, global concurrency 1. Paused or unknown queues are skipped for this run.</p></div>`, actions);
      } catch (error) { popup("Preview failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); }
      return;
    }
    if (value.startsWith("run-start-multi:")) {
      let ids = [];
      try { ids = JSON.parse(decodeURIComponent(value.slice(16))); } catch { ids = []; }
      close();
      const response = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true, queueIds: ids }) });
      const result = await response.json();
      if (result.approvalRequired) return showRunApproval(result.proposal, `run-start-multi:${encodeURIComponent(JSON.stringify(ids))}`);
      if (!response.ok) return popup("Run refused", `<p class="red">${escapeHtml(result.error || "Run could not start")}</p>`, btn("Close", "close"));
      currentRun = result.run; page = "queues"; render();
      return;
    }
    if (value.startsWith("run-task:")) { const id = value.slice(9); try { const response = await fetch("/api/run/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskIds: [id] }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "preview failed"); popup(`Dispatch preview · ${escapeHtml(id)}`, `<div class="terminal">${escapeHtml((result.lines || []).join("\n"))}</div><div class="notice"><b>Nothing has started.</b><p>Confirming runs this task through its full lifecycle (60m overall / 8 sessions per task). Resume is available if the confirmed budget ends.</p></div>`, btn("Cancel", "close") + btn("Run this task", `run-task-confirm:${id}`, "primary")); } catch (error) { popup("Preview failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close")); } return; }
    if (value.startsWith("run-task-confirm:")) { const id = value.slice(17); close(); const response = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true, taskIds: [id], maxSessions: 8, maxMinutes: 60 }) }); const result = await response.json(); if (result.approvalRequired) return showRunApproval(result.proposal, `run-task-confirm:${id}`); if (!response.ok) return popup("Run refused", `<p class="red">${escapeHtml(result.error || "Run could not start")}</p>`, btn("Close", "close")); currentRun = result.run; page = "queues"; render(); return; }
    if (value.startsWith("run-start:")) { const id = value.slice(10) || snapshot.queues?.active_queue; close(); const response = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true, queueId: id }) }); const result = await response.json(); if (result.approvalRequired) return showRunApproval(result.proposal, `run-start:${id}`); if (!response.ok) return popup("Run refused", `<p class="red">${escapeHtml(result.error || "Run could not start")}</p>`, btn("Close", "close")); currentRun = result.run; page = "queues"; render(); return; }
    if (value === "run-stop") { const response = await fetch("/api/run/stop", { method: "POST" }); const result = await response.json(); if (!response.ok) return popup("Stop request", `<p>${escapeHtml(result.error || "No active run")}</p>`, btn("Close", "close")); currentRun = result.run; render(); return; }
    if (value.startsWith("agent:")) { const agent = derived().agents?.find((row) => row[0] === value.slice(6)); popup(`${value.slice(6)} / Agent brief`, `<p>Live role telemetry is shown in Agent Team and Activity & Logs.</p>`, btn("Logs", "go:activity") + btn("Close", "close")); return; }
    if (value === "export") { const blob = new Blob([(snapshot.state?.log_tail || []).map((item) => JSON.stringify(item)).join("\n")], { type: "application/jsonl" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "atl-activity.jsonl"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  }

  async function saveTask(id) {
    const title = $("#fTitle")?.value.trim();
    if (!title) return $("#fTitle")?.focus();
    const objective = $("#fDesc")?.value.trim() || title;
    const priority = $("#fPriority")?.value || "normal";
    const queueId = $("#fQueue")?.value;
    try {
      let taskId = id;
      if (taskId) {
        await apiCommand(`task edit ${taskId} --title "${title.replaceAll('"', '\\"')}" --objective "${objective.replaceAll('"', '\\"')}" --priority ${priority}`);
      } else {
        const created = await apiCommand(`task create --title "${title.replaceAll('"', '\\"')}" --priority ${priority}`);
        taskId = created.selectedTaskId;
        if (!taskId) throw new Error("task creation returned no task id");
        if (objective !== title) await apiCommand(`task edit ${taskId} --objective "${objective.replaceAll('"', '\\"')}"`);
      }
      if (queueId) await apiCommand(`queue add ${taskId} --queue ${queueId}`);
      filter = "All"; query = ""; queueFilter = "All";
      close(); await refresh(false); page = "tasks"; render();
    } catch (error) {
      popup("Task save failed", `<p class="red">${escapeHtml(error.message)}</p>`, btn("Close", "close"));
    }
  }

  function openPage(next) {
    page = next;
    render();
    // The Settings page renders live provider state — refresh it on arrival.
    if (next === "settings") void Promise.all([loadProviders(true), loadNavigation()]).then(() => { if (page === "settings" && !dialogOpen && !cardDraft) render(); }).catch((error) => { navigationNotice = `Error: ${error.message}`; if (page === "settings") render(); });
  }
  document.addEventListener("click", (event) => {
    const pageButton = event.target.closest("[data-page]");
    if (pageButton) { openPage(pageButton.dataset.page); return; }
    if (event.target.closest("[data-tsel]")) return;
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) { void action(actionButton.dataset.action); return; }
    const taskButton = event.target.closest("[data-task]");
    if (taskButton) { const task = derived().tasks.find((item) => item.id === taskButton.dataset.task); if (task) taskDetail(task); return; }
    const queueCard = event.target.closest("[data-queue]");
    if (queueCard && !event.target.closest("[data-qsel], [data-action]")) { const queue = derived().queues.find((item) => item.id === queueCard.dataset.queue); if (queue) queueDetail(queue); return; }
    if (event.target.id === "overlay") close();
  }, true);
  document.addEventListener("input", (event) => {
    if (event.target.id === "goal") {
      studioGoal = event.target.value;
      // A stale error from a previous click must not outlive the user's next
      // attempt: drop it the moment they start typing (no repaint — focus stays).
      if (studioNotice.startsWith("Error")) {
        studioNotice = "";
        studioErrorLog = null;
        document.querySelector("[data-studio-notice]")?.remove();
        document.querySelector("[data-studio-log-row]")?.remove();
      }
    }
    if (event.target.id === "providerModel") studioModel = event.target.value;
    if (event.target.closest(".provider-current") && (event.target.matches("[data-pm-current-model], [data-pm-current-label], [data-pm-current-thinking], [data-pm-current-url], [data-pm-current-key]"))) {
      const current = event.target.closest(".provider-current");
      const modelInput = current.querySelector("[data-pm-current-model]");
      const id = modelInput?.dataset.pmCurrentModel;
      const save = current.querySelector(`[data-pm-model-save="${id}"]`);
      const modelChanged = modelInput?.value.trim() !== (modelInput?.dataset.savedModel || "");
      const changed = modelChanged
        || [...current.querySelectorAll("[data-pm-current-label], [data-pm-current-thinking], [data-pm-current-url]")].some((input) => input.value !== (input.dataset.savedValue || ""))
        || Boolean(current.querySelector("[data-pm-current-key]")?.value.trim());
      if (save) {
        save.disabled = !changed;
        save.setAttribute("aria-disabled", String(!changed));
        save.classList.toggle("disabled", !changed);
        save.classList.toggle("primary", changed);
        save.classList.toggle("ghost", !changed);
        save.textContent = changed ? "Save connection" : "Saved";
      }
      const state = current.querySelector("[data-pm-model-state]");
      if (state) state.textContent = modelChanged ? "Unsaved model change" : changed ? "Unsaved connection change" : "Already saved in the provider connection.";
    }
    // The open card editor mirrors every keystroke into cardDraft so an
    // unexpected repaint can never drop in-progress edits.
    if (event.target.dataset?.pfield && cardDraft) cardDraft[event.target.dataset.pfield] = event.target.value;
    if (event.target.id === "paletteQ") $("#paletteItems").innerHTML = commandOptions(event.target.value);
    if (event.target.id === "taskSearch") { query = event.target.value; const cursor = event.target.selectionStart; render(); const input = $("#taskSearch"); input?.focus(); input?.setSelectionRange(cursor, cursor); }
    if (event.target.id === "activitySearch") { activityFilter = event.target.value; const cursor = event.target.selectionStart; render(); const input = $("#activitySearch"); input?.focus(); input?.setSelectionRange(cursor, cursor); }
  }, true);
  document.addEventListener("change", (event) => {
    if (event.target.id === "studioFiles") {
      const files = [...(event.target.files || [])].slice(0, 8);
      studioAttachments = files.map((file) => ({ name: file.name, type: file.type || "application/octet-stream", size: file.size, text: null, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null }));
      files.forEach((file, index) => {
        if (file.type.startsWith("text/") || /\.(md|json|ya?ml|csv|log)$/i.test(file.name)) {
          const reader = new FileReader();
          reader.onload = () => { if (studioAttachments[index]) studioAttachments[index].text = String(reader.result || ""); render(); };
          reader.readAsText(file.slice(0, 1024 * 1024));
        }
      });
      render();
      return;
    }
    if (event.target.dataset?.tsel) { if (event.target.checked) selectedTasks.add(event.target.dataset.tsel); else selectedTasks.delete(event.target.dataset.tsel); render(); return; }
    if (event.target.dataset?.projectSelect) { if (event.target.checked) selectedProjects.add(event.target.dataset.projectSelect); else selectedProjects.delete(event.target.dataset.projectSelect); return; }
    if (event.target.id === "queueSelect") { queueFilter = event.target.value; render(); return; }
    if (event.target.id === "providerSelect") {
      studioProvider = event.target.value;
      const selected = (studioProviders || []).find((provider) => provider.id === studioProvider);
      studioModel = selected?.model || selected?.models?.[0] || "";
      studioThinking = selected?.thinking_level || "";
      render();
      return;
    }
    if (event.target.id === "navigationMode") {
      const disabled = event.target.value === "off";
      const build = $("#navigationBuild");
      if (build) build.disabled = disabled;
      const label = build?.closest("label");
      if (label) label.style.opacity = disabled ? ".55" : "1";
      return;
    }
    if (event.target.id === "providerThinking") { studioThinking = event.target.value; return; }
    if (event.target.dataset?.qsel) { if (event.target.checked) selectedQueues.add(event.target.dataset.qsel); else selectedQueues.delete(event.target.dataset.qsel); render(); return; }
    if ("cardWorker" in (event.target.dataset || {}) && cardDraft) { cardDraft.worker = event.target.value; render(); return; }
    if (event.target.matches("[data-pm-template]")) {
      // Template chosen in the add form: prefill every editable capability.
      const template = (pmTemplates || []).find((entry) => entry.id === event.target.value);
      const urlInput = document.querySelector("[data-pm-url]");
      const modelInput = document.querySelector("[data-pm-model]");
      const labelInput = document.querySelector("[data-pm-label]");
      const workerInput = document.querySelector("[data-pm-worker]");
      const protocolInput = document.querySelector("[data-pm-protocol]");
      const thinkingInput = document.querySelector("[data-pm-thinking]");
      const modelList = document.querySelector("#pmModelOptions");
      if (urlInput) urlInput.value = template?.baseUrl?.[template?.worker || "codex"] || template?.baseUrl?.codex || template?.baseUrl?.claude || "";
      if (modelInput) modelInput.value = template?.models?.[0] || "";
      if (labelInput) labelInput.value = template?.label || "";
      if (workerInput) workerInput.value = template?.worker || "codex";
      if (protocolInput) protocolInput.value = template?.protocol || "custom";
      if (thinkingInput) thinkingInput.innerHTML = (template?.thinkingLevels?.length ? template.thinkingLevels : ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"]).map((level) => `<option value="${level === "default" ? "" : escapeHtml(level)}">${level === "default" ? "Provider default" : escapeHtml(level)}</option>`).join("");
      if (modelList) modelList.innerHTML = (template?.models || []).map((model) => `<option value="${escapeHtml(model)}">`).join("");
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.target.id === "cliInput" || event.target.id === "dockInput")) { const value = event.target.value; event.target.value = ""; void runCommand(value); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); palette(); return; }
    if (event.key === "Escape" && cardDraft) { closeCardEditor(); render(); return; }
    if (event.key === "Escape" && dialogOpen) { close(); return; }
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-queue]")) { event.preventDefault(); const queue = derived().queues.find((item) => item.id === event.target.dataset.queue); if (queue) queueDetail(queue); return; }
    if (event.target.matches("input,textarea,select") || event.altKey || event.ctrlKey || event.metaKey) return;
    if (cardDraft) return;
    if (event.key.toLowerCase() === "n") { taskForm(); return; }
    const number = Number(event.key); if (number >= 1 && number <= 9) { openPage(routes[number - 1][0]); }
  }, true);
  $("#searchBtn").onclick = () => palette();
  $("#newBtn").onclick = () => taskForm();
  $("#noticesBtn").onclick = () => popup("Notifications", (snapshot.notifications?.items || []).map((item) => `<div class="event">${badge(item.severity || "INFO")} ${escapeHtml(item.title || item.detail || item.id)}</div>`).join("") || '<p class="muted">No notifications are due.</p>', btn("Close", "close"));

  void Promise.all([refresh(false), refreshRun(false), loadProviders(true), ...(page === "settings" ? [loadNavigation()] : [])]).then(() => {
    render();
    connectStream();
    setInterval(() => { void refresh(); void refreshRun(); }, 2000);
  });
})();
