// Deck's band as elements: the collapsed look (chips, one line, or rings), the expanded rows with
// their strips, the feature switches, and the pet lane. Pure: the caller hands in the rows, settings
// and time it drew from.
import type { ElementTable, RenderNode } from "claude-code";

import type { FeatureId } from "../../types";
import { cellsOf } from "../dots.ts";
import { text, type Locale } from "../i18n.ts";
import { collapsedOrder, elapsed, stripTool, type Agent, type DeckRow, type Spend } from "./model.ts";
import { castLaneCells, castLaneSvg, CAST_LABEL_PX, LANE_ROWS, type CastMember } from "./cast.ts";
import { petLaneColumns, petLaneSvg, type Pet } from "./pet.ts";
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
  featureLines,
  routeCellsTerminal,
  rowGlyph,
  rowSvg,
  switchLabel,
  tierColor,
  toTrackRow,
  type Chip,
  type ChipMini,
  type DrawCaches,
  type FeatureSwitch,
  type RingItem,
} from "./rows.ts";
import { AGENT_STYLE, BODY, DECK_DESIGN, DIM, MUTED, PILL_INK, STYLE, TEXT, TRACK, runs, textWidth, trunc } from "./theme.ts";
import { terminalBar } from "./styles-terminal.ts";
import { GLYPH, UI_DESIGN } from "../theme.ts";

const BRANCH = GLYPH.branch;

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
  /** Who stands with the pet on its lane, each named above it: Jev, then the subagents at work. Pingo alone when absent. */
  cast?: readonly CastMember[];
  toggle: () => void;
  /** Rows drawn so far while the band unfolds; every row when absent. */
  shown?: number;
  /** Ms since an opening fold began, or null: each desktop row fades in from its own age. Null while closing. */
  foldAge: number | null;
  /** Terminal lines the band may fill, the pet lane included; 14 when absent. */
  maxRows?: number;
  /** Dismisses one expanded row: the ✕ beside it calls this with the row. */
  dismiss: (row: DeckRow) => void;
  /** Every feature's switch, in the dashboard's order, drawn under the expanded band's header. */
  features: readonly FeatureSwitch[];
  /** Turns one feature on or off through the dashboard's own path, so both always show the same state. */
  feature: (id: FeatureId, on: boolean) => void;
  /** Drawn in the Deck pane: the expanded look even before any row, so the switches stay in reach. */
  pane?: boolean;
};

/** Desktop pixels per column, as the chip budget and the row widths count them. */
const PX_PER_COL = DECK_DESIGN.band.pixelsPerColumn;
/** A row title is cut to this many characters, and its column is at most this many pixels wide. */
const TITLE_MAX_CH = DECK_DESIGN.band.titleMaxChars;
const TITLE_MAX_PX = DECK_DESIGN.band.titleMaxPixels;
/** Terminal lines the band may fill when the caller gives no maxRows. */
const DEFAULT_MAX_ROWS = DECK_DESIGN.band.defaultMaxRows;
/** The terminal animation steps once per this many milliseconds. */
export const FRAME_MS = DECK_DESIGN.motion.frameMs;
/** The pet walking the header line: its height and its scale. */
const HEADER_PET_H = DECK_DESIGN.band.headerPetHeight;
const HEADER_PET_SCALE = DECK_DESIGN.band.headerPetScale;

/** The Deck band: the toggle, then the collapsed look, or the expanded rows and the pet. */
export function renderDeck(els: ElementTable, band: DeckBand, surface: Surface) {
  const { Box, Button, Text } = els;
  // nothing to show (no rows, no clock or weather, no pet): an empty column takes no line; the pane keeps its switches
  if (!band.pane && !band.rows.length && !band.extras.length && !band.settings.show.pet) return <Box flexDirection="column" />;
  const desktop = surface === "desktop" && "Svg" in els;
  const expanded = band.expanded && (band.rows.length > 0 || band.pane === true);
  const extrasStr = band.extras.join("  ·  ");
  const toggle = (
    <Button key="deck-toggle" label={text(band.expanded ? "deck.toggle.expanded" : "deck.toggle.collapsed", band.locale)} plain dimColor hotkey="0" onPress={band.toggle} />
  );
  const extrasEl = (
    <Box flexShrink={0}>
      <Text color={MUTED}>{extrasStr}</Text>
    </Box>
  );
  // the header line has no room for names over a cast, so a cast always gets the lane
  const inlinePet = expanded && desktop && band.settings.show.pet && band.settings.size !== "roomy" && !band.cast?.length;
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
  const countText = "· " + (count === 1 ? text("deck.rows.one", band.locale, { count }) : text("deck.rows.many", band.locale, { count }));
  // the head of the trail: the toggle and the row count, the clock and weather at the far end
  const header = (
    <Box flexDirection="row" columnGap={UI_DESIGN.space.xs} alignItems="center">
      {toggle}
      <Text color={DIM}>{countText}</Text>
      {inlinePet ? inlinePetEl(els, band, extrasStr.length) : <Box flexGrow={1} />}
      {extrasEl}
    </Box>
  );
  const shown = Math.min(count, band.shown ?? count);
  const switches = featureSwitches(els, band, desktop, lane !== null);
  const lines = desktop ? desktopRows(els, band, shown) : terminalRows(els, band, shown, lane !== null, switches.lines);
  return (
    <Box flexDirection="column" gap={desktop ? (band.settings.size === "roomy" ? UI_DESIGN.space.xs : UI_DESIGN.space.none) : undefined}>
      {lane}
      {header}
      {switches.node}
      {lines}
    </Box>
  );
}

