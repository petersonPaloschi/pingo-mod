# Pingo

**Execution diagnostics and semantic search for Claude Code, powered by Jev.**

Pingo shows observable activity, task durations, models and effort actually used, tools, workers, errors, and reported token usage. The `sift` skill asks [TypeSafe's Jev](https://typesafe.ai/) structured semantic questions over bounded candidates. Optional native-subagent planning chooses model and effort when Claude starts an eligible agent.

The plugin identifier remains **`jev`**, commands start with **`/jev`**, and configuration uses **`JEV_*`** environment variables. Claude Code owns the main model, effort, tools, delegation, permissions, and completion. Main prompts and successful tool batches add no automatic Jev consultation.

## Quick start

Requires **Claude Code 2.1.292 or newer** with mod support. Sift requires **Node 22.18 or newer**. Diagnostics work without a key; semantic judgments and optional agent planning require a provider credential.

```sh
git clone https://github.com/petersonPaloschi/pingo-claude-code.git pingo
cd pingo
claude --plugin-dir .
```

1. Run `/jev config` to configure and test your provider. Enter its key in the masked field; a refused key is not saved or used.
2. Run `/jev status` to inspect the provider, credential source, and observed execution.
3. Run `/jev` to open the dashboard. Enable `agents` in Configuration only when its planning overhead is appropriate.

For later sessions, keep `--plugin-dir` or add an absolute directory to `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/pingo" } }
```

On Windows, use a path such as `C:/Projects/pingo`; separate multiple directories with semicolons.

## Execution and decisions

Pingo records a submitted message before planning. Main tasks retain Claude Code's model and effort, including manual choices, provider-specific IDs, and extended-context models. Per-prompt tool suggestions, the participation classifier, suggested delegation types, generic advisor queries, and edit-only completion gates have been removed.

Native subagent creation and tracking remain available. The optional `agents` feature sizes eligible agents from their type and task. Explicit model choices, forks, and workflow-managed agents remain under native control. Choices and confidence are validated, effort follows the actual model, and failure leaves the native request available. Planning is off by default; its benefit still requires [paired evaluation](bench/protocol.md).

`/jev routing off` stops plugin agent-planning calls and applying planned effort. The dashboard and raw records remain available. Explicit Sift commands operate independently.

Malformed or unknown choices, low confidence, network failure, and timeouts fail open. The shared transport permits at most one retry for retryable HTTP/network errors within the same budget; timeouts and unreadable responses receive no second attempt.

## Dashboard

The six tabs are **Overview, Live, Models, Agents, Logs, Configuration**, in terminal and desktop, with English and Brazilian Portuguese text.

- **Overview:** selected time range, state, failures, request timing, and observed consumption. Empty ranges show one empty state. Figures identify their scope.
- **Live:** visible activity and the execution graph, including tools, worker branches, observable advisor calls, and results. Terminal defaults to a compact sequence; **Full run details (f)** opens the scrollable diagram, and **Back to Live log (b)** returns to the feed. It does not expose private reasoning.
- **Models:** the main model and effort actually observed, changes, and agent decisions. Confidence and activity are not quality scores.
- **Agents:** name, color, state, actual model/effort, request/tool counts, and individual live panes.
- **Logs:** persisted metadata, reasons, latency, usage, and error causes. Routing-disabled requests remain usable for external paired evaluation.
- **Configuration:** provider, masked credentials, language, routing, and optional agent planning.

Pingo remains a simple state indicator. The user and agents have readable names and colors. Retired dice, solid mascots, and graph pulses do not schedule frames. See [DESIGN.md](DESIGN.md).

Task timing starts at prompt submission. Main-response and background-completion timing are distinct; parallel work contributes elapsed wall time rather than summed overlaps. Main, worker, cache, and Jev usage have separate scope. Unreported usage/prices remain unknown; known provider subtotals are partial or estimated. Review requested, advisor call observed, and result verified are separate facts.

## Commands

| Command | Action |
| --- | --- |
| `/jev`, `/jev dashboard`, `/jev overview` | Open Overview. |
| `/jev live`, `/jev flow` | Open Live and its execution graph. |
| `/jev models` | Show observed model and effort. |
| `/jev agents` | List workers and activity. |
| `/jev agent [number, type, or name]` | Open a worker's live pane. |
| `/jev agent <selector> remove` | Remove a finished run and close its pane. |
| `/jev agents clear` | Remove finished runs; active workers stay. |
| `/jev logs`, `/jev log`, `/jev reasons` | Open Logs. |
| `/jev config`, `/jev setup [provider]`, `/jev features` | Open Configuration. |
| `/jev status` | Show settings and observed execution. |
| `/jev routing on|off` | Enable/disable optional agent planning. |
| `/jev feature agents on|off` | Toggle native-subagent planning. |
| `/jev clear` | Clear completed history and retain active work. |

Arguments are case-insensitive; worker numbers are not reused during a session. Useful former commands redirect to consolidated screens. Obsolete features cannot be enabled. Old persisted tabs fall back to a valid screen, and old feature configuration is normalized.

## Sift

Use `rg` for literal matches and local code for numeric rules. Select bounded candidate files/items first, then ask semantic questions. Read selected content before editing or drawing conclusions.

Here, `sift` means `node scripts/sift.ts` from the checkout. The installed skill uses `CLAUDE_PLUGIN_ROOT`.

| Command | Use |
| --- | --- |
| `sift filter "<yes/no question>" <inputs>` | Keep semantic matches from files, `--lines`, or `--items` JSONL. |
| `sift classify --labels "a,b,c" <inputs>` | Assign labels and expose uncertain judgments. |
| `sift rank "<query>" <inputs>` | Rank bounded candidates by relevance. |
| `sift find "<what>" <files>` | Find relevant lines in clipped chunks. |
| `sift ask "<question>" --state @file` | Ask yes/no or `--choice` questions, or supply a raw spec. |
| `sift status` | Test provider/model and show scoped lifetime counters. |

```sh
node scripts/sift.ts --help
node scripts/sift.ts filter "Does this file handle authentication?" hooks --ext ts,tsx
node scripts/sift.ts classify --labels "bug,feature,question" --items tickets.jsonl
node scripts/sift.ts rank "agent model selection" hooks --top 5 --save ranked.json
```

Inputs accept files, directories, globs, stdin (`-`), and JSONL `{ "id": "T1", "text": "..." }` items. Discovery respects Git ignores. Item, concurrency, character, and chunk limits are explicit options. `--json` sends machine-readable stdout and diagnostics to stderr; `--save FILE` persists results. Uncertain judgments and failed items remain visible. The unvalidated packed `--fast` mode has been removed.

The footer's content-minus-output figure estimates **potential context avoided**. It does not measure actual Claude input, later work, cache reuse, or net monetary savings. Jev tokens are separate. Total-benefit claims need a controlled whole-task comparison; see [benchmark reproduction](bench/README.md).

For example, an estimated 10,000 tokens of candidates and 1,000 tokens of output imply 9,000 tokens of potential context avoided. A separately reported 2,000 Jev input tokens do not turn that estimate into a measured net gain: skill/commands, cache, later Claude work, output tokens, and provider prices still need measurement.

## Providers and configuration

These adapters/default IDs are configured in the code; availability is controlled by the provider.

| Provider ID | Key environment variable | Default Jev model |
| --- | --- | --- |
| `typesafe` | `TYPESAFE_API_KEY` | `jev-latest` |
| `openrouter` | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` |
| `vercel` | `AI_GATEWAY_API_KEY` | `typesafe-ai/jev` |
| `opencode` | `OPENCODE_API_KEY` | `jev-1.13-free` |

Configure in Configuration or `/plugin configure jev@inline`:

| Option | Default | Purpose |
| --- | --- | --- |
| `provider` | `auto` | Select a supported adapter. |
| `api_key` | Empty | Sensitive credential, else the selected provider's environment key. |
| `model` | Provider default | Jev model ID, separate from Claude's main model. |
| `min_confidence` | `0.7` | Choice confidence, 0–1; falls back to `JEV_MIN_CONFIDENCE`. |
| `timeout_ms` | `4000` | Single-call budget including retry; environment fallback, clamped to 500–30000 ms. |
| `locale` | `auto` | Interface language: `auto`, `en`, or `pt`. |
| `routing_locale` | `en` | Jev question language; conversation content is preserved. |
| `claude_models` | Built-in candidates | Explicit first-party IDs for agent planning, not account discovery. |

Explicit `provider` precedes `JEV_PROVIDER`. With `auto`, environment detection follows the table order, else TypeSafe. A sensitive option without an issuer is treated as a TypeSafe key. A provider detected from its environment receives that key, never one paired with another provider.

Configuration validates a pasted key before saving its provider/key pair in `~/.claude/plugins/store`, and attempts to save Claude Code's sensitive `api_key` option through `claude plugin configure --values-stdin`. If the runtime refuses the option, the paired local copy still restores it; if both saves fail, the previous configuration is restored. Treat plugin-store credentials as sensitive.

The field is masked; saved-key display reveals only the last four characters. Status reports the source. **Remove key** clears the local copy and attempts to clear the sensitive option, reporting refusal. Testing another provider uses its own key. Startup discards legacy state credentials. Keep keys out of command arguments, repository files, and screenshots.

## Data handling

Optional agent planning sends the selected provider the agent type, bounded description/prompt, and model/effort questions. Explicit Sift commands send judged content and criteria. Limits do not redact secrets inside normal content or stdin. Use these features only for content you may share.

Sift rejects credential-like filenames, binaries, files over 2 MB, lockfiles, and common build/dependency directories. Credential/size guards cover explicit items, state, spec, and labels files. Explicit filenames and stdin are deliberate inputs. Judgments are persisted only with `--save`.

The latest **500 request records** persist timestamps, session/model identifiers, reasons, latency, choices, and reported usage. Prompt and tool argument/result bodies are not record fields. A failure cause can retain a bounded provider excerpt; the transport redacts the configured key. Session feed/trace can include shortened visible prompts, responses, paths, tool details, and errors. Histories are bounded except active work retained for later completion. Clearing history and removing a credential are separate actions.

Some remote workflow agents have no local completion event, so completion and usage can remain unknown. Advisor model/token usage is not supplied by every runtime event. An observed response or tool call does not prove successful verification.

## Validation and evaluation

```sh
claude plugin validate .
claude plugin test .
npx --yes --package typescript tsc --noEmit
node --test tests/sift-cli.test.mjs
```

The suites use stubbed providers and isolated configuration. They verify behavior, migrations, credential isolation, failures, task timing, and CLI formats. They do not establish live Claude/Jev quality, speed, or cost gains. The [evaluation protocol](bench/protocol.md) and [bounded pilot summary](docs/evaluation/results/matched-pilot-summary.md) describe the acceptance criteria and evidence limits.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
