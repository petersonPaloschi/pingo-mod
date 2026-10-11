import { CLAUDE_MODEL, EFFORTS, TIERS } from "../../core/contracts.ts";
import { DECK_GLYPH } from "../../theme.ts";
import { type RowStyle, type BarState } from "./types.ts";

export const MAX_BARS = 4;
export const BAR_LINGER_MS = 120_000;
export const AGENTS_LINGER_MS = 30_000;
export const ACTIVITY_LINGER_MS = 20_000;
export const FOLD_MS = 5000;
export const MAX_STRIPS = 4;
export const ASK_DELAY_MS = 600;
export const SLEEPY_MS = 180_000;
export const HIST_KEEP_MS = 26 * 3600_000;
export const HIST_MAX_POINTS = 400;
export const ROUTE_HISTORY = 8;
export const ROUTE_CARRY_MS = 5000;
export const CELEBRATE_MS = 3500;
/** Sessions whose spend already counted is kept; older ones are dropped. */
export const COST_SESSIONS = 30;
/** The version `/deck version` and `/deck status` print: the plugin's own. Keep it equal to `version` in `.claude-plugin/plugin.json`. */
export const DECK_VERSION = "0.1.0";

export { EFFORTS };
export const TIER_MODEL: Record<string, string> = { fast: CLAUDE_MODEL.HAIKU.name, balanced: CLAUDE_MODEL.SONNET.name, deep: CLAUDE_MODEL.OPUS.name };
export const MODEL_RANK: Record<string, number> = Object.fromEntries(TIERS.map((tier, index) => [tier, index]));

// the row styles: a state's glyph and its color role (rows.ts maps a style to the palette)

export const STYLE_GLYPH: Record<RowStyle, string> = DECK_GLYPH;
export const STATE_STYLE: Record<BarState, RowStyle> = { running: "run", needs_input: "ask", error: "hot", done: "done" };
