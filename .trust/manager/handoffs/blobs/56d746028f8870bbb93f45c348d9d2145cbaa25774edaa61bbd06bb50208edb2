// Intake adapters: local bullet files, GitHub issues, Azure Boards work items.
// Every adapter returns normalized candidates:
//   { title, objective_hint, completion_checks, priority, risk, labels,
//     resources, source: { type, url, thread, excerpt }, intake_key }
// Dedupe by intake_key is the caller's job (state.tasks[*].intake_key).

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { extractResources, normalizeResource } from "./resources.mjs";

export class IntakeError extends Error {}

// ---------- shared HTTP (no dependencies; TLS opt-out for self-hosted servers)

function requestJson(urlString, { method = "GET", headers = {}, body = null, allowUntrusted = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers: { "Accept": "application/json", ...headers },
        rejectUnauthorized: !allowUntrusted,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { /* keep raw */ }
          if (!ok) {
            const msg = parsed && parsed.message ? parsed.message : String(data).slice(0, 300);
            reject(new IntakeError(`HTTP ${res.statusCode} from ${u.host}: ${msg}`));
          } else {
            resolve(parsed);
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

const normalizePriority = (s) => {
  const v = String(s || "").toLowerCase();
  if (["urgent", "critical", "p1", "1"].includes(v)) return "urgent";
  if (["high", "important", "p2", "2"].includes(v)) return "high";
  if (["low", "p4", "4"].includes(v)) return "low";
  return "normal";
};

// ---------- adapter: local markdown inbox

// Format (documented in runtime/README.md):
//   ## Task title          <- starts a task
//   @source: <url or note> <- optional metadata lines
//   @priority: high
//   @risk: risky
//   Checks:                <- optional; bullets below become completion checks
//   - observable check one
// A plain "- [ ] Title" line (no heading) becomes a minimal task.
export function parseIntakeFile(text, fileLabel) {
  const tasks = [];
  const lines = text.split(/\r?\n/);

  let current = null;
  let inChecks = false;
  let inResources = false;
  const flush = () => {
    if (current && current.title) tasks.push(current);
    current = null;
    inChecks = false;
    inResources = false;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
    const checkbox = line.match(/^[-*]\s+\[ \]\s+(.+?)\s*$/);
    const meta = line.match(/^@(\w+):\s*(.+?)\s*$/);
    const checkBullet = line.trimStart().match(/^[-*]\s+(.+?)\s*$/);

    if (heading) {
      flush();
      current = {
        title: heading[1], objective_hint: "", completion_checks: [],
        priority: "normal", risk: "normal", labels: [],
        resources: [],
        source: { type: "file", url: fileLabel, thread: fileLabel, excerpt: "" },
        intake_key: `${fileLabel}#${heading[1]}`,
      };
    } else if (checkbox && !current) {
      current = {
        title: checkbox[1], objective_hint: "", completion_checks: [],
        priority: "normal", risk: "normal", labels: [],
        resources: [],
        source: { type: "file", url: fileLabel, thread: fileLabel, excerpt: "" },
        intake_key: `${fileLabel}#${checkbox[1]}`,
      };
    } else if (current && meta) {
      const key = meta[1].toLowerCase();
      if (key === "source") current.source.url = meta[2];
      else if (key === "priority") current.priority = normalizePriority(meta[2]);
      else if (key === "risk") current.risk = meta[2].toLowerCase() === "risky" ? "risky" : "normal";
      else if (key === "labels") current.labels = meta[2].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (current && /^resources?:\s*$/i.test(line)) {
      inResources = true;
      inChecks = false;
    } else if (current && /^checks?:\s*$/i.test(line)) {
      inChecks = true;
      inResources = false;
    } else if (current && inResources && line) {
      const resourceLine = line.replace(/^\s*[-*]\s+/, "").trim();
      const extracted = extractResources(resourceLine, { source: current.source.type });
      if (extracted.length) current.resources.push(...extracted);
      else {
        const resource = normalizeResource(resourceLine, { source: current.source.type });
        if (resource && !current.resources.some((item) => item.ref === resource.ref)) current.resources.push(resource);
      }
    } else if (current && inChecks && checkBullet && (raw.startsWith("  ") || raw.trimStart().startsWith("-") || raw.trimStart().startsWith("*"))) {
      current.completion_checks.push(checkBullet[1].replace(/^\[\s*[xX]?\s*\]\s*/, ""));
    } else if (current && line && !inChecks) {
      current.objective_hint += (current.objective_hint ? " " : "") + line.trim();
      for (const resource of extractResources(line, { source: current.source.type })) {
        if (!current.resources.some((item) => item.ref === resource.ref)) current.resources.push(resource);
      }
    } else if (current && line && inChecks) {
      inChecks = false;
      current.objective_hint += (current.objective_hint ? " " : "") + line.trim();
      for (const resource of extractResources(line, { source: current.source.type })) {
        if (!current.resources.some((item) => item.ref === resource.ref)) current.resources.push(resource);
      }
    }
  }
  flush();
  return tasks;
}

export function intakeFromFiles(cfg) {
  const dir = cfg.inbox_dir;
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".md")).sort()) {
    const full = path.join(dir, f);
    for (const t of parseIntakeFile(fs.readFileSync(full, "utf8"), f)) out.push(t);
  }
  return out;
}

// ---------- adapter: GitHub issues

// `owner/name` from "https://github.com/owner/name.git", "owner/name/issues", …
export function normalizeGitHubRepo(entry) {
  return String(entry || "").trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/issues$/i, "")
    .replace(/\/+$/, "");
}

