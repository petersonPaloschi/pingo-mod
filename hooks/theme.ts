// Fichário, Pingo's visual identity. Every surface it draws (the /jev dashboard, the agent and feature panes, the
// lines above the prompt, the Deck band, the mascots) paints through these tokens, so a color is chosen once and
// means one thing.
//
// The idea is a binder: the screens are filed in three folders down a rail on the left, and what a screen says is
// written on cards: a rounded frame, a ■ and a label in capitals, the figure that matters in bold on its own line,
// a ▰▱ meter beside it. The mascots are pixel art on one grid, two pixels to a terminal cell, all of one size.
//
// Text takes theme keys: the host resolves them in the person's own theme, so text stays readable on a light or a
// dark terminal and in a color-blind theme. Fills, Raster cells and SVG cannot name a theme key; they take the hex
// form. The hues below were built in OKLCH at one lightness (L 0.62) and one share of each hue's own chroma, so none
// looks heavier than another: each keeps at least 3.3:1 against #1e1e1e and against #ffffff and 4.7:1 under
// PAINT.onFill, and the states land on distinct ANSI colors when a terminal has only 16 (sky `you` shares cyan with

export { TERMINAL_DEFAULT, HUE, DOT_PALETTE, DOT_DEPTH, AGENT_MASCOT_PALETTE, FEATURE_MASCOT_PALETTE, MASCOT_SHADE, shadeOf } from "./theme/palette.ts";
export { DECK_ACCENT, DECK_STYLE_ORDER, DECK_STYLE_NAMES, FONT_WEIGHT, DECK_DESIGN, css, inkOn } from "./theme/deck.ts";
export type { DeckStyleName } from "./theme/deck.ts";
export { PAINT, UI_INK, UI_DESIGN, PRISMA_GALLERY_DESIGN, PRISMA_GALLERY_CSS, SVG_PAINT, PET_PALETTE, GLYPH } from "./theme/ui.ts";
export { DECK_GLYPH, DECK_DOTS, meter } from "./theme/glyphs.ts";
export type { DeckGlyphName } from "./theme/glyphs.ts";
