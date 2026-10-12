import { TERMINAL_DEFAULT, HUE } from "./palette.ts";
import { FONT_WEIGHT, css } from "./deck.ts";

// Black and white: the terminal draws text in its own foreground or in its dimmed one, and nothing else. A state is
// told by its glyph and its word (and by bold), never by a hue, so every role below is one of those two theme keys.
export const PAINT = {
  /** Values, headings, anything read first. */
  text: "text",
  /** Labels, notes and help: secondary, still readable on both grounds. */
  muted: "inactive",
  /** Card frames, tracks and separators: decoration only, never the one place a fact is written. */
  rule: "inactive",
  ok: "text",
  warn: "text",
  fail: "text",
  claude: "text",
  brand: "text",
  you: "text",
  info: "text",
  plum: "text",
  /** Text on a ground: there are no grounds in black and white, so it is the plain foreground. */
  onFill: "text",
} as const;

/** Dashboard text roles and spacing tokens; the host renders the UI primitives on both surfaces. */
export const UI_INK = {
  ink: PAINT.text,
  dim: PAINT.muted,
  faint: PAINT.muted,
  border: PAINT.rule,
  brand: PAINT.brand,
  route: PAINT.ok,
  pass: PAINT.warn,
  fail: PAINT.fail,
  you: PAINT.you,
  claude: PAINT.claude,
} as const;
export const UI_DESIGN = {
  space: { none: 0, xs: 1, sm: 2, md: 3 },
  layout: {
    /** Columns a card's frame and air take from its width: a border and one column of air on each side. */
    indent: 4,
    /** Columns between cards side by side. */
    gutter: 2,
    minCardWidth: 10,
    /** Columns the host adds after a plain button for its key: a space and the key in angle quotes. */
    hotkeyColumns: 4,
    /** The narrowest card a row of cards keeps: two fit beside the rail in an 80-column pane, three at 130. */
    gridMinWidth: 28,
    gridMaxColumns: 3,
    configurationTwoColumnMinWidth: 80,
    /** The rail of screens down the left: its narrowest, the pane width and height it needs, and the gap after it. */
    rail: { minColumns: 18, minPaneWidth: 64, minRows: 24, gap: 2 },
    viewport: { minimumColumns: 40, panelColumns: 60, defaultColumns: 80, defaultRows: 30 },
  },
} as const;

