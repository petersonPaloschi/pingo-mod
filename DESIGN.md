# Fichário

Fichário ("binder") is how Pingo looks everywhere it draws: the `/jev` dashboard, the agent and feature panes, the
lines above the prompt, the Deck band, its panel and style picker, the Prisma gallery, and the mascots. The screens
are filed in three folders down a rail on the left; what a screen says is written on cards beside it. The mascots are
pixel art on one grid, all of one size.

As a text capture (`node scripts/screens.ts`) draws it, with each screen's key after its name; a real terminal
draws a plain button's key before it (`1: ▸ Overview`), and Pingo is a two-cell pixel sprite where the capture shows
its outline.

```
▄▀██▀▄   jev  ✓ Routing
▀████▀  Jev decided 2 of the last 4 requests (5 min).
        Last 5 minutes: 3 Jev calls · 420 ms average · 2.7k input tokens · 0 Jev failures

 SESSION            Overview
▸ Overview ‹1›      what Jev did in the range you pick
  Live ‹2›         ╭───────────────────────────╮ ╭───────────────────────────╮
  Models ‹3›       │ ■ Routing                 │ │ ■ Jev's answers           │
                   │ ■ hint — Jev's pick …     │ │ Jev calls              3  │
 WORK              │   ▰▰▰▰▰▱▱▱▱▱  2 · 50%     │ │   none failed             │
  Agents ‹4›       ╰───────────────────────────╯ ╰───────────────────────────╯
  …                ╭─────────────────────────────────────────────────────────╮
                   │ ■ Token usage                                           │
```

## Five rules

1. **Folders and cards.** Navigation is a rail of three folders (Session, Work, Settings); content is cards: a rounded
   frame in the theme's `subtle`, a `■` in the card's accent and its title in bold, then its body. Cards sit side by
   side where the width holds two at `gridMinWidth`, else one under the other.
2. **A glyph before a color.** Every state has its own glyph and a word. Color repeats what the glyph says, so the
   screen still reads in a monochrome terminal, on 16 colors, or for a color-blind person.
3. **Text follows the person's theme.** Words are painted with Claude Code theme keys (`PAINT`), which the host
   resolves for a light, dark or color-blind theme. Hex colors appear only on fills, chips, meters, Raster cells, SVG.
4. **Room before cuts.** A narrow pane folds the rail into lines and stacks the cards. Long labels wrap; they are not
   cut.
5. **Say what was observed.** Values are exact, unknowns stay unknown, partial data says it is partial, and an
   estimate names its basis. Confidence and activity are never presented as quality or savings.

## Palette

