# Trilha

Trilha ("trail") is how Pingo looks everywhere it draws: the `/jev` dashboard, the agent panes, the lines above the
prompt, the Deck band, the Deck's panel and style picker, and the pet. Everything Pingo has to say hangs off one
vertical line as a sequence of nodes, with air between them. A reader scans down the line, stops at a dot, and reads
a short title and a few plain lines under it.

```
(^‿^)  jev · ✓ Routing   r: Turn Jev off
       Jev decided 2 of the last 3 requests (5 min).
       Last 5 minutes: 3 Jev calls · 420 ms average · 0 Jev failures

◉ Overview / Live / Models / Agents / Logs / Configuration / Deck / Resources

Overview
what Jev did in the range you pick

● Routing
│  ● hint — Jev's pick suggested to Claude
│    ●●●●●●◐○○○  2 · 67%
│  ○ passthrough — Claude decided
│    ●●●◐○○○○○○  1 · 33%
│
● Jev's answers
│  Jev calls        3  none failed
│  Jev latency 420 ms  p95 420 ms
│
```

## Five rules

1. **One line, many nodes.** A screen is a column of nodes. A node is a dot, a bold title, and a body three columns in,
   with the trail's line beside the body and one more row of line under it to reach the next node. Nothing is boxed;
   the only frame left is the quoted raw reply in Logs.
2. **A glyph before a color.** Every state has its own glyph and a word. Color repeats what the glyph says, so the
   screen still reads in a monochrome terminal or for a color-blind person.
3. **Text follows the person's theme.** Words are painted with Claude Code theme keys, which the host resolves for a
   light, dark or color-blind theme. Hex colors appear only on dots, meters, pills, Raster cells and SVG.
4. **Room before cuts.** Use fewer columns before shortening a label. Long labels wrap; they are not cut. A narrow pane
   stacks what a wide one puts side by side.
5. **Say what was observed.** Values are exact, unknowns stay unknown, partial data says it is partial, and an
   estimate names its basis. Confidence and activity are never presented as quality or savings.

## Palette

