(() => {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const views = new Map();
  const reviewTabs = ["overview", "files", "evidence", "relationships", "statechart"];
  let generation = 0;
  const tr = (text) => document.documentElement.lang.startsWith("fa") ? window.ATL_I18N?.translateText(text) || text : text;
  const label = (text) => esc(tr(text));
  const button = (text, action, extra = "") => `<button type="button" class="btn sm" data-review-action="${esc(action)}" ${extra}>${label(text)}</button>`;
  const code = (text) => `<bdi dir="ltr" class="review-path">${esc(text)}</bdi>`;
  async function request(url, init = {}) {
    const response = await fetch(url, { ...init, cache: "no-store", headers: { "content-type": "application/json", "x-atl-csrf": document.querySelector('meta[name="atl-csrf"]')?.content || "", ...init.headers } });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error || "Inspection unavailable"), { availability: value.availability });
    return value;
  }
  function fileTree(files, state, prefix = "") {
    const directories = new Map(), leaves = [];
    for (const file of files) {
      const rest = file.path.slice(prefix.length), slash = rest.indexOf("/");
      if (slash < 0) leaves.push(file);
      else { const directory = prefix + rest.slice(0, slash + 1); if (!directories.has(directory)) directories.set(directory, []); directories.get(directory).push(file); }
    }
    return [...directories].map(([directory, children]) => `<details data-review-directory="${esc(directory)}" ${state.expanded.has(directory) || state.query ? "open" : ""}><summary>${code(directory.slice(prefix.length))} <span class="muted">${children.length}</span></summary>${fileTree(children, state, directory)}</details>`).join("") + leaves.map((file) => `<button type="button" class="review-file ${state.fileId === file.id ? "selected" : ""}" data-review-action="file:${file.id}" aria-pressed="${state.fileId === file.id}"><span class="pill">${label(file.kind)}</span>${code(file.path.slice(prefix.length))}</button>`).join("");
  }
  function diffMarkup(state) {
    const file = state.data.files.find((entry) => entry.id === state.fileId);
    if (!file) return `<p class="muted">${label("Select a file to load its diff.")}</p>`;
    const diff = state.diffs.get(file.id);
    if (!diff) return `<p role="status">${label("Loading diff…")}</p>`;
    const patch = diff.patch ? `<pre class="review-diff" dir="ltr" data-no-translate>${diff.patch.split("\n").map((line) => `<span class="${line.startsWith("+") && !line.startsWith("+++") ? "review-add" : line.startsWith("-") && !line.startsWith("---") ? "review-delete" : line.startsWith("@@") ? "review-hunk" : ""}">${esc(line)}\n</span>`).join("")}</pre>` : `<p role="status">${label(diff.availability || "unavailable")}${diff.message ? ` · ${esc(diff.message)}` : ""}</p>`;
    return `<h3>${code(file.path)}</h3><p>${label(file.kind)} · ${label("Preview")}: ${label(diff.availability)}${diff.additions != null ? ` · +${diff.additions} / −${diff.deletions}` : ""}</p>${diff.mode_change ? `<p>${label("File mode")}: ${code(file.before_mode || "—")} → ${code(file.after_mode || "—")}</p>` : ""}${patch}<p class="muted tiny">${label("Task-level evidence does not prove coverage of this file.")}</p>`;
  }
  function evidenceMarkup(state) {
    const entries = state.data.evidence || [];
    return `<p class="sub">${label("Evidence is matched by both packet and content revision.")}</p>${entries.map((entry) => {
      const freshness = entry.freshness === "unknown" ? "Revision link missing" : entry.freshness;
      const missing = [!entry.code_revision && "code revision", entry.packet_revision == null && "packet revision"].filter(Boolean).map(label).join(", ");
      const explanation = entry.freshness === "unknown" ? `<p class="muted tiny">${label("Cannot match this record to the captured change. Missing:")} ${missing || label("revision information")}.</p>` : entry.freshness === "stale" && entry.revision_match ? `<p class="muted tiny">${entry.revision_match.packet === "different" ? `${label("Task packet revision differs from this capture.")} ` : ""}${entry.revision_match.code === "different" ? `${label("Code revision differs from this capture.")} ` : ""}${missing ? `${label("Not recorded")}: ${missing}.` : ""}</p>` : "";
      return `<details class="review-evidence" id="${esc(entry.id)}"><summary><span class="pill ${entry.freshness === "current" ? "blue" : "amber"}">${label(freshness)}</span> ${esc(entry.kind)}${entry.actor ? ` · ${esc(entry.actor)}` : ""}${entry.result ? ` · ${label("Result")}: ${esc(entry.result)}` : ""}${entry.coverage ? ` · ${label("Coverage")}: ${esc(entry.coverage)}` : ""}</summary>${explanation}<p dir="auto">${esc(entry.check || entry.detail || entry.note || "")}</p><pre dir="ltr" data-no-translate>${esc(JSON.stringify(entry, null, 2))}</pre></details>`;
    }).join("") || `<p>${label("No evidence recorded.")}</p>`}`;
  }
  function deliveryMarkup(d) {
    const delivery = d.delivery;
    if (!delivery?.receipt) return `<section class="review-receipt"><h3>${label("Delivery receipt")}</h3><p class="muted">${label("No current receipt. Capture the workspace again to bind evidence to its output revision.")}</p></section>`;
    const receipt = delivery.receipt, verdict = delivery.verdict || {};
    const short = (value) => value ? `<code class="review-path">${esc(String(value).slice(0, 12))}</code>` : `<span class="muted">${label("unknown")}</span>`;
    const cell = (value) => value ? esc(value) : `<span class="muted">${label("none")}</span>`;
    const table = (caption, headings, rows) => `<div class="review-table-wrap"><table class="review-table"><caption>${label(caption)}</caption><thead><tr>${headings.map((heading) => `<th scope="col">${label(heading)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headings.length}" class="muted">${label("None recorded.")}</td></tr>`}</tbody></table></div>`;
    const checks = (receipt.checks || []).map((check) => {
      const current = check.result === "pass" && check.coverage === "complete" && check.content_revision && check.content_revision === verdict.content_revision;
      return `<tr><td>${code(check.id)}</td><td>${cell(check.result || "missing")}</td><td>${cell(check.coverage || "missing")}</td><td>${current ? label("current") : label("stale or incomplete")}</td><td>${cell(check.verified_by || "unknown")}</td><td>${cell(check.command)}</td></tr>`;
    }).join("");
    const findings = (receipt.findings || []).map((finding) => {
      const blocking = finding.blocking === true || ["blocker", "critical", "major"].includes(String(finding.severity || "").toLowerCase());
      return `<tr><td>${code(finding.id)}</td><td>${cell(finding.severity)}</td><td>${cell(finding.status || "open")}</td><td>${blocking ? label("blocking") : label("non-blocking")}</td><td>${finding.path ? code(finding.path) : cell(null)}</td><td>${finding.recheck?.check ? `${code(finding.recheck.check)} ${label("at")} ${short(finding.recheck.content_revision)}` : cell(null)}</td></tr>`;
    }).join("");
    const changes = (receipt.changes || []).map((change) => `<tr><td>${code(change.path)}</td><td>${cell(change.status || "unknown")}</td><td>${cell(change.before)}</td><td>${cell(change.after)}</td></tr>`).join("");
    const artifacts = (receipt.artifacts || []).map((artifact) => `<tr><td>${code(artifact.id)}</td><td>${cell(artifact.kind)}</td><td>${artifact.path ? code(artifact.path) : cell(null)}</td><td><span class="pill">${label(artifact.availability || "unknown")}</span></td><td>${cell(artifact.attribution || "unattributed")}</td><td>${cell(artifact.command)}</td></tr>`).join("");
    const decisions = (receipt.decisions || []).map((decision) => typeof decision === "string"
      ? `<li dir="auto">${esc(decision)}</li>`
      : `<li dir="auto"><b>${esc(decision.id || decision.finding_id || "decision")}</b> · ${esc(decision.outcome || decision.status || "recorded")} · ${esc(decision.authorized_by || "unauthorized")} · ${esc(decision.reason || "no reason")}</li>`).join("");
    const missing = (verdict.missing_checks || []).map((check) => `<li>${code(check)}</li>`).join("");
    const limitations = [];
    if (receipt.visual_change === true && receipt.host?.capabilities?.visual_observation !== true) limitations.push(label("Visual change without declared visual observation."));
    if (receipt.visual_change === true && !(receipt.artifacts || []).some((artifact) => artifact.kind === "visual-capture" && !["unavailable", "missing", "unknown"].includes(artifact.availability))) limitations.push(label("No linked capture of the observed behavior."));
    if (receipt.usage?.coverage !== "measured") limitations.push(label("Token usage is not measured for this record."));
    if (receipt.claimed_verdict && receipt.claimed_verdict !== verdict.status) limitations.push(`${label("Claimed verdict")} ${esc(receipt.claimed_verdict)} ${label("does not match the evaluated verdict")}.`);
    return `<section class="review-receipt" data-delivery-verdict="${esc(verdict.status || "unknown")}">
      <h3>${label("Delivery receipt")}</h3>
      <p>${label("Verdict")}: <span class="pill" data-delivery-status="${esc(verdict.status || "unknown")}">${label(verdict.status || "unknown")}</span> · ${label("Content revision")}: ${short(verdict.content_revision)}</p>
      <p class="sub">${label("Evaluation is deterministic. Local verification only; no PR, merge, deployment or remote write is implied.")}</p>
      ${verdict.reason ? `<div class="notice"><b>${label("Reason")}</b><p dir="auto">${esc(verdict.reason)}</p></div>` : ""}
      ${missing ? `<div class="notice"><b>${label("Missing current checks")}</b><ul>${missing}</ul></div>` : ""}
      ${table("Acceptance checks", ["Check", "Result", "Coverage", "Freshness", "Verified by", "Command"], checks)}
      ${table("Changed files", ["Path", "Status", "Before", "After"], changes)}
      ${table("Findings", ["ID", "Severity", "Status", "Blocking", "Affected path", "Recheck"], findings)}
      ${table("Artifacts", ["ID", "Kind", "Path", "Availability", "Attribution", "Command"], artifacts)}
      <h4>${label("Decisions")}</h4>${decisions ? `<ul>${decisions}</ul>` : `<p class="muted">${label("None recorded.")}</p>`}
      <p class="sub">${label("Host capabilities")}: ${label("execution")}=${receipt.host?.capabilities?.execution === true ? label("yes") : label("no")} · ${label("independent review")}=${receipt.host?.capabilities?.independent_review === true ? label("yes") : label("no")} · ${label("visual observation")}=${receipt.host?.capabilities?.visual_observation === true ? label("yes") : label("no")} · ${label("budget enforcement")}=${receipt.host?.capabilities?.budget_enforcement === true ? label("yes") : label("no")}</p>
      <p class="sub">${label("Usage coverage")}: ${cell(receipt.usage?.coverage || "unknown")}</p>
      ${limitations.length ? `<div class="notice"><b>${label("Limitations")}</b><ul>${limitations.map((item) => `<li>${item}</li>`).join("")}</ul></div>` : ""}
    </section>`;
  }
  function nodes(state) {
    const d = state.data;
    return [{ id: d.task_id, kind: "Task", value: { id: d.task_id, status: d.status } }, { id: d.id, kind: "Change set", value: { id: d.id, packet_revision: d.packet_revision, source_kind: d.source_kind, input_revisions: d.input_revisions } }, { id: d.baseline_revision, kind: "Baseline", value: { revision: d.baseline_revision } }, { id: d.output_revision, kind: "Output", value: { revision: d.output_revision } }, ...(d.run_id ? [{ id: d.run_id, kind: "Run", value: { id: d.run_id } }] : []), ...d.files.map((file) => ({ id: file.id, kind: "File", text: file.path, value: file })), ...(d.evidence || []).map((entry) => ({ id: entry.id, kind: "Evidence", value: entry })), ...(d.artifacts || []).map((entry) => ({ id: entry.id, kind: "Artifact", value: entry }))];
  }
  function relationshipMarkup(state) {
    const list = nodes(state), selected = list.find((node) => `${node.kind}:${node.id}` === state.nodeId);
    const nodeButton = (index, description) => { const node = list[index], active = node === selected; return `<button type="button" class="review-model-node${active ? " selected" : ""}" data-review-action="node:${esc(node.kind)}:${esc(node.id)}" aria-pressed="${active}"><strong>${label(node.kind)}</strong><span>${label(description)}</span></button>`; };
    const model = `<div class="review-model-task">${nodeButton(0, "The work being reviewed")}</div><p class="review-model-caption">${label("This task has a captured change set:")}</p><div class="review-model-flow">${nodeButton(2, "Starting point before changes")}<span class="review-model-arrow" aria-hidden="true">→</span>${nodeButton(1, "The captured comparison")}<span class="review-model-arrow" aria-hidden="true">→</span>${nodeButton(3, "Result after changes")}</div>`;
    return `<p class="sub">${label("Follow the changes from the starting point to the result. Select a card to inspect its recorded data.")}</p><div class="review-model" aria-label="${label("Task data model")}">${model}</div>${selected ? `<section class="review-selection" aria-live="polite"><h3>${label(selected.kind)} · ${label("Recorded data")}</h3><pre class="review-record" dir="ltr" data-no-translate>${esc(JSON.stringify(selected.value, null, 2))}</pre></section>` : ""}<p class="muted tiny">${label("Run link")}: ${state.data.run_id ? code(state.data.run_id) : label("Not recorded")} · ${label("Structured decisions")}: ${label("Not recorded")}</p><details class="review-relationships"><summary>${label("Recorded relationships")} <span class="muted">(${list.length})</span></summary><div class="review-table-wrap"><table class="review-table"><thead><tr><th>${label("Record")}</th><th>${label("Identifier")}</th><th>${label("Inspect")}</th></tr></thead><tbody>${list.map((node) => `<tr><td>${label(node.kind)}</td><td>${code(node.text || node.id)}</td><td>${button("Inspect", `node:${node.kind}:${node.id}`)}</td></tr>`).join("")}</tbody></table></div></details><p class="muted tiny">${label("Context knowledge is advisory and cannot approve this change.")}</p>`;
  }
  function statechartMarkup(state) {
    const chart = state.data?.statechart;
    if (!chart) return `<p role="status">${label("Statechart unavailable. Refresh with a compatible server.")}</p>`;
    const words = (value) => String(value).replaceAll("_", " ");
    const steps = Array.isArray(chart.steps) && chart.steps.length ? chart.steps : [{ state: chart.current, gap_before: false, snapshot: true }];
    const height = Math.max(100, steps.length * 94);
    const legacyContract = !Array.isArray(chart.steps) && Array.isArray(chart.transitions) && chart.transitions.some((edge) => Array.isArray(edge.actors));
    const recordedTransitions = legacyContract ? [] : (chart.transitions || []);
    const workflowTransitions = chart.workflow_transitions || (legacyContract ? chart.transitions : []);
    const hasWorkflowMap = workflowTransitions.length > 0;
    const contractStates = hasWorkflowMap ? (chart.workflow_states || [...new Set(workflowTransitions.flatMap((edge) => [edge.from, edge.to]))]) : [];
    const contractPositions = { new: [24, 36], triaged: [174, 36], assigned: [324, 36], in_progress: [474, 36], in_review: [474, 142], verifying: [324, 142], done: [174, 142], blocked: [24, 142], rejected: [24, 248], escalated: [174, 248], archived: [324, 248] };
    const contractNodes = contractStates.map((name, index) => {
      const [x, y] = contractPositions[name] || [42 + (index % 6) * 150, 330 + Math.floor(index / 6) * 120];
      const current = name === chart.current;
      return '<g><rect x="' + x + '" y="' + y + '" width="120" height="52" rx="9" class="review-statechart-node ' + (current ? 'is-current' : 'is-allowed') + '"/><text x="' + (x + 60) + '" y="' + (y + 21) + '" class="review-statechart-name">' + esc(words(name)) + '</text><text x="' + (x + 60) + '" y="' + (y + 39) + '" class="review-statechart-step">' + (current ? label("CURRENT") : label("ALLOWED")) + '</text></g>';
    }).join('');
    const contractEdges = hasWorkflowMap ? workflowTransitions.map((edge) => {
      const from = contractPositions[edge.from] || [42, 330], to = contractPositions[edge.to] || [192, 330];
      const sx = from[0] + 120, sy = from[1] + 26, tx = to[0], ty = to[1] + 26, mid = Math.round((sx + tx) / 2);
      return '<path class="review-statechart-edge" d="M' + sx + ' ' + sy + ' C' + mid + ' ' + sy + ' ' + mid + ' ' + ty + ' ' + tx + ' ' + ty + '" marker-end="url(#stateArrow)"/>';
    }).join('') : '';
    const contractDiagram = '<div class="review-statechart-svg-wrap"><svg class="review-statechart-svg review-statechart-contract" viewBox="0 0 650 320" role="img" aria-label="' + label("Complete task lifecycle workflow map") + '" dir="ltr"><title>' + label("Complete task lifecycle workflow map") + '</title><defs><marker id="legacyArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="currentColor"/></marker></defs>' + contractEdges.replaceAll('url(#stateArrow)', 'url(#legacyArrow)') + contractNodes + '</svg></div>';
    const diagram = `<svg viewBox="0 0 540 ${height}" role="img" aria-label="${label("Recorded task flow")}" class="review-statechart-svg" style="width:100%;max-width:720px;color:var(--text);display:block" dir="ltr"><title>${label("Recorded task flow")}</title>${steps.map((step, index) => {
      const y = index * 94 + 12, current = index === steps.length - 1;
      return `${index ? `<path d="M 150 ${y - 42} V ${y - 5}" fill="none" stroke="currentColor" ${step.gap_before ? 'stroke-dasharray="4 4"' : ""}/><path d="m 145 ${y - 10} l 5 5 l 5 -5" fill="none" stroke="currentColor"/>${step.gap_before ? `<text x="170" y="${y - 16}" fill="currentColor" font-size="12">${label("History gap")}</text>` : ""}` : ""}<rect x="20" y="${y}" width="260" height="44" rx="8" fill="none" stroke="${current ? "var(--accent, #07856c)" : "currentColor"}" stroke-width="${current ? 3 : 1}"/><text x="150" y="${y + 27}" fill="currentColor" text-anchor="middle" font-size="14">${index + 1}. ${esc(words(step.state))}</text><text x="300" y="${y + 18}" fill="currentColor" font-size="12">${esc(step.actor || "")}</text><text x="300" y="${y + 36}" fill="currentColor" font-size="11">${esc(step.at || "")}</text>`;
    }).join("")}</svg>`;
    const inspector = '<aside class="review-statechart-inspector"><div class="review-statechart-inspector-head"><span>' + label("Selected current state") + '</span><strong>' + esc(words(chart.current)) + '</strong></div><dl><dt>' + label(hasWorkflowMap ? "Allowed workflow transitions" : "Recorded transitions") + '</dt><dd>' + (hasWorkflowMap ? workflowTransitions.length : recordedTransitions.length) + '</dd><dt>' + label("Last actor") + '</dt><dd>' + esc(recordedTransitions.at(-1)?.actor || tr("Not recorded")) + '</dd><dt>' + label("Last transition") + '</dt><dd>' + esc(recordedTransitions.at(-1)?.at || tr("Not recorded")) + '</dd><dt>' + label("Last note") + '</dt><dd dir="auto">' + esc(recordedTransitions.at(-1)?.detail || tr("No transition note")) + '</dd></dl>' + (state.data.blocker?.reason ? '<div class="notice"><b>' + label("Blocker") + '</b><p>' + esc(state.data.blocker.reason) + '</p></div>' : '') + '</aside>';
    return `<h3>${label("Task statechart & flows")}</h3><p><span class="pill blue">${label(recordedTransitions.length ? "Full workflow and recorded path" : "Full workflow - no recorded path")}</span> ${label("Current state")}: <strong>${esc(words(chart.current))}</strong></p><p class="sub">${label("Task flow shows recorded task transitions when available; otherwise it shows the complete permitted workflow graph.")}</p><p class="muted tiny">${label(recordedTransitions.length ? "The map shows all allowed transitions; the highlighted path below comes from retained task events." : "The map shows all allowed transitions. No task transition events are available for this task.")}</p><div class="review-statechart-layout"><div class="review-statechart-canvas"><div class="review-statechart-canvas-head">${label("Complete lifecycle - allowed transitions")}</div>${hasWorkflowMap ? contractDiagram : diagram}${recordedTransitions.length ? `<div class="review-statechart-path-head">${label("Recorded task path")}</div>${diagram}` : ""}</div>${inspector}</div>${(recordedTransitions.length) ? `<div class="review-table-wrap"><table class="review-table"><thead><tr><th>${label("Transition")}</th><th>${label("Time")}</th><th>${label("Actor")}</th><th>${label("Note")}</th></tr></thead><tbody>${recordedTransitions.map((edge) => `<tr><td>${esc(words(edge.from))} &rarr; ${esc(words(edge.to))}</td><td>${esc(edge.at || tr("Not recorded"))}</td><td>${esc(edge.actor || tr("Not recorded"))}</td><td dir="auto">${esc(edge.detail)}</td></tr>`).join("")}</tbody></table></div>` : `<p>${label("Current state is known; no transition history is available to show as a recorded path.")}</p>`}<details><summary>${label("Full workflow Mermaid source (stateDiagram-v2)")}</summary><pre dir="ltr" data-no-translate style="white-space:pre-wrap">${esc(chart.workflow_mermaid || chart.mermaid)}</pre></details>${recordedTransitions.length ? `<details><summary>${label("Recorded path Mermaid source")}</summary><pre dir="ltr" data-no-translate style="white-space:pre-wrap">${esc(chart.mermaid)}</pre></details>` : ""}`;
  }
  async function open(task, host, initialTab = null) {
    const token = ++generation;
    const state = views.get(task.id) || { tab: "overview", query: "", filter: "all", expanded: new Set(), diffs: new Map(), scrolls: new Map(), fileId: null, nodeId: null, data: null };
    if (initialTab) state.tab = initialTab;
    views.set(task.id, state);
    const focusReturn = document.activeElement;
    host.popupWide(`${esc(task.id)} / ${label("Review changes")}`, '<div id="taskChangeReview" class="task-change-review" aria-live="polite"></div>', host.btn("Back to task", `task-detail:${task.id}`) + host.btn("Close", "close"));
    const mount = document.querySelector("#taskChangeReview"), dialog = mount.closest(".dialog");
    dialog.classList.add("review-dialog"); dialog.setAttribute("aria-label", tr("Review changes"));
    const active = () => generation === token && mount.isConnected;
    let busy = false, error = "", focusFile = 0;
    function render() {
      if (!active()) return;
      const scrolls = [...mount.querySelectorAll("[data-review-scroll]")].map((node) => [node.dataset.reviewScroll, node.scrollTop, node.scrollLeft]);
      for (const [key, top, left] of scrolls) state.scrolls.set(key, [top, left]);
      const dialogBody = mount.closest(".dialogbody"), dialogScroll = dialogBody?.scrollTop;
      const focused = mount.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused?.getAttribute("data-review-action") || focused?.id;
      const selection = focused?.selectionStart;
      const d = state.data, ready = Boolean(d?.id);
      let body = `<p role="status">${label("Loading changes…")}</p>`;
      if (d && !ready) body = `<div class="notice"><b>${label(d.availability)}</b><p>${esc(d.message || "")}</p></div>`;
      if (d && !ready && state.tab === "statechart") body = statechartMarkup(state);
      if (ready) {
        const tabs = reviewTabs;
        const header = `<div class="bar"><span class="pill">${label(d.status)}</span><span>${label("Captured")}: ${esc(new Date(d.captured_at).toLocaleString())}</span></div><p class="review-revisions">${label("Baseline")}: ${code(d.baseline_revision)}<br>${label("Output")}: ${code(d.output_revision)}</p><p class="sub">${label("Captured revisions stay pinned. Capture again to inspect newer source.")}</p><label>${label("Captured revision")} <select id="reviewRevision" class="input">${(d.revisions || []).map((revision) => `<option value="${revision.id}" ${revision.id === d.id ? "selected" : ""}>${esc(revision.captured_at)} · ${esc(revision.output_revision.slice(0, 12))}</option>`).join("")}</select></label><div class="bar review-tabs" role="tablist" aria-label="${label("Review sections")}">${tabs.map((tab) => button(tab[0].toUpperCase() + tab.slice(1), `tab:${tab}`, `role="tab" aria-selected="${state.tab === tab}" aria-controls="reviewPanel" id="reviewTab-${tab}" tabindex="${state.tab === tab ? 0 : -1}"`)).join("")}</div>`;
        let panel;
        if (state.tab === "files") {
          const files = d.files.filter((file) => file.path.toLowerCase().includes(state.query.toLowerCase()) && (state.filter === "all" || file.kind === state.filter));
          panel = `<div class="review-files"><aside aria-label="${label("Changed files")}"><label for="reviewSearch">${label("Search paths")}</label><input class="input" id="reviewSearch" value="${esc(state.query)}" dir="auto"><label for="reviewFilter">${label("Change type")}</label><select class="input" id="reviewFilter">${["all", "added", "modified", "deleted", "mode_changed"].map((kind) => `<option value="${kind}" ${state.filter === kind ? "selected" : ""}>${label(kind)}</option>`).join("")}</select><p class="muted tiny">${d.files.length} / ${d.total_files} ${label("files loaded")}</p><div class="review-tree" data-review-scroll="tree">${fileTree(files, state) || `<p>${label("No matching files in loaded page.")}</p>`}</div>${d.next_cursor != null ? button("Load more files", "more", busy ? "disabled" : "") : ""}</aside><section class="review-patch" aria-label="${label("File diff")}" data-review-scroll="patch">${diffMarkup(state)}</section></div>`;
        } else if (state.tab === "evidence") panel = evidenceMarkup(state);
        else if (state.tab === "relationships") panel = relationshipMarkup(state);
        else if (state.tab === "statechart") panel = statechartMarkup(state);
        else panel = `<h3 dir="auto">${esc(d.title || task.title || "")}</h3><p dir="auto">${esc(d.objective || "")}</p>${d.summary ? `<p dir="auto">${esc(d.summary)}</p>` : ""}${deliveryMarkup(d)}<h3>${label("Attention required")}</h3>${(d.attention || []).map((item) => `<div class="notice"><b>${label(item.code)}</b><p dir="auto">${esc(item.reason)}</p></div>`).join("") || `<p>${label("No recorded attention flags. This is not delivery approval.")}</p>`}<p>${label("Changed files")}: ${d.total_files} · ${label("Line totals")}: ${label("unknown; load a file diff")}</p><p>${label("Source")}: ${esc(d.source_kind)} · ${label("Packet revision")}: ${d.packet_revision}</p>${Object.keys(d.input_revisions || {}).length ? `<h3>${label("Imported input revisions")}</h3><pre dir="ltr" data-no-translate>${esc(JSON.stringify(d.input_revisions, null, 2))}</pre>` : ""}`;
        body = header + `<div id="reviewPanel" role="tabpanel" aria-labelledby="reviewTab-${state.tab}" tabindex="0">${panel}</div>`;
      }
      mount.innerHTML = `<div class="bar">${button("Refresh evidence", "refresh", busy ? "disabled" : "")}${button("Capture current changes", "capture", busy || d?.availability === "baseline_missing" ? "disabled" : "")}${!ready ? button("Statechart", "tab:statechart") + button("Overview", "tab:overview") : ""}</div><p class="muted tiny">${label("Capture stores source for inspection. It does not start a worker or approve delivery.")}</p>${busy ? `<p role="status">${label("Loading changes…")}</p>` : ""}${error ? `<p class="red" role="alert">${esc(error)}</p>` : ""}${body}`;
      for (const [key, [top, left]] of state.scrolls) { const node = mount.querySelector(`[data-review-scroll="${key}"]`); if (node) { node.scrollTop = top; node.scrollLeft = left; } }
      if (dialogBody && dialogScroll != null) dialogBody.scrollTop = dialogScroll;
      if (focusKey) {
        const node = [...mount.querySelectorAll("[data-review-action],input,select")].find((element) => (element.getAttribute("data-review-action") || element.id) === focusKey);
        node?.focus({ preventScroll: true });
        if (typeof selection === "number" && node?.setSelectionRange) node.setSelectionRange(selection, selection);
      }
    }
    async function load({ capture = false, id = state.data?.id, more = false } = {}) {
      if (busy) return;
      busy = true; error = ""; render();
      try {
        const params = new URLSearchParams({ taskId: task.id });
        if (id) params.set("changeSetId", id);
        if (more) params.set("cursor", state.data.next_cursor);
        const d = capture ? await request("/api/task-changes/capture", { method: "POST", body: JSON.stringify({ task_id: task.id }) }) : await request(`/api/task-changes?${params}`);
        if (!active()) return;
        if (more) d.files = [...(state.data?.files || []), ...(d.files || [])];
        else if (d.id && d.id === state.data?.id && (state.data.files || []).length > (d.files || []).length) { d.files = state.data.files; d.next_cursor = state.data.next_cursor; }
        if (d.id !== state.data?.id) { state.diffs.clear(); state.fileId = null; }
        state.data = d;
      } catch (failure) { if (active()) error = failure.message; }
      finally { busy = false; render(); }
    }
    async function selectFile(id) {
      const requestId = ++focusFile; state.fileId = id; state.tab = "files"; render();
      if (state.diffs.has(id)) return;
      try {
        const pinned = state.data.id;
        const d = await request(`/api/task-change-diff?${new URLSearchParams({ taskId: task.id, changeSetId: pinned, fileId: id })}`);
        if (!active() || state.data.id !== pinned) return;
        state.diffs.set(id, d);
      } catch (failure) { if (active()) state.diffs.set(id, { availability: "unavailable", message: failure.message }); }
      if (requestId === focusFile) render();
    }
    mount.addEventListener("click", (event) => {
      const action = event.target.closest("[data-review-action]")?.dataset.reviewAction;
      if (!action) return;
      if (action.startsWith("tab:")) { state.tab = action.slice(4); render(); }
      else if (action.startsWith("file:")) void selectFile(action.slice(5));
      else if (action.startsWith("node:")) { state.nodeId = action.slice(5); const node = nodes(state).find((entry) => `${entry.kind}:${entry.id}` === state.nodeId); if (node?.kind === "File") void selectFile(node.id); else if (node?.kind === "Evidence") { state.tab = "evidence"; render(); const entry = document.getElementById(node.id); if (entry) { entry.open = true; entry.querySelector("summary")?.focus(); } } else render(); }
      else if (action === "capture") void load({ capture: true });
      else if (action === "refresh") void load();
      else if (action === "more") void load({ more: true });
    });
    mount.addEventListener("input", (event) => { if (event.target.id === "reviewSearch") { state.query = event.target.value; render(); } });
    mount.addEventListener("change", (event) => { if (event.target.id === "reviewFilter") { state.filter = event.target.value; render(); } if (event.target.id === "reviewRevision") void load({ id: event.target.value }); });
    mount.addEventListener("toggle", (event) => { const key = event.target.dataset.reviewDirectory; if (key) { if (event.target.open) state.expanded.add(key); else state.expanded.delete(key); } }, true);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { generation++; setTimeout(() => focusReturn?.isConnected && focusReturn.focus(), 0); }
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && event.target.getAttribute("role") === "tab") {
        event.preventDefault(); event.stopPropagation(); const tabs = reviewTabs, index = tabs.indexOf(state.tab);
        state.tab = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; render(); mount.querySelector('[aria-selected="true"]')?.focus();
      }
      if (event.key === "Tab") {
        const focusable = [...dialog.querySelectorAll("button:not(:disabled), input, select, summary, [tabindex='0']")].filter((node) => node.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    render(); await load(); if (active()) mount.querySelector("button")?.focus();
  }
  window.ATL_CHANGE_REVIEW = Object.freeze({ open });
})();
