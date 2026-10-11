// The Deck's cast: whoever is at work stands with Pingo on the pet's lane, and nobody else. Jev joins while a call of
// his is open; a feature joins while it is at work or has something waiting on the person; a subagent joins when it
// starts. Each says what it is doing in a balloon over its body, and when its task ends, well or not, it hops a
// goodbye and leaves. Each member is a small body in its own color and shape: the subagents after their names (Tetra
// a triangle, Gem a cut gem, Can a can, Coil a spring, Top a spinning top), Jev a sphere like Pingo's, each feature
// after what it does (Farol a lighthouse, Semente a sprout, Vigia an owl...), drawn as pixel art like him, in half
// blocks, with its name on a row above it. The group stands in a fixed order, the features then Jev at Pingo's left
// and the subagents at his right, everyone facing Pingo, and it walks wherever Pingo walks. Unlike Pingo's scenes
// nothing here is random: a frame is a pure function of its inputs, so the host can repaint it in place and a test
// can check it exactly.

export type { SpeakerId, CastKind, CastState, CastMember, CastSpeaker, JevOnLane } from "./cast/model.ts";
export { SPEAKER_IDS, SPEAKER_NAMES, isSpeaker, CAST_JOIN_MS, CAST_LEAVE_MS, castOf, castKey, MEMBER_BRAILLE, LANE_ROWS, PINGO_INK } from "./cast/model.ts";
export { castColor, memberFrame } from "./cast/frame.ts";
export type { CastSlot } from "./cast/layout.ts";
export { clipName, balloonWords, castLayout } from "./cast/layout.ts";
export type { LaneCell } from "./cast/cells.ts";
export { castLaneCells } from "./cast/cells.ts";
export { CAST_LABEL_PX, castLaneSvg } from "./cast/svg.ts";
