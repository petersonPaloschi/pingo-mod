import { TIERS } from "../../core/contracts.ts";
import { text, type Locale } from "../../i18n.ts";
import { EFFORTS, type DeckRow, type RouteView } from "../model.ts";
import { DECK_DESIGN, MUTED, STYLE, SVG_ON_FILL, SVG_TEXT, SVG_TRACK, TEXT, esc, textCells, textWidth } from "../theme.ts";
import { GLYPH } from "../../theme.ts";
import { tierColor, type Cell } from "./data.ts";

export const FONT = DECK_DESIGN.type.svg;

// ---------- route ----------

// the arrow's color: a cheaper model green, a deeper one amber, a kept one muted
export function dirColor(dir: RouteView["dir"], desktop: boolean): string {
  if (dir === "↓") return desktop ? STYLE.ok.desk : STYLE.ok.fill;
  if (dir === "↑") return desktop ? STYLE.warn.desk : STYLE.warn.fill;
  return desktop ? SVG_TEXT.muted : MUTED;
}

// one route-history slot: a failure, a suggestion the router did not apply, or an applied model
export function histSquare(t: string, hx: number): string {
  const design = DECK_DESIGN.route.historySquare;
  if (t === "none") return `<rect x="${hx + design.none.xInsetPixels}" y="${design.none.y}" width="${design.none.sizePixels}" height="${design.none.sizePixels}" rx="${design.none.radiusPixels}" fill="none" stroke="${STYLE.warn.desk}"/>`;
  if (t.startsWith("~")) {
    return `<rect x="${hx + design.suggested.xInsetPixels}" y="${design.suggested.y}" width="${design.suggested.sizePixels}" height="${design.suggested.sizePixels}" rx="${design.suggested.radiusPixels}" fill="none" stroke="${tierColor(t.slice(1))}" stroke-width="${design.suggested.strokeWidth}"/>`;
  }
  return `<rect x="${hx}" y="${design.applied.y}" width="${design.applied.sizePixels}" height="${design.applied.sizePixels}" rx="${design.applied.radiusPixels}" fill="${tierColor(t)}" fill-opacity="${design.applied.opacity}"/>`;
}

// the same slot as a terminal letter and its color: an "x" for a failure, a lowercase initial for a suggestion the router
// did not apply, a capital initial for an applied model
export function histCell(t: string): [string, string] {
  if (t === "none") return [GLYPH.fail, MUTED];
  if (t.startsWith("~")) return [(t.slice(1)[0] ?? GLYPH.idle).toLowerCase(), MUTED];
  return [(t[0] ?? GLYPH.idle).toUpperCase(), TEXT];
}

// the route as terminal cells, in black and white: "from -> to", then what the router did (the arrow and its word), then
// effort, confidence and speed after " - ", then the history. The row writes its title and its dismiss button around it.
export function routeCellsTerminal(row: DeckRow, routeHist: readonly string[], locale: Locale): { cells: Cell[] } {
  const v = row.route;
  const cells: Cell[] = [];
  const push = (s: string, color: string = TEXT, bold?: boolean) => cells.push(...textCells(s, color, undefined, bold));
  const note = (s: string) => push(" " + GLYPH.leader + " " + s);
  if (!v) return { cells };
  if (v.noAnswer) {
    push(text("deck.route.kept", locale) + " " + v.to, TEXT);
    push("  ! " + v.reason, TEXT, true);
    if (v.hint) note(v.hint);
  } else {
    push(v.from + " " + (v.dir === "=" ? "=" : GLYPH.route) + " " + v.to);
    push("  " + row.right);
    if (v.unapplied) note(text("deck.route.suggested", locale, { want: v.want }));
    if (v.effort) note(text("deck.route.effort", locale) + " " + v.effort);
    if (v.conf != null) note(text("deck.route.conf", locale) + " " + v.conf.toFixed(2));
    if (v.risky != null && v.risky > DECK_DESIGN.route.riskyDisplayThreshold) note(GLYPH.warn + " " + text("deck.route.risky", locale));
    if (v.ms != null) note(v.ms + "ms");
  }
  if (routeHist.length) push("  ", MUTED);
  for (const t of routeHist) push(...histCell(t));
  return { cells };
}

