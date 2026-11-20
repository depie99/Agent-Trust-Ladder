(() => {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const views = new Map();
  const reviewTabs = ["overview", "files", "evidence", "relationships"];
  let generation = 0;
  // translateText's locale argument defaults to en-US; the DOM pass passes
  // "fa-IR" explicitly, and the review controller must do the same or every
  // label() renders English inside the fa UI.
  const tr = (text) => document.documentElement.lang.startsWith("fa") ? window.ATL_I18N?.translateText?.(text, window.ATL_I18N?.locale || "fa-IR") || text : text;
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
  function highlightCode(text, filePath) {
    const source = String(text || " ");
    if (!/\.(?:[cm]?[jt]sx?|json|css|scss|html|xml|ya?ml|sh|py|rs|go)$/i.test(filePath)) return esc(source);
    return esc(source).replace(/\b(?:const|let|var|function|return|if|else|class|new|async|await|export|import|from|throw|try|catch|true|false|null|undefined|public|private|static)\b/g, (word) => `<span class="syntax-keyword">${word}</span>`).replace(/\b\d+(?:\.\d+)?\b/g, (word) => `<span class="syntax-number">${word}</span>`);
  }
  function splitPatchMarkup(patch, filePath = "") {
    let oldNo = 0, newNo = 0; const blocks = [];
    const left = (number, text, type) => `<div class="split-line ${type}"><span>${number || ""}</span><code>${highlightCode(text, filePath)}</code>${number ? `<button type="button" data-review-action="comment-at:old:${number}" aria-label="${label(`Comment on old line ${number}`)}">＋</button>` : ""}</div>`;
    const right = (number, text, type) => `<div class="split-line ${type}"><span>${number || ""}</span><code>${highlightCode(text, filePath)}</code>${number ? `<button type="button" data-review-action="comment-at:new:${number}" aria-label="${label(`Comment on new line ${number}`)}">＋</button>` : ""}</div>`;
    const rows = patch.split("\n").filter((line) => !/^(diff --git|index |--- |\+\+\+ )/.test(line));
    for (let index = 0; index < rows.length;) {
      const line = rows[index++];
      if (line.startsWith("@@")) { const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line); if (match) { oldNo = Number(match[1]); newNo = Number(match[2]); } blocks.push(`<div class="split-hunk">${esc(line)}</div>`); continue; }
      if (line.startsWith(" ")) { blocks.push(left(oldNo++, line.slice(1), "ctx") + right(newNo++, line.slice(1), "ctx")); continue; }
      const deleted = [], added = [];
      const take = (row) => { if (row.startsWith("-")) deleted.push({ line: oldNo++, text: row.slice(1) }); else if (row.startsWith("+")) added.push({ line: newNo++, text: row.slice(1) }); };
      take(line);
      while (index < rows.length && (rows[index].startsWith("-") || rows[index].startsWith("+"))) take(rows[index++]);
      for (let offset = 0; offset < Math.max(deleted.length, added.length); offset++) { const before = deleted[offset], after = added[offset]; blocks.push(left(before?.line, before?.text, before ? "del" : "empty") + right(after?.line, after?.text, after ? "add" : "empty")); }
    }
    return `<div class="diff-split" dir="ltr"><div class="split-head">Before</div><div class="split-head">After</div>${blocks.join("")}</div>`;
  }
  function diffMarkup(state) {
    const file = state.data.files.find((entry) => entry.id === state.fileId);
    if (!file) return `<p class="muted">${label("Select a file to load its diff.")}</p>`;
    const diff = state.diffs.get(file.id);
    if (!diff) return `<p role="status"><span class="running-mark" aria-hidden="true"></span><span class="muted">${label("Loading diff…")}</span></p>`;
    if (!diff.patch) return `<p role="status">${label(diff.availability || "unavailable")}${diff.message ? ` · ${esc(diff.message)}` : ""}</p>`;
    // Developer-grade rendering: hunk bars, old/new line gutters, tinted
    // add/del rows. Git's ---/+++ headers are dropped (path + stats live in
    // the file header above the body).
    let oldNo = 0, newNo = 0, hunks = 0;
    function diffRow(o, n, sign, text, kind) { const side = kind === "del" ? "old" : "new", line = kind === "del" ? o : n; return `<div class="diff-line ${kind}"><span class="diff-no">${o || ""}</span><span class="diff-no">${n || ""}</span><span class="diff-sign">${sign}</span><span class="diff-code">${highlightCode(text, file.path) || " "}</span><button type="button" class="diff-comment-add" data-review-action="comment-at:${side}:${line}" aria-label="${label(`Comment on ${side} line ${line}`)}">＋</button></div>`; }
    const rows = [];
    for (const line of diff.patch.split("\n")) {
      if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) continue;
      if (line.startsWith("@@")) {
        hunks++;
        const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (m) { oldNo = Number(m[1]); newNo = Number(m[3]); }
        rows.push(`<div class="diff-hunkbar"><span class="pill">${label("Hunk")} ${hunks}</span><code>${esc(line)}</code></div>`);
        continue;
      }
      if (line.startsWith("\\ No newline")) { rows.push(`<div class="diff-line note"><span class="diff-no"></span><span class="diff-no"></span><span class="diff-sign"></span><span class="diff-code">${esc(line)}</span></div>`); continue; }
      const sign = line[0];
      const text = sign === "+" || sign === "-" ? line.slice(1) : line;
      if (sign === "+") { rows.push(diffRow("", newNo, "+", text, "add")); newNo++; }
      else if (sign === "-") { rows.push(diffRow(oldNo, "", "−", text, "del")); oldNo++; }
      else { rows.push(diffRow(oldNo, newNo, "", text, "ctx")); oldNo++; newNo++; }
    }
    const stats = diff.additions != null ? `<span class="pill diff-stat add" title="${esc(String(diff.additions))} added">+${esc(String(diff.additions))}</span><span class="pill diff-stat del" title="${esc(String(diff.deletions))} deleted">−${esc(String(diff.deletions))}</span>` : "";
    const kindClass = { added: "kind-add", deleted: "kind-del", modified: "kind-mod", mode_changed: "kind-mod" }[file.kind] || "";
    const body = rows.length ? (state.split ? splitPatchMarkup(diff.patch, file.path) : `<div class="diff-view" dir="ltr" data-no-translate>${rows.join("")}</div>`) : `<p role="status">${label("Empty patch")}</p>`;
    return `<div class="diff-head"><code class="diff-path" title="${esc(file.path)}">${esc(file.path)}</code><div class="diff-meta"><span class="pill diff-kind ${kindClass}">${label(file.kind)}</span><span class="pill">${esc(diff.availability)}</span>${stats}${button("Copy patch", "diff-copy", "ghost")}</div></div>${body}<p class="muted tiny">${label("Task-level evidence does not prove coverage of this file.")}</p>`;
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
  function reviewControlsMarkup(state) {
    const comments = (state.review?.comments || []).filter((comment) => comment.change_set_id === state.data?.id && comment.file_id === state.fileId);
    const historical = (state.review?.comments || []).filter((comment) => comment.change_set_id !== state.data?.id && comment.file_id === state.fileId);
    const reviewed = (state.review?.reviewed_files || []).some((entry) => entry.key === `${state.data?.id}:${state.fileId}`);
    return `<section class="review-notes" aria-label="Local review notes"><div class="bar">${button("Previous file", "file-prev")}${button("Next file", "file-next")}${button("Previous hunk", "hunk-prev")}${button("Next hunk", "hunk-next")}${button(state.split ? "Unified" : "Split", "split-toggle")}${button(reviewed ? "Reviewed" : "Mark reviewed", "file-reviewed")}${button("Add file comment", "comment-file")}</div>${comments.map((comment) => `<article class="review-comment ${comment.resolved ? "is-resolved" : ""}"><span class="pill">${label(comment.resolved ? "Resolved" : "Open")}</span> <b>${label(comment.side === "file" ? "File" : `${comment.side} line ${comment.line}`)}</b><p dir="auto">${esc(comment.text)}</p>${button(comment.resolved ? "Reopen" : "Resolve", `${comment.resolved ? "reopen" : "resolve"}:${comment.id}`)}</article>`).join("")}${historical.length ? `<details class="review-history"><summary>${label("Historical notes from older captures")} (${historical.length})</summary>${historical.map((comment) => `<article class="review-comment is-resolved"><span class="pill">${label("Historical")}</span> <b>${label(comment.side === "file" ? "File" : `${comment.side} line ${comment.line}`)}</b><p dir="auto">${esc(comment.text)}</p></article>`).join("")}</details>` : ""}${state.anchor ? `<div class="review-comment-draft"><label for="reviewDraft">${label(state.anchor.side === "file" ? "File comment" : `Comment on ${state.anchor.side} line ${state.anchor.line}`)}</label><textarea id="reviewDraft" class="input" rows="3">${esc(state.draft || "")}</textarea><div class="bar">${button("Save comment", "comment-save", "primary")}${button("Cancel", "comment-cancel")}</div></div>` : ""}</section>`;
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
  // Change profile: what actually changed in the repo, per file. Line counts
  // come from the capture's bounded diffstat; files without counts (binary,
  // redacted, over-budget) show their change kind instead.
  function chartMarkup(state) {
    const d = state.data;
    const files = d.files || [];
    if (!files.length) return "";
    const kinds = {};
    for (const file of files) kinds[file.kind] = (kinds[file.kind] || 0) + 1;
    const churn = (file) => (file.additions || 0) + (file.deletions || 0);
    const ranked = [...files].sort((a, b) => churn(b) - churn(a) || a.path.localeCompare(b.path));
    const rows = ranked.slice(0, 14);
    const max = Math.max(1, ...rows.map(churn));
    const hidden = ranked.length - rows.length;
    const row = (file) => {
      const counted = file.additions != null && file.deletions != null;
      // Square-root scale: one huge evidence file must not flatten every
      // real source change into invisible slivers.
      const scale = (value) => Math.round((Math.sqrt(value) / Math.sqrt(max)) * 1000) / 10;
      const add = counted ? scale(file.additions) : 0;
      const del = counted ? scale(file.deletions) : 0;
      return `<button type="button" class="review-chart-row" data-review-action="file:${esc(file.id)}" aria-label="${esc(file.path)}"><span class="review-chart-path" dir="ltr" title="${esc(file.path)}">${esc(file.path)}</span><span class="review-chart-bar" aria-hidden="true">${counted ? `<span class="review-chart-add" style="width:${add}%"></span><span class="review-chart-del" style="width:${del}%"></span>` : `<span class="review-chart-none"></span>`}</span><span class="review-chart-count${counted ? "" : " muted"}" dir="ltr">${counted ? `+${file.additions} / −${file.deletions}` : label("no line count")}</span></button>`;
    };
    const chips = Object.entries(kinds).map(([kind, count]) => `<span class="pill">${label(kind)} ${count}</span>`).join(" ");
    const totals = d.additions != null || d.deletions != null
      ? `<span class="review-chart-totals" dir="ltr"><span class="green">+${d.additions || 0}</span> / <span class="red">−${d.deletions || 0}</span></span>${d.stats_complete ? "" : ` <span class="muted tiny">${label("counts for loaded files")}</span>`}`
      : `<span class="muted tiny">${label("Line counts unavailable for this capture")}</span>`;
    return `<section class="review-chart" aria-label="${label("Change profile")}"><div class="row between"><h3>${label("Change profile")}</h3>${totals}</div>${d.repository || d.workspace ? `<p class="sub">${label("Repository")}: <b>${esc(d.repository || tr("This workspace"))}</b>${d.workspace ? ` · <code class="review-path" dir="ltr">${esc(d.workspace)}</code>` : ""}</p>` : ""}<div class="review-chart-meta"><span class="muted tiny">${d.total_files} ${label("files changed")}</span>${chips ? `<span class="review-chart-kinds">${chips}</span>` : ""}</div><div class="review-chart-legend tiny muted"><span><span class="review-chart-key add" aria-hidden="true"></span> ${label("added lines")}</span><span><span class="review-chart-key del" aria-hidden="true"></span> ${label("deleted lines")}</span></div><div class="review-chart-rows">${rows.map(row).join("")}</div>${hidden > 0 ? `<p class="muted tiny review-chart-more">${hidden} ${label("more files in the file list")} ${button("Open file list", "tab:files")}</p>` : ""}</section>`;
  }
  function stateFor(task, initialTab) {
    const saved = (() => { try { return JSON.parse(localStorage.getItem("atl-review-ui:" + task.id) || "{}"); } catch { return {}; } })();
    const state = views.get(task.id) || { tab: saved.tab || "files", query: saved.query || "", filter: "all", expanded: new Set(), diffs: new Map(), scrolls: new Map(Object.entries(saved.scrolls || {})), fileId: saved.fileId || null, nodeId: null, split: saved.split === true, leftWidth: Number.isFinite(saved.leftWidth) ? Math.max(180, Math.min(520, saved.leftWidth)) : 280, data: null };
    if (initialTab) state.tab = initialTab;
    if (!reviewTabs.includes(state.tab)) state.tab = "overview";
    state.review ||= { revision: 0, comments: [], reviewed_files: [] };
    state.draft ??= saved.draft || "";
    state.anchor ??= saved.anchor || null;
    views.set(task.id, state);
    return state;
  }
  async function open(task, host, initialTab = null) {
    const token = ++generation;
    const state = stateFor(task, initialTab);
    const focusReturn = document.activeElement;
    host.popupWide(`${esc(task.id)} / ${label("Review changes")}`, '<div id="taskChangeReview" class="task-change-review" aria-live="polite"></div>', host.btn("Back to task", `task-detail:${task.id}`) + host.btn("Close", "close"));
    const mount = document.querySelector("#taskChangeReview"), dialog = mount?.closest(".dialog");
    if (dialog) { dialog.classList.add("review-dialog"); dialog.setAttribute("aria-label", tr("Review changes")); }
    const handle = attach(task, mount, dialog, { token, state, focusReturn });
    await handle.ready;
    return handle;
  }
  // Embedded mode: the task workspace mounts the same review content inline.
  // Returns the handle the workspace uses to open a file diff or tab from
  // Activity/Process links. No dialog chrome, no focus trap.
  function embed(task, mount, { initialTab = null } = {}) {
    const token = ++generation;
    const state = stateFor(task, initialTab);
    return attach(task, mount, null, { token, state, focusReturn: null });
  }
  function attach(task, mount, dialog, { token, state, focusReturn }) {
    if (!mount) return { selectFile() {}, showTab() {} };
    const active = () => generation === token && mount.isConnected;
    let busy = false, error = "", focusFile = 0;
    let resizing = false;
    const persistUi = () => { try { localStorage.setItem("atl-review-ui:" + task.id, JSON.stringify({ tab: state.tab, query: state.query, fileId: state.fileId, split: state.split, leftWidth: state.leftWidth, scrolls: Object.fromEntries(state.scrolls), draft: state.draft, anchor: state.anchor })); } catch { /* local storage is optional */ } };
    function render() {
      if (!active()) return;
      const scrolls = [...mount.querySelectorAll("[data-review-scroll]")].map((node) => [node.dataset.reviewScroll, node.scrollTop, node.scrollLeft]);
      for (const [key, top, left] of scrolls) state.scrolls.set(key, [top, left]);
      persistUi();
      const dialogBody = mount.closest(".dialogbody"), dialogScroll = dialogBody?.scrollTop;
      const focused = mount.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused?.getAttribute("data-review-action") || focused?.id;
      const selection = focused?.selectionStart;
      const d = state.data, ready = Boolean(d?.id);
      let body = `<p role="status"><span class="running-mark" aria-hidden="true"></span><span class="muted">${label("Loading changes…")}</span></p>`;
      if (d && !ready) body = `<div class="notice"><b>${label(d.availability)}</b><p>${esc(d.message || "")}</p></div>${d.repository || d.workspace ? `<p class="sub">${label("Repository")}: <b>${esc(d.repository || tr("This workspace"))}</b>${d.workspace ? ` · <code class="review-path" dir="ltr">${esc(d.workspace)}</code>` : ""}</p>` : ""}`;
      if (ready) {
        const tabs = reviewTabs;
        const header = `<div class="bar"><span class="pill">${label(d.status)}</span><span>${label("Captured")}: ${esc(new Date(d.captured_at).toLocaleString())}</span></div><p class="review-revisions">${label("Baseline")}: ${code(d.baseline_revision)}<br>${label("Output")}: ${code(d.output_revision)}</p><p class="sub">${label("Captured revisions stay pinned. Capture again to inspect newer source.")}</p><label>${label("Captured revision")} <select id="reviewRevision" class="input">${(d.revisions || []).map((revision) => `<option value="${revision.id}" ${revision.id === d.id ? "selected" : ""}>${esc(revision.captured_at)} · ${esc(revision.output_revision.slice(0, 12))}</option>`).join("")}</select></label><div class="bar review-tabs" role="tablist" aria-label="${label("Review sections")}">${tabs.map((tab) => button(tab[0].toUpperCase() + tab.slice(1), `tab:${tab}`, `role="tab" aria-selected="${state.tab === tab}" aria-controls="reviewPanel" id="reviewTab-${tab}" tabindex="${state.tab === tab ? 0 : -1}"`)).join("")}</div>`;
        let panel;
        if (state.tab === "files") {
          const files = d.files.filter((file) => file.path.toLowerCase().includes(state.query.toLowerCase()) && (state.filter === "all" || file.kind === state.filter));
          panel = `<div class="review-files" style="grid-template-columns:minmax(180px, ${state.leftWidth}px) 8px minmax(0,1fr)"><aside aria-label="${label("Changed files")}"><label for="reviewSearch">${label("Search paths")}</label><input class="input" id="reviewSearch" value="${esc(state.query)}" dir="auto"><label for="reviewFilter">${label("Change type")}</label><select class="input" id="reviewFilter">${["all", "added", "modified", "deleted", "mode_changed"].map((kind) => `<option value="${kind}" ${state.filter === kind ? "selected" : ""}>${label(kind)}</option>`).join("")}</select><p class="muted tiny">${d.files.length} / ${d.total_files} ${label("files loaded")}</p><div class="review-tree" data-review-scroll="tree">${fileTree(files, state) || `<p>${label("No matching files in loaded page.")}</p>`}</div>${d.next_cursor != null ? button("Load more files", "more", busy ? "disabled" : "") : ""}</aside><div class="review-resize" role="separator" tabindex="0" aria-label="Resize file list"></div><section class="review-patch" aria-label="${label("File diff")}" data-review-scroll="patch">${diffMarkup(state)}</section></div>`;
        } else if (state.tab === "evidence") panel = evidenceMarkup(state);
        else if (state.tab === "relationships") panel = relationshipMarkup(state);
        else panel = `<h3 dir="auto">${esc(d.title || task.title || "")}</h3><p dir="auto">${esc(d.objective || "")}</p>${d.summary ? `<p dir="auto">${esc(d.summary)}</p>` : ""}${chartMarkup(state)}${deliveryMarkup(d)}<h3>${label("Attention required")}</h3>${(d.attention || []).map((item) => `<div class="notice"><b>${label(item.code)}</b><p dir="auto">${esc(item.reason)}</p></div>`).join("") || `<p>${label("No recorded attention flags. This is not delivery approval.")}</p>`}<p>${label("Changed files")}: ${d.total_files}</p><p>${label("Source")}: ${esc(d.source_kind)} · ${label("Packet revision")}: ${d.packet_revision}</p>${Object.keys(d.input_revisions || {}).length ? `<h3>${label("Imported input revisions")}</h3><pre dir="ltr" data-no-translate>${esc(JSON.stringify(d.input_revisions, null, 2))}</pre>` : ""}`;
        if (state.tab === "files") panel += reviewControlsMarkup(state);
        body = header + `<div id="reviewPanel" class="review-panel ${state.split ? "is-split" : "is-unified"}" role="tabpanel" aria-labelledby="reviewTab-${state.tab}" tabindex="0">${panel}</div>`;
      }
      mount.innerHTML = `<div class="bar">${button("Refresh evidence", "refresh", busy ? "disabled" : "")}${button("Capture current changes", "capture", busy || d?.availability === "baseline_missing" ? "disabled" : "")}</div><p class="muted tiny">${label("Capture stores source for inspection. It does not start a worker or approve delivery.")}</p>${busy ? `<p role="status">${label("Loading changes…")}</p>` : ""}${error ? `<p class="red" role="alert">${esc(error)}</p>` : ""}${body}`;
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
        if (d.id) { try { state.review = await request(`/api/task-review-state?${new URLSearchParams({ taskId: task.id })}`); } catch { state.review = state.review || { revision: 0, comments: [], reviewed_files: [] }; } }
        if (more) d.files = [...(state.data?.files || []), ...(d.files || [])];
        else if (d.id && d.id === state.data?.id && (state.data.files || []).length > (d.files || []).length) { d.files = state.data.files; d.next_cursor = state.data.next_cursor; }
        if (d.id !== state.data?.id) { state.diffs.clear(); if (!(d.files || []).some((file) => file.id === state.fileId)) state.fileId = null; }
        state.data = d;
        persistUi();
      } catch (failure) { if (active()) error = failure.message; }
      finally { busy = false; render(); }
    }
    async function selectFile(id, changeSetId = null, hunkIndex = null) {
      if (changeSetId && state.data?.id !== changeSetId) {
        while (busy && active()) await new Promise((resolve) => setTimeout(resolve, 10));
        if (state.data?.id !== changeSetId) await load({ id: changeSetId });
      }
      if (!id) { state.tab = "files"; render(); persistUi(); return; }
      const requestId = ++focusFile; state.fileId = id; state.tab = "files"; render();
      const jumpToHunk = () => { if (hunkIndex == null) return; const hunk = mount.querySelectorAll(".diff-hunkbar, .split-hunk")[hunkIndex]; hunk?.scrollIntoView({ block: "start", behavior: "smooth" }); };
      if (state.diffs.has(id)) { render(); jumpToHunk(); return; }
      try {
        const pinned = state.data.id;
        const d = await request(`/api/task-change-diff?${new URLSearchParams({ taskId: task.id, changeSetId: pinned, fileId: id })}`);
        if (!active() || state.data.id !== pinned) return;
        state.diffs.set(id, d);
      } catch (failure) { if (active()) state.diffs.set(id, { availability: "unavailable", message: failure.message }); }
      if (requestId === focusFile) { render(); jumpToHunk(); }
    }
    mount.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-review-action]")?.dataset.reviewAction;
      if (!action) return;
      if (action.startsWith("tab:")) { state.tab = action.slice(4); render(); }
      else if (action.startsWith("file:")) void selectFile(action.slice(5));
      else if (action === "file-prev" || action === "file-next") { const files = state.data?.files || [], index = files.findIndex((file) => file.id === state.fileId), offset = action === "file-next" ? 1 : -1; if (files.length) void selectFile(files[(index + offset + files.length) % files.length].id); }
      else if (action === "hunk-prev" || action === "hunk-next") { const bars = [...mount.querySelectorAll(".diff-hunkbar, .split-hunk")], active = bars.findIndex((bar) => bar.getBoundingClientRect().top >= mount.getBoundingClientRect().top), target = bars[action === "hunk-next" ? Math.min(bars.length - 1, Math.max(0, active + 1)) : Math.max(0, active - 1)]; target?.scrollIntoView({ block: "start", behavior: "smooth" }); }
      else if (action === "split-toggle") { state.split = !state.split; persistUi(); render(); }
      else if (action === "comment-file") { state.anchor = { side: "file", line: null }; state.draft = ""; persistUi(); render(); mount.querySelector("#reviewDraft")?.focus(); }
      else if (action.startsWith("comment-at:")) { const [, side, line] = action.split(":"); state.anchor = { side, line: Number(line) }; state.draft = ""; persistUi(); render(); mount.querySelector("#reviewDraft")?.focus(); }
      else if (action === "comment-cancel") { state.anchor = null; state.draft = ""; persistUi(); render(); }
      else if (action === "comment-save" || action === "file-reviewed" || action.startsWith("resolve:") || action.startsWith("reopen:")) {
        const body = action === "comment-save" ? { action: "comment", side: state.anchor?.side, line: state.anchor?.line, text: state.draft } : action === "file-reviewed" ? { action: "reviewed", file_id: state.fileId, reviewed: !((state.review.reviewed_files || []).some((entry) => entry.key === `${state.data.id}:${state.fileId}`)) } : { action: action.split(":")[0], comment_id: action.slice(action.indexOf(":") + 1) };
        try { state.review = await request("/api/task-review-state", { method: "PUT", body: JSON.stringify({ task_id: task.id, change_set_id: state.data.id, file_id: state.fileId, expected_revision: state.review.revision || 0, ...body }) }); state.anchor = null; state.draft = ""; error = ""; persistUi(); render(); }
        catch (failure) { error = failure.message; render(); }
      }
      else if (action.startsWith("node:")) { state.nodeId = action.slice(5); const node = nodes(state).find((entry) => `${entry.kind}:${entry.id}` === state.nodeId); if (node?.kind === "File") void selectFile(node.id); else if (node?.kind === "Evidence") { state.tab = "evidence"; render(); const entry = document.getElementById(node.id); if (entry) { entry.open = true; entry.querySelector("summary")?.focus(); } } else render(); }
      else if (action === "capture") void load({ capture: true });
      else if (action === "refresh") void load();
      else if (action === "more") void load({ more: true });
      else if (action === "diff-copy") {
        const file = state.data?.files.find((entry) => entry.id === state.fileId);
        const patch = file && state.diffs.get(file.id)?.patch;
        if (patch && navigator.clipboard?.writeText) navigator.clipboard.writeText(patch).then(() => {
          const node = mount.querySelector('[data-review-action="diff-copy"]');
          if (node) { const prior = node.textContent; node.textContent = "Copied ✓"; setTimeout(() => { node.textContent = prior; }, 1400); }
        }).catch(() => {});
      }
    });
    mount.addEventListener("input", (event) => { if (event.target.id === "reviewSearch") { state.query = event.target.value; persistUi(); render(); } if (event.target.id === "reviewDraft") { state.draft = event.target.value; persistUi(); } });
    mount.addEventListener("pointerdown", (event) => { if (event.target.closest(".review-resize")) { resizing = true; event.target.setPointerCapture?.(event.pointerId); event.preventDefault(); } });
    mount.addEventListener("pointermove", (event) => { if (!resizing) return; const grid = mount.querySelector(".review-files"); if (!grid) return; const box = grid.getBoundingClientRect(); const width = document.documentElement.dir === "rtl" ? box.right - event.clientX : event.clientX - box.left; state.leftWidth = Math.max(180, Math.min(520, Math.round(width - 4))); grid.style.gridTemplateColumns = `minmax(180px, ${state.leftWidth}px) 8px minmax(0,1fr)`; persistUi(); });
    mount.addEventListener("pointerup", () => { resizing = false; });
    mount.addEventListener("keydown", (event) => {
      if (event.target.closest?.(".review-resize")) { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); state.leftWidth = Math.max(180, Math.min(520, state.leftWidth + (event.key === "ArrowRight" ? 20 : -20))); const grid = mount.querySelector(".review-files"); if (grid) grid.style.gridTemplateColumns = `minmax(180px, ${state.leftWidth}px) 8px minmax(0,1fr)`; persistUi(); } return; }
      if (event.target.matches?.("input, textarea, select, [contenteditable=true]")) return;
      if (["j", "k"].includes(event.key.toLowerCase())) { event.preventDefault(); const files = state.data?.files || [], index = files.findIndex((file) => file.id === state.fileId), step = event.key.toLowerCase() === "j" ? 1 : -1; if (files.length) void selectFile(files[(index + step + files.length) % files.length].id); }
      else if (["n", "p"].includes(event.key.toLowerCase())) { event.preventDefault(); const bars = [...mount.querySelectorAll(".diff-hunkbar, .split-hunk")], step = event.key.toLowerCase() === "n" ? 1 : -1, current = bars.findIndex((bar) => bar.getBoundingClientRect().top >= 0); bars[Math.max(0, Math.min(bars.length - 1, current + step))]?.scrollIntoView({ block: "start", behavior: "smooth" }); }
      else if (event.key.toLowerCase() === "c") { event.preventDefault(); state.anchor = { side: "file", line: null }; state.draft = ""; persistUi(); render(); mount.querySelector("#reviewDraft")?.focus(); }
    });
    mount.addEventListener("change", (event) => { if (event.target.id === "reviewFilter") { state.filter = event.target.value; render(); } if (event.target.id === "reviewRevision") void load({ id: event.target.value }); });
    mount.addEventListener("toggle", (event) => { const key = event.target.dataset.reviewDirectory; if (key) { if (event.target.open) state.expanded.add(key); else state.expanded.delete(key); } }, true);
    dialog?.addEventListener("keydown", (event) => {
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
    render();
    const ready = load().then(() => { if (active()) mount.querySelector("button")?.focus(); });
    return { selectFile, ready, showTab: (tab) => { if (reviewTabs.includes(tab)) { state.tab = tab; persistUi(); render(); } } };
  }
  window.ATL_CHANGE_REVIEW = Object.freeze({ open, embed });
})();
