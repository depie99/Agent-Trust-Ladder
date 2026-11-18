// Release parity gate — one version of ATL reaches every surface together.
//
// The 2026-11-18 incident: ZCode ran installed 0.6.16, the marketplace snapshot
// served 0.6.19 (built without #43), dsh links pointed at that 0.6.19 dist, and
// the global CLI was an older copy — mixed-version processes silently 403'd the
// panel into empty pages. This test is the contract that makes that state
// impossible to ship again.
//
//   node verification/release_parity_test.mjs --dist dist/plugins-0.6.20
//   node verification/release_parity_test.mjs --dist dist/plugins-0.6.20 --local
//
// Leg A (always): the built artifact is coherent — all seven host bundles carry
// the same version, the same runtime content hash and the same panel asset, the
// daemon ships everywhere, the deepseek bundle carries its host client, and the
// marketplace catalogs advertise that version.
// Leg B (--local): this machine actually serves that build — the ZCode
// marketplace snapshot, every dsh profile link, the global CLI copy, and the
// installed ZCode plugin cache are all on the same version and content.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPluginRelease } from '../runtime/lib/plugin-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const local = args.includes('--local');
const distFlag = args.indexOf('--dist');
const metadata = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
const dist = path.resolve(root, distFlag >= 0 && args[distFlag + 1] ? args[distFlag + 1] : path.join('dist', `plugins-${metadata.version}`));
const home = os.homedir();
const failures = [];
const check = (name, run) => {
  try { run(); } catch (error) { failures.push(`${name}\n    ${error.message.split('\n').join('\n    ')}`); }
};

if (!fs.existsSync(dist)) {
  console.error(`No build at ${dist}.\nBuild it first: npm run plugins:build -- --out dist\\plugins-${metadata.version}`);
  process.exit(1);
}

// ---- Leg A: the artifact is one release, not seven bundles that drift. ----
const targets = fs.readdirSync(dist).filter(name => fs.existsSync(path.join(dist, name, 'atl-release.json')));
assert.ok(targets.length >= 7, `expected all seven host bundles in ${dist}, found: ${targets.join(', ')}`);
const expected = JSON.parse(fs.readFileSync(path.join(dist, 'deepseek', 'atl-release.json'), 'utf8'));
for (const target of targets) {
  const bundle = path.join(dist, target);
  check(`${target}: release manifest matches build content`, () => verifyPluginRelease(bundle, expected));
  check(`${target}: daemon ships (issue-34 one-owner runtime)`, () => assert.ok(fs.existsSync(path.join(bundle, 'runtime', 'lib', 'daemon.mjs')), 'runtime/lib/daemon.mjs missing'));
}
check('bundles share one version, content hash and panel asset', () => {
  const releases = targets.map(target => JSON.parse(fs.readFileSync(path.join(dist, target, 'atl-release.json'), 'utf8')));
  for (const release of releases) {
    assert.equal(release.version, expected.version, `version drift: ${release.version} != ${expected.version}`);
    assert.equal(release.content.sha256, expected.content.sha256, 'runtime content drift between bundles');
    assert.equal(release.ui.sha256, expected.ui.sha256, 'panel asset drift between bundles');
  }
  assert.equal(expected.version, metadata.version, `dist was built at ${expected.version}, plugin.json now says ${metadata.version} — rebuild`);
});
check('deepseek bundle carries the dsh host client contract', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dist, 'deepseek', 'package.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(dist, 'deepseek', 'plugin-ui', 'deepseek-client.js')), 'plugin-ui/deepseek-client.js missing');
  assert.ok(pkg.engines?.dsh, 'engines.dsh missing');
  assert.equal(expected.ui.deepseek?.path, 'plugin-ui/deepseek-client.js', 'release manifest does not pin the deepseek client');
});
for (const catalog of ['marketplace.json', path.join('.zcode-plugin', 'marketplace.json')]) {
  check(`catalog ${catalog} advertises ${expected.version}`, () => {
    const entry = JSON.parse(fs.readFileSync(path.join(dist, catalog), 'utf8')).plugins[0];
    assert.equal(entry.version, expected.version, `catalog says ${entry.version}`);
  });
}

// ---- Leg B: this machine serves the same build everywhere. ----
// Each check names the exact repair, so a red run is also the runbook.
if (local) {
  const zcodeBundle = (dir) => verifyPluginRelease(dir, expected);
  const snapshot = path.join(home, '.zcode', 'cli', 'plugins', 'marketplaces', 'atl-local');
  check('ZCode marketplace snapshot is on this release', () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(snapshot, 'marketplace.json'), 'utf8'));
    assert.equal(catalog.plugins[0].version, expected.version, `snapshot says ${catalog.plugins[0].version}; refresh: copy dist\\plugins-${expected.version}\\* over the snapshot`);
    zcodeBundle(path.join(snapshot, 'zcode'));
  });
  for (const profile of ['web', 'audit']) {
    check(`dsh profile ${profile} links this release`, () => {
      const pkgPath = path.join(home, '.dsh', 'profiles', profile, 'package.json');
      assert.ok(fs.existsSync(pkgPath), `no dsh profile at ${pkgPath}`);
      const dep = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).dependencies?.['@depie99/atl-plugin'];
      assert.ok(dep, 'atl-plugin not installed in the profile');
      const link = dep.startsWith('link:') ? dep.slice(5) : dep;
      const bundle = path.resolve(path.dirname(pkgPath), link);
      assert.ok(fs.existsSync(bundle), `link target missing: ${bundle}; re-add: dsh plugin --profile ${profile} add dist\\plugins-${expected.version}\\deepseek`);
      zcodeBundle(bundle);
    });
  }
  check('global atl CLI is installed from this checkout at this commit', () => {
    const source = JSON.parse(fs.readFileSync(path.join(home, '.atl', 'source.json'), 'utf8'));
    assert.equal(source.source_root, root, `CLI installed from ${source.source_root}; reinstall: node scripts\\install.mjs --no-path`);
    const commit = childProcess.execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(source.commit, commit, `CLI is at commit ${source.commit}, release is ${commit}; reinstall: node scripts\\install.mjs --no-path`);
  });
  check('installed ZCode plugin cache is on this release', () => {
    const cacheRoot = path.join(home, '.zcode', 'cli', 'plugins', 'cache', 'atl-local', 'agent-trust-ladder');
    assert.ok(fs.existsSync(cacheRoot), 'no plugin cache — install the plugin from the atl-local marketplace first');
    const newest = fs.readdirSync(cacheRoot).filter(name => /^\d+\.\d+\.\d+/.test(name)).sort((a, b) => {
      const [pa, pb] = [a, b].map(v => v.split('.').map(Number));
      return (pa[0] - pb[0]) || (pa[1] - pb[1]) || (pa[2] - pb[2]);
    }).pop();
    assert.equal(newest, expected.version, `cache has ${newest}, release is ${expected.version} — pending owner action: ZCode Settings > Plugin Management > Update, then fully quit and relaunch ZCode`);
  });
}

if (failures.length) {
  console.error(`RELEASE PARITY: ${failures.length} surface(s) off-release\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`RELEASE PARITY OK: ${expected.version} @ ${expected.commit || '(local)'} on ${targets.length} bundles${local ? ' + marketplace + dsh + CLI + cache' : ''}`);
