// Provider discovery and per-role provider profiles for the control room.
// Discovery is a pure PATH scan: no subprocess, no network, deterministic.
// A launch is only ever previewed or started after every needed executable
// has been found here; a missing one produces an actionable blocker instead.

import fs from "node:fs";
import path from "node:path";
import { loadUserProviders } from "./userProviders.mjs";

export const KNOWN_PROVIDERS = ["codex", "claude"];

const CODEX_MODEL_RE = /^\s*model\s*=\s*["']([^"']+)["']\s*$/m;

const INSTALL_HINTS = {
  codex: "npm install -g @openai/codex  (then run: codex login)",
  claude: "npm install -g @anthropic-ai/claude-code  (then run: claude login)",
};

function candidateNames(name, platform) {
  return platform === "win32" ? [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name] : [name];
}

function codexHome() {
  return process.env.CODEX_HOME
    || (process.platform === "win32" ? process.env.USERPROFILE && path.join(process.env.USERPROFILE, ".codex") : null)
    || (process.env.HOME && path.join(process.env.HOME, ".codex"))
    || null;
}

// The Codex CLI's effective default is user-owned, not an ATL guess. Reading
// this one non-secret setting lets the control room explain what an unpinned
// Codex launch will use. An ATL project/model override still wins everywhere.
export function localDefaultModel(name) {
  if (String(name || "").toLowerCase() !== "codex") return null;
  const home = codexHome();
  if (!home) return null;
  try {
    const text = fs.readFileSync(path.join(home, "config.toml"), "utf8");
    return text.match(CODEX_MODEL_RE)?.[1] || null;
  } catch {
    return null;
  }
}

export function providerModels(name) {
  if (String(name || "").toLowerCase() !== "codex") return [];
  const home = codexHome();
  if (!home) return [];
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(home, "models_cache.json"), "utf8"));
    const entries = Array.isArray(cache) ? cache : cache?.models;
    return (Array.isArray(entries) ? entries : [])
      .map((entry) => ({
        id: entry?.slug || entry?.id,
        label: entry?.display_name || entry?.name || entry?.slug || entry?.id,
      }))
      .filter((entry) => entry.id);
  } catch {
    return [];
  }
}

// Scan PATH for the provider executable. Returns { available, path, error }.
export function discoverProvider(name, { env = process.env, platform = process.platform, cwd = process.cwd(), command: configuredCommand = null } = {}) {
  const command = configuredCommand || name;
  const dirs = String(env.PATH || env.Path || "")
    .split(platform === "win32" ? ";" : ":")
    .map((d) => d.trim())
    .filter(Boolean);
  const configured = path.isAbsolute(command)
    ? [command]
    : command.includes("\\") || command.includes("/")
      ? [path.resolve(cwd, command)]
      : dirs.flatMap((dir) => candidateNames(command, platform).map((candidate) => path.join(dir, candidate)));
  for (const full of configured) {
    try {
      if (fs.statSync(full).isFile()) return { name, command, available: true, path: full, error: null };
    } catch {
      // keep scanning
    }
  }
  return {
    name,
    command,
    available: false,
    path: null,
    error: `provider "${name}" executable "${command}" was not found on PATH. Fix: ${INSTALL_HINTS[name] || `install "${command}" and configure providers.catalog.${name}`}`,
  };
}

