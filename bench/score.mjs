// Scores the Claude-native baseline, merges it with the sift run, and writes results.md + results.json.
// Adapted from Quicksilver's bench/score.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(ROOT, 'results');
const sift = JSON.parse(fs.readFileSync(path.join(R, 'sift.json'), 'utf8'));
const usage = JSON.parse(fs.readFileSync(path.join(R, 'baseline', 'usage.json'), 'utf8'));
// Fixed floor every subagent pays (system prompt + tools), measured with a trivial control task.
const FLOOR = usage.control;

function prf(pred, truth, neutral = []) {
  const T = new Set(truth.map(String)), N = new Set(neutral.map(String));
  const P = [...new Set(pred.map(String))].filter((p) => !N.has(p));
  const tp = P.filter((p) => T.has(p)).length;
  const precision = P.length ? tp / P.length : 1, recall = T.size ? tp / T.size : 1;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}

function scoreBaseline(id, m) {
  const f = path.join(R, 'baseline', `${id}.json`);
  if (!fs.existsSync(f)) return null;
  const a = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (m.kind.startsWith('filter')) {
    const s = prf(m.kind === 'filter-lines' ? a.lines : a.ids, m.truth, m.neutral);
    return { metric: 'F1', value: s.f1, ...s };
  }
  if (m.kind === 'classify') {
    const ids = Object.keys(m.truth);
    const correct = ids.filter((k) => a.labels?.[k] === m.truth[k]).length;
    return { metric: 'accuracy', value: correct / ids.length };
  }
  if (m.kind === 'find') {
    let h1 = 0, h5 = 0;
    for (const [name, [lo, hi]] of Object.entries(m.truth)) {
      const got = (a.hits?.[name] || []).slice(0, 5).map(Number).map((n) => n >= lo && n <= hi);
      if (got[0]) h1++; if (got.some(Boolean)) h5++;
    }
    const n = Object.keys(m.truth).length;
    return { metric: 'hit@5', value: h5 / n, hit1: h1 / n };
  }
  if (m.kind === 'rank') {
    let h1 = 0, h3 = 0;
    for (const [q, t] of Object.entries(m.truth)) {
      const got = (a.top3?.[q] || []).slice(0, 3);
      if (t.includes(got[0])) h1++; if (got.some((g) => t.includes(g))) h3++;
    }
    const n = Object.keys(m.truth).length;
    return { metric: 'hit@3', value: h3 / n, hit1: h1 / n };
  }
}

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const usd = (x) => (x === null ? '–' : `$${x.toFixed(4)}`);
const rows = [];
for (const id of Object.keys(sift).sort()) {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'truth', `${id}.json`), 'utf8'));
  const s = sift[id], b = scoreBaseline(id, m), u = usage[id];
  if (!b || !u) { console.warn(`missing baseline for ${id}`); continue; }
  rows.push({
    id, title: m.title, metric: s.score.metric,
    siftScore: s.score.value, baseScore: b.value,
    baseTokens: u.tokens - FLOOR.tokens, siftTokens: s.claudeTokens,
    tokenReduction: 1 - s.claudeTokens / (u.tokens - FLOOR.tokens),
    baseSeconds: u.seconds - FLOOR.seconds, siftSeconds: s.seconds, speedup: (u.seconds - FLOOR.seconds) / s.seconds,
    jevTokens: s.jevTokens, jevUsd: s.jevUsd, baseToolCalls: u.toolUses,
  });
}
if (!rows.length) { console.error('nothing to score: run node run-sift.mjs first'); process.exit(1); }

const sum = (f, rs = rows) => rs.reduce((a, r) => a + f(r), 0);
const priced = rows.every((r) => r.jevUsd !== null);
const all = {
  n: rows.length,
  tokenReduction: 1 - sum((r) => r.siftTokens) / sum((r) => r.baseTokens),
  medianTokenReduction: rows.map((r) => r.tokenReduction).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  speedup: sum((r) => r.baseSeconds) / sum((r) => r.siftSeconds),
  siftScore: sum((r) => r.siftScore) / rows.length,
  baseScore: sum((r) => r.baseScore) / rows.length,
  jevTokens: sum((r) => r.jevTokens),
  jevUsd: priced ? sum((r) => r.jevUsd) : null,
  baseTokens: sum((r) => r.baseTokens), siftTokens: sum((r) => r.siftTokens),
};

let md = `| # | Situation | Metric | Claude alone | Sift | Claude tokens (alone → sift) | Token cut | Time (alone → sift) | Speed-up | Jev cost |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) {
  md += `| ${r.id.slice(1)} | ${r.title.split(' — ')[0]} | ${r.metric} | ${pct(r.baseScore)} | ${pct(r.siftScore)} | ${k(r.baseTokens)} → ${k(r.siftTokens)} | **${pct(r.tokenReduction)}** | ${r.baseSeconds.toFixed(0)}s → ${r.siftSeconds.toFixed(1)}s | ${r.speedup.toFixed(1)}× | ${usd(r.jevUsd)} |\n`;
}
md += `\n**${rows.length} situations:** ${pct(all.tokenReduction)} fewer Claude tokens overall (median ${pct(all.medianTokenReduction)}), ${all.speedup.toFixed(1)}× faster, avg quality ${pct(all.siftScore)} vs ${pct(all.baseScore)} for Claude alone, ${k(all.jevTokens)} Jev tokens${all.jevUsd === null ? '' : ` ($${all.jevUsd.toFixed(3)})`}.\n`;
fs.writeFileSync(path.join(R, 'results.md'), md);
fs.writeFileSync(path.join(R, 'results.json'), JSON.stringify({ rows, all }, null, 2));
console.log(md);
