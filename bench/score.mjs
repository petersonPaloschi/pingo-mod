// Scores both answer sets against the same truth. The stored Claude baseline is imported,
// not a live paired run, so this reports quality references and Sift-side measurements only.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(ROOT, 'results');
const sift = JSON.parse(fs.readFileSync(path.join(RESULTS, 'sift.json'), 'utf8'));
const usage = JSON.parse(fs.readFileSync(path.join(RESULTS, 'baseline', 'usage.json'), 'utf8'));
const FLOOR = usage.control;

function hashFiles(target) {
  const root = fs.statSync(target).isDirectory() ? target : path.dirname(target);
  const files = fs.statSync(target).isDirectory()
    ? fs.readdirSync(target, { recursive: true }).map((name) => path.join(target, name)).filter((name) => fs.statSync(name).isFile())
    : [target];
  const hash = createHash('sha256');
  for (const file of files.toSorted()) {
    hash.update(path.relative(root, file).replaceAll(path.sep, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

function prf(pred, truth, neutral = []) {
  const T = new Set(truth.map(String)), N = new Set(neutral.map(String));
  const P = [...new Set(pred.map(String))].filter((p) => !N.has(p));
  const tp = P.filter((p) => T.has(p)).length;
  const precision = P.length ? tp / P.length : 1, recall = T.size ? tp / T.size : 1;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}

function scoreBaseline(id, meta) {
  const file = path.join(RESULTS, 'baseline', `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const answer = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (meta.kind.startsWith('filter')) {
    const score = prf(meta.kind === 'filter-lines' ? answer.lines : answer.ids, meta.truth, meta.neutral);
    return { metric: 'F1', value: score.f1, ...score };
  }
  if (meta.kind === 'classify') {
    const ids = Object.keys(meta.truth);
    const correct = ids.filter((id) => answer.labels?.[id] === meta.truth[id]).length;
    return { metric: 'accuracy', value: correct / ids.length };
  }
  if (meta.kind === 'find') {
    let hit1 = 0, hit5 = 0;
    for (const [name, [lo, hi]] of Object.entries(meta.truth)) {
      const got = (answer.hits?.[name] || []).slice(0, 5).map(Number).map((n) => n >= lo && n <= hi);
      if (got[0]) hit1++;
      if (got.some(Boolean)) hit5++;
    }
    const n = Object.keys(meta.truth).length;
    return { metric: 'hit@5', value: hit5 / n, hit1: hit1 / n };
  }
  if (meta.kind === 'rank') {
    let hit1 = 0, hit3 = 0;
    for (const [query, truth] of Object.entries(meta.truth)) {
      const got = (answer.top3?.[query] || []).slice(0, 3);
      if (truth.includes(got[0])) hit1++;
      if (got.some((item) => truth.includes(item))) hit3++;
    }
    const n = Object.keys(meta.truth).length;
    return { metric: 'hit@3', value: hit3 / n, hit1: hit1 / n };
  }
  return null;
}

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const usdEstimate = (x) => (x === null ? 'unknown' : `~$${x.toFixed(4)}`);
const rows = [];

for (const id of Object.keys(sift).sort()) {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'truth', `${id}.json`), 'utf8'));
  const result = sift[id], baseline = scoreBaseline(id, meta), baseUsage = usage[id];
  if (!baseline || !baseUsage) { console.warn(`missing stored baseline for ${id}`); continue; }
  const inputPath = path.join(ROOT, 'data', id, meta.input);
  const truthPath = path.join(ROOT, 'truth', `${id}.json`);
  rows.push({
    id,
    title: meta.title,
    metric: result.score.metric,
    siftScore: result.score.value,
    baselineScore: baseline.value,
    input: meta.input,
    question: meta.kind === 'rank' ? meta.queries : meta.question,
    inputSha256: hashFiles(inputPath),
    truthSha256: hashFiles(truthPath),
    baselineProvenance: 'stored Quicksilver answer and usage; not live paired',
    baselineTaskTokens: baseUsage.tokens - FLOOR.tokens,
    baselineSeconds: baseUsage.seconds - FLOOR.seconds,
    baselineToolCalls: baseUsage.toolUses,
    siftContextTokensEstimate: result.siftContextTokensEstimate,
    siftSeconds: result.seconds,
    jevTokensReported: result.jevTokens,
    jevUsageReportedCalls: result.jevUsageReportedCalls,
    jevUsageMissingCalls: result.jevUsageMissingCalls,
    typesafeTokensReported: result.typesafeTokens,
    typesafeUsageReportedRuns: result.typesafeUsageReportedRuns,
    typesafeUsageMissingCalls: result.typesafeUsageMissingCalls,
    jevUsdEstimate: result.jevUsdEstimate ?? result.jevUsd ?? null,
    jevUsdEstimateBasis: result.jevUsdEstimateBasis ?? 'US$0.042 per million reported input tokens; inherited estimate, not an invoice',
  });
}

if (!rows.length) { console.error('nothing to score: run node run-sift.mjs first'); process.exit(1); }
const knownJevTokens = rows.reduce((sum, row) => sum + (row.jevTokensReported ?? 0), 0);
const usageMissingCalls = rows.reduce((sum, row) => sum + row.jevUsageMissingCalls, 0);
const jevUsageLabel = usageMissingCalls
  ? knownJevTokens ? `≥${k(knownJevTokens)} reported; ${usageMissingCalls} calls without counters` : `unknown; ${usageMissingCalls} calls without counters`
  : rows.every((row) => row.jevTokensReported !== null) ? `${k(knownJevTokens)} reported` : 'unknown';
const allCostsKnown = rows.every((row) => row.jevUsdEstimate !== null);
const totalCostEstimate = allCostsKnown ? rows.reduce((sum, row) => sum + row.jevUsdEstimate, 0) : null;

let md = `# Sift benchmark result\n\n`;
md += `The Claude-alone values below are stored Quicksilver references. They were not rerun as paired sessions with Sift, so this table does not claim total task savings or a causal speed-up. Sift context counts are character-based estimates; Jev usage and the configured TypeSafe input list-rate estimate are reported separately. The rate estimate is not an invoice.\n\n`;
md += `| # | Situation | Metric | Stored baseline quality | Sift quality | Sift CLI wall | Jev input usage | TypeSafe input list-rate estimate | Sift context estimate |\n|---|---|---|---:|---:|---:|---:|---:|---:|\n`;
for (const row of rows) {
  const usageLabel = row.jevUsageMissingCalls
    ? row.jevTokensReported === null ? `unknown (${row.jevUsageMissingCalls} missing)` : `≥${k(row.jevTokensReported)} (${row.jevUsageMissingCalls} missing)`
    : row.jevTokensReported === null ? 'unknown' : k(row.jevTokensReported);
  md += `| ${row.id.slice(1)} | ${row.title.split(' — ')[0]} | ${row.metric} | ${pct(row.baselineScore)} | ${pct(row.siftScore)} | ${row.siftSeconds.toFixed(1)}s | ${usageLabel} | ${usdEstimate(row.jevUsdEstimate)} | ~${k(row.siftContextTokensEstimate)} tok (estimate) |\n`;
}
md += `\n**${rows.length} situations:** Sift CLI wall ${rows.reduce((sum, row) => sum + row.siftSeconds, 0).toFixed(1)}s; Jev usage ${jevUsageLabel}; TypeSafe input list-rate estimate ${usdEstimate(totalCostEstimate)}. This estimate is not a provider invoice or whole-task cost. Quality is reported per task because these metrics have different definitions and sample sizes.\n`;

const summary = {
  n: rows.length,
  protocol: 'bench/protocol.md',
  scoredAt: new Date().toISOString(),
  repositoryRevision: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() || null,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  provider: 'TypeSafe',
  model: 'jev-latest',
  concurrency: 4,
  siftRunMode: 'normal; one item per request',
  repetitionsPerCase: 1,
  siftContextEstimateBasis: 'Character counts divided by four for skill, commands, output, and wrappers; skill length was captured at normal-run time, before later evidence notes were added.',
  baselineProvenance: 'Quicksilver stored answer and usage; not live paired',
  baselineResponsesRerun: false,
  rawProviderResponsesRetained: false,
  siftCliWallSeconds: rows.reduce((sum, row) => sum + row.siftSeconds, 0),
  jevTokensReported: usageMissingCalls ? (knownJevTokens || null) : knownJevTokens,
  jevUsageMissingCalls: usageMissingCalls,
  jevUsdEstimate: totalCostEstimate,
  jevUsdEstimateBasis: 'US$0.042 per million reported input tokens; inherited estimate, not an invoice',
  providerInvoiceObserved: false,
};
fs.writeFileSync(path.join(RESULTS, 'results.md'), md);
fs.writeFileSync(path.join(RESULTS, 'results.json'), `${JSON.stringify({ rows, summary }, null, 2)}\n`);
console.log(md);
