# Visual design

The dashboard is built of framed cards, colored pills and block bars; text carries exact values, identity, duration, and observed consumption. The terminal and desktop use the same state and layout.

## Principles

1. Build every screen of the dashboard from the same parts: cards with a title, pills for states and identities, block bars for shares.
2. Keep values, settings and scope readable; use fewer columns before shortening a label. Confidence and activity are not quality or savings.
3. Use color for state and speaker identity, alongside a readable name and status.
4. Keep rendering deterministic and update on observable events.
5. Avoid animation frame scheduling for the user, workers, or execution graph.

## Palette

| Token | Color | Use |
| --- | --- | --- |
| `ink` | `#e9ebef` | Values and headings |
| `dim` | `#8d93a0` | Labels and passthrough |
| empty dots | `#4a4f5a` | Empty graph cells |
| secondary text | `#929baa` | Help text and notes |
| borders | `#596273` | Neutral card frames and rules |
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

Claude Code owns the pane's scroll window. The dashboard and agent panes render their full content at its natural height, so the wheel, trackpad, arrows and page keys can reach every row. The header scrolls with the content. Changing tabs or opening/closing flow details returns the pane to the top; no plugin scroll hook consumes the host's events.

- **Rail:** from 120 columns, a framed rail runs down the left of the pane in Pingo's mood color: the name, the eight screens (the open one marked ▸, number keys 1–8), the routing switch, then Pingo, its state as a pill and a sentence, and the last five minutes (calls, latency, input tokens, failures in red). Navigation appears first, before the content that needs scrolling. Under 120 columns the same parts sit in a framed bar on top, with the screens side by side, so the screen keeps the whole width. The rail is 26 columns wide; plain navigation buttons reserve their label and hotkey columns.
- **Title:** each screen opens with its name in the mood color, a readable description on its own line, and a subtle rule. Every screen is drawn and measured at the width it gets beside the rail. Cards wrap their headings, keep secondary text legible, and leave a row between groups.
- **Overview:** the range picker leads, with the number of requests it covers, because it scopes every figure below; the rail's figures keep their own five-minute window. The status sentence appears only when it adds something the rail lacks. Then cards, two to a row from 93 columns: **Routing** (a bar of solid blocks split by outcome, its legend, and its figures as a table), **Jev's answers** and **Token usage** (framed red when a figure flags a failure), and **Timeline** across the whole width: a sparkline of reported request tokens per slot of time, colored by each slot's worst outcome. A range with no requests shows one framed line in place of a wall of zeros.
- **Live:** a row of pills (Jev and its state, the main model, each subagent at work in its mascot's color), the current activity, the session's Jev tally, then the latest run as a card (its nodes as a chain, the latest details, the timing) and the live log under a titled rule. The full run details take the whole pane width, without the rail, because the drawn run needs every column.
- **Models:** the main model as a pill in a card, the latest run's requests one row each (a change of model marked ▲ in yellow), and Jev's usage by model, one counter to a line. No forecast or observational comparison is presented as a benefit.
- **Agents:** one card per subagent, two to a row where they fit, framed in its mascot's color while it runs: its name on its color, its state, task, model, activity or answer, counts and live-pane actions.
- **Logs:** a card of reason groups, each with a bar as long as its share of the largest, then the request log, newest first: the time in its own column, then the outcome on a colored ground with what happened and how long it took, its figures faint under that, and why under them. A blank row closes each request.
- **Configuration:** provider and language (with the three steps of the key, each numbered on a colored ground and checked when done), and history. Cards stack below 101 content columns; help text wraps instead of disappearing.
- **Resources:** feature switches in one or two columns, each at least 32 columns wide when paired, with a full short description. Preferences are grouped into replies, mascot, workspace and learning, and monitoring. Preference cards need 38 columns each before sitting side by side.
- **Deck:** appearance, visible sections, alerts, weather, panel actions and current status each have their own card. Cards need 38 columns each before sitting side by side. Terminal switches use compact controls without padded brackets; long labels and values are separated, and status messages wrap.

Request scopes and whole-task scopes are labeled separately. Main completion and background completion use elapsed wall time. Unknown values stay unknown, partial consumption stays partial, and estimates identify their basis. A checkpoint requested is not a successful verification.

## Navigation

The order is Overview, Live, Models, Agents, Logs, Configuration, Deck, Resources. Each screen is a harmless Button addressed by `tab-<id>` with its number as the hotkey; the open one is bright and marked ▸, the others dim. Short terminal panes use a compact header so navigation leaves room for the scrollable content. The top-bar mascot uses 12×5 cells, or 8×4 below 60 columns; the rail uses 18×8.

Persisted retired tabs map to a valid consolidated screen. Useful former commands open that screen. Removed screen components and feature switches are not retained.

## Live log

Speaker names and colors identify authors; no rotating faces are needed. Dense visible messages and bounded details keep the feed readable. Time and details are faint secondary text. The feed does not display private model reasoning.

## Terminal and desktop

The terminal uses braille for Pingo and dot meters; desktop uses SVG when appropriate. Both expose the same controls and readable states. English and Brazilian Portuguese strings live in `hooks/strings/en.ts` and `hooks/strings/pt.ts`. Graphs and shared layout utilities remain independent of removed mascot renderers.

## Deck

The Deck band above the prompt keeps its own visual language: its own state and tier colors, six bar styles, three collapsed looks, a pet, and a progress row for each plan, task, agent, context and limit. The palette, one-visual-unit and tab rules above describe the Jev dashboard; they do not apply inside the band.

Motion is the one deliberate exception to the animation rule. The pet, the open and close fold, and the demo move on purpose. Desktop motion is CSS and SVG animation only, with no script timers. Terminal frames are a pure function of act, time and facing, so a repaint needs no stored animation state. The terminal pet is one Raster as wide as the band, repainted in place by a 100 ms loop that runs only while a band is on screen and asks for no redraw. The terminal rows' own motion redraws the UI about every 300 ms, every 600 ms while the dashboard is open; desktop rows and pet move by CSS and ask for a redraw only when a scene changes. A hidden or idle Deck requests no frames. The dashboard's own Pingo has no timer. On the desktop it is one still SVG per mood whose breathing, bob, blink, shake and orbit highlight are CSS, so its source never changes between redraws. In the terminal it is drawn when the pane is, and no timer repaints it.

The Pingo mascot is the pet's body. The Deck draws the scene around it: the desk, the alert badge, confetti, sleep marks and dust.
