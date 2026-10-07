# Jev for Claude Code

Jev is a Claude Code plugin that asks TypeSafe's Jev model for tool-routing suggestions and optional turn planning. It adds a dashboard for routing decisions, usage metadata, and subagent activity.

Jev provides a hint. Claude remains in control and can ignore it.

The dashboard header includes Pingo, Jev's dotted mascot. Its expression follows the current routing status.

## Requirements

- Claude Code 2.1.292 or newer.

## Install

Load the plugin for one session:

```sh
claude --plugin-dir /path/to/jev
```

To load it in every session, add the plugin directory to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/jev"
  }
}
```

On Windows, separate multiple plugin directories with semicolons.

## Configure credentials

Jev supports TypeSafe, OpenRouter, Vercel AI Gateway, and OpenCode.

From the dashboard:

1. Open `/jev setup` and pick the provider.
2. Paste the key in the **API key** field and press Enter (or **Test and save**, `v`). The field stays masked and shows only the final four characters after save.
3. Jev tests the key with that provider first. A key that works is saved through Claude Code's sensitive `api_key` plugin option, the provider through the `provider` option, and both are used for the current session. A refused key is neither saved nor used.

To change the key, paste a new one in the same field. **Remove key** (`f`) clears the saved option. If Claude Code does not let the mod write the option, the key still works for the session, and the message says to save it with `/plugin configure jev@inline` (set `api_key` and the matching `provider` there). If only the `provider` option cannot be written, the plugin keeps the choice in its own store as a fallback; that copy is dropped as soon as the `provider` option or `JEV_PROVIDER` changes, so a later change there always takes effect.

**Test connection** without a pasted key sends the saved `api_key` only to the provider it is configured for. Another provider is tested with its own environment variable instead, and is selected only if that does not hand it the saved key; otherwise paste that provider's key.

The `api_key` option is marked sensitive in the plugin manifest. Pasted keys stay in module memory while being tested and are saved through Claude Code's sensitive configuration; they never go into the plugin's own state or store. You can also provide a key through the matching environment variable:

| Provider | Environment variable | Default model |
| --- | --- | --- |
| [TypeSafe](https://api.typesafe.ai/redoc) | `TYPESAFE_API_KEY` | `jev-latest` |
| [OpenRouter](https://openrouter.ai/blog/tutorials/how-to-use-jev/) | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` |
| [Vercel AI Gateway](https://vercel.com/ai-gateway/models/jev) | `AI_GATEWAY_API_KEY` | `typesafe-ai/jev` |
| [OpenCode Zen](https://opencode.ai/docs/en/zen/) | `OPENCODE_API_KEY` | `jev-1.13-free` |

OpenCode's free Jev model is time-limited. If it becomes unavailable, the setup check explains how to choose the paid `jev-1.13` model.

The provider is the `provider` option (which Setup writes) when it is not `auto`, else `JEV_PROVIDER`, else under `auto` the first provider whose environment variable above is set, else TypeSafe. The `provider` setting must match the issuer of `api_key`; the plugin cannot infer the issuer from the key. Under `auto` (with `JEV_PROVIDER` unset), `api_key` is treated as a TypeSafe key; with `JEV_PROVIDER` set, it is treated as that provider's key. Either way, a provider picked because its environment variable is set gets that variable's key, never `api_key`. Do not put credentials in source files, issue reports, or `.env` files in this repository.

Two more options have environment fallbacks, used when the option is left empty:

| Option | Environment variable | Default | Range |
| --- | --- | --- | --- |
| `min_confidence` | `JEV_MIN_CONFIDENCE` | `0.7` | 0 to 1; a value outside it is ignored |
| `timeout_ms` | `JEV_TIMEOUT_MS` | `4000` | held between 500 and 30000 |

`timeout_ms` bounds each whole Jev call. A fast failure (a retryable status such as 503, or a network error) is retried once within that time; a timeout or an unreadable reply is not retried, and Claude decides alone.

Older versions saved a plain-text key in plugin state. The current version removes that legacy value when the plugin starts. Configure a replacement key using the sensitive option or an environment variable.

Use `/jev status` to see the selected provider and key source. It never displays the key or part of it.

## Language

The dashboard, setup messages, command output, activity feed, Flow view, and prompts sent to Jev support English and Brazilian Portuguese. Change **Language** in `/jev setup` (or `/plugin configure jev@inline`). It defaults to **auto**, which follows the system locale; choose `en` or `pt` to override it.

## Commands

| Command | Action |
| --- | --- |
| `/jev`, `/jev dashboard` or `/jev overview` | Open the dashboard on the Overview tab |
| `/jev live` | Open the live event view |
| `/jev agents` | List subagents and their activity |
| `/jev agents clear` | Remove every finished subagent from the Agents tab and close its pane; running ones stay |
| `/jev agent` | Open the live pane of the latest subagent: the newest running one, else the newest kept |
| `/jev agent <number>` | Open subagent `#<number>`'s live pane (`3` or `#3`) |
| `/jev agent <type or mascot>` | Open the latest subagent of that type (`explore`) or wearing that mascot (`tetra`) |
| `/jev agent <number, type or mascot> remove` | Remove that finished subagent from the Agents tab; a running one cannot be removed |
| `/jev flow` | Draw the latest subagent wave and any other running subagents as one live diagram: main session → agents → review → edits (tab `9`) |
| `/jev features` | View and toggle routing features |
| `/jev reasons` | See why requests were not routed |
| `/jev baseline` | Compare routing with baseline behavior |
| `/jev logs` or `/jev log` | Browse request metadata |
| `/jev setup [provider]` | Choose a provider (`typesafe`, `openrouter`, `vercel`, `opencode`) and test its connection; the key is never a command argument |
| `/jev status` | Show routing settings and the credential source |
| `/jev routing on\|off` | Enable routing or switch to baseline mode |
| `/jev feature <id> on\|off` | Toggle one feature: `tools`, `participation`, `model`, `effort`, `delegation` or `agents` |
| `/jev clear` | Clear the request history, the live log, and finished subagents |

Arguments are case-insensitive. Any other argument prints the usage line.

Subagents are numbered in the order they start, and a number is never reused within a session: after `/jev agents clear` or removing a run, the next subagent still gets a new number, so an older `/jev agent <number>` line never opens a different run.

The dashboard button and the `r` key also switch routing on and off.

## Features

- **Tool hints:** Jev suggests the next tool; Claude decides whether to use it.
- **Automatic participation:** Jev can skip tool and delegation hints for simple requests.
- **Model per turn:** Jev can select Haiku, Sonnet, or Opus for a turn.
- **Effort per turn:** Jev can select an effort level where the model supports it.
- **Subagent delegation:** Jev can suggest a subagent to Claude; only Claude starts it.
- **Subagent model and effort:** Jev can select a model and effort for a subagent Claude has started.
- **Flow view:** follow subagent work from the initial request through review and the main session's edits.

Each feature has an independent toggle. Tool hints are on by default; participation, model selection, effort selection, delegation, and subagent planning are off by default.

## Privacy and data handling

When routing is enabled and a key is configured, the selected provider is asked at the start of each turn (while any feature is on) and after each batch of main-loop tool calls (while Tool hints is on). Each of those requests carries:

- the composed Claude Code system instructions, cut to 4,000 characters;
- the conversation so far: your prompts, Claude's visible replies, **every tool call's arguments, and every tool result**. Tool results are whatever Claude read or ran: file contents, command output, search results, web pages, MCP responses. Each prompt, reply, argument set, and result is cut to 4,000 characters (head and tail kept), and the newest turns are kept within a budget of about 60,000 characters in all;
- the names and descriptions of every available tool.

When subagent model and effort planning is on, the provider is also asked as each subagent starts, with that subagent's type, its task description (cut to 400 characters), and its task prompt (cut to 4,000 characters).

Requests use HTTPS and send the API key in the authorization header. Do not enable routing for conversations, files, or command output you are not allowed to share with that provider; `/jev routing off` stops every request.

The Live and Flow views display observable requests, decisions, tool activity, visible response text, and a shortened view of the active request. They do not read or display the model's internal reasoning. The live log, including shortened provider error messages, is kept only in the session's memory.

The persisted request history (the latest 500 requests, in the plugin's own store under your Claude Code configuration directory) contains metadata: timestamps, a short session id, model names, tool counts, normalized routing reason codes, the hinted tool and its confidence, Jev's answer (`choice`: the tool or option the provider's response chose), what Jev changed for the request, latency, and token usage. A failed provider call is recorded only as the reason code `jev_error`; the provider's error text is not persisted. The history does not include conversation prompts, tool arguments, tool results, provider response bodies, or API keys. `/jev clear` empties it. The store also keeps your routing switch and feature switches, and a copy of the provider chosen in Setup only when Claude Code refused to save it as the `provider` option.

## Development and validation

Run these commands from the plugin directory:

```sh
claude plugin validate .
claude plugin test .
```

The tests use Claude Code's plugin test runtime and stub provider responses. They do not require a real API key.

See [DESIGN.md](./DESIGN.md) for the dashboard's visual system. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the change and commit workflow, and [SECURITY.md](./SECURITY.md) to report a vulnerability.

## License

MIT. See [LICENSE](./LICENSE).
