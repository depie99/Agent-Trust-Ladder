import { layoutFor, viewport, wrapLines } from "./tui-layout.mjs";
import { actionRisk, statusToken, telemetryToken } from "./tui-theme.mjs";

export function boundedText(value, width) {
  return wrapLines([value], Math.max(1, Number(width) || 1));
}

export function statusBadge(status, { paint = (value) => value, plain = false } = {}) {
  const token = statusToken(status);
  return paint(`${token.mark} ${token.label}`, token.token, plain);
}

export function telemetryBadge(status, { paint = (value) => value, plain = false } = {}) {
  const token = telemetryToken(status);
  return paint(`${token.mark} ${token.label}`, token.token, plain);
}

export function actionLabel(label, kind = "read", { paint = (value) => value, plain = false } = {}) {
  const risk = actionRisk(kind);
  return paint(`${label} · ${risk.label}`, risk.token, plain);
}

export function shellGeometry(width, height) {
  return layoutFor(width, height);
}

export function boundedViewport(lines, width, height, offset = 0) {
  const wrapped = wrapLines(lines, Math.max(1, Number(width) || 1));
  return viewport(wrapped, { height, offset });
}
