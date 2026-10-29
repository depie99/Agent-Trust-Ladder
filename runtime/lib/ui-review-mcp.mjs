// Session-scoped stdio MCP tools for ATL's isolated Control Plane preview.
// No user profile, live state, arbitrary evaluate or external navigation.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { probeUiReviewRuntime } from "./ui-review-runtime.mjs";
import { startUiReviewPreview } from "./ui-review-preview.mjs";
import { safePath } from "./task-changes.mjs";

const schema = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = { type: "string" };
export const browserTools = [
  { name: "browser_preview", description: "Start this task's isolated synthetic preview and test the actual browser connection. Returns URL and DOM, never a PASS.", inputSchema: schema() },
  { name: "browser_snapshot", description: "Read current rendered DOM/accessibility snapshot and visible selectors.", inputSchema: schema() },
  { name: "browser_action", description: "Interact with this isolated fixture using a selector from the current snapshot. Cannot reach live state or external sites.", inputSchema: schema({ action: { enum: ["click", "fill", "select", "press"] }, selector: str, value: str }, ["action", "selector"]) },
  { name: "browser_inspect", description: "Read computed direction, unicode-bidi, fonts, geometry and nested isolation fragments for a CSS selector.", inputSchema: schema({ selector: str }, ["selector"]) },
  { name: "browser_screenshot", description: "Capture PNG plus DOM/style evidence. Returns the actual image for model visual inspection; does not assert a result.", inputSchema: schema() },
  { name: "browser_viewport", description: "Set the test viewport to inspect desktop/mobile layout.", inputSchema: schema({ width: { type: "integer", minimum: 320, maximum: 2560 }, height: { type: "integer", minimum: 320, maximum: 1600 } }, ["width", "height"]) },
  { name: "browser_reload", description: "Reload the actual task assets after a code repair.", inputSchema: schema() },
];
const text = (value) => ({ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) });

