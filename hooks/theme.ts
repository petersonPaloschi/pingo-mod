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

/** Palette for dot raster cells and the Pingo sphere's depth shading. */
export const DOT_PALETTE = {
  dim: HUE.neutral,
  faint: 0x6b7280,
  route: HUE.ok,
  pass: HUE.warn,
  fail: HUE.fail,
  idle: HUE.neutral,
  base: HUE.info,
  brand: HUE.brand,
} as const;
export const DOT_DEPTH = [0x2c2f36, 0x434750, 0x676c78, 0x9a9fab, 0xc9ccd4, 0xe9ebef] as const;

/** Distinct but related accents for the five subagent mascots. */
export const AGENT_MASCOT_PALETTE = {
  tetra: 0x67d4e6,
  gem: 0xf78fc6,
  can: 0xc3e88d,
  coil: 0xffb38a,
  cone: 0xe9e09a,
} as const;

/** Animated Deck fills: a darker moving head and a light sweep of the brand lime, never used for text. */
export const DECK_ACCENT = {
  headDim: 0x5d7216,
  shine: 0xb3c96a,
} as const;

/** One registry for the styles offered on both render surfaces; order and labels stay surface-specific. */
export const DECK_STYLE_ORDER = {
  desktop: ["pixel", "segments", "line", "solid", "dots", "spark"],
  terminal: ["segments", "line", "solid", "dots", "pixel", "spark"],
} as const;
export type DeckStyleName = (typeof DECK_STYLE_ORDER.desktop)[number];
const DECK_STYLE_LABELS = { pixel: "Pixel", segments: "Segments", line: "Line", solid: "Solid", dots: "Dots", spark: "Spark" } as const;
export const DECK_STYLE_NAMES = {
  desktop: DECK_STYLE_LABELS,
  terminal: { ...DECK_STYLE_LABELS, pixel: "Pixel dots" },
} as const satisfies Record<"desktop" | "terminal", Record<DeckStyleName, string>>;

