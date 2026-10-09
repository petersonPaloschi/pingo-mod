// Offline audit of the saved partial fast-mode comparison and numeric negative control.
// The fast production flag was removed after the measured quality regression.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--self-check') {
  throw new Error('only --self-check is available; the live fast arm was removed after it missed the quality gate');
}

const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'results', 'fast-comparison-partial.json'), 'utf8'));
assert.equal(artifact.status, 'incomplete');
assert.equal(artifact.summary.validPairedRepeats, 4);
assert.equal(artifact.rawPerItemPredictionsRetained, false);
assert(artifact.summary.fast.medianAccuracy < artifact.summary.normal.medianAccuracy - artifact.thresholds.qualityLossMaximumAbsolute);
assert.equal(artifact.summary.fast.failedPerRun, 0);
assert(artifact.summary.fast.medianUncertain > artifact.summary.normal.medianUncertain);

const negative = JSON.parse(fs.readFileSync(path.join(ROOT, 'truth', 's12.json'), 'utf8'));
const lines = fs.readFileSync(path.join(ROOT, 'data', 's12', negative.input), 'utf8').split(/\r?\n/).filter(Boolean);
const predicted = lines.flatMap((line, index) => {
  const match = line.match(/\blatency\s*=\s*(-?\d+(?:\.\d+)?)/i);
  return match && Number(match[1]) > 250 ? [index + 1] : [];
});
assert.deepEqual(predicted, negative.truth);
assert.equal(artifact.numericNegativeControl.f1, 1);
assert.equal(artifact.numericNegativeControl.jevCalls, 0);
console.log(`offline self-check passed · four S08 pairs fail quality gate · local S12 numeric rule is exact (${predicted.length} matches) · no provider calls`);
