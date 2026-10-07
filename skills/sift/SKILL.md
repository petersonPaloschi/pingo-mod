---
name: sift
description: Hand bulk judgment calls to Jev through Pingo so Claude doesn't read, and pay for, content it only needs a verdict on. Use this BEFORE reading many files, long logs, or big lists just to decide which parts matter. That covers finding which files relate to a feature or bug, filtering log lines for errors, triaging or labelling many items (tickets, test failures, commits, TODOs, search hits), ranking candidates by relevance, locating the right lines in a huge file, or a yes/no check on a large document. Also use when the user says sift, "save tokens", "delegate to Jev", or "cheaper/faster". Skip it for generation, editing, multi-step reasoning, math, counting, or date comparison, and when the input is small enough to just read.
---

# Sift: Jev narrows, Claude reads what survives

Jev returns **typed judgments** (a yes/no probability or a one-of-N label with confidence)
in about a second. It cannot write text or reason in steps. So the split is simple:
**Jev narrows, Claude reads only what survives.** Every item Jev rules out is content that
never enters Claude's context, and Jev scans hundreds of items in parallel.

In the commands below, `sift` stands for:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sift.ts"
```

It needs Node 22.18 or newer (it loads Pingo's TypeScript directly) and no other dependencies.

## First run

Run `sift status` first.

- `ready` means go straight to the task.
- Exit code 3 (`not configured`, or a refused key) means the user must run `/jev setup` in
  Claude Code. Sift uses the same provider, key and model as Pingo: Setup's saved key, the
  plugin options, then `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY` or
  `OPENCODE_API_KEY` (`JEV_PROVIDER` picks between them). Never ask for the key in chat.
  After setup, carry on with the original task.

## When to delegate

Ask: *"Am I about to read a lot of content only to decide which parts matter?"*
If yes, and each decision fits yes/no or pick-a-label, delegate.

| Situation | Command |
| --- | --- |
| "Which files deal with X?" across a repo | `sift filter "Does this file implement or handle X?" src` |
| Errors or anomalies in a big log | `sift filter "Does this line indicate a failure?" app.log --lines` |
| Where in a 5k-line file is Y? | `sift find "Y" big_file.py --top 5` |
| Sort 200 tickets, test failures, or TODOs into buckets | `sift classify --labels "bug,feature,question" --items items.jsonl` |
| Best candidates for a query (search hits, docs, files) | `sift rank "query" docs/ --top 10` |
| One yes/no over a large document | `sift ask "Does this contract allow termination without notice?" --state @contract.txt` |
| Several questions over the same content | `sift ask spec.json` (raw request, see below) |

It is strongest on needle-in-haystack log search, finding files across a repo, "where is X?"
ranking, search inside huge files, and bulk routing with clear labels. It is weaker on
subjective or expert-defined labels and on look-alike code (safe vs vulnerable twins): there,
treat the output as a shortlist and check the `?` items yourself.

**Don't delegate:**
- Tiny inputs (a few files, or under ~2k tokens). Just read them.
- Exact matches. `grep` or `rg` is free and exact. Jev is for *meaning*: "handles auth"
  rather than the literal string `auth`.
- Arithmetic, counting, date or time comparison. Do those in code.
- Anything generative (writing, summarizing, editing) or needing a chain of reasoning.
- Content the user wouldn't want sent to their Jev provider. Sift already skips `.env*`,
  keys, certs and credentials files, binaries, lockfiles, and respects `.gitignore`.

## Commands

**Inputs** (for filter, classify, rank): files, directories (respects `.gitignore` inside git
repos, and skips `node_modules`, `dist`, and similar), globs, `-` for stdin, or
`--items FILE.jsonl` (one JSON object per line with `id` and `text`, or plain text lines).
Add `--lines` to judge each line separately (logs, CSVs, lists). Use `--ext ts,tsx` to limit
file types.

```bash
sift filter "<yes/no question>" <inputs> [--threshold 0.5] [--lines]
sift classify --labels "a,b,c" <inputs> [--question "..."] [--only a] [--min-confidence 0.6]
sift classify --labels-json '{"bug":"Something is broken","feature":"A request for new behaviour"}' <inputs>
sift rank "<query>" <inputs> [--top 10 | --all]
sift find "<what you're looking for>" <files> [--top 5]
sift ask "<question>" --state @file|"text"|- [--choice "a,b,c"]
sift ask spec.json      # {"state": {...}, "questions": {"id": {"type": "noul|choice", ...}}}
sift status             # provider, key source and model, checked with one real call
```

Add `--json` to any command for machine-readable output; the summary line goes to stderr.
`--save FILE` writes every per-item result to FILE while stdout stays compact. Requests run
16 at a time (`--concurrency`), one item each. `--fast` packs small items into shared
requests: much faster on big logs, but less accurate on subtle judgments. Use it for obvious
needles (crashes, OOMs) in very large logs, not for classification.

## Reading the output

Output is compact on purpose. For **filter**, each line is a probability, then the item.
With `--lines`, repeated log lines that differ only in numbers or ids merge into one
pattern, followed by the other matching line numbers:

```
0.99  src/db.ts
0.98  app.log:813  worker ERROR process killed: JavaScript heap out of memory
0.97  ×57  app.log:104  RAS KERNEL FATAL data TLB error interrupt
        also lines 115,121-130,…
