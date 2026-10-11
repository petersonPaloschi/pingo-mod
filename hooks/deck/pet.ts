// The Deck pet: pingo's mascot walking the Deck lane, with the Deck's scene around it (the desk, the alert
// badge, confetti, z's and dust). The scene logic is pure and the same on every surface. The desktop lane is
// SVG and moves by CSS only; the terminal gets pixel-art frames (half blocks, two pixels to a cell) that are a pure
// function of (act, time, facing), laid out along a lane as wide as the band, so the host can repaint them in place
// without drawing anything else.
export { PET_ACTS, PET_BRAILLE, petMoodFor, createPet, petX, stepPet } from "./pet/model.ts";
export type { PetAct, DeckMood, Pet } from "./pet/model.ts";
export { PET_CSS, petSvgBody, petLaneSvg } from "./pet/svg.ts";
export { eyePixels, petFrame, petLaneColumns, petLaneCells } from "./pet/frame.ts";
