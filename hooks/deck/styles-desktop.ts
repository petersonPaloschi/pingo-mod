// Desktop bar styles as SVG markup, sized by DECK_DESIGN.bar.height, plus agent strips. Pure, no I/O.
// The pixel style and the strips adapt plan-progress (zycck/claude-mods, MIT, Kirill Serditov).
import { AGENT_STYLE, DECK_DESIGN, DECK_STYLE_NAMES, DECK_STYLE_ORDER, STYLE, SVG_ON_FILL, SVG_TEXT, SVG_TRACK, hash, seedOf, esc, textWidth, hex, mix, rgb, type AgentRow, type AgentView, type DeckStyleName, type Row, type Style, type StyleName } from "./theme.ts";
import { elapsed } from "./model.ts";

export const DESKTOP_STYLES = DECK_STYLE_ORDER.desktop;
export type DesktopStyle = DeckStyleName;
export const DESKTOP_STYLE_NAMES: Record<DesktopStyle, string> = DECK_STYLE_NAMES.desktop;

/** The lastHead / lastStrip memories: where each bar or strip was last drawn, so it can glide. */
export type LastHead = Map<string, number>;
export interface LastStrip {
  tool: string;
  color: string;
}

const H = DECK_DESIGN.bar.height;
const FONT = DECK_DESIGN.type.svg;
const NARROW = DECK_DESIGN.breakpoints.narrowWidth;
const SVG = DECK_DESIGN.bar.desktop.svg;

const ICON_PATH: Partial<Record<StyleName, string>> = {
  ask: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
  hot: "M18 6 6 18M6 6l12 12",
  done: "M20 6 9 17l-5-5",
};

// twinkle classes keep their phase across redraws
export function twinkleCss(nowMs: number, done: boolean): string {
  const t = nowMs / 1000;
  const { activeSeconds, doneSeconds, phaseSeconds, activeOpacity, doneOpacity } = DECK_DESIGN.motion.twinkle;
  const durs = done ? doneSeconds : activeSeconds;
  let css = "";
  durs.forEach((d, i) => {
    css += `.t${i}{animation:tw ${d}s ${DECK_DESIGN.motion.twinkle.easing} infinite;animation-delay:-${((t + phaseSeconds[i]!) % d).toFixed(2)}s}`;
  });
  return css + `@keyframes tw{0%,100%{opacity:1}50%{opacity:${done ? doneOpacity : activeOpacity}}}@media (prefers-reduced-motion:reduce){.t0,.t1,.t2,.t3{animation:none}}`;
}

function glideFrom(lastHead: LastHead, id: string, fx: number): number {
  const from = lastHead.get(id) ?? fx;
  lastHead.set(id, fx);
  return from;
}

const EASE = `calcMode="spline" keyTimes="0;1" keySplines="${DECK_DESIGN.motion.easing}"`;

