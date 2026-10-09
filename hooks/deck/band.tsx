// Deck's band as elements: the collapsed look (chips, one line, or rings), the expanded rows with
// their strips, and the pet lane. Pure: the caller hands in the rows, settings and time it drew from.
import type { ElementTable, RenderNode } from "claude-code";

import { cellsOf } from "../dots.ts";
import { text, type Locale } from "../i18n.ts";
import { collapsedOrder, elapsed, stripTool, type Agent, type DeckRow, type Spend } from "./model.ts";
import { petLaneCells, petLaneColumns, petLaneSvg, PET_BRAILLE, type Pet } from "./pet.ts";
import type { DeckSettings } from "./settings.ts";
import {
  chipBarSvg,
  collapsedChips,
  collapsedRings,
  collapsedText,
  fadeInSvg,
  FOLD_FADE,
  FOLD_STEP,
  RIGHT_W,
  routeCellsTerminal,
  rowSvg,
  tierColor,
  toTrackRow,
  type Chip,
  type ChipMini,
  type DrawCaches,
  type RingItem,
} from "./rows.ts";
import { BODY, DIM, MUTED, PILL_INK, STYLE, TEXT, TRACK, runs, textWidth, trunc, type AgentState, type StyleName } from "./theme.ts";
import { terminalBar } from "./styles-terminal.ts";

export type Surface = "terminal" | "desktop";

export type DeckBand = {
  rows: readonly DeckRow[];
  settings: DeckSettings;
  expanded: boolean;
  locale: Locale;
  /** The band's width in columns. */
  cols: number;
  now: number;
  caches: DrawCaches;
  routeHist: readonly string[];
  spend: Spend;
  /** The clock and weather text, drawn at the end of the line. */
  extras: readonly string[];
  pet: Pet;
  toggle: () => void;
  /** Rows drawn so far while the band unfolds; every row when absent. */
  shown?: number;
  /** Ms since an opening fold began, or null: each desktop row fades in from its own age. Null while closing. */
  foldAge: number | null;
  /** Terminal lines the band may fill, the pet lane included; 14 when absent. */
  maxRows?: number;
  /** Dismisses one expanded row: the ✕ beside it calls this with the row. */
  dismiss: (row: DeckRow) => void;
};

/** Desktop pixels per column, as the chip budget and the row widths count them. */
const PX_PER_COL = 8;
/** A row title is cut to this many characters, and its column is at most this many pixels wide. */
const TITLE_MAX_CH = 22;
const TITLE_MAX_PX = 160;
/** Terminal lines the band may fill when the caller gives no maxRows. */
const DEFAULT_MAX_ROWS = 14;
/** The terminal animation steps once per this many milliseconds. */
export const FRAME_MS = 150;
/** The pet walking the header line: its height and its scale. */
const HEADER_PET_H = 28;
const HEADER_PET_SCALE = 0.7;

const AGENT_STYLE: Record<AgentState, StyleName> = { running: "run", waiting: "ask", error: "hot", done: "done" };

/** The Deck band: the toggle, then the collapsed look, or the expanded rows and the pet. */
export function renderDeck(els: ElementTable, band: DeckBand, surface: Surface) {
  const { Box, Button, Text } = els;
  // nothing to show (no rows, no clock or weather, no pet): an empty column takes no line
  if (!band.rows.length && !band.extras.length && !band.settings.show.pet) return <Box flexDirection="column" />;
  const desktop = surface === "desktop" && "Svg" in els;
  const expanded = band.expanded && band.rows.length > 0;
  const extrasStr = band.extras.join("  ·  ");
  const toggle = (
    <Button key="deck-toggle" label={text(band.expanded ? "deck.toggle.expanded" : "deck.toggle.collapsed", band.locale)} plain dimColor hotkey="0" onPress={band.toggle} />
  );
  const extrasEl = (
    <Box flexShrink={0}>
      <Text color={MUTED}>{extrasStr}</Text>
    </Box>
  );
  const inlinePet = expanded && desktop && band.settings.show.pet && band.settings.size !== "roomy";
  const lane = band.settings.show.pet && !inlinePet ? petLane(els, band, surface) : null;
  if (!expanded) {
    return (
      <Box flexDirection="column">
        {lane}
        {collapsedLine(els, band, surface, toggle, extrasEl)}
      </Box>
    );
  }
  const count = band.rows.length;
  const header = (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      {toggle}
      <Text color={DIM}>{"· " + (count === 1 ? text("deck.rows.one", band.locale, { count }) : text("deck.rows.many", band.locale, { count }))}</Text>
      {inlinePet ? inlinePetEl(els, band, extrasStr.length) : <Box flexGrow={1} />}
      {extrasEl}
    </Box>
  );
  const shown = Math.min(count, band.shown ?? count);
  const lines = desktop ? desktopRows(els, band, shown) : terminalRows(els, band, shown, lane !== null);
  return (
    <Box flexDirection="column" gap={desktop ? (band.settings.size === "roomy" ? 1 : 0) : undefined}>
      {lane}
      {header}
      {lines}
    </Box>
  );
}

