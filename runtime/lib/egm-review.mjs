import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// Bounded EGM deep-review path for Plan Studio. The runner uses exactly the
// invocation proven in the compatibility probes: `codex exec --sandbox
// workspace-write` with the EGM plugin installed in CODEX_HOME, gate
// pre-emption in the delegation prompt, and file-based reports in a
// per-review workdir kept beside the draft for audit.

export const EGM_REQUIRED_REPORTS = ["zoom_out_report.md", "comprehension_report.md", "critic_report.md", "intermediate_zoom_out_report.md", "implementation_readiness_report.md", "consolidated_review_report.md"];
export const EGM_INPUT_FILE = "plan-review-input.md";

// Daily budget for deep reviews. Counted at START (a review spends its
// provider session even when it fails), reset per local day, ledger kept
// beside the manager state so it survives restarts and is auditable.
export function egmReviewBudgetGate(root, config, { now = () => new Date() } = {}) {
  const max = Number(config.maxReviewsPerDay) || 3;
  const day = now().toISOString().slice(0, 10);
  const file = path.join(root, ".trust", "manager", "plan-review-usage.json");
  let ledger = { day, started: 0 };
  try { const saved = JSON.parse(fs.readFileSync(file, "utf8")); if (saved.day === day) ledger = saved; } catch { /* first review */ }
  if (ledger.started >= max) {
    const refused = new Error(`the EGM deep-review daily budget is exhausted (${ledger.started}/${max} started today, cap egmReview.maxReviewsPerDay). A deep review costs a full provider session and roughly 15–25 minutes; raise the cap or wait for the next local day.`);
    refused.statusCode = 429;
    return { ok: false, reason: refused.message, status: refused.statusCode };
  }
  ledger.day = day;
  ledger.started += 1;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n");
  return { ok: true, started: ledger.started, max };
}

export function readEgmReviewConfig(cfg = {}) {
  const section = cfg.egmReview && typeof cfg.egmReview === "object" ? cfg.egmReview : null;
  if (!section || section.enabled !== true) return { enabled: false, backend: "codex", problems: ["EGM review is not enabled. Set egmReview.enabled=true in config/manager.json after installing the EGM plugin in a dedicated CODEX_HOME."] };
  const backend = section.backend === "glm-goldfish" ? "glm-goldfish" : "codex";
  const codexHome = String(section.codexHome || "").trim();
  const model = String(section.model || "").trim();
  const versionSha = String(section.versionSha || "").trim();
  const problems = [];
  if (!versionSha) problems.push("egmReview.versionSha is required (the pinned EGM source SHA the review results are tied to).");
  if (backend === "codex") {
    if (!codexHome) problems.push("egmReview.codexHome is required (a CODEX_HOME with the egm plugin installed).");
    if (codexHome && !fs.existsSync(path.join(codexHome, "config.toml"))) problems.push(`egmReview.codexHome does not contain config.toml: ${codexHome}`);
    if (codexHome && !fs.existsSync(path.join(codexHome, "auth.json"))) problems.push(`egmReview.codexHome has no auth.json — run codex login against that home before enabling EGM review.`);
    if (codexHome) {
      const pluginRoot = path.join(codexHome, "plugins", "cache", "egm");
      let installed = false;
      try { installed = fs.readdirSync(pluginRoot, { withFileTypes: true }).some((entry) => entry.isDirectory()); } catch { /* not installed */ }
      if (!installed) problems.push(`the egm plugin is not installed under ${pluginRoot}`);
    }
    if (!model) problems.push("egmReview.model is required (the exact ChatGPT model id EGM should run on).");
  }
  return { enabled: problems.length === 0, backend, codexHome, model, versionSha, maxMinutes: Number(section.maxMinutes) || 20, maxMinutesPerCall: Number(section.maxMinutesPerCall) || 10, maxReviewsPerDay: Number(section.maxReviewsPerDay) || 3, problems };
}

