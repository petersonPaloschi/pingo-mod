// Runs every situation through sift exactly as Claude would (human-readable output), scores it
// against ground truth, and records Jev's tokens plus the tokens Claude would read back.
// Adapted from Quicksilver's bench/run-qs.mjs. Usage: node run-sift.mjs [s01 s02 ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SIFT = path.join(ROOT, '..', 'scripts', 'sift.ts');
const SKILL_TOKENS = Math.ceil(fs.readFileSync(path.join(ROOT, '..', 'skills', 'sift', 'SKILL.md'), 'utf8').length / 4);
const TOOL_CALL_OVERHEAD = 40; // tokens for the tool-call wrapper around each command
const TYPE_SAFE_INPUT_LIST_RATE = 0.042 / 1e6; // configured list-rate assumption, not an invoice
const TYPE_SAFE_RATE_NOTE = 'US$0.042 per million reported input tokens; inherited estimate, not an invoice';
const MAX_TOTAL_TYPESAFE_TOKENS = 90_000_000; // US$3.78; leave room under the shared US$5 trial cap
const MAX_INVOCATION_TYPESAFE_TOKENS = Math.floor(1 / PRICE_PER_TOKEN); // US$1 per CLI invocation
const CONCURRENCY = 4;
const MAX_WALL_MS = 30 * 60 * 1000;
const tok = (s) => Math.ceil(s.length / 4);
const only = process.argv.slice(2);
const startedAt = Date.now();

// sift's lifetime tally, moved to a scratch file so the bench measures its own runs only.
const STATS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sift-bench-')), 'stats.json');
const tally = () => { try { return JSON.parse(fs.readFileSync(STATS, 'utf8')); } catch { return { jevTokens: 0, jevUsageReportedCalls: 0, jevUsageMissingCalls: 0, typesafeTokens: 0, typesafeUsageReportedRuns: 0, typesafeUsageMissingCalls: 0 }; } };

// The generated datasets are ignored by the outer repo. Pass directory members explicitly so
// Sift's normal .gitignore-respecting directory expansion does not discard these benchmark inputs.
function filesUnder(base, spec) {
  const target = path.join(base, spec);
  if (!fs.statSync(target).isDirectory()) return [spec];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(path.relative(base, file));
    }
  };
  walk(target);
  return files.toSorted();
}

