// Pingo in black and white ASCII, its visual identity in the terminal. Every surface it draws there (the /jev
// dashboard, the agent and feature panes, the lines above the prompt, the Deck band, the mascots) is 7-bit ASCII in
// the terminal's own foreground or its dimmed one, with bold and underline for weight: a state is told by its glyph
// and its word, never by a hue.
//
// The screens are filed in three folders down a rail on the left (`> ` marks the open one), and what a screen says is
// written on cards: a `+-|` frame with the title on its top edge, the figure that matters in bold, a `[###...]` meter
// beside it. Buttons are `[ label ]`, a mascot's balloon `(Name: words)`, the tab a line starts with `|`. The mascots
// are text drawings on one grid: 8 by 4 cells, Pingo 12 by 4.
//
// Text takes theme keys (`text`, `inactive`): the host resolves them in the person's own theme, so text stays readable
// on a light or a dark terminal, with 16 colors or none. The desktop app keeps its own SVG and CSS drawings, which
// still take the hues below in hex form. They were built in OKLCH at one lightness (L 0.62) and one share of each hue's
// own chroma, so none looks heavier than another: each keeps at least 3.3:1 against #1e1e1e and against #ffffff and
// 4.7:1 under a dark ink, and the states land on distinct ANSI colors when a terminal has only 16 (sky `you` shares cyan with

export { TERMINAL_DEFAULT, HUE, DOT_PALETTE, DOT_DEPTH, AGENT_MASCOT_PALETTE, FEATURE_MASCOT_PALETTE, MASCOT_SHADE, shadeOf } from "./theme/palette.ts";
export { DECK_ACCENT, DECK_STYLE_ORDER, DECK_STYLE_NAMES, FONT_WEIGHT, DECK_DESIGN, css, inkOn } from "./theme/deck.ts";
export type { DeckStyleName } from "./theme/deck.ts";
export { PAINT, UI_INK, UI_DESIGN, PRISMA_GALLERY_DESIGN, PRISMA_GALLERY_CSS, SVG_PAINT, PET_PALETTE, GLYPH, BORDER_STYLE } from "./theme/ui.ts";
export { DECK_GLYPH, DECK_DOTS, meter, bracketMeter } from "./theme/glyphs.ts";
export type { DeckGlyphName } from "./theme/glyphs.ts";