// the route as an SVG track: from, the three tiers, effort bars, confidence, and history on the right
export function routeSvg(row: DeckRow, W: number, routeHist: readonly string[], locale: Locale): string {
  const v = row.route;
  if (!v) return "";
  const layout = DECK_DESIGN.route;
  const labelPixels = DECK_DESIGN.type.measure.labelPixelsPerChar;
  let x = 0;
  if (v.noAnswer) {
    const kept = text("deck.route.kept", locale);
    const pill = layout.pill;
    let o = `<text x="0" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.regular} ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${SVG_TEXT.dim}">${kept}</text>`;
    x = Math.ceil(textWidth(kept, labelPixels) + layout.keptLabelGapPixels);
    const w = textWidth(v.to, labelPixels) + pill.horizontalPaddingPixels * 2;
    o += `<rect x="${x}" y="${pill.y}" width="${w}" height="${pill.height}" rx="${pill.radius}" fill="${tierColor(v.to)}"/><text x="${x + pill.horizontalPaddingPixels}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.medium} ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${SVG_ON_FILL}">${esc(v.to)}</text>`;
    x += w + layout.keptPillGapPixels;
    const reason = `! ${v.reason}`;
    o += `<text x="${x}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.medium} ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${STYLE.warn.desk}">${esc(reason)}</text>`;
    x += textWidth(reason, DECK_DESIGN.type.measure.reasonPixelsPerChar) + layout.reasonGapPixels;
    if (v.hint) {
      const hint = `· ${v.hint}`;
      o += `<text x="${x}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.regular} ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${SVG_TEXT.muted}">${esc(hint)}</text>`;
      x += textWidth(hint, labelPixels) + layout.hintGapPixels;
    }
    return o + historyStrip(routeHist, W, x);
  }
  let out = `<text x="0" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.regular} ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${SVG_TEXT.dim}">${esc(v.from)}</text>`;
  x += textWidth(v.from, labelPixels) + layout.fromGapPixels;
  out += `<text x="${x}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.medium} ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${dirColor(v.dir, true)}">${v.dir === "=" ? "=" : "→"}</text>`;
  x += layout.directionGapPixels;
  const pill = layout.pill;
  for (const t of TIERS) {
    const on = t === v.to;
    const want = t === v.want && !on;
    const w = textWidth(t, labelPixels) + pill.horizontalPaddingPixels * 2;
    out += `<rect x="${x}" y="${pill.y}" width="${w}" height="${pill.height}" rx="${pill.radius}" fill="${on ? tierColor(t) : SVG_TRACK}" fill-opacity="${on ? layout.tier.selectedOpacity : layout.tier.inactiveOpacity}"${want ? ` stroke="${tierColor(t)}" stroke-dasharray="${layout.tier.requestedStrokeDashArray}"` : ""}/>`;
    out += `<text x="${x + pill.horizontalPaddingPixels}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${on ? DECK_DESIGN.type.svgWeights.medium : DECK_DESIGN.type.svgWeights.regular} ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${on ? SVG_ON_FILL : SVG_TEXT.muted}">${t}</text>`;
    x += w + layout.tierGapPixels;
  }
  x += layout.tierSectionGapPixels;
  if (v.effort) {
    const lvl = Math.max(1, EFFORTS.indexOf(v.effort as (typeof EFFORTS)[number]) + 1);
    const effort = layout.effort;
    for (let i = 1; i <= effort.barCount; i++) {
      const height = effort.minimumHeightPixels + i * effort.heightStepPixels;
      out += `<rect x="${x + (i - 1) * (effort.widthPixels + effort.gapPixels)}" y="${effort.baselinePixels - height}" width="${effort.widthPixels}" height="${height}" rx="${effort.radiusPixels}" fill="${i <= lvl ? STYLE.run.desk : SVG_TRACK}" fill-opacity="${i <= lvl ? 1 : effort.inactiveOpacity}"/>`;
    }
    x += effort.reservedWidthPixels;
    out += `<text x="${x}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.regular} ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${SVG_TEXT.body}">${esc(v.effort)}</text>`;
    x += textWidth(v.effort, labelPixels) + effort.labelGapPixels;
  }
  if (v.conf != null) {
    const c = v.conf >= layout.confidence.colorThreshold ? STYLE.ok.desk : STYLE.warn.desk;
    const label = text("deck.route.conf", locale);
    const confidence = layout.confidence;
    const value = v.conf.toFixed(2);
    out += `<text x="${x}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.regular} ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${SVG_TEXT.dim}">${label}</text>`;
    x += textWidth(label, labelPixels) + confidence.labelGapPixels;
    out += `<rect x="${x}" y="${confidence.trackY}" width="${confidence.trackWidthPixels}" height="${confidence.trackHeightPixels}" rx="${confidence.trackRadiusPixels}" fill="${SVG_TRACK}" fill-opacity="${confidence.trackOpacity}"/><rect x="${x}" y="${confidence.trackY}" width="${(confidence.trackWidthPixels * v.conf).toFixed(1)}" height="${confidence.trackHeightPixels}" fill="${c}"/>`;
    x += confidence.trackWidthPixels + confidence.trackValueGapPixels;
    out += `<text x="${x}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.regular} ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${SVG_TEXT.muted}">${value}</text>`;
    x += textWidth(value, labelPixels) + confidence.valueGapPixels;
  }
  if (v.risky != null && v.risky > layout.riskyDisplayThreshold) {
    const risky = `⚠ ${text("deck.route.risky", locale)}`;
    out += `<text x="${x}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.medium} ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${STYLE.hot.desk}">${risky}</text>`;
    x += textWidth(risky, labelPixels) + layout.riskyGapPixels;
  }
  if (v.unapplied) {
    const unapplied = text("deck.route.notApplied", locale);
    out += `<text x="${x}" y="${DECK_DESIGN.type.svgBaselinePixels}" style="font:${DECK_DESIGN.type.svgWeights.regular} ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${SVG_TEXT.dim}">${unapplied}</text>`;
    x += textWidth(unapplied, labelPixels) + layout.unappliedGapPixels;
  }
  return out + historyStrip(routeHist, W, x);
}

// the squares at the right edge; dropped when they would collide with the content
function historyStrip(routeHist: readonly string[], W: number, x: number): string {
  const histW = routeHist.length * 10;
  if (x + 12 + histW > W) return "";
  let hx = Math.max(x + 12, W - histW);
  let out = "";
  for (const t of routeHist) {
    out += histSquare(t, hx);
    hx += 10;
  }
  return out;
}

// ---------- rings and rows ----------

// a small progress ring with an icon in the middle