export function buildEgmReviewInput(draft) {
  const artifact = draft.artifact || {};
  const lines = [
    "# Plan Studio review target",
    "",
    `Draft: ${draft.id}`,
    `Title: ${artifact.title || "untitled plan"}`,
    `Plan contract version: ${artifact.plan_contract_version || "n/a"}`,
    "",
    "## Objective",
    "",
    String(artifact.objective || draft.intent || "").trim(),
    "",
    "## Requirements",
    "",
    ...(artifact.requirements || []).map((item) => `- [${item.id}] ${item.text}${item.source ? ` (source: ${item.source})` : ""}`),
    "",
    "## Task proposals",
    "",
    ...(artifact.task_proposals || []).map((item) => `- [${item.id}] ${item.title}\n  - instructions: ${String(item.instructions || item.objective || "").slice(0, 600)}\n  - files: ${(item.files || []).join(", ") || "n/a"}\n  - verify: ${item.verify || "n/a"}\n  - skills: ${(item.selected_skills || []).join(", ") || "n/a"}\n  - depends on: ${(item.depends_on || []).join(", ") || "none"}`),
    "",
    "## Acceptance examples",
    "",
    ...(artifact.acceptance_examples || []).map((item) => `- Given ${item.given}; when ${item.when}; then ${item.then}`),
    "",
    "## Verifier commands",
    "",
    ...(artifact.verifier_commands || []).map((item) => `- ${item}`),
    "",
    "## Open questions",
    "",
    ...((artifact.open_questions || []).length ? artifact.open_questions.map((item) => `- ${item.resolved ? "[resolved]" : "[open]"} ${item.question || item}`) : ["- none recorded"]),
    "",
    "## Constraints and assumptions",
    "",
    ...(artifact.constraints || []).map((item) => `- constraint: ${item}`),
    ...(artifact.assumptions || []).map((item) => `- assumption: ${typeof item === "string" ? item : JSON.stringify(item)}`),
  ];
  return lines.join("\n") + "\n";
}

function egmPrompt(targetFile) {
  return `Use the egm:egm-review skill to review ${targetFile}. Pass TargetFile=${targetFile} and Step=uninterrupted. Follow the skill's uninterrupted native-review workflow exactly: launch each reviewer persona as a fresh subagent, write every stage report file the skill requires into the working directory, and do not edit the target file. Do not ask the user any questions: if the workflow offers a choice about additional context files, proceed with none; if any other checkpoint appears, choose the option that continues the review without pausing. The target file is the only review input; do not read unrelated host files.`;
}

export async function runEgmReview(root, { cfg, draft, spawnImpl = spawn, now = () => new Date() } = {}) {
  const config = readEgmReviewConfig(cfg);
  if (!config.enabled) { const error = new Error(config.problems.join(" ")); error.statusCode = 409; throw error; }
  const workdir = path.join(draft.dir, "egm", now().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(workdir, { recursive: true });
  const targetFile = EGM_INPUT_FILE;
  fs.writeFileSync(path.join(workdir, targetFile), buildEgmReviewInput(draft));
  const lastMessage = path.join(workdir, "last-message.txt");
  const args = ["exec", "--sandbox", "workspace-write", ...(config.model ? ["--model", config.model] : []), "--skip-git-repo-check", "--json", "-o", lastMessage, egmPrompt(targetFile)];
  // The npm "codex" shim is a PowerShell/cmd script that Node cannot spawn
  // directly; invoke its JS entry with this runtime instead. A custom entry
  // (egmReview.codexEntry) wins for nonstandard installs.
  const codexEntry = String(cfg.egmReview?.codexEntry || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "@openai", "codex", "bin", "codex.js"));
  const launcher = fs.existsSync(codexEntry) ? [process.execPath, codexEntry] : ["codex"];
  const started = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawnImpl(launcher[0], [...launcher.slice(1), ...args], { cwd: workdir, env: { ...process.env, CODEX_HOME: config.codexHome }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)]); } catch { /* already gone */ }
      resolve({ code: "timeout", stdout, stderr: stderr + `\negm review exceeded ${config.maxMinutes} minutes and was terminated` });
    }, config.maxMinutes * 60 * 1000);
    timer.unref?.();
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code: "spawn-error", stdout, stderr: stderr + "\n" + error.message }); } });
    child.on("close", (code) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code, stdout, stderr }); } });
  });
  fs.writeFileSync(path.join(workdir, "codex-exec.log"), result.stdout + result.stderr);
  return {
    workdir,
    exitCode: result.code,
    durationMs: Date.now() - started,
    command: `codex ${args.slice(0, 8).join(" ")} …(prompt omitted)`,
    lastMessage: fs.existsSync(lastMessage) ? fs.readFileSync(lastMessage, "utf8") : null,
    timedOut: result.code === "timeout",
  };
}