async function ghCliList(repo) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout } = await run("gh", [
    "issue", "list", "-R", repo, "--state", "open", "--limit", "50",
    "--json", "number,title,url,labels,body",
  ]);
  return JSON.parse(stdout);
}

async function ghRestList(repo) {
  const headers = { "User-Agent": "atl-manager" };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  let data;
  try {
    data = await requestJson(`https://api.github.com/repos/${repo}/issues?state=open&per_page=50`, { headers });
  } catch (err) {
    if (/\b404\b/.test(err.message) && !token) {
      throw new IntakeError(
        `GitHub returned 404 for ${repo}. On an unauthenticated request this usually means the repo is private.\n` +
        `  Fix: run "gh auth login", or set GITHUB_TOKEN=<token with repo read access>, then re-run intake.`
      );
    }
    throw err;
  }
  return data
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number, title: i.title, url: i.html_url,
      labels: (i.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
      body: i.body || "",
    }));
}

export async function intakeFromGitHub(ghCfg) {
  const out = [];
  for (const entry of ghCfg.repos || []) {
    const repo = normalizeGitHubRepo(entry);
    let issues;
    try {
      issues = await ghCliList(repo);
    } catch {
      issues = await ghRestList(repo); // unauthenticated works for public repos
    }
    for (const i of issues) {
      const labels = (i.labels || []).map(String);
      const priority = normalizePriority(labels.find((l) => /^(urgent|critical|high|p1|p2)$/i.test(l)) || "");
      out.push({
        title: `#${i.number} ${i.title}`,
        objective_hint: String(i.body || "").slice(0, 800),
        completion_checks: [],
        priority, risk: "normal", labels,
        source: { type: "github", url: i.url, thread: i.url, repo, excerpt: String(i.body || "").slice(0, 300) },
        resources: extractResources(i.body || "", { source: "github", baseUrl: i.url }),
        intake_key: i.url,
      });
    }
  }
  return out;
}

