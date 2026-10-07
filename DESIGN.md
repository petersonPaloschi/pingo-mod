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

- **Header:** Pingo, Jev's text status, confidence meter, routed-request rail, routing toggle, and the tab bar.
- **Overview:** request totals, token usage, routing results, and a request timeline.
- **Live:** visible events, one row per event, each with its speaker. The feed does not display internal model reasoning. See Tab bar and Live log below.
- **Models:** the model and effort running now, what blocks or allows a model change at the next prompt and the confidence each model needs, what each function (participation, tool hint, model, effort, delegation) decided at each prompt and why, and the latest subagents.
- **Agents:** subagent state, model, effort, tool and request counts, and recent activity.
- **Flow:** the latest run as observed, on one trunk: message, Jev, main loop, then tools, subagents and advisor calls as branches in the order they first happened, then the answer and its edits; earlier runs listed under it. No sample is drawn: an empty record says so. While the tab shows and a run is at work, a pulse runs down the trunk into the node at work (Jev asked, a tool running, a response on its way, subagents, the answer awaited) at 10 frames a second, one frame at a time; it stops when the run is done or the pane is not drawn. It stays text: a frame of a heavy run measured about 3 ms to lay out, so a Raster was not added. `/jev status` reports the measured redraw cost.
- **Features:** independent switches with a short description of each feature.
- **Reasons, baseline, and log:** routing explanations, comparison metrics, and persisted request metadata.

## Tab bar

- One row of labels, in the order Overview, Live, Models, Agents, Flow, Features, Reasons, Baseline, Log, Setup: what is happening first, controls and records after.
- No numbers or hotkey prefixes. The terminal's plain Button draws `N: label` for any hotkey, so tabs carry none; a tab changes by click.
- The open tab is bracketed and bright (`❮ Models ❯`); the others are dim labels. The open tab stays a Button, so pressing it is harmless and tests can address every tab by key (`tab-<id>`).
- A thin rule closes the header. The row wraps on a narrow pane instead of clipping.

## Live log

- Every row shows its speaker in two fixed-width boxes: face (6 columns) and name (7). Fixed boxes keep names in one column; padding spaces inside one Text is trimmed and breaks the alignment.
- Claude has no icon. Its name sits in the icon column, at the left edge, aligned with the faces of Jev and You. Glyphs that fonts draw wider than a cell (`✻`) are not used.
- No time column. The time is faint, on the line under the text, joined with the detail (`╰ 01:21:01 PM · detail`); a one-row bookkeeping event ends with it.
- Dense by default: Jev's and Claude's own words take at most two rows, details at most three, and no blank rows separate speakers.

## Terminal and desktop

The terminal uses braille rasters for dotted art and text for values. The desktop app uses SVG circles for the same mascot geometry. Other surfaces show the status text and available controls. Runtime text is available in English and Brazilian Portuguese; locale-specific strings live in `hooks/strings/en.ts` and `hooks/strings/pt.ts`.