// withSave: also write full per-item results via --save so scoring doesn't depend on the display format.
// Claude is charged only for the display output it would actually read.
const SAVE = path.join(ROOT, 'results', '.last-save.json');
function sift(dir, args, withSave = false) {
  if (Date.now() - startedAt > MAX_WALL_MS) throw new Error('30-minute benchmark wall-time cap reached');
  const t0 = Date.now(), before = tally();
  if (withSave) fs.rmSync(SAVE, { force: true });
  let r;
  for (let attempt = 1; attempt <= 3; attempt++) {
    r = spawnSync(process.execPath, [SIFT, ...args, '--concurrency', String(CONCURRENCY), ...(withSave ? ['--save', SAVE] : [])], {
      cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SIFT_STATS: STATS },
    });
    if (r.status === 0) break;
    console.error(`attempt ${attempt} failed (status ${r.status}, signal ${r.signal}): ${r.stderr || r.error}`);
  }
  if (r.status !== 0) throw new Error(`sift ${args.join(' ')} failed: ${r.stderr}`);
  const out = r.stdout.replace(/\n— full results saved to .*/, '');
  const cmd = `node sift.ts ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
  const saved = withSave ? JSON.parse(fs.readFileSync(SAVE, 'utf8')) : null;
  const after = tally();
  const jevUsageReportedCalls = Math.max(0, after.jevUsageReportedCalls - before.jevUsageReportedCalls);
  const jevUsageMissingCalls = Math.max(0, after.jevUsageMissingCalls - before.jevUsageMissingCalls);
  const typesafeUsageReportedRuns = Math.max(0, after.typesafeUsageReportedRuns - before.typesafeUsageReportedRuns);
  const typesafeUsageMissingCalls = Math.max(0, after.typesafeUsageMissingCalls - before.typesafeUsageMissingCalls);
  const jevTokens = jevUsageReportedCalls ? Math.max(0, after.jevTokens - before.jevTokens) : null;
  const typesafeTokens = (typesafeUsageReportedRuns > 0) ? Math.max(0, after.typesafeTokens - before.typesafeTokens) : null;
  if (typesafeUsageMissingCalls) throw new Error('TypeSafe usage counters are missing; stop because invocation cost is unknown');
  if (typesafeTokens !== null && typesafeTokens > MAX_INVOCATION_TYPESAFE_TOKENS) throw new Error('US$1 per-invocation cap reached');
  if (after.typesafeTokens > MAX_TOTAL_TYPESAFE_TOKENS) throw new Error('US$3.78 total TypeSafe cap reached');
  return {
    out, saved, ms: Date.now() - t0,
    jevTokens, jevUsageReportedCalls, jevUsageMissingCalls,
    typesafeTokens, typesafeUsageReportedRuns, typesafeUsageMissingCalls,
    jevUsdEstimate: jevUsageMissingCalls || typesafeUsageMissingCalls || !typesafeUsageReportedRuns || typesafeTokens === null
      ? null
      : typesafeTokens * TYPE_SAFE_INPUT_LIST_RATE,
    jevUsdEstimateBasis: TYPE_SAFE_RATE_NOTE,
    siftContextTokensEstimate: tok(cmd) + tok(out) + TOOL_CALL_OVERHEAD,
  };
}

const rows = (out) => out.split('\n').filter((l) => /^[ ?]?\d\.\d\d  /.test(l));
const idOf = (line) => line.replace(/^[ ?]?\d\.\d\d  /, '').split('  ')[0].replace(/~$/, '');
const lineNo = (id) => Number(id.split(':').pop());

function prf(pred, truth, neutral = []) {
  const T = new Set(truth.map(String)), N = new Set(neutral.map(String));
  const P = pred.map(String).filter((p) => !N.has(p));
  const tp = P.filter((p) => T.has(p)).length;
  const precision = P.length ? tp / P.length : 1, recall = T.size ? tp / T.size : 1;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, predicted: P.length, tp };
}

if (!fs.existsSync(path.join(ROOT, 'data'))) {
  console.error('no bench/data: fetch the raw inputs and run node build.mjs first (see README.md)');
  process.exit(1);
}
fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
const file = path.join(ROOT, 'results', 'sift.json');
const results = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const status = spawnSync(process.execPath, [SIFT, 'status'], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
const statusText = `${status.stdout ?? ''}${status.stderr ?? ''}`;
if (status.status !== 0 || !statusText.includes('ready') || !/TypeSafe/i.test(statusText)) {
  throw new Error('benchmark requires a ready TypeSafe provider so its spend cap is known');
}
console.log(`provider ready · TypeSafe · concurrency ${CONCURRENCY} · cap US$3.78 total / US$1 per CLI invocation`);
for (const id of fs.readdirSync(path.join(ROOT, 'data')).filter((d) => /^s\d+$/.test(d)).sort()) {
  if (only.length && !only.includes(id)) continue;
  const dir = path.join(ROOT, 'data', id);
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'truth', id + '.json'), 'utf8'));
  const runs = [];
  let score;
  if (m.kind === 'filter-lines' || m.kind === 'filter-items' || m.kind === 'filter-files') {
    const inputs = m.kind === 'filter-items' ? ['--items', m.input] : m.kind === 'filter-files' ? filesUnder(dir, m.input) : [m.input];
    const args = ['filter', m.question, ...inputs, ...(m.kind === 'filter-lines' ? ['--lines'] : [])];
    const r = sift(dir, args, true); runs.push(r);
    const matched = r.saved.filter((x) => x.p >= 0.5).map((x) => x.id);
    const pred = m.kind === 'filter-lines' ? matched.map(lineNo) : matched;
    score = prf(pred, m.truth, m.neutral);
    score.metric = 'F1';
    score.value = score.f1;
  } else if (m.kind === 'classify') {
    const labels = m.labelDescriptions
      ? Object.entries(m.labelDescriptions).map(([k, v]) => `${k}:${v.replace(/,/g, ';')}`).join(',')
      : m.labels.join(',');
    const r = sift(dir, ['classify', '--labels', labels, '--question', m.question, '--items', m.input], true); runs.push(r);
    const pred = Object.fromEntries(r.saved.map((x) => [x.id, x.label]));
    const ids = Object.keys(m.truth);
    const correct = ids.filter((k) => pred[k] === m.truth[k]).length;
    score = { metric: 'accuracy', value: correct / ids.length, correct, total: ids.length };
  } else if (m.kind === 'find') {
    let hits1 = 0, hits5 = 0;
    for (const [name, q] of Object.entries(m.queries)) {
      const r = sift(dir, ['find', q, m.input, '--top', '5']); runs.push(r);
      const [lo, hi] = m.truth[name];
      const got = rows(r.out).map((l) => lineNo(idOf(l)));
      const inRange = got.map((n) => n >= lo && n <= hi);
      if (inRange[0]) hits1++;
      if (inRange.some(Boolean)) hits5++;
    }
    const n = Object.keys(m.queries).length;
    score = { metric: 'hit@5', value: hits5 / n, hit1: hits1 / n, hit5: hits5 / n };
  } else if (m.kind === 'rank') {
    let hits1 = 0, hits3 = 0;
    for (const [qid, q] of Object.entries(m.queries)) {
      const r = sift(dir, ['rank', q, ...filesUnder(dir, m.input), '--top', '3']); runs.push(r);
      const got = rows(r.out).map(idOf);
      if (m.truth[qid].includes(got[0])) hits1++;
      if (got.some((g) => m.truth[qid].includes(g))) hits3++;
    }
    const n = Object.keys(m.queries).length;
    score = { metric: 'hit@3', value: hits3 / n, hit1: hits1 / n, hit3: hits3 / n };
  }
  const contentTokensEstimate = fs.readdirSync(dir, { recursive: true })
    .map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).isFile())
    .reduce((a, f) => a + tok(fs.readFileSync(f, 'utf8')), 0);
  const jevUsageReportedCalls = runs.reduce((a, r) => a + r.jevUsageReportedCalls, 0);
  const jevUsageMissingCalls = runs.reduce((a, r) => a + r.jevUsageMissingCalls, 0);
  const typesafeUsageReportedRuns = runs.reduce((a, r) => a + r.typesafeUsageReportedRuns, 0);
  const typesafeUsageMissingCalls = runs.reduce((a, r) => a + r.typesafeUsageMissingCalls, 0);
  const jevTokens = jevUsageReportedCalls ? runs.reduce((a, r) => a + (r.jevTokens ?? 0), 0) : null;
  const typesafeTokens = (typesafeUsageReportedRuns > 0) ? runs.reduce((a, r) => a + (r.typesafeTokens ?? 0), 0) : null;
  results[id] = {
    title: m.title, kind: m.kind, score,
    contentTokensEstimate,
    siftContextTokensEstimate: SKILL_TOKENS + runs.reduce((a, r) => a + r.siftContextTokensEstimate, 0),
    seconds: runs.reduce((a, r) => a + r.ms, 0) / 1000,
    concurrency: CONCURRENCY,
    jevTokens,
    jevUsageReportedCalls,
    jevUsageMissingCalls,
    typesafeTokens,
    typesafeUsageReportedRuns,
    typesafeUsageMissingCalls,
    jevUsdEstimate: jevUsageMissingCalls || typesafeUsageMissingCalls || !typesafeUsageReportedRuns || typesafeTokens === null
      ? null
      : typesafeTokens * TYPE_SAFE_INPUT_LIST_RATE,
    jevUsdEstimateBasis: TYPE_SAFE_RATE_NOTE,
    calls: runs.length,
    sampleOutput: runs[0].out.split('\n').slice(0, 12).join('\n'),
  };
  const r = results[id];
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  const usage = r.jevUsageMissingCalls
    ? r.jevTokens === null ? `Jev usage unavailable (${r.jevUsageMissingCalls} calls)` : `Jev ≥${r.jevTokens} tok reported (${r.jevUsageMissingCalls} calls unreported)`
    : r.jevTokens === null ? 'Jev usage unavailable' : `Jev ${r.jevTokens} tok`;
  const cost = r.jevUsdEstimate === null ? 'provider cost unknown' : `TypeSafe input list-rate estimate ~$${r.jevUsdEstimate.toFixed(4)}`;
  console.log(`${id}  ${score.metric} ${(score.value * 100).toFixed(1)}%  context estimate ${r.siftContextTokensEstimate} tok  ${r.seconds.toFixed(1)}s  ${usage} · ${cost}`);
}
fs.rmSync(path.dirname(STATS), { recursive: true, force: true });
