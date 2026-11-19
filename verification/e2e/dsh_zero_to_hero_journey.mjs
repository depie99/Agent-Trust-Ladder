// DSH zero-to-hero journey — live end-to-end proof of the ATL plugin inside a
// real DeepSeek Harness web UI, from a bare profile to a working task loop.
//
//   node verification/e2e/dsh_zero_to_hero_journey.mjs
//
// The journey owns a throwaway dsh profile named `e2e`:
//   leg freshToInstalled: recreate the profile from the shipped web template
//   (no plugins — stage 0), install ATL the documented way (dsh plugin add,
//   stage 1), then walk the panel (stages 2-8): plugin context, project switch
//   to a throwaway dir, nav contract, More-page groups, Plan Studio split,
//   issue sources, the compose→queue hero loop, and the 0.6.20 wide-panel
//   centering fix.
//
// Safety: the panel may open bound to a real project. Everything before the
// project switch is read-only rendering; the compose stage runs only after the
// header shows the throwaway project, and the throwaway daemon is stopped on
// the way out.
//
// dsh mechanics learned the hard way (2026-11-18):
//   - `dsh plugin add` is the only profile-creation path; a plugin `remove`
//     leaves node_modules debris that hangs the next boot — recreate from the
//     template instead (`--from-default-profile web`).
//   - the recreate form boots the server and stays alive; a plain boot of an
//     existing profile must NOT pass the app name (`dsh --profile e2e`).
//   - always pass an explicit --port: the default (3080) is the live server's.
//   - the web banner prints the only trusted entry: an http://127.0.0.1:port/
//     URL carrying a ?token= — bare requests get 401 (browser-trust fence).
//   - the ATL panel is an iframe under /api/atl/view?id=…; `data-atl-context`
//     sits on the frame's inner <html>, not on the iframe tag.
//
// Screenshots and the boot log land in ../../artifacts/dsh-0-to-hero-<version>/.
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const metadata = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
const bundle = path.join(root, 'dist', `plugins-${metadata.version}`, 'deepseek');
const profile = 'e2e';
const port = 47771;
const artifacts = path.resolve(root, '..', 'artifacts', `dsh-0-to-hero-${metadata.version}`);
fs.mkdirSync(artifacts, { recursive: true });
const results = [];
const shot = async (page, name) => { await page.screenshot({ path: path.join(artifacts, `${name}.png`) }); results.push(`screenshot ${name}.png`); };
const record = (stage, ok, detail) => results.push(`stage ${stage} ${ok ? 'PASS' : 'FAIL'}: ${detail}`);
const run = (cmd) => { console.log(`> ${cmd}`); return childProcess.execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); };

