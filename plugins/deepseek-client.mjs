import React, { useEffect, useRef, useState } from 'react';
const h = React.createElement;
const PANEL = 'atl-control-plane';
export const inject = ['slots', 'layout'];

const WORKSPACE_KEY = 'atl-dsh-workspace';
const WORKSPACE_LIST_KEY = 'atl-dsh-workspaces';
// dsh unmounts the keyed main slot on every tab switch and remounts it on return,
// but this client module and its plugin fiber stay loaded. Keeping the open panel
// at module scope (plus a durable copy for fresh page loads) is what makes the
// workspace survive navigation; the idempotent open route heals a stale id.
let livePanel = null;

function rememberPanel(value) {
  livePanel = { id: value.id, project: value.project };
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ project: value.project }));
    const known = JSON.parse(localStorage.getItem(WORKSPACE_LIST_KEY) || '[]').filter(entry => entry && typeof entry === 'string' && entry !== value.project);
    localStorage.setItem(WORKSPACE_LIST_KEY, JSON.stringify([value.project, ...known].slice(0, 5)));
  } catch { /* storage unavailable: session memory still holds the workspace */ }
}
function recallPanel() { return livePanel; }
function recallProject() {
  if (livePanel) return livePanel.project;
  try { const value = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null'); return value && typeof value.project === 'string' && value.project ? value.project : null; } catch { return null; }
}
function recallWorkspaces() {
  try { const list = JSON.parse(localStorage.getItem(WORKSPACE_LIST_KEY) || '[]'); return Array.isArray(list) ? list.filter(entry => typeof entry === 'string' && entry).slice(0, 5) : []; } catch { return []; }
}
function forgetPanel() {
  livePanel = null;
  try { localStorage.removeItem(WORKSPACE_KEY); } catch { /* ignore */ }
}

export function AtlPanel() {
  const [project, setProject] = useState(recallProject() || '');
  const [panel, setPanel] = useState(recallPanel());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(true);
  const restored = useRef(false);

  async function openProject(value) {
    const response = await fetch(new URL('api/atl/open', document.baseURI), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Could not open ATL (${response.status})`);
    rememberPanel(result);
    return result;
  }
  async function open(event) {
    event.preventDefault();
    setAuto(false);
    submit(project.trim());
  }
  function submit(value) {
    setBusy(true); setError('');
    openProject(value).then(setPanel).catch(failure => setError(failure.message)).finally(() => setBusy(false));
  }
  useEffect(() => {
    // Automatic workspace opening: first launch shows no directory form. A stored
    // workspace re-opens; otherwise an empty project lets the server resolve the
    // machine default (last opened, else the ATL home workspace). The open route
    // is idempotent — the same project returns the live panel id, and a control
    // plane that died while hidden is re-spawned under a fresh id.
    if (restored.current) return;
    restored.current = true;
    const stored = recallProject();
    const attachedId = recallPanel()?.id ?? null;
    setBusy(true);
    openProject(stored || '').then(result => { if (result.id !== attachedId) setPanel(result); }).catch(failure => { if (!recallPanel()) setError(failure.message); }).finally(() => { setBusy(false); setAuto(false); });
  }, []);
  const buttonStyle = { border: '1px solid currentColor', borderRadius: 8, padding: '8px 14px', color: 'inherit', background: 'transparent', cursor: 'pointer' };
  if (panel) return h('section', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', flexShrink: 0 } }, h('strong', null, 'ATL'), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }, title: panel.project }, panel.project), h('button', { type: 'button', style: buttonStyle, onClick: () => { forgetPanel(); setPanel(null); setProject(''); setError(''); } }, 'Change project')),
    h('iframe', { title: 'ATL Control Plane', src: new URL(`api/atl/view?id=${encodeURIComponent(panel.id)}`, document.baseURI).href, style: { border: 0, width: '100%', flex: 1, minHeight: 400 }, allow: 'clipboard-write' }));
  const remembered = recallWorkspaces().filter(entry => entry !== project);
  const chipStyle = { border: '1px solid currentColor', borderRadius: 999, padding: '5px 12px', color: 'inherit', background: 'transparent', cursor: 'pointer', font: 'inherit', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  // First launch never sees the directory setup: the workspace opens itself.
  // The form remains only as the explicit "Change project" path and as the
  // fallback when automatic opening fails.
  if (auto && !error) return h('section', { style: { maxWidth: 680, margin: '48px auto', padding: 24, color: 'inherit' } },
    h('h1', null, 'ATL Control Plane'),
    h('p', { style: { opacity: 0.75 } }, 'Opening your ATL workspace…'));
  return h('section', { style: { maxWidth: 680, margin: '48px auto', padding: 24, color: 'inherit' } },
    h('h1', null, 'ATL Control Plane'),
    h('p', null, 'Plan work, review tasks and manage runs inside DeepSeek Harness.'),
    h('form', { onSubmit: open },
      remembered.length ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 } }, remembered.map(entry => h('button', { key: entry, type: 'button', title: entry, style: chipStyle, disabled: busy, onClick: () => { setProject(entry); submit(entry); } }, entry))) : null,
      h('label', { htmlFor: 'atl-project', style: { display: 'block', marginBottom: 8 } }, 'Project directory'),
      h('input', { id: 'atl-project', value: project, onChange: event => setProject(event.target.value), placeholder: '${PROJECTS}', required: true, disabled: busy, style: { width: '100%', padding: 12, border: '1px solid currentColor', borderRadius: 8, background: 'transparent', color: 'inherit', font: 'inherit', marginBottom: 16 } }),
      h('p', { style: { opacity: 0.75 } }, 'ATL keeps its records in one workspace; opening prepares ATL project state and starts no workers. Your workspace reopens automatically — register other repositories on the Projects page.'),
      h('button', { type: 'submit', disabled: busy || !project.trim(), style: buttonStyle }, busy ? 'Opening…' : 'Open Control Plane'),
      error ? h('p', { role: 'alert' }, error) : null));
}

export function apply(ctx) {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, AtlPanel));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 15, label: () => 'ATL' }, ({ size = 20 }) => h('span', { 'aria-hidden': true, style: { fontSize: size, fontWeight: 700 } }, '◇')));
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: '@depie99/atl-plugin' }, () => h('section', { style: { padding: '20px 0' } }, h('h2', null, 'ATL Control Plane'), h('p', null, 'Open the embedded workspace to manage your work.'), h('button', { type: 'button', onClick: () => ctx.layout.selectPanel(PANEL) }, 'Open Control Plane'))));
}
