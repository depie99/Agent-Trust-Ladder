import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

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
  constructor(url) { super(); this.url = url; this.poll(); }
  close() { this.readyState = 2; clearTimeout(this.timer); }
  async poll() {
    try {
      const response = await panelFetch(this.url);
      if (!response.ok) throw new Error(`Snapshot stream failed (${response.status})`);
      if (this.readyState === 2) return;
      this.readyState = 1;
      for (const block of (await response.text()).split('\n\n')) {
        const lines = block.split('\n'), data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) this.dispatchEvent(new MessageEvent(lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message', { data }));
      }
      this.timer = setTimeout(() => this.poll(), 2000);
    } catch (error) { if (this.readyState !== 2) { this.readyState = 0; this.onerror?.(error); } }
  }
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
    // Drive the Control Plane's own theming mechanism (html.light), not just a data attribute.
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.documentElement.classList.toggle('light', light);
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
