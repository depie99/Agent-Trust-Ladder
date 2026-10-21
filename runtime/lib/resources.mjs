// Task resources are durable references, not prompt noise. Local files are
// copied into the task's manager attachment folder; URLs stay URLs and are
// never downloaded implicitly.

import fs from "node:fs";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".md", ".txt", ".csv", ".json", ".yaml", ".yml", ".xls", ".xlsx"]);

function cleanRef(value) {
  return String(value || "").trim().replace(/^<|>$/g, "").replace(/[.,;:]+$/, "");
}

function resolveAgainst(ref, baseUrl) {
  const value = cleanRef(ref);
  if (!baseUrl || /^(?:https?:|data:|file:|[a-zA-Z]:[\\/]|[\\/])/.test(value)) return value;
  try { return new URL(value, baseUrl).toString(); } catch { return value; }
}

function extensionOf(ref) {
  try {
    const value = ref.startsWith("http://") || ref.startsWith("https://") ? new URL(ref).pathname : ref;
    return path.extname(value.split(/[?#]/)[0]).toLowerCase();
  } catch {
    return path.extname(ref.split(/[?#]/)[0]).toLowerCase();
  }
}

export function resourceKind(ref) {
  const value = cleanRef(ref).toLowerCase();
  if (value.startsWith("data:image/") || IMAGE_EXTENSIONS.has(extensionOf(value))) return "image";
  if (value.startsWith("http://") || value.startsWith("https://")) return "link";
  if (DOCUMENT_EXTENSIONS.has(extensionOf(value))) return "document";
  return "file";
}

export function normalizeResource(ref, { label = "", caption = "", source = "manual", kind = null } = {}) {
  const target = cleanRef(ref);
  if (!target) return null;
  const inferredLabel = target.startsWith("http://") || target.startsWith("https://")
    ? (() => { try { return new URL(target).hostname; } catch { return target; } })()
    : path.basename(target);
  return {
    kind: kind || resourceKind(target),
    label: String(label || inferredLabel || "resource").trim(),
    ref: target,
    ...(caption ? { caption: String(caption).trim() } : {}),
    source: String(source || "manual"),
  };
}

function pushUnique(out, item) {
  if (!item || out.some((existing) => existing.ref === item.ref)) return;
  out.push(item);
}

export function extractResources(text, { source = "manual", baseUrl = "" } = {}) {
  const value = String(text || "");
  const out = [];
  const add = (ref, label = "", kind = null) => pushUnique(out, normalizeResource(resolveAgainst(ref, baseUrl), { label, source, kind }));
  for (const match of value.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) add(match[2], match[1], "image");
  for (const match of value.matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)) add(match[2], match[1]);
  for (const match of value.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) add(match[1], "Screenshot", "image");
  for (const match of value.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi)) add(match[1], String(match[2]).replace(/<[^>]+>/g, "").trim());
  for (const match of value.matchAll(/https?:\/\/[^\s<>()]+/g)) add(match[0]);
  return out;
}

export function addResourceToTask(root, task, ref, { label = "", caption = "", source = "manual", kind = null } = {}) {
  const resource = normalizeResource(ref, { label, caption, source, kind });
  if (!resource) throw new Error("resource needs a URL or local file path");
  const remote = /^https?:\/\//i.test(resource.ref) || /^data:/i.test(resource.ref);
  if (!remote) {
    const original = resource.ref;
    const resolved = path.isAbsolute(original) ? path.normalize(original) : path.resolve(root, original);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const dir = path.join(root, ".trust", "manager", "attachments", task.id);
      fs.mkdirSync(dir, { recursive: true });
      const safeName = path.basename(resolved).replace(/[^a-zA-Z0-9._-]+/g, "-") || "attachment";
      const destination = path.join(dir, safeName);
      if (path.normalize(resolved) !== path.normalize(destination)) fs.copyFileSync(resolved, destination);
      resource.ref = path.relative(root, destination).split(path.sep).join("/");
      resource.original_ref = original;
    } else {
      resource.missing = true;
    }
  }
  task.resources = Array.isArray(task.resources) ? task.resources : [];
  if (task.resources.some((item) => item.ref === resource.ref || item.original_ref === resource.original_ref)) {
    return { resource, added: false };
  }
  task.resources.push(resource);
  return { resource, added: true };
}
