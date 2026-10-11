import type { ElementTable, RenderChildren } from "claude-code";
import type { FeatureId, FeedEntry, FeedTone, JevTab, RouteEvent } from "../../types";
import { at, categories, category, int, pct, RANGES, status, tally, type Category, type StatusKind, type Tile } from "../events.ts";
import { cellsOf, DOT, hex } from "../dots.ts";
import { traceConsults } from "../trace.ts";
import { formatAge, formatClock, formatCompact, formatNumber, text, type Locale, type LocaleKey } from "../i18n.ts";
import { displayWidth } from "../layout.ts";
import { css, GLYPH, HUE, inkOn, meter, PAINT, UI_DESIGN, UI_INK as INK } from "../theme.ts";
import { MOODS, type Mood } from "../mascots/pingo.ts";
import { miniPingo } from "../mascots/pixel.ts";
import { type Els, type Frame, type View, type Actions } from "./types.ts";

/**
 * The fourteen screens in their three folders, in the order the rail lists them, with their keys (1 to 9, then 0, o,
 * q, d and a): what this session is doing, the work Pingo and the agents do, and the settings.
 */
export const TABS: readonly (readonly (readonly [JevTab, string, string])[])[] = [
  [
    ["overview", "ui.tab.overview", "1"],
    ["live", "ui.tab.live", "2"],
    ["models", "ui.tab.models", "3"],
  ],
  [
    ["agents", "ui.tab.agents", "4"],
    ["logs", "ui.tab.logs", "5"],
    ["flow", "ui.tab.flow", "0"],
    ["orchestration", "ui.tab.orchestration", "o"],
    ["quality", "ui.tab.quality", "q"],
    ["comandante", "ui.tab.comandante", "d"],
    ["autonomos", "ui.tab.autonomos", "a"],
  ],
  [
    ["configuration", "ui.tab.configuration", "6"],
    ["deck", "ui.tab.deck", "7"],
    ["features", "ui.tab.features", "8"],
    ["ai", "ui.tab.ai", "9"],
  ],
];
/** Each folder's label, in the order of TABS. */
const FOLDERS: readonly LocaleKey[] = ["ui.folder.session", "ui.folder.work", "ui.folder.settings"];

/**
 * The features that change which model runs, how it runs or what is sent to it: the AI screen's, not Features'.
 * The rest (Pingo Vivo, Sentinela) only show state or looks.
 */
export const AI_FEATURES: ReadonlySet<FeatureId> = new Set(["agents", "clareza", "lapida", "farol", "prisma", "semente", "vigia", "contexto", "codeQuality", "comandante", "portao", "rumo", "ensaio", "chaveiro", "oficina"]);
/** Keys the AI screen's own buttons hold (routing, test, remove key): a feature sharing one is toggled without it. */
export const AI_KEYS: ReadonlySet<string> = new Set(["r", "v", "f"]);

export function toggleButton(els: Els, key: string, on: boolean, label: string, onPress: () => void, hotkey?: string) {
  const { Button } = els;
  return <Button key={key} label={`${on ? GLYPH.check : GLYPH.off} ${label}`} plain hotkey={hotkey} dimColor={!on} onPress={onPress} />;
}

const MOOD_OF: Record<StatusKind, Mood> = {
  routing: "routing",
  passthrough: "passthrough",
  failing: "failing",
  idle: "idle",
  baseline: "baseline",
};
export const CATEGORY_DOT: Record<Category, [glyph: string, color: number]> = {
  hint: [GLYPH.on, DOT.route],
  passthrough: [GLYPH.off, DOT.dim],
  failed: [GLYPH.fail, DOT.fail],
};

/** What the Deck tab shows: Deck's settings as saved, how its band stands, and the last reply to a control. */


const fit = (text: string, width: number) => (text.length > width ? text.slice(0, Math.max(0, width - 1)) + "…" : text.padEnd(width));
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

/**
 * Where a scrolled-back body stays. The stored offset counts from the live edge (the newest line),
 * so whatever arrives there would push what is being read out of view: while the person is away
 * from the edge, the position grows by what arrived since. Scrolling back toward the edge closes
 * that gap in step with the scroll left, so offset 0 is the live edge again, and follows it.
 */
