import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { discoverProvider } from "./providers.mjs";
import { spawnPlan } from "./worker.mjs";

const catalogs = new Map();

export function readCodexModels(executable, { launch = spawn, timeoutMs = 5000 } = {}) {
  const { command, args, windowsVerbatimArguments } = spawnPlan(executable, ["app-server"]);
  return new Promise((resolve) => {
    let child;
    try {
      child = launch(command, args, {
        windowsHide: true, windowsVerbatimArguments, stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      resolve(null);
      return;
    }
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const models = [];
    let defaultModel = null;
    let finished = false;
    const timer = setTimeout(() => finish(null), timeoutMs);
    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      child.kill();
      resolve(result);
    }
    function send(message) {
      child.stdin.write(JSON.stringify(message) + "\n");
    }
    child.once("error", () => finish(null));
    child.once("close", () => finish(null));
    child.stdin.on("error", () => finish(null));
    lines.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) return finish(null);
      if (message.id === 1) {
        send({ method: "initialized" });
        return send({ id: 2, method: "model/list", params: { includeHidden: false } });
      }
      if (!Array.isArray(message.result?.data)) return finish(null);
      for (const entry of message.result.data) {
        if (typeof entry?.model !== "string" || !entry.model || entry.hidden) continue;
        models.push({ id: entry.model, label: entry.displayName || entry.model });
        if (entry.isDefault) defaultModel = entry.model;
      }
      const cursor = message.result.nextCursor;
      if (cursor) return send({ id: 2, method: "model/list", params: { cursor, includeHidden: false } });
      finish({ models, defaultModel });
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "atl", version: "1.0.0" } } });
  });
}

export async function withCodexModelCatalog(worker) {
  if (worker?.id !== "codex" || worker.method !== "chatgpt" || !worker.installed) return worker;
  const executable = discoverProvider("codex", { command: worker.command }).path;
  if (!executable) return { ...worker, models: [], defaultModel: null, ready: false, cliCatalog: true };
  let entry = catalogs.get(executable);
  if (!entry || entry.expires <= Date.now()) {
    entry = { expires: Infinity };
    catalogs.set(executable, entry);
    entry.result = readCodexModels(executable).then((catalog) => {
      entry.expires = Date.now() + (catalog ? 30_000 : 0);
      return catalog;
    });
  }
  const catalog = await entry.result;
  const models = catalog?.models || [];
  const defaultModel = models.some(({ id }) => id === worker.defaultModel)
    ? worker.defaultModel
    : catalog?.defaultModel || models[0]?.id || null;
  return { ...worker, models, defaultModel, ready: models.length > 0, cliCatalog: true };
}