// the collapsed line: the toggle, then the chips, the one-line text, or the rings, with the extras at its end
function collapsedLine(els: ElementTable, band: DeckBand, surface: Surface, toggle: RenderNode, extrasEl: RenderNode) {
  const { Box, Text } = els;
  const desktop = surface === "desktop";
  const ordered = collapsedOrder(band.rows);
  const toggleCell = band.rows.length ? [toggle] : [];
  if (band.settings.collapsed === "text") {
    const parts = collapsedText(ordered, band.extras, desktop);
    return (
      <Box flexDirection="row" columnGap={1}>
        {toggleCell}
        <Box flexDirection="row" flexShrink={1}>
          <Text wrap="truncate">
            {parts.map((part, i) => (
              <Text key={"k" + i} color={part.color} bold={part.bold}>{part.text}</Text>
            ))}
          </Text>
        </Box>
      </Box>
    );
  }
  if (band.settings.collapsed === "rings") {
    const items = collapsedRings(band.rows, band.spend, band.settings.cost, desktop, band.locale);
    return (
      <Box flexDirection="row" columnGap={2} alignItems="center">
        {toggleCell}
        <Box flexDirection="row" flexShrink={1} overflow="hidden" columnGap={desktop ? 4 : 3} alignItems="center">
          {items.map((item, i) => ringEl(els, item, i, desktop))}
        </Box>
        <Box flexGrow={1} />
        {extrasEl}
      </Box>
    );
  }
  const { chips } = collapsedChips(ordered, {
    desktop,
    cols: band.cols,
    extrasLength: band.extras.join("  ·  ").length,
    terminalStyle: band.settings.style.terminal,
    locale: band.locale,
  });
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      {toggleCell}
      <Box flexDirection="row" alignItems="center">
        {chips.flatMap((chip, i) => chipEls(els, chip, i))}
      </Box>
      <Box flexGrow={1} />
      {extrasEl}
    </Box>
  );
}

// one ring: a limit's ring with its percent and reset, the spend with its amount, the ask, or the busy row
function ringEl(els: ElementTable, item: RingItem, i: number, desktop: boolean) {
  const { Box, Text } = els;
  if (item.kind === "ask") return <Text key={"k" + i} color={item.color}>{item.text}</Text>;
  if (item.kind === "busy") {
    return (
      <Box key={"k" + i} flexShrink={1}>
        <Text color={item.color} wrap="truncate">{item.glyph + " " + item.text}</Text>
      </Box>
    );
  }
  const glyph = ringGlyph(els, item, desktop);
  if (item.kind === "limit") {
    return (
      <Box key={"k" + i} flexDirection="row" flexShrink={0} columnGap={1} alignItems="center">
        {glyph}
        <Text color={TEXT} bold wrap="truncate">{item.percent}</Text>
        <Text color={MUTED} wrap="truncate">{item.label}</Text>
      </Box>
    );
  }
  return (
    <Box key={"k" + i} flexDirection="row" flexShrink={0} columnGap={1} alignItems="center">
      {glyph}
      <Text color={item.color} bold wrap="truncate">{item.amount}</Text>
      <Text color={MUTED} wrap="truncate">{item.note}</Text>
    </Box>
  );
}

// the ring on the desktop, its glyph in the terminal
function ringGlyph(els: ElementTable, item: Extract<RingItem, { kind: "limit" | "spend" }>, desktop: boolean) {
  if (desktop && item.svg && "Svg" in els) {
    const { Svg } = els as ElementTable<"desktop">;
    return <Svg source={item.svg} alt={item.alt} width={22} height={22} />;
  }
  const { Text } = els;
  return <Text color={item.color}>{item.glyph}</Text>;
}

// one chip as flat siblings, so the chips sit against each other with the separators between
function chipEls(els: ElementTable, chip: Chip, i: number) {
  const { Text } = els;
  if (chip.kind === "separator") return [<Text key={"k" + i} color={TRACK}>{" │ "}</Text>];
  if (chip.kind === "more") return [<Text key={"k" + i} color={DIM}>{chip.text}</Text>];
  if (chip.kind === "route") return [<Text key={"k" + i} color={chip.color}>{chip.text}</Text>];
  return [
    <Text key={`${i}g`} color={chip.glyphColor}>{chip.glyph}</Text>,
    <Text key={`${i}t`} color={chip.textColor} bold={chip.bold}>{chip.text}</Text>,
    chipMini(els, chip.mini, i),
  ];
}

