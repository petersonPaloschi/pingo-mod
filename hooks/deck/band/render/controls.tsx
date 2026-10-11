import type { ElementTable, RenderNode } from "claude-code";
import { text } from "../../../i18n.ts";
import { collapsedOrder } from "../../model.ts";
import { chipBarSvg, collapsedChips, collapsedRings, collapsedText, featureLines, switchLabel, type Chip, type ChipMini, type FeatureSwitch, type RingItem } from "../../rows.ts";
import { DECK_DESIGN, DIM, MUTED, TEXT, TRACK, runs } from "../../theme.ts";
import { GLYPH, PAINT, UI_DESIGN } from "../../../theme.ts";
import type { Surface, DeckBand } from "../types.ts";
import { DEFAULT_MAX_ROWS, laneLines } from "./extras.tsx";

// the feature switches under the header: a title saying what the two glyphs mean, then one switch per feature,
// each turning its feature on or off the way the dashboard does. On the desktop they wrap with the host's layout;
// in the terminal they are packed into whole lines that count against the row budget (each line may still wrap, so a
// terminal that draws a glyph wider never cuts a switch), and when the band has too little room left for its rows
// they wait for the Deck pane rather than squeeze in
export function featureSwitches(els: ElementTable, band: DeckBand, desktop: boolean, hasLane: boolean): { node: RenderNode | null; lines: number } {
  const { Box, Button, Text } = els;
  if (!band.features.length) return { node: null, lines: 0 };
  const { indent, columnGap, desktopColumnGap, desktopRowGap, minimumRows, spacerRows } = DECK_DESIGN.band.features;
  const legend = `${GLYPH.check} ${text("ui.configuration.enabledValue", band.locale)}  ${GLYPH.off} ${text("ui.configuration.disabledValue", band.locale)}`;
  const title = (
    <Box key="deck-features-title" flexDirection="row" columnGap={columnGap} paddingLeft={indent}>
      <Text color={TEXT} bold>{text("deck.features.title", band.locale)}</Text>
      <Text color={MUTED} wrap="truncate">{legend}</Text>
    </Box>
  );
  // an on switch's ▣ takes the success color, so on and off part at a glance; an off one stays dim, as on the dashboard
  const button = (sw: FeatureSwitch, label: string) => {
    const [glyph = "", ...name] = [...label];
    return (
      <Button key={"deck-feature-" + sw.id} label={label} plain dimColor={!sw.on} onPress={() => band.feature(sw.id, !sw.on)}>
        <Text color={sw.on ? PAINT.ok : MUTED} bold={sw.on}>{glyph}</Text>
        <Text>{name.join("")}</Text>
      </Button>
    );
  };
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
  // a blank row parts the switches (settings) from the rows (what is going on), when at least one row fits under it
  const room = (band.maxRows ?? DEFAULT_MAX_ROWS) - 1 - laneLines(band, hasLane);
  const spacer = band.rows.length && room - 1 - packed.length - spacerRows >= 1 ? spacerRows : 0;
  if (!band.pane && room - 1 - packed.length - spacer < Math.min(minimumRows, band.rows.length)) return { node: null, lines: 0 };
  return {
    node: (
      <Box key="deck-features" flexDirection="column">
        {title}
        {packed.map((line, i) => (
          <Box key={"deck-features-" + i} flexDirection="row" flexWrap="wrap" columnGap={columnGap} paddingLeft={indent}>
            {line.map(({ sw, label }) => button(sw, label))}
          </Box>
        ))}
        {Array.from({ length: spacer }, (_, i) => (
          <Text key={"deck-features-space-" + i}> </Text>
        ))}
      </Box>
    ),
    lines: 1 + packed.length + spacer,
  };
}

// the collapsed line: the toggle, then the chips, the one-line text, or the rings, with the extras at its end
export function collapsedLine(els: ElementTable, band: DeckBand, surface: Surface, toggle: RenderNode, extrasEl: RenderNode) {
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
