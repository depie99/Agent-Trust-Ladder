import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadState, saveState } from '../../runtime/lib/state.mjs';
import { unblockTask } from '../../runtime/lib/recovery.mjs';
import { acquireLease, heartbeatLease, releaseLease } from '../../runtime/lib/leases.mjs';
import { createWorkerCredential } from '../../runtime/lib/session-auth.mjs';
import { createWorkerChannel } from '../../runtime/lib/worker-channel.mjs';

const root = process.cwd(); const id = 'T-022';
const task = loadState(root).tasks[id];
if (task.status === 'blocked') unblockTask(root, id, { note: 'Implemented manager-owned sandbox handoff; actual direct and queue sandbox regression tests pass. T-018..21 integration restored and checked. Resume independent review; fresh browser gate is still required.' });
const lease = acquireLease(root, { project: path.resolve(root), task: id, role: 'rowan', run: 'T-022-authorized-recovery-20261027', ttlMs: 120000 });
const heartbeat = setInterval(() => heartbeatLease(root, lease, { ttlMs: 120000 }), 5000);
const credential = createWorkerCredential({ project: path.resolve(root), task: id, role: 'rowan', run: lease.run, generation: lease.generation, leaseId: lease.id, leaseKey: lease.key, expiresInSeconds: 300 });
const channel = createWorkerChannel(root, { workspace: task.workspace, task: id, role: 'rowan', credential });
const execute = promisify(execFile);
const call = async (...args) => {
  const env = { ...process.env, ...channel.env }; delete env.ATL_WORKER_CREDENTIAL;
  const result = await execute(process.execPath, ['--permission', '--allow-fs-read=*', `--allow-fs-write=${task.workspace}`, channel.client, ...args], { cwd: task.workspace, env, windowsHide: true });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
};
try {
  await call('show', id);
  if (loadState(root).tasks[id].status === 'assigned') await call('move', id, 'in_progress', '--note', 'Authorized recovery integration through repaired sandbox-local handoff.');
  await call('update', id, '--checkpoint', 'Actual integration and reviewer corrections complete; nine focused checks pass. Artifacts: .atl-evidence/t022-recovery/integration.md, checks.txt, integration-check.mjs. No fresh rendered completion claim: Chrome bridge disconnected. Independent re-review pending.');
  if (loadState(root).tasks[id].status === 'in_progress') await call('move', id, 'in_review', '--note', 'Submit restored upstream integration and consumer bidi fixes for independent review; fresh rendered evidence gate remains open.');
  const after = loadState(root); const recovered = after.tasks[id];
  if (recovered.status === 'in_review' && recovered.integration_inputs?.status === 'required') {
    recovered.integration_inputs.status = 'composed'; recovered.review_required = true;
    after.log.push({ at: new Date().toISOString(), task: id, actor: 'manager', event: 'integration-handoff', detail: 'Observed builder integration and scoped sandbox handoff; provenance and checks in workspace .atl-evidence/t022-recovery/. Independent review and current rendered evidence remain required.' });
    saveState(root, after);
  }
  console.log('Recovered task status:', loadState(root).tasks[id].status);
} finally { await channel.close(); clearInterval(heartbeat); releaseLease(root, lease); }
