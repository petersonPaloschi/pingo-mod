# Visual design

Pingo has one visual identity across every surface it draws: the `/jev` dashboard, the Deck band above the prompt, the status lines above it, the agent panes, the Deck's panel and style picker, and the pet. The dashboard is a trail: Pingo's mood face and status at the top, the screen names on one line, then nodes down a vertical line. A node has a marker, a title and its body; text carries exact values, identity, duration, and observed consumption. Shares use filled and empty half-dot meters, with exact counts beside them. The terminal and desktop use the same state and layout.

## Principles

1. Build every screen as a trail of nodes: each node has a marker, a title and a body indented beside the vertical line. Nodes are unframed; the raw-response excerpt in Logs remains framed pending a separate review.
2. Keep values, settings and scope readable; use fewer columns before shortening a label. A label too long for its column wraps; it is not cut. Confidence and activity are not quality or savings.
3. Never tell a state by color alone: every state has a glyph (✓ ! × ? ◉ ◌ ● ○ ◐ →) and a word, and the color repeats it.
4. Text follows the person's theme: content, labels and rules paint with theme keys, so they hold on light and dark terminals and in color-blind themes. Raw hex is only for fills, glyph accents, Raster cells and SVG.
5. Keep rendering deterministic and update on observable events.
6. Avoid animation frame scheduling for the user, workers, or execution graph.

## Tokens

