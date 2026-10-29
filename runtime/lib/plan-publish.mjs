import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadPlanDraft, planningEvidence } from "./plan-studio.mjs";
import { loadState } from "./state.mjs";
import { readManagerConfig } from "./launch.mjs";
import { normalizeGitHubRepo } from "./intake.mjs";

function fingerprint(artifact, intent, evidence) {
  return crypto.createHash("sha256").update(JSON.stringify({ artifact, intent, evidence })).digest("hex");
}

function assertReviewed(root, draft) {
  const artifact = draft.artifact;
  const review = draft.review || artifact?.review;
  const evidence = { project: planningEvidence(root, artifact), source_revision: review?.source_revision || null };
  if (artifact?.plan_contract_version !== 2 || review?.verdict !== "passed" || review.fingerprint !== fingerprint({ ...artifact, review: undefined }, draft.intent, evidence)) {
    throw new Error("Publishing blocked: the plan needs a fresh, passing accuracy review");
  }
}

function issueBody(proposal, intent) {
  return `${proposal.objective}\n\nOriginal request:\n${intent}\n\nCompletion checks:\n${proposal.completion_checks.map((item) => `- ${item}`).join("\n")}`;
}

function azureDescription(text) {
  return `<p>${String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>")}</p>`;
}

async function callJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) throw new Error(`Remote request failed (${response.status}): ${body.message || response.statusText}`);
  return body;
}

function readEnvelope(draft) {
  const file = path.join(draft.dir, "artifact.json");
  return { file, envelope: JSON.parse(fs.readFileSync(file, "utf8")) };
}

export async function verifyImportedSource(root, taskId, { fetchImpl = globalThis.fetch } = {}) {
  const task = loadState(root).tasks[String(taskId || "")];
  if (!task || !["github", "azure", "jira"].includes(task.source?.type)) throw new Error("source task is missing or is not a GitHub/Azure/Jira import");
  const source = task.source;
  if (!source.remote_id || !source.revision) throw new Error("imported source has no captured remote identity and revision; refresh the intake before review");
  let currentRevision;
  if (source.type === "github") {
    const repo = normalizeGitHubRepo(source.repo || "");
    if (!process.env.GITHUB_TOKEN) throw new Error("checking imported GitHub revision needs GITHUB_TOKEN");
    const current = await callJson(fetchImpl, `https://api.github.com/repos/${repo}/issues/${source.remote_id}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "atl-manager" } });
    currentRevision = current.updated_at;
  } else if (source.type === "jira") {
    const cfg = readManagerConfig(root).intake?.jira;
    const tokenEnv = cfg?.token_env || "JIRA_TOKEN", token = process.env[tokenEnv];
    if (!cfg?.base_url || !token) throw new Error(`checking imported Jira revision needs configured intake.jira and ${tokenEnv}`);
    const base = new URL(cfg.base_url);
    if (base.protocol !== "https:") throw new Error("Jira base URL must use HTTPS");
    const current = await callJson(fetchImpl, new URL(`rest/api/2/issue/${encodeURIComponent(source.remote_id)}?fields=updated`, base.href.endsWith("/") ? base : `${base.href}/`).href, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    currentRevision = current.fields?.updated;
  } else {
    const cfg = readManagerConfig(root).intake?.azure;
    const tokenEnv = cfg?.token_env || "AZDO_PAT";
    const token = process.env[tokenEnv];
    if (!cfg?.org_url || !cfg.project || !token) throw new Error(`checking imported Azure revision needs configured intake.azure and ${tokenEnv}`);
    const base = `${cfg.org_url.replace(/\/$/, "")}/${encodeURIComponent(cfg.project)}`;
    const current = await callJson(fetchImpl, `${base}/_apis/wit/workitems/${source.remote_id}?api-version=6.0`, { headers: { Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`, "Content-Type": "application/json" } });
    currentRevision = String(current.rev);
  }
  const captured = String(source.revision);
  if (String(currentRevision) !== captured) throw new Error(`imported ${source.type} item ${source.remote_id} changed since intake (${captured} → ${currentRevision}); refresh it and generate the plan again`);
  return { current: true, type: source.type, remote_id: String(source.remote_id), revision: captured, url: source.url || null };
}

