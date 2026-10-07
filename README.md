# Jev for Claude Code

Jev is a Claude Code plugin that asks TypeSafe's Jev model for tool-routing suggestions and optional turn planning. It adds a dashboard for routing decisions, usage metadata, and subagent activity.

Jev provides a hint. Claude remains in control and can ignore it.

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
3. Jev tests the key with that provider first. A key that works is saved through Claude Code's sensitive `api_key` plugin option and used for the current session. A refused key is neither saved nor used.

To change the key, paste a new one in the same field. **Remove key** (`f`) clears the saved option. If Claude Code does not let the mod write the option, the key still works for the session, and the message says to save it with `/plugin configure jev@inline` (set `api_key` and the matching `provider` there).

The `api_key` option is marked sensitive in the plugin manifest. Pasted keys stay in module memory while being tested and are saved through Claude Code's sensitive configuration; they never go into the plugin's own state or store. You can also provide a key through the matching environment variable:

| Provider | Environment variable | Default model |
| --- | --- | --- |
| [TypeSafe](https://api.typesafe.ai/redoc) | `TYPESAFE_API_KEY` | `jev-latest` |
| [OpenRouter](https://openrouter.ai/blog/tutorials/how-to-use-jev/) | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` |
| [Vercel AI Gateway](https://vercel.com/ai-gateway/models/jev) | `AI_GATEWAY_API_KEY` | `typesafe-ai/jev` |
| [OpenCode Zen](https://opencode.ai/docs/en/zen/) | `OPENCODE_API_KEY` | `jev-1.13-free` |

OpenCode's free Jev model is time-limited. If it becomes unavailable, the setup check explains how to choose the paid `jev-1.13` model.

Set `JEV_PROVIDER` to select a provider when needed. The `provider` setting must match the issuer of `api_key`; the plugin cannot infer the issuer from the key. Do not put credentials in source files, issue reports, or `.env` files in this repository.

Older versions saved a plain-text key in plugin state. The current version removes that legacy value when the plugin starts. Configure a replacement key using the sensitive option or an environment variable.

Use `/jev status` to see the selected provider and key source. It never displays the key or part of it.

## Commands

| Command | Action |
| --- | --- |
| `/jev` or `/jev dashboard` | Open the dashboard |
| `/jev live` | Open the live event view |
| `/jev agents` | List subagents and their activity |
| `/jev agent <number>` | Open a subagent's live pane |
| `/jev flow` | Draw the latest wave of subagents as one diagram: main session → each subagent → back → you confirm → edits (tab `9`) |
| `/jev features` | View and toggle routing features |
| `/jev reasons` | See why requests were not routed |
| `/jev baseline` | Compare routing with baseline behavior |
| `/jev logs` | Browse request metadata |
| `/jev setup [provider]` | Choose a provider and test its connection |
| `/jev status` | Show routing settings and the credential source |
| `/jev routing on|off` | Enable routing or switch to baseline mode |
| `/jev feature <id> on|off` | Toggle one feature |
| `/jev clear` | Clear the local history |

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

When routing is enabled and a key is configured, the selected provider receives the composed Claude instructions, recent conversation messages, available tool names and descriptions, and—when subagent planning is enabled—the relevant subagent task details. Requests use HTTPS and send the API key in the authorization header. Do not enable routing for conversations you are not allowed to share with that provider.

The Live and Flow views display observable requests, decisions, tool activity, visible response text, and a shortened view of the active request. They do not read or display the model's internal reasoning.

The persisted request history contains metadata such as timestamps, model names, tool counts, normalized routing reason codes, latency, and token usage. It does not include conversation prompts, tool arguments, provider error bodies, or API keys.

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
