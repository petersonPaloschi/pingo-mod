# Pingo

**A Claude Code mod powered by Jev.**

Pingo adds tool suggestions, optional model and subagent planning, and a live dashboard to Claude Code. It asks [TypeSafe's Jev](https://typesafe.ai/) for structured decisions, checks the answers, and feeds accepted tool suggestions back to Claude.

**Jev suggests. Claude decides.** Claude still writes the answer, chooses tool arguments, and executes tools through Claude Code.

![Pingo, a dotted 3D sphere whose eyes change with routing, thinking, passthrough, failure, idle, and baseline states.](docs/media/pingo-states.gif)

The project is called **Pingo**. The current plugin identifier is **`jev`**, its commands start with **`/jev`**, and its configuration uses **`JEV_*`** environment variables. Use those names with this version.

[Quick start](#quick-start) · [How it works](#how-it-works) · [Features](#features) · [Commands](#commands) · [Data handling](#data-handling)

## What Pingo adds

| Component | Role |
| --- | --- |
| **Claude Code** | Runs the coding session, manages tools and permissions, and produces responses. |
| **Jev** | Answers structured decision questions with choices, confidence, and numerical scores. |
| **Pingo** | Connects Jev to Claude Code, validates decisions, applies enabled planning features, and shows observable activity. |

With ordinary Claude Code, Claude selects its next action from the conversation and available tools. With Pingo's default settings, Jev also evaluates the next tool and Claude receives a suggestion when the answer passes the routing checks. The dashboard, activity feed, and subagent views show those decisions and the session's work.

Optional features can change the model or effort used for a turn or a subagent. They are **off by default**. Tool and delegation suggestions are advisory; model and effort selections, when enabled and applicable, are applied to requests.

Routing adds provider calls, latency, and any charges from that provider. This repository does not establish a guaranteed improvement in speed, cost, or task quality. The Baseline tab compares recorded request counts, token usage, cache share, and request duration with routing on and off; it is not a controlled benchmark.

## Quick start

Requires **Claude Code 2.1.292 or newer** with mod support and a Jev credential from a supported provider.

```sh
git clone https://github.com/petersonPaloschi/jev-claude-code.git pingo
cd pingo
claude --plugin-dir .
```

Inside Claude Code:

1. Run `/jev setup` and choose your provider.
2. Paste its key into the masked **API key** field, then press Enter or **Test and save**. A refused key is neither saved nor used.
3. Run `/jev status` to check the provider, credential source, and enabled features. Run `/jev` to open the dashboard.

Read [Data handling](#data-handling) before enabling routing on private work: Jev receives recent conversation and tool data.

For future sessions, use the same `--plugin-dir` argument, or add an absolute directory to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/pingo"
  }
}
```

On Windows, use a path such as `C:/Projects/pingo`; separate multiple plugin directories with semicolons.

## How it works

![A 3D dotted diagram: Claude sends context to Jev, Jev returns a hint to Claude, and Claude makes the tool call.](docs/media/pingo-routing.gif)

*The README animations were created with Higgsfield 3D Jutsu. They illustrate the mascot and an accepted hint, rather than recording the dashboard or measuring performance.*

1. **Collect context.** At the start of a new turn, Pingo reads the composed system instructions, recent conversation, and available tool roster. A message submitted during a running turn keeps that turn's existing plan.
2. **Ask Jev.** The tool questions ask which tool fits next and whether a tool is needed. Enabled turn-planning questions travel in the same request. A roster over 120 tools adds a shortlisting call before the final choice.
3. **Check the answer.** A tool hint must meet the confidence threshold, pass the tool-needed consistency check, name an offered tool, and target a tool the router can hint. Unknown choices, unsupported hosted-tool selections, and malformed answers fall through.
4. **Give Claude a hint.** An accepted choice is added to Claude's context. It names the tool; Claude supplies the arguments and can choose a different action.
5. **Repeat after tools.** With Tool hints enabled, Pingo consults Jev after the last result in a main-session tool batch. It does not route another plugin's own tool calls or each tool call inside a subagent.
6. **Record activity.** The dashboard shows routing reasons, confidence, latency, token usage, visible replies, tools, and subagent activity.

Low confidence, disagreement, an unavailable provider, a timeout, or an unreadable reply leaves Claude to continue without a tool hint. This is the mod's **fail-open** behavior.

`/jev routing off` disables every Jev consultation and switches to baseline mode. The dashboard remains available. With every feature disabled, Jev is also not called.

## Features

Change features in `/jev features` or with `/jev feature <id> on|off`.

| ID | Default | Behavior |
| --- | --- | --- |
| `tools` | On | Suggest the next tool when routing checks pass. |
| `participation` | Off | Let Jev decline tool and delegation hints for a turn. Model and effort planning can still apply. |
| `model` | Off | Select Haiku, Sonnet, or Opus for the main turn, subject to the model safeguards below. |
| `effort` | Off | Select an effort level where the target model and request support it. |
| `delegation` | Off | Suggest an offered subagent type. Claude decides whether to start it. |
| `agents` | Off | Plan model and effort for eligible subagents when Claude starts them. |

For example, enable main-turn model planning with:

```text
/jev feature model on
```

A model explicitly selected by the user is preserved until they return to the default. Provider-specific model IDs and extended-context models are also preserved. Subagent planning skips workflow-managed agents, forks, and agents with an explicitly requested model. Haiku does not receive an effort setting.

## Dashboard and visual language

Pingo is a dotted sphere with six expressions. The same projected geometry is rendered as **braille cells in the terminal** and **SVG circles on the desktop**. Color indicates state; exact confidence, latency, and usage remain readable as text.

| State | Meaning |
| --- | --- |
| Routing | Jev's tool suggestion passed the routing checks. |
| Thinking | A Jev request is in flight; the eyes spin and an orbit ring appears. |
| Passthrough | No tool hint was applied; Claude continues on its own. |
| Failing | A routing request failed or returned an unusable response. |
| Idle | No recent routing activity. |
| Baseline | Routing is switched off. |

**Overview** shows usage and routing totals. **Live** shows visible session events. **Agents** lists subagent state, model, effort, and activity; each agent has a numbered live pane and a distinct dotted mascot. **Flow** visualizes the main session and subagent work. **Features**, **Reasons**, **Baseline**, **Logs**, and **Setup** expose the controls and recorded metadata.

The dashboard, commands, activity feed, and Jev prompts support English and Brazilian Portuguese. Set **Language** to `en`, `pt`, or `auto` in `/jev setup`. `auto` follows the system locale.

See [DESIGN.md](DESIGN.md) for the visual system and [media notes](docs/media/README.md) for the README animations.

## Providers and configuration

These are the adapters and default model IDs configured in the code:

| Provider ID | Provider | Key environment variable | Default Jev model |
| --- | --- | --- | --- |
| `typesafe` | [TypeSafe](https://typesafe.ai/) | `TYPESAFE_API_KEY` | `jev-latest` |
| `openrouter` | [OpenRouter](https://openrouter.ai/blog/tutorials/how-to-use-jev/) | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` |
| `vercel` | [Vercel AI Gateway](https://vercel.com/ai-gateway/models/jev) | `AI_GATEWAY_API_KEY` | `typesafe-ai/jev` |
| `opencode` | [OpenCode Zen](https://opencode.ai/docs/en/zen/) | `OPENCODE_API_KEY` | `jev-1.13-free` |

Model availability is controlled by the provider. The OpenCode adapter also accepts `jev-1.13`; its setup check suggests that paid model if the free endpoint becomes unavailable.

Configure options through Setup or `/plugin configure jev@inline` when loaded with `--plugin-dir`:

| Option | Default | Purpose |
| --- | --- | --- |
| `provider` | `auto` | Choose `typesafe`, `openrouter`, `vercel`, or `opencode`. |
| `api_key` | Empty | Sensitive credential; otherwise use the chosen provider's environment variable. |
| `model` | Provider default | The **Jev** model ID, separate from the Claude model selected by turn planning. |
| `min_confidence` | `0.7` | Minimum confidence for choice answers; accepts 0–1. Falls back to `JEV_MIN_CONFIDENCE` when unset or invalid. |
| `timeout_ms` | `4000` | Budget for one Jev call, including its retry. Falls back to `JEV_TIMEOUT_MS` when unset; clamped to 500–30000 ms. |
| `locale` | `auto` | Interface and Jev prompt language: `auto`, `en`, or `pt`. |

A retryable HTTP status or network failure gets one retry inside the call's time budget. A timeout or unreadable response does not get another attempt. Large tool rosters can require two separate calls, each with its own budget.

<details>
<summary>Credential selection and storage</summary>

The explicit `provider` option takes precedence over `JEV_PROVIDER`. Under `auto`, Pingo uses the first provider with a key in the environment, in the table's order, or TypeSafe if none is set.

Set the provider to match the issuer of `api_key`. Pingo cannot infer the issuer from the key. With neither an explicit provider nor `JEV_PROVIDER`, the sensitive option is treated as a TypeSafe key. A provider auto-detected from its environment variable gets that variable's key, never a key saved for a different provider.

Setup tests a pasted key before saving it through Claude Code's sensitive `api_key` option. Keys are never written to Pingo's own state or store. The setup field is masked and shows only the last four characters after saving; `/jev status` reports the source without revealing the key. **Remove key** clears the saved option.

If the runtime cannot save the option, the validated key works for the current session and Setup explains how to save it with `/plugin configure jev@inline`. If only the provider option cannot be saved, Pingo keeps a provider fallback in its store until `provider` or `JEV_PROVIDER` changes.

**Test connection** sends a saved key only to its configured provider. Testing another provider uses that provider's environment key or asks for a new pasted key.

Older versions stored a plain-text key in plugin state. Current startup removes that legacy value; configure a replacement through the sensitive option or an environment variable.

Do not put keys in slash-command arguments, repository files, screenshots, or issue reports.

</details>

## Commands

| Command | Action |
| --- | --- |
| `/jev`, `/jev dashboard`, `/jev overview` | Open Overview. |
| `/jev live` | Open the live activity feed. |
| `/jev agents` | List subagents and their activity. |
| `/jev agent` | Open the newest running subagent, or the latest retained run. |
| `/jev agent <number, type, or mascot>` | Open a particular subagent's live pane, e.g. `/jev agent 3`. |
| `/jev agent <number, type, or mascot> remove` | Remove a finished run and close its pane. |
| `/jev agents clear` | Remove all finished runs; running agents stay. |
| `/jev flow` | Open the live session and subagent diagram. |
| `/jev features` | View and toggle the six routing features. |
| `/jev reasons` | Show why hints were not applied. |
| `/jev baseline` | Compare recorded request metrics with routing on and off. |
| `/jev logs`, `/jev log` | Browse request metadata. |
| `/jev setup [provider]` | Configure and test a provider; enter the key in the masked field. |
| `/jev status` | Show routing settings, features, and credential source. |
| `/jev routing on`, `/jev routing off` | Enable Jev consultations or switch to baseline. |
| `/jev feature <id> on`, `/jev feature <id> off` | Toggle a feature independently. |
| `/jev clear` | Clear request history, the live log, and finished subagents. |

Arguments are case-insensitive. Agent numbers are not reused within a session. The dashboard routing button and `r` shortcut also switch routing on and off.

## Data handling

When routing is enabled, a key is configured, and an applicable feature is on, Pingo sends requests over HTTPS to the **selected Jev provider**. That provider receives:

- Composed Claude Code system instructions, truncated to 4,000 characters.
- Recent prompts, visible replies, tool-call arguments, and tool results. Results can include source files, command output, web pages, and MCP responses. Each text or argument/result entry is truncated to 4,000 characters, retaining its head and tail; recent turns are kept within an approximate 60,000-character state budget.
- Available tool names and bounded descriptions, or parameter names when descriptions are absent. Large rosters are shortlisted before the final question.
- Enabled planning questions. Eligible subagent-planning calls instead contain the agent type, a task description capped at 400 characters, and a task prompt capped at 4,000 characters.

Truncation limits request size; it **does not redact secrets** from conversation or tool content. Only use routing for information you are allowed to share with that provider. `/jev routing off` stops every Jev request.

Pingo's views show observable activity and visible response text. They do not expose the models' private internal reasoning. The live feed stays in session memory; it may contain shortened prompts, tool details, response text, and provider errors.

The latest **500 request records** are persisted in the plugin store under the Claude Code configuration directory. Records contain timestamps, a short session ID, model names, routing reason codes, tool counts, Jev choices and confidence, applied changes, latency, and token usage. They do not contain conversation prompts, tool arguments or results, provider response bodies, or API keys. Provider failures are stored as `jev_error`, without the error body.

The store also retains the routing and feature switches, and a fallback provider selection when needed. `/jev clear` empties the request history and session feed.

## Development

```sh
claude plugin validate .
claude plugin test .
```

Tests run in Claude Code's plugin test runtime with stubbed provider responses; they do not need a real API key.

| Source | Responsibility |
| --- | --- |
| [`hooks/register.tsx`](hooks/register.tsx) | Session hooks, commands, model application, state, and UI integration. |
| [`hooks/core/decide.ts`](hooks/core/decide.ts) | Routing checks, shortlisting, and fail-open decisions. |
| [`hooks/core/plan.ts`](hooks/core/plan.ts) | Feature defaults and turn/subagent planning. |
| [`hooks/core/jev.ts`](hooks/core/jev.ts) | Provider adapters, response normalization, retries, and key validation. |
| [`hooks/config.ts`](hooks/config.ts) | Settings, credential selection, thresholds, and request limits. |
| [`hooks/input.ts`](hooks/input.ts), [`hooks/core/state.ts`](hooks/core/state.ts) | Transcript conversion and bounded provider context. |
| [`hooks/ui.tsx`](hooks/ui.tsx), [`hooks/flow.ts`](hooks/flow.ts) | Dashboard and Flow rendering. |
| [`hooks/mascots/`](hooks/mascots/) | Pingo, user, and subagent geometry. |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [SECURITY.md](SECURITY.md) for vulnerability reports.

## License

[MIT](LICENSE).