// the feature switches under the header: a title saying what the two glyphs mean, then one switch per feature,
// each turning its feature on or off the way the dashboard does. On the desktop they wrap with the host's layout;
// in the terminal they are packed into whole lines that count against the row budget (each line may still wrap, so a
// terminal that draws a glyph wider never cuts a switch), and when the band has too little room left for its rows
// they wait for the Deck pane rather than squeeze in
function featureSwitches(els: ElementTable, band: DeckBand, desktop: boolean, hasLane: boolean): { node: RenderNode | null; lines: number } {
  const { Box, Button, Text } = els;
  if (!band.features.length) return { node: null, lines: 0 };
  const { indent, columnGap, desktopColumnGap, desktopRowGap, minimumRows } = DECK_DESIGN.band.features;
  const legend = `${GLYPH.on} ${text("ui.configuration.enabledValue", band.locale)}  ${GLYPH.off} ${text("ui.configuration.disabledValue", band.locale)}`;
  const title = (
    <Box key="deck-features-title" flexDirection="row" columnGap={columnGap} paddingLeft={indent}>
      <Text color={TEXT} bold>{text("deck.features.title", band.locale)}</Text>
      <Text color={MUTED} wrap="truncate">{legend}</Text>
    </Box>
  );
  const button = (sw: FeatureSwitch, label: string) => (
    <Button key={"deck-feature-" + sw.id} label={label} plain dimColor={!sw.on} onPress={() => band.feature(sw.id, !sw.on)} />
  );
  if (desktop) {
    return {
      node: (
        <Box key="deck-features" flexDirection="column">
          {title}
          <Box flexDirection="row" flexWrap="wrap" columnGap={desktopColumnGap} rowGap={desktopRowGap} paddingLeft={indent}>
            {band.features.map((sw) => button(sw, switchLabel(sw)))}
          </Box>
        </Box>
      ),
      lines: 0,
    };
  }
  const packed = featureLines(band.features, band.cols);
  const room = (band.maxRows ?? DEFAULT_MAX_ROWS) - 1 - (hasLane ? LANE_ROWS : 0);
  if (!band.pane && room - 1 - packed.length < Math.min(minimumRows, band.rows.length)) return { node: null, lines: 0 };
  return {
    node: (
      <Box key="deck-features" flexDirection="column">
        {title}
        {packed.map((line, i) => (
          <Box key={"deck-features-" + i} flexDirection="row" flexWrap="wrap" columnGap={columnGap} paddingLeft={indent}>
            {line.map(({ sw, label }) => button(sw, label))}
          </Box>
        ))}
      </Box>
    ),
    lines: 1 + packed.length,
  };
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
      <Box flexDirection="row" columnGap={UI_DESIGN.space.xs}>
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
      <Box flexDirection="row" columnGap={UI_DESIGN.space.sm} alignItems="center">
        {toggleCell}
        <Box flexDirection="row" flexShrink={1} overflow="hidden" columnGap={DECK_DESIGN.band.collapsed.gap[desktop ? "desktop" : "terminal"]} alignItems="center">
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
    <Box flexDirection="row" columnGap={UI_DESIGN.space.xs} alignItems="center">
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
      <Box key={"k" + i} flexDirection="row" flexShrink={0} columnGap={UI_DESIGN.space.xs} alignItems="center">
        {glyph}
        <Text color={TEXT} bold wrap="truncate">{item.percent}</Text>
        <Text color={MUTED} wrap="truncate">{item.label}</Text>
      </Box>
    );
  }
  return (
    <Box key={"k" + i} flexDirection="row" flexShrink={0} columnGap={UI_DESIGN.space.xs} alignItems="center">
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
    return <Svg source={item.svg} alt={item.alt} width={DECK_DESIGN.ring.size} height={DECK_DESIGN.ring.size} />;
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
  return <Svg key={`${i}m`} source={chipBarSvg(mini.pct, mini.color)} alt={mini.alt} width={DECK_DESIGN.miniBar.width} height={DECK_DESIGN.miniBar.height} />;
}

