# Task-level evaluation protocol (T02)

This protocol is set before collecting a comparison. A run is valid only when its case manifest, code revision, thresholds, and spend cap are saved with the results. Do not use Jev confidence, number of hints, or an estimated context reduction as evidence that a feature helped.

## Paired task set

Compare the same fixed task in two arms that differ only in the feature being evaluated. Cover five classes: a one-file edit, a reproducible bug fix, a repository search, a multi-file implementation, and an implementation that permits native subagents. Keep at least three cases in each class. Save each exact prompt, input files or repository revision, expected answer or acceptance checks, model and effort, timeout, and tool permissions in the run manifest before either arm starts.

For each case, run five paired repetitions with a cold cache and five with a warm cache. A cold run starts in a fresh session with no task-specific history. A warm run follows the same fixed priming turn in a fresh session; record reported cache-read and cache-write tokens instead of assuming the cache was warm. Randomize which arm runs first in each pair. Keep code revision, prompt, model, effort, context limit, tool availability, and timeout identical. If a case or environment changes, start a new comparison.

## Correctness and completeness

Run the case's acceptance command and save its output. For search cases, compare returned paths and required facts with a frozen answer key. For edit and implementation cases, use tests plus a blinded 0–4 rubric for requirement coverage and unintended changes. For debugging, require the supplied reproduction to pass and record any newly failing checks. For agent cases, apply the same final acceptance checks and include subagent work in the measured task. Record retries, failures, and rework; never drop a failed run from the sample.

Report every case and category separately. For each arm, include the sample count, median, interquartile range, range, and failure count. Compare paired differences and give a 95% bootstrap interval resampled by case; do not pool a weak category into an overall average that hides a regression.

## Task-total measurements

Measure elapsed wall time from prompt submission until the final accepted result, including Jev calls, model calls, tool work, retries, and relevant subagents. Record time to the first answer separately. For parallel work, use wall time and do not add overlapping durations. Capture input, output, cache-read, and cache-write tokens by model when available; Jev input tokens and provider cost remain separate. Record unavailable costs as unknown. Include tool-call counts, retries, acceptance results, rubric scores, and later corrective work. Preserve the trace or run log needed to audit each number.

## Pre-registered decision thresholds

Keep an optimization only if quality is non-inferior within 2 percentage points on the frozen correctness measure, there is no new critical failure, and at least one task-total measure improves by 10% or more with a paired 95% interval excluding zero. The other task-total measure must not regress by more than 5%, and rework must not increase. Recalibrate when the evidence is mixed; remove the optimization when it misses these gates after the full sample. A result that does not reach the sample size is inconclusive and cannot support a performance claim.

For Sift `--fast`, apply the same quality gate and require at least 20% fewer Jev input tokens and 10% lower Sift wall time, with no increase in failed or uncertain cases. Report uncertainty counts and failure rates beside quality. Until this gate is met, the fast mode is not eligible for production retention.

The comparison-wide provider spend cap is US$5, with a US$0.50 cap per task pair. Record the configured provider and its price source before starting. Stop before the next pair if its projected cost could cross either cap; leave unknown-price providers unrun unless the owner sets a limit. Do not create provider accounts to complete a run.

The current benchmark's TypeSafe rate is a hard-coded assumption of US$0.042 per million reported input tokens, inherited from the Quicksilver runner in `bench/run-sift.mjs`. It is not a verified invoice rate. Label any multiplication by it as an input-only list-rate estimate, and report provider spend as unknown unless an invoice or authoritative billing record is available. Missing token counters leave the corresponding usage and cost unknown or partial; never substitute zero.

## Required run manifest

Save the following beside each result artifact: protocol revision, case-manifest hash, repository commit and dirty-tree patch hash, OS and Node version, provider and model, model effort, cache procedure, arm order and repetition, timeout and concurrency, start/end timestamps, token and cost fields with unknowns preserved, output and acceptance evidence, failure/retry/rework counts, and any deviation from this protocol. Store raw per-run records before computing summaries.
