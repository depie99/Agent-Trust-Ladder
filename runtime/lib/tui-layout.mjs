export const MIN_TUI_WIDTH = 60;

export function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function layoutFor(width, height) {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);
  const mode = safeWidth >= 120 ? "wide" : safeWidth >= 80 ? "medium" : safeWidth >= MIN_TUI_WIDTH ? "narrow" : "resize";
  const sidebar = mode === "wide" ? 24 : mode === "medium" ? 6 : 0;
  const inspector = mode === "wide" ? 32 : mode === "medium" ? 0 : 0;
  const main = Math.max(0, safeWidth - sidebar - inspector - (sidebar ? 2 : 0) - (inspector ? 2 : 0));
  return {
    width: safeWidth,
    height: safeHeight,
    mode,
    isInteractive: mode !== "resize",
    sidebar,
    inspector,
    main,
    showSidebar: mode === "wide" || mode === "medium",
    showInspector: mode === "wide",
    singlePane: mode === "narrow" || mode === "resize",
    minimumMessage: mode === "resize" ? `Resize the terminal to at least ${MIN_TUI_WIDTH} columns.` : null,
  };
}

export function wrapLine(value, width) {
  const max = Math.max(1, Number(width) || 1);
  const text = String(value ?? "");
  if (!text) return [""];
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw) {
      lines.push("");
      continue;
    }
    let remaining = raw;
    while (remaining.length > max) {
      let cut = remaining.lastIndexOf(" ", max);
      if (cut < Math.floor(max * 0.5)) cut = max;
      lines.push(remaining.slice(0, cut).trimEnd());
      remaining = remaining.slice(cut).trimStart();
    }
    lines.push(remaining);
  }
  return lines;
}

export function wrapLines(values, width) {
  return (values || []).flatMap((value) => wrapLine(value, width));
}

export function viewport(lines, { height, offset = 0 } = {}) {
  const rows = Array.isArray(lines) ? lines : [];
  const visible = Math.max(1, Number(height) || 1);
  const maxOffset = Math.max(0, rows.length - visible);
  const safeOffset = clamp(offset, 0, maxOffset);
  return {
    lines: rows.slice(safeOffset, safeOffset + visible),
    offset: safeOffset,
    maxOffset,
    total: rows.length,
  };
}