// the expanded rows on the desktop: a glyph, the title, the track with its right-hand value, and the ✕
function desktopRows(els: ElementTable, band: DeckBand, shown: number) {
  const { Box, Text } = els;
  const { Svg } = els as ElementTable<"desktop">;
  const { desktop } = DECK_DESIGN.band;
  const total = Math.max(DECK_DESIGN.band.minimumDesktopWidth, band.cols * PX_PER_COL);
  const titleW = Math.min(TITLE_MAX_PX, Math.round(total * desktop.titleWidthRatio), Math.max(...band.rows.map((r) => Math.round(textWidth(trunc(r.title, TITLE_MAX_CH), DECK_DESIGN.type.measure.labelPixelsPerChar)))));
  const trackW = Math.max(desktop.trackMinimumWidth, Math.min(desktop.trackMaximumWidth, total - titleW - RIGHT_W - desktop.trackReservePixels));
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
      <Box key={"row-" + row.id} flexDirection="row" alignItems={row.strips ? "flex-start" : "center"} gap={UI_DESIGN.space.xs}>
        <Text color={st.desk}>{rowGlyph(row)}</Text>
        <Text wrap="truncate">{trunc(row.title, TITLE_MAX_CH)}</Text>
        <Box flexGrow={1} />
        <Svg source={source} alt={rowAlt(row, band.locale)} width={drawn.width} height={drawn.height} />
        {closeButton(els, band, row)}
      </Box>
    );
  });
}

// the share a row has come, as the value column shows it next to its bar
const pctOf = (row: DeckRow) => `${Math.round(Math.max(0, Math.min(100, row.pct)))}%`;

/** The value column: wide enough for "100%". */

// the expanded rows in the terminal, a trail: each row's node (its state), the title, the bar, its share right after
// it, what is left of the right-hand value (a reset, a rate), the ✕, and the agents hanging under it. `reserved`
// lines (the feature switches) are already taken from the budget.
function terminalRows(els: ElementTable, band: DeckBand, shown: number, hasLane: boolean, reserved: number) {
  const { Box, Text } = els;
  const layout = DECK_DESIGN.band.terminal;
  const maxRows = Math.max(layout.minimumRows, (band.maxRows ?? DEFAULT_MAX_ROWS) - 1 - (hasLane ? LANE_ROWS : 0) - reserved);
  const labelW = Math.min(layout.labelMaximumColumns, Math.max(layout.labelMinimumColumns, Math.floor(band.cols * layout.labelRatio)));
  const rightW = band.rows.some((row) => row.kind !== "route" && row.right && row.right !== pctOf(row)) ? layout.rightValueColumns : 0;
  const barW = Math.max(1, band.cols - labelW - layout.valueColumns - rightW - layout.barReservedColumns);
  const frame = Math.floor(band.now / FRAME_MS);
  const lines: RenderNode[] = [];
  for (const row of band.rows.slice(0, shown)) {
    if (lines.length >= maxRows) break;
    if (row.kind === "route") {
      const { cells, dirColor } = routeCellsTerminal(row, band.routeHist, band.locale);
      lines.push(
        <Box key={"row-" + row.id} flexDirection="row" columnGap={UI_DESIGN.space.xs}>
          <Text color={STYLE.run.fill}>{rowGlyph(row)}</Text>
          <Box width={labelW} flexShrink={0}>
            <Text color={TEXT} bold wrap="truncate">{trunc(row.title, labelW)}</Text>
          </Box>
          <Box flexGrow={1} flexDirection="row">{runs(Text, cells.slice(0, barW + layout.valueColumns + 1))}</Box>
          <Box flexShrink={0} justifyContent="flex-end">
            <Text color={dirColor}>{row.right}</Text>
          </Box>
          {closeButton(els, band, row)}
        </Box>,
      );
      continue;
    }
    const st = STYLE[row.style];
    const value = pctOf(row);
    const rest = row.right && row.right !== value ? row.right : "";
    lines.push(
      <Box key={"row-" + row.id} flexDirection="row" columnGap={UI_DESIGN.space.xs}>
        <Text color={st.fill} bold>{rowGlyph(row)}</Text>
        <Box width={labelW} flexShrink={0}>
          <Text color={TEXT} bold wrap="truncate">{trunc(row.title, labelW)}</Text>
        </Box>
        <Box flexGrow={1} flexDirection="row">{runs(Text, terminalBar(band.settings.style.terminal, toTrackRow(row), barW, frame))}</Box>
        <Box width={layout.valueColumns} flexShrink={0} justifyContent="flex-end">
          <Text color={row.style === "run" ? TEXT : st.fill} bold>{value}</Text>
        </Box>
        {rightW ? (
          <Box width={rightW} flexShrink={0} justifyContent="flex-end">
            <Text color={MUTED}>{rest}</Text>
          </Box>
        ) : null}
        {closeButton(els, band, row)}
      </Box>,
    );
    for (const ag of row.strips ? row.strips.shown : []) {
      if (lines.length >= maxRows) break;
      lines.push(agentLine(els, band, ag, frame, labelW));
    }
    if (row.strips?.hidden.length && lines.length < maxRows) {
      lines.push(<Text key={"more-" + row.id} color={DIM}>{`  ${BRANCH}${GLYPH.rule} ` + text("deck.strips.more", band.locale, { count: row.strips.hidden.length })}</Text>);
    }
  }
  return lines;
}

