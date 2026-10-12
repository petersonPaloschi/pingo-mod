import { GLYPH } from "./ui.ts";

export const DECK_GLYPH = {
  run: GLYPH.run,
  ask: GLYPH.ask,
  hot: GLYPH.warn,
  done: GLYPH.ok,
  ok: "o",
  warn: "O",
} as const;
export type DeckGlyphName = keyof typeof DECK_GLYPH;

/** The Deck's "Dots" bar style draws dots, whatever the binder's own marks are: a full, a half, an empty, the current. */
export const DECK_DOTS = { full: "@", half: "o", empty: ".", now: "O" } as const;

/**
 * A meter of `cells` cells filled to `fraction`: [filled, empty], so each part takes its own color. Anything above
 * nothing shows one cell and anything short of everything leaves one empty, so the ends are never misread; the exact
 * share is always written beside it.
 */
export function meter(fraction: number, cells = 10): [filled: string, empty: string] {
  const share = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const full = share <= 0 ? 0 : share >= 1 ? cells : Math.max(1, Math.min(cells - 1, Math.round(share * cells)));
  return [GLYPH.fill.repeat(full), GLYPH.empty.repeat(cells - full)];
}

/** The meter as one text between its ends, `[######....]`: `cells` + 2 columns. */
export function bracketMeter(fraction: number, cells = 10): string {
  const [filled, empty] = meter(fraction, cells);
  return GLYPH.meterStart + filled + empty + GLYPH.meterEnd;
}