/** The isolated browser gallery for Prisma design-choice previews. */
export const PRISMA_GALLERY_DESIGN = {
  palette: { page: "#f4f4f2", ink: "#1a1a1a", card: "#ffffff", muted: "#666666", outline: "#999999", accent: css(HUE.brand), border: "#cccccc", strongBorder: "#333333", inverse: PAINT.onFill, onInk: "#ffffff", shadow: "#0002" },
  page: { fontPixels: 15, lineHeight: 1.4, marginPixels: 24 },
  grid: { minimumCardWidthPixels: 300, gapPixels: 18 },
  /** A card is an index card: a band across its top, the outline's color at rest and the brand's when chosen. */
  card: { radiusPixels: 8, bandPixels: 4, shadowOffsetYPixels: 1, shadowBlurPixels: 3, outlineWidthPixels: 3, textPaddingYPixels: 10, textPaddingXPixels: 14 },
  kbd: { radiusPixels: 4, paddingYPixels: 1, paddingXPixels: 7 },
  input: { marginTopPixels: 12, maximumWidthPixels: 480, paddingYPixels: 8, paddingXPixels: 10, borderWidthPixels: 1, radiusPixels: 6 },
  button: { marginTopPixels: 18, marginRightPixels: 10, paddingYPixels: 9, paddingXPixels: 16, borderWidthPixels: 1, radiusPixels: 7 },
  disabledOpacity: 0.4,
} as const;
const gallery = PRISMA_GALLERY_DESIGN;
export const PRISMA_GALLERY_CSS = [
  `body{font:${gallery.page.fontPixels}px/${gallery.page.lineHeight} system-ui,sans-serif;margin:${gallery.page.marginPixels}px;background:${gallery.palette.page};color:${gallery.palette.ink}}`,
  `.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(${gallery.grid.minimumCardWidthPixels}px,1fr));gap:${gallery.grid.gapPixels}px}`,
  `.card{all:unset;cursor:pointer;display:block;background:${gallery.palette.card};border-radius:${gallery.card.radiusPixels}px;overflow:hidden;box-shadow:0 ${gallery.card.shadowOffsetYPixels}px ${gallery.card.shadowBlurPixels}px ${gallery.palette.shadow};outline:${gallery.card.outlineWidthPixels}px solid transparent}`,
  `.card{border-top:${gallery.card.bandPixels}px solid ${gallery.palette.outline}}.card:hover{outline-color:${gallery.palette.outline}}.card.on{outline-color:${gallery.palette.accent};border-top-color:${gallery.palette.accent}}`,
  `.card img{display:block;width:100%;height:auto}.card span{display:block;padding:${gallery.card.textPaddingYPixels}px ${gallery.card.textPaddingXPixels}px;font-weight:${FONT_WEIGHT.semibold}}`,
  `small{display:block;font-weight:${FONT_WEIGHT.regular};color:${gallery.palette.muted}}`,
  `kbd{background:${gallery.palette.ink};color:${gallery.palette.onInk};border-radius:${gallery.kbd.radiusPixels}px;padding:${gallery.kbd.paddingYPixels}px ${gallery.kbd.paddingXPixels}px}`,
  `.other{margin-top:${gallery.input.marginTopPixels}px;width:100%;max-width:${gallery.input.maximumWidthPixels}px;padding:${gallery.input.paddingYPixels}px ${gallery.input.paddingXPixels}px;border:${gallery.input.borderWidthPixels}px solid ${gallery.palette.border};border-radius:${gallery.input.radiusPixels}px;font:inherit}`,
  `#submit,.mix{margin:${gallery.button.marginTopPixels}px ${gallery.button.marginRightPixels}px 0 0;padding:${gallery.button.paddingYPixels}px ${gallery.button.paddingXPixels}px;border:${gallery.button.borderWidthPixels}px solid ${gallery.palette.strongBorder};border-radius:${gallery.button.radiusPixels}px;background:${gallery.palette.card};font:inherit;cursor:pointer}`,
  `#submit{background:${gallery.palette.ink};color:${gallery.palette.onInk}}#submit:disabled{opacity:${gallery.disabledOpacity}}.mix.on{background:${gallery.palette.accent};color:${gallery.palette.inverse}}`,
].join("");

/** The same roles for an SVG source, which cannot name a theme key: mid-tones that hold on both grounds. */
export const SVG_PAINT = {
  muted: css(HUE.neutral),
  onFill: "#ffffff",
} as const;

/**
 * Colors of the mascots' own things: eyes, the floor, hats, glasses and the props of the Deck's scene. Hats and props
 * keep their natural colors (a chef's hat is white, a cowboy's brown), never a mood's; the mood colors come from HUE.
 * They are decoration: the light ones fade on a light terminal and the dark ones on a dark one, so each hat has a
 * second tone (its band, brim or trim) that holds where the first does not.
 */
