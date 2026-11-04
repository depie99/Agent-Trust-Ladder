#!/usr/bin/env node
// Read-only Azure Boards proof for issue #17/#20.
//
// Runs the same live work-item read through both supported entry points:
//   control plane -> runtime/lib/intake.mjs intakeFromAzure
//   skills only   -> skills/atl/scripts/azure-intake.mjs fetchAzureTasks
// and writes one redacted record that can be attached to the issue.
//
// The script never writes to Azure. It performs the WIQL query and the
// work-items batch that Azure Boards requires for a read, then stops.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { intakeFromAzure } from "../runtime/lib/intake.mjs";
import { fetchAzureTasks } from "../skills/atl/scripts/azure-intake.mjs";

export const LIVE_CHECK_SCHEMA = 1;

const digest = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 16);

export function readAzureConfig(root, overrides = {}) {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(root, "config", "manager.json"), "utf8"));
  } catch {
    // A project without manager config still works when flags supply everything.
  }
  const stored = config?.intake?.azure || config?.azure || {};
  const supplied = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const merged = { ...stored, ...supplied };
  const orgUrl = String(merged.org_url || "").trim();
  if (!orgUrl) throw new Error("No Azure collection URL: pass --org-url or set intake.azure.org_url in config/manager.json");
  const project = String(merged.project || "").trim();
  if (!project) throw new Error("Azure project name is required: pass --project or set intake.azure.project");
  return {
    org_url: orgUrl,
    project,
    iteration_path: String(merged.iteration_path || `${project}\\Current`).trim(),
    token_env: String(merged.token_env || "AZDO_PAT").trim(),
    tls_allow_untrusted: merged.tls_allow_untrusted === true,
    types: merged.types,
    repository: merged.repository || null,
  };
}

export function redactItem(item) {
  const source = item?.source || {};
  const title = String(item?.title || "");
  return {
    remote_id: source.remote_id ?? null,
    revision: source.revision ?? null,
    intake_key: item?.intake_key || null,
    title_sha256: digest(title),
    title_length: title.length,
    work_item_type: title.split(" ").slice(0, 2).join(" ").replace(/:\s*$/, "") || null,
    frozen: source.frozen === true,
  };
}

function identity(record) {
  return `${record?.intake_key || ""}|${record?.title_sha256 || ""}|${record?.revision ?? ""}`;
}

export function compareSurfaces(controlPlane, skillsOnly) {
  const left = new Map((controlPlane || []).map((item) => [String(item?.source?.remote_id ?? ""), redactItem(item)]));
  const right = new Map((skillsOnly || []).map((item) => [String(item?.source?.remote_id ?? ""), redactItem(item)]));
  const differences = [];
  for (const [id, item] of left) {
    if (!right.has(id)) differences.push({ remote_id: id, field: "presence", control_plane: item.intake_key, skills_only: null });
  }
  for (const [id, item] of right) {
    const peer = left.get(id);
    if (!peer) { differences.push({ remote_id: id, field: "presence", control_plane: null, skills_only: item.intake_key }); continue; }
    if (identity(peer) !== identity(item)) {
      differences.push({
        remote_id: id,
        field: peer.revision !== item.revision ? "revision" : peer.title_sha256 !== item.title_sha256 ? "title" : "intake_key",
        control_plane: identity(peer),
        skills_only: identity(item),
      });
    }
  }
  return {
    same_item_count: left.size === right.size,
    same_identity: differences.length === 0,
    control_plane_items: left.size,
    skills_only_items: right.size,
    differences,
  };
}

