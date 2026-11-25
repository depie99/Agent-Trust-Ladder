import assert from "node:assert/strict";

export async function checkPanelPlanningAndAssistant(frame, taskTitle) {
  const nav = (page) => frame.locator(`#mobile [data-page="${page}"]`);
  const taskVisible = async () => frame.getByText(taskTitle, { exact: true }).first().waitFor();

  // The shipped panel routes its assistant through the Ask ATL page (chat rail
  // + composed message), not the retired task-scoped assistant surface.
  await nav("assistant").click();
  await frame.locator("#askInput").waitFor();
  assert.equal(await frame.locator("#askSearch").count(), 1, "Ask ATL chat search ships in the panel");
  const message = "Review this task's acceptance checks.";
  await frame.locator("#askInput").fill(message);
  await frame.locator('[data-action="ask-picker"]').first().click();
  await frame.locator('[data-action="ask-picker-tab:project"]').click();
  await frame.locator("#askPickerProject").check();
  await frame.locator('[data-action="ask-picker-apply"]').click();
  assert.ok(await frame.locator(".ask-composer-chips .ask-chip").count() >= 1, "applied context appears in the panel composer");

  // The draft and its context survive a route change in the embedded panel.
  await nav("tasks").click();
  await taskVisible();
  await nav("assistant").click();
  assert.equal(await frame.locator("#askInput").inputValue(), message, "Ask ATL draft survives a panel repaint");

  // Plan Studio still generates a deterministic local skeleton from a goal.
  await nav("studio").click();
  const conversationTab = frame.locator('[data-action="studio-pane:conversation"]');
  if (await conversationTab.isVisible()) await conversationTab.click();
  await frame.locator("#goal").fill("Keep the acceptance checks observable.");
  await frame.locator(".studio-settings > summary").click();
  await frame.getByRole("button", { name: "Local skeleton", exact: true }).click();
  await frame.getByRole("button", { name: "Generate local skeleton", exact: true }).click();
  await frame.getByText("Local skeleton generated", { exact: false }).first().waitFor();
  const planTab = frame.locator('[data-action="studio-pane:plan"]');
  if (await planTab.isVisible()) await planTab.click();
  await frame.getByText("Local skeleton · structure only", { exact: true }).waitFor();
  await nav("tasks").click();
  await taskVisible();
}
