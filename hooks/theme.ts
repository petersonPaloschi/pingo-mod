// Pingo's one visual identity. Every surface it draws (the /jev dashboard, the Deck band, the lines above the
// prompt, the agent panes, the pet) paints through these tokens, so a color is chosen once and means one thing.
//
// Text takes theme keys: the host resolves them in the person's own theme, so text stays readable on a light or
// a dark terminal and in a color-blind theme. Fills, Raster cells and SVG cannot name a theme key; they take the
// hex form, mid-tone colors that keep at least 3:1 against #1e1e1e and against #ffffff. Every state also has a
// glyph, so nothing is told by color alone.

/** Mid-tone hues as numbers (Raster cells take numbers): fills, bars, glyphs, the mascot's moods. */
export const HUE = {
  /** Cyan: Pingo's own accent, the open screen, the bars of work in progress. */
  brand: 0x1a9fb0,
  ok: 0x2f9e5a,
  warn: 0xb8800f,
  fail: 0xe0604f,
  /** Planning switched off; the sonnet tier. */
  info: 0x4f86e8,
  /** The person in the live log; the opus tier. */
  violet: 0x8a6cf0,
  magenta: 0xc158c9,
  /** The haiku tier. */
  teal: 0x13a08a,
  /** Idle and passthrough: present, but nothing to act on. */
  neutral: 0x7a8494,
  /** Claude's own orange, for the main model. */
  claude: 0xd97757,
} as const;

/** A number color as the "#rrggbb" a Text, Box or SVG paints with. */
export const css = (color: number) => "#" + (color & 0xffffff).toString(16).padStart(6, "0");

/** Text roles as theme keys (the host's names), plus the brand hues text may carry. */
export const PAINT = {
  /** Values, headings, anything read first. */
  text: "text",
  /** Labels, notes and help: secondary, still readable on both grounds. */
  muted: "inactive",
  /** Rules, tracks and leaders: decoration only, never the one place a fact is written. */
  rule: "subtle",
  ok: "success",
  warn: "warning",
  fail: "error",
  claude: "claude",
  brand: css(HUE.brand),
  you: css(HUE.violet),
  /** Text on a mid-tone ground (a pill, a filled bar): dark, at least 4.9:1 on every hue above. */
  onFill: "#101215",
} as const;

/** The same roles for an SVG source, which cannot name a theme key: mid-tones that hold on both grounds. */
export const SVG_PAINT = {
  text: "#e8eaee",
  muted: css(HUE.neutral),
  rule: "#808080",
  onFill: "#ffffff",
} as const;

/** Glyphs that say a state without color. */
export const GLYPH = {
  ok: "✓",
  warn: "!",
  fail: "×",
  ask: "?",
  run: "▶",
  idle: "–",
  on: "●",
  off: "○",
  /** The open screen, the chosen option. */
  open: "▸",
  rule: "─",
  leader: "·",
  /** A child under its parent (an agent under its plan). */
  branch: "└",
} as const;

/** Eighth blocks, thinnest first: a bar's fraction of a cell. */
export const EIGHTHS = "▏▎▍▌▋▊▉█";

/** A bar `width` cells long, filled to `fraction` with eighth blocks, so 41% and 44% look different. */
export function blockBar(fraction: number, width: number): string {
  const eighths = Math.round(Math.max(0, Math.min(1, fraction)) * width * 8);
  const full = Math.floor(eighths / 8);
  const part = eighths % 8;
  return "█".repeat(full) + (part ? EIGHTHS[part - 1]! : "");
}