const anchors = new Map<string, { scroll: number; at: number; mark: number }>();
export function anchored(key: string, scroll: number, mark: number, addedSince: (mark: number) => number, limit: number): number {
  const was = anchors.get(key);
  if (scroll <= 0) {
    anchors.delete(key);
    return 0;
  }
  let at = scroll;
  if (was) {
    const kept = was.at + addedSince(was.mark);
    at = scroll >= was.scroll ? kept + scroll - was.scroll : Math.round((kept * scroll) / was.scroll);
  }
  at = Math.max(0, Math.min(limit, at));
  anchors.set(key, { scroll, at, mark });
  return at;
}

/** How far back a live log shows, anchored on its lines, and how far its stored offset may go. */
export function feedBack(key: string, view: View, lines: readonly FeedEntry[]): { back: number; max: number } {
  const limit = Math.max(0, lines.length - 1);
  const back = anchored(key, view.scroll, lines.at(-1)?.seq ?? 0, (since) => {
    const i = lines.findIndex((entry) => entry.seq === since);
    return i < 0 ? 0 : lines.length - 1 - i;
  }, limit);
  return { back, max: view.scroll + limit - back };
}

/** Dots per category for a strip of `room`: largest remainders, at least one for each present, never more than the room. */
export function shares(counts: readonly number[], room: number): number[] {
  const total = counts.reduce((s, n) => s + n, 0);
  if (!total || room <= 0) return counts.map(() => 0);
  const exact = counts.map((n) => (room * n) / total);
  const out = exact.map(Math.floor);
  let left = room - out.reduce((s, n) => s + n, 0);
  for (const i of exact.map((_, i) => i).sort((a, b) => exact[b]! - out[b]! - (exact[a]! - out[a]!))) {
    if (left-- <= 0) break;
    out[i] = out[i]! + 1;
  }
  // A category that rounded to nothing takes one dot from the widest.
  counts.forEach((n, i) => {
    if (n <= 0 || out[i]) return;
    const widest = out.indexOf(Math.max(...out));
    if (out[widest]! > 1) {
      out[widest] = out[widest]! - 1;
      out[i] = 1;
    }
  });
  return out;
}

export const inRange = (view: View) => view.events.filter((event) => view.range <= 0 || view.now - at(event) < view.range);

export const consultsInRange = (view: View) => {
  const start = view.range > 0 ? view.now - view.range : Number.NEGATIVE_INFINITY;
  return traceConsults(view.trace).filter((consult) => consult.startedAt >= start && consult.startedAt <= view.now);
};

export { cellsOf };

/** The last five minutes: observed Jev calls, elapsed latency, usage coverage, and failures. */
export function recentStats(view: View) {
  const since = view.now - 5 * 60e3;
  const events = view.events.filter((event) => view.now - at(event) < 5 * 60e3);
  const consults = traceConsults(view.trace).filter((consult) => consult.startedAt >= since && consult.startedAt <= view.now);
  const legacy = consults.length ? [] : events.filter((event) => event.jev);
  const calls = consults.length ? consults : legacy;
  const reportedTokens = consults.length
    ? consults.flatMap((consult) => consult.usage?.input === undefined ? [] : [consult.usage.input])
    : legacy.flatMap((event) => event.jev?.inputTokens === undefined ? [] : [event.jev.inputTokens]);
  const latencies = consults.length
    ? consults.flatMap((consult) => consult.endedAt === undefined ? [] : [Math.max(0, consult.endedAt - consult.startedAt)])
    : legacy.flatMap((event) => event.jev ? [event.jev.latencyMs] : []);
  const failures = consults.length ? consults.filter((consult) => consult.error).length : events.filter((event) => category(event) === "failed").length;
  return {
    calls: calls.length,
    latency: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : undefined,
    tokens: reportedTokens.length ? reportedTokens.reduce((sum, value) => sum + value, 0) : undefined,
    reported: reportedTokens.length,
    failures,
  };
}

function statsParts(stats: ReturnType<typeof recentStats>, locale: Locale) {
  return {
    calls: text("ui.stats.calls", locale, { count: formatNumber(stats.calls, locale) }),
    latency: stats.latency === undefined ? "" : text("ui.stats.latency", locale, { value: formatNumber(stats.latency, locale) }),
    tokens: text("ui.stats.tokens", locale, { value: stats.tokens === undefined ? "–" : formatCompact(stats.tokens, locale) }),
    failures: text("ui.stats.failures", locale, { count: formatNumber(stats.failures, locale) }),
  };
}