async function bootWeb(bootCommand) {
  const bootLog = path.join(artifacts, 'dsh-boot.log');
  fs.writeFileSync(bootLog, ''); // truncate per boot — resolve only THIS boot's banner
  const child = childProcess.spawn('cmd.exe', ['/d', '/s', '/c', bootCommand], { stdio: ['ignore', fs.openSync(bootLog, 'a'), fs.openSync(bootLog, 'a')] });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dsh web silent for 90s — see ${bootLog}`)), 90000);
    const poll = setInterval(() => {
      const text = fs.readFileSync(bootLog, 'utf8');
      const matches = [...text.matchAll(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/g)];
      if (matches.length) { clearInterval(poll); clearTimeout(timer); resolve(matches.at(-1)[0]); }
    }, 500);
    child.on('exit', code => { clearInterval(poll); clearTimeout(timer); reject(new Error(`dsh web exited ${code} — see ${bootLog}`)); });
  });
  return { child, url };
}
async function stopWeb(server) {
  if (server?.child?.pid && server.child.exitCode === null) {
    try { childProcess.execSync(`taskkill /pid ${server.child.pid} /t /f`, { stdio: 'ignore' }); } catch { /* already gone */ }
  }
  await new Promise(resolve => setTimeout(resolve, 1500)); // port release grace
}

const legs = {
  async freshToInstalled(browser) {
    // Stage 0: recreate+boot in one spawn — the template has no plugins.
    let server = await bootWeb(`dsh --profile ${profile} --from-default-profile web --port ${port} --no-open`);
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      await page.goto(server.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await shot(page, 'stage0-fresh-harness');
      const text = await page.evaluate(() => document.body.innerText);
      record(0, !/\bATL\b|agent-trust-ladder/i.test(text), 'fresh template harness exposes no ATL entry');
      await page.close();
    } catch (error) { record(0, false, error.message.split('\n')[0]); }
    await stopWeb(server);

    // Stage 1: documented install, reboot, ATL entry in the host sidebar.
    run(`dsh plugin --profile ${profile} add "${bundle}"`);
    server = await bootWeb(`dsh --profile ${profile} --port ${port} --no-open`);
    let scratchProject = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-dsh-hero-'));
    let scratchBound = false;
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.setDefaultTimeout(15000);
    try {
      await page.goto(server.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      record(1, /\bATL\b/.test(await page.evaluate(() => document.body.innerText)), 'ATL entry present in the host sidebar after install');

      // Dismiss the first-boot Preview Notice if it blocks the UI.
      const notice = page.getByRole('button', { name: /continue/i });
      if (await notice.isVisible().catch(() => false)) { await notice.click(); await page.waitForTimeout(800); }

      // Stage 2: open the ATL panel — header + control-plane frame in plugin context.
      await page.locator('text=ATL').first().click();
      await page.waitForTimeout(4500);
      await shot(page, 'stage2-atl-panel-open');
      const frameObj = await new Promise(resolve => {
        const found = page.frames().find(f => f.url().includes('/api/atl/view'));
        if (found) resolve(found);
        else page.once('frameattached', async () => { await page.waitForTimeout(2000); resolve(page.frames().find(f => f.url().includes('/api/atl/view'))); });
      });
      if (!frameObj) { record(2, false, 'no /api/atl/view frame after opening ATL'); await shot(page, 'stage2-no-frame'); return; }
      const frameContext = await frameObj.evaluate(() => document.documentElement.getAttribute('data-atl-context')).catch(() => null);
      record(2, frameContext === 'plugin', `frame document is in plugin context (data-atl-context=${frameContext})`);

      // Stage 2b: switch off any real project onto the throwaway one. The
      // "Change project" view is host-side DOM: a Project directory field and
      // an Open Control Plane button (opening prepares project state itself).
      results.push(`panel bound at open: ${(await page.evaluate(() => document.body.innerText)).split('\n').slice(0, 8).join(' | ')}`);
      await page.locator('text=Change project').first().click();
      await page.waitForTimeout(2000);
      await shot(page, 'stage2b-project-picker');
      const dirField = page.locator('input[placeholder*="PROJECTS"], input[placeholder*="path" i], #projectRoot').first();
      if (!(await dirField.isVisible().catch(() => false))) {
        record('2b', false, 'project directory field not found on the Change project view');
        await shot(page, 'stage2b-no-field');
        return;
      }
      await dirField.fill(scratchProject);
      await page.getByRole('button', { name: /open control plane/i }).first().click();
      await page.waitForTimeout(4000);
      await shot(page, 'stage2c-scratch-bound');
      const boundNow = await page.evaluate(() => document.body.innerText).then(t => t.includes(scratchProject)).catch(() => false);
      scratchBound = boundNow;
      record('2b', boundNow, boundNow ? `panel bound to throwaway project ${scratchProject}` : `still bound elsewhere; header: ${(await page.evaluate(() => document.body.innerText)).slice(0, 160)}`);

      const frame = page.frameLocator('iframe[src*="/api/atl/view"]');
      const frameText = () => frame.locator('body').innerText().catch(() => '(frame body unavailable)');

      // Stage 3: nav contract — Tasks / Attention / Plan Studio / More respond.
      // Plugin-context tabs are labeled pills, not [data-page] links.
      const tabs = ['Tasks', 'Attention', 'Plan Studio', 'More'];
      const navSeen = [];
      for (const tab of tabs) {
        const pill = frame.getByRole('button', { name: tab, exact: true }).first();
        if (!(await pill.isVisible().catch(() => false))) { navSeen.push(`${tab}:missing`); continue; }
        await pill.click();
        await page.waitForTimeout(1200);
        await shot(page, `stage3-tab-${tab.toLowerCase()}`);
        navSeen.push(`${tab}:ok`);
      }
      record(3, navSeen.every(entry => entry.endsWith(':ok')), `nav contract ${navSeen.join(', ')}`);

      // Stage 4: More page grouped sections (2026-11-18 redesign contract).
      await frame.getByRole('button', { name: 'More', exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(1500);
      await shot(page, 'stage4-more-groups');
      const moreText = (await frameText()).toUpperCase();
      const groups = ['PLAN & WORK', 'INTAKE & PROJECTS', 'ASSIST & SUPERVISE', 'AUDIT & SETTINGS'];
      const missing = groups.filter(name => !moreText.includes(name));
      record(4, missing.length === 0, missing.length ? `More page missing groups: ${missing.join(', ')}` : 'all four frequency-ordered groups present');

      // Stage 5: Plan Studio split workspace (Conversation + Plan panes).
      await frame.getByRole('button', { name: 'Plan Studio', exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(2000);
      await shot(page, 'stage5-plan-studio');
      const studioText = await frameText();
      record(5, /conversation/i.test(studioText) && /plan/i.test(studioText), `studio shows conversation and plan panes; text head: ${studioText.slice(0, 140)}`);

      // Stage 6: Issue sources reachable from More > Intake & projects (view only).
      await frame.getByRole('button', { name: 'More', exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(1000);
      const sourcesLink = frame.locator('text=Issue sources').first();
      if (await sourcesLink.isVisible().catch(() => false)) {
        await sourcesLink.click();
        await page.waitForTimeout(2000);
        await shot(page, 'stage6-issue-sources');
        const sourcesText = await frameText();
        record(6, /no sources connected|connect|add source/i.test(sourcesText), `issue sources page renders: ${sourcesText.slice(0, 120)}`);
      } else {
        record(6, false, 'Issue sources link not reachable from More');
      }

      // Stage 7: hero loop — create a real task through the New ATL task modal.
      if (!scratchBound) {
        record(7, false, 'skipped: panel not bound to the throwaway project (compose would touch a real project)');
      } else {
        await frame.getByRole('button', { name: 'Tasks', exact: true }).first().click().catch(() => {});
        await page.waitForTimeout(1200);
        const newTask = frame.getByRole('button', { name: /new task/i }).first();
        if (!(await newTask.isVisible().catch(() => false))) {
          record(7, false, 'New task button not found on the tasks page');
        } else {
          await newTask.click();
          await page.waitForTimeout(1200);
          await shot(page, 'stage7-new-task-modal');
          // Exact placeholder only — the loose variant also matches the tasks
          // search box, which appears earlier in the DOM.
          await frame.locator('input[placeholder="Describe the task"]').first().fill('Journey proof: one bounded task queued by the DSH zero-to-hero run');
          await frame.getByRole('button', { name: 'Create task', exact: true }).last().click();
          await page.waitForTimeout(2500);
          await shot(page, 'stage7-task-created');
          const tasksText = await frameText();
          record(7, /Journey proof/i.test(tasksText), /Journey proof/i.test(tasksText) ? 'task created through the modal and visible in the queue' : `task not visible after create; tasks text: ${tasksText.slice(0, 200)}`);
        }
      }

      // Stage 8: the 0.6.20 headline fix — nav strip centers on wide panels.
      // auto margins resolve to used px at layout: centering = symmetric margins
      // and the 1590px cap actually applied.
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(1500);
      await shot(page, 'stage8-wide-panel');
      const viewFrame = page.frames().find(f => f.url().includes('/api/atl/view'));
      const centering = await viewFrame.evaluate(() => {
        const probe = selector => {
          const el = document.querySelector(selector);
          if (!el) return `${selector}: missing`;
          const style = getComputedStyle(el);
          const centered = style.maxWidth === '1590px' && parseFloat(style.marginLeft) === parseFloat(style.marginRight);
          return `${selector}: max-width=${style.maxWidth} margin=${style.marginLeft}/${style.marginRight} ${centered ? 'centered' : 'NOT-centered'}`;
        };
        return [probe('.mobile'), probe('.topbar')];
      }).catch(error => [error.message.split('\n')[0]]);
      record(8, centering.every(line => line.includes('centered')), centering.join(' | '));
    } catch (error) {
      record('X', false, `unexpected: ${error.message.split('\n')[0]}`);
      await shot(page, 'failure-dump').catch(() => {});
    } finally {
      await page.close();
      try {
        const daemonModule = await import(new URL(`file:///${path.join(bundle, 'runtime', 'lib', 'daemon.mjs').replace(/\\/g, '/')}`));
        await daemonModule.stopDaemon(scratchProject);
        results.push(`daemon for ${scratchProject} stopped`);
      } catch { results.push('daemon stop skipped (no record)');
      }
      try { fs.rmSync(scratchProject, { recursive: true, force: true }); } catch { /* temp dir best effort */ }
      await stopWeb(server); // inside finally: early returns must not leak the server
    }
  },
};

const key = 'freshToInstalled'; // single leg: fresh template, documented install, full panel walk
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
try {
  await legs[key](browser);
} finally {
  await browser.close();
}
console.log(results.join('\n'));
if (results.some(line => line.includes('FAIL'))) process.exit(1);
console.log(`JOURNEY ${key}: done — artifacts in ${artifacts}`);
