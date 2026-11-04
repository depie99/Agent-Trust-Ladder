import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, inventory, sha256 } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const [baselineFile, atlFile, output] = process.argv.slice(2);
if (!baselineFile || !atlFile || !output) {
  console.error('Usage: node evaluations/atl/run.mjs <baseline.json> <atl.json> <report.json>');
  process.exitCode = 2;
} else {
  const datasetBytes = fs.readFileSync(path.join(here, 'cases.json'));
  const dataset = JSON.parse(datasetBytes);
  const baseline = fs.readFileSync(baselineFile), atl = fs.readFileSync(atlFile);
  const report = {
    version: 1, created_at: new Date().toISOString(), environment: { node: process.version, platform: process.platform },
    kind: 'decision-only-pilot',
    provenance: { dataset_sha256: sha256(datasetBytes), baseline_sha256: sha256(baseline), atl_sha256: sha256(atl) },
    ...compare(dataset.cases, JSON.parse(baseline), JSON.parse(atl)),
    telemetry: { model: null, input_tokens: null, output_tokens: null, cost: null, latency_ms: null,
      note: 'Not instrumented. Byte inventory is not token usage or latency.' },
    skills: inventory(root),
    limitations: ['No code execution by participants.', 'No held-out tasks or repeated trials.',
      'Shared platform instructions and model family can confound comparison.',
      'Structured proxies do not verify rationale, authority compliance, or task completion.',
      'Instruction bytes describe this checkout; pilot reads were not hash-pinned at launch.'],
  };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ n: report.sample_size, baseline: report.baseline_pass_rate,
    atl: report.atl_pass_rate, delta_pp: report.delta_percentage_points,
    wins: report.wins, losses: report.losses, ties: report.ties, output }, null, 2));
}
