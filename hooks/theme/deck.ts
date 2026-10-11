

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
      /** A speaker's slot grows up to this many columns to show what it is doing after its name. */
      maximumBalloonColumns: 40,
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
