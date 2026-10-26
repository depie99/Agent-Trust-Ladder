import fs from "node:fs";
import path from "node:path";

export function fakeProvider(root, mode = "success") {
  return async ({ workspace, task, role, signal }) => {
    if (mode === "delay") await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 200); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("cancelled")); }); });
    if (mode === "transient" && !task.__retried) { task.__retried = true; throw Object.assign(new Error("temporary provider outage"), { transient: true }); }
    if (["permanent", "unauthorized-write", "cross-project-read", "owner-credential"].includes(mode)) throw new Error(`${mode} probe blocked`);
    if (role === "rowan") { fs.mkdirSync(workspace, { recursive: true }); fs.writeFileSync(path.join(workspace, "fake-provider.txt"), "verified fake provider change\n"); }
    return { status: "complete", role, code_revision: `fake-${Date.now()}`, checks: ["fake-provider.txt exists"] };
  };
}
