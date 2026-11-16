// One content identity for the Control Plane and every harness distribution.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sharedTrees = ['runtime', 'skills', 'config', 'commands', 'verification', 'plugins'];
// Project manager configuration belongs to the application, never the bundle.
export const shipFile = source => !['node_modules', '__pycache__'].includes(path.basename(source)) && !/\.log$|\.bak(?:-|$)|^_probe_/.test(path.basename(source)) && !/(?:^|[\\/])config[\\/]manager\.json$/.test(source) && !/(?:^|[\\/])verification[\\/](?:azure_delivery_pilot_test|azure_live_check_test|azure_skills_delivery_test|azure_issue_journey_test|issue_source_ui_journey_test|intake_test|task_preparation_api_test|overnight_issue_e2e_test|plan_repository_scoping_test|plan_studio_journey_test)\.mjs$/.test(source);
const digest = value => createHash('sha256').update(value).digest('hex');
// npm pack omits some bundled dependency changelogs. Exclude these documents
// explicitly at build time; executable dependency files remain fully covered.
export const shipDependencyFile = source => path.basename(source) !== 'node_modules' && !/^changelog(?:\.md|\.markdown|\.txt)?$/i.test(path.basename(source));

export function sharedContent(root) {
  const files = {};
  function visit(relative) {
    const absolute = path.join(root, relative);
    if (!shipFile(absolute)) return;
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error(`Shared content cannot be a symlink: ${relative}`);
    if (fs.statSync(absolute).isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(`${relative}/${name}`);
    } else files[relative] = digest(fs.readFileSync(absolute));
  }
  for (const tree of sharedTrees) visit(tree);
  return { sha256: digest(JSON.stringify(files)), files };
}

export function dependencyContent(root, packages) {
  const files = {};
  function visit(relative, top = false) {
    if (!top && !shipDependencyFile(relative)) return;
    const absolute = path.join(root, relative);
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error(`Dependency cannot be a symlink: ${relative}`);
    if (fs.statSync(absolute).isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(`${relative}/${name}`);
    } else files[relative] = digest(fs.readFileSync(absolute));
  }
  for (const name of [...packages].sort()) {
    if (!/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(name) || name.split('/').includes('..')) throw new Error('Invalid bundled dependency path.');
    visit(name, true);
  }
  return { packages: [...packages].sort(), sha256: digest(JSON.stringify(files)), files };
}

export function verifyPluginRelease(root, expected) {
  const release = JSON.parse(fs.readFileSync(path.join(root, 'atl-release.json'), 'utf8'));
  const actual = sharedContent(root);
  if (![1, 2, 3].includes(release.format) || release.content.sha256 !== actual.sha256 || JSON.stringify(release.content.files) !== JSON.stringify(actual.files)) throw new Error('Plugin shared content differs from its release manifest. Rebuild the plugin.');
  if (release.format >= 2) {
    const dependencies = dependencyContent(root, release.dependencies.packages);
    if (dependencies.sha256 !== release.dependencies.sha256 || JSON.stringify(dependencies.files) !== JSON.stringify(release.dependencies.files)) throw new Error('Plugin production dependencies differ from its release manifest.');
    if (expected && expected.dependencies.sha256 !== dependencies.sha256) throw new Error('Plugin production dependencies differ from the release snapshot.');
  }
  if (release.format >= 3) {
    if (pkgClient(root)) {
      const client = release.ui?.deepseek;
      if (client?.path !== 'plugin-ui/deepseek-client.js' || digest(fs.readFileSync(path.join(root, client.path))) !== client.sha256) throw new Error('DeepSeek client asset differs from its release manifest.');
    }
    if (release.ui?.path !== 'plugin-ui/panel.js' || digest(fs.readFileSync(path.join(root, release.ui.path))) !== release.ui.sha256) throw new Error('Plugin panel asset differs from its release manifest.');
    if (expected && expected.ui?.sha256 !== release.ui.sha256) throw new Error('Plugin panel asset differs from the release snapshot.');
  }
  if (expected && (expected.content.sha256 !== actual.sha256 || expected.version !== release.version || expected.runtimeVersion !== release.runtimeVersion)) throw new Error('Plugin differs from the current Control Plane release.');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== release.version) throw new Error('Plugin package and release versions differ.');
  return release;
}

function pkgClient(root) {
  return Boolean(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dsh?.client);
}
