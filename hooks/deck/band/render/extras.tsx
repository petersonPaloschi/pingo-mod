import type { ElementTable, RenderNode } from "claude-code";
import { cellsOf } from "../../../dots.ts";
import { text } from "../../../i18n.ts";
import { castLaneCells, castLaneSvg, CAST_LABEL_PX, LANE_ROWS } from "../../cast.ts";
import { petLaneColumns, petLaneSvg } from "../../pet.ts";
import { DECK_DESIGN, MUTED, TEXT, trunc } from "../../theme.ts";
import { displayWidth } from "../../../layout.ts";
import { GLYPH, UI_DESIGN } from "../../../theme.ts";
import type { Surface, Speech, DeckBand } from "../types.ts";

/** Desktop pixels per column, as the chip budget and the row widths count them. */
export const PX_PER_COL = DECK_DESIGN.band.pixelsPerColumn;
/** Terminal lines the band may fill when the caller gives no maxRows. */
export const DEFAULT_MAX_ROWS = DECK_DESIGN.band.defaultMaxRows;
/** The terminal animation steps once per this many milliseconds. */
export const FRAME_MS = DECK_DESIGN.motion.frameMs;
/** The pet walking the header line: its height and its scale. */
const HEADER_PET_H = DECK_DESIGN.band.headerPetHeight;
const HEADER_PET_SCALE = DECK_DESIGN.band.headerPetScale;

/** Terminal lines the lane takes: its rows, and the speech line under it while a feature has something to say. */
export function laneLines(band: DeckBand, hasLane: boolean): number {
  return hasLane ? LANE_ROWS + (band.speech?.length ? 1 : 0) : 0;
}


// what the features on the lane say, on one line under it: the one speaking first (`> Name:` in bold), its words and an
// "open" button, pressed to open its pane with the whole of it and the choices, then the others' names, underlined, each
// pressed to open its own. The line never wraps out of its budget: the others' names take what the words leave
// beyond their minimum, those that do not fit are counted as "+N", and the words are cut to what is left.
export function speechLine(els: ElementTable, band: DeckBand) {
  const { Box, Button, Text } = els;
  const [lead, ...rest] = band.speech ?? [];
  if (!lead) return null;
  const gap = UI_DESIGN.space.sm;
  const head = `${GLYPH.speech} ${lead.name}:`;
  const openLabel = text("deck.speech.open", band.locale);
  const minimum = DECK_DESIGN.band.speech.minimumTextColumns;
  // the name and the space after it, then inside the lead's button a space before the button, and one column to spare
  const fixed = displayWidth(head) + 1 + 1 + pillColumns(openLabel) + 1;
  const moreWidth = (count: number) => (count ? displayWidth(`+${count}`) + gap : 0);
  const budget = band.cols - fixed - minimum;
  const named: Speech[] = [];
  let used = 0;
  for (const one of rest) {
    const width = displayWidth(one.name) + gap;
    if (used + width + moreWidth(rest.length - named.length - 1) > budget) break;
    named.push(one);
    used += width;
  }
  const more = rest.length - named.length;
  // on a band too narrow for the minimum beside a long name, the words take what is left rather than wrap the line
  const room = Math.max(1, band.cols - fixed - used - moreWidth(more));
  const words = trunc(lead.text, room);
  const space = (key: string, columns = 1) => <Text key={key}>{" ".repeat(columns)}</Text>;
  return (
    <Box key="deck-speech" flexDirection="row" overflow="hidden">
      <Box flexShrink={0}>
        <Text color={TEXT} bold>{head}</Text>
      </Box>
      {space("deck-speech-head")}
      <Button key={"deck-speech-" + lead.id} label={`${words} ${GLYPH.leader} ${openLabel}`} plain onPress={lead.open}>
        <Text color={TEXT}>{words + " "}</Text>
        {pillFace(els, "deck-speech-open", openLabel)}
      </Button>
      {named.flatMap((one) => [
        space("deck-speech-gap-" + one.id, gap),
        <Button key={"deck-speech-" + one.id} label={one.name} plain onPress={one.open}>
          <Text color={TEXT} underline>{one.name}</Text>
        </Button>,
      ])}
      {more ? space("deck-speech-more-gap", gap) : null}
      {more ? <Text color={MUTED}>{`+${more}`}</Text> : null}
    </Box>
  );
}

/** Columns a pill button takes: its label and the brackets and spaces around it (`[ label ]`). */
export const pillColumns = (label: string) => displayWidth(label) + DECK_DESIGN.band.pill.columns;

/** A pill button's face: `[ label ]` in bold on the terminal's own ground, so it reads as a button in black and white. */
export function pillFace(els: ElementTable, key: string, label: string): RenderNode[] {
  const { Text } = els;
  return [
    <Text key={key} bold color={TEXT}>{`${GLYPH.pillStart} ${label} ${GLYPH.pillEnd}`}</Text>,
  ];
}

// the pet's lane, with its cast and their names on top: a drawn strip on the desktop; in the terminal, one Raster as
// wide as the band, in which the group walks. The Raster keeps its size, so the caller repaints it in place (blit).
export function petLane(els: ElementTable, band: DeckBand, surface: Surface) {
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
export function inlinePetEl(els: ElementTable, band: DeckBand, extrasLength: number) {
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
