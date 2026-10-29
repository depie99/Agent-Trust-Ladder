// A disposable, loopback-only preview of task assets. No live manager state
// or credentials are copied. The fixture is explicit and never counts as a
// passing observation until the actual rendered surface has been inspected.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { emptyState, createTask, saveState } from "./state.mjs";
import { safePath } from "./task-changes.mjs";

export async function startUiReviewPreview(workspace) {
  const base = fs.realpathSync(workspace);
  const assetRoot = safePath(base, "runtime");
  for (const name of ["control-plane.html", "control-plane-client.js", "control-plane-i18n.js"]) {
    if (!fs.statSync(safePath(base, `runtime/${name}`)).isFile()) throw new Error(`Missing preview asset ${name}`);
  }
  const parent = safePath(base, ".atl-evidence/ui-preview");
  fs.mkdirSync(parent, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(parent, "fixture-"));
  const state = emptyState();
  const sentence = "گزارش در مسیر D:/Projects/Agentic/evidence/check.json ذخیره شد";
  const task = createTask(state, { title: sentence });
  task.objective = "Synthetic Persian mixed-direction rendering fixture";
  state.log.push({ at: "2026-10-28T08:00:00.000Z", task: task.id, actor: "rowan", event: "preview_fixture", detail: sentence });
  saveState(fixture, state);
  fs.writeFileSync(path.join(fixture, "README.txt"), "Synthetic UI preview only. Not live task state.\n", "utf8");
  const { startControlPlaneServer } = await import("./control-plane-server.mjs");
  const running = await startControlPlaneServer(fixture, { assetRoot, readOnlyPreview: true });
  return { ...running, fixture, sentence, assetRoot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const running = await startUiReviewPreview(process.argv[2] || process.cwd());
  console.log(JSON.stringify({ url: running.url, fixture: running.fixture, assetRoot: running.assetRoot, sentence: running.sentence, synthetic: true }));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => running.server.close(() => process.exit(0)));
}
