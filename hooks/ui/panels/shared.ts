import type { ComandanteDecision } from "../../../types";
import { GLYPH, UI_INK as INK } from "../../theme.ts";

/** Each decision's glyph and ink: the glyph says it, the ink is the plain foreground. */
export const DECISION_MARK: Record<ComandanteDecision, [glyph: string, color: string]> = {
  approved: [GLYPH.ok, INK.route],
  rejected: [GLYPH.fail, INK.fail],
  questioned: [GLYPH.ask, INK.pass],
};

/** A feature's ink: in black and white every mascot writes in the terminal's own, so the id only keeps the callers. */
export const mascotColor = (_id: string) => INK.ink;
