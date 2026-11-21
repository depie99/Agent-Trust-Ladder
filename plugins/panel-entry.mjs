import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { createSnapshotPoller } from './snapshot-transport.mjs';

const app = new App({ name: 'agent-trust-ladder', version: '1.0.0' }, { availableDisplayModes: ['inline', 'fullscreen'] });
const status = document.querySelector('#atl-status');
const boot = document.querySelector('#atl-boot');
const origin = new URL(boot.dataset.url).origin;
// Marks the plugin presentation for the Control Plane client (default browser stays unmarked).
document.documentElement.dataset.atlContext = 'plugin';
const browserFetch = window.fetch.bind(window);
// Keep the canonical client's live snapshot stream on the same MCP transport.
class PanelEventSource extends EventTarget {
  readyState = 0;
  constructor(url) { super(); this.cursor = Number(new URL(url, `${origin}/`).searchParams.get('cursor') || 0); this.controller = new AbortController(); this.poller = createSnapshotPoller({ cursor: this.cursor, signal: this.controller.signal, request: async cursor => { const response = await panelFetch(`/api/snapshot?cursor=${cursor}`); if (!response.ok) throw new Error(`Snapshot poll failed (${response.status})`); return response.json(); }, onSnapshot: payload => { this.readyState = 1; this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify({ cursor: payload.cursor, snapshot: payload }) })); }, onUnchanged: () => { this.readyState = 1; this.dispatchEvent(new MessageEvent('unchanged', { data: '{}' })); }, onError: error => { this.readyState = 0; this.onerror?.(error); } }); }
  close() { this.readyState = 2; this.poller.stop(); this.controller.abort(); }
}
async function panelFetch(input, init) {
  const request = new Request(new URL(typeof input === 'string' ? input : input.url, `${origin}/`), init);
  if (new URL(request.url).origin !== origin) return browserFetch(input, init);
  const result = await app.callServerTool({ name: 'atl_panel_request', arguments: { path: request.url, method: request.method, headers: Object.fromEntries(request.headers), ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.text() } : {}) } });
  if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text || 'Control Plane request failed');
  const value = JSON.parse(result.content.find(item => item.type === 'text').text);
  return new Response(value.status === 204 || request.method === 'HEAD' ? null : Uint8Array.from(atob(value.body), c => c.charCodeAt(0)), { status: value.status, headers: value.headers });
}
async function connectPanel() { try {
  const applyTheme = () => {
    const context = app.getHostContext() || {};
    const light = context.theme === 'light';
    const hostLocale = context.locale || context.language || 'en-US';
    // Drive the Control Plane's own theming mechanism (html.light), not just a data attribute.
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.documentElement.classList.toggle('light', light);
    document.documentElement.lang = hostLocale;
    document.documentElement.dataset.atlHostLocale = /^fa(?:-|$)/i.test(hostLocale) ? 'fa-IR' : 'en-US';
    window.dispatchEvent(new CustomEvent('atl-host-locale', { detail: document.documentElement.dataset.atlHostLocale }));
    if (context.displayMode) document.documentElement.dataset.atlDisplay = context.displayMode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#f2f5f9' : '#0b1018');
    window.dispatchEvent(new CustomEvent('atl-host-appearance', { detail: { theme: light ? 'light' : 'dark', displayMode: context.displayMode } }));
  };
  app.onhostcontextchanged = applyTheme;
  await app.connect(new PostMessageTransport(window.parent, window.parent));
  status.textContent = 'Loading ATL Control Plane…';
  window.fetch = panelFetch;
  window.EventSource = PanelEventSource;
  const response = await panelFetch('/');
  const documentSource = new DOMParser().parseFromString(await response.text(), 'text/html');
  const scripts = [...documentSource.querySelectorAll('script')];
  scripts.forEach(script => script.remove());
  const base = document.createElement('base');
  base.href = `${origin}/`;
  documentSource.head.prepend(base);
  document.head.replaceChildren(...documentSource.head.childNodes);
  document.body.replaceChildren(...documentSource.body.childNodes);
  for (const original of scripts) {
    const script = document.createElement('script');
    for (const attribute of original.attributes) script.setAttribute(attribute.name, attribute.value);
    script.textContent = original.textContent;
    const loaded = script.src ? new Promise((resolve, reject) => { script.onload = resolve; script.onerror = () => reject(new Error(`Control Plane asset could not load: ${script.src}`)); }) : Promise.resolve();
    document.body.append(script);
    await loaded;
  }
  applyTheme();
} catch (error) {
  if (!status.isConnected) document.body.prepend(status);
  status.textContent = `ATL panel could not connect to the host: ${error.message}`;
} }
void connectPanel();
