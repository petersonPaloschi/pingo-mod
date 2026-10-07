# Visual design

The dashboard uses dots for confidence, routing share, timelines, and mascots. Text carries the exact values and status labels; color reinforces state.

## Principles

1. **Use one visual unit.** Braille cells, meters, timelines, and mascot models all use dots.
2. **Use depth sparingly.** Near dots are brighter than distant dots. The same projection feeds terminal braille and desktop SVG.
3. **Use color for state.** Color marks routing, passthrough, failures, and speaker identity.
4. **Keep numbers readable.** Dots decorate confidence and routing share; the numeric values remain visible.
5. **Keep rendering deterministic.** Given the same state and time, each mascot produces the same frame.

## Palette

The palette is designed for a dark terminal.

| Token | Color | Use |
| --- | --- | --- |
| `ink` | `#e9ebef` | Values, headings, and near-side dots |
| `dim` | `#8d93a0` | Labels, notes, and passthrough text |
| `faint` | `#4a4f5a` | Empty dots and secondary notes |
| `route` | `#5ef0a8` | Routing and enabled features |
| `pass` | `#f2c14e` | Passthrough and warnings |
| `fail` | `#ff6b5e` | Failed requests and errors |
| `base` | `#8fa2ff` | Baseline mode |
| `you` | `#c9a7ff` | The user's entries in the live log |
| `claude` | `#d97757` | Claude's entries in the live log |

The palette and shared drawing functions live in `hooks/dots.ts`.

## Mascots

- **Pingo** represents Jev. Its dotted sphere and eyes change with six moods: routing, thinking (spinning eyes while a Jev request is in flight), passthrough, failing, idle, and baseline; the terminal draws braille and the desktop app draws SVG circles.
- **Dice** represents the user in the live log. Its cube of dots is drawn as braille in the terminal and as SVG circles on the desktop.
- **Tetra**, **Gem**, **Can**, **Coil**, and **Top** represent concurrent subagents. Each uses a different solid and color so their activity is easy to follow.
- Subagent mascots appear in the Agents tab, their live panes, and the band above the prompt.

The renderers live in `hooks/mascots/pingo.ts`, `hooks/mascots/dice.ts`, and `hooks/mascots/agents.ts`. Mascot frames use `$.ui.blit` while their pane is visible, one frame at a time; a refused or failed blit stops that animation until the pane renders again.

## Dashboard

- **Header:** Pingo, Jev's text status, confidence meter, routed-request rail, routing toggle, and tabs.
- **Overview:** request totals, token usage, routing results, and a request timeline.
- **Live:** visible events grouped by speaker. The feed does not display internal model reasoning.
- **Agents:** subagent state, model, effort, tool and request counts, and recent activity.
- **Flow:** a live diagram of the latest subagent wave, any other running subagents, its review stage, and the resulting edits.
- **Features:** independent switches with a short description of each feature.
- **Reasons, baseline, and log:** routing explanations, comparison metrics, and persisted request metadata.

## Terminal and desktop

The terminal uses braille rasters for dotted art and text for values. The desktop app uses SVG circles for the same mascot geometry. Other surfaces show the status text and available controls. Runtime text is available in English and Brazilian Portuguese; locale-specific strings live in `hooks/strings/en.ts` and `hooks/strings/pt.ts`.
