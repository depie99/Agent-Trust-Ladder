import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askJev, jevConfig } from "./jev.mjs";

const BUNDLE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function registryPath(root) {
  return path.join(root, "config", "skill-routing.json");
}

export function loadSkillRegistry(root) {
  const file = registryPath(root);
  if (!fs.existsSync(file)) return { version: 1, routes: [], fallback: null, missing: file };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function skillAvailable(root, skill) {
  return fs.existsSync(path.join(root, "skills", skill, "SKILL.md")) ||
    fs.existsSync(path.join(BUNDLE_ROOT, "skills", skill, "SKILL.md"));
}

export function bundledRoot() {
  return BUNDLE_ROOT;
}

export function isSkillAvailable(root, skill) {
  return skillAvailable(root, skill);
}

function scoreRoute(route, haystack, labels) {
  const keywords = route.keywords || [];
  const matches = keywords.filter((keyword) => haystack.includes(normalize(keyword)));
  const labelMatches = (route.labels || []).filter((label) => labels.includes(normalize(label)));
  return { score: matches.length + labelMatches.length, matches, labelMatches };
}

export function routeTask(root, { title = "", objective = "", labels = [], source = null } = {}) {
  const registry = loadSkillRegistry(root);
  const normalizedLabels = labels.map(normalize);
  const haystack = normalize([title, objective, source?.type, source?.url].filter(Boolean).join(" "));
  const candidates = (registry.routes || [])
    .map((route) => ({ route, ...scoreRoute(route, haystack, normalizedLabels) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.route.name.localeCompare(b.route.name));

  const selected = [];
  const skipped = [];
  for (const candidate of candidates) {
    if (skillAvailable(root, candidate.route.skill)) {
      selected.push({
        name: candidate.route.name,
        skill: candidate.route.skill,
        worker: candidate.route.worker || null,
        score: candidate.score,
        matched_keywords: candidate.matches,
        matched_labels: candidate.labelMatches,
      });
    } else {
      skipped.push({ skill: candidate.route.skill, reason: "skill directory is unavailable" });
    }
  }

  if (selected.length) {
    return {
      status: "matched",
      selected_skills: selected.map((entry) => entry.skill),
      proposed_worker: selected[0].worker,
      matches: selected,
      skipped,
      source: "skill-routing.json",
    };
  }

  const fallback = registry.fallback;
  const fallbackAvailable = fallback?.skill && skillAvailable(root, fallback.skill);
  return {
    status: fallbackAvailable ? "fallback" : "unresolved",
    selected_skills: fallbackAvailable ? [fallback.skill] : [],
    proposed_worker: fallbackAvailable ? (fallback.worker || null) : null,
    matches: [],
    skipped: [
      ...skipped,
      ...(fallback && !fallbackAvailable ? [{ skill: fallback.skill, reason: "fallback skill is unavailable" }] : []),
    ],
    source: fallbackAvailable ? "fallback" : "none",
    reason: fallback?.reason || "No route matched and no fallback is available.",
  };
}

export async function routeTaskWithJev(root, input = {}, options = {}) {
  const deterministic = routeTask(root, input);
  const config = jevConfig(root, options);
  const registry = loadSkillRegistry(root);
  const available = (registry.routes || [])
    .filter((route) => skillAvailable(root, route.skill))
    .map((route) => ({ id: route.skill, description: `${route.name}: ${(route.keywords || []).slice(0, 6).join(", ")}` }));
  const decision = await askJev({ state: input, options: available, config, fetchImpl: options.fetchImpl });

  const selected = available.find((option) => option.id === decision.choice);
  const confidence = decision.confidence;
  const accepted = selected && !decision.error && confidence !== null && confidence >= config.minConfidence;
  if (!accepted) {
    return {
      ...deterministic,
      decision: {
        provider: decision.enabled ? "jev-fallback" : "deterministic",
        accepted: false,
        confidence,
        reason: decision.error || decision.reason || `confidence below ${config.minConfidence}`,
      },
    };
  }

  const route = (registry.routes || []).find((candidate) => candidate.skill === selected.id);
  return {
    status: "matched",
    selected_skills: [route.skill],
    proposed_worker: route.worker || null,
    matches: [{
      name: route.name,
      skill: route.skill,
      worker: route.worker || null,
      score: 0,
      matched_keywords: [],
      matched_labels: [],
    }],
    skipped: deterministic.skipped || [],
    source: "jev",
    decision: {
      provider: "jev",
      accepted: true,
      model: decision.model,
      confidence,
      probabilities: decision.probabilities,
      min_confidence: config.minConfidence,
    },
  };
}

export function formatRoute(route) {
  const lines = [`Route: ${route.status} (${route.source})`];
  lines.push(`  skills: ${route.selected_skills.length ? route.selected_skills.join(", ") : "none"}`);
  lines.push(`  proposed worker: ${route.proposed_worker || "none"}`);
  for (const match of route.matches || []) {
    lines.push(`  match: ${match.skill} score=${match.score} via ${[...match.matched_keywords, ...match.matched_labels].join(", ")}`);
  }
  for (const skipped of route.skipped || []) lines.push(`  skipped: ${skipped.skill} (${skipped.reason})`);
  if (route.reason) lines.push(`  reason: ${route.reason}`);
  if (route.decision) {
    lines.push(`  decision: ${route.decision.provider} accepted=${route.decision.accepted}`);
    if (route.decision.confidence !== null && route.decision.confidence !== undefined) {
      lines.push(`  confidence: ${route.decision.confidence}`);
    }
    if (route.decision.reason) lines.push(`  decision reason: ${route.decision.reason}`);
  }
  return lines.join("\n");
}
