export const TUI_TOKENS = Object.freeze({
  canvas: "canvas",
  surface: "surface",
  surfaceRaised: "surfaceRaised",
  textPrimary: "ink",
  textMuted: "muted",
  accent: "violet",
  info: "violet",
  success: "mint",
  warning: "amber",
  danger: "coral",
  unknown: "faint",
  focus: "violet",
});

export const STATUS_TOKENS = Object.freeze({
  new: { mark: "○", token: "muted", label: "New" },
  triaged: { mark: "◌", token: "violet", label: "Triaged" },
  assigned: { mark: "◔", token: "violet", label: "Assigned" },
  in_progress: { mark: "●", token: "mint", label: "Running" },
  in_review: { mark: "◉", token: "coral", label: "Review" },
  verifying: { mark: "◍", token: "amber", label: "Verify" },
  done: { mark: "◆", token: "mint", label: "Done" },
  blocked: { mark: "×", token: "amber", label: "Blocked" },
  escalated: { mark: "!", token: "coral", label: "Escalated" },
  rejected: { mark: "–", token: "muted", label: "Rejected" },
  archived: { mark: "⌁", token: "muted", label: "Archived" },
});

export function statusToken(status) {
  return STATUS_TOKENS[status] || { mark: "·", token: TUI_TOKENS.unknown, label: String(status || "Unknown") };
}

export function telemetryToken(status) {
  switch (status) {
    case "observed": return { mark: "●", token: TUI_TOKENS.success, label: "Observed" };
    case "estimated": return { mark: "≈", token: TUI_TOKENS.warning, label: "Estimate" };
    case "stale": return { mark: "◌", token: TUI_TOKENS.warning, label: "Stale" };
    case "unavailable": return { mark: "×", token: TUI_TOKENS.danger, label: "Unavailable" };
    default: return { mark: "?", token: TUI_TOKENS.unknown, label: "Unknown" };
  }
}

export function actionRisk(kind = "read") {
  if (kind === "destructive") return { token: TUI_TOKENS.danger, label: "destructive" };
  if (kind === "confirm") return { token: TUI_TOKENS.warning, label: "confirm" };
  if (kind === "mutation") return { token: TUI_TOKENS.accent, label: "changes state" };
  return { token: TUI_TOKENS.info, label: "read-only" };
}
