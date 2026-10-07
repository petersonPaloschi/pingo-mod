# Claude-alone baseline prompts

Every baseline ran as a Claude Code subagent (`general-purpose`, model `sonnet`) with this preamble:

> BENCHMARK TASK. You are the "Claude does it natively" baseline. Work the way you normally would as a coding agent in Claude Code: look at the data with Read, Grep and Glob, and make the judgments yourself. Rules: do NOT use Bash, and do NOT write or run any script or program. Do NOT use the web. Do NOT read anything outside the dataset directory. You are scored for accuracy against hidden ground truth.

It was followed by the dataset path, the task, and the answer format:

| # | Dataset | Task | Answer |
|---|---|---|---|
| 01 | `data/s01/bgl.log` | every line that reports a failure, fault, or fatal error that needs attention (not corrected errors or routine info) | `{"lines": [...]}` |
| 02 | `data/s02/service.log` | every line that reports an actual failure or crash (not status, metrics, warnings, successful retries) | `{"lines": [...]}` |
| 03 | `data/s03/tickets.jsonl` | route each message to one of 8 Banking77 queues | `{"labels": {...}}` |
| 04 | `data/s04/messages.jsonl` | every spam SMS | `{"ids": [...]}` |
| 05 | `data/s05/reviews.jsonl` | positive / negative per sentence | `{"labels": {...}}` |
| 06 | `data/s06/src` | every middleware that authenticates requests via credentials/tokens | `{"ids": [...]}` |
| 07 | `data/s07/app` | every file with an exploitable vulnerability | `{"ids": [...]}` |
| 08 | `data/s08/failures.jsonl` | root cause: infra_flaky / assertion / config_env / dependency (with descriptions) | `{"labels": {...}}` |
| 09 | `data/s09/lodash.js` | up to 5 line numbers for each of 10 behaviour descriptions | `{"hits": {...}}` |
| 10 | `data/s10/src` | top-3 files for each of 10 "where is X?" questions | `{"top3": {...}}` |
| 11 | `data/s11/commits.jsonl` | commit type: feat / fix / docs / chore / perf / refactor / test (with descriptions) | `{"labels": {...}}` |
| 12 | `data/s12/latency.log` | every line with latency > 250ms | `{"lines": [...]}` |

Control (overhead floor): "Read `data/s07/app/lib/math.ts`, write `{"ok": true}`." It measured 68,483 tokens and 5.6s.

The question and label wording were identical to what Quicksilver received (see `truth/sNN.json`).
