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
]);
export const shadeOf = (color: number): number => MASCOT_SHADE.get(color) ?? color;

/** Animated Deck fills: a darker moving head and a light sweep of the brand mirtilo, never used for text. */
export const DECK_ACCENT = {
  headDim: 0x5e4bb5,
  shine: 0xa8a0ff,
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

export const FONT_WEIGHT = { regular: 400, medium: 500, semibold: 600 } as const;

/** Visual parameters shared by the Deck's SVG, terminal-cell and mascot renderers. */
export const DECK_DESIGN = {
  type: {
    svg: "'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,sans-serif",
    svgBaselinePixels: 15,
    svgWeights: FONT_WEIGHT,
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
    tier: { selectedOpacity: 1, inactiveOpacity: 0.16, requestedStrokeDashArray: "2 2" },
    historySquare: {
      applied: { y: 7.5, sizePixels: 7, radiusPixels: 2, opacity: 0.85 },
      none: { xInsetPixels: 0.5, y: 8, sizePixels: 6, radiusPixels: 2 },
      suggested: { xInsetPixels: 0.75, y: 8.25, sizePixels: 5.5, radiusPixels: 1.75, strokeWidth: 1.5 },
    },
    riskyDisplayThreshold: 0.7,
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
      colorThreshold: 0.6,
      labelGapPixels: 6,
      trackY: 8,
      trackWidthPixels: 44,
      trackHeightPixels: 6,
      trackRadiusPixels: 3,
      trackOpacity: 0.25,
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
      pixelBase: "#82807b",
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
    minimumVisibleNameCharacters: 4,
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
    /**
     * The lines the features write above the prompt (Farol, Clareza, Semente, Lapida, Sentinela, Vigia), however long
     * or many their messages: together they take at most `maxRows` terminal rows, the "+N" line naming the ones left
     * out included. Each message is cut to its line with "…" and is whole in its feature's pane, which pressing it
     * opens. The Deck band beneath them gets the rows the engine allows less these and the Jev band's, so the whole
     * stack above the prompt fits the engine's `maxRows`; only a band too short even for the pet's lane, the header
     * and the two rows the Deck always keeps still scrolls.
     */
    messages: {
      maxRows: 3,
      /** Columns a message's words keep before its other parts (another term, another name) give way to a "+N". */
      minimumTextColumns: 12,
    },
    /** The line under the pet lane where a feature mascot speaks: its words keep at least this many columns. */
    speech: { minimumTextColumns: 12 },
    /** The header line doubles as the rule between the lane and the rows: a ─ fills it, never shorter than this. */
    header: { minimumRuleColumns: 3 },
    /**
     * The band's main buttons (its toggle, "open" on the speech line) are pills: the label on the brand's ground
     * between two half blocks of it. `columns` is what the half blocks and the spaces inside add to the label.
     */
    pill: { columns: 4 },
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
      barReservedColumns: 11,
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
      /** Blank terminal rows between the switches and the rows under them, counted in the band's budget. */
      spacerRows: 1,
    },
    collapsed: {
      gap: { desktop: 4, terminal: 3 },
      desktop: { reservePixels: 140, extraPixelsPerChar: 7.5, titlePixelsPerChar: 8.5, itemPaddingPixels: 76 },
      /** `reserveColumns` holds the toggle's pill and its key ahead of the chips. */
      terminal: { reserveColumns: 14, extraColumnsPerChar: 1, itemPaddingColumns: 10 },
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
    body: {
      width: 48,
      height: 38,
      viewBox: "-4 -6 48 38",
      size: 34,
      x: 20,
      floorY: 29.5,
      shadow: { jumpRadiusPixels: 8, restRadiusPixels: 12, radiusYPixels: 1.6, opacity: 0.35 },
    },
    /** The pet in a terminal: 12 columns by 4 rows of half blocks, a grid of 12 by 8 pixels. */
    sprite: { columns: 12, rows: 4 },
    /** A cast member in a terminal: 8 columns by 4 rows, 8 by 8 pixels. */
    member: { columns: 8, rows: 4 },
    props: { sleepZFontPixels: 6, sleepZSmallFontPixels: 4.5, alertMarkFontPixels: 7 },
    lane: {
      desktopHeight: 62,
      desktopBandHeight: { compact: 44, roomy: 54 },
      desktopScale: 1.05,
      bodyGap: 2,
      backgroundSpacing: 12,
      backgroundDots: { minimumScale: 1, startX: 4, yInsetPixels: 4, widthPixels: 4, heightPixels: 1, opacity: 0.07 },
      sidePadding: 2,
      maximumColumns: 512,
    },
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
    desktop: {
      memberPaddingPixels: 10,
      labelPaddingPixels: 8,
      memberShadow: { radiusRatio: 0.32, radiusYPixels: 1.4, opacity: 0.3 },
      /** The speaker's name in a balloon: its padding, corner radius and the tail pointing down at the body. */
      balloon: { paddingPixels: 3, radiusPixels: 4, tailPixels: 3 },
    },
    motion: { hopSeconds: 0.6, askingSeconds: 0.5, eyeSpinSeconds: 0.8, hopEasing: "cubic-bezier(.3,.6,.4,1)" },
  },
} as const;

/** A number color as the "#rrggbb" a Text, Box or SVG paints with. */
export const css = (color: number) => "#" + (color & 0xffffff).toString(16).padStart(6, "0");

/** WCAG relative luminance of a 0xRRGGBB color. */
function luminance(color: number): number {
  const linear = (channel: number) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear((color >> 16) & 255) + 0.7152 * linear((color >> 8) & 255) + 0.0722 * linear(color & 255);
}

/** The near-black ink for words on a mid-tone fill, as a number: the same as PAINT.onFill. */
const FILL_INK = 0x14110f;
const WHITE = 0xffffff;

/**
 * The ink for words on `fill`: the warm near-black, which holds at least 4.7:1 on every hue of the palette, or white
 * on a fill too dark for it (Code Quality's royal blue, the person's own choice, gives the near-black only 3.5:1).
 */
export function inkOn(fill: number): number {
  const ground = luminance(fill & 0xffffff);
  return (ground + 0.05) / (luminance(FILL_INK) + 0.05) >= 4.5 ? FILL_INK : WHITE;
}

/** Text roles as theme keys (the host's names), plus the hues text may carry. */
export const PAINT = {
  /** Values, headings, anything read first. */
  text: "text",
  /** Labels, notes and help: secondary, still readable on both grounds. */
  muted: "inactive",
  /** Card frames, tracks and separators: decoration only, never the one place a fact is written. */
  rule: "subtle",
  ok: "success",
  warn: "warning",
  fail: "error",
  claude: "claude",
  brand: css(HUE.brand),
  you: css(HUE.you),
  info: css(HUE.info),
  plum: css(HUE.plum),
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
    /** Columns a card's frame and air take from its width: a border and one column of air on each side. */
    indent: 4,
    /** Columns between cards side by side. */
    gutter: 1,
    minCardWidth: 10,
    /** Columns the host adds after a plain button for its key: a space and the key in angle quotes. */
    hotkeyColumns: 4,
    /** The narrowest card a row of cards keeps: two fit beside the rail in an 80-column pane, three at 130. */
    gridMinWidth: 28,
    gridMaxColumns: 3,
    configurationTwoColumnMinWidth: 80,
    /** The rail of screens down the left: its narrowest, the pane width and height it needs, and the gap after it. */
    rail: { minColumns: 18, minPaneWidth: 64, minRows: 24, gap: 1 },
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

/** Glyphs that say a state without color, and the pieces of the binder. */
export const GLYPH = {
  ok: "✓",
  warn: "!",
  fail: "×",
  ask: "?",
  /** What is happening now: the current step, a running agent. */
  run: "◆",
  baseline: "◌",
  idle: "–",
  /** Something on: a switch that is on, a card's label, someone speaking in the live log. */
  on: "■",
  /** Something off or not there yet; a switch that is off. */
  off: "□",
  /** A switch that is on: a ticked box beside the empty one. */
  check: "▣",
  /** A filled cell of a meter. */
  fill: "▰",
  /** An empty cell of a meter. */
  empty: "▱",
  route: "→",
  /** The open screen on the rail, the chosen option in a list. */
  open: "▸",
  /** The tab of a line above the prompt and of a Deck row: a stripe in its color before its name. */
  tab: "▌",
  rule: "─",
  /** Between parts of one line. */
  leader: "·",
  /** A child hanging off its parent (an agent under its plan). */
  branch: "╰",
  /** Between the screens' names where the rail folds into a line. */
  slash: "/",
  /** What a mascot on the Deck lane says, on the line under it. */
  speech: "»",
  /** The two ends of a pill button: half blocks of its ground, so without color they still close it like brackets. */
  pillStart: "▐",
  pillEnd: "▌",
} as const;

/** The Deck's row marks, shared by its model status and renderers: the state of each row. */
export const DECK_GLYPH = {
  run: GLYPH.run,
  ask: GLYPH.ask,
  hot: GLYPH.warn,
  done: GLYPH.ok,
  ok: "◔",
  warn: "◑",
} as const;
export type DeckGlyphName = keyof typeof DECK_GLYPH;

/** The Deck's "Dots" bar style draws dots, whatever the binder's own marks are: a full, a half, an empty, the current. */
export const DECK_DOTS = { full: "●", half: "◐", empty: "○", now: "◉" } as const;

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