export async function runAzureLiveCheck({
  cfg,
  env = process.env,
  itemId = null,
  requestImpls = {},
  root = process.cwd(),
  now = () => new Date().toISOString(),
} = {}) {
  const tokenEnv = cfg?.token_env || "AZDO_PAT";
  if (!env[tokenEnv]) {
    const error = new Error(`Azure live check needs a personal access token in ${tokenEnv}`);
    error.code = "ATL_AZURE_TOKEN_MISSING";
    error.gate = "open";
    throw error;
  }
  const pick = (list) => {
    const items = Array.isArray(list) ? list : [];
    if (itemId == null) return items;
    return items.filter((item) => String(item?.source?.remote_id) === String(itemId));
  };
  const controlPlane = pick(await intakeFromAzure(cfg, { requestImpl: requestImpls.controlPlane }));
  const skillsOnly = pick(await fetchAzureTasks(cfg, { requestImpl: requestImpls.skillsOnly, env }));
  const parity = compareSurfaces(controlPlane, skillsOnly);
  const selected = controlPlane[0] || skillsOnly[0] || null;
  if (itemId != null && !selected) throw new Error(`Work item ${itemId} is not returned by iteration ${cfg.iteration_path}`);
  return {
    schema: LIVE_CHECK_SCHEMA,
    kind: "atl-azure-live-check",
    captured_at: now(),
    root: path.basename(path.resolve(root)),
    host: {
      org_url: cfg.org_url,
      project: cfg.project,
      iteration_path: cfg.iteration_path,
      auth: `${tokenEnv} (personal access token, Work Items: Read)`,
      tls_allow_untrusted: cfg.tls_allow_untrusted === true,
      remote_mutation: "none: WIQL query and work-items batch are read-only calls",
    },
    item: selected ? redactItem(selected) : null,
    surfaces: {
      control_plane: { entry: "runtime/lib/intake.mjs intakeFromAzure (Issue Sources preview adapter)", items: parity.control_plane_items },
      skills_only: { entry: "skills/atl/scripts/azure-intake.mjs fetchAzureTasks", items: parity.skills_only_items },
    },
    parity,
    gate: selected && parity.same_identity ? "passed" : "failed",
  };
}

export function renderLiveCheckMarkdown(record) {
  const lines = [
    `# Azure live read-only check — ${record.captured_at}`,
    "",
    `Gate: **${record.gate}**`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Collection | ${record.host.org_url} |`,
    `| Project | ${record.host.project} |`,
    `| Iteration | ${record.host.iteration_path} |`,
    `| Auth | ${record.host.auth} |`,
    `| TLS | ${record.host.tls_allow_untrusted ? "untrusted certificate allowed for this self-hosted server" : "verified certificate"} |`,
    `| Remote mutation | ${record.host.remote_mutation} |`,
  ];
  if (record.item) {
    lines.push(
      "",
      `Selected item **${record.item.remote_id}** at revision **${record.item.revision}**, title digest \`${record.item.title_sha256}\` (${record.item.title_length} characters, not reproduced here).`,
    );
  }
  lines.push(
    "",
    "## Same workflow in both entry points",
    "",
    `- Control Plane: ${record.surfaces.control_plane.entry} — ${record.surfaces.control_plane.items} item(s)`,
    `- Skills only: ${record.surfaces.skills_only.entry} — ${record.surfaces.skills_only.items} item(s)`,
    `- Identity/revision parity: ${record.parity.same_identity ? "identical" : "differences found"}`,
  );
  for (const difference of record.parity.differences) {
    lines.push(`  - item ${difference.remote_id}: ${difference.field} differs`);
  }
  lines.push("", "This record proves a read-only intake. It does not claim execution, review, or remote writeback.");
  return lines.join("\n") + "\n";
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const root = path.resolve(option(args, "--root") || process.cwd());
  const cfg = readAzureConfig(root, {
    org_url: option(args, "--org-url"),
    project: option(args, "--project"),
    iteration_path: option(args, "--iteration-path"),
  });
  const itemId = option(args, "--item") ?? null;
  let record;
  try {
    record = await runAzureLiveCheck({ cfg, itemId, root, env: process.env });
  } catch (error) {
    if (error.code === "ATL_AZURE_TOKEN_MISSING") {
      process.stderr.write(
        `${error.message}\n`
        + `  1. Create a PAT on ${new URL(cfg.org_url).host} with Work Items: Read.\n`
        + `  2. PowerShell: $env:${cfg.token_env}="<token>"\n`
        + `  3. Re-run: node scripts/atl-azure-live-check.mjs --item <work-item-id>\n`,
      );
      process.exit(3);
    }
    throw error;
  }
  const out = path.resolve(root, option(args, "--out") || `.atl-evidence/issue-17/live-${record.captured_at.replaceAll(":", "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
  fs.writeFileSync(out.replace(/\.json$/i, ".md"), renderLiveCheckMarkdown(record));
  process.stdout.write(`${renderLiveCheckMarkdown(record)}\nEvidence: ${out}\n`);
  process.exit(record.gate === "passed" ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
