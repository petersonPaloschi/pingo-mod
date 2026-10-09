// Trilha, Pingo's visual identity. Every surface it draws (the /jev dashboard, the Deck band, the lines above the
// prompt, the agent panes, the pet) paints through these tokens, so a color is chosen once and means one thing.
//
// The idea is a trail: what Pingo shows hangs off a vertical line as nodes, with room between them. Text takes
// theme keys: the host resolves them in the person's own theme, so text stays readable on a light or a dark
// terminal and in a color-blind theme. Fills, Raster cells and SVG cannot name a theme key; they take the hex form,
// mid-tone colors that keep at least 3:1 against #1e1e1e and against #ffffff. Every state also has a glyph, so
// nothing is told by color alone.

/** Mid-tone hues as numbers (Raster cells take numbers): nodes, meters, pills, the mascot's moods. */
export const HUE = {
  /** Lime: Pingo's own color, the node that is happening now, work in progress, the haiku tier. */
  brand: 0x7e9a1f,
  /** Jade: routed, done. */
  ok: 0x3d9a6e,
  /** Amber: passthrough, a question, a limit filling up. */
  warn: 0xc07f1c,
  /** Rose: failures. */
  fail: 0xd9577d,
  /** Lavender: planning switched off, Pingo asleep, the sonnet tier. */
  info: 0x8b7fd6,
  /** Sky: the person in the live log. */
  you: 0x4a90c2,
  /** Plum: the opus tier. */
  plum: 0xb562a8,
  /** Stone: idle and empty, present but nothing to act on. */
  neutral: 0x8a8577,
  /** Claude's own orange, for the main model. */
  claude: 0xd97757,
} as const;

/** Animated Deck fills: a darker moving head and a light sweep of the brand lime, never used for text. */
export const DECK_ACCENT = {
  headDim: 0x5d7216,
  shine: 0xb3c96a,
} as const;

/** A number color as the "#rrggbb" a Text, Box or SVG paints with. */
export const css = (color: number) => "#" + (color & 0xffffff).toString(16).padStart(6, "0");

/** Text roles as theme keys (the host's names), plus the hues text may carry. */
export const PAINT = {
  /** Values, headings, anything read first. */
  text: "text",
  /** Labels, notes and help: secondary, still readable on both grounds. */
  muted: "inactive",
  /** The trail's line, tracks and separators: decoration only, never the one place a fact is written. */
  rule: "subtle",
  ok: "success",
  warn: "warning",
  fail: "error",
  claude: "claude",
  brand: css(HUE.brand),
  you: css(HUE.you),
  /** Text on a mid-tone ground (a pill, a filled bar): a warm near-black, at least 4.7:1 on every hue above. */
  onFill: "#14110f",
} as const;

/** The same roles for an SVG source, which cannot name a theme key: mid-tones that hold on both grounds. */
export const SVG_PAINT = {
  muted: css(HUE.neutral),
  onFill: "#ffffff",
  /** The empty part of a desktop bar: a warm grey a step under the stone of the labels. */
  track: "#7f7a6e",
} as const;

/** Glyphs that say a state without color, and the pieces of the trail. */
export const GLYPH = {
  ok: "✓",
  warn: "!",
  fail: "×",
  ask: "?",
  /** The node that is happening now: the current step, a running agent. */
  run: "◉",
  baseline: "◌",
  idle: "–",
  /** A node on the trail, a filled dot of a meter. */
  on: "●",
  /** A node with nothing yet, an empty dot of a meter. */
  off: "○",
  /** Half a dot of a meter. */
  half: "◐",
  route: "→",
  /** The chosen option in a list. */
  open: "◉",
  /** The trail's line, down the left of a screen. */
  spine: "│",
  rule: "─",
  /** Between parts of one line. */
  leader: "·",
  /** A child hanging off its parent (an agent under its plan). */
  branch: "╰",
  /** Between the screens' names. */
  slash: "/",
} as const;

/** The Deck's row marks, shared by its model status and renderers: the trail's node for each state. */
export const DECK_GLYPH = {
  run: GLYPH.on,
  ask: GLYPH.ask,
  hot: GLYPH.warn,
  done: GLYPH.ok,
  ok: "◔",
  warn: "◑",
} as const;

/**
 * A meter of `dots` dots filled to `fraction`, in halves: [filled, empty], so each part takes its own color.
 * It reads at a glance; the exact share is always written beside it.
 */
export function dotMeter(fraction: number, dots = 10): [filled: string, empty: string] {
  const halves = Math.round(Math.max(0, Math.min(1, fraction)) * dots * 2);
  const full = Math.floor(halves / 2);
  const half = halves % 2;
  return [GLYPH.on.repeat(full) + (half ? GLYPH.half : ""), GLYPH.off.repeat(dots - full - half)];
}
