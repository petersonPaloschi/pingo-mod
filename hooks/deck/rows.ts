// Deck's drawings as data: the row and route SVG, the terminal route cells, the history squares,
// and the three collapsed looks (chips, text, rings). Pure: strings and descriptors that the band
// turns into Svg, Text and Box. A state's color says the state, and its glyph says it again, so a
// dot never carries the meaning alone.

import type { FeatureId } from "../../types";
import { TIERS } from "../core/contracts.ts";
import { text, type Locale } from "../i18n.ts";
import { displayWidth } from "../layout.ts";
import { EFFORTS, fmtUsd, shortModel, stripTool, type Agent, type DeckRow, type RouteView, type Spend } from "./model.ts";
import type { DeckSize, DeckSurfaceStyle } from "./settings.ts";
import { BODY, DECK_DESIGN, DIM, MUTED, PILL_INK, STYLE, SVG_ON_FILL, SVG_TEXT, SVG_TRACK, TEXT, TIER, esc, textCells, textWidth, trunc, type AgentRow, type Row, type TierName } from "./theme.ts";
import { desktopTrack, stripsHeight, stripsSvg, type LastHead, type LastStrip } from "./styles-desktop.ts";
import { terminalMini } from "./styles-terminal.ts";
import { GLYPH } from "../theme.ts";

export const TRACK_H = DECK_DESIGN.bar.height;
export const RIGHT_W = DECK_DESIGN.bar.rightWidth;
const FONT = DECK_DESIGN.type.svg;
// the unfold: each row starts FOLD_STEP ms after the one above, and fades and rises in over FOLD_FADE ms
export const FOLD_STEP = DECK_DESIGN.motion.foldStepMs;
export const FOLD_FADE = DECK_DESIGN.motion.foldFadeMs;

export type Cell = ReturnType<typeof textCells>[number];

// a model's tier color, for a desktop SVG or a terminal cell; a model with no tier is muted
export function tierColor(model: string, desktop = true): string {
  const t = TIER[shortModel(model) as TierName];
  return t ? (desktop ? t.desk : t.term) : desktop ? SVG_TEXT.muted : MUTED;
}

// the history a row keeps between redraws, so a moving strip or track does not restart
export type DrawCaches = { head: LastHead; strip: Map<string, LastStrip> };

// a row as the track styles read it
export function toTrackRow(row: DeckRow): Row {
  return {
    id: row.id,
    name: row.name ?? "",
    count: row.count,
    rate: row.rate,
    style: row.style,
    pct: row.pct,
    marks: row.marks,
    animating: row.animating,
    steps: row.steps,
    finished: row.finished,
    hist: row.hist,
  };
}

// an agent as the strip styles read it
export function toAgentRow(a: Agent): AgentRow {
  return {
    id: a.id,
    title: a.title,
    state: a.state,
    depth: a.depth,
    model: a.model || undefined,
    startedAt: a.startedAt,
    endedAt: a.endedAt ?? undefined,
  };
}

// a row's strips in the shape the strip styles take, with each agent's label from its state
function stripsView(row: DeckRow, locale: Locale): { view: { shown: AgentRow[]; hidden: AgentRow[] }; label: (a: AgentRow) => string } | null {
  if (!row.strips) return null;
  const agents = new Map<string, Agent>([...row.strips.shown, ...row.strips.hidden].map((a) => [a.id, a]));
  return {
    view: { shown: row.strips.shown.map(toAgentRow), hidden: row.strips.hidden.map(toAgentRow) },
    label: (ar) => {
      const a = agents.get(ar.id);
      return a ? stripTool(a, locale) : ar.state;
    },
  };
}

export type RowDrawOptions = {
  style: DeckSurfaceStyle["desktop"];
  size: DeckSize;
  routeHist: readonly string[];
  locale: Locale;
  caches: DrawCaches;
  now: number;
};

// ---------- route ----------

// the arrow's color: a cheaper model green, a deeper one amber, a kept one muted
function dirColor(dir: RouteView["dir"], desktop: boolean): string {
  if (dir === "↓") return desktop ? STYLE.ok.desk : STYLE.ok.fill;
  if (dir === "↑") return desktop ? STYLE.warn.desk : STYLE.warn.fill;
  return desktop ? SVG_TEXT.muted : MUTED;
}