export const PET_PALETTE = {
  shadow: "#000000",
  laneLight: "#ffffff",
  /** The light eyes of the desktop's mascots. */
  eye: 0xf4f4f4,
  /** The dark eyes of a pixel mascot, holes in its body. */
  eyeInk: 0x14110f,
  /** Pingo's body in a terminal: the terminal's own color, so it shows on a dark, a light and a colorless terminal. */
  body: TERMINAL_DEFAULT,
  /** The shadow under every pixel mascot. */
  floor: 0x585550,
  accents: {
    gold: "#e2b925",
    red: css(HUE.fail),
    glasses: "#1f2030",
    glassesEdge: "#f2de94",
    trim: "#efeeec",
  },
  props: {
    dark: 0x51565e,
    screen: HUE.info,
    glow: 0x7dc5c5,
    red: HUE.fail,
    blue: HUE.you,
    paper: 0xe6e4e1,
    page: 0xd5d1ca,
    gray: 0xa29e97,
    amber: HUE.warn,
    mark: 0x14110f,
  },
  confetti: [HUE.brand, HUE.ok, HUE.warn, HUE.plum, HUE.you],
  hats: {
    tophat: "#5a5478",
    party: css(HUE.plum),
    crown: "#cea620",
    wizard: "#4465dc",
    cowboy: "#845738",
    propeller: "#2a7ad7",
    chef: "#eae7e2",
    viking: "#8894a0",
    halo: "#e9c027",
    santa: "#d73337",
    nightcap: "#346bd5",
  },
  /** Each hat's second tone: the top hat's band, the chef's band, the viking's horns, the trim of the santa and night caps. */
  hatTrim: {
    tophat: css(HUE.fail),
    party: "#e2b925",
    crown: css(HUE.fail),
    wizard: "#e2b925",
    cowboy: "#5c3a22",
    propeller: css(HUE.fail),
    chef: "#bdb7aa",
    viking: "#e1d7bb",
    halo: "#cea620",
    santa: "#efeeec",
    nightcap: "#efeeec",
  },
} as const;

/**
 * Glyphs that say a state without color, all 7-bit ASCII so they read the same on any terminal and font. `( )` is a
 * mascot's balloon, `[ ]` a button, `|` the tab a line starts with, `>` the open item and whoever speaks, `*` work in
 * progress. A glyph wider than one column is noted where it is: anything measured beside it counts its real width.
 */
export const GLYPH = {
  ok: "+",
  warn: "!",
  fail: "x",
  ask: "?",
  /** What is happening now: the current step, a running agent. */
  run: "*",
  baseline: "o",
  idle: "-",
  /** Something on: a card's mark, someone speaking in the live log. */
  on: "#",
  /** Something off or not there yet. */
  off: ".",
  /** A switch that is on (three columns). */
  check: "[x]",
  /** A switch that is off (three columns, as wide as `check`). */
  unchecked: "[ ]",
  /** A filled cell of a meter. */
  fill: "#",
  /** An empty cell of a meter. */
  empty: ".",
  /** Two columns. */
  route: "->",
  /** The open screen on the rail, the chosen option in a list. */
  open: ">",
  /** The tab of a line above the prompt and of a Deck row, before its name. */
  tab: "|",
  rule: "-",
  /** Between parts of one line. */
  leader: "-",
  /** A child hanging off its parent (an agent under its plan): two columns. */
  branch: "`-",
  /** Between the screens' names where the rail folds into a line. */
  slash: "/",
  /** What a mascot on the Deck lane says, on the line under it. */
  speech: ">",
  /** In an autonomous agent's history: a check that failed, a run held back, a proposal turned down. */
  no: "x",
  /** In an autonomous agent's history: let through by the person as it was. */
  released: "~",
  /** The two ends of a button the plugin draws itself, as the host draws its own: `[ label ]`. */
  pillStart: "[",
  pillEnd: "]",
  /** A mascot's balloon on the Deck lane: `(Name: words)`. */
  balloonStart: "(",
  balloonEnd: ")",
  /** Where a text was cut (three columns). */
  ellipsis: "...",
  /** The ends of a meter: `[###...]`. */
  meterStart: "[",
  meterEnd: "]",
  /** Scroll marks of a fixed pane. */
  up: "^",
  down: "v",
} as const;

/** The host's border style for every frame: `+`, `-` and `|`. */
export const BORDER_STYLE = "classic";

/** The Deck's row marks, shared by its model status and renderers: the state of each row. */
