import React, { useEffect, useRef, useState } from 'react';
const h = React.createElement;
const PANEL = 'atl-control-plane';
export const inject = ['slots', 'layout', 'sidebarRightTabs'];

// dsh unmounts the keyed main slot on every tab switch and remounts it on return,
// but this client module and its plugin fiber stay loaded. Keeping the open panel
// at module scope (plus a durable copy for fresh page loads) is what makes the
// workspace survive navigation; the idempotent open route heals a stale id.
let livePanel = null;

function rememberPanel(value) {
  livePanel = { id: value.id, project: value.project };
}
function recallPanel() { return livePanel; }
function forgetPanel() {
  livePanel = null;
}

export function AtlPanel() {
  const [project, setProject] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
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
    const controller = new AbortController();
    fetch(new URL('api/atl/workspaces', document.baseURI), { signal: controller.signal }).then(response => response.json()).then(result => {
      if (Array.isArray(result.workspaces)) { setWorkspaces(result.workspaces); setProject(current => current || result.workspaces[0]?.path || ''); }
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    // Automatic workspace opening: first launch selects the host's current
    // registered workspace, then remembers only the live panel in this process.
    // The open route
    // is idempotent — the same project returns the live panel id, and a control
    // plane that died while hidden is re-spawned under a fresh id.
    if (restored.current) return;
    restored.current = true;
    const attachedId = recallPanel()?.id ?? null;
    setBusy(true);
    openProject('').then(result => { if (result.id !== attachedId) setPanel(result); }).catch(failure => { if (!recallPanel()) setError(failure.message); }).finally(() => { setBusy(false); setAuto(false); });
  }, []);
  const buttonStyle = { border: '1px solid currentColor', borderRadius: 8, padding: '8px 14px', color: 'inherit', background: 'transparent', cursor: 'pointer' };
  if (panel) return h('section', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', flexShrink: 0 } }, h('strong', null, 'ATL'), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }, title: panel.project }, panel.project), h('button', { type: 'button', style: buttonStyle, onClick: () => { forgetPanel(); setPanel(null); setProject(''); setError(''); } }, 'Change project')),
    h('iframe', { title: 'ATL Control Plane', src: new URL(`api/atl/view?id=${encodeURIComponent(panel.id)}`, document.baseURI).href, style: { border: 0, width: '100%', flex: 1, minHeight: 400 }, allow: 'clipboard-write' }));
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
      h('label', { htmlFor: 'atl-project', style: { display: 'block', marginBottom: 8 } }, 'Host workspace'),
      h('select', { id: 'atl-project', value: project, onChange: event => setProject(event.target.value), required: true, disabled: busy || !workspaces.length, style: { width: '100%', padding: 12, border: '1px solid currentColor', borderRadius: 8, background: 'transparent', color: 'inherit', font: 'inherit', marginBottom: 16 } }, ...workspaces.map(item => h('option', { key: item.id, value: item.path }, `${item.title} — ${item.path}`))),
      h('p', { style: { opacity: 0.75 } }, workspaces.length ? 'ATL opens a project registered in the host. Opening prepares ATL task state and starts no workers.' : 'Add a workspace in the host first, then reopen ATL.'),
      h('button', { type: 'submit', disabled: busy || !project, style: { ...buttonStyle, cursor: busy || !project ? 'not-allowed' : 'pointer', opacity: busy || !project ? 0.55 : 1 } }, busy ? 'Opening…' : 'Open workspace'),
      error ? h('p', { role: 'alert' }, error) : null));
}

function AtlConfig(ctx) {
  const [report, setReport] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(new URL('api/atl/integrations', document.baseURI), { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`Integration status unavailable (${response.status})`)))
      .then(setReport).catch(error => { if (error.name !== 'AbortError') setReport({ error: error.message }); });
    return () => controller.abort();
  }, []);
  const items = report ? [
    ['Commands', Array.isArray(report.commands) ? report.commands.join(', ') || 'Unavailable' : 'Unavailable'],
    ['Directory picker', report.directoryPicker ? 'Available' : 'Unavailable'],
    ['Jobs', report.jobs ? 'Available' : 'Unavailable'],
    ['Action cards', report.actionCards ? 'Available' : 'Unavailable'],
    ['Approval service', report.approval ? 'Available' : 'Unavailable'],
  ] : [];
  return h('section', { style: { padding: 20, color: 'inherit' } },
    h('h2', null, 'ATL Control Plane'),
    h('p', null, 'Open the embedded workspace to manage your work.'),
    h('button', { type: 'button', onClick: () => ctx.layout.selectPanel(PANEL) }, 'Open Control Plane'),
    h('h3', null, 'Host integrations'),
    report?.error ? h('p', { role: 'alert' }, report.error) : null,
    !report ? h('p', { role: 'status' }, 'Checking host capabilities…') : null,
    report ? h('ul', { 'aria-label': 'ATL host integration status' }, ...items.map(([name, value]) => h('li', { key: name }, h('strong', null, `${name}: `), value))) : null);
}

