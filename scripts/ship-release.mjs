// Ship one built release to every local surface, then prove it with the parity gate.
//
//   npm run plugins:build -- --out dist\plugins-0.6.20   (the build)
//   npm run release:ship -- --dist dist\plugins-0.6.20   (this script)
//
// 1. mirror the dist into the ZCode marketplace snapshot (atl-local)
// 2. re-link every dsh profile to the new deepseek bundle
// 3. reinstall the global atl CLI from this checkout
// 4. run verification/release_parity_test.mjs --local — the gate that keeps
//    the 2026-11-18 mixed-version incident (stale processes silently 403-ing
//    the panel) from recurring. The installed-cache leg stays red until the
//    owner clicks Update and fully restarts the host; that is the design.
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const distFlag = args.indexOf('--dist');
const metadata = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
const dist = path.resolve(root, distFlag >= 0 && args[distFlag + 1] ? args[distFlag + 1] : path.join('dist', `plugins-${metadata.version}`));
const release = JSON.parse(fs.readFileSync(path.join(dist, 'deepseek', 'atl-release.json'), 'utf8'));
const run = (command) => {
  console.log(`> ${command}`);
  childProcess.execSync(command, { stdio: 'inherit', cwd: root });
};

if (release.version !== metadata.version) throw new Error(`dist was built at ${release.version}, plugin.json says ${metadata.version} — rebuild`);

// 1. Marketplace snapshot: generated artifact, mirrored wholesale each release.
const snapshot = path.join(os.homedir(), '.zcode', 'cli', 'plugins', 'marketplaces', 'atl-local');
if (!fs.existsSync(path.dirname(snapshot))) throw new Error(`ZCode marketplaces dir missing: ${path.dirname(snapshot)}`);
fs.rmSync(snapshot, { recursive: true, force: true });
fs.cpSync(dist, snapshot, { recursive: true });
console.log(`snapshot refreshed: ${snapshot}`);

// 2. dsh profiles: re-add replaces the link with the new bundle.
for (const profile of ['web', 'audit']) {
  const profilePkg = path.join(os.homedir(), '.dsh', 'profiles', profile, 'package.json');
  if (!fs.existsSync(profilePkg)) { console.log(`dsh profile ${profile}: absent, skipped`); continue; }
  run(`dsh plugin --profile ${profile} add "${path.join(dist, 'deepseek')}"`);
}

// 3. Global CLI: reinstall from this exact checkout.
run(`node "${path.join(root, 'scripts', 'install.mjs')}" --no-path`);

// 4. Parity gate. Exit code propagates; the cache leg stays red by design
//    until the owner updates the host.
run(`node "${path.join(root, 'verification', 'release_parity_test.mjs')}" --dist "${dist}" --local`);