// one route-history slot: a failure, a suggestion the router did not apply, or an applied model
export function histSquare(t: string, hx: number): string {
  if (t === "none") return `<rect x="${hx + 0.5}" y="8" width="6" height="6" rx="2" fill="none" stroke="${STYLE.warn.desk}"/>`;
  if (t.startsWith("~")) {
    return `<rect x="${hx + 0.75}" y="8.25" width="5.5" height="5.5" rx="1.75" fill="none" stroke="${tierColor(t.slice(1))}" stroke-width="1.5"/>`;
  }
  return `<rect x="${hx}" y="7.5" width="7" height="7" rx="2" fill="${tierColor(t)}" fill-opacity=".85"/>`;
}

// the same slot as a terminal glyph and its color
export function histCell(t: string): [string, string] {
  if (t === "none") return ["□", STYLE.warn.fill];
  if (t.startsWith("~")) return ["□", tierColor(t.slice(1), false)];
  return ["■", tierColor(t, false)];
}

// the route as terminal cells: from, the arrow, the model, then effort, confidence and history
export function routeCellsTerminal(row: DeckRow, routeHist: readonly string[], locale: Locale): { cells: Cell[]; dirColor: string } {
  const v = row.route;
  const cells: Cell[] = [];
  const push = (s: string, color: string, bg?: string, bold?: boolean) => cells.push(...textCells(s, color, bg, bold));
  if (!v) return { cells, dirColor: MUTED };
  if (v.noAnswer) {
    push(text("deck.route.kept", locale) + " ", DIM);
    push(" " + v.to + " ", PILL_INK, tierColor(v.to, false), true);
    push("  ! " + v.reason, STYLE.warn.fill);
    if (v.hint) push(" · " + v.hint, DIM);
    push("  ", MUTED);
    for (const t of routeHist) push(...histCell(t));
    return { cells, dirColor: STYLE.warn.fill };
  }
  const color = dirColor(v.dir, false);
  push(v.from + " ", DIM);
  push(v.dir === "=" ? "= " : "→ ", color);
  push(" " + v.to + " ", PILL_INK, tierColor(v.to, false), true);
  if (v.unapplied) push(" " + text("deck.route.suggested", locale, { want: v.want }), DIM);
  if (v.effort) {
    const lvl = Math.max(1, EFFORTS.indexOf(v.effort as (typeof EFFORTS)[number]) + 1);
    push("  " + text("deck.route.effort", locale) + " ", MUTED);
    push("▁▃▅▇█".slice(0, Math.min(5, lvl)), STYLE.run.fill);
    push("·".repeat(Math.max(0, 4 - lvl)) + " " + v.effort, DIM);
  }
  if (v.conf != null) push("  " + text("deck.route.conf", locale) + " " + v.conf.toFixed(2), v.conf >= 0.6 ? STYLE.ok.fill : STYLE.warn.fill);
  if (v.risky != null && v.risky > 0.7) push("  ⚠ " + text("deck.route.risky", locale), STYLE.hot.fill);
  if (v.ms != null) push("  " + v.ms + "ms", DIM);
  push("  ", MUTED);
  for (const t of routeHist) push(...histCell(t));
  return { cells, dirColor: color };
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
    let o = `<text x="0" y="${layout.baselinePixels}" style="font:400 ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${SVG_TEXT.dim}">${kept}</text>`;
    x = Math.ceil(textWidth(kept, labelPixels) + layout.keptLabelGapPixels);
    const w = textWidth(v.to, labelPixels) + pill.horizontalPaddingPixels * 2;
    o += `<rect x="${x}" y="${pill.y}" width="${w}" height="${pill.height}" rx="${pill.radius}" fill="${tierColor(v.to)}"/><text x="${x + pill.horizontalPaddingPixels}" y="${layout.baselinePixels}" style="font:500 ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${SVG_ON_FILL}">${esc(v.to)}</text>`;
    x += w + layout.keptPillGapPixels;
    const reason = `! ${v.reason}`;
    o += `<text x="${x}" y="${layout.baselinePixels}" style="font:500 ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${STYLE.warn.desk}">${esc(reason)}</text>`;
    x += textWidth(reason, DECK_DESIGN.type.measure.reasonPixelsPerChar) + layout.reasonGapPixels;
    if (v.hint) {
      const hint = `· ${v.hint}`;
      o += `<text x="${x}" y="${layout.baselinePixels}" style="font:400 ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${SVG_TEXT.muted}">${esc(hint)}</text>`;
      x += textWidth(hint, labelPixels) + layout.hintGapPixels;
    }
    return o + historyStrip(routeHist, W, x);
  }
  let out = `<text x="0" y="${layout.baselinePixels}" style="font:400 ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${SVG_TEXT.dim}">${esc(v.from)}</text>`;
  x += textWidth(v.from, labelPixels) + layout.fromGapPixels;
  out += `<text x="${x}" y="${layout.baselinePixels}" style="font:500 ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${dirColor(v.dir, true)}">${v.dir === "=" ? "=" : "→"}</text>`;
  x += layout.directionGapPixels;
  const pill = layout.pill;
  for (const t of TIERS) {
    const on = t === v.to;
    const want = t === v.want && !on;
    const w = textWidth(t, labelPixels) + pill.horizontalPaddingPixels * 2;
    out += `<rect x="${x}" y="${pill.y}" width="${w}" height="${pill.height}" rx="${pill.radius}" fill="${on ? tierColor(t) : SVG_TRACK}" fill-opacity="${on ? 1 : 0.16}"${want ? ` stroke="${tierColor(t)}" stroke-dasharray="2 2"` : ""}/>`;
    out += `<text x="${x + pill.horizontalPaddingPixels}" y="${layout.baselinePixels}" style="font:${on ? 500 : 400} ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${on ? SVG_ON_FILL : SVG_TEXT.muted}">${t}</text>`;
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
    out += `<text x="${x}" y="${layout.baselinePixels}" style="font:400 ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${SVG_TEXT.body}">${esc(v.effort)}</text>`;
    x += textWidth(v.effort, labelPixels) + effort.labelGapPixels;
  }
  if (v.conf != null) {
    const c = v.conf >= 0.6 ? STYLE.ok.desk : STYLE.warn.desk;
    const label = text("deck.route.conf", locale);
    const confidence = layout.confidence;
    const value = v.conf.toFixed(2);
    out += `<text x="${x}" y="${layout.baselinePixels}" style="font:400 ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${SVG_TEXT.dim}">${label}</text>`;
    x += textWidth(label, labelPixels) + confidence.labelGapPixels;
    out += `<rect x="${x}" y="${confidence.trackY}" width="${confidence.trackWidthPixels}" height="${confidence.trackHeightPixels}" rx="${confidence.trackRadiusPixels}" fill="${SVG_TRACK}" fill-opacity=".25"/><rect x="${x}" y="${confidence.trackY}" width="${(confidence.trackWidthPixels * v.conf).toFixed(1)}" height="${confidence.trackHeightPixels}" fill="${c}"/>`;
    x += confidence.trackWidthPixels + confidence.trackValueGapPixels;
    out += `<text x="${x}" y="${layout.baselinePixels}" style="font:400 ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${SVG_TEXT.muted}">${value}</text>`;
    x += textWidth(value, labelPixels) + confidence.valueGapPixels;
  }
  if (v.risky != null && v.risky > 0.7) {
    const risky = `⚠ ${text("deck.route.risky", locale)}`;
    out += `<text x="${x}" y="${layout.baselinePixels}" style="font:500 ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${STYLE.hot.desk}">${risky}</text>`;
    x += textWidth(risky, labelPixels) + layout.riskyGapPixels;
  }
  if (v.unapplied) {
    const unapplied = text("deck.route.notApplied", locale);
    out += `<text x="${x}" y="${layout.baselinePixels}" style="font:400 ${DECK_DESIGN.type.svgSmallPixels}px ${FONT};fill:${SVG_TEXT.dim}">${unapplied}</text>`;
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
export function ringSvg(pct: number, color: string, icon: "usd" | "week" | "clock"): string {
  const { size, center, radius: r, strokeWidth } = DECK_DESIGN.ring;
  const C = 2 * Math.PI * r;
  const glyph =
    icon === "usd"
    ? `<text x="11" y="15" text-anchor="middle" style="font:600 ${DECK_DESIGN.type.svgTinyPixels}px ${FONT};fill:${color}">$</text>`
      : icon === "week"
        ? `<rect x="7.2" y="7.6" width="7.6" height="7" rx="1.2" fill="none" stroke="${color}" stroke-width="1.3"/><rect x="7.2" y="7.6" width="7.6" height="2" fill="${color}"/>`
        : `<path d="M11 7.2V11l2.4 1.6" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="${SVG_TRACK}" stroke-opacity=".3" stroke-width="${strokeWidth}"/>` +
    `<circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${((C * Math.min(100, pct)) / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${center} ${center})"/>` +
    glyph +
    "</svg>"
  );
}