function pillMarkup(row: Row, W: number, fx: number, from: number, st: Style): string {
  const icon = ICON_PATH[row.style];
  const color = st.desk;
  const layout = SVG.pill;
  let knob: string;
  let kw: number;
  if (W < NARROW) {
    kw = H;
    knob = `<circle cx="0" cy="${H / 2}" r="${H / 2}" fill="${color}"/>`;
  } else {
    const iconW = icon ? layout.iconWidthPixels : 0;
    const countW = row.count ? textWidth(row.count, DECK_DESIGN.type.measure.countPixelsPerChar) + DECK_DESIGN.type.measure.countGapPixels : 0;
    const maxW = Math.max(DECK_DESIGN.bar.desktop.pillMinimumWidth, W * DECK_DESIGN.bar.desktop.pillMaximumShare);
    let shown = row.name;
    while (shown.length > layout.minimumNameCharacters && layout.nameWidthReservePixels + iconW + textWidth(shown) + countW > maxW) shown = shown.slice(0, -1);
    if (shown !== row.name) shown = shown.trimEnd() + "…";
    kw = Math.round(layout.nameWidthReservePixels + iconW + textWidth(shown) + countW);
    const left = -kw / 2 + layout.leftInsetPixels;
    knob = `<rect x="${-kw / 2}" y="0" width="${kw}" height="${H}" rx="${H / 2}" fill="${color}"/>`;
    if (icon) knob += `<path d="${icon}" transform="translate(${left} ${layout.iconTopPixels}) scale(${layout.iconScale})" fill="none" stroke="${SVG_ON_FILL}" stroke-width="${layout.iconStrokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    knob += `<text x="${left + iconW}" y="${H / 2 + layout.labelBaselineOffsetPixels}" style="font:${DECK_DESIGN.type.svgWeights.medium} ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${SVG_ON_FILL}">${esc(shown)}${row.count ? `<tspan dx="${DECK_DESIGN.type.measure.countGapPixels}" style="font-weight:${DECK_DESIGN.type.svgWeights.regular};fill-opacity:${layout.countOpacity}">${esc(row.count)}</tspan>` : ""}</text>`;
  }
  const at = (x: number) => Math.max(kw / 2, Math.min(W - kw / 2, x >= kw ? x - kw / 2 : x + kw / 2));
  const kx = at(fx);
  const kFrom = at(from);
  const glide = Math.abs(kFrom - kx) > DECK_DESIGN.motion.glideThresholdPixels ? `<animateTransform attributeName="transform" type="translate" from="${kFrom.toFixed(1)} 0" to="${kx.toFixed(1)} 0" dur=".45s" ${EASE} fill="freeze"/>` : "";
  return `<g transform="translate(${kx.toFixed(1)} 0)">${glide}${knob}</g>`;
}

function pixel(row: Row, W: number, nowMs: number, lastHead: LastHead): string {
  const design = SVG.pixel;
  const done = row.style === "done";
  const st = STYLE[row.style];
  const fx = (Math.max(0, Math.min(100, row.pct)) / 100) * W;
  const from = glideFrom(lastHead, row.id, fx);
  const acc = hex(st.desk);
  const light = mix(acc, [255, 255, 255], DECK_DESIGN.bar.desktop.pixelLightMix);
  const grey = hex(DECK_DESIGN.bar.desktop.pixelBase);
  const seed = Math.abs(seedOf(row.id) % 997);
  const buckets = Array.from({ length: design.bucketCount }, (_, b) => {
    const m = b / design.bucketDivisor;
    const dense = done ? design.doneDensity : design.startDensity + design.densityRange * Math.pow(m, design.densityExponent);
    return { color: rgb(done ? light : mix(grey, light, m)), opacity: (design.densityOpacityBase + design.densityOpacityRange * dense).toFixed(2) };
  });
  let px = "";
  for (let col = 0; col * design.columnPitchPixels < fx; col++) {
    const x = col * design.columnPitchPixels;
    const u = Math.min(1, (x + design.sampleOffsetPixels) / fx);
    const dense = done ? design.doneDensity : design.startDensity + design.densityRange * Math.pow(u, design.densityExponent);
    const bucket = done ? design.bucketCount - 1 : Math.min(design.bucketCount - 1, Math.floor(Math.min(1, Math.pow(u, design.bucketCurveExponent) * design.bucketCurveScale) * design.bucketIndexCeiling));
    for (let r = 0; r < design.rowCount; r++) {
      if (hash(col + seed, r, 1) > dense + 0.1) continue;
      px += `<rect x="${x}" y="${design.topInsetPixels + r * design.rowPitchPixels}" class="pxd b${bucket} t${Math.floor(hash(col + seed, r, 2) * 4)}"/>`;
    }
  }
  let marks = "";
  for (const m of row.marks) {
    const x = m.f * W;
    const mark = design.marks;
    const passed = x < fx - mark.passedInsetPixels;
    const h = m.stage ? H : mark.regularHeightPixels;
    marks += `<rect x="${(x - (m.stage ? mark.stageInsetPixels : mark.regularInsetPixels)).toFixed(1)}" y="${(H - h) / 2}" width="${m.stage ? mark.stageWidthPixels : mark.regularWidthPixels}" height="${h}" rx="${mark.radiusPixels}" fill="${passed ? rgb(mix(light, [255, 255, 255], 0.45)) : SVG_TRACK}" opacity="${passed ? (m.stage ? mark.passedStageOpacity : mark.passedRegularOpacity) : m.stage ? mark.futureStageOpacity : mark.futureRegularOpacity}"/>`;
  }
  const id = "p" + seed;
  const glideFill = Math.abs(from - fx) > DECK_DESIGN.motion.glideThresholdPixels ? `<animate attributeName="width" from="${from.toFixed(1)}" to="${fx.toFixed(1)}" dur="${DECK_DESIGN.motion.glideSeconds}s" ${EASE} fill="freeze"/>` : "";
  const css = buckets.map((b, i) => `.b${i}{fill:${b.color};fill-opacity:${b.opacity}}`).join("") + `.pxd{width:${design.cellPixels}px;height:${design.cellPixels}px}` + twinkleCss(nowMs, done);
  return (
    `<style>${css}</style>` +
    `<defs><clipPath id="${id}a"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath><clipPath id="${id}b"><rect width="${fx.toFixed(1)}" height="${H}">${glideFill}</rect></clipPath>` +
    `<linearGradient id="${id}g" x1="0" x2="${Math.max(1, fx).toFixed(1)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rgb(acc)}" stop-opacity="${done ? design.gradient.doneStartOpacity : design.gradient.activeStartOpacity}"/><stop offset="1" stop-color="${rgb(acc)}" stop-opacity="${design.gradient.endOpacity}"/></linearGradient></defs>` +
    `<g clip-path="url(#${id}a)"><rect width="${W}" height="${H}" fill="${SVG_TRACK}" fill-opacity="${design.trackOpacity}"/>` +
    `<g clip-path="url(#${id}b)"><rect width="${fx.toFixed(1)}" height="${H}" fill="url(#${id}g)"/>${px}</g>${marks}</g>` +
    pillMarkup(row, W, fx, from, st)
  );
}

function label(row: Row, x: number, color: string): string {
  return `<text x="${x}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.medium} ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${color}">${esc(row.name)}${row.count ? `<tspan dx="${DECK_DESIGN.type.measure.countGapPixels}" style="font-weight:${DECK_DESIGN.type.svgWeights.regular};fill:${SVG_TEXT.muted}">${esc(row.count)}</tspan>` : ""}</text>`;
}

function barShare(W: number): number {
  const { minimumShare, shareRatio } = DECK_DESIGN.bar.desktop;
  return Math.max(minimumShare, Math.round(W * shareRatio));
}

function segments(row: Row, W: number, nowMs: number, lastHead: LastHead): string {
  const st = STYLE[row.style];
  const design = SVG.segments;
  const color = st.desk;
  const bw = barShare(W);
  const { segmentMin, segmentMax, segmentWidth, segmentGap } = DECK_DESIGN.bar.desktop;
  const n = Math.max(segmentMin, Math.min(segmentMax, Math.round(bw / segmentWidth)));
  const gap = segmentGap;
  const sw = (bw - gap * (n - 1)) / n;
  const filled = (row.pct / 100) * n;
  const stages = new Set(row.marks.filter((m) => m.stage).map((m) => Math.round(m.f * n)));
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = i * (sw + gap) + (stages.has(i) ? design.stageInsetPixels : 0);
    const on = i < Math.floor(filled);
    const head = !on && i === Math.floor(filled) && row.animating;
    out += `<rect x="${x.toFixed(1)}" y="${design.y}" width="${(sw - (stages.has(i) ? design.stageInsetPixels : 0)).toFixed(1)}" height="${design.heightPixels}" rx="${design.radiusPixels}" fill="${on || head ? color : SVG_TRACK}" fill-opacity="${on ? 1 : head ? design.headOpacity : design.trackOpacity}"${head ? ' class="t1"' : ""}/>`;
  }
  glideFrom(lastHead, row.id, 0);
  return `<style>${twinkleCss(nowMs, false)}</style>${out}${label(row, bw + design.labelGapPixels, color)}`;
}

function line(row: Row, W: number, _nowMs: number, lastHead: LastHead): string {
  const design = SVG.line;
  const color = STYLE[row.style].desk;
  const bw = barShare(W);
  const fx = (row.pct / 100) * bw;
  const from = glideFrom(lastHead, row.id, fx);
  const glide = Math.abs(from - fx) > DECK_DESIGN.motion.glideThresholdPixels ? `<animate attributeName="width" from="${from.toFixed(1)}" to="${fx.toFixed(1)}" dur="${DECK_DESIGN.motion.glideSeconds}s" ${EASE} fill="freeze"/>` : "";
  const glideDot = Math.abs(from - fx) > DECK_DESIGN.motion.glideThresholdPixels ? `<animate attributeName="cx" from="${from.toFixed(1)}" to="${fx.toFixed(1)}" dur="${DECK_DESIGN.motion.glideSeconds}s" ${EASE} fill="freeze"/>` : "";
  let marks = "";
  for (const m of row.marks) marks += `<rect x="${(m.f * bw).toFixed(1)}" y="${m.stage ? design.marks.stageY : design.marks.regularY}" width="${design.marks.widthPixels}" height="${m.stage ? design.marks.stageHeightPixels : design.marks.regularHeightPixels}" rx="${design.marks.radiusPixels}" fill="${m.f * bw < fx ? color : SVG_TRACK}" opacity="${design.marks.opacity}"/>`;
  const pulse = row.animating ? `<animate attributeName="r" values="${design.head.pulseRadii.join(";")}" dur="${DECK_DESIGN.motion.progressPulseSeconds}s" repeatCount="indefinite"/>` : "";
  return (
    `<rect x="0" y="${design.track.y}" width="${bw}" height="${design.track.heightPixels}" rx="${design.track.radiusPixels}" fill="${SVG_TRACK}" fill-opacity="${design.track.opacity}"/>` +
    `<rect x="0" y="${design.fill.y}" width="${fx.toFixed(1)}" height="${design.fill.heightPixels}" rx="${design.fill.radiusPixels}" fill="${color}">${glide}</rect>${marks}` +
    `<circle cx="${fx.toFixed(1)}" cy="${design.head.y}" r="${design.head.radiusPixels}" fill="${color}">${glideDot}${pulse}</circle>` +
    label(row, bw + design.labelGapPixels, color)
  );
}

function solid(row: Row, W: number, nowMs: number, lastHead: LastHead): string {
  const design = SVG.solid;
  const st = STYLE[row.style];
  const fx = (row.pct / 100) * W;
  const from = glideFrom(lastHead, row.id, fx);
  const id = "s" + Math.abs(seedOf(row.id) % 997);
  const glide = Math.abs(from - fx) > DECK_DESIGN.motion.glideThresholdPixels ? `<animate attributeName="width" from="${from.toFixed(1)}" to="${fx.toFixed(1)}" dur="${DECK_DESIGN.motion.glideSeconds}s" ${EASE} fill="freeze"/>` : "";
  const sweepSeconds = DECK_DESIGN.motion.solidSweepSeconds;
  const t = (nowMs / 1000) % sweepSeconds;
  const sweep = row.animating
    ? `<rect x="${design.sweepStartX}" y="0" width="${design.sweepWidthPixels}" height="${H}" fill="${SVG_ON_FILL}" fill-opacity="${design.sweepOpacity}"><animate attributeName="x" from="${design.sweepStartX}" to="${W}" dur="${sweepSeconds}s" begin="-${t.toFixed(2)}s" repeatCount="indefinite"/></rect>`
    : "";
  const text = esc(row.name) + (row.count ? " · " + esc(row.count) : "");
  return (
    `<defs><clipPath id="${id}a"><rect width="${W}" height="${H}" rx="${design.clipRadiusPixels}"/></clipPath><clipPath id="${id}b"><rect width="${fx.toFixed(1)}" height="${H}">${glide}</rect></clipPath></defs>` +
    `<g clip-path="url(#${id}a)"><rect width="${W}" height="${H}" fill="${SVG_TRACK}" fill-opacity="${design.trackOpacity}"/>` +
    `<text x="${design.labelX}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.medium} ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${SVG_TEXT.muted}">${text}</text>` +
    `<g clip-path="url(#${id}b)"><rect width="${W}" height="${H}" fill="${st.desk}"/>${sweep}<text x="${design.labelX}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.medium} ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${SVG_ON_FILL}">${text}</text></g></g>`
  );
}

function dots(row: Row, W: number, nowMs: number, lastHead: LastHead): string {
  const color = STYLE[row.style].desk;
  glideFrom(lastHead, row.id, 0);
  let out = "";
  const dot = DECK_DESIGN.bar.desktop;
  const { dotStartX, dotSpacing, stepGapMinimum, stepGapMaximum, stepGapReserve, stepConnectorInset } = dot;
  const centerY = H / 2;
  const connectorRadius = dot.stepConnectorHeight / 2;
  let x = dotStartX;
  if (row.steps && row.steps <= DECK_DESIGN.bar.desktop.stepLimit) {
    const gapW = Math.min(stepGapMaximum, Math.max(stepGapMinimum, (barShare(W) - stepGapReserve) / Math.max(1, row.steps - 1)));
    for (let i = 0; i < row.steps; i++) {
      const done = i < (row.finished ?? 0);
      const cur = i === row.finished && row.animating;
      if (i > 0) out += `<rect x="${x - gapW + stepConnectorInset}" y="${centerY - connectorRadius}" width="${gapW - 2 * stepConnectorInset}" height="${dot.stepConnectorHeight}" rx="${connectorRadius}" fill="${done || cur ? color : SVG_TRACK}" fill-opacity="${done || cur ? dot.stepConnectorActiveOpacity : dot.stepConnectorIdleOpacity}"/>`;
      out += done
        ? `<circle cx="${x}" cy="${centerY}" r="${dot.dotRadius}" fill="${color}"/>`
        : cur
          ? `<circle cx="${x}" cy="${centerY}" r="${dot.dotRadius}" fill="none" stroke="${color}" stroke-width="${dot.stepActiveStrokeWidth}"/><circle cx="${x}" cy="${centerY}" r="${dot.stepActiveCoreRadius}" fill="${color}" class="t0"/>`
          : `<circle cx="${x}" cy="${centerY}" r="${dot.stepIdleRadius}" fill="none" stroke="${SVG_TRACK}" stroke-opacity="${dot.stepIdleOpacity}" stroke-width="${dot.stepIdleStrokeWidth}"/>`;
      x += gapW;
    }
  } else {
    for (let i = 0; i < DECK_DESIGN.bar.desktop.dotCount; i++) {
      const v = row.pct / DECK_DESIGN.bar.desktop.dotCount - i;
      out += `<circle cx="${x}" cy="${centerY}" r="${dot.dotRadius}" fill="${SVG_TRACK}" fill-opacity="${dot.dotIdleOpacity}"/>`;
      if (v > 0) out += `<clipPath id="d${seedOf(row.id) % 997}${i}"><rect x="${x - dot.dotRadius}" y="${centerY - dot.dotRadius}" width="${2 * dot.dotRadius * Math.min(1, v)}" height="${2 * dot.dotRadius}"/></clipPath><circle cx="${x}" cy="${centerY}" r="${dot.dotRadius}" fill="${color}" clip-path="url(#d${seedOf(row.id) % 997}${i})"/>`;
      x += dotSpacing;
    }
  }
  return `<style>${twinkleCss(nowMs, false)}</style>${out}${label(row, x + SVG.dots.labelGapPixels, color)}`;
}

// a slim bar, a sparkline of recent history ending in a dot, then the label and its rate
function spark(row: Row, W: number, _nowMs: number, lastHead: LastHead): string {
  const design = SVG.spark;
  const st = STYLE[row.style];
  const color = st.desk;
  const { sparkMinWidth, sparkRatio, historyLimit } = DECK_DESIGN.bar.desktop;
  const bw = Math.max(sparkMinWidth, Math.round(W * sparkRatio));
  const fx = (row.pct / 100) * bw;
  const from = glideFrom(lastHead, row.id, fx);
  const glide = Math.abs(from - fx) > DECK_DESIGN.motion.glideThresholdPixels ? `<animate attributeName="width" from="${from.toFixed(1)}" to="${fx.toFixed(1)}" dur="${DECK_DESIGN.motion.glideSeconds}s" ${EASE} fill="freeze"/>` : "";
  let out = `<rect x="0" y="${design.barY}" width="${bw}" height="${design.barHeightPixels}" rx="${design.barRadiusPixels}" fill="${SVG_TRACK}" fill-opacity="${design.trackOpacity}"/><rect x="0" y="${design.barY}" width="${fx.toFixed(1)}" height="${design.barHeightPixels}" rx="${design.barRadiusPixels}" fill="${color}">${glide}</rect>`;
  const sw = Math.max(DECK_DESIGN.bar.desktop.sparklineMinimumWidth, Math.round(W * DECK_DESIGN.bar.desktop.sparklineRatio));
  const sx = bw + design.historyGapPixels;
  const hist = (row.hist ?? []).slice(-historyLimit);
  if (hist.length > 1) {
    const lo = Math.min(...hist);
    const hi = Math.max(...hist);
    const pts = hist.map((v, i): [number, number] => [sx + (i * sw) / (hist.length - 1), design.chartBaselineY - ((v - lo) / Math.max(1e-9, hi - lo)) * design.chartHeightPixels]);
    out += `<path d="${pts.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1)).join(" ")}" fill="none" stroke="${color}" stroke-width="${design.chartStrokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`;
    const [lx, ly] = pts[pts.length - 1]!;
    out += `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="${design.dotRadiusPixels}" fill="${color}"><animate attributeName="r" values="${design.dotPulseRadii.join(";")}" dur="${DECK_DESIGN.motion.sparkPulseSeconds}s" repeatCount="indefinite"/></circle>`;
  } else {
    out += `<rect x="${sx}" y="${design.fallbackY}" width="${sw}" height="${design.fallbackHeightPixels}" fill="${SVG_TRACK}" fill-opacity="${design.fallbackOpacity}"/>`;
  }
  const lx = sx + sw + design.labelGapPixels;
  out += `<text x="${lx}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.medium} ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${color}">${esc(row.name)}${row.rate ? `<tspan dx="${DECK_DESIGN.type.measure.rateGapPixels}" style="font-weight:${DECK_DESIGN.type.svgWeights.regular};fill:${SVG_TEXT.muted}">${esc(row.rate)}</tspan>` : row.count ? `<tspan dx="${DECK_DESIGN.type.measure.countGapPixels}" style="font-weight:${DECK_DESIGN.type.svgWeights.regular};fill:${SVG_TEXT.muted}">${esc(row.count)}</tspan>` : ""}</text>`;
  return out;
}