? borderline (0.35–0.65) — check these yourself:
0.55  app/api/convert_safe.ts
— 340 scanned · 3 matched · 1 borderline · 4.1s · jev 90.0k tok ($0.0038) · ~88.0k Claude tokens not read
```

**classify** prints the count per label, then the ids in each label, then each
low-confidence item with its runner-up label and its text:

```
bug 41 · feature 12 · question 7
[bug] T1 T4 T9 …
? low confidence — check these yourself:
?0.49  bug (or question)  T33  login button does nothing on Safari?
```

- `?` marks a borderline or low-confidence item. **Read those yourself.** Treat everything
  else as a reliable shortlist.
- `~` after an item means it was cut at `--max-chars` (default 60k chars), so Jev only saw
  the start.
- `! N not judged (...)` lists items whose request failed. They are in neither list: read
  them yourself or re-run. Exit code 5 means every request failed.
- The footer shows Jev's tokens (with a cost on TypeSafe) and the estimated Claude tokens
  avoided. Mention the savings to the user when they're meaningful.
- Jev's verdicts make a **shortlist, not proof**. Open the survivors before you edit code,
  draw conclusions, or tell the user something is definitely absent. If a filter returns
  nothing you expected to find, rephrase the question or lower `--threshold` first.

## Writing good questions

Jev reads questions **literally**. Its accuracy comes from how precise the question is.

- One judgment per question. Say "Does this file send email?", not "Does this file send
  email or handle billing?". Run two filters instead.
- Spell out the exact condition, including the boundary cases: "Does this line report a
  failure (ERROR, FATAL, crash, timeout), not a deprecation warning?"
- Use plain meaning, not jargon hops or double negatives.
- Give classify labels short descriptions with `--labels "bug:Something broken,feature:New behaviour request"`.
  Add a catch-all label such as `other` when nothing may fit.
- For a raw `ask` spec, put the content in `state` (a JSON object) and refer to fields in
  backticks inside instructions, like `` `ticket.body` ``. Questions are `noul` (yes/no) or
  `choice` (with `criteria` mapping each option to a description or null); they run in
  parallel and can't see each other's answers.

## Patterns that pay off

- **Funnel:** `sift filter` over the whole repo, then read the 5 survivors instead of 300 files.
- **Log triage:** `sift filter ... --lines` over a 50k-line log, then investigate only the failures.
- **Two-pass precision:** a cheap broad `filter`, then `rank` the survivors against the
  specific question.
- **Batch triage:** dump items to JSONL (issues, test output, grep hits), `sift classify`,
  then act per bucket.