// Normalize the optional `providers` section of config/manager.json and merge
// in the user's provider registry (~/.atl/providers.json). Registry ids can be
// selected exactly like built-in workers: providers.use (project default),
// providers.by_role (per role), or --provider on the CLI.
export function providerProfile(config = {}) {
  const p = config.providers || {};
  const defaultWorker = String(p.default || "codex").toLowerCase();
  const auth = String(p.auth || "subscription").toLowerCase();
  const use = p.use ? String(p.use).toLowerCase() : null;
  const userProviders = loadUserProviders().providers;
  const defaultModel = p.model ? String(p.model) : (defaultWorker === "codex" ? localDefaultModel("codex") : null);
  const byRole = {};
  for (const [role, worker] of Object.entries(p.by_role || {})) {
    byRole[String(role).toLowerCase()] = String(worker).toLowerCase();
  }
  const modelByRole = {};
  for (const [role, model] of Object.entries(p.model_by_role || {})) {
    if (model) modelByRole[String(role).toLowerCase()] = String(model);
  }
  const catalog = {};
  for (const [name, raw] of Object.entries(p.catalog || {})) {
    const id = String(name).toLowerCase();
    const entry = raw && typeof raw === "object" ? raw : {};
    catalog[id] = {
      command: String(entry.command || id),
      args: Array.isArray(entry.args) ? entry.args.map(String) : null,
      promptArg: entry.prompt_arg ? String(entry.prompt_arg) : null,
      model: entry.model ? String(entry.model) : null,
      models: Array.isArray(entry.models) ? entry.models.map(String).filter(Boolean) : [],
      auth: entry.auth ? String(entry.auth).toLowerCase() : auth,
      unsetEnv: Array.isArray(entry.unset_env) ? entry.unset_env.map(String) : [],
    };
  }
  return { defaultWorker, defaultModel, auth, use, userProviders, byRole, modelByRole, catalog, raw: p };
}

export function providerNames(config = {}) {
  const profile = config.defaultWorker && config.catalog ? config : providerProfile(config);
  const names = [
    ...KNOWN_PROVIDERS,
    ...Object.keys(profile.userProviders || {}),
    ...Object.keys(profile.catalog || {}),
    profile.defaultWorker,
    ...Object.values(profile.byRole || {}),
  ];
  return [...new Set(names.map((name) => String(name).toLowerCase()).filter(Boolean))];
}

export function providerSpec(profile, worker) {
  const id = String(worker || "").toLowerCase();
  const entry = profile?.userProviders?.[id];
  // A registry id resolves to its underlying worker CLI for discovery, while
  // keeping the registry's model/auth so previews and launches agree.
  if (entry) {
    return {
      command: entry.worker || "claude",
      args: null,
      model: entry.model || null,
      models: Array.isArray(entry.models) ? entry.models : [],
      auth: "api",
      unsetEnv: [],
      userProvider: entry,
    };
  }
  const p = profile?.catalog?.[id];
  return p || {
    command: id,
    args: null,
    model: id === profile?.defaultWorker ? (profile?.defaultModel || localDefaultModel(id)) : localDefaultModel(id),
    models: [],
    auth: profile?.auth || "subscription",
    unsetEnv: [],
  };
}

// Resolve one role to a concrete provider. `source` records why (audit trail
// for the launch preview): "role-override", "project default", or
// `user provider "<id>"`.
export function providerForRole(profile, role) {
  const r = String(role || "").toLowerCase();
  const override = profile.byRole[r];
  const registry = profile.userProviders || {};
  const chosenId = override || profile.use || null;
  const entry = chosenId ? registry[chosenId] : null;
  if (entry) {
    const model = profile.modelOverride || profile.modelByRole[r] || entry.model || null;
    return {
      worker: entry.worker || "claude",
      auth: "api",
      model,
      source: `user provider "${chosenId}"`,
      userProvider: { id: chosenId, ...entry },
    };
  }
  const authFor = (worker) => profile.authOverride || providerSpec(profile, worker).auth;
  const worker = override || profile.defaultWorker;
  const source = override ? "role-override" : "project default";
  const model = profile.modelOverride || profile.modelByRole[r] || providerSpec(profile, worker).model || null;
  return { worker, auth: authFor(worker), model, source };
}

// Which distinct providers does this plan need? Used to keep the availability
// check minimal (one scan per provider name, not per session).
export function providersForRoles(profile, roles) {
  return [...new Set((roles || []).map((role) => providerForRole(profile, role).worker))];
}
