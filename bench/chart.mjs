// Renders the answer-quality comparison without treating imported estimates as task savings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const { rows } = JSON.parse(fs.readFileSync(path.join(ROOT, 'results', 'results.json'), 'utf8'));

const W = 960, rowH = 36, top = 118, left = 390, barW = 360;
const H = top + rows.length * rowH + 70;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pct = (x) => `${Math.round(x * 100)}%`;

let body = '';
rows.forEach((r, i) => {
  const y = top + i * rowH;
  const base = Math.max(1, r.baselineScore * barW), sift = Math.max(1, r.siftScore * barW);
  const name = esc(r.title.split(' — ')[0]);
  body += `
  <text x="${left - 14}" y="${y + 14}" text-anchor="end" class="lbl">${name}</text>
  <rect x="${left}" y="${y + 3}" width="${base.toFixed(1)}" height="9" rx="2" class="base"/>
  <rect x="${left}" y="${y + 15}" width="${sift.toFixed(1)}" height="9" rx="2" class="sift"/>
  <text x="${left + barW + 10}" y="${y + 11}" class="dim">stored ${pct(r.baselineScore)}</text>
  <text x="${left + barW + 10}" y="${y + 23}" class="siftl">Sift ${pct(r.siftScore)}</text>`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-sans-serif, -apple-system, Segoe UI, Helvetica, Arial, sans-serif">
  <style>
    .lbl { font-size: 13px; fill: #d6dbe4 }
    .dim { font-size: 11px; fill: #7d8796 }
    .siftl { font-size: 11px; fill: #9fe8ff; font-weight: 600 }
    .base { fill: #3a4252 }
    .sift { fill: url(#hg) }
  </style>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d1117"/><stop offset="1" stop-color="#161b26"/></linearGradient>
    <linearGradient id="hg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8edf5"/><stop offset="1" stop-color="#5fd4ff"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="14" fill="url(#bg)"/>
  <text x="28" y="44" font-size="22" font-weight="700" fill="#f2f5fa">Sift answer quality against stored reference</text>
  <text x="28" y="68" font-size="13" fill="#9aa4b2">${rows.length} situations · per-case scores against ground truth · stored reference is unpaired</text>
  <rect x="${left}" y="86" width="12" height="8" rx="2" class="base"/><text x="${left + 18}" y="94" class="dim">Stored Claude-alone reference</text>
  <rect x="${left + 190}" y="86" width="12" height="8" rx="2" class="sift"/><text x="${left + 208}" y="94" class="dim">Sift</text>
  <text x="${left + barW / 2}" y="108" text-anchor="middle" class="dim">score against ground truth</text>
  ${body}
  <text x="28" y="${H - 26}" class="dim">Stored answers and usage are Quicksilver-derived, not a live paired baseline. No total-task savings claim.</text>
</svg>
`;
const target = path.join(ROOT, '..', 'docs', 'media', 'benchmark.svg');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, svg.replace(/[ \t]+$/gm, ''));
console.log(`wrote ${path.relative(path.join(ROOT, '..'), target)}`);
