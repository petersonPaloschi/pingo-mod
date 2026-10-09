# Sift benchmark

This benchmark runs twelve fixed semantic situations against `truth/sNN.json`. The stored Claude-alone answers and usage in `results/baseline/` are imported from Quicksilver. They were not rerun as paired Claude sessions with Sift, so their scores are quality references only; they do not establish a whole-task speed or savings claim.

## Rebuild the inputs

Use Node 22.18 or newer. `build.mjs` needs the raw BGL log, Lodash source, and pinned Hono checkout in `data/raw/`; it fetches the public Hugging Face rows itself. From `bench/`, prepare the inputs and run:

```bash
mkdir -p data/raw && cd data/raw
curl -sL -o bgl.csv https://raw.githubusercontent.com/logpai/loghub/master/BGL/BGL_2k.log_structured.csv
curl -sL -o lodash.js https://raw.githubusercontent.com/lodash/lodash/4.17.21/lodash.js
git init -q hono
git -C hono sparse-checkout set --no-cone '/*' '!*.test.ts' '!*.test.tsx'
git -C hono fetch -q --depth 400 https://github.com/honojs/hono.git 90d02fb1645c12a65d27f39594d2129db2065ba7
git -C hono checkout -q FETCH_HEAD
cd ../..
node build.mjs
git diff --exit-code -- truth
```

`build.mjs` creates all twelve input sets together because they share a seeded generator. The `data/` directory is ignored by Git. The Sift runner passes its generated directory members as explicit files so the repository's `.gitignore` does not hide the benchmark fixture from Sift.

## Run and score Sift

The normal production path judges one item per request. Run the full suite or selected situations with a ready TypeSafe setup:

```bash
node run-sift.mjs
node run-sift.mjs s07 s10 s12
node score.mjs
node chart.mjs
```

`run-sift.mjs` uses concurrency 4, stops on missing usage counters, caps each CLI call at a $1 configured-rate estimate and the run at $3.78, and records Sift CLI time and Jev usage separately. Its TypeSafe price assumption is $0.042 per million reported input tokens, inherited from the Quicksilver runner; the resulting amount is an input-only list-rate estimate, not an invoice. Costs and token totals remain unknown or partial when the provider omits counters.

`score.mjs` compares both answer sets against the same answer key and reports the stored-baseline quality beside Sift quality. It keeps baseline tokens/time labelled as imported measurements, reports Sift CLI wall time independently, and does not calculate a total task delta. `chart.mjs` visualizes answer quality only; see the [quality chart](../docs/media/benchmark.svg).

## Current results and limits

The compact benchmark results are intentional evidence: `score.mjs` consumes `sift.json` and the stored reference, and `chart.mjs` consumes `results.json`. Per-session CLI traces, canary outputs, copied configurations, and one-off credential-handling runners stay outside the repository. Task evaluation keeps only its frozen fixture, protocol and aggregate summary; its raw result directories are ignored by Git.

The full normal run is saved in `results/sift.json`, with the per-case summary in `results/results.md` and `results/results.json`. It reports each quality metric separately instead of averaging unlike F1, accuracy, and hit-rate cases. Sift CLI calls took 725 seconds in total and reported 10.87 million Jev input tokens; the configured TypeSafe input list-rate estimate is ~$0.4566. These measurements omit the later Claude work, Claude cache, and model usage, so they are not whole-task results. Context estimates use the skill text length from run time; the skill's later evidence notes are not included in those figures.

The benchmark's S10 ranking uses the exact ten query strings in `truth/s10.json` and scores `hit@3` against the same accepted file paths for both answer sets. Sift receives one relevance judgment per file while the stored baseline is a generated top-three answer, so the shared answer key aligns correctness scoring but does not make the runs paired.

S01's normal Sift run scored 22.8% F1 on the 2,000-line BGL fixture; S07 scored 88.9% F1 on vulnerable files beside safe look-alikes; S11 scored 74% accuracy on commit labels. Those results support treating Sift output as a shortlist that needs direct review. S12's numeric threshold has an exact local rule: the offline self-check finds all 107 lines above 250ms with F1 1.00 and makes no Jev calls.

The fast batching path failed the pre-registered quality gate on S08: four valid paired repeats scored 100% accuracy normally and 77.5–82.5% when packed, with more uncertain items. `results/fast-comparison-partial.json` records the observed timings, counters, input hashes, thresholds, and why the sample remains incomplete. Fast mode was removed from production. Run `node compare-fast.mjs --self-check` to audit that partial artifact and the local numeric rule without making provider calls; a live fast replay requires the pre-removal Sift code.

Use [protocol.md](protocol.md) before designing another feature comparison. A gain claim requires live paired task runs with correctness checks and total task measurements; a context-character estimate cannot provide that evidence.

## License

`build.mjs`, `prompts.md`, `truth/`, and `results/baseline/` are taken from Quicksilver, and `run-sift.mjs`, `score.mjs`, and `chart.mjs` are adapted from it, under its MIT license:

> Copyright (c) 2026 Udit Akhouri
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
