// Provider discovery and per-role provider profiles for the control room.
// Discovery is a pure PATH scan: no subprocess, no network, deterministic.
// A launch is only ever previewed or started after every needed executable
// has been found here; a missing one produces an actionable blocker instead.

import fs from "node:fs";
import path from "node:path";
import { loadUserProviders } from "./userProviders.mjs";

export const KNOWN_PROVIDERS = ["codex", "claude", "gapgpt"];

const CODEX_MODEL_RE = /^\s*model\s*=\s*["']([^"']+)["']\s*$/m;

const INSTALL_HINTS = {
  codex: "npm install -g @openai/codex  (then run: codex login)",
  claude: "npm install -g @anthropic-ai/claude-code  (then run: claude login)",
  gapgpt: "install GapCode, then run: gapcode login",
};

function candidateNames(name, platform) {
  return platform === "win32" ? [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name] : [name];
}

function codexHome(env = process.env) {
  return env.CODEX_HOME
    || (process.platform === "win32" ? env.USERPROFILE && path.join(env.USERPROFILE, ".codex") : null)
    || (env.HOME && path.join(env.HOME, ".codex"))
    || null;
}

// The Codex CLI's effective default is user-owned, not an ATL guess. Reading
// this one non-secret setting lets the control room explain what an unpinned
// Codex launch will use. An ATL project/model override still wins everywhere.
export function localDefaultModel(name, { env = process.env } = {}) {
  if (String(name || "").toLowerCase() !== "codex") return null;
  const home = codexHome(env);
  if (!home) return null;
  try {
    const text = fs.readFileSync(path.join(home, "config.toml"), "utf8");
    return text.match(CODEX_MODEL_RE)?.[1] || null;
  } catch {
    return null;
  }
}

export function providerModels(name, { env = process.env } = {}) {
  const clean = String(name || "").toLowerCase();
  if (!["codex", "gapgpt"].includes(clean)) return [];
  const home = clean === "codex"
    ? codexHome(env)
    : env.GAPCODE_HOME || (env.USERPROFILE && path.join(env.USERPROFILE, ".gapcode")) || (env.HOME && path.join(env.HOME, ".gapcode"));
  if (!home) return [];
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(home, "models_cache.json"), "utf8"));
    const entries = Array.isArray(cache) ? cache : cache?.models;
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry?.visibility !== "hide" && entry?.visibility !== "hidden")
      .map((entry) => ({
        id: entry?.slug || entry?.id,
        label: entry?.display_name || entry?.name || entry?.slug || entry?.id,
      }))
      .filter((entry) => entry.id);
  } catch {
    return [];
  }
}

// How to connect each built-in worker: one CLI login against a subscription.
// No API key and no `atl provider add` — that registry path is for external
// endpoints (Z.ai, OpenRouter, Anthropic keys, custom gateways) only.
export const BUILTIN_LOGIN = {
  codex: {
    label: "Codex CLI",
    loginCommand: "codex login",
    loginNote: "Choose Sign in with ChatGPT in the browser flow — do not choose API-key sign-in.",
    verifyCommand: "atl launch --dry-run",
  },
  claude: {
    label: "Claude Code CLI",
    loginCommand: "claude login",
    loginNote: "Sign in with your claude.ai subscription account in the browser flow.",
    verifyCommand: "atl launch --dry-run",
  },
  gapgpt: {
    label: "GapCode",
    loginCommand: "gapcode login",
    loginNote: "Sign in with your GapCode account in the browser flow.",
    verifyCommand: "atl launch --dry-run",
  },
};

function userHome(env) {
  const home = String(env.USERPROFILE || env.HOME || "").trim();
  return home || null;
}

// Subscription sign-in status of one built-in worker CLI, from read-only
// filesystem evidence — no subprocess, no network, no secret in the result.
// Same pure-local philosophy as discoverProvider: the control room explains
// what a launch would use instead of probing it.
export function builtinAuthStatus(name, { env = process.env } = {}) {
  const clean = String(name || "").toLowerCase();
  const login = BUILTIN_LOGIN[clean];
  const signedOut = { signedIn: false, method: null, detail: login ? `not signed in — run ${login.loginCommand} to connect` : "not signed in" };
  const home = userHome(env);
  if (!home) return signedOut;
  try {
    if (clean === "codex") {
      const auth = JSON.parse(fs.readFileSync(path.join(home, ".codex", "auth.json"), "utf8"));
      if (auth && typeof auth === "object") {
        if (auth.OPENAI_API_KEY) {
          return { signedIn: true, method: "api-key", detail: "signed in with an API key — rerun codex login and pick Sign in with ChatGPT to use your plan instead" };
        }
        if (auth.auth_mode === "chatgpt" || auth.tokens) {
          const refreshed = auth.last_refresh ? ` · token refreshed ${String(auth.last_refresh).slice(0, 10)}` : "";
          return { signedIn: true, method: "chatgpt", detail: `signed in with ChatGPT${refreshed}` };
        }
      }
      return signedOut;
    }
    if (clean === "claude") {
      try {
        const cred = JSON.parse(fs.readFileSync(path.join(home, ".claude", ".credentials.json"), "utf8"));
        if (cred?.claudeAiOauth) return { signedIn: true, method: "subscription", detail: "signed in with a claude.ai subscription" };
      } catch { /* fall through to .claude.json */ }
      try {
        const main = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
        if (main?.oauthAccount) return { signedIn: true, method: "subscription", detail: "signed in with a claude.ai subscription" };
      } catch { /* still signed out */ }
      return signedOut;
    }
    if (clean === "gapgpt") {
      const gapHome = env.GAPCODE_HOME || path.join(home, ".gapcode");
      const auth = JSON.parse(fs.readFileSync(path.join(gapHome, "auth.json"), "utf8"));
      if (auth && typeof auth === "object" && (auth.OPENAI_API_KEY || auth.tokens)) {
        return { signedIn: true, method: "gapgpt", detail: "signed in with GapCode" };
      }
      return signedOut;
    }
  } catch {
    return signedOut;
  }
  return signedOut;
}

