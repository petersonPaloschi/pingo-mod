import type { ComandanteDecision } from "../../../types";
import { hex } from "../../dots.ts";
import { FEATURE_MASCOT_PALETTE, GLYPH, UI_INK as INK } from "../../theme.ts";

/** Each decision's glyph and color, so it reads without color too. */
export const DECISION_MARK: Record<ComandanteDecision, [glyph: string, color: string]> = {
  approved: [GLYPH.ok, INK.route],
  rejected: [GLYPH.fail, INK.fail],
  questioned: [GLYPH.ask, INK.pass],
};

/** A feature's own color: its mascot's, or Jev's for one Jev speaks for (Rumo). */
export const mascotColor = (id: string) => (Object.hasOwn(FEATURE_MASCOT_PALETTE, id) ? hex(FEATURE_MASCOT_PALETTE[id as keyof typeof FEATURE_MASCOT_PALETTE]) : INK.brand);
