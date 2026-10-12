import type { ElementTable } from "claude-code";
import { text } from "../../i18n.ts";
import { DECK_DESIGN, DIM, MUTED, TRACK } from "../theme.ts";
import { SEPARATOR } from "../rows.ts";
import { GLYPH, UI_DESIGN } from "../../theme.ts";
import { displayWidth } from "../../layout.ts";
import type { Surface, DeckBand } from "./types.ts";
import { collapsedLine, featureSwitches } from "./render/controls.tsx";
import { desktopRows, terminalRows } from "./render/rows.tsx";
import { inlinePetEl, petLane, pillColumns, pillFace, speechLine } from "./render/extras.tsx";

export { FRAME_MS } from "./render/extras.tsx";

/** The Deck band: the toggle, then the collapsed look, or the expanded rows and the pet. */
export function renderDeck(els: ElementTable, band: DeckBand, surface: Surface) {
  const { Box, Button, Text } = els;
  // nothing to show (no rows, no clock or weather, no pet): an empty column takes no line; the pane keeps its switches
  if (!band.pane && !band.rows.length && !band.extras.length && !band.settings.show.pet) return <Box flexDirection="column" />;
  const desktop = surface === "desktop" && "Svg" in els;
  const expanded = band.expanded && (band.rows.length > 0 || band.pane === true);
  const extrasStr = band.extras.join(desktop ? "  ·  " : SEPARATOR);
  const toggleLabel = text(band.expanded ? "deck.toggle.expanded" : "deck.toggle.collapsed", band.locale);
  const toggleButton = (
    <Button key="deck-toggle" label={toggleLabel} plain hotkey="0" onPress={band.toggle}>
      {pillFace(els, "deck-toggle", toggleLabel)}
    </Button>
  );
  // in the terminal the pill and its key keep their own width, so the parts beside them share only what is left
  const toggleColumns = pillColumns(toggleLabel) + UI_DESIGN.layout.hotkeyColumns;
  const toggle = desktop ? toggleButton : (
    <Box key="deck-toggle-cell" width={toggleColumns} flexShrink={0}>
      {toggleButton}
    </Box>
  );
  const extrasEl = (
    <Box flexShrink={0}>
      <Text color={MUTED}>{extrasStr}</Text>
    </Box>
  );
  // the header line has no room for names over a cast, so a cast always gets the lane
  const inlinePet = expanded && desktop && band.settings.show.pet && band.settings.size !== "roomy" && !band.cast?.length;
  const lane = band.settings.show.pet && !inlinePet ? petLane(els, band, surface) : null;
  const said = lane ? speechLine(els, band) : null;
  if (!expanded) {
    return (
      <Box flexDirection="column">
        {lane}
        {said}
        {collapsedLine(els, band, surface, toggle, extrasEl)}
      </Box>
    );
  }
  const count = band.rows.length;
  const countText = (desktop ? "· " : GLYPH.leader + " ") + (count === 1 ? text("deck.rows.one", band.locale, { count }) : text("deck.rows.many", band.locale, { count }));
  // the band's head: the toggle and the row count, the clock and weather at the far end. In the terminal a rule fills
  // the gap between them, so the head also parts the lane above from the rows below without a line of its own
  // (in the terminal the gaps are spaces of their own: two after the toggle and before the extras, one around the rule)
  const headerGap = desktop ? UI_DESIGN.space.xs : UI_DESIGN.space.none;
  const extrasShown = extrasStr ? UI_DESIGN.space.sm + displayWidth(extrasStr) : 0;
  const ruleColumns = desktop
    ? band.cols - toggleColumns - displayWidth(countText) - displayWidth(extrasStr) - 3 * UI_DESIGN.space.xs - 1
    : band.cols - toggleColumns - UI_DESIGN.space.sm - displayWidth(countText) - UI_DESIGN.space.xs - extrasShown;
  const filler = inlinePet ? (
    inlinePetEl(els, band, extrasStr.length)
  ) : !desktop && ruleColumns >= DECK_DESIGN.band.header.minimumRuleColumns ? (
    <Box flexGrow={1} overflow="hidden">
      <Text color={TRACK}>{GLYPH.rule.repeat(ruleColumns)}</Text>
    </Box>
  ) : (
    <Box flexGrow={1} />
  );
  const header = desktop ? (
    <Box flexDirection="row" columnGap={headerGap} alignItems="center">
      {toggle}
      <Text color={DIM} wrap="truncate-end">{countText}</Text>
      {filler}
      {extrasEl}
    </Box>
  ) : (
    <Box flexDirection="row">
      {toggle}
      <Text>{" ".repeat(UI_DESIGN.space.sm)}</Text>
      <Text color={DIM} wrap="truncate-end">{countText}</Text>
      <Text>{" ".repeat(UI_DESIGN.space.xs)}</Text>
      {filler}
      {extrasStr ? <Text>{" ".repeat(UI_DESIGN.space.sm)}</Text> : null}
      {extrasStr ? extrasEl : null}
    </Box>
  );
  const shown = Math.min(count, band.shown ?? count);
  const switches = featureSwitches(els, band, desktop, lane !== null);
  const lines = desktop ? desktopRows(els, band, shown) : terminalRows(els, band, shown, lane !== null, switches.lines);
  return (
    <Box flexDirection="column" gap={desktop ? (band.settings.size === "roomy" ? UI_DESIGN.space.xs : UI_DESIGN.space.none) : undefined}>
      {lane}
      {said}
      {header}
      {switches.node}
      {lines}
    </Box>
  );
}