// a row's full SVG: its track, its right-hand value, and its agent strips below
export function rowSvg(row: DeckRow, W: number, o: RowDrawOptions): { height: number; width: number; source: string } {
  const sv = stripsView(row, o.locale);
  const stripsH = sv ? 5 + stripsHeight(sv.view) : 0;
  // compact rows sit with no gap between them; a little air above and below keeps the pills apart
  const pad = o.size === "roomy" ? 0 : DECK_DESIGN.bar.compactPadding;
  const H = TRACK_H + stripsH + pad * 2;
  const total = W + RIGHT_W;
  const track = row.kind === "route" ? routeSvg(row, W, o.routeHist, o.locale) : desktopTrack(o.style, toTrackRow(row), W, o.now, o.caches.head);
  const right = rightColor(row);
  const strips = sv ? `<g transform="translate(0 ${TRACK_H + 5})">${stripsSvg(sv.view, W, o.now, sv.label, (m) => tierColor(m), o.caches.strip, (hidden, done) => text("deck.strips.moreDone", o.locale, { count: hidden, done }))}</g>` : "";
  return {
    height: H,
    width: total,
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${H}" viewBox="0 ${-pad} ${total} ${H}">` +
      track +
      `<text x="${total - 4}" y="${TRACK_H / 2 + 4.2}" text-anchor="end" style="font:400 ${DECK_DESIGN.type.svgBodyPixels}px ${FONT};fill:${right};font-variant-numeric:tabular-nums">${esc(row.right)}</text>` +
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

// a row's node on the trail: its state (● at work, ? a question, ! a failure, ✓ a finished plan, ◔ ◑ a limit's
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

export type ChipMini = { kind: "svg"; pct: number; color: string; alt: string } | { kind: "cells"; cells: Cell[] };
export type Chip =
  | { kind: "route"; text: string; color: string }
  | { kind: "item"; glyph: string; glyphColor: string; text: string; textColor: string; bold: boolean; mini: ChipMini }
  | { kind: "separator" }
  | { kind: "more"; text: string };

export type ChipOptions = {
  desktop: boolean;
  cols: number;
  /** The width the extras text takes (clock, weather), in the surface's units. */
  extrasLength: number;
  terminalStyle: string;
  locale: Locale;
};

// the chips for the collapsed band: needs-you first, then limits, context, bars, the route; what
// does not fit becomes a "+N" count
export function collapsedChips(ordered: readonly DeckRow[], o: ChipOptions): { chips: Chip[] } {
  const chips: Chip[] = [];
  // the terminal counts columns; the desktop counts pixels (about 8 per column, ~7.5 per character)
  let budget = o.desktop
    ? o.cols * DECK_DESIGN.band.pixelsPerColumn - DECK_DESIGN.band.collapsed.desktop.reservePixels - o.extrasLength * DECK_DESIGN.band.collapsed.desktop.extraPixelsPerChar
    : o.cols - DECK_DESIGN.band.collapsed.terminal.reserveColumns - o.extrasLength * DECK_DESIGN.band.collapsed.terminal.extraColumnsPerChar;
  let hidden = 0;
  for (const row of ordered) {
    const st = STYLE[row.style];
    const w = o.desktop
      ? row.short.length * DECK_DESIGN.band.collapsed.desktop.titlePixelsPerChar + DECK_DESIGN.band.collapsed.desktop.itemPaddingPixels
      : row.short.length + DECK_DESIGN.band.collapsed.terminal.itemPaddingColumns;
    if (w > budget) {
      hidden++;
      continue;
    }
    budget -= w;
    if (chips.length) chips.push({ kind: "separator" });
    if (row.kind === "route") {
      chips.push({ kind: "route", text: row.short + " ", color: o.desktop ? STYLE.run.desk : STYLE.run.fill });
      continue;
    }
    chips.push({
      kind: "item",
      glyph: rowGlyph(row) + " ",
      glyphColor: o.desktop ? st.desk : st.fill,
      text: row.short + " ",
      textColor: row.state === "needs_input" ? st.fill : row.limit ? TEXT : BODY,
      bold: !!row.limit,
      mini: o.desktop
        ? { kind: "svg", pct: row.pct, color: st.desk, alt: row.title + " " + Math.round(row.pct) + "%" }
        : { kind: "cells", cells: terminalMini(o.terminalStyle, toTrackRow(row), 5) },
    });
  }
  if (hidden) chips.push({ kind: "more", text: "  " + text("deck.chip.more", o.locale, { count: hidden }) });
  return { chips };
}

export type TextPart = { text: string; color?: string; bold?: boolean };

// the one-line look: a glyph and a short status per row, the route as an arrow, extras at the end
export function collapsedText(ordered: readonly DeckRow[], extras: readonly string[], desktop: boolean): TextPart[] {
  const parts: TextPart[] = [];
  for (const row of ordered) {
    const st = STYLE[row.style];
    if (parts.length) parts.push({ text: "  " });
    if (row.kind === "route") {
      parts.push({ text: "⇄ ", color: desktop ? STYLE.run.desk : STYLE.run.fill });
      parts.push({ text: row.route ? row.route.to + (row.route.effort ? " · " + row.route.effort : "") : row.short, color: MUTED });
      continue;
    }
    parts.push({ text: rowGlyph(row) + " ", color: desktop ? st.desk : st.fill });
    parts.push({ text: row.short, color: row.state === "needs_input" ? st.fill : MUTED });
  }
  if (extras.length) parts.push({ text: (parts.length ? "  " : "") + [...extras].reverse().join("  "), color: MUTED });
  return parts;
}

export type RingItem =
  | { kind: "ask"; text: string; color: string }
  | { kind: "limit"; percent: string; label: string; color: string; svg: string | null; glyph: string; alt: string }
  | { kind: "spend"; amount: string; note: string; color: string; svg: string | null; glyph: string; alt: string }
  | { kind: "busy"; glyph: string; color: string; text: string };

// the limits as rings with their reset, then spend, then the busy row: the rings look
export function collapsedRings(rows: readonly DeckRow[], spend: Spend, costOn: boolean, desktop: boolean, locale: Locale): RingItem[] {
  const items: RingItem[] = [];
  const ask = rows.find((r) => r.state === "needs_input");
  if (ask) items.push({ kind: "ask", text: STYLE.ask.glyph + " " + text("deck.ask", locale, { title: trunc(ask.title, 24) }), color: STYLE.ask.fill });
  for (const row of rows.filter((r) => r.limit)) {
    const st = STYLE[row.style];
    const tag = row.kindKey === "five_hour" ? text("deck.limit.sessionTag", locale) : row.kindKey === "seven_day" ? text("deck.limit.weeklyTag", locale) : row.title;
    const icon = row.kindKey === "seven_day" ? "week" : "clock";
    items.push({
      kind: "limit",
      percent: Math.round(row.pct) + "%",
      label: tag + (row.resets ? " · " + text("deck.limit.resets", locale, { time: row.resets }) : ""),
      color: st.fill,
      svg: desktop ? ringSvg(row.pct, st.desk, icon) : null,
      glyph: "○◔◑◕●"[Math.min(4, Math.round(row.pct / 25))] ?? "○",
      alt: text("deck.limit.alt", locale, { title: tag, percent: Math.round(row.pct) }),
    });
  }
  if (costOn) {
    items.push({
      kind: "spend",
      amount: fmtUsd(spend.dayUsd),
      note: text("deck.spend.today", locale, { today: fmtUsd(spend.monthUsd) }),
      color: STYLE.done.fill,
      svg: desktop ? ringSvg(100, STYLE.done.desk, "usd") : null,
      glyph: "$",
      alt: text("deck.spend.alt", locale),
    });
  }
  const busy = rows.find((r) => (r.kind === "bar" || r.kind === "activity") && r.animating && r.state !== "needs_input");
  if (busy) items.push({ kind: "busy", glyph: rowGlyph(busy), color: MUTED, text: trunc(busy.short, 22) });
  return items;
}

/** One feature's switch as the expanded band draws it: its id, the name it shows, and whether it is on. */
export type FeatureSwitch = { id: FeatureId; name: string; on: boolean };

/** A switch's label: its state glyph, then its name. */
export const switchLabel = (sw: FeatureSwitch) => `${sw.on ? GLYPH.on : GLYPH.off} ${sw.name}`;

/**
 * The switches packed into terminal lines of `cols` columns, indented under their title. A switch that does not fit
 * moves whole to the next line; only a name wider than a whole line is shortened. The band draws these lines and
 * counts them against its row budget, so the two never disagree.
 */
export function featureLines(switches: readonly FeatureSwitch[], cols: number): { sw: FeatureSwitch; label: string }[][] {
  const { indent, columnGap } = DECK_DESIGN.band.features;
  const room = Math.max(4, cols - indent);
  const lines: { sw: FeatureSwitch; label: string }[][] = [];
  let line: { sw: FeatureSwitch; label: string }[] = [];
  let used = 0;
  for (const sw of switches) {
    const label = trunc(switchLabel(sw), room);
    const width = displayWidth(label);
    if (line.length && used + columnGap + width > room) {
      lines.push(line);
      line = [];
      used = 0;
    }
    used += (line.length ? columnGap : 0) + width;
    line.push({ sw, label });
  }
  if (line.length) lines.push(line);
  return lines;
}
