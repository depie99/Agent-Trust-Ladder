import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTask, emptyState, saveState } from "../runtime/lib/state.mjs";
import { consumeSgrMousePackets, createDashboardSnapshot, dashboardPanelOrigin, dashboardTaskIndexAtPoint, renderControlPlaneShell, renderDashboard, renderPlanStudioScreen, renderQueuesScreen, renderSettingsScreen, renderTasksScreen, sidebarRouteAtPanelRow, TUI_NAV_ITEMS, panelFromColumn } from "../runtime/lib/dashboard.mjs";
import { frameIntent, savePlanDraft } from "../runtime/lib/plan-studio.mjs";
import { dispatchTuiCommand } from "../runtime/lib/command-console.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-nav-plan-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));
saveState(root, emptyState());

assert.ok(TUI_NAV_ITEMS.some((item) => item[0] === "plan"), "Plan Studio is discoverable in the sidebar");
assert.deepEqual(TUI_NAV_ITEMS.map((item) => item[0]), ["dashboard", "tasks", "plan", "queue", "team", "activity", "usage", "settings"], "sidebar follows the prototype's eight-page model");
assert.equal(panelFromColumn(120, 2), "nav", "wide dashboard columns route into the sidebar");
assert.equal(panelFromColumn(120, 26), "portfolio", "wide dashboard columns route after the sidebar");
assert.equal(sidebarRouteAtPanelRow(4, 22), "dashboard", "full sidebar row maps to Overview");
assert.equal(sidebarRouteAtPanelRow(5, 22), "tasks", "full sidebar row maps to Tasks");
assert.equal(sidebarRouteAtPanelRow(6, 22), "plan", "full sidebar row maps to Plan Studio");
assert.equal(sidebarRouteAtPanelRow(7, 22), "queue", "full sidebar row maps to Queues");
assert.equal(sidebarRouteAtPanelRow(10, 22), "team", "full sidebar row maps to Agent Team");
assert.equal(sidebarRouteAtPanelRow(1, 16), "tasks", "compact sidebar row maps to Tasks");
assert.equal(sidebarRouteAtPanelRow(2, 16), "plan", "compact sidebar row maps to Plan Studio");

const seeded = emptyState();
for (const [title, status] of [["First task", "blocked"], ["Second task", "blocked"], ["Third task", "done"]]) {
  const task = createTask(seeded, { title, status, priority: "normal", objective: title });
  task.status = status;
}
saveState(root, seeded);
const seededSnapshot = createDashboardSnapshot(root);
const narrowOrigin = dashboardPanelOrigin(seededSnapshot, 80);
assert.equal(dashboardTaskIndexAtPoint(seededSnapshot, { x: 12, y: narrowOrigin + 1, width: 80, height: 30 }), 0, "compact click on first task selects first task");
assert.equal(dashboardTaskIndexAtPoint(seededSnapshot, { x: 12, y: narrowOrigin + 3, width: 80, height: 30 }), 1, "compact click on second task selects second task");
assert.equal(dashboardTaskIndexAtPoint(seededSnapshot, { x: 12, y: narrowOrigin + 20, width: 80, height: 30 }), -1, "compact click outside portfolio does not select a task");
const wideOrigin = dashboardPanelOrigin(seededSnapshot, 120);
assert.equal(dashboardTaskIndexAtPoint(seededSnapshot, { x: 28, y: wideOrigin + 3, width: 120, height: 30 }), 1, "wide click on second task selects second task");
assert.equal(dashboardTaskIndexAtPoint(seededSnapshot, { x: 94, y: wideOrigin + 3, width: 120, height: 30 }), -1, "wide click in selected-task pane does not select a portfolio task");

const splitPrefix = "\u001b[<0;23;8";
const splitFirst = consumeSgrMousePackets(splitPrefix);
assert.equal(splitFirst.packets.length, 0, "incomplete SGR packet is not dispatched early");
assert.equal(splitFirst.remainder, splitPrefix, "incomplete SGR packet is retained");
const splitSecond = consumeSgrMousePackets(`${splitFirst.remainder}M`);
assert.deepEqual(splitSecond.packets, [{ button: 0, x: 22, y: 7, type: "M" }], "split SGR packet is reconstructed into one click");
assert.equal(splitSecond.remainder, "", "complete SGR packet is removed from the buffer");
const mouseFamilies = consumeSgrMousePackets("\u001b[<0;23;8M\u001b[<0;23;8m\u001b[<64;23;8M\u001b[<65;23;8M");
assert.deepEqual(mouseFamilies.packets.map(({ button, type }) => ({ button, type })), [
  { button: 0, type: "M" },
  { button: 0, type: "m" },
  { button: 64, type: "M" },
  { button: 65, type: "M" },
], "click, release, wheel-up, and wheel-down share the normalized packet contract");
const dashboardSource = fs.readFileSync(new URL("../runtime/lib/dashboard.mjs", import.meta.url), "utf8");
assert.doesNotMatch(dashboardSource, /const row = Number\(match\[3\]\) - 1/, "wheel handling never reaches back into the removed regex-match representation");

const dashboard = renderDashboard(createDashboardSnapshot(root), { width: 120, height: 30, plain: true, interactive: false });
assert.match(dashboard, /ATL CONTROL/);
const mediumDashboard = renderDashboard(createDashboardSnapshot(root), { width: 80, height: 30, plain: true, interactive: true });
assert.match(mediumDashboard, /ROUTES/);
assert.match(mediumDashboard, /Plan Studio/);
assert.match(dashboard, /Plan Studio/);
assert.match(dashboard, /Usage/);
const pageUi = { tasksFilter: "All", tasksQuery: "", tasksSelected: 0, queuePageSelected: 0 };
const tasksPage = renderControlPlaneShell(dashboard && createDashboardSnapshot(root), {
  route: "tasks",
  body: renderTasksScreen(createDashboardSnapshot(root), pageUi, 95, 24, true),
  width: 120,
  height: 30,
  plain: true,
});
assert.match(tasksPage, /TASKS/);
assert.match(tasksPage, /atl ›/);
assert.match(renderQueuesScreen(createDashboardSnapshot(root), pageUi, 95, 24, true), /QUEUES/);

const intent = "Make the developer TUI manage tasks, queues, plans, and live team evidence.";
const draft = savePlanDraft(root, { intent, artifact: frameIntent(intent, { skills: ["atl-plan", "atl-verify"] }), stage: "frame" });
const plan = renderPlanStudioScreen(root, { planStudio: { draft } }, 100, 28, true);
assert.match(plan, /PLAN STUDIO/);
assert.match(plan, /intent → frame → specify/);
assert.match(plan, /deterministic|DRAFT/);
assert.match(renderSettingsScreen(root, { snapshot: createDashboardSnapshot(root) }, 100, 28, true), /SETTINGS/);
const commandPlan = dispatchTuiCommand(root, "plan frame Make the sidebar route to real ATL pages");
assert.equal(commandPlan.ok, true, "plan frame is available inside the command console");
assert.match(commandPlan.lines.join("\n"), /Plan draft .* saved/);

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: TUI navigation sidebar and Plan Studio route");
