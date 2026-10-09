# Visual design

Dots reinforce state; text carries exact values, identity, duration, and observed consumption. The terminal and desktop use the same state and layout.

## Principles

1. Use one visual unit for meters, timelines, and the simple Pingo.
2. Keep values and scope readable; confidence and activity are not quality or savings.
3. Use color for state and speaker identity, alongside a readable name and status.
4. Keep rendering deterministic and update on observable events.
5. Avoid animation frame scheduling for the user, workers, or execution graph.

## Palette

| Token | Color | Use |
| --- | --- | --- |
| `ink` | `#e9ebef` | Values and headings |
| `dim` | `#8d93a0` | Labels and passthrough |
| `faint` | `#4a4f5a` | Empty dots and notes |
| `route` | `#5ef0a8` | Enabled planning and accepted choices |
| `pass` | `#f2c14e` | Passthrough and warnings |
| `fail` | `#ff6b5e` | Failures and errors |
| `base` | `#8fa2ff` | Planning disabled |
| `you` | `#c9a7ff` | User entries |
| `claude` | `#d97757` | Claude entries |

Shared drawing and layout utilities live in `hooks/dots.ts` and `hooks/layout.ts`.

## Identity

Pingo is a simple status indicator. The user is identified by a readable label and color. Workers have stable numbers, names, colors, and state labels in Agents, individual panes, and the band above the prompt. Dice and solid worker renderers have been removed.

## Dashboard

- **Header:** Pingo, Jev status, observed call count, latency, reported input usage and failures, routing switch, and the tab bar. Its consultation figures use the last five minutes of retained observations.
- **Overview:** the range picker leads, with the number of requests it covers, because it scopes every figure below. The header's meters keep their own five-minute window. The status sentence appears only when it adds something the header lacks: why Jev is failing or passing, when it last ran, or that routing is off. The provider line follows. The figures come in titled groups. **Routing** has the request totals and the outcome strip with a one-row legend. **Jev's answers** has calls, latency and confidence; failed calls show in red. **Token usage** has LLM and Jev tokens. **Timeline** has the request constellation. A range with no requests shows one line in place of a wall of zeros.
- **Live:** visible speaker activity and the execution graph. The graph preserves sequence, tools and sources, worker branches, duration, advisor observations, edits, and results. It updates from events without a pulse loop. Terminal defaults to a compact sequence and keeps space for complete Jev question/answer cards. An expand/back control makes the full diagram scrollable in Live; desktop can show it in the normal document flow.
- **Models:** actual main and worker model/effort observations and changes. No forecast or observational comparison is presented as a benefit.
- **Agents:** worker identity, state, actual model/effort, request/tool counts, and live-pane actions.
- **Logs:** request metadata, error causes, reason filtering/grouping, timing, and reported consumption.
- **Configuration:** provider setup, credential controls, language, routing, and eligible worker planning.

Request scopes and whole-task scopes are labeled separately. Main completion and background completion use elapsed wall time. Unknown values stay unknown, partial consumption stays partial, and estimates identify their basis. A checkpoint requested is not a successful verification.

## Tab bar

The order is Overview, Live, Models, Agents, Logs, Configuration. Labels have no numerical hotkey prefixes. The active tab is bracketed and bright; it remains a harmless Button addressed by `tab-<id>`. The row wraps on narrow panes and a thin rule closes the header.

Persisted retired tabs map to a valid consolidated screen. Useful former commands open that screen. Removed screen components and feature switches are not retained.

## Live log

Speaker names and colors identify authors; no rotating faces are needed. Dense visible messages and bounded details keep the feed readable. Time and details are faint secondary text. The feed does not display private model reasoning.

## Terminal and desktop

The terminal uses braille for Pingo and dot meters; desktop uses SVG when appropriate. Both expose the same controls and readable states. English and Brazilian Portuguese strings live in `hooks/strings/en.ts` and `hooks/strings/pt.ts`. Graphs and shared layout utilities remain independent of removed mascot renderers.

## Deck

The Deck band above the prompt keeps its own visual language: its own state and tier colors, six bar styles, three collapsed looks, a pet, and a progress row for each plan, task, agent, context and limit. The palette, one-visual-unit and tab rules above describe the Jev dashboard; they do not apply inside the band.

Motion is the one deliberate exception to the animation rule. The pet, the open and close fold, and the demo move on purpose. Desktop motion is CSS and SVG animation only, with no script timers. Terminal frames are a pure function of act, time and facing, so a repaint needs no stored animation state. The terminal pet is one Raster as wide as the band, repainted in place by a 150 ms loop that runs only while a band is on screen and asks for no redraw. The terminal rows' own motion redraws the UI every other frame, every fourth while the dashboard is open; desktop rows and pet move by CSS and ask for a redraw only when a scene changes. A hidden or idle Deck requests no frames. The dashboard's own Pingo keeps one frame a second and no timer.

The Pingo mascot is the pet's body. The Deck draws the scene around it: the desk, the alert badge, confetti, sleep marks and dust.