// one agent hanging under a terminal row (╰─): its state glyph, its title, what it is doing, its model on its tier's
// ground, and how long it has run
function agentLine(els: ElementTable, band: DeckBand, ag: Agent, frame: number, labelW: number) {
  const { Box, Text } = els;
  const ast = STYLE[AGENT_STYLE[ag.state]];
  const glyph = ag.state === "running" ? (frame % 6 < 3 ? GLYPH.off : GLYPH.on) : ast.glyph;
  const agentLabelW = Math.max(DECK_DESIGN.band.terminal.agentLabelMinimumColumns, labelW - DECK_DESIGN.band.terminal.agentLabelInsetColumns);
  return (
    <Box key={"agent-" + ag.id} flexDirection="row" columnGap={UI_DESIGN.space.xs}>
      <Text color={TRACK}>{ag.depth ? `    ${BRANCH}${GLYPH.rule}` : `  ${BRANCH}${GLYPH.rule}`}</Text>
      <Text color={ast.fill} bold>{glyph}</Text>
      <Box width={agentLabelW} flexShrink={0}>
        <Text color={BODY} wrap="truncate">{trunc(ag.title, agentLabelW)}</Text>
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

// the pet's lane, with its cast and their names on top: a drawn strip on the desktop; in the terminal, one Raster as
// wide as the band, in which the group walks. The Raster keeps its size, so the caller repaints it in place (blit).
function petLane(els: ElementTable, band: DeckBand, surface: Surface) {
  const { Box } = els;
  const cast = band.cast ?? [];
  if (surface === "desktop" && "Svg" in els) {
    const { Svg } = els as ElementTable<"desktop">;
    const W = Math.max(DECK_DESIGN.band.minimumDesktopWidth, band.cols * PX_PER_COL);
    const H = DECK_DESIGN.pet.lane.desktopBandHeight[band.settings.size] + CAST_LABEL_PX;
    const alt = cast.length
      ? text("deck.alt.cast", band.locale, { act: band.pet.act, names: cast.map((member) => member.label).join(", ") })
      : text("deck.alt.pet", band.locale, { act: band.pet.act });
    return <Svg source={castLaneSvg(band.pet, cast, band.now, W, H)} alt={alt} width={W} height={H} />;
  }
  if (!("Raster" in els)) return null;
  const { Raster } = els as ElementTable<"terminal">;
  const columns = petLaneColumns(band.cols);
  return (
    <Box flexDirection="row" height={LANE_ROWS} overflow="hidden">
      <Raster key="deck-pet" columns={columns} rows={LANE_ROWS} cells={cellsOf(castLaneCells(band.pet, cast, band.now, columns))} />
    </Box>
  );
}

// the pet walking the header line on the desktop, between the row count and the extras
function inlinePetEl(els: ElementTable, band: DeckBand, extrasLength: number) {
  const { Box } = els;
  const { Svg } = els as ElementTable<"desktop">;
  const { desktop } = DECK_DESIGN.band;
  const W = Math.max(desktop.inlinePetMinimumWidth, Math.round(Math.max(DECK_DESIGN.band.minimumDesktopWidth, band.cols * PX_PER_COL) - desktop.inlinePetReservedPixels - extrasLength * desktop.inlinePetExtraPixelsPerChar));
  return (
    <Box flexGrow={1} overflow="hidden">
      <Svg source={petLaneSvg(band.pet, band.now, W, HEADER_PET_H, HEADER_PET_SCALE)} alt={text("deck.alt.pet", band.locale, { act: band.pet.act })} width={W} height={HEADER_PET_H} />
    </Box>
  );
}