export function statsLine(stats: ReturnType<typeof recentStats>, locale: Locale): string {
  const parts = statsParts(stats, locale);
  return [parts.calls, parts.latency, parts.tokens, parts.failures].filter(Boolean).join(" · ");
}

export function statsPartial(stats: ReturnType<typeof recentStats>, locale: Locale): string | undefined {
  return stats.reported < stats.calls
    ? text("ui.stats.tokensPartial", locale, { reported: formatNumber(stats.reported, locale), total: formatNumber(stats.calls, locale) })
    : undefined;
}

/** Pingo's mood: thinking while Jev is being asked, otherwise the routing status. */
export function moodOf(view: Pick<View, "events" | "routing" | "now" | "live" | "locale">): Mood {
  if (view.live.asking) return "thinking";
  return MOOD_OF[status(view.events, view.routing, view.now, view.locale).kind];
}

/**
 * Pingo on the dashboard, still: on the terminal its smallest pixel self, two cells tall, its eyes in the mood's color
 * and its body in the terminal's own; where a Raster does not draw (the desktop) or there is one line to spare, its
 * face as text in the mood's color. No timer moves either.
 */
function pingoMark(els: Els, view: View, mood: Mood, oneLine = false) {
  const { Box, Text } = els;
  if (!oneLine && view.surface === "terminal" && "Raster" in els) {
    const { Raster } = els as unknown as ElementTable<"terminal">;
    const cells = miniPingo(MOODS[mood].color, mood === "baseline");
    const columns = cells[0]!.length;
    return (
      <Box key="pingo" width={columns} height={cells.length} flexShrink={0}>
        <Raster key="pingo-mark" columns={columns} rows={cells.length} cells={cellsOf(cells)} />
      </Box>
    );
  }
  return <Text key="pingo" bold color={hex(MOODS[mood].color)}>{MOODS[mood].face}</Text>;
}

/** Dark ink for a label drawn on a colored ground. */
const PILL_INK = PAINT.onFill;

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

/** The last five minutes in one line, under Pingo's sentence. A failure count above zero is red and marked "!". */
function recentLine(els: Els, view: View) {
  const { Text } = els;
  const stats = recentStats(view);
  const partial = statsPartial(stats, view.locale);
  const parts = statsParts(stats, view.locale);
  return [
    <Text wrap="wrap">
      <Text color={INK.dim}>{`${text("ui.rail.recent", view.locale)}: `}</Text>
      <Text color={INK.ink}>{`${[parts.calls, parts.latency, parts.tokens].filter(Boolean).join(" · ")} · `}</Text>
      <Text bold={stats.failures > 0} color={stats.failures > 0 ? INK.fail : INK.ink}>
        {`${stats.failures > 0 ? `${GLYPH.warn} ` : ""}${parts.failures}`}
      </Text>
    </Text>,
    partial ? <Text color={INK.faint} wrap="wrap">{partial}</Text> : null,
  ];
}

/**
 * One screen's button on the rail or the folded rail. The open one is marked ▸ and bold on the brand's ground, so it
 * reads without color too; the others are dim. `pad` widens the open one's ground across the rail.
 */
function tabButton(els: Els, view: View, act: Actions, [id, label, hotkey]: readonly [JevTab, string, string], pad = 0) {
  const { Button, Text } = els;
  const name = text(label as LocaleKey, view.locale);
  return view.tab === id ? (
    <Button key={"tab-" + id} label={`${GLYPH.open} ${name}`} hotkey={hotkey} plain onPress={() => act.tab(id)}>
      <Text bold color={PILL_INK} backgroundColor={css(HUE.brand)}>{`${GLYPH.open} ${name} `.padEnd(pad)}</Text>
    </Button>
  ) : (
    <Button key={"tab-" + id} label={name} hotkey={hotkey} plain onPress={() => act.tab(id)}>
      <Text color={INK.dim}>{`  ${name}`}</Text>
    </Button>
  );
}

/** Columns the host adds after a plain button for its key: a space and the key in angle quotes. */
const HOTKEY_COLUMNS = UI_DESIGN.layout.hotkeyColumns;