/** Visual parameters shared by the Deck's SVG, terminal-cell and mascot renderers. */
export const DECK_DESIGN = {
  type: {
    svg: "'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,sans-serif",
    svgBaselinePixels: 15,
    svgWeights: { regular: 400, medium: 500, semibold: 600 },
    svgBodyPixels: 12,
    svgSmallPixels: 11.5,
    svgTinyPixels: 10,
    svgTagPixels: 10.5,
    measure: {
      defaultPixelsPerChar: 6.7,
      labelPixelsPerChar: 6.4,
      reasonPixelsPerChar: 6.6,
      countPixelsPerChar: 6.5,
      countGapPixels: 6,
      rateGapPixels: 8,
      stripNamePixelsPerChar: 6.9,
      modelTagPixelsPerChar: 6,
      narrowPixelsPerChar: 3.4,
      widePixelsPerChar: 9.5,
      fullWidthPixelsPerChar: 12,
    },
  },
  route: {
    fromGapPixels: 6,
    directionGapPixels: 14,
    keptLabelGapPixels: 8,
    keptPillGapPixels: 12,
    reasonGapPixels: 10,
    hintGapPixels: 10,
    tierGapPixels: 4,
    tierSectionGapPixels: 8,
    pill: { y: 3, height: 16, radius: 4, horizontalPaddingPixels: 7 },
    effort: {
      barCount: 4,
      baselinePixels: 17,
      minimumHeightPixels: 3,
      heightStepPixels: 3,
      widthPixels: 5,
      gapPixels: 2,
      radiusPixels: 1.5,
      inactiveOpacity: 0.25,
      reservedWidthPixels: 32,
      labelGapPixels: 14,
    },
    confidence: {
      labelGapPixels: 6,
      trackY: 8,
      trackWidthPixels: 44,
      trackHeightPixels: 6,
      trackRadiusPixels: 3,
      trackValueGapPixels: 6,
      valueGapPixels: 14,
    },
    riskyGapPixels: 10,
    unappliedGapPixels: 10,
  },
  breakpoints: { narrowWidth: 360 },
  motion: {
    frameMs: 150,
    glideSeconds: 0.45,
    glideThresholdPixels: 0.5,
    solidSweepSeconds: 2.4,
    easing: ".2 .8 .2 1",
    foldStepMs: 35,
    foldFadeMs: 220,
    foldRisePixels: 5,
    unfoldEasing: "cubic-bezier(.22,1,.36,1)",
    progressPulseSeconds: 1.2,
    sparkPulseSeconds: 1.6,
    stripPulseSeconds: 1.1,
    toolChangeSeconds: 0.2,
    toolChangeBlurPixels: 3,
    toolChangeEasing: { enter: "ease-out", exit: "ease-in" },
    twinkle: {
      activeSeconds: [2.2, 2.8, 1.9, 3.3],
      doneSeconds: [3.2, 3.8, 4.4, 3.5],
      phaseSeconds: [0, 0.7, 1.3, 0.4],
      activeOpacity: 0.45,
      doneOpacity: 0.8,
      easing: "ease-in-out",
    },
  },
  bar: {
    height: 22,
    rightWidth: 92,
    compactPadding: 3,
    desktop: {
      minimumShare: 80,
      shareRatio: 0.62,
      pillMinimumWidth: 80,
      pillMaximumShare: 0.55,
      segmentMin: 8,
      segmentMax: 40,
      segmentWidth: 9,
      segmentGap: 2,
      dotCount: 10,
      stepLimit: 16,
      dotStartX: 8,
      dotSpacing: 16,
      stepGapMinimum: 12,
      stepGapMaximum: 26,
      stepGapReserve: 16,
      stepConnectorInset: 5,
      stepConnectorHeight: 1.5,
      stepConnectorActiveOpacity: 0.8,
      stepConnectorIdleOpacity: 0.3,
      dotRadius: 5,
      stepActiveCoreRadius: 2.4,
      stepIdleRadius: 4.5,
      stepActiveStrokeWidth: 2,
      stepIdleStrokeWidth: 1.5,
      stepIdleOpacity: 0.45,
      dotIdleOpacity: 0.2,
      sparkMinWidth: 60,
      sparkRatio: 0.26,
      sparklineMinimumWidth: 60,
      sparklineRatio: 0.3,
      historyLimit: 30,
      pixelBase: "#84828a",
      pixelLightMix: 0.32,
      svg: {
        pill: { iconWidthPixels: 16, nameWidthReservePixels: 20, minimumNameCharacters: 3, leftInsetPixels: 10, iconTopPixels: 5, iconScale: 0.5, iconStrokeWidth: 3.6, labelBaselineOffsetPixels: 4.2, countOpacity: 0.75 },
        pixel: {
          columnPitchPixels: 3,
          sampleOffsetPixels: 1.5,
          rowCount: 7,
          topInsetPixels: 1,
          rowPitchPixels: 3,
          cellPixels: 2,
          bucketCount: 5,
          bucketDivisor: 4,
          bucketIndexCeiling: 4.99,
          doneDensity: 0.8,
          startDensity: 0.22,
          densityRange: 0.78,
          densityExponent: 1.5,
          bucketCurveExponent: 0.9,
          bucketCurveScale: 1.1,
          densityOpacityBase: 0.35,
          densityOpacityRange: 0.65,
          trackOpacity: 0.16,
          gradient: { doneStartOpacity: 0.3, activeStartOpacity: 0.05, endOpacity: 0.33 },
          marks: { passedInsetPixels: 1, stageInsetPixels: 1, regularInsetPixels: 0.75, stageWidthPixels: 2, regularWidthPixels: 1.5, regularHeightPixels: 8, radiusPixels: 0.75, passedStageOpacity: 0.95, passedRegularOpacity: 0.6, futureStageOpacity: 0.7, futureRegularOpacity: 0.45 },
        },
        segments: { y: 5, heightPixels: 12, radiusPixels: 2, stageInsetPixels: 2, headOpacity: 0.5, trackOpacity: 0.18, labelGapPixels: 12 },
        line: {
          marks: { stageY: 6, regularY: 8, widthPixels: 1.5, stageHeightPixels: 10, regularHeightPixels: 6, radiusPixels: 0.75, opacity: 0.7 },
          track: { y: 10, heightPixels: 2, radiusPixels: 1, opacity: 0.25 },
          fill: { y: 9.5, heightPixels: 3, radiusPixels: 1.5 },
          head: { y: 11, radiusPixels: 4, pulseRadii: [4, 5.5, 4] },
          labelGapPixels: 14,
        },
        dots: { labelGapPixels: 6 },
        solid: { clipRadiusPixels: 6, trackOpacity: 0.16, labelX: 10, sweepStartX: -60, sweepWidthPixels: 60, sweepOpacity: 0.18 },
        spark: {
          barY: 7,
          barHeightPixels: 8,
          barRadiusPixels: 4,
          trackOpacity: 0.2,
          historyGapPixels: 14,
          chartBaselineY: 18,
          chartHeightPixels: 14,
          chartStrokeWidth: 1.6,
          dotRadiusPixels: 2.6,
          dotPulseRadii: [2.6, 3.6, 2.6],
          fallbackY: 10.5,
          fallbackHeightPixels: 1,
          fallbackOpacity: 0.3,
          labelGapPixels: 14,
        },
      },
    },
    terminal: {
      minimumWidth: 6,
      labelReserve: 8,
      shareRatio: 0.58,
      preferredMinimum: 10,
      dotCount: 10,
      stepLimit: 16,
      sparkMinWidth: 3,
      sparkMaxWidth: 18,
      sparkRatio: 0.22,
      historyLimit: 24,
      render: {
        labels: { minimumCharacters: 3, gapColumns: 2, countGapColumns: 1, rateGapColumns: 2, contentPaddingColumns: 1 },
        animation: { frameCycle: 4, activeFrames: 2, solidSweepStep: 2, solidSweepExtraColumns: 12, solidSweepStartColumns: 6, inactiveSweepOffset: 99, shineRadiusColumns: 2 },
        dots: { minimumBarColumns: 6, labelReserveColumns: 8, partialThreshold: 0.4 },
        pixel: { minimumPillCharacters: 4, labelReserveColumns: 4, sampleOffset: 1, densityStart: 0.15, densityRange: 0.8, noiseBase: 0.6, noiseRange: 0.4, animationFrameShift: 1 },
        spark: { maximumNameCharacters: 24, tailReserveColumns: 3, historyGapColumns: 1, minimumHistoryRoomColumns: 4, animationRoomColumns: 8, animationCells: 8 },
      },
    },
  },
  strips: {
    height: 18,
    gap: 3,
    textFill: "#F0EEFC",
    backgroundOpacity: 0.15,
    hiddenOpacity: 0.14,
    secondaryOpacity: 0.65,
    statePulseOpacity: 0.3,
    indentPixels: 12,
    narrowNameReservePixels: 30,
    nameWidthRatio: 0.45,
    nameStartPixels: 19,
    toolGapPixels: 12,
    textBaselinePixels: 12.5,
    timeRightInsetPixels: 9,
    stateDot: { x: 10, radius: 3 },
    modelTag: { textPaddingPixels: 12, boxRightInsetPixels: 52, textRightInsetPixels: 46, topPixels: 3, heightPixels: 12, radiusPixels: 3, fillOpacity: 0.25 },
    texture: {
      columnPitchPixels: 3,
      rowCount: 4,
      rowPitchPixels: 3.6,
      topInsetPixels: 3,
      cellPixels: 2,
      runSeedOffset: 41,
      patternSeed: 5,
      density: 0.2,
      paletteSeed: 6,
      paletteBuckets: 4,
      opacity: 0.32,
    },
  },
  band: {
    pixelsPerColumn: 8,
    titleMaxChars: 22,
    titleMaxPixels: 160,
    defaultMaxRows: 14,
    defaultPanelColumns: 100,
    headerPetHeight: 28,
    headerPetScale: 0.7,
    minimumDesktopWidth: 320,
    desktop: {
      titleWidthRatio: 0.28,
      trackMinimumWidth: 120,
      trackMaximumWidth: 1400,
      trackReservePixels: 70,
      inlinePetMinimumWidth: 80,
      inlinePetReservedPixels: 170,
      inlinePetExtraPixelsPerChar: 7.5,
    },
    terminal: {
      minimumRows: 2,
      labelMinimumColumns: 10,
      labelMaximumColumns: 22,
      labelRatio: 0.18,
      rightValueColumns: 11,
      barReservedColumns: 9,
      valueColumns: 4,
      agentLabelMinimumColumns: 8,
      agentLabelInsetColumns: 2,
    },
    /** The expanded band's feature switches: a title line, then the switches packed into lines under it. */
    features: {
      /** Columns the title and the switch lines sit in from the band's left edge, under the rows' titles. */
      indent: 2,
      /** Terminal columns between two switches on one line. */
      columnGap: 2,
      /** Desktop spacing between switches, across and between wrapped lines. */
      desktopColumnGap: 3,
      desktopRowGap: 0,
      /** Data rows a terminal band keeps below the switches; with less room the switches wait for the Deck pane. */
      minimumRows: 2,
    },
    collapsed: {
      gap: { desktop: 4, terminal: 3 },
      desktop: { reservePixels: 140, extraPixelsPerChar: 7.5, titlePixelsPerChar: 8.5, itemPaddingPixels: 76 },
      terminal: { reserveColumns: 10, extraColumnsPerChar: 1, itemPaddingColumns: 10 },
    },
  },
  ring: {
    size: 22,
    center: 11,
    radius: 8.5,
    strokeWidth: 2.2,
    trackOpacity: 0.3,
    startAngleDegrees: -90,
    icons: {
      week: { x: 7.2, y: 7.6, widthPixels: 7.6, heightPixels: 7, radiusPixels: 1.2, headerHeightPixels: 2, strokeWidth: 1.3 },
      clock: { handPath: "M11 7.2V11l2.4 1.6", strokeWidth: 1.4 },
    },
  },
  rows: { stripGapPixels: 5, rightValueInsetPixels: 4, rightValueBaselineOffsetPixels: 4.2 },
  miniBar: { width: 36, height: 8, minimumVisibleFill: 4 },
  stylePicker: {
    desktopMinWidth: 200,
    desktopMaxWidth: 420,
    desktopReservedPixels: 160,
    terminalMinWidth: 24,
    terminalMaxWidth: 48,
    terminalReservedColumns: 26,
    nameWidth: 14,
    columnGap: 2,
    rowGap: 1,
  },
  pet: {
    speed: { walk: 0.035, run: 0.11 },
    body: { width: 48, height: 38, viewBox: "-4 -6 48 38", size: 34, x: 20, floorY: 29.5 },
    braille: { columns: 12, rows: 4 },
    props: { sleepZFontPixels: 6, sleepZSmallFontPixels: 4.5, alertMarkFontPixels: 7 },
    lane: { desktopHeight: 62, desktopBandHeight: { compact: 44, roomy: 54 }, desktopScale: 1.05, bodyGap: 2, backgroundSpacing: 12, sidePadding: 2, maximumColumns: 512 },
    motion: {
      breatheSeconds: 2.4,
      sleepSeconds: 3,
      walkSeconds: 0.6,
      runSeconds: 0.28,
      jumpSeconds: 1,
      shakeSeconds: 0.3,
      confettiSeconds: 1,
      confettiDelaySeconds: 0.22,
      sleepZSeconds: 2,
      sleepZDelaySeconds: 0.9,
      glowSeconds: 0.4,
      glowLowOpacity: 0.55,
      puffSeconds: 0.5,
      puffDelaySeconds: 0.25,
      puffScale: [0.6, 1.3],
      puffOpacity: 0.7,
      breatheScale: 0.965,
      bobPixels: 1.2,
      jumpPixels: 12,
      shakePixels: 1,
      confettiPixels: 16,
      sleepZX: 6,
      sleepZY: 14,
      puffPixels: 8,
    },
  },
  cast: {
    joinMs: 1200,
    leaveMs: 1500,
    lane: {
      labelHeight: 12,
      labelBaselineInsetPixels: 3,
      memberPixels: 24,
      namePixels: 6,
      memberWidthPaddingColumns: 2,
      labelPaddingColumns: 1,
      maximumLabelColumns: 16,
    },
    desktop: { memberPaddingPixels: 10, labelPaddingPixels: 8 },
    motion: { hopSeconds: 0.6, askingSeconds: 0.5, eyeSpinSeconds: 0.8, hopEasing: "cubic-bezier(.3,.6,.4,1)" },
  },
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
    indent: 3,
    gutter: 3,
    minCardWidth: 10,
    gridMinWidth: 34,
    gridMaxColumns: 2,
    viewport: { minimumColumns: 40, panelColumns: 60, defaultColumns: 80, defaultRows: 30 },
  },
} as const;