function AtlTasksTab(ctx) {
  const [state, setState] = useState({ loading: true, error: '', tasks: [] });
  useEffect(() => {
    let stopped = false, timer = null, failures = 0, panelId = null;
    const controller = new AbortController();
    const api = (path, init = {}) => fetch(new URL(path, document.baseURI), { ...init, signal: controller.signal });
    async function refresh() {
      if (stopped || document.hidden) { if (!stopped) timer = setTimeout(refresh, 4000); return; }
      try {
        if (!panelId) {
          const opened = await api('api/atl/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: '' }) });
          const openedBody = await opened.json();
          if (!opened.ok) throw new Error(openedBody.error || `ATL connection failed (${opened.status})`);
          panelId = openedBody.id;
        }
        const response = await api('api/atl/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: panelId, path: '/api/snapshot', method: 'GET' }) });
        const envelope = await response.json();
        if (!response.ok) throw new Error(envelope.error || `ATL snapshot failed (${response.status})`);
        const payload = JSON.parse(atob(envelope.body || 'e30='));
        const tasks = Object.values(payload.snapshot?.state?.tasks || payload.snapshot?.tasks || {});
        if (!stopped) setState({ loading: false, error: '', tasks });
        failures = 0;
        timer = setTimeout(refresh, 5000);
      } catch (error) {
        if (stopped || error.name === 'AbortError') return;
        failures++;
        if (!stopped) setState(old => ({ ...old, loading: false, error: error.message }));
        if (failures >= 3) panelId = null;
        timer = setTimeout(refresh, Math.min(20000, 1000 * (2 ** Math.min(failures, 4))));
      }
    }
    const visible = () => { if (!document.hidden) { clearTimeout(timer); void refresh(); } };
    document.addEventListener('visibilitychange', visible);
    void refresh();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const buttonStyle = { border: '1px solid currentColor', borderRadius: 8, padding: '8px 14px', color: 'inherit', background: 'transparent', cursor: 'pointer' };
  const active = state.tasks.filter(task => !['done', 'archived', 'rejected'].includes(task.status));
  return h('section', { style: { padding: 16, color: 'inherit', overflow: 'auto', maxHeight: '100%' }, 'aria-label': 'ATL task status' },
    h('header', { style: { display: 'flex', alignItems: 'center', gap: 10 } }, h('h2', { style: { flex: 1 } }, 'ATL Tasks'), h('button', { type: 'button', onClick: () => ctx.layout.selectPanel(PANEL), style: buttonStyle }, 'Open task workspace')),
    state.loading ? h('p', { role: 'status' }, 'Loading tasks…') : null,
    state.error ? h('p', { role: 'alert', style: { color: '#c44' } }, state.error) : null,
    !state.loading && !state.error ? h('p', null, `${active.length} active · ${state.tasks.length - active.length} completed`) : null,
    h('ul', { style: { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 } }, ...active.map(task => h('li', { key: task.id, style: { border: '1px solid color-mix(in srgb, currentColor 18%, transparent)', borderRadius: 8, padding: 10 } }, h('strong', null, task.id), h('span', { style: { marginLeft: 8, opacity: .7 } }, task.status), h('div', { style: { marginTop: 4, overflowWrap: 'anywhere' } }, task.title || 'Untitled task')))),
    !state.loading && !state.error && !active.length ? h('p', null, 'No active tasks in this workspace.') : null);
}

export function apply(ctx) {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, AtlPanel));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 15, label: () => 'ATL' }, ({ size = 20 }) => h('span', { 'aria-hidden': true, style: { fontSize: size, fontWeight: 700 } }, '◇')));
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: '@depie99/atl-plugin/tasks', kind: 'atl-tasks', title: () => 'ATL Tasks' }));
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: '@depie99/atl-plugin/tasks' }, () => AtlTasksTab(ctx)));
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: '@depie99/atl-plugin' }, () => AtlConfig(ctx)));
}