/** The rail's width in this language: the longest screen name, its mark and its key, at least the minimum. */
export function railColumns(locale: Locale): number {
  const longest = Math.max(...TABS.flat().map(([, label]) => displayWidth(text(label as LocaleKey, locale))));
  return Math.max(UI_DESIGN.layout.rail.minColumns, longest + 3 + HOTKEY_COLUMNS);
}

/** The rail down the left: each folder's name, faint and in capitals, then its screens, a blank row between folders. */
export function rail(els: Els, view: View, act: Actions, columns: number) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column" width={columns} flexShrink={0} rowGap={UI_DESIGN.space.xs}>
      {TABS.map((folder, i) => (
        <Box key={"folder-" + i} flexDirection="column">
          <Text bold color={INK.faint}>{` ${text(FOLDERS[i]!, view.locale)}`}</Text>
          {folder.map((tab) => tabButton(els, view, act, tab, columns - HOTKEY_COLUMNS))}
        </Box>
      ))}
    </Box>
  );
}

/** The rail folded for a narrow or short pane: one line per folder, its name and then its screens, wrapping. */
export function foldedRail(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column">
      {TABS.map((folder, i) => (
        <Box key={"folder-" + i} flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.xs}>
          <Text bold color={INK.faint}>{text(FOLDERS[i]!, view.locale)}</Text>
          {folder.map((tab) => tabButton(els, view, act, tab))}
        </Box>
      ))}
    </Box>
  );
}

/** Whether the screens go down a rail on the left: the pane is wide enough beside the cards and tall enough for it. */
export function railed(view: View): boolean {
  return view.width >= UI_DESIGN.layout.rail.minPaneWidth && !(view.fixed && view.rows < UI_DESIGN.layout.rail.minRows);
}

/** Jev's on/off switch, on the AI screen. */
export function routingButton(els: Els, view: View, act: Actions) {
  const { Button } = els;
  return <Button key="routing" plain label={text(view.routing ? "ui.header.turnOff" : "ui.header.turnOn", view.locale)} hotkey="r" onPress={() => act.routing(!view.routing)} />;
}

/**
 * The top of the pane at every width: Pingo, then "jev" on the brand's ground and the state in bold, and under them,
 * in plain words, what is going on and the last five minutes. A short terminal pane keeps the first line only, with
 * Pingo's face.
 */