/** The same roles for an SVG source, which cannot name a theme key: mid-tones that hold on both grounds. */
export const SVG_PAINT = {
  muted: css(HUE.neutral),
  onFill: "#ffffff",
} as const;

/** Colors specific to the mascot's props and cast; the main mood colors continue to come from HUE. */
export const PET_PALETTE = {
  shadow: "#000000",
  laneLight: "#ffffff",
  eye: 0xf4f4f4,
  accents: {
    gold: "#ffd23f",
    red: "#e0245e",
    glasses: "#17171d",
    glassesEdge: "#ffe66d",
    trim: "#cfcfcf",
  },
  props: {
    dark: 0x4a4a48,
    screen: 0x5dcaa5,
    red: 0xe5484d,
    blue: 0x378add,
    paper: 0xf2f0ea,
    page: 0xe8e4da,
    gray: 0x9a9893,
    amber: 0xe09a1e,
    mark: 0x412402,
  },
  confetti: [0xeba83a, 0x9c95ec, 0x5dcaa5, 0xe2706f],
  hats: {
    tophat: "#454551",
    party: css(HUE.plum),
    crown: "#ffd23f",
    wizard: css(HUE.you),
    cowboy: "#8b5a2b",
    propeller: "#3c7be0",
    chef: "#f4f4f4",
    viking: "#9aa3ad",
    halo: "#ffc400",
    santa: "#e03c3c",
    nightcap: "#3c7be0",
  },
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
export type DeckGlyphName = keyof typeof DECK_GLYPH;

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