export async function previewPlanPublish(root, draftId, destination, { fetchImpl = globalThis.fetch } = {}) {
  const draft = loadPlanDraft(root, draftId);
  assertReviewed(root, draft);
  if (draft.source_task_id) {
    const current = await verifyImportedSource(root, draft.source_task_id, { fetchImpl });
    const reviewed = draft.review?.source_revision || draft.artifact.review?.source_revision;
    if (!reviewed?.current || current.remote_id !== reviewed.remote_id || current.revision !== reviewed.revision) throw new Error("imported source changed after review; refresh the plan before publishing");
  }
  if (!destination || !["github", "azure"].includes(destination.type)) throw new Error("destination type must be github or azure");
  const rows = draft.artifact.task_proposals.map((proposal) => ({ proposal_id: proposal.id, title: proposal.title, body: issueBody(proposal, draft.intent) }));
  let target;
  if (destination.type === "github") {
    const repo = normalizeGitHubRepo(destination.repo || "");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("GitHub destination needs owner/repository");
    if (!process.env.GITHUB_TOKEN) throw new Error("GitHub publishing needs GITHUB_TOKEN with issue write permission");
    target = { type: "github", repo };
  } else {
    const cfg = readManagerConfig(root).intake?.azure;
    if (!cfg?.org_url || !cfg?.project) throw new Error("Azure publishing needs configured intake.azure org_url and project");
    if (new URL(cfg.org_url).protocol !== "https:") throw new Error("Azure publishing requires an HTTPS org_url because it sends a PAT");
    const tokenEnv = cfg.token_env || "AZDO_PAT";
    const token = process.env[tokenEnv];
    if (!token) throw new Error(`Azure publishing needs a PAT in ${tokenEnv}`);
    target = { type: "azure", org_url: cfg.org_url, project: cfg.project, tokenEnv };
  }
  const reviewed = draft.review || draft.artifact.review;
  const { envelope } = readEnvelope(draft);
  const items = [];
  for (const { proposal_id, title } of rows) {
    const mapped = envelope.published_items?.[`${target.type}:${proposal_id}`] || null;
    if (mapped && target.type === "github") {
      const current = await callJson(fetchImpl, `https://api.github.com/repos/${target.repo}/issues/${mapped.id}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "atl-manager" } });
      if (current.updated_at !== mapped.remote_revision) throw new Error(`GitHub issue #${mapped.id} changed remotely; reconcile it before publishing task ${proposal_id}`);
    } else if (mapped && target.type === "azure") {
      const token = process.env[target.tokenEnv];
      const base = `${target.org_url.replace(/\/$/, "")}/${encodeURIComponent(target.project)}`;
      const current = await callJson(fetchImpl, `${base}/_apis/wit/workitems/${mapped.id}?api-version=6.0`, { headers: { Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`, "Content-Type": "application/json" } });
      if (current.rev !== mapped.remote_revision) throw new Error(`Azure work item ${mapped.id} changed remotely; reconcile it before publishing task ${proposal_id}`);
    }
    items.push({ proposal_id, title, action: mapped ? "update" : "create", remote_id: mapped?.id || null, remote_url: mapped?.url || null });
  }
  const token = crypto.createHash("sha256").update(JSON.stringify({ draftId, target, rows, items, review: reviewed.fingerprint })).digest("hex");
  return { draftId, destination: target, items, token, writes: false };
}

export async function publishPlan(root, draftId, destination, previewToken, { confirm = false, fetchImpl = globalThis.fetch } = {}) {
  if (!confirm) throw new Error("publishing requires explicit confirmation");
  const preview = await previewPlanPublish(root, draftId, destination, { fetchImpl });
  if (!previewToken || preview.token !== previewToken) throw new Error("publish preview is stale; review the current destination and preview again");
  const draft = loadPlanDraft(root, draftId);
  const { file, envelope } = readEnvelope(draft);
  envelope.published_items ||= {};
  const results = [];
  for (const proposal of draft.artifact.task_proposals) {
    const existing = envelope.published_items[`${preview.destination.type}:${proposal.id}`] || null;
    const title = proposal.title;
    const body = issueBody(proposal, draft.intent);
    let remote;
    if (preview.destination.type === "github") {
      const repo = preview.destination.repo;
      const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "atl-manager" };
      if (!existing) remote = await callJson(fetchImpl, `https://api.github.com/repos/${repo}/issues`, { method: "POST", headers, body: JSON.stringify({ title, body }) });
      else {
        const current = await callJson(fetchImpl, `https://api.github.com/repos/${repo}/issues/${existing.id}`, { headers });
        if (current.updated_at !== existing.remote_revision) throw new Error(`GitHub issue #${existing.id} changed remotely; reconcile it before publishing task ${proposal.id}`);
        remote = await callJson(fetchImpl, `https://api.github.com/repos/${repo}/issues/${existing.id}`, { method: "PATCH", headers, body: JSON.stringify({ title, body }) });
      }
      envelope.published_items[`${preview.destination.type}:${proposal.id}`] = { id: remote.number, url: remote.html_url, remote_revision: remote.updated_at };
    } else {
      const cfg = readManagerConfig(root).intake.azure;
      const token = process.env[preview.destination.tokenEnv];
      const base = `${preview.destination.org_url.replace(/\/$/, "")}/${encodeURIComponent(preview.destination.project)}`;
      const headers = { Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`, "Content-Type": "application/json-patch+json" };
      if (!existing) remote = await callJson(fetchImpl, `${base}/_apis/wit/workitems/$Task?api-version=6.0`, { method: "POST", headers, body: JSON.stringify([{ op: "add", path: "/fields/System.Title", value: title }, { op: "add", path: "/fields/System.Description", value: azureDescription(body) }]) });
      else {
        const current = await callJson(fetchImpl, `${base}/_apis/wit/workitems/${existing.id}?api-version=6.0`, { headers: { ...headers, "Content-Type": "application/json" } });
        if (current.rev !== existing.remote_revision) throw new Error(`Azure work item ${existing.id} changed remotely; reconcile it before publishing task ${proposal.id}`);
        remote = await callJson(fetchImpl, `${base}/_apis/wit/workitems/${existing.id}?api-version=6.0`, { method: "PATCH", headers, body: JSON.stringify([{ op: "add", path: "/fields/System.Title", value: title }, { op: "add", path: "/fields/System.Description", value: azureDescription(body) }]) });
      }
      envelope.published_items[`${preview.destination.type}:${proposal.id}`] = { id: remote.id, url: remote.url, remote_revision: remote.rev };
    }
    fs.writeFileSync(file, JSON.stringify(envelope, null, 2) + "\n");
    results.push({ proposal_id: proposal.id, ...envelope.published_items[`${preview.destination.type}:${proposal.id}`] });
  }
  return { destination: preview.destination, results };
}
