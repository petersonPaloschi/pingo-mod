import type { ElementTable, RenderNode } from "claude-code";
import { text, type Locale } from "../../../i18n.ts";
import { elapsed, stripTool, type Agent, type DeckRow } from "../../model.ts";
import { fadeInSvg, FOLD_FADE, FOLD_STEP, RIGHT_W, routeCellsTerminal, rowGlyph, rowSvg, toTrackRow, type Cell } from "../../rows.ts";
import { AGENT_STYLE, BODY, DECK_DESIGN, DIM, MUTED, STYLE, TERMINAL_ROW, TEXT, TRACK, plain, runs, textCells, textWidth, trunc } from "../../theme.ts";
import { terminalBar } from "../../styles-terminal.ts";
import { displayWidth } from "../../../layout.ts";
import { GLYPH, UI_DESIGN } from "../../../theme.ts";
import type { DeckBand } from "../types.ts";
import { DEFAULT_MAX_ROWS, FRAME_MS, PX_PER_COL, laneLines } from "./extras.tsx";

const BRANCH = GLYPH.branch;
/** What a terminal row keeps at its end for the dismiss button: its `x` and the gap before it. */
const CLOSE_COLUMNS = 2;
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

// what a row writes after its meter in the terminal: the value (a plan's step "3/5", otherwise its share), then a state
// mark and the note (what it does now, the count, what is left of the right-hand value such as a reset). A work row and
// a row in a state that needs a word (a question, a failure, a warning, a finished one) carry the mark; a plain meter
// (context, a limit that is fine) does not.
function rowParts(row: DeckRow, terminalStyle: string): { value: string; note: string } {
  const marked = row.kind === "bar" || row.kind === "activity" || row.style === "ask" || row.style === "hot" || row.style === "warn" || row.style === "done";
  const mark = marked ? rowGlyph(row) + " " : "";
  if (row.kind === "bar" && row.count) {
    const head = row.count.split(" ")[0] ?? row.count;
    return { value: head, note: plain(mark + (row.name ?? "") + row.count.slice(head.length)) };
  }
  const value = pctOf(row);
  const rest = row.right && row.right !== value ? row.right : "";
  const rate = terminalStyle === "spark" && row.rate ? row.rate : "";
  const words = [row.name, row.count].filter(Boolean).join(" ");
  return { value, note: plain(mark + words + (rest ? "  " + rest : "") + (rate ? "  " + rate : "")) };
}

// cells cut to `room` columns, the cut marked by "..." as a text is
function clipCells(cells: Cell[], room: number): Cell[] {
  if (cells.length <= room) return cells;
  const dots = GLYPH.ellipsis;
  const last = cells[Math.max(0, room - dots.length - 1)];
  return [...cells.slice(0, Math.max(0, room - dots.length)), ...textCells(dots.slice(0, room), last?.color ?? TEXT)];
}