export function header(els: Els, view: View) {
  const { Box, Text } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const mood = moodOf(view);
  const compact = view.surface === "terminal" && view.rows < 24;
  const said = view.live.asking ? text("ui.header.asking", view.locale) : state.title;
  const nameLine = (
    <Text bold wrap="wrap">
      <Text color={PILL_INK} backgroundColor={css(HUE.brand)}>{" jev "}</Text>
      <Text color={INK.ink}>{` ${state.icon} ${said}`}</Text>
    </Text>
  );
  if (compact) {
    return (
      <Box flexDirection="row" columnGap={UI_DESIGN.space.sm}>
        {pingoMark(els, view, mood, true)}
        {nameLine}
      </Box>
    );
  }
  return (
    <Box flexDirection="row" columnGap={UI_DESIGN.space.sm}>
      {pingoMark(els, view, mood)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {nameLine}
        <Text color={INK.ink} wrap="wrap">{view.live.asking ? text("ui.header.asking", view.locale) : state.text}</Text>
        {recentLine(els, view)}
      </Box>
    </Box>
  );
}

/** The open screen's name in Pingo's color and, under it, what the screen is for. */
export function titleBar(els: Els, view: View) {
  const { Box, Text } = els;
  const entry = TABS.flat().find(([id]) => id === view.tab) ?? TABS[0]![0]!;
  return (
    <Box flexDirection="column">
      <Text bold color={INK.brand}>{text(entry[1] as LocaleKey, view.locale)}</Text>
      <Text color={INK.dim} wrap="wrap">{text(`ui.purpose.${view.tab}` as LocaleKey, view.locale)}</Text>
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

export function rangePicker(els: Els, view: View, act: Actions) {
  const { Select } = els;
  return (
    <Select
      key="range"
      label={text("ui.range", view.locale)}
      value={String(view.range)}
      options={RANGES.map(([key, ms]) => ({ value: String(ms), label: text(key, view.locale) }))}
      onSelect={(value) => act.range(Number(value))}
    />
  );
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

/**
 * A group of figures, `width` columns wide: the label, the value in bold, and its note, in aligned columns with room
 * between them. A figure that flags a failure is red and marked "!". A label too long for its column wraps there
 * rather than being cut; a note too narrow beside them goes under.
 */
export function figures(els: Els, group: readonly Tile[], width: number) {
  const { Box, Text } = els;
  const valueWidth = Math.min(Math.max(...group.map((tile) => displayWidth(tile.value) + (tile.alert ? 2 : 0))), 16);
  const longest = Math.max(...group.map((tile) => displayWidth(tile.label)));
  const labelWidth = Math.max(8, Math.min(longest + 2, width - valueWidth - 2));
  const noteWidth = width - labelWidth - valueWidth - 4;
  const under = noteWidth < 16;
  const note = (tile: Tile) => <Text color={tile.alert ? INK.fail : INK.faint} wrap="wrap">{tile.sub}</Text>;
  return (
    <Box flexDirection="column" rowGap={under ? UI_DESIGN.space.xs : UI_DESIGN.space.none}>
      {group.map((tile) => (
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={UI_DESIGN.space.xs}>
            <Box width={labelWidth} flexShrink={0}>
              <Text color={INK.dim} wrap="wrap">{tile.label}</Text>
            </Box>
            <Box width={valueWidth} flexShrink={0} justifyContent="flex-end">
              <Text bold color={tile.alert ? INK.fail : INK.ink}>{`${tile.alert ? `${GLYPH.warn} ` : ""}${tile.value}`}</Text>
            </Box>
            {under ? null : <Box width={noteWidth} flexShrink={0} marginLeft={1}>{note(tile)}</Box>}
          </Box>
          {under ? <Box paddingLeft={UI_DESIGN.space.sm}>{note(tile)}</Box> : null}
        </Box>
      ))}
    </Box>
  );
}

/**
 * What happened to the requests: each outcome on its own line, its glyph and name, then a ▰▱ meter of ten cells for
 * its share of all requests, with the count and share written beside it. The glyph and the words tell the outcome;
 * the color repeats them.
 */
export function outcomeBar(els: Els, events: readonly RouteEvent[], width: number, locale: Locale) {
  const { Box, Text } = els;
  const counts = new Map(tally(events.map(category)));
  const present = categories(locale).filter(([name]) => counts.get(name));
  return (
    <Box flexDirection="column" marginBottom={1}>
      {present.map(([name, label]) => {
        const count = counts.get(name) ?? 0;
        const [glyph, color] = CATEGORY_DOT[name];
        const [filled, empty] = meter(count / Math.max(1, events.length));
        return (
          <Box flexDirection="column" width={width}>
            <Text wrap="wrap">
              <Text bold color={hex(color)}>{`${glyph} `}</Text>
              <Text color={INK.ink}>{label}</Text>
            </Text>
            <Text wrap="truncate">
              <Text color={hex(color)}>{`  ${filled}`}</Text>
              <Text color={INK.border}>{empty}</Text>
              <Text bold color={INK.ink}>{`  ${int(count, locale)} · ${pct(count, events.length, locale)}`}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

const LEVELS = "▁▂▃▄▅▆▇█";
const OUTCOMES: readonly Category[] = ["passthrough", "hint", "failed"];

/** A request's reported tokens, every counter it has; none when it reported none. */
function requestTokens(event: RouteEvent): number | undefined {
  return event.usage && Object.values(event.usage).some((value) => value !== undefined)
    ? (event.usage.input ?? 0) + (event.usage.cached ?? 0) + (event.usage.cacheWrite ?? 0) + (event.usage.output ?? 0)
    : undefined;
}

/**
 * The range as a sparkline `width` columns wide: one column per slot of time, as tall as the tokens its requests
 * reported (by square root, so a few huge requests do not flatten the rest), in the color of its worst outcome.
 * A slot with no request is a faint dot.
 */
export function sparkline(els: Els, view: View, events: readonly RouteEvent[], width: number) {
  const { Box, Text } = els;
  const columns = Math.max(10, width);
  const end = view.now;
  const start = view.range > 0 ? end - view.range : Math.min(end - 60e3, ...events.map(at));
  if (!events.some((event) => requestTokens(event) !== undefined)) {
    return <Text color={INK.faint} wrap="wrap">{text("ui.timeline.usageUnavailable", view.locale)}</Text>;
  }
  const sums = new Array<number>(columns).fill(0);
  const worst = new Array<number>(columns).fill(-1);
  for (const event of events) {
    const slot = Math.min(columns - 1, Math.max(0, Math.floor(((at(event) - start) / Math.max(1, end - start)) * columns)));
    sums[slot] = sums[slot]! + (requestTokens(event) ?? 0);
    worst[slot] = Math.max(worst[slot]!, OUTCOMES.indexOf(category(event)));
  }
  const peak = Math.max(1, ...sums);
  // runs of one color, so the row is a handful of Texts and not one per column
  const runs: [string, string][] = [];
  sums.forEach((sum, i) => {
    const color = worst[i]! < 0 ? INK.faint : hex(CATEGORY_DOT[OUTCOMES[worst[i]!]!][1]);
    const char = worst[i]! < 0 ? "·" : LEVELS[Math.min(LEVELS.length - 1, Math.floor(Math.sqrt(sum / peak) * LEVELS.length))]!;
    const last = runs.at(-1);
    if (last && last[1] === color) last[0] += char;
    else runs.push([char, color]);
  });
  const complete = events.filter((event) => event.usage?.input !== undefined && event.usage.cached !== undefined && event.usage.cacheWrite !== undefined && event.usage.output !== undefined).length;
  // a slot whose worst outcome failed is marked under the line, so a failure is told by a glyph and not by color alone
  const failedSlot = OUTCOMES.indexOf("failed");
  const marks = worst.some((outcome) => outcome === failedSlot) ? worst.map((outcome) => (outcome === failedSlot ? CATEGORY_DOT.failed[0] : " ")).join("").trimEnd() : "";
  return (
    <Box flexDirection="column">
      <Text>
        {runs.map(([chars, color]) => (
          <Text color={color}>{chars}</Text>
        ))}
      </Text>
      {marks ? <Text bold color={INK.fail} wrap="truncate">{marks}</Text> : null}
      {marks ? <Text color={INK.fail} wrap="wrap">{text("ui.timeline.failMarks", view.locale)}</Text> : null}
      <Text color={INK.faint} wrap="wrap">
        {text("ui.timeline.caption", view.locale, {
          start: view.range > 0 ? text("ui.timeline.ago", view.locale, { age: formatAge(view.range, view.locale) }) : text("ui.timeline.start", view.locale),
          peak: int(peak, view.locale),
        })}
      </Text>
      {complete < events.length ? <Text color={INK.faint} wrap="wrap">{text("ui.timeline.partial", view.locale, { reported: int(complete, view.locale), total: int(events.length, view.locale) })}</Text> : null}
    </Box>
  );
}

/**
 * The selected range at a glance. The range picker leads, since it scopes every figure; the header keeps its own
 * last five minutes. The status sentence shows only when it says more than the header does. Then the cards:
 * Routing and Jev's answers side by side, Token usage and the Timeline across the width under them.
 */

export const ENTRIES_SHOWN = 50;

export function newestFirst<T>(list: readonly T[]): T[] {
  return list.slice(-ENTRIES_SHOWN).reverse();
}

export function lastJevCall(feed: readonly FeedEntry[]): FeedEntry | undefined {
  return feed.findLast((entry) => entry.who === "jev" && entry.kind === "call");
}

export function liveLines(feed: readonly FeedEntry[]): { pinned: FeedEntry | undefined; lines: FeedEntry[] } {
  const pinned = lastJevCall(feed);
  if (!pinned) return { pinned, lines: newestFirst(feed) };
  return { pinned, lines: newestFirst(feed.filter((entry) => entry.seq !== pinned.seq)).slice(0, ENTRIES_SHOWN - 1) };
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

export const TONE_INK: Record<FeedTone, string> = {
  info: INK.ink,
  good: INK.route,
  warn: INK.pass,
  bad: INK.fail,
  muted: INK.dim,
};

/** Who speaks on a line of the live log: a face, a name and a color, so Jev and you never blur. */
