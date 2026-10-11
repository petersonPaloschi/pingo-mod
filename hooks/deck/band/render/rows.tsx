import type { ElementTable, RenderNode } from "claude-code";
import { text, type Locale } from "../../../i18n.ts";
import { elapsed, stripTool, type Agent, type DeckRow } from "../../model.ts";
import { fadeInSvg, FOLD_FADE, FOLD_STEP, RIGHT_W, routeCellsTerminal, rowGlyph, rowSvg, tierColor, toTrackRow } from "../../rows.ts";
import { AGENT_STYLE, BODY, DECK_DESIGN, DIM, MUTED, PILL_INK, STYLE, TEXT, TRACK, runs, textWidth, trunc } from "../../theme.ts";
import { terminalBar } from "../../styles-terminal.ts";
import { GLYPH, UI_DESIGN } from "../../../theme.ts";
import type { DeckBand } from "../types.ts";
import { DEFAULT_MAX_ROWS, FRAME_MS, PX_PER_COL, laneLines } from "./extras.tsx";

const BRANCH = GLYPH.branch;
/** A row title is cut to this many characters, and its column is at most this many pixels wide. */
const TITLE_MAX_CH = DECK_DESIGN.band.titleMaxChars;
const TITLE_MAX_PX = DECK_DESIGN.band.titleMaxPixels;

// the expanded rows on the desktop: a glyph, the title, the track with its right-hand value, and the ✕
export function desktopRows(els: ElementTable, band: DeckBand, shown: number) {
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

// the expanded rows in the terminal, each filed like a card: a tab in its state's color before its title, the bar, its
// share right after it and its state's glyph, what is left of the right-hand value (a reset, a rate), the ✕, and the
// agents hanging under it. `reserved` lines (the feature switches) are already taken from the budget.
export function terminalRows(els: ElementTable, band: DeckBand, shown: number, hasLane: boolean, reserved: number) {
  const { Box, Text } = els;
  const layout = DECK_DESIGN.band.terminal;
  const availableRows = (band.maxRows ?? DEFAULT_MAX_ROWS) - 1 - laneLines(band, hasLane) - reserved;
  const maxRows = band.pane ? Math.max(0, availableRows) : Math.max(layout.minimumRows, availableRows);
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
          <Text color={STYLE.run.fill} bold>{GLYPH.tab}</Text>
          <Box width={labelW} flexShrink={0}>
            <Text color={TEXT} bold wrap="truncate">{trunc(row.title, labelW)}</Text>
          </Box>
          <Text color={STYLE.run.fill} bold>{rowGlyph(row)}</Text>
          <Box flexGrow={1} flexDirection="row">{runs(Text, cells.slice(0, barW + layout.valueColumns))}</Box>
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
        <Text color={st.fill} bold>{GLYPH.tab}</Text>
        <Box width={labelW} flexShrink={0}>
          <Text color={TEXT} bold wrap="truncate">{trunc(row.title, labelW)}</Text>
        </Box>
        <Box flexGrow={1} flexDirection="row">{runs(Text, terminalBar(band.settings.style.terminal, toTrackRow(row), barW, frame))}</Box>
        <Box width={layout.valueColumns} flexShrink={0} justifyContent="flex-end">
          <Text color={row.style === "run" ? TEXT : st.fill} bold>{value}</Text>
        </Box>
        <Text color={st.fill} bold>{rowGlyph(row)}</Text>
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

// the ✕ that dismisses a row, at full strength: a control dimmed at rest is one nobody sees
function closeButton(els: ElementTable, band: DeckBand, row: DeckRow) {
  const { Button } = els;
  return <Button key={"x-" + row.id} label="✕" plain onPress={() => band.dismiss(row)} />;
}

// a row's name for a screen reader: a route's models and effort, or a bar's title, count and share
function rowAlt(row: DeckRow, locale: Locale): string {
  if (row.kind === "route" && row.route) {
    const effort = row.route.effort ? ", " + text("deck.route.effort", locale) + " " + row.route.effort : "";
    return text("deck.route.altLine", locale, { from: row.route.from, to: row.route.to, effort });
  }
  return row.title + ": " + (row.name ?? "") + (row.count ? " " + row.count : "") + ", " + row.right;
}