Shared colors, glyphs and meters come from `hooks/theme.ts`; `hooks/dots.ts` (`DOT`, numbers for Raster cells) and `hooks/deck/theme.ts` (the Deck's state and tier styles) derive from it. The Deck's animated head and shine use the dedicated `DECK_ACCENT` fills, and the pet keeps its cosmetic hat and prop palette local.

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| text | `PAINT.text` | theme key `text` | Values and headings |
| muted | `PAINT.muted` | theme key `inactive` | Labels, notes, help |
| rule | `PAINT.rule` | theme key `subtle` | Rules, tracks, leaders; never the only place a fact is written |
| ok, warn, fail | `PAINT.ok`, `PAINT.warn`, `PAINT.fail` | theme keys `success`, `warning`, `error` | State text, always with a glyph |
| claude | `PAINT.claude` | theme key `claude` | The main model |
| brand | `HUE.brand` | `#7e9a1f` | Pingo's accent, the current node, work in progress, the haiku tier |
| ok | `HUE.ok` | `#3d9a6e` | Routing and completion |
| warn | `HUE.warn` | `#c07f1c` | Passthrough, a question, a limit filling up |
| fail | `HUE.fail` | `#d9577d` | Failures |
| info | `HUE.info` | `#8b7fd6` | Planning off; the sonnet tier |
| you | `HUE.you` | `#4a90c2` | The person in the live log |
| plum | `HUE.plum` | `#b562a8` | The opus tier |
| neutral | `HUE.neutral` | `#8a8577` | Idle and empty |
| on fill | `PAINT.onFill` | `#14110f` | Text on a hue (pills, filled bars) |
| SVG on fill | `SVG_PAINT.onFill` | `#ffffff` | Text and glyphs on desktop SVG fills |

Each hue keeps at least 3:1 against `#1e1e1e` and against `#ffffff`, and `#14110f` on any of them keeps at least 4.7:1. Shared drawing and layout utilities live in `hooks/dots.ts`, `hooks/layout.ts` and `hooks/theme.ts`; `dotMeter` draws filled and empty half-dots so near shares still differ.

## Identity

Pingo is a simple status indicator. The user is identified by a readable label and color. Workers have stable numbers, names, colors, and state labels in Agents, individual panes, and the band above the prompt. Dice and solid worker renderers have been removed.

## Dashboard

Claude Code owns the pane's scroll window. The dashboard and agent panes render their full content at its natural height, so the wheel, trackpad, arrows and page keys can reach every row. The header scrolls with the content. Changing tabs or opening/closing flow details returns the pane to the top; no plugin scroll hook consumes the host's events.

- **Header:** at every width, Pingo's mood face and beside it `jev`, its state as a glyph and word, and the routing switch. Below, plain text says what is going on and gives the last five minutes (calls, latency, input tokens, failures in red with "!"). A short terminal pane keeps one header line. The eight screen names follow on one line, separated by slashes; the open one is marked ◉ and underlined in the brand color.
- **Title:** the open screen's name in the brand color and, beside it, what the screen is for.
- **Nodes:** a glyph and title sit above the body; a vertical line continues past the body toward the next node. Items inside a node can still sit side by side when they fit.
- **Overview:** the range picker leads, with the number of requests it covers. **Routing** lists each outcome on its own line (glyph and name, then its dot meter, count and share), then its figures; **Jev's answers** and **Token usage** are label, dotted leaders, value and note; **Timeline** is a sparkline of reported tokens per slot, with × marked under a slot whose request failed. A range with no requests shows one hollow-glyph line.
- **Live:** the run switch, the row of pills (Jev and its state, the main model, each subagent in its mascot's color), the current activity, the session's Jev tally, the latest run and live log as trail nodes.
- **Models, Logs, Configuration, Resources, Deck:** the same trail nodes. The Deck screen's switches sit one to a line, without blank rows between them.
- **Agents:** one node per subagent, titled with its type and number, its marker and line in its mascot's color while it runs and red after an error.

Request scopes and whole-task scopes are labeled separately. Main completion and background completion use elapsed wall time. Unknown values stay unknown, partial consumption stays partial, and estimates identify their basis. A checkpoint requested is not a successful verification.

## Navigation

The order is Overview, Live, Models, Agents, Logs, Configuration, Deck, Resources. Each screen is a harmless Button addressed by `tab-<id>` with its number as the hotkey; slashes divide the names, the open one is marked ◉ and underlined, the others dim. Short terminal panes use a compact header so navigation leaves room for the scrollable content.

Persisted retired tabs map to a valid consolidated screen. Useful former commands open that screen. Removed screen components and feature switches are not retained.

## Live log

Speaker names and colors identify authors; no rotating faces are needed. Dense visible messages and bounded details keep the feed readable. Time and details are faint secondary text. The feed does not display private model reasoning.

## Terminal and desktop

The dashboard uses Pingo's mood face on both surfaces. The Deck pet remains a Raster in the terminal and SVG on desktop. Dot meters show shares in the dashboard; the Deck keeps its six selectable bar styles. Both surfaces expose the same controls and readable states. English and Brazilian Portuguese strings live in `hooks/strings/en.ts` and `hooks/strings/pt.ts`. Graphs and shared layout utilities remain independent of the pet renderers.

## Deck

The Deck band above the prompt speaks the same language as the dashboard: the same hues and theme keys, and a glyph for every row, so a plan (☰), an agent's activity (◇), the context (◫), a limit (◔ ◑), the route (⇄), a question (?), a failure (!) and a finished plan (✓) never share one dot. Expanded, the header is the toggle, the row count, a rule, then the clock and weather; each row is its glyph, its title, its share as a fixed four-column value next to its bar, the bar in the chosen style, what remains of its right-hand value (a reset time, a rate), and the ✕. A plan's agents hang under it as branches (╰) with their state glyph, task, model on its tier's ground, and elapsed time. The six bar styles, the three collapsed looks, the sizes and the pet lane are all kept; the collapsed looks use the same row glyphs.

The lines above the Deck (the Jev status lines and each feature's line) begin with Pingo's mood face or `◆` in the brand color, use "!" for alerts, and have no frames.

Motion is the one deliberate exception to the animation rule. The Deck pet, the open and close fold, and the demo move on purpose. Desktop motion is CSS and SVG animation only, with no script timers. Terminal frames are a pure function of act, time and facing, so a repaint needs no stored animation state. The terminal pet is one Raster as wide as the band, repainted in place by a 100 ms loop that runs only while a band is on screen and asks for no redraw. The terminal rows' own motion redraws the UI about every 300 ms, every 600 ms while the dashboard is open; desktop rows and pet move by CSS and ask for a redraw only when a scene changes. A hidden or idle Deck requests no frames. The dashboard's Pingo is a still face and has no timer.

The Pingo mascot is the pet's body. The Deck draws the scene around it: the desk, the alert badge, confetti, sleep marks and dust.