// the expanded rows in the terminal, in a table: `| ` and the title in bold, the meter, the value, the state mark and the
// note, the `x` that dismisses the row at the far end, and the agents hanging under it. `reserved` lines (the feature
// switches) are already taken from the budget.
export function terminalRows(els: ElementTable, band: DeckBand, shown: number, hasLane: boolean, reserved: number) {
  const { Box, Text } = els;
  const layout = DECK_DESIGN.band.terminal;
  const measure = TERMINAL_ROW;
  const availableRows = (band.maxRows ?? DEFAULT_MAX_ROWS) - 1 - laneLines(band, hasLane) - reserved;
  const maxRows = band.pane ? Math.max(0, availableRows) : Math.max(layout.minimumRows, availableRows);
  const labelW = Math.min(measure.labelMaximumColumns, Math.max(measure.labelMinimumColumns, Math.floor(band.cols * measure.labelRatio)));
  const cells = Math.min(measure.meterMaximumCells, Math.max(measure.meterMinimumCells, Math.round(band.cols * measure.meterRatio)));
  const meterW = cells + 2;
  const style = band.settings.style.terminal;
  const visible = band.rows.slice(0, shown);
  const parts = new Map(visible.filter((row) => row.kind !== "route").map((row) => [row.id, rowParts(row, style)]));
  const valueW = Math.max(measure.valueColumns, ...[...parts.values()].map((part) => displayWidth(part.value)));
  // the row is a flex row with a column gap of one: the tab, the name, the meter, the value (a space either side of the
  // gap, two apart from its neighbours), the note, and the dismiss button
  const gap = UI_DESIGN.space.xs;
  const valueBox = measure.gapColumns - gap + valueW + measure.gapColumns - gap;
  const before = displayWidth(GLYPH.tab) + gap + labelW + gap;
  const noteRoom = Math.max(1, band.cols - before - meterW - gap - valueBox - gap - CLOSE_COLUMNS);
  const frame = Math.floor(band.now / FRAME_MS);
  const lines: RenderNode[] = [];
  const head = (row: DeckRow) => [
    <Text key={"tab-" + row.id} color={TEXT} bold>{GLYPH.tab}</Text>,
    <Box key={"title-" + row.id} width={labelW} flexShrink={0}>
      <Text color={TEXT} bold wrap="truncate">{trunc(row.title, labelW)}</Text>
    </Box>,
  ];
  for (const row of visible) {
    if (lines.length >= maxRows) break;
    if (row.kind === "route") {
      const routeRoom = Math.max(1, band.cols - before - CLOSE_COLUMNS);
      const { cells: routeCells } = routeCellsTerminal(row, band.routeHist, band.locale);
      lines.push(
        <Box key={"row-" + row.id} flexDirection="row" columnGap={gap}>
          {head(row)}
          <Box flexGrow={1} flexShrink={1} flexDirection="row" overflow="hidden">{runs(Text, clipCells(routeCells, routeRoom))}</Box>
          {closeButton(els, band, row, true)}
        </Box>,
      );
      continue;
    }
    const part = parts.get(row.id) ?? { value: "", note: "" };
    lines.push(
      <Box key={"row-" + row.id} flexDirection="row" columnGap={gap}>
        {head(row)}
        <Box flexShrink={0} flexDirection="row">{runs(Text, terminalBar(style, toTrackRow(row), meterW, frame))}</Box>
        <Box width={valueBox} flexShrink={0}>
          <Text color={TEXT}>{" ".repeat(measure.gapColumns - gap) + part.value}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text color={TEXT} wrap="truncate">{trunc(part.note, noteRoom)}</Text>
        </Box>
        {closeButton(els, band, row, true)}
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

// one agent hanging under a terminal row (`--): its state glyph, its title, what it is doing, its model, and how long it
// has run
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
      <Text color={ast.fill} wrap="truncate">{plain(stripTool(ag, band.locale))}</Text>
      {ag.model ? <Text color={MUTED}>{ag.model}</Text> : null}
      <Box flexGrow={1} />
      <Text color={DIM}>{elapsed((ag.endedAt ?? band.now) - ag.startedAt)}</Text>
    </Box>
  );
}

// the button that dismisses a row, at full strength: a control dimmed at rest is one nobody sees. Its face is the ✕ on
// the desktop and an `x` in the terminal.
function closeButton(els: ElementTable, band: DeckBand, row: DeckRow, terminal = false) {
  const { Button } = els;
  return <Button key={"x-" + row.id} label={terminal ? GLYPH.fail : "✕"} plain onPress={() => band.dismiss(row)} />;
}

// a row's name for a screen reader: a route's models and effort, or a bar's title, count and share
function rowAlt(row: DeckRow, locale: Locale): string {
  if (row.kind === "route" && row.route) {
    const effort = row.route.effort ? ", " + text("deck.route.effort", locale) + " " + row.route.effort : "";
    return text("deck.route.altLine", locale, { from: row.route.from, to: row.route.to, effort });
  }
  return row.title + ": " + (row.name ?? "") + (row.count ? " " + row.count : "") + ", " + row.right;
}
