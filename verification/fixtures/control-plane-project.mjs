import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyState, saveState } from '../../runtime/lib/state.mjs';
import { startControlPlaneServer } from '../../runtime/lib/control-plane-server.mjs';

export async function controlPlaneProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-browser-fixture-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config/manager.json'), JSON.stringify({ version: 1 }));
  const state = emptyState();
  state.tasks['T-026'] = { id: 'T-026', title: 'Synthetic RTL task', status: 'new', priority: 'normal', completion_checks: [], evidence: [] };
  saveState(root, state);
  const running = await startControlPlaneServer(root);
  return { ...running, root, close: async () => { await new Promise(resolve => running.server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); } };
}
