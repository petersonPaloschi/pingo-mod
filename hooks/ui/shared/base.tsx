import type { RenderChildren } from "claude-code";
import type { Category } from "../../events.ts";
import { DOT } from "../../dots.ts";
import { formatClock, type Locale } from "../../i18n.ts";
import { displayWidth } from "../../layout.ts";
import { BORDER_STYLE, GLYPH, PAINT, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { type Els, type Frame } from "../types.ts";
/** A switch: `[x] Label` when on, `[ ] Label` dimmed when off. */
export function toggleButton(els: Els, key: string, on: boolean, label: string, onPress: () => void, hotkey?: string) {
  const { Button } = els;
  return <Button key={key} label={`${on ? GLYPH.check : GLYPH.unchecked} ${label}`} plain hotkey={hotkey} dimColor={!on} onPress={onPress} />;
}

export const CATEGORY_DOT: Record<Category, [glyph: string, color: number]> = {
  hint: [GLYPH.on, DOT.route],
  passthrough: [GLYPH.off, DOT.dim],
  failed: [GLYPH.fail, DOT.fail],
};

export const clock = (time: number, locale: Locale) => formatClock(time, locale);

/** At most `max` characters, cut between code points so an emoji is never split in half; a cut ends in "...". */
export function clip(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = GLYPH.ellipsis.length;
  return max <= cut ? chars.slice(0, Math.max(0, max)).join("") : chars.slice(0, max - cut).join("").trimEnd() + GLYPH.ellipsis;
}

/** A text on one line: its whitespace collapsed first, then clipped, so only a long one gets "...". */
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

/** The ink a label used to take on a colored ground; in black and white it is the plain foreground. */
export const PILL_INK = PAINT.onFill;

/**
 * A label that stands out: a state, a model, the kind of a request. In black and white it is bold words with no
 * ground; `ground` is kept for the callers and the desktop's own drawings, and is not drawn here.
 */
export function pill(els: Els, label: string, _ground?: string) {
  const { Text } = els;
  return <Text bold color={INK.ink}>{label}</Text>;
}

/** Columns a card's frame and air take from its width: the border and one column inside it on each side. */
export const INDENT = UI_DESIGN.layout.indent;

/**
 * A card, the one part every screen is built of: an ASCII frame (`+`, `-`, `|`, dimmed) with its title written into
 * the top edge, `+- Title -----+`, then its body inside. The frame is the host's own (`BORDER_STYLE`); the title is
 * laid over its top edge from a Box placed `absolute` at the top, so it takes no row of its own. The title is alone in
 * its Text, so a section can be found by its words. `glyph` goes before the title (a state); an alert puts "!" there.
 * `color` and `rule` are kept for the callers: in black and white nothing is painted with them.
 */
export function card(els: Frame, title: string, body: RenderChildren, opts: { width: number; color?: string; rule?: string; note?: string; alert?: boolean; glyph?: string }) {
  const { Box, Text } = els;
  const width = Math.max(UI_DESIGN.layout.minCardWidth, opts.width);
  const mark = opts.alert ? GLYPH.warn : opts.glyph;
  // "+- " before the words and " -+" after them: what is left is the room the title has on the edge
  const room = Math.max(1, width - 6 - (mark ? displayWidth(mark) + 1 : 0));
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box flexDirection="column" width={width} borderStyle={BORDER_STYLE} borderColor={INK.border} paddingX={UI_DESIGN.space.xs}>
        {opts.note ? <Text color={INK.faint} wrap="wrap">{opts.note}</Text> : null}
        {body}
      </Box>
      <Box position="absolute" top={0} left={1}>
        <Text wrap="truncate">
          <Text color={INK.border}>{GLYPH.rule + " "}</Text>
          {mark ? <Text bold color={INK.ink}>{mark + " "}</Text> : null}
          <Text bold color={INK.ink}>{clip(title, room)}</Text>
          <Text color={INK.border}>{" " + GLYPH.rule}</Text>
        </Text>
      </Box>
    </Box>
  );
}

/** A feature's own pane as one card the pane's whole width: its name on the top edge, then what it holds. */
export function paneBox(els: Frame, name: string, width: number, body: RenderChildren) {
  return card(els, name, body, { width });
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
export function featureHead(els: Frame, name: string, _color: number, line?: string) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.xs}>
      <Text bold color={INK.ink}>{name}</Text>
      {line ? <Text bold color={INK.ink} wrap="wrap">{line}</Text> : null}
    </Box>
  );
}
export const sheetCard = card;

/** The tab a line above the prompt starts with: a bold `|` (the color is kept for the callers, not drawn). */
export function lineTab(els: Frame, _color: number) {
  const { Text } = els;
  return <Text bold color={INK.ink}>{GLYPH.tab}</Text>;
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
        <Text bold={done} color={done ? INK.ink : INK.dim}>{done ? GLYPH.ok : GLYPH.off}</Text>
        <Text bold color={INK.ink}>{` ${n}. ${label}`}</Text>
      </Text>
      <Box flexDirection="column" marginLeft={4}>
        {body}
      </Box>
    </Box>
  );
}
