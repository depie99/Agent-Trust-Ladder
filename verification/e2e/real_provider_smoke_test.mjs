import { discoverProvider, builtinAuthStatus, providerForRole } from "../../runtime/lib/providers.mjs";

const profile = providerForRole("rowan");
const provider = profile?.worker || "codex";
const auth = builtinAuthStatus(provider);
const discovered = discoverProvider(provider, { command: profile?.command || null });
if (!discovered?.found) { console.log(`BLOCKED: ${provider} executable was not discovered: ${discovered?.detail || "missing executable"}`); process.exit(0); }
if (!auth.signedIn && profile?.auth === "subscription") { console.log(`BLOCKED: ${provider} is installed but not authenticated: ${auth.detail}`); process.exit(0); }
console.log(`READY: ATL discovered ${provider} at ${discovered.command}; auth=${auth.method || profile?.auth || "configured"}`);
console.log("NEXT: run the bounded real-provider launch through ATL; this discovery gate uses the configured provider registry and never requires ad-hoc ATL_SMOKE_* variables.");
