// Runs inside the same-origin DSH frame; all ATL traffic uses the authenticated
// host connection route, including snapshots and dynamically loaded diagrams.
export async function frameBootstrap({ id, theme }) {
  const nativeFetch = window.fetch.bind(window);
  const endpoint = new URL('api/atl/request', parent.document.baseURI).href;
  const asset = path => new URL(`api/atl/asset?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`, parent.document.baseURI).href;
  async function panelFetch(input, init) {
    const request = new Request(new URL(typeof input === 'string' ? input : input.url, 'http://atl.invalid/'), init);
    if (new URL(request.url).origin !== 'http://atl.invalid') throw new Error('External panel requests are not allowed');
    const response = await nativeFetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: request.signal, body: JSON.stringify({ id, path: new URL(request.url).pathname + new URL(request.url).search, method: request.method, headers: Object.fromEntries(request.headers), ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.text() } : {}) }) });
    if (!response.ok) throw new Error(`ATL connection failed (${response.status})`);
    const value = await response.json();
    return new Response(value.status === 204 || request.method === 'HEAD' ? null : Uint8Array.from(atob(value.body), c => c.charCodeAt(0)), { status: value.status, headers: value.headers });
  }
  class PanelEventSource extends EventTarget {
    readyState = 0;
    constructor(url) { super(); this.sourceUrl = url; this.cursor = Number(new URL(url, 'http://atl.invalid/').searchParams.get('cursor') || 0); this.controller = new AbortController(); this.poll(); }
    close() { this.readyState = 2; clearTimeout(this.timer); this.controller.abort(); }
    // Each poll carries the newest cursor, so an unchanged workspace costs a tiny
    // liveness block instead of a full snapshot re-download every two seconds.
    eventsUrl() { return `${this.sourceUrl.split('?')[0]}?cursor=${this.cursor}`; }
    async poll() {
      try {
        const response = await panelFetch(this.eventsUrl(), { signal: this.controller.signal });
        if (!response.ok) throw new Error(`Snapshot failed (${response.status})`);
        if (this.readyState === 2) return;
        this.readyState = 1;
        for (const block of (await response.text()).split('\n\n')) {
          const lines = block.split('\n');
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (data) {
            try { const parsedCursor = Number(JSON.parse(data).cursor); if (Number.isFinite(parsedCursor) && parsedCursor !== this.cursor) this.cursor = parsedCursor; } catch { /* blocks without a cursor keep the current one */ }
            this.dispatchEvent(new MessageEvent(lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message', { data }));
          }
        }
        this.timer = setTimeout(() => this.poll(), 2000);
      } catch (error) { if (this.readyState !== 2) { this.readyState = 0; this.onerror?.(error); } }
    }
  }
  try {
    document.documentElement.dataset.atlContext = 'plugin';
    localStorage.setItem('atl-cp-theme', theme);
    window.fetch = panelFetch;
    window.EventSource = PanelEventSource;
    const response = await panelFetch('/');
    if (!response.ok) throw new Error(`ATL page failed (${response.status})`);
    const source = new DOMParser().parseFromString(await response.text(), 'text/html');
    const scripts = [...source.querySelectorAll('script')];
    scripts.forEach(script => script.remove());
    source.querySelectorAll('[src],link[href]').forEach(el => {
      const key = el.hasAttribute('src') ? 'src' : 'href';
      const value = el.getAttribute(key);
      if (value && !/^(data:|https?:)/.test(value)) el.setAttribute(key, asset(value));
    });
    document.head.replaceChildren(...source.head.childNodes);
    document.body.replaceChildren(...source.body.childNodes);
    for (const original of scripts) {
      const script = document.createElement('script');
      let code = original.textContent;
      if (original.getAttribute('src')) {
        const result = await panelFetch(original.getAttribute('src'));
        if (!result.ok) throw new Error(`ATL asset failed (${result.status})`);
        code = await result.text();
      }
      script.textContent = code.replaceAll('/assets/mermaid.min.js', asset('/assets/mermaid.min.js'));
      document.body.append(script);
    }
    const syncTheme = () => {
      const light = parent.document.documentElement.classList.contains('light') || parent.document.documentElement.dataset.theme === 'light' || getComputedStyle(parent.document.documentElement).colorScheme === 'light';
      document.documentElement.classList.toggle('light', light);
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(parent.document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    addEventListener('pagehide', () => observer.disconnect(), { once: true });
  } catch (error) {
    document.body.textContent = "";
    const box = document.createElement("div");
    let light = false;
    try { light = parent.document.documentElement.classList.contains("light") || parent.document.documentElement.dataset.theme === "light"; } catch { /* parent unreachable: keep dark */ }
    box.style.cssText = `min-height:100vh;box-sizing:border-box;padding:28px;font:14px/1.7 system-ui,sans-serif;background:${light ? "#ffffff" : "#151517"};color:${light ? "#1a1a1a" : "#e6e6e6"};`;
    box.textContent = `ATL could not open: ${error.message}. Reopen the project from the ATL panel to reconnect.`;
    document.body.append(box);
  }
}