// The browser-facing view of both built-in workers: install discovery,
// subscription sign-in state, and the exact connect steps when missing.
export function builtinProviderStatus(config = {}, { env = process.env } = {}) {
  const profile = config.defaultWorker && config.catalog ? config : providerProfile(config, { env });
  return KNOWN_PROVIDERS.map((name) => {
    const login = BUILTIN_LOGIN[name];
    const spec = providerSpec(profile, name, { env });
    const discovered = discoverProvider(name, { command: spec.command, env });
    const auth = builtinAuthStatus(name, { env });
    return {
      id: name,
      label: login.label,
      command: spec.command,
      auth: spec.auth || "subscription",
      installed: discovered.available,
      signedIn: auth.signedIn,
      method: auth.method,
      detail: auth.detail,
      defaultModel: ((profile.use || profile.defaultWorker) === name ? profile.raw?.model : null) || spec.model || localDefaultModel(name, { env }),
      models: providerModels(name, { env }),
      loginCommand: login.loginCommand,
      loginNote: login.loginNote,
      verifyCommand: login.verifyCommand,
      installHint: INSTALL_HINTS[name],
      isDefault: String(profile.use || profile.defaultWorker || "codex").toLowerCase() === name,
    };
  });
}

// Scan PATH for the provider executable. Returns { available, path, error }.
export function discoverProvider(name, { env = process.env, platform = process.platform, cwd = process.cwd(), command: configuredCommand = null } = {}) {
  const command = configuredCommand || (name === "gapgpt" ? "gapcode" : name);
  const dirs = String(env.PATH || env.Path || "")
    .split(platform === "win32" ? ";" : ":")
    .map((d) => d.trim())
    .filter(Boolean);
  const configured = path.isAbsolute(command)
    ? [command]
    : command.includes("\\") || command.includes("/")
      ? [path.resolve(cwd, command)]
      : [
          ...dirs.flatMap((dir) => candidateNames(command, platform).map((candidate) => path.join(dir, candidate))),
          ...(name === "gapgpt" && command.toLowerCase() === "gapcode" && platform === "win32" && env.LOCALAPPDATA
            ? [path.join(env.LOCALAPPDATA, "Programs", "GapGPT", "resources", "bin", "gapcode.exe")] : []),
          ...(name === "gapgpt" && command.toLowerCase() === "gapcode" && (env.GAPCODE_HOME || env.USERPROFILE || env.HOME)
            ? candidateNames("gapcode", platform).map((candidate) => path.join(env.GAPCODE_HOME || path.join(env.USERPROFILE || env.HOME, ".gapcode"), "bin", candidate)) : []),
        ];
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
export function providerProfile(config = {}, { env = process.env } = {}) {
  const p = config.providers || {};
  const defaultWorker = String(p.default || "codex").toLowerCase();
  const auth = String(p.auth || "subscription").toLowerCase();
  const use = p.use ? String(p.use).toLowerCase() : null;
  const userProviders = loadUserProviders().providers;
  const defaultModel = p.model && (!use || use === defaultWorker) ? String(p.model) : (defaultWorker === "codex" ? localDefaultModel("codex", { env }) : null);
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

export function providerSpec(profile, worker, { env = process.env } = {}) {
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
    command: id === "gapgpt" ? "gapcode" : id,
    args: null,
    model: id === profile?.defaultWorker ? (profile?.defaultModel || localDefaultModel(id, { env })) : localDefaultModel(id, { env }),
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
  // `providers.use` is the project-wide selection and may point at either a
  // machine registry provider or a built-in subscription worker (codex/claude).
  // Registry providers returned above; built-ins must still flow through the
  // same task-run resolver so selecting `provider use codex` actually changes
  // the worker launched for every role without requiring a role override.
  const worker = override || profile.use || profile.defaultWorker;
  const source = override ? "role-override" : profile.use ? "project provider selection" : "project default";
  // `providers.model` pins the currently selected project provider. It must
  // apply even when `use` differs from `default` (for example, switching the
  // project from Codex to Claude in the control room).
  const selectedModel = profile.use === worker ? profile.raw?.model : null;
  const model = profile.modelOverride || profile.modelByRole[r] || selectedModel || providerSpec(profile, worker).model || null;
  return { worker, auth: authFor(worker), model, source };
}

// Which distinct providers does this plan need? Used to keep the availability
// check minimal (one scan per provider name, not per session).
export function providersForRoles(profile, roles) {
  return [...new Set((roles || []).map((role) => providerForRole(profile, role).worker))];
}
