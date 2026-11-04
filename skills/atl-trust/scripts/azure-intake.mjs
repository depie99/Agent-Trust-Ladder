#!/usr/bin/env node
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
        try { parsed = data ? JSON.parse(data) : null; } catch { /* retain the HTTP error below */ }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} from ${url.host}: ${parsed?.message || data.slice(0, 300)}`));
        } else {
          resolve(parsed);
        }
      });
    });
    request.on("error", reject);
    if (body) request.write(typeof body === "string" ? body : JSON.stringify(body));
    request.end();
  });
}

function priority(value) {
  const normalized = String(value || "").toLowerCase();
  if (["urgent", "critical", "p1", "1"].includes(normalized)) return "urgent";
  if (["high", "important", "p2", "2"].includes(normalized)) return "high";
  if (["low", "p4", "4"].includes(normalized)) return "low";
  return "normal";
}

function normalizedConfig(cfg) {
  const organization = new URL(String(cfg.org_url || ""));
  if (organization.protocol !== "https:" || organization.username || organization.password || organization.search || organization.hash || /\/_workitems|\/_sprints/i.test(organization.pathname)) {
    throw new Error("Azure collection URL must be a plain HTTPS URL before the project or taskboard path");
  }
  const project = String(cfg.project || "").trim();
  if (!project || project.length > 128 || /[\\/\r\n]/.test(project)) throw new Error("Azure project name is required");
  const iteration = String(cfg.iteration_path || `${project}\\${cfg.sprint || "Current"}`).trim();
  const tokenEnv = String(cfg.token_env || "AZDO_PAT").trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(tokenEnv)) throw new Error("Azure token environment variable name is invalid");
  const base = `${organization.href.replace(/\/$/, "")}/${encodeURIComponent(project)}`;
  return { organization, project, iteration, tokenEnv, base, repository: cfg.repository || null };
}

export function azureQuery(cfg) {
  const normalized = normalizedConfig(cfg);
  return cfg.wiql || `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${normalized.project.replace(/'/g, "''")}' `
    + `AND [System.IterationPath] = '${normalized.iteration.replace(/'/g, "''")}' `
    + `AND [System.WorkItemType] IN (${(cfg.types || ["Task", "Bug", "User Story"]).map((type) => `'${String(type).replace(/'/g, "''")}'`).join(", ")})`;
}

export function normalizeAzureWorkItem(workItem, cfg, { frozen = false, resourceMapper = () => [] } = {}) {
  const normalized = normalizedConfig(cfg);
  const fields = workItem.fields || {};
  const assigned = fields["System.AssignedTo"]?.displayName || null;
  const description = String(fields["System.Description"] || "");
  return {
    title: `${fields["System.WorkItemType"] || "Work item"} ${workItem.id}: ${fields["System.Title"] || "Untitled"}`,
    objective_hint: description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 800),
    completion_checks: [],
    priority: priority(fields["Microsoft.VSTS.Common.Priority"]),
    risk: "normal",
    labels: [fields["System.State"], assigned ? `assigned:${assigned}` : "unassigned"].filter(Boolean),
    source: {
      type: "azure",
      url: `${normalized.base}/_workitems/edit/${workItem.id}`,
      thread: `${normalized.organization.href.replace(/\/$/, "")}/${normalized.project}/_workitems/edit/${workItem.id}`,
      project: normalized.project,
      iteration: normalized.iteration,
      remote_id: workItem.id,
      revision: fields["System.Rev"] || null,
      excerpt: String(fields["System.Title"] || ""),
      repository: normalized.repository,
      frozen,
    },
    resources: resourceMapper(workItem, normalized),
    intake_key: `azure:${normalized.organization.href.replace(/\/$/, "")}:${normalized.project}:${workItem.id}:${fields["System.Rev"] || 0}`,
  };
}

export function azureTasksFromExport(value, cfg) {
  const items = Array.isArray(value) ? value : Array.isArray(value?.value) ? value.value : [value];
  return items.filter((item) => item && typeof item === "object").map((item) => normalizeAzureWorkItem(item, cfg, { frozen: true }));
}

export async function fetchAzureTasks(cfg, { requestImpl = requestJson, env = process.env, resourceMapper = () => [] } = {}) {
  const normalized = normalizedConfig(cfg);
  const token = env[normalized.tokenEnv];
  if (!token) throw new Error(`Azure intake needs a personal access token in the ${normalized.tokenEnv} environment variable`);
  const headers = {
    Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
  const tls = { allowUntrusted: Boolean(cfg.tls_allow_untrusted) };
  const query = await requestImpl(`${normalized.base}/_apis/wit/wiql?api-version=6.0`, {
    method: "POST",
    headers,
    body: { query: azureQuery(cfg) },
    ...tls,
  });
  const ids = (query?.workItems || []).map((item) => item.id).slice(0, 100);
  if (!ids.length) return [];
  const batch = await requestImpl(`${normalized.base}/_apis/wit/workitemsbatch?api-version=6.0`, {
    method: "POST",
    headers,
    body: {
      ids,
      fields: ["System.Id", "System.Rev", "System.Title", "System.State", "System.WorkItemType", "System.AssignedTo", "Microsoft.VSTS.Common.Priority", "System.Description"],
      "$expand": "Relations",
    },
    ...tls,
  });
  return (batch?.value || []).map((item) => normalizeAzureWorkItem(item, cfg, { frozen: false, resourceMapper }));
}

function sourceIdentity(candidate) {
  const source = candidate?.source || candidate || {};
  return `${source.project || ""}:${source.remote_id ?? ""}`;
}

export function reconcileAzureTasks(existingTasks, candidates) {
  const existing = new Map();
  for (const task of Object.values(existingTasks || {})) {
    if (task.source?.type !== "azure") continue;
    existing.set(sourceIdentity(task.source), task);
  }
  const result = { create: [], unchanged: [], changed: [] };
  for (const candidate of candidates) {
    const prior = existing.get(sourceIdentity(candidate));
    if (!prior) result.create.push(candidate);
    else if (prior.intake_key === candidate.intake_key || String(prior.source?.revision) === String(candidate.source?.revision)) result.unchanged.push({ candidate, task_id: prior.id });
    else {
      const ownerReview = ["in_progress", "in_review", "verifying"].includes(prior.status);
      result.changed.push({ candidate, task_id: prior.id, action: ownerReview ? "preserve-and-review" : "reconcile-source" });
    }
  }
  return result;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function writeJson(file, value) {
  const target = path.resolve(file);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function main(args) {
  const command = args[0];
  if (command === "preview") {
    const config = readJson(args[1] || "azure-intake.json");
    const tasks = await fetchAzureTasks(config);
    writeJson(option(args, "--output") || "azure-intake-preview.json", { version: 1, source: "azure", live: true, tasks });
    return 0;
  }
  if (command === "from-export") {
    const exported = readJson(args[1]);
    const cfg = {
      org_url: option(args, "--org-url"),
      project: option(args, "--project"),
      iteration_path: option(args, "--iteration-path"),
      repository: option(args, "--repository"),
    };
    const tasks = azureTasksFromExport(exported, cfg);
    writeJson(option(args, "--output") || "azure-intake-export.json", { version: 1, source: "azure", live: false, frozen: true, tasks });
    return 0;
  }
  process.stderr.write("Usage: azure-intake.mjs preview <config.json> [--output file] | from-export <export.json> --org-url <url> --project <name> [--iteration-path path] [--repository repo] [--output file]\n");
  return 64;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
