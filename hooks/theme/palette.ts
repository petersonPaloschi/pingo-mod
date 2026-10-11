

// Fichário, Pingo's visual identity. Every surface it draws (the /jev dashboard, the agent and feature panes, the
// lines above the prompt, the Deck band, the mascots) paints through these tokens, so a color is chosen once and
// means one thing.
//
// The idea is a binder: the screens are filed in three folders down a rail on the left, and what a screen says is
// written on cards: a rounded frame, a ■ and a label in capitals, the figure that matters in bold on its own line,
// a ▰▱ meter beside it. The mascots are pixel art on one grid, two pixels to a terminal cell, all of one size.
//
// Text takes theme keys: the host resolves them in the person's own theme, so text stays readable on a light or a
// dark terminal and in a color-blind theme. Fills, Raster cells and SVG cannot name a theme key; they take the hex
// form. The hues below were built in OKLCH at one lightness (L 0.62) and one share of each hue's own chroma, so none
// looks heavier than another: each keeps at least 3.3:1 against #1e1e1e and against #ffffff and 4.7:1 under
// PAINT.onFill, and the states land on distinct ANSI colors when a terminal has only 16 (sky `you` shares cyan with
// teal `info`; they never stand side by side). Every state also has a glyph, so nothing is told by color alone.

/** The terminal's own default color in a Raster cell: white on a dark terminal, black on a light one. */
export const TERMINAL_DEFAULT = 0x01000000;

/** Mid-tone hues as numbers (Raster cells take numbers): cards, meters, pills, the mascots' moods. */
export const HUE = {
  /** Mirtilo: Pingo's own color, the open screen, work in progress, the sonnet tier. */
  brand: 0x7f6fe7,
  /** Green: routed, done. */
  ok: 0x3d9e59,
  /** Amber: passthrough, a question, a limit filling up. */
  warn: 0xab8036,
  /** Red: failures. */
  fail: 0xe8424d,
  /** Papel teal: planning switched off, Pingo asleep, the haiku tier. */
  info: 0x3d9898,
  /** Sky: the person in the live log. */
  you: 0x3a8fc9,
  /** Plum: the opus tier. */
  plum: 0xd941b2,
  /** Stone: idle and empty, present but nothing to act on. */
  neutral: 0x8f8a80,
  /** Claude's own orange, for the main model. */
  claude: 0xd97757,
} as const;

/** Palette for Raster cells: meters, the timeline, the mascots' moods. */
export const DOT_PALETTE = {
  dim: HUE.neutral,
  /** Decoration only (an empty slot, the floor): about 3:1 on a dark terminal. */
  faint: 0x6c6861,
  route: HUE.ok,
  pass: HUE.warn,
  fail: HUE.fail,
  idle: HUE.neutral,
  base: HUE.info,
  brand: HUE.brand,
} as const;
/** Grays from dark to light, for the desktop's dotted sphere of Pingo (the terminal draws pixel art instead). */
export const DOT_DEPTH = [0x2c2f36, 0x434750, 0x676c78, 0x9a9fab, 0xc9ccd4, 0xe9ebef] as const;

/** The five subagent mascots, one hue each at the same lightness as the cast's. */
export const AGENT_MASCOT_PALETTE = {
  tetra: 0x4895a0,
  gem: 0xda4c83,
  can: 0x789342,
  coil: 0xb87641,
  cone: 0x988741,
} as const;

/** One body color per feature mascot on the Deck lane, apart from Jev's mirtilo and the subagents' hues. */
export const FEATURE_MASCOT_PALETTE = {
  clareza: 0x4792b3,
  semente: 0x5a9b42,
  farol: 0xa48241,
  vigia: 0x9c68df,
  sentinela: 0xd64c93,
  prisma: 0x48978f,
  lapida: 0xca6840,
  contexto: 0x908676,
  /** Royal blue, the person's choice for Code Quality (2026-10-10). */
  codeQuality: 0x4560d8,
  /** Brass: the Comandante's insignia. */
  comandante: 0x898d50,
  // the autonomous agents, the person's "Joias" set (2026-10-11); Rumo has none: Jev speaks for it
  /** Raspberry: Portão, the gate before a commit or a push. */
  portao: 0xcf616d,
  /** Jade: Ensaio, which runs the app. */
  ensaio: 0x109d7b,
  /** Olive gold: Chaveiro, the keys to the permissions. */
  chaveiro: 0x929300,
  /** Steel: Oficina, the checkup of Claude Code itself. */
  oficina: 0x758099,
} as const;

/**
 * The darker tone of each body color, for the underside of a pixel mascot (and Jev's, under the brand): the same hue
 * 0.13 lower in OKLCH lightness. A color with no entry is drawn flat.
 */
export const MASCOT_SHADE: ReadonlyMap<number, number> = new Map([
  [HUE.brand, 0x5b4bb2],
  [HUE.ok, 0x1a7439],
  [HUE.warn, 0x805b16],
  [HUE.fail, 0xb21d2f],
  [HUE.info, 0x1a7070],
  [HUE.you, 0x186899],
  [HUE.plum, 0xa51e86],
  [HUE.neutral, 0x68645c],
  [AGENT_MASCOT_PALETTE.tetra, 0x286d76],
  [AGENT_MASCOT_PALETTE.gem, 0xa62a5e],
  [AGENT_MASCOT_PALETTE.can, 0x556b23],
  [AGENT_MASCOT_PALETTE.coil, 0x8a5223],
  [AGENT_MASCOT_PALETTE.cone, 0x706122],
  [FEATURE_MASCOT_PALETTE.clareza, 0x276a87],
  [FEATURE_MASCOT_PALETTE.semente, 0x3a7223],
  [FEATURE_MASCOT_PALETTE.farol, 0x7a5d22],
  [FEATURE_MASCOT_PALETTE.vigia, 0x7345ac],
  [FEATURE_MASCOT_PALETTE.sentinela, 0xa32a6b],
  [FEATURE_MASCOT_PALETTE.prisma, 0x276f68],
  [FEATURE_MASCOT_PALETTE.lapida, 0x994522],
  [FEATURE_MASCOT_PALETTE.contexto, 0x696053],
  [FEATURE_MASCOT_PALETTE.codeQuality, 0x293ba2],
  [FEATURE_MASCOT_PALETTE.comandante, 0x636631],
  [FEATURE_MASCOT_PALETTE.portao, 0xa33948],
  // jade and olive gold leave the screen's gamut 0.13 lower: their shades keep about 80% of the chroma
  [FEATURE_MASCOT_PALETTE.ensaio, 0x007258],
  [FEATURE_MASCOT_PALETTE.chaveiro, 0x6b6b00],
  [FEATURE_MASCOT_PALETTE.oficina, 0x505a72],
]);
export const shadeOf = (color: number): number => MASCOT_SHADE.get(color) ?? color;

/** Animated Deck fills: a darker moving head and a light sweep of the brand mirtilo, never used for text. */