type DrawTrack = (row: Row, W: number, nowMs: number, lastHead: LastHead) => string;

const FN: Record<DesktopStyle, DrawTrack> = { pixel, segments, line, solid, dots, spark };

export function desktopTrack(style: string, row: Row, W: number, nowMs: number, lastHead: LastHead): string {
  const draw: DrawTrack = FN[style as DesktopStyle] ?? pixel;
  return draw(row, W, nowMs, lastHead);
}

// ---------- agent strips under a bar ----------

export const STRIP_H = DECK_DESIGN.strips.height;
export const STRIP_GAP = DECK_DESIGN.strips.gap;

export function stripsHeight(v: AgentView): number {
  const n = v.shown.length + (v.hidden.length ? 1 : 0);
  return n * STRIP_H + (n - 1) * STRIP_GAP;
}

export function stripsSvg(
  v: AgentView,
  W: number,
  nowMs: number,
  stripTool: (a: AgentRow) => string,
  tierColor: (model: string) => string,
  lastStrip: Map<string, LastStrip>,
  /** The overflow line's text: how many agents are folded, and how many of them are done. */
  more: (hidden: number, done: number) => string,
): string {
  const narrow = W < NARROW;
  const design = DECK_DESIGN.strips;
  const texture = design.texture;
  let out = "";
  v.shown.forEach((a, i) => {
    const c = STYLE[AGENT_STYLE[a.state]].desk;
    const y = i * (STRIP_H + STRIP_GAP);
    const indent = a.depth > 0 ? design.indentPixels : 0;
    let px = "";
    if (a.state === "running") {
      for (let col = 0; col * texture.columnPitchPixels < W; col++) {
        for (let r = 0; r < texture.rowCount; r++) {
          if (hash(col + i * texture.runSeedOffset, r, texture.patternSeed) > texture.density) continue;
          px += `<rect x="${col * texture.columnPitchPixels}" y="${(y + texture.topInsetPixels + r * texture.rowPitchPixels).toFixed(1)}" width="${texture.cellPixels}" height="${texture.cellPixels}" class="t${Math.floor(hash(col, r, texture.paletteSeed) * texture.paletteBuckets)}" fill="${c}" fill-opacity="${texture.opacity}"/>`;
        }
      }
    }
    const room = narrow ? W - design.narrowNameReservePixels - indent : W * design.nameWidthRatio;
    const full = (a.depth > 0 ? "╰ " : "") + a.title;
    let name = full;
    while (name.length > design.minimumVisibleNameCharacters && textWidth(name, DECK_DESIGN.type.measure.stripNamePixelsPerChar) > room) name = name.slice(0, -1);
    if (name !== full) name = name.trimEnd() + "…";
    const nameX = design.nameStartPixels + indent;
    const toolX = nameX + textWidth(name, DECK_DESIGN.type.measure.stripNamePixelsPerChar) + design.toolGapPixels;
    const tool = stripTool(a);
    const was = lastStrip.get(a.id);
    lastStrip.set(a.id, { tool, color: c });
    const changed = was !== undefined && was.tool !== tool;
    const flow = was && was.color !== c ? `<animate attributeName="fill" from="${was.color}" to="${c}" dur="${DECK_DESIGN.motion.toolChangeSeconds}s" fill="freeze"/>` : "";
    const time = elapsed((a.endedAt ?? nowMs) - a.startedAt);
    let tag = "";
    if (a.model && !narrow) {
      const tc = tierColor(a.model);
      const tw = textWidth(a.model, DECK_DESIGN.type.measure.modelTagPixelsPerChar) + design.modelTag.textPaddingPixels;
      tag = `<rect x="${W - design.modelTag.boxRightInsetPixels - tw}" y="${y + design.modelTag.topPixels}" width="${tw}" height="${design.modelTag.heightPixels}" rx="${design.modelTag.radiusPixels}" fill="${tc}" fill-opacity="${design.modelTag.fillOpacity}"/><text x="${W - design.modelTag.textRightInsetPixels - tw}" y="${y + design.textBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.medium} ${DECK_DESIGN.type.svgTagPixels}px ${FONT};fill:${tc}">${esc(a.model)}</text>`;
    }
    out +=
      `<rect x="0" y="${y}" width="${W}" height="${STRIP_H}" rx="${STRIP_H / 2}" fill="${c}" fill-opacity="${design.backgroundOpacity}">${flow}</rect>${px}` +
      `<circle cx="${design.stateDot.x + indent}" cy="${y + STRIP_H / 2}" r="${design.stateDot.radius}" fill="${c}"${a.state === "running" ? ' class="sd"' : ""}>${flow}</circle>` +
      `<text x="${nameX}" y="${y + design.textBaselinePixels}" class="sn">${esc(name)}</text>` +
      (narrow
        ? ""
        : (changed ? `<text x="${toolX}" y="${y + design.textBaselinePixels}" class="sn mo" style="fill:${was.color}">${esc(was.tool)}</text>` : "") +
          `<text x="${toolX}" y="${y + design.textBaselinePixels}" class="sn${changed ? " mi" : ""}" style="fill:${c}">${esc(tool)}</text>` +
          tag +
          `<text x="${W - design.timeRightInsetPixels}" y="${y + design.textBaselinePixels}" text-anchor="end" class="sn st">${time}</text>`);
  });
  if (v.hidden.length) {
    const y = v.shown.length * (STRIP_H + STRIP_GAP);
    const done = v.hidden.filter((a) => a.state === "done").length;
    out += `<rect x="0" y="${y}" width="${W}" height="${STRIP_H}" rx="${STRIP_H / 2}" fill="${SVG_TRACK}" fill-opacity="${design.hiddenOpacity}"/><text x="${design.stateDot.x}" y="${y + design.textBaselinePixels}" class="sn st">${esc(more(v.hidden.length, done))}</text>`;
  }
  return (
    `<style>.sn{font:${DECK_DESIGN.type.svgWeights.regular} ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${design.textFill}}.st{fill-opacity:${design.secondaryOpacity}}` +
    twinkleCss(nowMs, false) +
    `.sd{animation:sp ${DECK_DESIGN.motion.stripPulseSeconds}s ${DECK_DESIGN.motion.twinkle.easing} infinite}@keyframes sp{50%{opacity:${design.statePulseOpacity}}}` +
    `.mi{animation:mi ${DECK_DESIGN.motion.toolChangeSeconds}s ${DECK_DESIGN.motion.toolChangeEasing.enter} both}@keyframes mi{from{opacity:0;filter:blur(${DECK_DESIGN.motion.toolChangeBlurPixels}px)}}` +
    `.mo{animation:mo ${DECK_DESIGN.motion.toolChangeSeconds}s ${DECK_DESIGN.motion.toolChangeEasing.exit} both}@keyframes mo{to{opacity:0;filter:blur(${DECK_DESIGN.motion.toolChangeBlurPixels}px)}}` +
    "@media (prefers-reduced-motion:reduce){.sd,.mi,.mo{animation:none}.mo{opacity:0}}</style>" +
    out
  );
}