All tokens live in `hooks/theme.ts`. `hooks/dots.ts` (`DOT`, numbers for Raster cells) and `hooks/deck/theme.ts` (the
Deck's state, tier and track styles) derive from it; nothing else picks its own color.

**Hues** (`HUE`). Each is a mid-tone that keeps at least 3:1 against `#1e1e1e` and against `#ffffff`; text on any of
them uses `PAINT.onFill` (`#14110f`), which keeps at least 4.7:1. `tests/theme.test.tsx` checks both.

| Hue | Value | Says |
| --- | --- | --- |
| lime `brand` | `#7e9a1f` | Pingo itself, the node happening now, work in progress, the haiku tier |
| jade `ok` | `#3d9a6e` | Routed, done |
| amber `warn` | `#c07f1c` | Passthrough, a question, a limit filling up |
| rose `fail` | `#d9577d` | A failure |
| lavender `info` | `#8b7fd6` | Planning off, Pingo asleep, the sonnet tier |
| sky `you` | `#4a90c2` | The person, in the live log |
| plum `plum` | `#b562a8` | The opus tier |
| stone `neutral` | `#8a8577` | Idle, empty, nothing to act on |
| `claude` | `#d97757` | The main model |

**Text roles** (`PAINT`): `text` for values and titles, `muted` (theme key `inactive`) for labels and notes, `rule`
(`subtle`) for the trail's line, tracks and separators, and `success`, `warning`, `error`, `claude` for state words.
The line and tracks are decoration: no fact is written only there.

**SVG** (`SVG_PAINT`): an SVG cannot name a theme key, so desktop drawings use `muted` (stone) for text and empty
tracks, and `onFill` (white, at least 3:1 on every hue) for text on a hue.

**Deck motion** (`DECK_ACCENT`): a darker lime head (`#5d7216`) and a light lime shine (`#b3c96a`) for the moving
bars; never used for text.

## Glyphs

| Glyph | Meaning |
| --- | --- |
| `●` | A node on the trail; a filled dot of a meter; something on |
| `○` | A node with nothing yet; an empty dot; something off |
| `◐` | Half a dot of a meter |
| `◉` | The current node: the open screen, the step running now, a running agent, the chosen option |
| `│` | The trail's line |
| `╰─` | A child hanging off its parent: an agent under its plan, the reason under a request |
| `/` | Between the screens' names |
| `✓` `!` `×` `?` | Done, needs attention, failed, waiting on a question |
| `◔` `◑` | A limit's fill on a Deck row |
| `→` | The route, a next step |
| `◌` `–` | Pingo asleep, idle |

Pingo's moods have faces, kept in `hooks/mascots/pingo.ts`: `(^‿^)` routing, `(◌_◌)` thinking, `( •_•)`
passthrough, `(×_×)` failing, `(–_–)` idle, `(-_-)ᶻ` baseline.

## Meters

A share is a meter of ten dots filled by halves (`dotMeter`), the exact count and percentage always written beside
it: `●●●●◐○○○○○  4 · 45%`. The dots are for scanning; the number carries precision, so two close shares that look the
same as dots still differ in text. The Overview timeline keeps its sparkline of tokens per slot, with `×` under a
slot whose request failed.

## Surfaces

### The `/jev` dashboard

- **Header.** Pingo's face in its mood's color, then `jev`, the state's glyph and word in bold, and the routing switch.
  Under them, lined up past the face, the status in a plain sentence and the last five minutes (calls, latency, input
  tokens, failures; failures above zero are red and marked `!`). A blank row, then the eight screens.
- **Screens.** One line, slashes between names, wrapping where narrow. The open one is `◉`, bold, underlined and lime;
  the rest are dim. Each is a Button `tab-<id>` with its number as the hotkey, in this order: Overview, Live, Models,
  Agents, Logs, Configuration, Deck, Resources. A terminal pane under 24 rows keeps only the first header line and the
  screens.
- **Title.** The screen's name in lime, and under it what the screen is for.
- **Overview.** The range picker and how many requests it covers, then the nodes Routing (each outcome with its
  glyph, meter, count and share, then the figures), Jev's answers, Token usage (label, value, note in aligned columns)
  and Timeline. A range with nothing in it shows one hollow-dot line.
- **Live.** The switch to the full run, the pills (Jev's face and state, the main model, each subagent in its
  mascot's color), what Claude is doing now marked `◉`, the session's Jev tally, the latest run as a node, then the
  live log under its own `◉` heading.
- **Models, Logs, Configuration, Resources, Deck.** The same nodes. Logs puts each request's outcome glyph in its
  color, its figures muted, and its reason hanging under it with `╰`. Setup steps are `✓` once done or `○` with their
  number. Small items inside a node (feature switches, reason groups, the three orchestration roles) may still sit
  side by side when the width allows.
- **Agents.** One node per subagent, newest running first. Its dot is its state glyph; while it runs, the dot, line
  and title take its mascot's color, and after an error they turn red.

### Agent panes

An agent's own pane opens with the same node as on the Agents screen: its mascot pill, state, task, model and
figures, and the buttons back to Jev and to close. Its task and requests follow, then its own lines of the live log.

### Lines above the Deck

Each line starts with a lime `●` (sessions, Lapida, Semente, Vigia, Farol, Clareza) or, for Jev's own status, Pingo's
face in its mood's color. Jev's second line is the main model's dot, what Claude is doing, and a dot per running
subagent in its color. Alerts use `!`. No frames.

### The Deck band

Expanded, the head of the trail is the toggle, the row count, and the clock and weather at the far end. Each row is
its node (its state: `●` at work, `?`, `!`, `✓`, `◔` `◑` for a limit, `→` for the route), its title, the bar in the
chosen style, its share right after the bar, what is left of its right-hand value (a reset time, a rate), and `✕`.
A plan's agents hang under it with `╰─`, their state glyph, task, model pill on its tier's hue, and elapsed time.

Every option stays: the six bar styles (solid is the terminal default, pixel the desktop one), the three collapsed
looks (chips, text, rings), the sizes, the pet lane, and the style picker, whose chosen style is marked `◉ now`.

### Pingo

On the dashboard Pingo is its face, a still Text in the mood's color, the same on the terminal and the desktop. In
the Deck it stays the animated braille sphere, its eyes in the mood's color. Hats keep their own colors and never a
mood's: the party hat is plum and the wizard hat sky; the others keep their natural colors. The Deck draws the scene
around the pet: the desk, the alert badge, confetti, sleep marks and dust.

## Behavior the look must keep

- Claude Code owns the pane's scroll window. The dashboard and agent panes draw their whole content at its natural
  height, so the wheel, trackpad, arrows and page keys reach every row; the header scrolls with it. Changing screens
  or opening the run details returns to the top. No plugin scroll hook takes the host's events.
- Request scopes and whole-task scopes are labeled apart. Main and background completion use elapsed wall time. A
  checkpoint requested is not a verification passed.
- Retired screen names map to their current screen, and the useful old commands still open it.
- The live log names who speaks and colors them; times and details are muted. It never shows private model
  reasoning.
- Terminal and desktop expose the same controls and states. English and Brazilian Portuguese strings live in
  `hooks/strings/en.ts` and `hooks/strings/pt.ts`, always in pairs.

## Motion

Nothing moves on the dashboard: Pingo's face has no timer, and the screens change only on observable events. The
Deck is the deliberate exception: the pet, the fold that opens and closes the band, and the demo plan move on purpose.
Desktop motion is CSS and SVG animation, never script timers. A terminal frame is a pure function of act, time and
facing, so a repaint needs no stored state. The terminal pet is one Raster as wide as the band, repainted in place by
a 100 ms loop that runs only while a band is on screen and asks for no redraw. Terminal rows redraw about every 300 ms,
every 600 ms while the dashboard is open; desktop rows and the pet move by CSS and redraw only when a scene changes. A
hidden or idle Deck asks for no frames.

## Where it lives

| File | Holds |
| --- | --- |
| `hooks/theme.ts` | `HUE`, `PAINT`, `SVG_PAINT`, `DECK_ACCENT`, `GLYPH`, `DECK_GLYPH`, `dotMeter` |
| `hooks/ui.tsx` | The dashboard, agent panes and Jev's lines above the prompt: `card` (a node), `trail`, `header`, `navButtons` |
| `hooks/deck/band.tsx`, `hooks/deck/rows.ts` | The Deck band and its row nodes (`rowGlyph`) |
| `hooks/deck/theme.ts` | The Deck's state, tier and track styles |
| `hooks/deck/pet.ts`, `hooks/mascots/pingo.ts` | The pet, its hats, and the mood faces |
| `hooks/register.tsx` | The feature lines above the Deck and the style picker |
| `tests/theme.test.tsx` | Contrast, meters, row nodes, and the timeline's failure marks |

## Known limits

- The trail's dot and line are placed (`position: absolute`) over the node's left margin inside a `relative` node,
  and the line is clipped to the node's height by the host; its length is estimated from the content, so a host that
  did not clip would show it a row long. Neither has been seen on a real terminal or in the desktop app yet.
- Desktop SVG text tones and the braille body of the pet are tuned for a dark background.
- The empty part of a track (`subtle`) is decoration at about 2:1.
- Deck rows overflow below about 50 columns.
- The `/deck status` reply text still lists agents with `↳`; it is command output that tests read as is.