export async function ghCliAuthenticated() {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)("gh", ["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

// Live reachability probe used by `atl intake enable github` so a private-repo
// 404 surfaces at enable time with the fix, not at intake time. Walks the same
// gh-CLI-then-REST path the adapter itself uses.
export async function probeGitHubRepo(repo) {
  const auth = { gh_cli: await ghCliAuthenticated(), token: Boolean(process.env.GITHUB_TOKEN) };
  try {
    const issues = await ghCliList(repo);
    return { ok: true, via: "gh cli", open_issues: issues.length, ...auth };
  } catch {
    try {
      const issues = await ghRestList(repo);
      return { ok: true, via: auth.token ? "GITHUB_TOKEN" : "anonymous (public repo)", open_issues: issues.length, ...auth };
    } catch (err) {
      return { ok: false, error: err.message, ...auth };
    }
  }
}

// ---------- adapter: Azure Boards (self-hosted Azure DevOps Server compatible)

// cfg: { org_url (includes collection), project, iteration_path, token_env,
//        types, wiql, tls_allow_untrusted }
export async function intakeFromAzure(cfg) {
  const tokenEnv = cfg.token_env || "AZDO_PAT";
  const pat = process.env[tokenEnv];
  if (!pat) {
    throw new IntakeError(
      `Azure intake needs a personal access token in the ${tokenEnv} environment variable.\n` +
      `  1. On ${new URL(cfg.org_url).host} create a PAT (Work Items: Read).\n` +
      `  2. set ${tokenEnv}=<token>   (PowerShell: $env:${tokenEnv}="<token>")\n` +
      `  3. re-run: node runtime\\atl-manager.mjs intake --source azure`
    );
  }
  const auth = "Basic " + Buffer.from(":" + pat).toString("base64");
  const base = `${cfg.org_url.replace(/\/$/, "")}/${cfg.project}`;
  const headers = { Authorization: auth, "Content-Type": "application/json" };
  const tls = { allowUntrusted: !!cfg.tls_allow_untrusted };

  const iteration = cfg.iteration_path || `${cfg.project}\\${cfg.sprint || "Current"}`;
  const wiql =
    cfg.wiql ||
    `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${cfg.project}' ` +
    `AND [System.IterationPath] = '${iteration.replace(/'/g, "''")}' ` +
    `AND [System.WorkItemType] IN (${(cfg.types || ["Task", "Bug", "User Story"]).map((t) => `'${t}'`).join(", ")})`;

  const query = await requestJson(`${base}/_apis/wit/wiql?api-version=6.0`, {
    method: "POST", headers, body: { query: wiql }, ...tls,
  });
  const ids = (query.workItems || []).map((w) => w.id).slice(0, 100);
  if (ids.length === 0) return [];

  const batch = await requestJson(`${base}/_apis/wit/workitemsbatch?api-version=6.0`, {
    method: "POST",
    headers,
    body: { ids, fields: ["System.Id", "System.Title", "System.State", "System.WorkItemType", "System.AssignedTo", "Microsoft.VSTS.Common.Priority", "System.Description"], "$expand": "Relations" },
    ...tls,
  });

  return (batch.value || []).map((w) => {
    const f = w.fields || {};
    const assigned = f["System.AssignedTo"] && f["System.AssignedTo"].displayName;
    const description = String(f["System.Description"] || "");
    return {
      title: `${f["System.WorkItemType"]} ${w.id}: ${f["System.Title"]}`,
      objective_hint: description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 800),
      completion_checks: [],
      priority: normalizePriority(String(f["Microsoft.VSTS.Common.Priority"] || "")),
      risk: f["System.WorkItemType"] === "Bug" ? "normal" : "normal",
      labels: [f["System.State"], assigned ? `assigned:${assigned}` : "unassigned"].filter(Boolean),
      source: {
        type: "azure",
        url: `${base}/_workitems/edit/${w.id}`,
        thread: `${cfg.org_url}/${cfg.project}/_workitems/edit/${w.id}`,
        project: cfg.project, iteration,
        excerpt: String(f["System.Title"] || ""),
      },
      resources: [
        ...extractResources(description, { source: "azure", baseUrl: `${base}/_workitems/edit/${w.id}` }),
        ...(w.relations || [])
          .filter((relation) => relation && relation.url && (!relation.rel || /attachedfile|hyperlink/i.test(relation.rel)))
          .map((relation) => normalizeResource(relation.url, {
            label: relation.attributes?.name || relation.attributes?.comment || "Azure attachment",
            source: "azure",
          })),
      ].filter(Boolean),
      intake_key: `azure:${cfg.project}:${w.id}:${f["System.Rev"] || 0}`,
    };
  });
}

// ---------- top-level intake

export async function runIntake(cfg, which = "all") {
  const results = [];
  const sources = cfg.intake || {};
  const want = (name) => which === "all" || which === name;

  if (want("file") && (sources.file?.enabled !== false)) {
    results.push({ source: "file", tasks: intakeFromFiles({ inbox_dir: cfg.inbox_dir }) });
  }
  if (want("github") && sources.github?.enabled) {
    results.push({ source: "github", tasks: await intakeFromGitHub(sources.github) });
  }
  if (want("azure") && sources.azure?.enabled) {
    results.push({ source: "azure", tasks: await intakeFromAzure(sources.azure) });
  }
  return results;
}
