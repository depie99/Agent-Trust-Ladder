// Same Control Plane HTTP contract, carried over the host's MCP App bridge.
// ZCode 3.18 blocks nested-frame navigation, including declared loopback frames.
export async function createPanelGateway(panel) {
  const initial = await fetch(panel.url);
  if (!initial.ok) throw new Error(`Control Plane startup failed (${initial.status})`);
  const html = await initial.text();
  const cookie = initial.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  return { panel, async request(input, signal) {
    const target = new URL(input.path, panel.origin);
    if (target.origin !== panel.origin || target.username || target.password || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method || 'GET')) throw new Error('Invalid Control Plane request');
    const method = input.method || 'GET';
    if (target.pathname === '/' && method === 'GET') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(html).toString('base64') };
    const headers = { cookie, origin: panel.origin };
    for (const [name, value] of Object.entries(input.headers || {})) if (['content-type', 'x-atl-csrf'].includes(name.toLowerCase())) headers[name.toLowerCase()] = String(value);
    const response = await fetch(target, { method, headers, redirect: 'error', signal, ...(!['GET', 'HEAD'].includes(method) && input.body != null ? { body: input.body } : {}) });
    let body;
    if (response.headers.get('content-type')?.startsWith('text/event-stream')) {
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        for (;;) { const item = await reader.read(); if (item.done) break; chunks.push(Buffer.from(item.value)); size += item.value.length; if (Buffer.concat(chunks, size).includes('\n\n')) break; }
        body = Buffer.concat(chunks, size);
      } finally { await reader.cancel(); }
    } else body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: Object.fromEntries([...response.headers].filter(([name]) => ['content-type', 'content-disposition'].includes(name))), body: body.toString('base64') };
  } };
}
