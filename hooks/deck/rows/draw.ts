import { text } from "../../i18n.ts";
import { type DeckRow } from "../model.ts";
import { DECK_DESIGN, STYLE, SVG_TEXT, SVG_TRACK, esc } from "../theme.ts";
import { desktopTrack, stripsHeight, stripsSvg } from "../styles-desktop.ts";
import { GLYPH } from "../../theme.ts";
import { dirColor, FONT, routeSvg } from "./routes.ts";
import { stripsView, tierColor, toTrackRow, type RowDrawOptions } from "./data.ts";

export const TRACK_H = DECK_DESIGN.bar.height;
export const RIGHT_W = DECK_DESIGN.bar.rightWidth;
// the unfold: each row starts FOLD_STEP ms after the one above, and fades and rises in over FOLD_FADE ms
export const FOLD_STEP = DECK_DESIGN.motion.foldStepMs;
export const FOLD_FADE = DECK_DESIGN.motion.foldFadeMs;

export function ringSvg(pct: number, color: string, icon: "usd" | "week" | "clock"): string {
  const design = DECK_DESIGN.ring;
  const { size, center, radius: r, strokeWidth } = design;
  const C = 2 * Math.PI * r;
  const glyph =
    icon === "usd"
      ? `<text x="${center}" y="${DECK_DESIGN.type.svgBaselinePixels}" text-anchor="middle" style="font:${DECK_DESIGN.type.svgWeights.semibold} ${DECK_DESIGN.type.svgTinyPixels}px ${FONT};fill:${color}">$</text>`
      : icon === "week"
        ? `<rect x="${design.icons.week.x}" y="${design.icons.week.y}" width="${design.icons.week.widthPixels}" height="${design.icons.week.heightPixels}" rx="${design.icons.week.radiusPixels}" fill="none" stroke="${color}" stroke-width="${design.icons.week.strokeWidth}"/><rect x="${design.icons.week.x}" y="${design.icons.week.y}" width="${design.icons.week.widthPixels}" height="${design.icons.week.headerHeightPixels}" fill="${color}"/>`
        : `<path d="${design.icons.clock.handPath}" fill="none" stroke="${color}" stroke-width="${design.icons.clock.strokeWidth}" stroke-linecap="round"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="${SVG_TRACK}" stroke-opacity="${design.trackOpacity}" stroke-width="${strokeWidth}"/>` +
    `<circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${((C * Math.min(100, pct)) / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(${design.startAngleDegrees} ${center} ${center})"/>` +
    glyph +
    "</svg>"
  );
}

// a row's full SVG: its track, its right-hand value, and its agent strips below
export function rowSvg(row: DeckRow, W: number, o: RowDrawOptions): { height: number; width: number; source: string } {
  const layout = DECK_DESIGN.rows;
  const sv = stripsView(row, o.locale);
  const stripsH = sv ? layout.stripGapPixels + stripsHeight(sv.view) : 0;
  // compact rows sit with no gap between them; a little air above and below keeps the pills apart
  const pad = o.size === "roomy" ? 0 : DECK_DESIGN.bar.compactPadding;
  const H = TRACK_H + stripsH + pad * 2;
  const total = W + RIGHT_W;
  const track = row.kind === "route" ? routeSvg(row, W, o.routeHist, o.locale) : desktopTrack(o.style, toTrackRow(row), W, o.now, o.caches.head);
  const right = rightColor(row);
  const strips = sv ? `<g transform="translate(0 ${TRACK_H + layout.stripGapPixels})">${stripsSvg(sv.view, W, o.now, sv.label, (m) => tierColor(m), o.caches.strip, (hidden, done) => text("deck.strips.moreDone", o.locale, { count: hidden, done }))}</g>` : "";
  return {
    height: H,
    width: total,
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${H}" viewBox="0 ${-pad} ${total} ${H}">` +
      track +
      `<text x="${total - layout.rightValueInsetPixels}" y="${TRACK_H / 2 + layout.rightValueBaselineOffsetPixels}" text-anchor="end" style="font:${DECK_DESIGN.type.svgWeights.regular} ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${right};font-variant-numeric:tabular-nums">${esc(row.right)}</text>` +
      strips +
      "</svg>",
  };
}

function rightColor(row: DeckRow): string {
  const v = row.route;
  if (row.kind !== "route" || !v) return SVG_TEXT.muted;
  if (v.noAnswer) return STYLE.warn.desk;
  return dirColor(v.dir, true);
}

// a row that just unfolded fades and rises in; its age keeps a redraw from restarting it
export function fadeInSvg(source: string, ageMs: number, fadeMs: number): string {
  if (ageMs >= fadeMs) return source;
  const head = source.indexOf(">") + 1;
  const tail = source.lastIndexOf("</svg>");
  return (
    source.slice(0, head) +
    `<style>@keyframes rin{from{opacity:0;transform:translateY(${DECK_DESIGN.motion.foldRisePixels}px)}}.rin{animation:rin ${fadeMs}ms ${DECK_DESIGN.motion.unfoldEasing} both;animation-delay:-${Math.max(0, Math.round(ageMs))}ms}@media (prefers-reduced-motion:reduce){.rin{animation:none}}</style><g class="rin">` +
    source.slice(head, tail) +
    "</g>" +
    source.slice(tail)
  );
}

// ---------- glyphs ----------

// a row's state glyph, after its share: its state (◆ at work, ? a question, ! a failure, ✓ a finished plan, ◔ ◑ a limit's
// fill), or → for the route, which has no bar; the title beside it says what the row is
export function rowGlyph(row: DeckRow): string {
  return row.kind === "route" ? GLYPH.route : STYLE[row.style].glyph;
}

// ---------- collapsed looks ----------

// one mini bar of the desktop chips: a 36-by-8 track with its fill
export function chipBarSvg(pct: number, color: string): string {
  const { width, height, minimumVisibleFill } = DECK_DESIGN.miniBar;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${height / 2}" fill="${SVG_TRACK}" fill-opacity=".2"/><rect width="${Math.max((width * pct) / 100, pct > 0 ? minimumVisibleFill : 0)}" height="${height}" rx="${height / 2}" fill="${color}"/></svg>`;
}