All tokens live in `hooks/theme.ts`. `hooks/dots.ts` (`DOT`, numbers for Raster cells) and `hooks/deck/theme.ts` (the
Deck's state, tier and track styles) derive from it; nothing else picks its own color.

**Hues** (`HUE`) were built in OKLCH at one lightness (L ≈ 0.62) and one share (0.8) of each hue's own maximum chroma,
so none looks heavier than another. Each keeps at least 3.3:1 against `#1e1e1e` and `#ffffff`; `PAINT.onFill`
(`#14110f`) keeps at least 4.7:1 on each; and the states land on distinct ANSI colors when a terminal has only 16
(sky `you` shares cyan with teal `info`, which never stand side by side). `tests/theme.test.tsx` checks all three.

| Hue | Value | On #1e1e1e | On #ffffff | Ink on it | 16 colors | Says |
| --- | --- | --- | --- | --- | --- | --- |
| mirtilo `brand` | `#7f6fe7` | 4.23 | 3.94 | 4.77 | blue | Pingo, the open screen, work in progress, the sonnet tier |
| green `ok` | `#3d9e59` | 4.95 | 3.37 | 5.58 | green | Routed, done |
| amber `warn` | `#ab8036` | 4.66 | 3.58 | 5.26 | yellow | Passthrough, a question, a limit filling up |
| red `fail` | `#e8424d` | 4.22 | 3.95 | 4.76 | red | A failure |
| papel teal `info` | `#3d9898` | 4.88 | 3.42 | 5.50 | cyan | Planning off, Pingo asleep, the haiku tier |
| sky `you` | `#3a8fc9` | 4.73 | 3.53 | 5.33 | cyan | The person, in the live log |
| plum `plum` | `#d941b2` | 4.25 | 3.93 | 4.79 | magenta | The opus tier |
| stone `neutral` | `#8f8a80` | 4.85 | 3.43 | 5.48 | white | Idle, empty, nothing to act on |
| `claude` | `#d97757` | 5.34 | 3.12 | 6.02 | — | The main model (Claude Code's own color) |

**Mascots** (`AGENT_MASCOT_PALETTE`, `FEATURE_MASCOT_PALETTE`) are one ring at the same lightness, each with a darker
shade (`MASCOT_SHADE`, `shadeOf`) for its underside. Code Quality keeps royal blue `#4560d8` (the person's choice); the
brand sits 17° of hue away from it. Words on a mascot's color (a balloon, a pill, a pane's head) take `inkOn`: the
near-black, or white on a ground too dark for it, which is only Code Quality's (white 5.36:1, near-black 3.51:1).

**Text roles** (`PAINT`): `text`, `muted` (`inactive`), `rule` (`subtle`) for frames and tracks, `ok`, `warn`, `fail`,
`claude`, and the hues `brand`, `you`, `info`, `plum`. Frames and tracks are decoration: no fact is written only there.

**Hats and props** (`PET_PALETTE`) keep their natural colors, with a second tone each (`hatTrim`) that holds where the
first fades: the chef's white hat has its grey band on a light terminal, the dark top hat its red band on a dark one.

## Glyphs

| Glyph | Meaning |
| --- | --- |
| `■` | A card's mark; someone speaking in the live log; a subagent at work above the prompt |
| `▣` `□` | A switch on, a switch off (and `□` for something not there yet) |
| `▸` | The open screen on the rail; the chosen option |
| `▌` | The tab a line above the prompt and a Deck row start with, in its feature's or state's color |
| `◆` | What is happening now: the step running, a running agent, a Deck row at work |
| `▰` `▱` | A meter's filled and empty cells (`meter`) |
| `✓` `!` `×` `?` | Done, needs attention, failed, waiting on a question |
| `◔` `◑` | A limit's fill on a Deck row |
| `→` `╰` | The route or a next step; a child under its parent |
| `◈` `┃` | The advisor's event and its branch in the Flow log |
| `◌` `–` | Pingo asleep, idle |

The Deck's "Dots" bar style keeps drawing dots (`DECK_DOTS`: `●` `◐` `○` `◉`): that is what the style is.

## Meters

A share is a meter of whole cells (`meter`): anything above nothing shows one cell and anything short of everything
leaves one empty, so the ends are never misread. The exact count and percentage are always written beside it:
`▰▰▰▰▰▱▱▱▱▱  2 · 50%`. The Overview timeline keeps its sparkline of tokens per slot, with `×` under a slot whose request
failed.

## Surfaces

### The `/jev` dashboard

- **Header.** Pingo as a still pixel sprite two cells tall (its body in the terminal's own color, its eyes in the
  mood's), ` jev ` on the brand's ground and the state in bold; under them, the status sentence and the last five
  minutes. The desktop, which draws no Raster, shows Pingo's face as text. A terminal pane under 24 rows keeps the first
  line only, with the face.
- **Rail.** Three folders, faint capitals, then their screens: Session (Overview 1, Live 2, Models 3), Work (Agents 4,
  Logs 5, Flow 0, Orchestration o, Quality q, Comandante d, Autonomous a), Settings (Configuration 6, Deck 7, Features 8, AI 9). Each
  is a Button `tab-<id>` with its key; the open one is `▸`, bold, on the brand's ground across the rail. Under 64
  columns, or on a terminal pane under 24 rows, the rail folds into one line per folder under the header.
- **Title.** The screen's name in the brand's color and, under it, what the screen is for.
- **Cards.** Every screen is cards. Overview: Routing and Jev's answers side by side, Token usage and the Timeline
  across the width. Agents: one card per subagent, its `■` in its mascot's color while it runs, red after an error.
  Logs: reason groups, the request log, the AI calls. The other screens follow the same cards.

### Feature panes

Farol, Clareza, Semente, Prisma, Sentinela and Vigia open with `featureHead`: the feature's name on its mascot's color
and a line of what it holds, then cards (`sheetCard`). Farol's assumptions are one card each, their glyph `?` `✓` `✗`.

### Lines above the prompt

Each line starts with `▌` in its feature's mascot color (Farol, Clareza, Semente, Lapida, Sentinela, Vigia). Jev's own
lines: Pingo's face and the state, then Jev's latest call under a tab in the brand's color, then the main model under a
tab in Claude's color, what Claude is doing, and a `■` per subagent at work in its mascot's color.

### The Deck band

Each expanded terminal row: `▌` in its state's color, its title, the bar in the chosen style, its share, its state's
glyph, what is left of its right-hand value, and `✕`. A plan's agents hang under it with `╰─`. Every option stays: six
bar styles (solid is the terminal default, pixel the desktop one), three collapsed looks (chips, text, rings), the
sizes, the pet lane, the style picker (`▸ now`), and the feature switches (`▣` `□`).

### The Prisma gallery

The browser page keeps its paper ground; each option is an index card with a band across its top, grey at rest and
the brand's when chosen.

### Mascots

One stroke for all: pixel art on a grid of two pixels per terminal cell (`hooks/mascots/pixel.ts`, `renderPixels`), body
pixels solid and eyes as detail pixels drawn behind the body, so a colorless terminal shows a silhouette with its eyes
cut out. Pingo is 12×8 pixels and every cast member 8×8 (`DECK_DESIGN.pet.sprite`, `.member`); the lane keeps five rows.
Bodies are two-toned (their shade on the underside) over a floor shadow.

- **Pingo**: its body in the terminal's own color; six moods by eye shape and color (routing happy, thinking spinner,
  passthrough open, failing crossed and shaking, idle flat, baseline closed); nine acts (idle, walk, run, jump, console,
  read, sleep, celebrate, alert) with their props; eleven hats and shades; every `/pingo` verb.
- **Jev**: a small sphere in the brand color. **Features**: each shaped after what it does, so no two silhouettes
  match even without color (Clareza a light bulb, Semente a sprout, Farol a lighthouse, Vigia an owl, Sentinela a
  shield, Prisma a prism, Lapida a cut stone, Contexto a folded page, Code Quality a clipboard, Comandante a star).
  **Subagents**: shaped after their names (Tetra a triangle, Gem a diamond, Can a can, Coil a spring, Top a spinning
  top). States: idle, asking, joining, done, failed.
- **Who stands on the lane**: Pingo always; everyone else only while at work. Jev while a call of his is open, a
  feature while it works or has something waiting on the person, a subagent while it runs. When the task ends, well
  or not, the balloon goes at once and the mascot hops a goodbye (happy or crossed eyes) for `DECK_DESIGN.cast.leaveMs`,
  then leaves. Farol only collects Claude's assumptions, so it comes when there are some to review.
- **Speech**: everyone at work has a filled balloon on the name row with its name and, where the lane has room, what it
  is doing (cut with an ellipsis, `DECK_DESIGN.cast.lane.maximumBalloonColumns` at most); the first one's words are
  also on the line under the lane, the others' names beside them. Pingo speaks for Claude; the main Claude gets no
  mascot.

The desktop is not designed for separately: it shares the dashboard's layout and the palette, and its SVG drawings
(the Deck rows, the dotted sphere of Pingo, the cast) keep their shapes.

## Behavior the look must keep

- Claude Code owns the pane's scroll window on the desktop; on the terminal the pane is exactly its room tall, the
  header, rail and title stay, and the screen under the title moves by its own offset. Changing screens or opening the
  run details returns to the top.
- Request scopes and whole-task scopes are labeled apart. Main and background completion use elapsed wall time. A
  checkpoint requested is not a verification passed.
- Retired screen names map to their current screen, and the useful old commands still open it.
- The live log names who speaks and colors them; times and details are muted. It never shows private model reasoning.
- Terminal and desktop expose the same controls and states. English and Brazilian Portuguese strings live in
  `hooks/strings/en.ts` and `hooks/strings/pt.ts`, always in pairs.

## Motion

Nothing moves on the dashboard: Pingo's sprite has no timer. The Deck is the deliberate exception: the pet and its
cast, the fold that opens and closes the band, and the demo plan move on purpose. A terminal frame is a pure function
of act, time and facing; the pet's lane is one Raster as wide as the band, repainted in place (`$.ui.blit`) by the Deck's
150 ms loop, which asks for no redraw. Desktop motion is CSS and SVG animation, never script timers.

## Where it lives

| File | Holds |
| --- | --- |
| `hooks/theme.ts` | `HUE`, `PAINT`, mascot palettes and shades, `PET_PALETTE`, `GLYPH`, `DECK_GLYPH`, `DECK_DOTS`, `meter`, layout |
| `hooks/ui.tsx` | The dashboard: `header`, `rail`, `foldedRail`, `card`, `grid`, `featureHead`, `lineTab`, Jev's lines |
| `hooks/register.tsx` | The feature panes and lines above the prompt, the style picker |
| `hooks/deck/band.tsx`, `hooks/deck/rows.ts` | The Deck band and its rows |
| `hooks/mascots/pixel.ts` | The pixel grid, half blocks, the dashboard's mini Pingo |
| `hooks/deck/pet.ts`, `hooks/deck/cast.ts`, `hooks/mascots/pingo.ts` | The pet, its hats and acts, the cast, the moods |
| `tests/theme.test.tsx` | Contrast, 16-color landing, mascot shades, meters, row glyphs, the timeline's failure marks |

## Known limits

- The 16-color landing is computed with chalk's downsampling and has not been seen: in Claude Code 2.1.296,
  `FORCE_COLOR=1` with `TERM=xterm` did not make the host drop to 16 colors (checked 2026-10-11 in a real TUI).
- Under `NO_COLOR=1` the host drops the colors of Text (every state still reads by its glyph and word) but keeps
  painting Raster cells in color, so the mascots keep theirs (seen 2026-10-11). The sprites are still drawn so the body
  is each glyph's foreground, should a host ever drop Raster colors too.
- Hats and props are decoration: a light hat fades on a light terminal and a dark one on a dark terminal, each keeping
  a second tone.
- Frames and tracks (`subtle`) are decoration at about 2:1.
- Deck rows overflow below about 50 columns.