// a chip's mini bar: a 36-by-8 track on the desktop, a few cells in the terminal
function chipMini(els: ElementTable, mini: ChipMini, i: number) {
  const { Box, Text } = els;
  if (mini.kind === "cells") return <Box key={`${i}m`} flexDirection="row">{runs(Text, mini.cells)}</Box>;
  if (!("Svg" in els)) return null;
  const { Svg } = els as ElementTable<"desktop">;
  return <Svg key={`${i}m`} source={chipBarSvg(mini.pct, mini.color)} alt={mini.alt} width={36} height={8} />;
}

// the expanded rows on the desktop: a glyph, the title, the track with its right-hand value, and the ✕
function desktopRows(els: ElementTable, band: DeckBand, shown: number) {
  const { Box, Text } = els;
  const { Svg } = els as ElementTable<"desktop">;
  const total = Math.max(320, band.cols * PX_PER_COL);
  const titleW = Math.min(TITLE_MAX_PX, Math.round(total * 0.28), Math.max(...band.rows.map((r) => Math.round(textWidth(trunc(r.title, TITLE_MAX_CH), 6.4)))));
  const trackW = Math.max(120, Math.min(1400, total - titleW - RIGHT_W - 70));
  return band.rows.slice(0, shown).map((row, i) => {
    const st = STYLE[row.style];
    const drawn = rowSvg(row, trackW, {
      style: band.settings.style.desktop,
      size: band.settings.size,
      routeHist: band.routeHist,
      locale: band.locale,
      caches: band.caches,
      now: band.now,
    });
    // a row that just unfolded fades in from its own age, so the rows below it start later
    const source = band.foldAge === null ? drawn.source : fadeInSvg(drawn.source, band.foldAge - i * FOLD_STEP, FOLD_FADE);
    return (
      <Box key={"row-" + row.id} flexDirection="row" alignItems={row.strips ? "flex-start" : "center"} gap={1}>
        <Text color={st.desk}>{row.kind === "route" ? "⇄" : st.glyph}</Text>
        <Text wrap="truncate">{trunc(row.title, TITLE_MAX_CH)}</Text>
        <Box flexGrow={1} />
        <Svg source={source} alt={rowAlt(row, band.locale)} width={drawn.width} height={drawn.height} />
        {closeButton(els, band, row)}
      </Box>
    );
  });
}

// the expanded rows in the terminal: a glyph, the title, the bar, the right-hand value, the agents under it, and the ✕
function terminalRows(els: ElementTable, band: DeckBand, shown: number, hasLane: boolean) {
  const { Box, Text } = els;
  const maxRows = Math.max(2, (band.maxRows ?? DEFAULT_MAX_ROWS) - 1 - (hasLane ? PET_BRAILLE.rows : 0));
  const labelW = Math.min(24, Math.max(12, Math.floor(band.cols * 0.2)));
  const rightW = 12;
  const barW = Math.max(16, band.cols - labelW - rightW - 8);
  const frame = Math.floor(band.now / FRAME_MS);
  const lines: RenderNode[] = [];
  for (const row of band.rows.slice(0, shown)) {
    if (lines.length >= maxRows) break;
    if (row.kind === "route") {
      const { cells, dirColor } = routeCellsTerminal(row, band.routeHist, band.locale);
      lines.push(
        <Box key={"row-" + row.id} flexDirection="row" columnGap={1}>
          <Text color={STYLE.run.fill}>{"⇄"}</Text>
          <Box width={labelW} flexShrink={0}>
            <Text color={TEXT}>{row.title}</Text>
          </Box>
          <Box flexGrow={1} flexDirection="row">{runs(Text, cells.slice(0, barW))}</Box>
          <Box width={rightW} flexShrink={0} justifyContent="flex-end">
            <Text color={dirColor}>{row.right}</Text>
          </Box>
          {closeButton(els, band, row)}
        </Box>,
      );
      continue;
    }
    const st = STYLE[row.style];
    lines.push(
      <Box key={"row-" + row.id} flexDirection="row" columnGap={1}>
        <Text color={st.fill}>{st.glyph}</Text>
        <Box width={labelW} flexShrink={0}>
          <Text color={TEXT} wrap="truncate">{trunc(row.title, labelW)}</Text>
        </Box>
        <Box flexGrow={1} flexDirection="row">{runs(Text, terminalBar(band.settings.style.terminal, toTrackRow(row), barW, frame))}</Box>
        <Box width={rightW} flexShrink={0} justifyContent="flex-end">
          <Text color={MUTED}>{row.right}</Text>
        </Box>
        {closeButton(els, band, row)}
      </Box>,
    );
    for (const ag of row.strips ? row.strips.shown : []) {
      if (lines.length >= maxRows) break;
      lines.push(agentLine(els, band, ag, frame, labelW));
    }
    if (row.strips?.hidden.length && lines.length < maxRows) {
      lines.push(<Text key={"more-" + row.id} color={DIM}>{"    " + text("deck.strips.more", band.locale, { count: row.strips.hidden.length })}</Text>);
    }
  }
  return lines;
}

