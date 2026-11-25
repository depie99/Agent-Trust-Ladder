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
    if (!response.ok) throw Object.assign(new Error(value.error || "Inspection unavailable"), { availability: value.availability, revisions: value.revisions });
    return value;
  }
  function fileTree(files, state, prefix = "") {
    const directories = new Map(), leaves = [];
    for (const file of files) {
      const rest = file.path.slice(prefix.length), slash = rest.indexOf("/");
      if (slash < 0) leaves.push(file);
      else { const directory = prefix + rest.slice(0, slash + 1); if (!directories.has(directory)) directories.set(directory, []); directories.get(directory).push(file); }
    }
    return [...directories].map(([directory, children]) => `<details data-review-directory="${esc(directory)}" ${state.embedded || state.expanded.has(directory) || state.query ? "open" : ""}><summary>${code(directory.slice(prefix.length))}${state.embedded ? "" : ` <span class="muted">${children.length}</span>`}</summary>${fileTree(children, state, directory)}</details>`).join("") + leaves.map((file) => `<button type="button" class="review-file ${state.fileId === file.id ? "selected" : ""}" data-review-action="file:${file.id}" aria-pressed="${state.fileId === file.id}"><span class="pill review-file-kind kind-${esc(file.kind)}" title="${label(file.kind)}">${state.embedded ? ({ added: "A", modified: "M", deleted: "D", mode_changed: "M" }[file.kind] || "M") : label(file.kind)}</span>${code(file.path.slice(prefix.length))}${(state.review?.reviewed_files || []).some((entry) => entry.key === `${state.data.id}:${file.id}`) ? `<span class="pill green review-file-reviewed" aria-label="${label("Reviewed")}">&#10003;</span>` : ""}${(state.review?.comments || []).filter((comment) => comment.change_set_id === state.data.id && comment.file_id === file.id).length ? `<span class="review-file-comments" aria-label="${label("Comments")}">♧ ${state.review.comments.filter((comment) => comment.change_set_id === state.data.id && comment.file_id === file.id).length}</span>` : ""}</button>`).join("");
  }
  function highlightCode(text, filePath) {
    const source = String(text ?? "");
    if (!/\.(?:[cm]?[jt]sx?|json|css|scss|html|xml|ya?ml|sh|py|rs|go)$/i.test(filePath)) return esc(source);
    const tokens = /\/\/[^\n]*|\/\*.*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|class|new|async|await|export|import|from|throw|try|catch|true|false|null|undefined|public|private|static)\b|\b\d+(?:\.\d+)?\b/g;
    let result = "", offset = 0;
    for (const match of source.matchAll(tokens)) {
      result += esc(source.slice(offset, match.index));
      const value = match[0], kind = value.startsWith("//") || value.startsWith("/*") ? "comment" : /^["'`]/.test(value) ? "string" : /^\d/.test(value) ? "number" : "keyword";
      result += `<span class="syntax-${kind}">${esc(value)}</span>`; offset = match.index + value.length;
    }
    return result + esc(source.slice(offset));
  }
  function patchRows(patch) {
    let oldNo = 0, newNo = 0, inHunk = false;
    return String(patch).split("\n").flatMap((line) => {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) { oldNo = Number(match[1]); newNo = Number(match[2]); inHunk = true; return [{ kind: "hunk", text: line }]; }
      if (!inHunk || !line) return [];
      if (line.startsWith("\\ No newline")) return [{ kind: "note", text: line }];
      if (line[0] === "+") return [{ kind: "add", old: null, new: newNo++, text: line.slice(1) }];
      if (line[0] === "-") return [{ kind: "del", old: oldNo++, new: null, text: line.slice(1) }];
      if (line[0] === " ") return [{ kind: "ctx", old: oldNo++, new: newNo++, text: line.slice(1) }];
      return [];
    });
  }
  function splitPatchMarkup(patch, file) {
    const blocks = [], rows = patchRows(patch);
    const cell = (row, side, type) => `<div class="split-line ${type}" ${row ? `data-side="${side}" data-line="${row[side]}"` : ""}><span>${row?.[side] || ""}</span><code>${row ? highlightCode(row.text, file.path) : ""}</code>${row ? `<button type="button" data-review-action="comment-at:${side}:${row[side]}" aria-label="${label(`Comment on ${side} line ${row[side]}`)}">+</button>` : ""}</div>`;
    for (let index = 0; index < rows.length;) {
      const row = rows[index++];
      if (row.kind === "hunk") { blocks.push(`<div class="split-hunk" tabindex="-1">${esc(row.text)}</div>`); continue; }
      if (row.kind === "note") { blocks.push(`<div class="split-note">${esc(row.text)}</div>`); continue; }
      if (row.kind === "ctx") { blocks.push(cell(row, "old", "ctx") + cell(row, "new", "ctx")); continue; }
      const deleted = [], added = [];
      const take = (entry) => (entry.kind === "del" ? deleted : added).push(entry);
      take(row);
      while (index < rows.length && ["add", "del"].includes(rows[index].kind)) take(rows[index++]);
      for (let offset = 0; offset < Math.max(deleted.length, added.length); offset++) blocks.push(cell(deleted[offset], "old", deleted[offset] ? "del" : "empty") + cell(added[offset], "new", added[offset] ? "add" : "empty"));
    }
    const heading = (text, absent) => `<div class="split-head">${label(text)}${absent ? ` <span class="split-absent">${label("File absent")}</span>` : ""}</div>`;
    return `<div class="diff-split" dir="ltr" data-no-translate>${heading("Before", file.kind === "added")}${heading("After", file.kind === "deleted")}${blocks.join("")}</div>`;
  }
  function compactThread(comment) {
    const timestamp = comment.created_at ? new Date(comment.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    return `<article class="review-comment ${comment.resolved ? "is-resolved" : ""}"><div class="review-comment-heading"><b>${esc(comment.author || "You")}</b><span class="muted">${esc(timestamp)}</span><span class="pill ${comment.resolved ? "green" : "amber"}">${label(comment.resolved ? "Resolved" : "Open")}</span></div><p dir="auto">${esc(comment.text)}</p>${(comment.replies || []).map(reply => `<p class="review-reply" dir="auto">${esc(reply.text)}</p>`).join("")}<div class="bar">${button("Reply", `reply:${comment.id}`)}${button(comment.resolved ? "Reopen" : "Resolve", `${comment.resolved ? "reopen" : "resolve"}:${comment.id}`)}</div></article>`;
  }
  function compactDraft(state) {
    if (!state.anchor) return "";
    return `<div class="review-comment-draft"><label for="reviewDraft">${label(state.anchor.side === "reply" ? "Reply" : "Comment")}</label><textarea id="reviewDraft" class="input" rows="3" maxlength="4000">${esc(state.draft || "")}</textarea><div class="bar">${button("Save comment", "comment-save", state.saving || state.reviewReadError ? "disabled" : "")}${button("Cancel", "comment-cancel")}</div></div>`;
  }
  function diffMarkup(state) {
    const file = state.data.files.find((entry) => entry.id === state.fileId) || state.diffs.get(state.fileId)?.file;
    if (!file) return `<p class="muted">${label("Select a file to load its diff.")}</p>`;
    const diff = state.diffs.get(file.id);
    if (!diff) return `<p role="status"><span class="running-mark" aria-hidden="true"></span><span class="muted">${label("Loading diff…")}</span></p>`;
    if (!diff.patch && !state.embedded) return `<p role="status">${label(diff.availability || "unavailable")}${diff.message ? ` · ${esc(diff.message)}` : ""}</p>`;
    // Developer-grade rendering: hunk bars, old/new line gutters, tinted
    // add/del rows. Git's ---/+++ headers are dropped (path + stats live in
    // the file header above the body).
    let hunks = 0;
    const rows = patchRows(diff.patch).map((row) => {
      if (row.kind === "hunk") return `<div class="diff-hunkbar" tabindex="-1">${state.embedded ? "" : `<span class="pill">${label("Hunk")} ${++hunks}</span>`}<code>${esc(row.text)}</code></div>`;
      if (row.kind === "note") return `<div class="diff-line note"><span></span><span></span><span></span><span class="diff-code">${esc(row.text)}</span></div>`;
      const side = row.kind === "del" ? "old" : "new", line = row[side];
      const threads = state.embedded ? (state.review?.comments || []).filter(comment => comment.change_set_id === state.data.id && comment.file_id === file.id && comment.side !== "file" && ((comment.side === "old" && comment.line === row.old) || (comment.side === "new" && comment.line === row.new))).map(compactThread).join("") : "";
      return `<div class="diff-line ${row.kind}" data-side="${side}" data-line="${line}"><span class="diff-no">${row.old || ""}</span><span class="diff-no">${row.new || ""}</span><span class="diff-sign">${row.kind === "add" ? "+" : row.kind === "del" ? "-" : ""}</span><span class="diff-code">${highlightCode(row.text, file.path)}</span><button type="button" class="diff-comment-add" data-review-action="comment-at:${side}:${line}" aria-label="${label(`Comment on ${side} line ${line}`)}">+</button></div>${threads}`;
    });
    const stats = diff.additions != null ? `<span class="pill diff-stat add" title="${esc(String(diff.additions))} added">+${esc(String(diff.additions))}</span><span class="pill diff-stat del" title="${esc(String(diff.deletions))} deleted">−${esc(String(diff.deletions))}</span>` : "";
    const kindClass = { added: "kind-add", deleted: "kind-del", modified: "kind-mod", mode_changed: "kind-mod" }[file.kind] || "";
    const body = rows.length ? (state.split ? splitPatchMarkup(diff.patch, file) : `<div class="diff-view" dir="ltr" data-no-translate data-review-scroll="code:${state.data.id}:${file.id}">${rows.join("")}</div>`) : `<p role="status">${label(diff.message || diff.availability || "Empty patch")}</p>`;
    if (state.embedded) {
      const reviewed = (state.review?.reviewed_files || []).some(entry => entry.key === `${state.data.id}:${file.id}`);
      const comments = (state.review?.comments || []).filter(comment => comment.change_set_id === state.data.id && comment.file_id === file.id && (comment.side === "file" || state.split));
      return `<div class="diff-head"><code class="diff-path" title="${esc(file.path)}">${esc(file.path)}</code><div class="diff-meta">${stats}${button("‹ Prev", "file-prev")}${button("Next ›", "file-next")}${button(reviewed ? "Reviewed" : "Mark reviewed", "file-reviewed", `class="btn sm primary" aria-pressed="${reviewed}" ${state.reviewReadError || state.saving ? "disabled" : ""}`)}</div></div>${body}${comments.map(compactThread).join("")}${compactDraft(state)}<p class="review-notice" role="status">${esc(state.notice || "")}</p>`;
    }
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
    const disabled = state.reviewReadError || state.saving || !state.fileId ? "disabled" : "";
    const reviewed = (state.review?.reviewed_files || []).some((entry) => entry.key === `${state.data?.id}:${state.fileId}`);
    return `<section class="review-notes" aria-label="Local review notes"><p role="status">${esc(state.notice || "")}</p><div class="bar">${button("Previous file", "file-prev")}${button("Next file", "file-next")}${button("Previous hunk", "hunk-prev")}${button("Next hunk", "hunk-next")}${button(state.split ? "Unified" : "Split", "split-toggle")}${button(reviewed ? "Reviewed" : "Mark reviewed", "file-reviewed", `${disabled} aria-pressed="${reviewed}"`)}${button("Add file comment", "comment-file", disabled)}</div>${comments.map((comment) => `<article class="review-comment ${comment.resolved ? "is-resolved" : ""}"><span class="pill">${label(comment.resolved ? "Resolved" : "Open")}</span> <b>${label(comment.side === "file" ? "File" : `${comment.side} line ${comment.line}`)}</b><p dir="auto">${esc(comment.text)}</p>${(comment.replies || []).map((reply) => `<p class="review-reply" dir="auto">${esc(reply.text)}</p>`).join("")}${button("Reply", `reply:${comment.id}`)}${button(comment.resolved ? "Reopen" : "Resolve", `${comment.resolved ? "reopen" : "resolve"}:${comment.id}`)}</article>`).join("")}${historical.length ? `<details class="review-history"><summary>${label("Historical notes from other captured revisions")} (${historical.length})</summary>${historical.map((comment) => `<article class="review-comment is-resolved"><span class="pill">${label("Historical")}</span> <b>${label(comment.side === "file" ? "File" : `${comment.side} line ${comment.line}`)}</b><small dir="ltr">${esc(comment.change_set_id.slice(0, 12))}</small><p dir="auto">${esc(comment.text)}</p>${(comment.replies || []).map((reply) => `<p class="review-reply" dir="auto">${esc(reply.text)}</p>`).join("")}</article>`).join("")}</details>` : ""}${state.anchor ? `<div class="review-comment-draft"><label for="reviewDraft">${label(state.anchor.side === "reply" ? "Reply" : state.anchor.side === "file" ? "File comment" : `Comment on ${state.anchor.side} line ${state.anchor.line}`)}</label><textarea id="reviewDraft" class="input" rows="3" maxlength="4000">${esc(state.draft || "")}</textarea><div class="bar">${button("Save comment", "comment-save", disabled)}${button("Cancel", "comment-cancel")}</div></div>` : ""}</section>`;
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
  const revisionSource = (revision) => label(revision.source_kind === "handoff" ? "Completed handoff" : "Workspace inspection");
  function stateFor(task, initialTab) {
    const saved = (() => { try { return JSON.parse(localStorage.getItem("atl-review-ui:" + task.id) || "{}"); } catch { return {}; } })();
    const state = views.get(task.id) || { tab: saved.tab || "files", query: saved.query || "", filter: saved.filter || "all", expanded: new Set(saved.expanded || []), diffs: new Map(), scrolls: new Map(Object.entries(saved.scrolls || {})), fileId: saved.fileId || null, nodeId: null, split: saved.split === true, leftWidth: Number.isFinite(saved.leftWidth) ? Math.max(180, Math.min(520, saved.leftWidth)) : 280, data: null };
    if (initialTab) state.tab = initialTab;
    if (!reviewTabs.includes(state.tab)) state.tab = "overview";
    state.review ||= { revision: 0, comments: [], reviewed_files: [] };
    state.draft ??= saved.draft || "";
    state.anchor ??= saved.anchor || null;
    state.changeSetId ??= (task.rawStatus === "done" || task.status === "done") && !saved.explicitRevision ? null : saved.changeSetId || null;
    state.explicitRevision ??= saved.explicitRevision === true;
    state.drafts ??= saved.drafts && typeof saved.drafts === "object" ? saved.drafts : {};
    if (state.anchor && state.changeSetId && state.fileId) state.drafts[`${state.changeSetId}:${state.fileId}`] = { text: state.draft, anchor: state.anchor };
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
  function embeddedReviewMarkup(state, error, busy) {
    const d = state.data, revisions = d.revisions || [];
    const reviewed = (state.review?.reviewed_files || []).filter(entry => entry.change_set_id === d.id).length;
    const files = d.files.filter(file => file.path.toLowerCase().includes(state.query.toLowerCase()) && (state.filter === "all" || file.kind === state.filter));
    const tools = `<details class="review-more-tools"><summary>${label("More review tools")}</summary><div class="bar">${button("Add file comment", "comment-file")}${button("Previous hunk", "hunk-prev")}${button("Next hunk", "hunk-next")}${button("Copy patch", "diff-copy")}${button("Refresh evidence", "refresh", busy ? "disabled" : "")}${button("Capture current changes", "capture", busy ? "disabled" : "")}</div><div class="bar">${reviewTabs.map(tab => button(tab[0].toUpperCase() + tab.slice(1), `tab:${tab}`)).join("")}</div><label for="reviewFilter">${label("Change type")}</label><select id="reviewFilter" class="input">${["all", "added", "modified", "deleted", "mode_changed"].map(kind => `<option value="${kind}" ${state.filter === kind ? "selected" : ""}>${label(kind)}</option>`).join("")}</select></details>`;
    const toolbar = `<div class="review-reference-toolbar"><details class="review-revision-picker"><summary>${label("Revision")} ${Math.max(1,revisions.length - revisions.findIndex(revision => revision.id === d.id))}${d.id === revisions[0]?.id ? ` (${label("latest")})` : ""}<span aria-hidden="true">⌄</span></summary><div class="review-revision-menu"><label for="reviewRevision">${label("Captured revision")}</label><select id="reviewRevision">${revisions.map((revision, index) => `<option value="${esc(revision.id)}" ${revision.id === d.id ? "selected" : ""}>${label("Revision")} ${revisions.length - index} ? ${revisionSource(revision)}${index === 0 ? ` (${label("latest")})` : ""}</option>`).join("") || `<option value="${esc(d.id)}">${label("Current revision")}</option>`}</select>${tools}</div></details><span class="review-source-kind pill">${revisionSource(d)}</span><b class="review-total-add">+${d.additions ?? "?"}</b><b class="review-total-del">−${d.deletions ?? "?"}</b><span class="review-total-label">${label("across")} ${d.total_files} ${label("files")}</span><span class="task-files-count review-reviewed-count">${reviewed} ${label("of")} ${d.total_files} ${label("reviewed")}</span><div class="review-mode-toggle" role="group" aria-label="${label("Diff layout")}"><button type="button" data-review-action="split-unified" aria-pressed="${!state.split}">${label("Unified")}</button><button type="button" data-review-action="split-side" aria-pressed="${state.split}">${label("Split")}</button></div></div>`;
    const filePanel = `<div class="review-files ${state.fileOpen ? "is-file-open" : ""}" style="grid-template-columns:minmax(180px,${state.leftWidth}px) 8px minmax(0,1fr)"><aside aria-label="${label("Changed files")}"><label class="sr-only" for="reviewSearch">${label("Filter files")}</label><input class="input" id="reviewSearch" placeholder="${label("Filter files...")}" value="${esc(state.query)}"><div class="review-tree" data-review-scroll="tree">${fileTree(files, state) || `<p>${label("No matching files.")}</p>`}</div>${d.next_cursor != null ? button("Load more files", "more", busy ? "disabled" : "") : ""}<p class="review-key-hint">${label("Keys:")} <b>J/K</b> ${label("file")} · <b>N/P</b> ${label("hunk")} · <b>C</b> ${label("comment")}</p></aside><div class="review-resize" role="separator" tabindex="0" aria-label="${label("Resize file list")}" aria-orientation="vertical" aria-valuemin="180" aria-valuemax="520" aria-valuenow="${state.leftWidth}"></div><section class="review-patch" aria-label="${label("File diff")}" data-review-scroll="patch:${d.id}:${state.fileId || "none"}"><div class="review-mobile-back">${button("Back to files", "back-files")}</div>${diffMarkup(state)}</section></div>`;
    const panel = state.tab === "files" ? filePanel : `<div class="review-detail-section">${button("Back to files", "tab:files")}${state.tab === "evidence" ? evidenceMarkup(state) : state.tab === "relationships" ? relationshipMarkup(state) : deliveryMarkup(d)}</div>`;
    return `${toolbar}${error ? `<p role="alert" class="red">${esc(error)}</p>` : ""}<div id="reviewPanel" class="review-panel ${state.split ? "is-split" : "is-unified"}">${panel}</div>`;
  }
  function attach(task, mount, dialog, { token, state, focusReturn }) {
    if (!mount) return { selectFile() {}, showTab() {} };
    state.embedded = !dialog;
    const active = () => generation === token && mount.isConnected;
    let busy = false, error = "", earlierRevisions = [], focusFile = 0, searchTimer;
    let resizing = false;
    const persistUi = () => {
      const key = `${state.changeSetId}:${state.fileId}`;
      if (state.anchor && state.changeSetId && state.fileId) state.drafts[key] = { text: state.draft, anchor: state.anchor };
      else delete state.drafts[key];
      try { localStorage.setItem("atl-review-ui:" + task.id, JSON.stringify({ tab: state.tab, query: state.query, filter: state.filter, expanded: [...state.expanded], fileId: state.fileId, changeSetId: state.changeSetId, explicitRevision: state.explicitRevision, split: state.split, leftWidth: state.leftWidth, scrolls: Object.fromEntries(state.scrolls), draft: state.draft, anchor: state.anchor, drafts: state.drafts })); } catch { /* local storage is optional */ }
    };
    const restoreDraft = () => { const saved = state.drafts[`${state.changeSetId}:${state.fileId}`]; state.anchor = saved?.anchor || null; state.draft = saved?.text || ""; };
    function render() {
      if (!active()) return;
      mount.removeAttribute?.("aria-live"); mount.setAttribute?.("aria-busy", String(busy));
      const scrolls = [...mount.querySelectorAll("[data-review-scroll]")].map((node) => [node.dataset.reviewScroll, node.scrollTop, node.scrollLeft]);
      for (const [key, top, left] of scrolls) state.scrolls.set(key, [top, left]);
      persistUi();
      const dialogBody = mount.closest(".dialogbody"), dialogScroll = dialogBody?.scrollTop;
      const focused = mount.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused?.getAttribute("data-review-action") || focused?.id;
      const selection = focused?.selectionStart;
      const d = state.data, ready = Boolean(d?.id);
      let body = earlierRevisions.length ? `<div class="bar"><label for="reviewRevision">${label("Captured revision")}</label><select id="reviewRevision" class="input" ${busy ? "disabled" : ""}><option value="">${label("Select an earlier inspection")}</option>${earlierRevisions.map((revision) => `<option value="${esc(revision.id)}">${esc(new Date(revision.captured_at).toLocaleString())} · ${esc(revision.output_revision.slice(0, 12))}</option>`).join("")}</select></div>` : "";
      if (d && !ready) body = `<div class="notice"><b>${label(d.availability)}</b><p>${esc(d.message || "")}</p></div>${d.repository || d.workspace ? `<p class="sub">${label("Repository")}: <b>${esc(d.repository || tr("This workspace"))}</b>${d.workspace ? ` · <code class="review-path" dir="ltr">${esc(d.workspace)}</code>` : ""}</p>` : ""}`;
      if (ready) {
        const tabs = reviewTabs;
        const header = `<div class="bar"><span class="pill">${label(d.status)}</span><span>${label("Captured")}: ${esc(new Date(d.captured_at).toLocaleString())}</span></div><details class="review-capture-details"><summary>${label("Capture details")}</summary><p class="review-revisions">${label("Baseline")}: ${code(d.baseline_revision)}<br>${label("Output")}: ${code(d.output_revision)}</p><p class="sub">${label("Captured revisions stay pinned. Capture again to inspect newer source.")}</p></details><label>${label("Captured revision")} <select id="reviewRevision" class="input">${(d.revisions || []).map((revision) => `<option value="${revision.id}" ${revision.id === d.id ? "selected" : ""}>${esc(revision.captured_at)} · ${esc(revision.output_revision.slice(0, 12))}</option>`).join("")}</select></label><div class="bar review-tabs" role="tablist" aria-label="${label("Review sections")}">${tabs.map((tab) => button(tab[0].toUpperCase() + tab.slice(1), `tab:${tab}`, `role="tab" aria-selected="${state.tab === tab}" aria-controls="reviewPanel" id="reviewTab-${tab}" tabindex="${state.tab === tab ? 0 : -1}"`)).join("")}</div>`;
        let panel;
        if (state.tab === "files") {
          const files = d.files.filter((file) => file.path.toLowerCase().includes(state.query.toLowerCase()) && (state.filter === "all" || file.kind === state.filter));
          panel = `<div class="review-files ${state.fileOpen ? "is-file-open" : ""}" style="grid-template-columns:minmax(180px, ${state.leftWidth}px) 8px minmax(0,1fr)"><aside aria-label="${label("Changed files")}"><label for="reviewSearch">${label("Search paths")}</label><input class="input" id="reviewSearch" value="${esc(state.query)}" dir="auto"><label for="reviewFilter">${label("Change type")}</label><select class="input" id="reviewFilter">${["all", "added", "modified", "deleted", "mode_changed"].map((kind) => `<option value="${kind}" ${state.filter === kind ? "selected" : ""}>${label(kind)}</option>`).join("")}</select><p class="muted tiny">${d.files.length} / ${d.matching_files ?? d.total_files} ${label("files loaded")}</p><div class="review-tree" data-review-scroll="tree">${fileTree(files, state) || `<p>${label("No matching files in loaded page.")}</p>`}</div>${d.next_cursor != null ? button("Load more files", "more", busy ? "disabled" : "") : ""}</aside><div class="review-resize" role="separator" tabindex="0" aria-label="${label("Resize file list")}" aria-orientation="vertical" aria-valuemin="180" aria-valuemax="520" aria-valuenow="${state.leftWidth}"></div><section class="review-patch" aria-label="${label("File diff")}" data-review-scroll="patch:${d.id}:${state.fileId || "none"}"><div class="review-mobile-back">${button("Back to files", "back-files")}</div>${diffMarkup(state)}</section></div>`;
        } else if (state.tab === "evidence") panel = evidenceMarkup(state);
        else if (state.tab === "relationships") panel = relationshipMarkup(state);
        else panel = `<h3 dir="auto">${esc(d.title || task.title || "")}</h3><p dir="auto">${esc(d.objective || "")}</p>${d.summary ? `<p dir="auto">${esc(d.summary)}</p>` : ""}${chartMarkup(state)}${deliveryMarkup(d)}<h3>${label("Attention required")}</h3>${(d.attention || []).map((item) => `<div class="notice"><b>${label(item.code)}</b><p dir="auto">${esc(item.reason)}</p></div>`).join("") || `<p>${label("No recorded attention flags. This is not delivery approval.")}</p>`}<p>${label("Changed files")}: ${d.total_files}</p><p>${label("Source")}: ${esc(d.source_kind)} · ${label("Packet revision")}: ${d.packet_revision}</p>${Object.keys(d.input_revisions || {}).length ? `<h3>${label("Imported input revisions")}</h3><pre dir="ltr" data-no-translate>${esc(JSON.stringify(d.input_revisions, null, 2))}</pre>` : ""}`;
        if (state.tab === "files") panel += reviewControlsMarkup(state);
        body = header + (state.tab === "files" ? `<p class="review-summary" dir="auto"><bdi dir="ltr">+${d.additions ?? "?"} / &minus;${d.deletions ?? "?"}</bdi> &middot; ${label("counts for loaded files")} &middot; ${(state.review?.reviewed_files || []).filter((entry) => entry.change_set_id === d.id).length} / ${d.total_files} ${label("reviewed")}</p>` : "") + `<div id="reviewPanel" class="review-panel ${state.split ? "is-split" : "is-unified"}" role="tabpanel" aria-labelledby="reviewTab-${state.tab}" tabindex="0">${panel}</div>`;
      }
      mount.innerHTML = state.embedded && ready ? embeddedReviewMarkup(state, error, busy) : `<div class="bar">${button("Refresh evidence", "refresh", busy ? "disabled" : "")}${button("Capture current changes", "capture", busy || d?.availability === "baseline_missing" ? "disabled" : "")}</div><p class="muted tiny">${label("Capture stores source for inspection. It does not start a worker or approve delivery.")}</p>${busy ? `<p role="status">${label("Loading changes…")}</p>` : ""}${error ? `<p class="red" role="alert">${esc(error)}</p>` : ""}${body}`;
      for (const [key, [top, left]] of state.scrolls) { const node = mount.querySelector(`[data-review-scroll="${key}"]`); if (node) { node.scrollTop = top; node.scrollLeft = left; } }
      if (dialogBody && dialogScroll != null) dialogBody.scrollTop = dialogScroll;
      if (focusKey) {
        const node = [...mount.querySelectorAll("[data-review-action],input,select")].find((element) => (element.getAttribute("data-review-action") || element.id) === focusKey);
        node?.focus({ preventScroll: true });
        if (typeof selection === "number" && node?.setSelectionRange) node.setSelectionRange(selection, selection);
      }
    }
    async function load({ capture = false, id = state.data?.id || state.changeSetId, more = false, pin = false } = {}) {
      if (busy) return;
      busy = true; error = ""; render();
      try {
        const params = new URLSearchParams({ taskId: task.id });
        if (id) params.set("changeSetId", id);
        if (state.query) params.set("q", state.query);
        if (state.filter !== "all") params.set("kind", state.filter);
        if (more) params.set("cursor", state.data.next_cursor);
        const d = capture ? await request("/api/task-changes/capture", { method: "POST", body: JSON.stringify({ task_id: task.id }) }) : await request(`/api/task-changes?${params}`);
        if (!active()) return;
        if (d.id) { try { state.review = await request(`/api/task-review-state?${new URLSearchParams({ taskId: task.id })}`); state.reviewReadError = false; } catch (failure) { error = failure.message; state.reviewReadError = true; } }
        if (more) d.files = [...new Map([...(state.data?.files || []), ...(d.files || [])].map((file) => [file.id, file])).values()];
        else if (d.id && d.id === state.data?.id && (d.query || "") === (state.data.query || "") && (d.filter || "all") === (state.data.filter || "all") && (state.data.files || []).length > (d.files || []).length) { d.files = state.data.files; d.next_cursor = state.data.next_cursor; }
        if (d.id !== state.data?.id) { state.diffs.clear(); }
        state.data = d;
        earlierRevisions = [];
        state.changeSetId = d.id || null;
        if (d.id && (pin || capture)) state.explicitRevision = true;
        restoreDraft();
        persistUi();
      } catch (failure) { if (active()) { error = failure.message; earlierRevisions = failure.revisions || earlierRevisions; } }
      finally { busy = false; render(); }
    }
    async function selectFile(id, changeSetId = null, hunkIndex = null) {
      const requestId = ++focusFile;
      while (busy && active()) await new Promise((resolve) => setTimeout(resolve, 10));
      if (!active() || requestId !== focusFile) return;
      if (changeSetId && state.data?.id !== changeSetId) {
        while (busy && active()) await new Promise((resolve) => setTimeout(resolve, 10));
        if (state.data?.id !== changeSetId) await load({ id: changeSetId });
        if (state.data?.id !== changeSetId) return;
      }
      if (!id) { state.tab = "files"; render(); persistUi(); return; }
      if (!state.data?.id) return;
      persistUi(); state.fileId = id; restoreDraft(); state.fileOpen = true; state.tab = "files"; persistUi(); render();
      const jumpToHunk = () => { if (hunkIndex == null) return; const hunk = mount.querySelectorAll(".diff-hunkbar, .split-hunk")[hunkIndex]; hunk?.scrollIntoView({ block: "start", behavior: "auto" }); };
      if (state.diffs.has(id)) { render(); jumpToHunk(); return; }
      try {
        const pinned = state.data.id;
        const d = await request(`/api/task-change-diff?${new URLSearchParams({ taskId: task.id, changeSetId: pinned, fileId: id })}`);
        if (!active() || state.data.id !== pinned) return;
        state.diffs.set(id, d);
      } catch (failure) { if (active()) state.diffs.set(id, { availability: "unavailable", message: failure.message }); }
      if (requestId === focusFile) { render(); jumpToHunk(); }
    }
    async function navigateFile(step) {
      const files = state.data?.files || [], index = files.findIndex((file) => file.id === state.fileId);
      if (step > 0 && index === files.length - 1 && state.data?.next_cursor != null) await load({ more: true });
      const updated = state.data?.files || [], next = Math.max(0, Math.min(updated.length - 1, index + step));
      if (updated[next]) await selectFile(updated[next].id);
    }
    function navigateHunk(step) {
      const bars = [...mount.querySelectorAll(".diff-hunkbar, .split-hunk")], top = mount.querySelector(".review-patch")?.getBoundingClientRect().top || 0;
      if (!bars.length) return;
      let current = 0;
      bars.forEach((bar, index) => { if (Math.abs(bar.getBoundingClientRect().top - top) < Math.abs(bars[current].getBoundingClientRect().top - top)) current = index; });
      const target = bars[Math.max(0, Math.min(bars.length - 1, current + step))]; target.scrollIntoView({ block: "start", behavior: "auto" }); target.focus?.({ preventScroll: true });
    }
    mount.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-review-action]")?.dataset.reviewAction;
      if (!action) return;
      if (action.startsWith("tab:")) { state.tab = action.slice(4); render(); }
      else if (action === "back-files") { state.fileOpen = false; render(); mount.querySelector("#reviewSearch")?.focus(); }
      else if (action.startsWith("file:")) void selectFile(action.slice(5));
      else if (action === "file-prev" || action === "file-next") void navigateFile(action === "file-next" ? 1 : -1);
      else if (action === "hunk-prev" || action === "hunk-next") navigateHunk(action === "hunk-next" ? 1 : -1);
      else if (["split-toggle", "split-unified", "split-side"].includes(action)) { state.split = action === "split-toggle" ? !state.split : action === "split-side"; persistUi(); render(); }
      else if (action === "comment-file") { state.anchor = { side: "file", line: null }; state.draft = ""; persistUi(); render(); mount.querySelector("#reviewDraft")?.focus(); }
      else if (action.startsWith("reply:")) { state.anchor = { side: "reply", comment_id: action.slice(6) }; state.draft = ""; persistUi(); render(); mount.querySelector("#reviewDraft")?.focus(); }
      else if (action.startsWith("comment-at:")) { const [, side, line] = action.split(":"); state.anchor = { side, line: Number(line) }; state.draft = ""; persistUi(); render(); mount.querySelector("#reviewDraft")?.focus(); }
      else if (action === "comment-cancel") { state.anchor = null; state.draft = ""; persistUi(); render(); }
      else if (action === "comment-save" || action === "file-reviewed" || action.startsWith("resolve:") || action.startsWith("reopen:")) {
        if (state.reviewReadError || state.saving || !state.fileId) return;
        const body = action === "comment-save" ? (state.anchor?.side === "reply" ? { action: "reply", comment_id: state.anchor.comment_id, text: state.draft } : { action: "comment", side: state.anchor?.side, line: state.anchor?.line, text: state.draft }) : action === "file-reviewed" ? { action: "reviewed", file_id: state.fileId, reviewed: !((state.review.reviewed_files || []).some((entry) => entry.key === `${state.data.id}:${state.fileId}`)) } : { action: action.split(":")[0], comment_id: action.slice(action.indexOf(":") + 1) };
        const captureId = state.data.id, fileId = state.fileId, draft = state.draft;
        const payload = { task_id: task.id, change_set_id: captureId, file_id: fileId, expected_revision: state.review.revision || 0, ...body };
        state.saving = true; render();
        try {
          state.review = await request("/api/task-review-state", { method: "PUT", body: JSON.stringify(payload) });
          if (action === "comment-save") {
            const key = `${captureId}:${fileId}`;
            if (state.drafts[key]?.text === draft) delete state.drafts[key];
            if (state.data?.id === captureId && state.fileId === fileId && state.draft === draft) { state.anchor = null; state.draft = ""; }
          }
          state.notice = action === "comment-save" ? tr("Comment saved") : action === "file-reviewed" ? tr("Review status saved") : tr("Thread updated");
          error = ""; persistUi();
        } catch (failure) { error = failure.message; }
        finally { state.saving = false; render(); }
      }
      else if (action.startsWith("node:")) { state.nodeId = action.slice(5); const node = nodes(state).find((entry) => `${entry.kind}:${entry.id}` === state.nodeId); if (node?.kind === "File") void selectFile(node.id); else if (node?.kind === "Evidence") { state.tab = "evidence"; render(); const entry = document.getElementById(node.id); if (entry) { entry.open = true; entry.querySelector("summary")?.focus(); } } else render(); }
      else if (action === "capture") void load({ capture: true });
      else if (action === "refresh") void load();
      else if (action === "more") void load({ more: true });
      else if (action === "diff-copy") {
        const patch = state.diffs.get(state.fileId)?.patch;
        if (patch && navigator.clipboard?.writeText) navigator.clipboard.writeText(patch).then(() => {
          const node = mount.querySelector('[data-review-action="diff-copy"]');
          if (node) { const prior = node.textContent; node.textContent = "Copied ✓"; setTimeout(() => { node.textContent = prior; }, 1400); }
        }).catch(() => {});
      }
    });
    const search = () => { clearTimeout(searchTimer); searchTimer = setTimeout(async () => { while (busy && active()) await new Promise((resolve) => setTimeout(resolve, 10)); if (active()) await load(); }, 180); };
    mount.addEventListener("input", (event) => { if (event.target.id === "reviewSearch") { state.query = event.target.value; persistUi(); render(); search(); } if (event.target.id === "reviewDraft") { state.draft = event.target.value; persistUi(); } });
    mount.addEventListener("scroll", (event) => { const key = event.target.dataset?.reviewScroll; if (key) { state.scrolls.set(key, [event.target.scrollTop, event.target.scrollLeft]); persistUi(); } }, true);
    mount.addEventListener("pointerdown", (event) => { if (event.target.closest(".review-resize")) { resizing = true; event.target.setPointerCapture?.(event.pointerId); event.preventDefault(); } });
    mount.addEventListener("pointermove", (event) => { if (!resizing) return; const grid = mount.querySelector(".review-files"); if (!grid) return; const box = grid.getBoundingClientRect(); const width = document.documentElement.dir === "rtl" ? box.right - event.clientX : event.clientX - box.left; state.leftWidth = Math.max(180, Math.min(520, Math.round(width - 4))); grid.style.gridTemplateColumns = `minmax(180px, ${state.leftWidth}px) 8px minmax(0,1fr)`; mount.querySelector(".review-resize")?.setAttribute("aria-valuenow", String(state.leftWidth)); persistUi(); });
    mount.addEventListener("pointerup", () => { resizing = false; });
    mount.addEventListener("pointercancel", () => { resizing = false; });
    mount.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.target.getAttribute?.("role") === "tab" && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); const index = reviewTabs.indexOf(state.tab);
        state.tab = reviewTabs[event.key === "Home" ? 0 : event.key === "End" ? reviewTabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : reviewTabs.length - 1)) % reviewTabs.length]; render(); mount.querySelector('[aria-selected="true"]')?.focus(); return;
      }
      if (event.target.closest?.(".review-resize")) { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); state.leftWidth = Math.max(180, Math.min(520, state.leftWidth + (event.key === "ArrowRight" ? 20 : -20) * (document.documentElement.dir === "rtl" ? -1 : 1))); const grid = mount.querySelector(".review-files"); if (grid) grid.style.gridTemplateColumns = `minmax(180px, ${state.leftWidth}px) 8px minmax(0,1fr)`; mount.querySelector(".review-resize")?.setAttribute("aria-valuenow", String(state.leftWidth)); persistUi(); } return; }
      if (event.target.matches?.("input, textarea, select, [contenteditable=true]")) return;
      if (["j", "k"].includes(event.key.toLowerCase())) { event.preventDefault(); void navigateFile(event.key.toLowerCase() === "j" ? 1 : -1); }
      else if (["n", "p"].includes(event.key.toLowerCase())) { event.preventDefault(); navigateHunk(event.key.toLowerCase() === "n" ? 1 : -1); }
      else if (event.key.toLowerCase() === "c") { event.preventDefault(); state.anchor = { side: "file", line: null }; state.draft = ""; persistUi(); render(); mount.querySelector("#reviewDraft")?.focus(); }
    });
    mount.addEventListener("change", async (event) => {
      if (event.target.id === "reviewFilter") { state.filter = event.target.value; render(); search(); }
      if (event.target.id !== "reviewRevision" || !event.target.value) return;
      const id = event.target.value;
      persistUi();
      await load({ id, pin: true });
      if (!active() || state.data?.id !== id) return;
      const file = state.data.files.find((entry) => entry.id === state.fileId) || state.data.files[0];
      if (file && state.embedded && state.tab === "files") await selectFile(file.id);
    });
    mount.addEventListener("toggle", (event) => { const key = event.target.dataset.reviewDirectory; if (key) { if (event.target.open) state.expanded.add(key); else state.expanded.delete(key); persistUi(); } }, true);
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
    const ready = load().then(async () => { if (active() && focusFile === 0 && state.data?.id) { const id = state.data.files?.find(file => file.id === state.fileId)?.id || (state.embedded ? state.data.files?.[0]?.id : null); if (id) await selectFile(id); } });
    return { selectFile, ready, showTab: (tab) => { if (reviewTabs.includes(tab)) { state.tab = tab; persistUi(); render(); } } };
  }
  window.ATL_CHANGE_REVIEW = Object.freeze({ open, embed });
})();
