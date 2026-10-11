import type { RenderChildren } from "claude-code";
import type { Category } from "../../events.ts";
import { DOT } from "../../dots.ts";
import { formatClock, type Locale } from "../../i18n.ts";
import { displayWidth } from "../../layout.ts";
import { css, GLYPH, HUE, inkOn, PAINT, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { type Els, type Frame } from "../types.ts";
export function toggleButton(els: Els, key: string, on: boolean, label: string, onPress: () => void, hotkey?: string) {
  const { Button } = els;
  return <Button key={key} label={`${on ? GLYPH.check : GLYPH.off} ${label}`} plain hotkey={hotkey} dimColor={!on} onPress={onPress} />;
}

export const CATEGORY_DOT: Record<Category, [glyph: string, color: number]> = {
  hint: [GLYPH.on, DOT.route],
  passthrough: [GLYPH.off, DOT.dim],
  failed: [GLYPH.fail, DOT.fail],
};

export const clock = (time: number, locale: Locale) => formatClock(time, locale);

/** At most `max` characters, cut between code points so an emoji is never split in half. */
export function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : text;
}

/** A text on one line: its whitespace collapsed first, then clipped, so only a long one gets "…". */
export const oneLine = (text: string, max: number) => clip(text.replace(/\s+/g, " "), max);

const clockWidths = new Map<Locale, number>();
/** The columns the live log's time takes, a space after it: "12:04:05 PM " in English, "12:04:05 " in Portuguese. */
export function clockWidth(locale: Locale): number {
  let width = clockWidths.get(locale);
  if (width === undefined) {
    // Twelve hours apart, so a morning and an afternoon time are both measured.
    width = Math.max(...[0, 12].map((hour) => displayWidth(clock(Date.UTC(2026, 0, 1, hour, 4, 5), locale)))) + 1;
    clockWidths.set(locale, width);
  }
  return width;
}

/** Dark ink for a label drawn on a colored ground. */
export const PILL_INK = PAINT.onFill;

/** The ink for words on a "#rrggbb" ground: dark, or white on a ground too dark for it (`inkOn`). */
const inkFor = (ground: string) => (/^#[0-9a-f]{6}$/i.test(ground) ? css(inkOn(Number.parseInt(ground.slice(1), 16))) : PILL_INK);

/** A label on a colored ground: a state, a model, the kind of a request. The ground is a mid-tone hex. */
export function pill(els: Els, label: string, ground: string) {
  const { Text } = els;
  return <Text bold color={inkFor(ground)} backgroundColor={ground}>{` ${label} `}</Text>;
}

/** Columns a card's frame and air take from its width: the border and one column inside it on each side. */
export const INDENT = UI_DESIGN.layout.indent;

/**
 * A card, the one part every screen is built of: a rounded frame, a ■ in its accent and its title in bold on the
 * first line, then its body. The title is alone in its Text, so a section can be found by its words. `rule` paints
 * the ■ (a mascot, a state), `color` the title, `glyph` replaces the ■; an alert draws "!" and turns the frame red.
 */
export function card(els: Frame, title: string, body: RenderChildren, opts: { width: number; color?: string; rule?: string; note?: string; alert?: boolean; glyph?: string }) {
  const { Box, Text } = els;
  const width = Math.max(UI_DESIGN.layout.minCardWidth, opts.width);
  const accent = opts.alert ? INK.fail : opts.rule ?? INK.brand;
  return (
    <Box flexDirection="column" width={width} flexShrink={0} borderStyle="round" borderColor={opts.alert ? INK.fail : INK.border} paddingX={UI_DESIGN.space.xs}>
      <Box flexDirection="row" columnGap={UI_DESIGN.space.xs}>
        <Text bold color={accent}>{opts.alert ? GLYPH.warn : opts.glyph ?? GLYPH.on}</Text>
        <Text bold color={opts.alert ? INK.fail : opts.color ?? INK.ink} wrap="wrap">{title}</Text>
      </Box>
      {opts.note ? <Text color={INK.faint} wrap="wrap">{opts.note}</Text> : null}
      {body}
    </Box>
  );
}

/** Cards one under the other, the whole width each. */
export function stack(els: Els, cards: RenderChildren) {
  const { Box } = els;
  return <Box flexDirection="column">{cards}</Box>;
}

/** Columns between cards side by side. */
export const GUTTER = UI_DESIGN.layout.gutter;

/** Cards side by side, as many to a row as `width` holds at `min` columns each (up to `maxColumns`), one otherwise. */
export function grid(els: Els, width: number, cards: readonly ((width: number) => RenderChildren)[], min: number = UI_DESIGN.layout.gridMinWidth, maxColumns: number = UI_DESIGN.layout.gridMaxColumns) {
  const { Box } = els;
  const columns = Math.max(1, Math.min(maxColumns, cards.length, Math.floor((width + GUTTER) / (min + GUTTER))));
  const each = Math.floor((width - GUTTER * (columns - 1)) / columns);
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={GUTTER}>
      {cards.map((make) => make(each))}
    </Box>
  );
}

/**
 * The head of a feature's own pane, in the dashboard's language: the feature's name on its mascot's color, then a line
 * of what it holds. The cards under it are the dashboard's (`sheetCard`).
 */
export function featureHead(els: Frame, name: string, color: number, line?: string) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.xs}>
      <Text bold color={css(inkOn(color))} backgroundColor={css(color)}>{` ${name} `}</Text>
      {line ? <Text color={INK.dim} wrap="wrap">{line}</Text> : null}
    </Box>
  );
}
export const sheetCard = card;

/** The tab a line above the prompt starts with: a stripe in its feature's mascot color. */
export function lineTab(els: Frame, color: number) {
  const { Text } = els;
  return <Text bold color={css(color)}>{GLYPH.tab}</Text>;
}

/** A heading inside a section: bold and dim, its words alone in the Text so they can be found as they are. */
export function section(els: Els, title: string) {
  const { Text } = els;
  return <Text bold color={INK.dim} wrap="truncate">{title}</Text>;
}

/** A line that stands where a section has nothing to show: a hollow glyph, then why. */
export function emptyLine(els: Els, message: string) {
  const { Text } = els;
  return <Text color={INK.dim} wrap="wrap">{`${GLYPH.off} ${message}`}</Text>;
}

export function step(els: Els, n: number, label: string, done: boolean, body: RenderChildren) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column" marginTop={UI_DESIGN.space.xs}>
      <Text wrap="truncate">
        <Text bold color={done ? css(HUE.ok) : css(HUE.neutral)}>{done ? GLYPH.ok : GLYPH.off}</Text>
        <Text bold color={INK.ink}>{` ${n}. ${label}`}</Text>
      </Text>
      <Box flexDirection="column" marginLeft={4}>
        {body}
      </Box>
    </Box>
  );
}
