import path from "node:path";

// Pure command construction only. Installing or removing an OS task remains
// an explicit operator action outside the ATL runner, so tests never alter the
// machine scheduler merely to prove the integration contract.
export function windowsScheduledTaskPlan({ taskName = "ATL Overnight Supervisor", nodePath = process.execPath, managerPath, projectRoot, at = "23:00" } = {}) {
  if (!managerPath || !projectRoot) throw new Error("managerPath and projectRoot are required");
  if (!/^\d{2}:\d{2}$/.test(String(at))) throw new Error("at must be HH:MM");
  const command = `\"${nodePath}\" \"${managerPath}\" overnight recover --confirm`;
  return {
    platform: "win32",
    taskName,
    schedule: { type: "daily", at },
    workingDirectory: path.resolve(projectRoot),
    create: ["schtasks.exe", "/Create", "/TN", taskName, "/SC", "DAILY", "/ST", at, "/TR", command, "/F"],
    remove: ["schtasks.exe", "/Delete", "/TN", taskName, "/F"],
  };
}
