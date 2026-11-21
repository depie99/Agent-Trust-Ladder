// Cursor-based polling shared by plugin presentation adapters. It has one
// abortable request at a time, retries failures with bounded backoff, and
// treats unchanged frames as liveness only.
export function createSnapshotPoller({ request, cursor = 0, onSnapshot, onUnchanged, onError, signal, interval = 2000 }) {
  let stopped = false, timer = null, failures = 0;
  const stop = () => { stopped = true; clearTimeout(timer); };
  signal?.addEventListener('abort', stop, { once: true });
  async function poll() {
    if (stopped || signal?.aborted || globalThis.document?.hidden) { if (!stopped) timer = setTimeout(poll, interval); return; }
    try {
      const payload = await request(cursor);
      if (stopped) return;
      if (Number.isSafeInteger(Number(payload.cursor))) cursor = Number(payload.cursor);
      failures = 0;
      if (payload.unchanged) onUnchanged?.(payload);
      else onSnapshot?.(payload);
      timer = setTimeout(poll, interval);
    } catch (error) {
      if (stopped) return;
      failures++;
      onError?.(error);
      timer = setTimeout(poll, Math.min(15000, 500 * (2 ** Math.min(failures, 5))));
    }
  }
  void poll();
  return { stop, get cursor() { return cursor; } };
}
