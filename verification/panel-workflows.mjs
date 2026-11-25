import assert from "node:assert/strict";

export async function checkPanelPlanningAndAssistant(frame, taskTitle) {
  const nav = (page) => frame.locator(`#mobile [data-page="${page}"]`);
  await nav("studio").click();
  const narrowPlanTab = frame.locator('[data-action="studio-pane:plan"]');
  if (await narrowPlanTab.isVisible()) await narrowPlanTab.click();
  else await frame.getByRole("button", { name: "Focus Plan", exact: true }).click();

  await nav("assistant").click();
  const search = frame.locator("#askHistorySearch");
  await frame.locator("#assistantMessage").waitFor();
  await search.fill(taskTitle);
  await frame.getByRole("button", { name: "Project conversation", exact: false }).waitFor({ state: "hidden" });
  await frame.getByRole("button", { name: taskTitle, exact: false }).click();
  const conversation = frame.locator("[data-ask-scope]:not([data-ask-scope=global])");
  await conversation.locator("#assistantMessage").fill("Review this task's acceptance checks.");
  await conversation.getByRole("button", { name: "Review & reuse" }).click();
  await frame.locator("#assistantReviewText").fill("Keep the acceptance checks observable.");
  await frame.getByRole("button", { name: "Use in Plan Studio" }).click();
  await frame.locator("#goal").waitFor({ state: "visible" });
  assert.match(await frame.locator("#goal").inputValue(), /Keep the acceptance checks observable/);
  await frame.locator(".studio-settings > summary").click();
  await frame.getByRole("button", { name: "Local skeleton", exact: true }).click();
  await frame.getByRole("button", { name: "Generate local skeleton", exact: true }).click();
  await frame.getByText("Local skeleton generated", { exact: false }).first().waitFor();
  const planTab = frame.locator('[data-action="studio-pane:plan"]');
  if (await planTab.isVisible()) await planTab.click();
  await frame.getByText("Local skeleton · structure only", { exact: true }).waitFor();
  await nav("tasks").click();
  await frame.getByText(taskTitle, { exact: true }).first().waitFor();
}
