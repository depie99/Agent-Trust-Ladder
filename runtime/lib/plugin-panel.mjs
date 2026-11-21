// Same Control Plane HTTP contract, carried over the host's MCP App bridge.
// ZCode 3.18 blocks nested-frame navigation, including declared loopback frames.
function csrfFrom(html) {
  return html.match(/<meta\s+name=["']atl-csrf["']\s+content=["']([^"']*)["']/i)?.[1] || "";
}

async function readPanelRoot(panel) {
  const response = await fetch(panel.url, { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`Control Plane startup failed (${response.status})`);
  const html = await response.text();
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  return { html, cookie, csrf: csrfFrom(html) };
}

export async function createPanelGateway(panel) {
  let auth = await readPanelRoot(panel);
  return { panel, async request(input, signal) {
    const target = new URL(input.path, panel.origin);
    if (target.origin !== panel.origin || target.username || target.password || !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(input.method || "GET")) throw new Error("Invalid Control Plane request");
    const method = input.method || "GET";
    if (target.pathname === "/" && method === "GET") return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: Buffer.from(auth.html).toString("base64") };
    const send = (csrf) => {
      const headers = { cookie: auth.cookie, origin: panel.origin };
      for (const [name, value] of Object.entries(input.headers || {})) if (["content-type", "x-atl-csrf"].includes(name.toLowerCase())) headers[name.toLowerCase()] = String(value);
      if (csrf) headers["x-atl-csrf"] = csrf;
      return fetch(target, { method, headers, redirect: "error", signal, ...(!["GET", "HEAD"].includes(method) && input.body != null ? { body: input.body } : {}) });
    };
    let response = await send("");
    if (response.status === 403) {
      await response.arrayBuffer();
      auth = await readPanelRoot(panel);
      response = await send(auth.csrf);
    }
    let body;
    if (response.headers.get("content-type")?.startsWith("text/event-stream")) {
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        for (;;) { const item = await reader.read(); if (item.done) break; chunks.push(Buffer.from(item.value)); size += item.value.length; if (Buffer.concat(chunks, size).includes("\n\n")) break; }
        body = Buffer.concat(chunks, size);
      } finally { await reader.cancel(); }
    } else body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: Object.fromEntries([...response.headers].filter(([name]) => ["content-type", "content-disposition"].includes(name))), body: body.toString("base64") };
  } };
}
