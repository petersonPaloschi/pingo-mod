// Deck's drawings as data: the row and route SVG, the terminal route cells, the history squares,
// and the three collapsed looks (chips, text, rings). Pure: strings and descriptors that the band
// turns into Svg, Text and Box. A state's color says the state, and its glyph says it again, so a
// dot never carries the meaning alone.

export { tierColor, toTrackRow, toAgentRow } from "./rows/data.ts";
export type { Cell, DrawCaches, RowDrawOptions } from "./rows/data.ts";
export { histSquare, histCell, routeCellsTerminal, routeSvg } from "./rows/routes.ts";
export { TRACK_H, RIGHT_W, FOLD_STEP, FOLD_FADE, ringSvg, rowSvg, fadeInSvg, rowGlyph, chipBarSvg } from "./rows/draw.ts";
export { collapsedChips, collapsedText, collapsedRings, switchLabel, featureLines } from "./rows/display.ts";
export type { ChipMini, Chip, ChipOptions, TextPart, RingItem, FeatureSwitch } from "./rows/display.ts";