// one agent under a terminal row: its state glyph, its title, what it is doing, its model, and how long it has run
function agentLine(els: ElementTable, band: DeckBand, ag: Agent, frame: number, labelW: number) {
  const { Box, Text } = els;
  const ast = STYLE[AGENT_STYLE[ag.state]];
  return (
    <Box key={"agent-" + ag.id} flexDirection="row" columnGap={1}>
      <Text>{ag.depth ? "    " : "  "}</Text>
      <Text color={ast.fill}>{ag.state === "running" && frame % 6 < 3 ? "○" : "●"}</Text>
      <Box width={labelW - 1} flexShrink={0}>
        <Text color={BODY} wrap="truncate">{trunc((ag.depth ? "↳ " : "") + ag.title, labelW - 1)}</Text>
      </Box>
      <Text color={ast.fill} wrap="truncate">{stripTool(ag, band.locale)}</Text>
      {ag.model ? <Text color={PILL_INK} backgroundColor={tierColor(ag.model, false)}>{" " + ag.model + " "}</Text> : null}
      <Box flexGrow={1} />
      <Text color={DIM}>{elapsed((ag.endedAt ?? band.now) - ag.startedAt)}</Text>
    </Box>
  );
}

// the ✕ that dismisses a row
function closeButton(els: ElementTable, band: DeckBand, row: DeckRow) {
  const { Button } = els;
  return <Button key={"x-" + row.id} label="✕" plain dimColor onPress={() => band.dismiss(row)} />;
}

// a row's name for a screen reader: a route's models and effort, or a bar's title, count and share
function rowAlt(row: DeckRow, locale: Locale): string {
  if (row.kind === "route" && row.route) {
    const effort = row.route.effort ? ", " + text("deck.route.effort", locale) + " " + row.route.effort : "";
    return text("deck.route.altLine", locale, { from: row.route.from, to: row.route.to, effort });
  }
  return row.title + ": " + (row.name ?? "") + (row.count ? " " + row.count : "") + ", " + row.right;
}

// the pet's lane: a drawn strip on the desktop; in the terminal, one Raster as wide as the band, in which the
// sprite walks. The Raster keeps its size, so the caller repaints it in place (blit) as the pet moves.
function petLane(els: ElementTable, band: DeckBand, surface: Surface) {
  const { Box } = els;
  if (surface === "desktop" && "Svg" in els) {
    const { Svg } = els as ElementTable<"desktop">;
    const W = Math.max(320, band.cols * PX_PER_COL);
    const H = band.settings.size === "roomy" ? 54 : 44;
    return <Svg source={petLaneSvg(band.pet, band.now, W, H)} alt={text("deck.alt.pet", band.locale, { act: band.pet.act })} width={W} height={H} />;
  }
  if (!("Raster" in els)) return null;
  const { Raster } = els as ElementTable<"terminal">;
  const columns = petLaneColumns(band.cols);
  return (
    <Box flexDirection="row" height={PET_BRAILLE.rows} overflow="hidden">
      <Raster key="deck-pet" columns={columns} rows={PET_BRAILLE.rows} cells={cellsOf(petLaneCells(band.pet, band.now, columns))} />
    </Box>
  );
}

// the pet walking the header line on the desktop, between the row count and the extras
function inlinePetEl(els: ElementTable, band: DeckBand, extrasLength: number) {
  const { Box } = els;
  const { Svg } = els as ElementTable<"desktop">;
  const W = Math.max(80, Math.round(Math.max(320, band.cols * PX_PER_COL) - 170 - extrasLength * 7.5));
  return (
    <Box flexGrow={1} overflow="hidden">
      <Svg source={petLaneSvg(band.pet, band.now, W, HEADER_PET_H, HEADER_PET_SCALE)} alt={text("deck.alt.pet", band.locale, { act: band.pet.act })} width={W} height={HEADER_PET_H} />
    </Box>
  );
}
