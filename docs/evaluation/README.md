# Evaluation fixtures

This directory keeps the frozen task manifest and a small deterministic fixture for reproducing the T02 checks. Per-run traces, CLI outputs, canaries, and one-off runner scripts are archived outside the repository; the result summary below contains only sanitized aggregates.

Run the fixture self-check:

```powershell
node docs/evaluation/fixture.mjs selfcheck
```

Prepare a fresh workspace, copy the exact prompt for the case from [`cases.json`](cases.json), run it with the chosen model, and verify the result:

```powershell
$workspace = Join-Path $env:TEMP 'pingo-eval-edit-01'
node docs/evaluation/fixture.mjs prepare edit-01-retry-default $workspace
node docs/evaluation/fixture.mjs verify edit-01-retry-default $workspace
```

Use a new workspace for each arm and repetition. Search cases take an answer-file path as the final verifier argument; agent cases also take the saved task trace. The manifest fixes prompts, answer keys, expected files, and class labels. For comparative runs, follow the [paired protocol](../../bench/protocol.md): identical settings and tools, cold and same-session warm conditions, paired repetitions, acceptance checks, and measured costs. The archived live pilot used Sonnet 5.5 at medium effort but did not meet the preregistered sample size or support policy claims.

See the [concise matched-pilot summary](results/matched-pilot-summary.md) for observed outcomes and limits.
