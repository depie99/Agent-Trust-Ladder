// Build complete harness packages from the same runtime and skill sources.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { sharedTrees, shipFile, shipDependencyFile, sharedContent, dependencyContent, verifyPluginRelease } from '../runtime/lib/plugin-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const pluginTargets = ['codex', 'claude', 'cursor', 'deepseek', 'gemini', 'zcode', 'universal'];
const metadata = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));

export function buildPlugins({ out = path.join(root, 'dist', 'plugins'), targets = pluginTargets } = {}) {
  out = path.resolve(out);
  const relative = path.relative(root, out);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Build output must be inside this checkout.');
  if (!targets.length || targets.some(target => !pluginTargets.includes(target))) throw new Error(`Targets: ${pluginTargets.join(', ')}`);
  // Do not follow an existing symlink/junction to another workspace.
  let ancestor = out;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realRelative = path.relative(fs.realpathSync(root), fs.realpathSync(ancestor));
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('Output cannot resolve outside this checkout.');
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  const packages = Object.entries(lock.packages).filter(([name, entry]) => name.startsWith('node_modules/') && !entry.dev && (!entry.optional || fs.existsSync(path.join(root, name)))).map(([name, entry]) => {
    const installed = JSON.parse(fs.readFileSync(path.join(root, name, 'package.json')));
    if (installed.version !== entry.version) throw new Error(`Production dependency differs from lockfile: ${name}`);
    return name;
  }).sort();
  const panelScript = buildSync({ entryPoints: [path.join(root, 'plugins', 'panel-entry.mjs')], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome120', minify: true }).outputFiles[0].text;
  const panelHash = createHash('sha256').update(panelScript).digest('hex');
  const deepseekClient = buildSync({ entryPoints: [path.join(root, 'plugins', 'deepseek-client.mjs')], bundle: true, write: false, platform: 'browser', format: 'cjs', external: ['react'], target: 'chrome120', banner: { js: 'window.__ModuleLoader__.load({id:"@depie99/atl-plugin",factory:(require)=>{var module={exports:{}};var exports=module.exports;' }, footer: { js: 'return module.exports;}});' } }).outputFiles[0].text;
  let commit = null;
  try { commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* source archive has no Git metadata */ }
  const release = { format: 3, version: metadata.version, runtimeVersion: sourcePackage.version, commit, content: sharedContent(root), dependencies: dependencyContent(root, packages), ui: { path: 'plugin-ui/panel.js', sha256: panelHash } };
  for (const target of targets) {
    const dest = path.join(out, target);
    // Refuse to overwrite anything: callers can choose another output directory.
    if (fs.existsSync(dest)) throw new Error(`Output exists: ${dest}. Choose a fresh --out directory.`);
    fs.mkdirSync(dest);
    for (const dir of sharedTrees) fs.cpSync(path.join(root, dir), path.join(dest, dir), { recursive: true, filter: shipFile });
    for (const name of packages) {
      const source = path.join(root, name);
      fs.mkdirSync(path.dirname(path.join(dest, name)), { recursive: true });
      fs.cpSync(source, path.join(dest, name), { recursive: true, filter: entry => entry === source || shipDependencyFile(entry) });
    }
    for (const file of ['LICENSE', 'README.md', 'README.fa.md', 'GUIDE.md', 'USAGE.md']) {
      if (fs.existsSync(path.join(root, file))) fs.copyFileSync(path.join(root, file), path.join(dest, file));
    }
    const identity = Object.fromEntries(['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords'].map(key => [key, metadata[key]]));
    identity.description = 'Full ATL: engineering skills, workflows, persistent tasks, bounded execution and the local Control Plane.';
    fs.mkdirSync(path.join(dest, 'plugin-ui'));
    fs.writeFileSync(path.join(dest, 'plugin-ui', 'panel.js'), panelScript);
    const pkg = { name: '@depie99/atl-plugin', version: metadata.version, description: identity.description, type: 'module', license: 'MIT', engines: { node: '>=22' }, files: ['atl-release.json', '.zcode-plugin', 'runtime', 'skills', 'config', 'commands', 'verification', 'docs', 'plugins', 'plugin-ui', 'cordis.patch.yml', 'gemini-extension.json', 'GEMINI.md', 'start.cmd', 'start.sh', 'README.md', 'README.fa.md', 'GUIDE.md', 'USAGE.md', 'LICENSE'], bin: { atl: 'runtime/atl-manager.mjs', 'atl-connect': 'runtime/atl-connect.mjs' } };
    const json = (file, value) => { fs.mkdirSync(path.dirname(path.join(dest, file)), { recursive: true }); fs.writeFileSync(path.join(dest, file), JSON.stringify(value, null, 2) + '\n'); };
    pkg.dependencies = sourcePackage.dependencies || {};
    pkg.bundledDependencies = Object.keys(pkg.dependencies);
    const server = variable => ({ type: 'stdio', command: 'node', args: [`${variable}/runtime/atl-plugin-mcp.mjs`] });
    if (target === 'codex') {
      json('plugin.json', { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...identity, extensions: { 'com.openai': { requires_local_executor: true, onboardingSkill: './skills/atl-plugin/SKILL.md', interface: { ...metadata.interface, longDescription: identity.description } } } });
      json('mcp.json', { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { atl: server('${PLUGIN_ROOT}') } });
      json('.codex-plugin/plugin.json', { ...metadata, description: identity.description, mcpServers: './.mcp.json', onboardingSkill: './skills/atl-plugin/SKILL.md', requires_local_executor: true });
      // The legacy parser resolves cwd relative to the installed plugin root.
      json('.mcp.json', { mcpServers: { atl: { command: 'node', args: ['runtime/atl-plugin-mcp.mjs'], cwd: '.' } } });
    } else if (target === 'claude') {
      json('.claude-plugin/plugin.json', identity);
      json('.mcp.json', { mcpServers: { atl: server('${CLAUDE_PLUGIN_ROOT}') } });
    } else if (target === 'cursor') {
      json('.cursor-plugin/plugin.json', identity);
      json('mcp.json', { mcpServers: { atl: server('${CURSOR_PLUGIN_ROOT}') } });
    } else if (target === 'zcode') {
      json('.zcode-plugin/plugin.json', { ...identity, skills: './skills/', commands: './commands/', mcpServers: { atl: { ...server('${ZCODE_PLUGIN_ROOT}'), cwd: '${ZCODE_PROJECT_DIR}', env: { ATL_PLUGIN_PROJECT: '${ZCODE_PROJECT_DIR}' } } }, ui: { surfaces: [{ id: 'control-plane', title: { 'en-US': 'ATL Control Plane', 'zh-CN': 'ATL 控制台' }, icon: 'gauge', server: 'atl', resourceUri: 'ui://atl/control-plane.html', availability: 'session' }] } });
    } else if (target === 'deepseek') {
      fs.writeFileSync(path.join(dest, 'plugin-ui', 'deepseek-client.js'), deepseekClient);
      pkg.main = './plugins/deepseek.mjs';
      pkg.exports = { '.': './plugins/deepseek.mjs' };
      pkg.exports['./client'] = './plugin-ui/deepseek-client.js';
      pkg.engines.dsh = '>=0.2.2-rc.1 <0.3.0';
      pkg.dsh = { bundle: { patch: './cordis.patch.yml' } };
      pkg.dsh.client = { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-plugin-manager'] };
      fs.writeFileSync(path.join(dest, 'cordis.patch.yml'), '- insert:\n    - id: agent-trust-ladder\n      name: "@depie99/atl-plugin"\n');
    } else if (target === 'gemini') {
      json('gemini-extension.json', { name: metadata.name, version: metadata.version, mcpServers: { atl: { command: 'node', args: ['${extensionPath}/runtime/atl-plugin-mcp.mjs'] } }, contextFileName: 'GEMINI.md' });
      fs.writeFileSync(path.join(dest, 'GEMINI.md'), 'For ATL requests, read atl_skill(name="atl") and follow its workflow. For authorized project setup or dashboard requests, use atl_start with the absolute application path. The full ATL runtime is bundled. Host permissions and ATL trust gates apply. Do not start workers from installation alone.\n');
    }
    fs.writeFileSync(path.join(dest, 'start.cmd'), '@echo off\r\nnode "%~dp0runtime\\atl-connect.mjs"\r\n');
    fs.writeFileSync(path.join(dest, 'start.sh'), '#!/bin/sh\nexec node "$(dirname "$0")/runtime/atl-connect.mjs"\n', { mode: 0o755 });
    json('package.json', pkg);
    const targetRelease = target === 'deepseek' ? { ...release, ui: { ...release.ui, deepseek: { path: 'plugin-ui/deepseek-client.js', sha256: createHash('sha256').update(deepseekClient).digest('hex') } } } : release;
    json('atl-release.json', targetRelease);
    verifyPluginRelease(dest, release);
    results.push({ target, path: dest, version: metadata.version });
  }
  // A local marketplace is reviewable without touching a user's host settings.
  if (targets.includes('claude')) {
    fs.mkdirSync(path.join(out, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(out, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'atl-local', owner: metadata.author, plugins: [{ name: metadata.name, source: './claude' }] }, null, 2) + '\n');
  }
  if (targets.includes('codex')) {
    fs.mkdirSync(path.join(out, '.agents', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(out, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({ name: 'atl-local', interface: { displayName: 'ATL Local' }, plugins: [{ name: metadata.name, category: 'Developer Tools', source: { source: 'local', path: './codex' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } }] }, null, 2) + '\n');
  }
  if (targets.includes('zcode')) {
    fs.mkdirSync(path.join(out, '.zcode-plugin'), { recursive: true });
    const catalog = JSON.stringify({ name: 'atl-local', plugins: [{ name: metadata.name, version: metadata.version, description: metadata.description, category: 'Developer Tools', source: './zcode' }] }, null, 2) + '\n';
    fs.writeFileSync(path.join(out, '.zcode-plugin', 'marketplace.json'), catalog);
    // ZCode Desktop 3.14.5 / CLI 0.16.9 discovers marketplace.json at the root.
    fs.writeFileSync(path.join(out, 'marketplace.json'), catalog);
  }
  if (sharedContent(root).sha256 !== release.content.sha256 || dependencyContent(root, packages).sha256 !== release.dependencies.sha256) throw new Error('Control Plane source changed during packaging. Rebuild from a stable snapshot.');
  return results;
}


if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) options.out = args[++i];
    else if (args[i] === '--target' && args[i + 1]) options.targets = [args[++i]];
    else throw new Error(`Usage: node scripts/build-plugins.mjs [--out directory] [--target ${pluginTargets.join('|')}]`);
  }
  console.log(JSON.stringify(buildPlugins(options), null, 2));
}
