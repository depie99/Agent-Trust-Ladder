// Redaction applied when records are written to disk, not only when they are
// displayed (issue #35): provider transcripts, diagnostics and observation
// records otherwise keep absolute machine paths and pasted credentials.
import path from "node:path";

export function redactLocal(value, { root = null } = {}) {
  let text = String(value ?? "");
  if (!text) return text;
  text = text.replace(/sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*\S+/gi, "[redacted]");
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && home.length > 2) {
    text = text.split(home).join("~");
    const posixHome = home.replaceAll("\\", "/");
    if (posixHome !== home) text = text.split(posixHome).join("~");
  }
  if (root) {
    const resolved = path.resolve(root);
    text = text.split(resolved).join("<project>");
    const slashRoot = resolved.replaceAll("\\", "/");
    if (slashRoot !== resolved) text = text.split(slashRoot).join("<project>");
  }
  return text;
}
