// The Deck pet: pingo's mascot walking the Deck lane. The scene logic is pure and the same on every surface. The
// desktop lane is SVG and moves by CSS only; the terminal gets ASCII frames (twelve columns by four rows of text) that
// are a pure function of (act, time, facing), laid out along a lane as wide as the band, so the host can repaint them
// in place without drawing anything else.
export { PET_ACTS, PET_BRAILLE, PET_HOP_MS, PET_HOP_STEP_MS, petMoodFor, createPet, petX, stepPet } from "./pet/model.ts";
export type { PetAct, DeckMood, Pet } from "./pet/model.ts";
export { PET_CSS, petSvgBody, petLaneSvg } from "./pet/svg.ts";
export { petFrame, petRaised, petLaneColumns, petLaneCells } from "./pet/frame.ts";
