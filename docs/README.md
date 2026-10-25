# ATL documentation site prototype

This is the first static UI concept for the ATL documentation website. It is intentionally dependency-light: HTML, CSS, and a small browser script only.

## Preview

Open `index.html` in a browser, or serve this directory with any static file server. The prototype includes responsive navigation, theme switching, keyboard search, a workflow map, a contract-ledger example, and the bounded role of the Diagram Maker & Visualizer.

The site is published at <https://depie99.github.io/Agent-Trust-Ladder/> after the GitHub Pages workflow completes. The source repository remains the canonical home for the HTML, CSS, diagram HTML, and direct SVG preview.

The public site also documents ATL's model-routing loop: route by capability, require a plan, give the worker real tools, review with an independent model or context, verify the result, and log what worked. The vendor-neutral policy source is [`../config/model-routing.json`](../config/model-routing.json).

It also documents **manager mode**: the human stays at the portfolio level while named digital colleagues own bounded missions, report status and evidence, and leave a concise morning brief after unattended work.

The Jev guide is available as [Markdown](jev.md) and a [published documentation page](jev.html). It documents the optional `route --smart` and `triage --smart` commands, prompt shape, confidence thresholds, deterministic fallback, setup, and token policy.

The primary interface guide is [Web Control Plane](control-room.html). It documents `atl ui` / `atl control-plane`, browser spaces, compose/review/queue/preview/confirm behavior, Codex subscription setup, API-provider boundaries, safe stop behavior, and the [Control Plane workflow visual](diagrams/atl-web-control-plane.svg). The terminal TUI remains a compatibility surface and is intentionally not the primary guide while its UX is under improvement.

The [Codex history bridge](codex-history-bridge.html) documents how ATL projects its authoritative local feed and provider transcripts into Codex history, including the token-free app-server path, writer-lock rollover, idempotent checkpoints, and the explicit queue path for a normal visible turn. Its [architecture SVG](diagrams/codex-history-bridge.svg) and rendered Codex surface preview make the connection and display boundary concrete.

The launch announcement draft is in [linkedin-launch-post.md](linkedin-launch-post.md). It is intentionally kept beside the docs site so the public story can stay aligned with the actual workflow and evidence model.

The primary interface guide is [Web Control Plane](control-room.html). The visual companion set includes the [workflow visual](diagrams/atl-web-control-plane.svg) and a [sanitized browser-surface preview](diagrams/atl-web-control-plane-preview.svg). The preview is representative documentation art, not live project data.

ATL also keeps an evidence-linked project brain under `.trust/manager/brain/`. Claims retain source identifiers and revisions, duplicate imports are idempotent, conflicting claims are surfaced instead of overwritten, and bounded context packs can be rebuilt for a task. This is an execution aid, not a replacement for the human approval and verification gates.

## Diagram workflow rule

Use diagrams when architecture, ownership, lifecycle, or change impact is materially easier to understand visually. Keep diagram source alongside the documentation and link it to the evidence packet. A generated diagram communicates structure; it does not prove that the runtime, deployment consumer, or external service behaves as drawn.
