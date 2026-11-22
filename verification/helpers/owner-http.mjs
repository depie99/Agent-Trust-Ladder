// Read Control Plane owner-only endpoints with the same cookie + CSRF pair
// issued to the browser by the trusted project shell.
export async function ownerFetch(input, init = {}) {
  const target = input instanceof URL ? input : new URL(input);
  const root = await fetch(new URL('/', target), { cache: 'no-store' });
  const cookie = root.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  const html = await root.text();
  const csrf = html.match(/<meta\s+name="atl-csrf"\s+content="([^"]+)"/i)?.[1];
  if (!root.ok || !cookie || !csrf) throw new Error(`Could not establish Control Plane owner session (${root.status}).`);
  const headers = new Headers(init.headers || {});
  headers.set('cookie', cookie);
  headers.set('x-atl-csrf', csrf);
  return fetch(target, { ...init, headers });
}

export async function ownerJson(input, init = {}) {
  const response = await ownerFetch(input, init);
  if (!response.ok) throw new Error(`Authenticated Control Plane read failed (${response.status}).`);
  return response.json();
}
