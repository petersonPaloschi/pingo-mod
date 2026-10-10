# Visual style system

The dashboard uses host UI primitives. The Deck draws SVG with inline CSS on Desktop and colored cell arrays in the terminal; there are no standalone CSS, SCSS, Sass, or Less files.

## Shared tuning points

- `hooks/theme.ts` owns global colors and roles (`HUE`, `PAINT`, `SVG_PAINT`), dashboard ink and spacing (`UI_INK`, `UI_DESIGN`), dot and mascot palettes, and the Deck's typography, geometry, motion, and style catalog (`DECK_DESIGN`, `DECK_STYLE_ORDER`, `DECK_STYLE_NAMES`).
- `hooks/deck/theme.ts` maps shared colors to Deck states and exposes the shared Deck tokens.
- `hooks/deck/styles-desktop.ts` and `hooks/deck/styles-terminal.ts` render the Deck visual alternatives for each surface. `hooks/deck/rows.ts`, `hooks/deck/band.tsx`, `hooks/deck/pet.ts`, and `hooks/deck/cast.ts` compose rows, layout, the mascot, and its cast from those tokens. `DECK_DESIGN.cast` holds the cast lane sizes and timing; `PET_PALETTE` holds its shared light and eye colors.
- `hooks/ui.tsx` owns dashboard structure and uses `UI_INK`/`UI_DESIGN` for its colors and repeated spacing. `hooks/register.tsx` composes command and prompt panes, including the Deck picker, from the same shared tokens. `hooks/dots.ts`, `hooks/flow.ts`, `hooks/trail.ts`, and `hooks/mascots/` render related views and reuse the shared palettes.

## Style alternatives

The Deck offers six alternatives on both surfaces: `pixel`, `segments`, `line`, `solid`, `dots`, and `spark`. Their catalog, labels, and per-surface order are defined once in `hooks/theme.ts`; the Desktop SVG and terminal-cell renderers remain separate because their output primitives differ.

`bench/chart.mjs` and `docs/media/benchmark.svg` style benchmark/report visuals. They are not app themes.
