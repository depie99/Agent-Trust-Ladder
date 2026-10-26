// Durable, exact-action approvals.  A grant is evidence of permission, never
// evidence that the action succeeded.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const now = () => new Date().toISOString();
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileFor = (root) => path.join(root, ".trust", "manager", "approvals.json");
const empty = () => ({ version: 1, revision: 0, rules: [], proposals: [], grants: [], audit: [] });
function load(root) { try { return JSON.parse(fs.readFileSync(fileFor(root), "utf8")); } catch { return empty(); } }
function save(root, store) { const file = fileFor(root); fs.mkdirSync(path.dirname(file), { recursive: true }); store.revision++; const tmp = `${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n"); fs.renameSync(tmp, file); return store; }
function audit(store, type, detail) { store.audit.push({ id: crypto.randomUUID(), at: now(), type, ...detail }); if (store.audit.length > 1000) store.audit.splice(0, store.audit.length - 1000); }

export function actionDigest(action) {
  return digest({ project: action.project, task: action.task || null, run: action.run || null, operation: action.operation, target: action.target || null, args: action.args || {}, revision: action.revision || null, policyVersion: action.policyVersion || null });
}

export function proposeAction(root, action, { principal = "owner" } = {}) {
  if (!action?.operation || !action?.project) throw new Error("proposal requires project and operation");
  const store = load(root); const proposal = { id: `AP-${crypto.randomUUID()}`, action: { ...action }, digest: actionDigest(action), principal, status: "pending", created_at: now() };
  store.proposals.push(proposal); audit(store, "proposal", { proposal_id: proposal.id, digest: proposal.digest, principal }); save(root, store); return proposal;
}

export function decideProposal(root, proposalId, decision, { principal = "owner", expiresInSeconds = 600, rule = "allow-once" } = {}) {
  if (!["allow-once", "deny"].includes(decision)) throw new Error("decision must be allow-once or deny");
  const store = load(root); const proposal = store.proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== "pending") throw new Error("proposal is not pending");
  proposal.status = decision === "deny" ? "denied" : "approved"; proposal.decided_at = now(); proposal.decided_by = principal;
  if (decision === "allow-once") store.grants.push({ id: `AG-${crypto.randomUUID()}`, proposal_id: proposal.id, digest: proposal.digest, action: proposal.action, rule, expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(), used_at: null, revoked_at: null, principal });
  audit(store, decision, { proposal_id: proposal.id, principal }); save(root, store); return proposal;
}

export function authorizeAction(root, action, { consume = true } = {}) {
  const store = load(root); const hash = actionDigest(action); const activeDeny = store.proposals.find((p) => p.digest === hash && p.status === "denied");
  if (activeDeny) return { allowed: false, reason: "action was denied" };
  const grant = store.grants.find((g) => g.digest === hash && !g.used_at && !g.revoked_at && new Date(g.expires_at).getTime() > Date.now());
  if (!grant) return { allowed: false, reason: "exact action requires owner approval" };
  if (consume) { grant.used_at = now(); audit(store, "grant-consumed", { grant_id: grant.id, digest: hash }); save(root, store); }
  return { allowed: true, grant };
}

export function recordActionOutcome(root, action, outcome) {
  const store = load(root); const hash = actionDigest(action); const proposal = store.proposals.find((p) => p.digest === hash); if (!proposal) return null;
  proposal.execution = { status: outcome?.status || (outcome?.failed ? "failed" : "unknown"), reason: outcome?.reason || null, recorded_at: now() };
  audit(store, "execution-outcome", { proposal_id: proposal.id, digest: hash, status: proposal.execution.status }); save(root, store); return proposal.execution;
}

export function revokeGrant(root, grantId, { principal = "owner" } = {}) { const store = load(root); const grant = store.grants.find((g) => g.id === grantId); if (!grant) throw new Error("unknown grant"); grant.revoked_at = now(); audit(store, "grant-revoked", { grant_id: grantId, principal }); save(root, store); return grant; }
export function approvalSnapshot(root) { const store = load(root); return { revision: store.revision, proposals: store.proposals, grants: store.grants.map(({ action, ...g }) => ({ ...g, operation: action.operation, target: action.target })), audit: store.audit.slice(-100) }; }
