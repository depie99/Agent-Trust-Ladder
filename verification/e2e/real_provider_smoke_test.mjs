import fs from "node:fs";
import path from "node:path";
import { discoverProvider, builtinAuthStatus, providerForRole, providerProfile } from "../../runtime/lib/providers.mjs";
import { loadUserProviders } from "../../runtime/lib/userProviders.mjs";

const root = process.env.ATL_PROJECT || process.cwd();
let config = {}; try { config = JSON.parse(fs.readFileSync(path.join(root, "config", "manager.json"), "utf8")); } catch {}
const profile = providerForRole(providerProfile({ ...config, userProviders: loadUserProviders().providers }), "rowan");
const provider = profile?.worker || "codex";
const auth = builtinAuthStatus(provider);
const discovered = discoverProvider(provider, { command: profile?.command || null });
if (!discovered?.available) { console.log(`BLOCKED: ${provider} executable was not discovered: ${discovered?.error || "missing executable"}`); process.exit(0); }
if (!auth.signedIn && profile?.auth === "subscription") { console.log(`BLOCKED: ${provider} is installed but not authenticated: ${auth.detail}`); process.exit(0); }
console.log(`READY: ATL discovered ${provider} at ${discovered.path || discovered.command}; auth=${auth.method || profile?.auth || "configured"}`);
console.log("NEXT: run the bounded real-provider launch through ATL; this discovery gate uses the configured provider registry and never requires ad-hoc ATL_SMOKE_* variables.");
