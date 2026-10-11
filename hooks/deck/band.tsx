// Deck's band as elements: the collapsed look (chips, one line, or rings), the expanded rows with
// their strips, the feature switches, and the pet lane. Pure: the caller hands in the rows, settings
// and time it drew from.

export type { Surface, Speech, DeckBand } from "./band/types.ts";
export { FRAME_MS, renderDeck } from "./band/render.tsx";