export function createBrowserTools(root, workspace) {
  const runtime = probeUiReviewRuntime(root, workspace);
  let running, browser, context, page, loadedAssets;
  const assetHashes = () => Object.fromEntries(["control-plane.html", "control-plane-client.js", "control-plane-i18n.js"].map((file) => [file, crypto.createHash("sha256").update(fs.readFileSync(safePath(workspace, `runtime/${file}`))).digest("hex")]));
  const observations = [];
  async function close() {
    if (browser) await browser.close();
    if (running) { running.server.closeAllConnections?.(); await new Promise((resolve) => running.server.close(resolve)); }
    browser = context = page = running = null;
  }
  async function start() {
    if (page) return;
    if (!runtime.available) throw new Error(runtime.reason);
    try {
      const require = createRequire(import.meta.url);
      const { chromium } = require(path.join(runtime.playwrightRoot, "index.js"));
      browser = await chromium.launch({ executablePath: runtime.browserExecutable, headless: true });
      context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block", acceptDownloads: false });
      running = await startUiReviewPreview(workspace);
      const origin = new URL(running.url).origin;
      await context.route("**/*", (route) => {
        const request = route.request();
        return new URL(request.url()).origin === origin && ["GET", "HEAD"].includes(request.method()) ? route.continue() : route.abort("blockedbyclient");
      });
      page = await context.newPage();
      page.setDefaultTimeout(8000);
      loadedAssets = assetHashes();
      await page.goto(running.url);
      await page.locator(".event").first().waitFor();
    } catch (error) { await close(); throw error; }
  }
  async function inspect(selector) {
    return page.locator(selector).evaluateAll((nodes) => nodes.slice(0, 100).map((node) => {
      const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
      return { text: node.textContent, html: node.outerHTML, direction: style.direction, unicodeBidi: style.unicodeBidi, fontFamily: style.fontFamily,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        fragments: [...node.querySelectorAll("bdi,[dir]")].map((fragment) => ({ text: fragment.textContent, direction: getComputedStyle(fragment).direction, unicodeBidi: getComputedStyle(fragment).unicodeBidi })) };
    }));
  }
  async function call(name, args = {}) {
    const tool = browserTools.find((item) => item.name === name);
    if (!tool) throw new Error(`Unknown tool ${name}`);
    for (const key of tool.inputSchema.required) if (!(key in args)) throw new Error(`Missing ${key}`);
    if (Object.keys(args).some((key) => !(key in tool.inputSchema.properties))) throw new Error("Unknown argument");
    await start();
    let result;
    if (name === "browser_action") {
      const locator = page.locator(args.selector);
      if (args.action === "click") await locator.click();
      else if (args.action === "fill") await locator.fill(args.value);
      else if (args.action === "select") await locator.selectOption(args.value);
      else if (args.action === "press") await locator.press(args.value);
      else throw new Error("Unsupported action");
      result = { snapshot: await page.locator("body").ariaSnapshot() };
    } else if (name === "browser_inspect") {
      result = { selector: args.selector, nodes: await inspect(args.selector) };
    } else if (name === "browser_viewport") {
      if (![args.width, args.height].every(Number.isInteger) || args.width < 320 || args.width > 2560 || args.height < 320 || args.height > 1600) throw new Error("Invalid viewport");
      await page.setViewportSize({ width: args.width, height: args.height });
      result = { viewport: page.viewportSize(), snapshot: await page.locator("body").ariaSnapshot() };
    } else if (name === "browser_reload") {
      loadedAssets = assetHashes();
      await page.reload();
      result = { snapshot: await page.locator("body").ariaSnapshot() };
    } else if (name === "browser_screenshot") {
      const assets = assetHashes();
      if (JSON.stringify(assets) !== JSON.stringify(loadedAssets)) throw new Error("Task assets changed since this page loaded. Use browser_reload before capturing evidence.");
      safePath(workspace, ".atl-evidence/ui-review");
      fs.mkdirSync(runtime.evidenceDir, { recursive: true });
      const stem = path.join(runtime.evidenceDir, `capture-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
      const bytes = await page.screenshot({ path: `${stem}.png`, fullPage: true });
      if (JSON.stringify(assetHashes()) !== JSON.stringify(assets)) throw new Error("Task assets changed during capture; reload and capture fresh evidence.");
      const evidence = { at: new Date().toISOString(), synthetic: true, url: page.url(), viewport: page.viewportSize(), assets,
        locale: await page.locator("html").evaluate((node) => ({ lang: node.lang, dir: node.dir })),
        snapshot: await page.locator("body").ariaSnapshot(), observations: [...observations],
        log: await inspect(".event"), screenshot: `${stem}.png`, screenshot_hash: crypto.createHash("sha256").update(bytes).digest("hex"), result: "NOT OBSERVED", note: "Capture only. The model must inspect this image and record its verdict through ATL observe." };
      fs.writeFileSync(`${stem}.json`, JSON.stringify(evidence, null, 2) + "\n", "utf8");
      return { content: [text({ ...evidence, evidence_file: `${stem}.json` }), { type: "image", data: bytes.toString("base64"), mimeType: "image/png" }] };
    } else {
      result = { url: page.url(), synthetic: true, snapshot: await page.locator("body").ariaSnapshot() };
    }
    observations.push({ tool: name, at: new Date().toISOString(), args, result });
    if (observations.length > 20) observations.shift();
    return { content: [text(result)] };
  }
  return { call, close };
}

export async function serveBrowserMcp(root, workspace, input = process.stdin, output = process.stdout) {
  const tools = createBrowserTools(root, workspace);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const reply = (message) => output.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  try {
    for await (const line of lines) {
      let request;
      try { request = JSON.parse(line); } catch { reply({ id: null, error: { code: -32700, message: "Invalid JSON" } }); continue; }
      if (request.id === undefined) continue;
      try {
        let result;
        if (request.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "atl-browser", version: "1.0.0" } };
        else if (request.method === "ping") result = {};
        else if (request.method === "tools/list") result = { tools: browserTools };
        else if (request.method === "tools/call") {
          try { result = await tools.call(request.params.name, request.params.arguments); }
          catch (error) { result = { isError: true, content: [text(error.message)] }; }
        } else { reply({ id: request.id, error: { code: -32601, message: "Method not found" } }); continue; }
        reply({ id: request.id, result });
      } catch (error) { reply({ id: request.id, error: { code: -32603, message: error.message } }); }
    }
  } finally { await tools.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await serveBrowserMcp(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
}
