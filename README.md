# Pingo

**Execution diagnostics and semantic search for Claude Code, powered by Jev.**

Pingo shows observable activity, task durations, models and effort actually used, tools, workers, errors, and reported token usage. The `sift` skill asks [TypeSafe's Jev](https://typesafe.ai/) structured semantic questions over bounded candidates. Optional native-subagent planning chooses model and effort when Claude starts an eligible agent. The Context feature asks Jev to keep or trim older tool history when session usage reaches its configured threshold; Claude's normal summary remains the fallback when the reduction is small.

The plugin identifier remains **`jev`**, commands start with **`/jev`**, and configuration uses **`JEV_*`** environment variables. Claude Code owns the main model, effort, tools, delegation, permissions, and completion. Main prompts and successful tool batches add no automatic Jev consultation.

## Quick start

Requires **Claude Code 2.1.292 or newer** with mod support. Sift requires **Node 22.18 or newer**. Diagnostics work without a key; semantic judgments and optional agent planning require a provider credential.

```sh
git clone https://github.com/petersonPaloschi/pingo-claude-code.git pingo
cd pingo
claude --plugin-dir .
```

1. Run `/jev setup` to configure and test your provider on the AI tab. Enter its key in the masked field; a refused key is not saved or used.
2. Run `/jev status` to inspect the provider, credential source, and observed execution.
3. Run `/jev` to open the dashboard. Enable `agents` on the AI tab only when its planning overhead is appropriate.

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

## What Pingo is, and how agents help

Pingo is a Claude Code plugin that adds a live activity dashboard and optional workflow helpers. It turns events exposed by Claude Code into a readable view of requests, tools, workers, models, timing, errors, and reported token use. Claude Code still runs the main conversation and controls its tools and permissions; Pingo observes that work and adds opt-in assistance. The small Pingo mascot is a visual status indicator for the session.

![Illustration of five agent mascots working in parallel, with a final review step](docs/media/parallel-agents.png)

An agent is a temporary helper worker with its own task. In native delegation, Claude Code decides when to start one; the worker can inspect or change its assigned part of the project and returns a result. Pingo records its task, current activity, model, effort, tools, and duration. The Agents screen gives each worker a live pane, and the Live screen shows active workers alongside the main task.

Pingo can also run managed orchestration when enabled. It takes a plan of work units, waits for prerequisites, starts independent units in parallel through the Claude Code runtime, and asks reviewers to check each result and the final integration. The default worker limit is three at a time, subject to other limits. Issues can trigger repair rounds; an unapproved result remains marked unverified. Both model planning and managed orchestration start off by default.

Jev is a separate AI advisor configured with a provider, key, and model. Pingo asks Jev short, structured questions when an enabled feature needs a semantic judgment. Jev can filter or rank bounded candidates in **Sift**, help select a worker's model and effort, or advise an orchestration decision. Pingo or Claude Code applies the result and performs the work. The five mascot names — Tetra, Gem, Can, Coil, and Top — are visual identifiers for concurrent workers, not fixed job roles or a promise that five workers are always active.

## Dashboard

The six main tabs are **Overview, Live, Models, Agents, Logs, and Configuration**. Five specialized tabs cover AI, feature controls, execution flow, orchestration, and the Deck. The interface is available in English and Brazilian Portuguese.

| Tab | What it shows |
| --- | --- |
| **Overview** | Choose a time range and see session state, request outcomes, failures, response timing, reported usage, Jev calls, and a timeline chart. Each figure identifies its scope; an empty range has a single empty state. |
| **Live** | See what is happening now: the main model and effort, active workers, recent tool activity, visible messages, Jev consultations, and results. **Full run details (f)** opens the scrollable execution flow; **Back to Live log (b)** returns to the feed. Private model reasoning is not shown. |
| **Models** | Review the main model and effort actually observed, recent requests, requested versus observed model IDs, duration, and reported input/output/cache usage. Jev's model and usage are shown separately. Missing provider usage stays unknown or partial. |
| **Agents** | See running and completed workers, their task and current activity, mascot/color, model and effort, request/tool counts, and reported tokens. Open a worker's individual live pane or clear completed runs; active workers remain. |
| **Logs** | Read grouped routing reasons and recent requests in time order, including outcome, decision, latency, confidence, reported token usage, failure cause, recovery hint, and available raw Jev replies. The screen also shows recent Jev calls and their answers. |
| **Configuration** | Set the interface language to automatic, English, or Portuguese; inspect saved history metadata and clear completed history. Provider credentials and AI routing live on the AI screen. |

| Specialized tab | What it shows |
| --- | --- |
| **AI** | Select Jev's provider and model, set a masked key, test the connection, control Jev routing, and set AI-backed feature preferences. |
| **Features** | Toggle Pingo Vivo and Sentinela; set the companion's hat and shades, completion sound, Sentinela's monitoring interval, and the overlap-warning window. |
| **Flow** | Follow a request from its prompt through any advisor decision and tool activity to the result. `/jev flow` and `/jev fluxo` open this timeline. |
| **Orchestration** | Control automatic planning, independent review, advice, managed batches, role profiles, model/effort choices, and resource limits; inspect the current objective and batch approval state or cancel an unfinished batch. |
| **Deck** | Configure the compact status band: visible plan, agent, context, limit, routing, pet, clock, and weather details; size, style, automatic updates, sound, quiet mode, cost display, and weather location. |
| **Quality** | Follow Code Quality's review cycles: the files each one reviewed, what it fixed (`file:line`), and what it left as it was and why; switch it off or start a review now. `/jev quality` and `/jev qualidade` open it. |

### Optional features

Pingo has eleven optional features. The nine AI-assisted features are grouped on the AI screen; Pingo Vivo and Sentinela are available in the Features controls. Each feature can be enabled or disabled.

| Feature | Controls | What it does |
| --- | --- | --- |
| **Agent planning** | AI | Jev selects a suitable model and effort for an eligible subagent unless a model was already chosen. |
| **Farol** | AI | Collects Claude's working assumptions, lets you correct them, and carries corrections into later turns for the project. |
| **Clareza** | AI | Keeps explanations at a chosen technical level and checks completed answers. If something may confuse, it prepares a rewrite proposal for you to review, send, or reject. |
| **Lapida** | AI | Rewrites a draft prompt using project context and learns from edits made before sending it. |
| **Prisma** | AI | Turns design questions with SVG previews into visual choices; options can be mixed, and decisions are remembered per project. |
| **Semente** | AI | Saves side ideas, accepts ideas from Claude, and nudges you when a saved idea matches recent work. |
| **Vigia** | AI | Tracks sessions in the project and summarizes their work. Sessions of the same project talk: `/vigia msg <session id\|all> <text>` sends a message the other session shows at once and its Claude reads with its next step or request; each Claude reads what the others are doing; and an edit waits until Claude reads again a file another live session just changed (that session is told). |
| **Context** | AI | When conversation history gets long, asks Jev which older tool results can be removed or shortened while keeping recent messages intact. |
| **Code Quality** | AI | After each turn in which Claude changes code, an agent of Pingo's reviews the pending changes (`git status`) against the project's own patterns, fixes duplication, hardcoded values, over-engineering and clear bugs in those files on its own, without asking: Pingo answers its permission requests itself, whatever the session's mode, and lets it only read, search and edit files inside the project and run `git status`/`diff`/`log`/`show`/`ls-files`/`blame` and graft's queries; anything else (commits, resets, installs, downloads, writes outside the project) is refused, so text in the code it reviews cannot lead it elsewhere. It never reverts other work; what it could not fix is listed on the Quality screen. On by default; switch it off to stop it. |
| **Pingo Vivo** | Features | Adds an animated Pingo companion that reacts to session activity. |
| **Sentinela** | Features | Shows sessions across projects, their status and resume command, and lets you message a session that is waiting. |

Pingo remains a simple state indicator. The user and agents have readable names and colors. Retired dice, solid mascots, and graph pulses do not schedule frames. See [DESIGN.md](DESIGN.md).

Task timing starts at prompt submission. Main-response and background-completion timing are distinct; parallel work contributes elapsed wall time rather than summed overlaps. Main, worker, cache, and Jev usage have separate scope. Unreported usage/prices remain unknown; known provider subtotals are partial or estimated. Review requested, advisor call observed, and result verified are separate facts.

## Commands

| Command | Action |
| --- | --- |
| `/jev`, `/jev dashboard`, `/jev overview` | Open Overview. |
| `/jev live` | Open the live activity feed. |
| `/jev flow`, `/jev fluxo` | Open the execution-flow timeline. |
| `/jev quality`, `/jev qualidade` | Open Code Quality's review cycles. |
| `/jev models` | Show observed model and effort. |
| `/jev agents` | List workers and activity. |
| `/jev agent [number, type, or name]` | Open a worker's live pane. |
| `/jev agent <selector> remove` | Remove a finished run and close its pane. |
| `/jev agents clear` | Remove finished runs; active workers stay. |
| `/jev logs`, `/jev log`, `/jev reasons` | Open Logs. |
| `/jev config`, `/jev features` | Open Configuration (language and history). |
| `/jev ai`, `/jev ia`, `/jev setup [provider]` | Open AI settings: Jev routing, provider, key, connection test, and AI feature switches. `setup` can select a provider. |
| `/jev orch` | Open orchestration settings; `/jev orch <setting>` applies an orchestration command. |
| `/jev deck` | Open settings for the compact status band. |
| `/jev status` | Show settings and observed execution. |
| `/jev routing on|off` | Enable or disable Jev routing for optional AI-assisted features. |
| `/jev feature <id> on|off` | Enable or disable an optional feature. |
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
| `context_goal` | Empty | Optional task goal; empty derives it from the last three user prompts. |
| `context_compact_at_percent` | `60` | Context usage percentage that starts compaction. |
| `context_min_reduction_ratio` | `0.25` | Minimum share of history characters removed before replacing Claude's summary. |
| `context_keep_threshold` | `0.5` | Jev probability needed to keep a call or its full result. |
| `context_preserve_recent_messages` | `6` | Newest messages left untouched by compaction. |
| `context_max_state_tokens` | `25000` | Estimated ceiling for history sent with each Jev request. |
| `context_max_request_tokens` | `30000` | Estimated ceiling for the state and questions in one Jev request. |
| `context_truncate_head_chars` | `300` | Initial result characters kept when Jev says a result can be shortened. |

Context compaction uses the same selected provider, credential, and Jev model as the rest of the plugin.

Explicit `provider` precedes `JEV_PROVIDER`. With `auto`, environment detection follows the table order, else TypeSafe. A sensitive option without an issuer is treated as a TypeSafe key. A provider detected from its environment receives that key, never one paired with another provider.

Configuration validates a pasted key before saving its provider/key pair in `~/.claude/plugins/store`, and attempts to save Claude Code's sensitive `api_key` option through `claude plugin configure --values-stdin`. If the runtime refuses the option, the paired local copy still restores it; if both saves fail, the previous configuration is restored. Treat plugin-store credentials as sensitive.

The field is masked; saved-key display reveals only the last four characters. Status reports the source. **Remove key** clears the local copy and attempts to clear the sensitive option, reporting refusal. Testing another provider uses its own key. Startup discards legacy state credentials. Keep keys out of command arguments, repository files, and screenshots.

## Data handling

Context compaction sends fitted conversation text, the task goal, and abbreviated tool-call inputs to the selected Jev provider for keep/drop judgments; tool outputs are replaced with status and size notes. Optional agent planning sends the selected provider the agent type, bounded description/prompt, and model/effort questions. Explicit Sift commands send judged content and criteria. Limits do not redact secrets inside normal content or stdin. Use these features only for content you may share.

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
