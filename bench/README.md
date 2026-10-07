# Sift benchmark

Twelve situations a coding agent actually runs into, each solved two ways and scored against hidden ground truth:

- **Claude alone:** a Claude Sonnet subagent in Claude Code using its normal Read, Grep, and Glob tools, without scripts. Its answers and token usage are recorded in `results/baseline/` (see [prompts.md](prompts.md)).
- **Claude + sift:** the same task run through `scripts/sift.ts`. The score covers exactly what Claude would read back, and sift is charged for loading `skills/sift/SKILL.md` plus every command it issues.

The situations, ground truth, and Claude-alone baseline come from [Quicksilver](https://github.com/UditAkhourii/quicksilver)'s benchmark, which sift adapts. The baseline does not depend on the tool, so it is reused rather than re-measured.

## Reproduce

Node 22.18 or newer, and a Jev key that sift can use (`node scripts/sift.ts status` checks it).

```bash
cd bench
mkdir -p data/raw && cd data/raw
curl -sL -o bgl.csv https://raw.githubusercontent.com/logpai/loghub/master/BGL/BGL_2k.log_structured.csv
curl -sL -o lodash.js https://raw.githubusercontent.com/lodash/lodash/4.17.21/lodash.js
git init -q hono
git -C hono sparse-checkout set --no-cone '/*' '!*.test.ts' '!*.test.tsx'
git -C hono fetch -q --depth 400 https://github.com/honojs/hono.git 90d02fb1645c12a65d27f39594d2129db2065ba7
git -C hono checkout -q FETCH_HEAD
cd ../..
node build.mjs            # builds data/sNN and rewrites truth/sNN.json (Hugging Face rows are fetched and cached)
git diff --exit-code truth # unchanged truth means the data matches the recorded baseline
node run-sift.mjs         # sift side; pass situation ids (s07 s08) to run some of them
node score.mjs            # writes results/results.md and results/results.json
node chart.mjs            # writes docs/media/benchmark.svg
```

The sparse checkout leaves out Hono's own test files: the benchmark never uses them, and `claude plugin test` would otherwise run them as Pingo's. Hono is pinned to the commit the baseline was built from (2026-09-25). A newer clone changes the source files and commit list of S06, S10, and S11, and through the shared seeded generator the data of S12. `build.mjs` builds every situation in one pass for the same reason.

Quicksilver spent about $0.45 of TypeSafe's Jev on a full run; S09 and S10 account for most of it. On another provider, `jevUsd` is left empty and the table shows only Jev tokens.

## How tokens are counted

- **Claude alone:** the subagent's measured token total minus the **68.5k-token fixed floor**, measured with a control agent that reads one tiny file and writes one line. What remains is what the task itself cost.
- **Sift:** SKILL.md (charged in full on every situation, as if each were a new session), plus each command, plus its full stdout, plus 40 tokens of tool-call wrapper per call. Token counts use chars ÷ 4.
- **Jev:** the input tokens sift's providers report, read from a scratch tally (`SIFT_STATS`), so a run never touches your lifetime totals.
- **Time:** wall-clock time for the agent run, against wall-clock time for the sift calls.

## Caveats

- The Claude-alone agents used Sonnet. A larger model would be more accurate and slower.
- For the huge inputs (logs, repositories, lodash), the baseline agent often greps first instead of reading everything. That is realistic, and it makes the baseline cheaper than reading it all.
- S12 is a **negative control**: a numeric comparison, which Jev is documented to be bad at. It shows where *not* to use sift; `awk` wins there for free.
- The synthetic sets (S02, S07, S08, S12) were written by Quicksilver's author. The real sets (S01, S03, S04, S05, S06, S09, S10, S11) come from the public sources listed in `truth/*.json`.
- Sift ranks with a five-level choice weighted by Jev's probabilities rather than Quicksilver's score question, so S10 is not a like-for-like rerun.

## License

`build.mjs`, `prompts.md`, `truth/`, and `results/baseline/` are taken from Quicksilver, and `run-sift.mjs`, `score.mjs`, and `chart.mjs` are adapted from it, under its MIT license:

> Copyright (c) 2026 Udit Akhouri
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