const SEVERITY_SECTIONS = [
  { match: /blocker/i, severity: "blocker" },
  { match: /major/i, severity: "major" },
  { match: /\bnit|minor/i, severity: "minor" },
];

// Converts the consolidated EGM report into ATL review findings. EGM's
// report format has drifted between runs (numbered bold items vs `#### A1`
// headings), so both shapes are parsed; anything unrecognized still yields a
// verdict from the Verdict section, and missing reports fail explicitly.
export function parseEgmReports(workdir) {
  const missing = EGM_REQUIRED_REPORTS.filter((name) => !fs.existsSync(path.join(workdir, name)));
  const consolidatedPath = path.join(workdir, "consolidated_review_report.md");
  const findings = [];
  let verdictHint = null;
  let severitySectionsSeen = false;
  if (!missing.length) {
    const report = fs.readFileSync(consolidatedPath, "utf8");
    const verdict = /##\s*Verdict\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i.exec(report);
    if (verdict) verdictHint = /not ready|not implementation-ready/i.test(verdict[1]) ? "blocked" : /ready for implementation/i.test(verdict[1]) ? "passed" : null;
    let severity = null;
    let current = null;
    const push = () => { if (current) findings.push(current); current = null; };
    for (const rawLine of report.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (/^###\s/.test(line)) {
        push();
        const heading = line.replace(/^#+\s*/, "");
        const matched = SEVERITY_SECTIONS.find((entry) => entry.match.test(heading) && !/^[A-Za-z]\d+\s*[—-]/.test(heading));
        if (matched) { severity = matched.severity; severitySectionsSeen = true; }
        continue;
      }
      if (/^####\s/.test(line)) {
        push();
        current = severity ? { severity, message: `EGM finding: ${line.replace(/^#+\s*/, "")}`, location: "consolidated_review_report.md", correction: "" } : null;
        continue;
      }
      const numbered = /^\d+\.\s+\*\*(.+?)\*\*\s*(.*)$/.exec(line);
      if (numbered && severity) {
        push();
        current = { severity, message: `EGM finding: ${numbered[1]}`, location: "consolidated_review_report.md", correction: numbered[2] };
        continue;
      }
      if (!current || !line) continue;
      if (/^##\s|^#\s/.test(line)) continue;
      current.correction = `${current.correction ? current.correction + " " : ""}${line}`.slice(0, 1200);
    }
    push();
  }
  return { findings, verdictHint, severitySectionsSeen, missingReports: missing, consolidatedPath };
}

// ---- glm-goldfish backend -------------------------------------------------
//
// The EGM protocol natively, without Codex: every reviewer is ONE fresh
// single-shot call through ATL's planning seam (any configured provider,
// e.g. GLM). Fresh context is structural — no call sees another call's
// conversation, only explicitly passed stage reports. The synthesizer is
// instructed to emit the exact consolidated shape the parser expects.

export const GLM_GOLDFISH_STAGES = [
  { id: "zoom_out_report.md", persona: "Zoom Out Reviewer", needs: [], instructions: "Evaluate whether the proposal establishes a simple, coherent model for its stated purpose. Flag unnecessary machinery, unresolved core contracts (identity, retries, states), and complexity that does not serve the objective." },
  { id: "comprehension_report.md", persona: "Comprehension Reviewer", needs: [], instructions: "Read the document as a naive new team member. Report what is proposed, what the existing system is (or that it is unstated), what cannot be understood from the document alone, and what a reader must already know." },
  { id: "critic_report.md", persona: "Design Critic", needs: ["zoom_out_report.md", "comprehension_report.md"], instructions: "Stress-test the proposal: missing alternatives analysis, unjustified assumptions, unmitigated risks, security and failure modes, scaling bottlenecks. Attribute each finding to the earlier stage reports it builds on." },
  { id: "intermediate_zoom_out_report.md", persona: "Intermediate Zoom Out Reviewer", needs: ["zoom_out_report.md", "critic_report.md"], instructions: "Re-evaluate simplicity after the earlier findings: state which earlier findings remain unmitigated by the document as written, and narrow any recommendation that over-specifies the solution." },
  { id: "implementation_readiness_report.md", persona: "Implementation Readiness Reviewer", needs: [], instructions: "Apply the zero-decision rule: could an implementer execute this without inventing contracts, schemas, file paths, state machines, or error behavior? Every decision left to the implementer is a finding." },
];

const GLM_STAGE_RULE = "Return markdown only. Under '## Findings', each finding is a '#### <short-id> — <Title>' heading whose body starts with 'Severity: Blocker|Major|Nit' on its own line, then 'Affected scope: …', then the technical rationale and concrete recommendation. Do not edit files. Do not claim any check passed.";

const PROGRESS_FILE = "progress.json";
function writeProgress(workdir, entry) {
  const file = path.join(workdir, PROGRESS_FILE);
  let log = [];
  try { log = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first stage */ }
  log.push(entry);
  fs.writeFileSync(file, JSON.stringify(log, null, 2) + "\n");
}
function cancelRequested(workdir) { return fs.existsSync(path.join(workdir, "cancel.flag")); }
function cancelledError(workdir) {
  const failure = new Error("EGM deep review cancelled by the owner between stages. The raw run is preserved at " + workdir + "; no review was recorded.");
  failure.statusCode = 502;
  failure.workdir = workdir;
  return failure;
}

export async function runGlmGoldfishReview(root, { draft, config, call } = {}) {
  if (typeof call !== "function") throw new Error("glm-goldfish backend needs a provider call function");
  const workdir = path.join(draft.dir, "egm", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(workdir, { recursive: true });
  const inputPath = path.join(workdir, EGM_INPUT_FILE);
  const target = buildEgmReviewInput(draft);
  fs.writeFileSync(inputPath, target);
  const reports = {};
  const started = Date.now();
  const stageRuns = [];
  const runStage = async (stage) => {
    const prior = {};
    for (const need of stage.needs) prior[need] = reports[need] ?? "(unavailable)";
    const request = {
      review: true,
      task: `EGM goldfish stage — ${stage.persona}. You have no prior context; evaluate only what is provided in this request.`,
      persona: stage.instructions,
      target_document: target,
      prior_stage_reports: prior,
      required: ["markdown findings"],
      rule: GLM_STAGE_RULE,
    };
    const response = await call({ stage: stage.id, request, logPath: path.join(workdir, `${stage.id}.call.log`) });
    if (!response || response.code !== 0) {
      const failure = new Error(`GLM goldfish stage ${stage.id} failed (code ${response?.code ?? "unknown"}). No review was recorded.`);
      failure.statusCode = 502;
      failure.workdir = workdir;
      throw failure;
    }
    const text = String(response.text || response.output || "").trim();
    if (!text) {
      const failure = new Error(`GLM goldfish stage ${stage.id} returned no content. No review was recorded.`);
      failure.statusCode = 502;
      failure.workdir = workdir;
      throw failure;
    }
    reports[stage.id] = text;
    fs.writeFileSync(path.join(workdir, stage.id), text + "\n");
    writeProgress(workdir, { stage: stage.id, index: stageRuns.length + 1, total: GLM_GOLDFISH_STAGES.length + 1, provider: response.provider || null, model: response.model || null, at: new Date().toISOString() });
    if (cancelRequested(workdir)) throw cancelledError(workdir);
    stageRuns.push({ stage: stage.id, provider: response.provider || null, model: response.model || null });
    return response;
  };
  for (const stage of GLM_GOLDFISH_STAGES) {
    if (cancelRequested(workdir)) throw cancelledError(workdir);
    await runStage(stage);
  }
  const synthesizer = GLM_GOLDFISH_SYNTHESIZER({ ...reports });
  const response = await call({ stage: "consolidated_review_report.md", request: synthesizer, logPath: path.join(workdir, "consolidated_review_report.md.call.log") });
  if (!response || response.code !== 0 || !String(response.text || "").trim()) {
    const failure = new Error(`GLM goldfish synthesizer failed (code ${response?.code ?? "unknown"}). No review was recorded.`);
    failure.statusCode = 502;
    failure.workdir = workdir;
    throw failure;
  }
  const consolidated = String(response.text).trim().replace(/^\`\`\`(?:markdown)?\s*/i, "").replace(/\`\`\`\s*$/i, "");
  // Providers sometimes answer "return markdown only" with a JSON wrapper;
  // unwrap it instead of parsing JSON as a report.
  if (consolidated.startsWith("{")) {
    try {
      const wrapper = JSON.parse(consolidated);
      const inner = wrapper["consolidated markdown"] || wrapper.markdown || wrapper.report || wrapper.content || null;
      if (typeof inner === "string" && inner.includes("# ")) consolidated = inner.trim();
    } catch { /* not JSON after all — parse it as-is */ }
  }
  reports["consolidated_review_report.md"] = consolidated;
  fs.writeFileSync(path.join(workdir, "consolidated_review_report.md"), consolidated + "\n");
  writeProgress(workdir, { stage: "consolidated_review_report.md", index: GLM_GOLDFISH_STAGES.length + 1, total: GLM_GOLDFISH_STAGES.length + 1, provider: response.provider || null, model: response.model || null, at: new Date().toISOString() });
  stageRuns.push({ stage: "consolidated_review_report.md", provider: response.provider || null, model: response.model || null });
  return {
    workdir,
    exitCode: 0,
    durationMs: Date.now() - started,
    command: "glm-goldfish: 6 single-shot provider calls via the planning seam",
    backend: "glm-goldfish",
    stageRuns,
    lastMessage: null,
  };
}

function GLM_GOLDFISH_SYNTHESIZER(reports) {
  return {
    review: true,
    task: "EGM goldfish synthesizer. You have no prior context. Deduplicate the five stage reports into one consolidated report.",
    stage_reports: reports,
    required: ["consolidated markdown"],
    rule: [
      "Return markdown only, exactly this shape:",
      "# Consolidated EGM Review Report",
      "## Verdict",
      "One paragraph that starts with either 'ready for implementation' or 'not ready for implementation' and names the highest-risk omissions.",
      "## Action items by priority",
      "### 🔴 Blockers",
      "#### A1 — <Title>",
      "<body: what to resolve and how>",
      "### 🟡 Major",
      "#### A5 — <Title>",
      "### 🟢 Nits",
      "#### A9 — <Title>",
      "## Traceability matrix",
      "| Action | Raw findings |",
      "Continue A-numbers across sections. Preserve evidence; do not drop findings by merging them away.",
      "The response must be raw markdown text — never a JSON object, never fenced code.",
    ].join("\n"),
  };
}
