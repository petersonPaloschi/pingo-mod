// The dashboard uses dotted meters and timelines, text status, and animated mascots for the user
// and subagents. DESIGN.md describes the visual system; dots.ts draws the shared primitives.
import type { ElementTable, RenderChildren } from "claude-code";

import type { AgentRun, AgentState, FeatureFlags, FeatureId, FeedEntry, FeedTone, JevTab, LiveNow, RouteEvent, SetupDraft, TraceState, TraceStep } from "../types";
import { features, modelName } from "./feed.ts";
import { PROVIDER_IDS, PROVIDERS } from "./core/jev.ts";
import {
  at,
  categories,
  category,
  int,
  pct,
  RANGES,
  reasons,
  routed,
  status,
  tally,
  tiles,
  type Category,
  type StatusKind,
  type Tile,
  type TileGroup,
} from "./events.ts";
import { cellsOf, constellation, DOT, hex } from "./dots.ts";
import { failureHint, failureKind } from "./errors.ts";
import { flowLines, flowScene } from "./flow.ts";
import { runTiming, traceConsults } from "./trace.ts";
import { formatAge, formatClock, formatCompact, formatDecimal, formatDuration, formatNumber, localeFor, reasonTitle, text, type Locale, type LocaleKey, type LocaleOption } from "./i18n.ts";
import { displayWidth, rowsOf } from "./layout.ts";
import { brailleFrame, MOODS, pingoSvg, type Mood } from "./mascots/pingo.ts";
import { AGENT_MASCOTS, isMascot, MASCOT_ORDER } from "./mascots/agents.ts";

/** The pane needs Select and Input, which the terminal and the desktop app draw. */
export type Els = ElementTable<"terminal" | "desktop">;

/** The six destinations kept visible in the header, split across two rows. */
export const TABS: readonly (readonly (readonly [JevTab, string, string])[])[] = [
  [
    ["overview", "ui.tab.overview", "1"],
    ["live", "ui.tab.live", "2"],
    ["models", "ui.tab.models", "3"],
  ],
  [
    ["agents", "ui.tab.agents", "4"],
    ["logs", "ui.tab.logs", "5"],
    ["configuration", "ui.tab.configuration", "6"],
  ],
];

/** Text colors: ink for content, grays for labels and notes, the rest only for state. */
const INK = {
  ink: hex(DOT.ink),
  dim: hex(DOT.dim),
  faint: hex(DOT.faint),
  route: hex(DOT.route),
  pass: hex(DOT.pass),
  fail: hex(DOT.fail),
  you: hex(DOT.you),
  claude: hex(DOT.claude),
};

const MOOD_OF: Record<StatusKind, Mood> = {
  routing: "routing",
  passthrough: "passthrough",
  failing: "failing",
  idle: "idle",
  baseline: "baseline",
};
const CATEGORY_DOT: Record<Category, [glyph: string, color: number]> = {
  hint: ["●", DOT.route],
  passthrough: ["○", DOT.dim],
  failed: ["×", DOT.fail],
};

export interface View {
  locale: Locale;
  localeOption: LocaleOption;
  events: readonly RouteEvent[];
  routing: boolean;
  tab: JevTab;
  range: number;
  setup: SetupDraft;
  features: FeatureFlags;
  feed: readonly FeedEntry[];
  live: LiveNow;
  now: number;
  width: number;
  rows: number;
  surface: string;
  meta: string;
  agents: readonly AgentRun[];
  /** The observed record of each run, shown with Live and used by Models. */
  trace: TraceState;
  /** Shows the full run diagram in Live instead of the compact sequence. */
  flowDetails: boolean;
  /**
   * The body's own scroll position: rows from the top on most tabs, log lines back from the newest
   * on a live log. Only read when `fixed`: the pane is drawn exactly as tall as its room, the header
   * stays put, and the mod scrolls the body itself (ui.scroll).
   */
  scroll: number;
  fixed: boolean;
  /** Where the key in use comes from, its last four characters, and the provider in use. */
  key: { source: string; tail: string; provider: string };
}

export interface Actions {
  tab: (tab: JevTab) => void;
  range: (range: number) => void;
  routing: (on: boolean) => void;
  feature: (id: FeatureId, on: boolean) => void;
  provider: (id: string) => void;
  locale: (value: LocaleOption) => void;
  validate: () => void;
  clear: () => void;
  /** Opens subagent #n's own live pane. */
  openAgent: (n: number) => void;
  closeAgent: (n: number) => void;
  /** Back to the Jev pane, on its Live tab. */
  jevLive: () => void;
  /** Expands or collapses the full run details in Live. */
  flowDetails: (open: boolean) => void;
  /** Takes a finished subagent off the Agents tab, or every finished one. */
  removeAgent: (n: number) => void;
  clearAgents: () => void;
  /** The key field: each change (drawn masked), Enter, and removing the saved key. */
  typeKey: (value: string) => void;
  submitKey: (value: string) => void;
  forgetKey: () => void;
  /** How far the body can scroll as drawn, and whether it counts from the newest line up. */
  layout: (max: number, fromEnd: boolean) => void;
}

const fit = (text: string, width: number) => (text.length > width ? text.slice(0, Math.max(0, width - 1)) + "…" : text.padEnd(width));
const clock = (time: number, locale: Locale) => formatClock(time, locale);

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
function anchored(key: string, scroll: number, mark: number, addedSince: (mark: number) => number, limit: number): number {
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
function feedBack(key: string, view: View, lines: readonly FeedEntry[]): { back: number; max: number } {
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

const inRange = (view: View) => view.events.filter((event) => view.range <= 0 || view.now - at(event) < view.range);

const consultsInRange = (view: View) => {
  const start = view.range > 0 ? view.now - view.range : Number.NEGATIVE_INFINITY;
  return traceConsults(view.trace).filter((consult) => consult.startedAt >= start && consult.startedAt <= view.now);
};

export { cellsOf };

/** The last five minutes: observed Jev calls, elapsed latency, usage coverage, and failures. */
function recentStats(view: View) {
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

function statsLine(stats: ReturnType<typeof recentStats>, locale: Locale): string {
  return [
    text("ui.stats.calls", locale, { count: formatNumber(stats.calls, locale) }),
    stats.latency === undefined ? "" : text("ui.stats.latency", locale, { value: formatNumber(stats.latency, locale) }),
    text("ui.stats.tokens", locale, { value: stats.tokens === undefined ? "–" : formatCompact(stats.tokens, locale) }),
    text("ui.stats.failures", locale, { count: formatNumber(stats.failures, locale) }),
  ].filter(Boolean).join(" · ");
}

function statsPartial(stats: ReturnType<typeof recentStats>, locale: Locale): string | undefined {
  return stats.reported < stats.calls
    ? text("ui.stats.tokensPartial", locale, { reported: formatNumber(stats.reported, locale), total: formatNumber(stats.calls, locale) })
    : undefined;
}

/** Pingo's mood: thinking while Jev is being asked, otherwise the routing status. */
export function moodOf(view: Pick<View, "events" | "routing" | "now" | "live" | "locale">): Mood {
  if (view.live.asking) return "thinking";
  return MOOD_OF[status(view.events, view.routing, view.now, view.locale).kind];
}

/** Pingo's size in the pane header, in cells: the render and the animation must agree. */
export function pingoSize(width: number): { columns: number; rows: number } {
  return width >= 60 ? { columns: 18, rows: 8 } : { columns: 14, rows: 6 };
}

/** Pingo: braille in the terminal, SVG circles on the desktop. */
function pingoArt(els: Els, view: View, mood: Mood) {
  if (view.surface === "terminal" && "Raster" in els) {
    const { Raster } = els as ElementTable<"terminal">;
    const { columns, rows } = pingoSize(view.width);
    return <Raster key="pingo" columns={columns} rows={rows} cells={cellsOf(brailleFrame(mood, view.now / 1000, columns, rows))} />;
  }
  if (view.surface === "desktop" && "Svg" in els) {
    const { Svg } = els as ElementTable<"desktop">;
    return <Svg source={pingoSvg(mood, view.now / 1000)} alt={`Pingo, ${text(`mascot.mood.${mood}` as LocaleKey, view.locale)}`} />;
  }
  return null;
}

function header(els: Els, view: View, act: Actions) {
  const { Box, Button, Text } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const mood = moodOf(view);
  const moodInk = hex(MOODS[mood].color);
  const stats = recentStats(view);
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {pingoArt(els, view, mood)}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text wrap="truncate">
            <Text bold color={INK.ink}>⠿ jev</Text>
            <Text color={INK.faint}>{`  · ${text(mood === "thinking" ? "ui.header.asking" : "ui.header.mascot", view.locale)}`}</Text>
          </Text>
          <Text bold color={moodInk} wrap="truncate">{`${MOODS[mood].face} ${state.icon} ${state.title}`}</Text>
          <Text color={INK.dim} wrap="truncate">{statsLine(stats, view.locale)}</Text>
          {statsPartial(stats, view.locale) ? <Text color={INK.faint} wrap="truncate">{statsPartial(stats, view.locale)}</Text> : null}
        </Box>
        <Button
          key="routing"
          label={text(view.routing ? "ui.header.turnOff" : "ui.header.turnOn", view.locale)}
          hotkey="r"
          onPress={() => act.routing(!view.routing)}
        />
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        {TABS.flat().map(([id, label, hotkey]) => {
          const name = text(label as LocaleKey, view.locale);
          // The open tab is bracketed and bright; the others are dim labels you press.
          const open = view.tab === id;
          return <Button key={"tab-" + id} label={open ? `❮ ${name} ❯` : ` ${name} `} hotkey={hotkey} plain {...(open ? {} : { dimColor: true })} onPress={() => act.tab(id)} />;
        })}
      </Box>
      <Text color={INK.faint} wrap="truncate">{"─".repeat(Math.max(1, view.width))}</Text>
    </Box>
  );
}

function rangePicker(els: Els, view: View, act: Actions) {
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

function section(els: Els, title: string) {
  const { Text } = els;
  return (
    <Text bold color={INK.ink}>
      <Text color={INK.faint}>⠿ </Text>
      {title}
    </Text>
  );
}

/** One group of figures, as label / value / note columns with no boxes around them; a narrow pane wraps them. */
function figures(els: Els, view: View, group: readonly Tile[]) {
  const { Box, Text } = els;
  const perRow = view.width >= 75 ? 3 : 2;
  const cellWidth = Math.max(14, Math.floor(view.width / perRow) - 2);
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={1}>
      {group.map((tile) => (
        <Box flexDirection="column" width={cellWidth}>
          <Text color={INK.dim}>{fit(tile.label, cellWidth)}</Text>
          <Text bold color={INK.ink}>{fit(tile.value, cellWidth)}</Text>
          <Text color={tile.alert ? INK.fail : INK.faint}>{fit(tile.sub, cellWidth)}</Text>
        </Box>
      ))}
    </Box>
  );
}

/** What happened to each request, as a strip of dots per category and a one-row legend. */
function dotsBar(els: Els, events: readonly RouteEvent[], width: number, locale: Locale) {
  const { Box, Text } = els;
  const counts = new Map(tally(events.map(category)));
  const present = categories(locale).filter(([name]) => counts.get(name));
  const room = Math.max(10, width);
  const dots = shares(present.map(([name]) => counts.get(name) ?? 0), room);
  return (
    <Box flexDirection="column">
      <Text>
        {present.map(([name], i) => (
          <Text color={hex(CATEGORY_DOT[name][1])}>{"⣿".repeat(dots[i]!)}</Text>
        ))}
      </Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        {present.map(([name, label]) => (
          <Text>
            <Text color={hex(CATEGORY_DOT[name][1])}>{`${CATEGORY_DOT[name][0]} `}</Text>
            <Text color={INK.dim}>{label} </Text>
            <Text bold color={INK.ink}>{`${int(counts.get(name) ?? 0, locale)} · ${pct(counts.get(name) ?? 0, events.length, locale)}`}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}

/** The timeline as a constellation: one dot per request, left to right in time, higher with more tokens. */
function sky(els: Els, view: View, events: readonly RouteEvent[]) {
  const { Box, Text } = els;
  const columns = Math.max(20, Math.min(72, view.width - 2));
  const rows = 4;
  const end = view.now;
  const start = view.range > 0 ? end - view.range : Math.min(end - 60e3, ...events.map(at));
  const tokens = (event: RouteEvent) => event.usage && Object.values(event.usage).some((value) => value !== undefined)
    ? (event.usage.input ?? 0) + (event.usage.cached ?? 0) + (event.usage.cacheWrite ?? 0) + (event.usage.output ?? 0)
    : undefined;
  const values = events.map(tokens).filter((value): value is number => value !== undefined);
  const complete = events.filter((event) => event.usage?.input !== undefined && event.usage.cached !== undefined && event.usage.cacheWrite !== undefined && event.usage.output !== undefined).length;
  const peak = Math.max(1, ...values);
  const priority: Record<Category, number> = { passthrough: 0, hint: 1, failed: 2 };
  const points = events.flatMap((event) => {
    const value = tokens(event);
    return value === undefined ? [] : [{
      x: (at(event) - start) / Math.max(1, end - start),
      // Square root, so a few huge requests do not flatten the rest onto the ground.
      y: Math.sqrt(value / peak),
      color: CATEGORY_DOT[category(event)][1],
      priority: priority[category(event)],
    }];
  });
  return (
    <Box flexDirection="column">
      {points.length ? (
        <Box flexDirection="column">
          {constellation(points, columns, rows).map((row) => (
            <Text>
              {row.map(([text, color]) => (
                <Text color={hex(color)}>{text}</Text>
              ))}
            </Text>
          ))}
          <Text color={INK.faint}>{text("ui.timeline.caption", view.locale, {
            start: view.range > 0 ? text("ui.timeline.ago", view.locale, { age: formatAge(view.range, view.locale) }) : text("ui.timeline.start", view.locale),
            peak: int(peak, view.locale),
          })}</Text>
          {complete < events.length ? <Text color={INK.faint} wrap="wrap">{text("ui.timeline.partial", view.locale, { reported: int(complete, view.locale), total: int(events.length, view.locale) })}</Text> : null}
        </Box>
      ) : <Text color={INK.faint}>{text("ui.timeline.usageUnavailable", view.locale)}</Text>}
    </Box>
  );
}

/**
 * The selected range at a glance. The range picker leads, since it scopes every figure below; the
 * header's meters keep their own last-five-minutes window. The status sentence shows only when it
 * says more than the header does: why Jev is failing or passing, when it last ran, that it is off.
 */
function overview(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const events = inRange(view);
  const consults = consultsInRange(view);
  const state = status(view.events, view.routing, view.now, view.locale);
  const all = consults.length ? tiles(events, view.locale, consults) : tiles(events, view.locale);
  const group = (id: TileGroup) => all.filter((tile) => tile.group === id);
  // A heading sits on its content; the blank rows fall between groups.
  const part = (title: LocaleKey, ...body: RenderChildren[]) => (
    <Box flexDirection="column">
      {section(els, text(title, view.locale))}
      {body}
    </Box>
  );
  // With nothing ever recorded, "no requests in the last 5 minutes" only repeats the empty line.
  const note = state.kind === "routing" || (state.kind === "idle" && view.events.length === 0) ? null : state.text;
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {rangePicker(els, view, act)}
          {events.length === 0 ? null : (
            <Text color={INK.dim} wrap="truncate">
              {text("ui.overview.scope", view.locale, { count: int(events.length, view.locale), requests: text(events.length === 1 ? "unit.request" : "unit.requests", view.locale) })}
            </Text>
          )}
          {consults.length ? <Text color={INK.dim} wrap="truncate">{text(view.range <= 0 && view.trace.turns > view.trace.runs.length ? "ui.overview.consultScopeRetained" : "ui.overview.consultScope", view.locale, { count: int(consults.length, view.locale) })}</Text> : null}
        </Box>
        {note === null ? null : <Text color={INK.ink} wrap="wrap">{note}</Text>}
        <Text color={INK.faint} wrap="wrap">{view.meta}</Text>
      </Box>
      {events.length === 0 && consults.length === 0 ? (
        <Text color={INK.dim} wrap="wrap">{text("ui.overview.empty", view.locale)}</Text>
      ) : (
        <Box flexDirection="column" rowGap={1}>
          {events.length ? part("ui.overview.routing", figures(els, view, group("routing")), dotsBar(els, events, view.width - 2, view.locale)) : null}
          {group("jev").length ? part("ui.overview.jev", figures(els, view, group("jev"))) : null}
          {group("tokens").length ? part("ui.overview.tokens", figures(els, view, group("tokens"))) : null}
          {events.length ? part("ui.overview.timeline", sky(els, view, events)) : null}
        </Box>
      )}
    </Box>
  );
}

/** The request log: newest first, one line per request, marked ● hint, ○ passthrough, × failed. */
function logView(els: Els, view: View) {
  const { Box, Text } = els;
  const room = view.fixed ? 200 : Math.max(3, view.rows - 18);
  const rows = view.events.slice(-room).reverse();
  const grouped = reasons(view.events, view.locale);
  const unhandled = view.events.filter((event) => !routed(event)).length;
  const colorFor = (who: string) => (who === text("reason.who.failed", view.locale) ? INK.fail : who === text("reason.who.asked", view.locale) ? INK.pass : INK.dim);
  return (
    <Box flexDirection="column" rowGap={1}>
      {section(els, text("ui.log.title", view.locale))}
      <Box flexDirection="column">
        {section(els, text("ui.log.reasons", view.locale))}
        {grouped.length === 0 ? <Text color={INK.faint}>{text("ui.log.noReasons", view.locale)}</Text> : null}
        {grouped.map((reason) => (
          <Text wrap="wrap">
            <Text bold color={colorFor(reason.who)}>{reasonTitle(reason.name, view.locale)}</Text>
            <Text color={INK.ink}>{` · ${int(reason.count, view.locale)} · ${pct(reason.count, unhandled, view.locale)}`}</Text>
            <Text color={INK.dim}>{` — ${reason.meaning}`}</Text>
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        {rows.length === 0 ? <Text color={INK.dim}>{text("ui.log.empty", view.locale)}</Text> : null}
        {rows.map((event) => logEntry(els, view, event))}
      </Box>
      <Text color={INK.faint} wrap="wrap">{text("ui.log.footer", view.locale)}</Text>
    </Box>
  );
}

/** One request of the log: time, outcome and figures, and why on a line under it. */
function logEntry(els: Els, view: View, event: RouteEvent) {
  const { Box, Text } = els;
  const kind = category(event);
  const [glyph, color] = CATEGORY_DOT[kind];
  const what =
    event.mode === "hint"
      ? text("ui.log.suggested", view.locale, { tool: event.tool ?? "" })
      : event.jev?.choice
        ? text("ui.log.picked", view.locale, { choice: event.jev.choice })
      : text("ui.log.stayedOut", view.locale);
  const confidence = event.confidence ?? event.jev?.confidence;
  const reason = event.reason ? reasonTitle(event.reason, view.locale) : "";
  const reasonDetail = event.reason && reason !== event.reason ? `${reason} (${event.reason})` : reason;
  const usage = event.usage ? [
    event.usage.input === undefined ? "" : text("ui.log.inputTokens", view.locale, { value: int(event.usage.input, view.locale) }),
    event.usage.cached === undefined ? "" : text("ui.log.cachedTokens", view.locale, { value: int(event.usage.cached, view.locale) }),
    event.usage.cacheWrite === undefined ? "" : text("ui.log.cacheWriteTokens", view.locale, { value: int(event.usage.cacheWrite, view.locale) }),
    event.usage.output === undefined ? "" : text("ui.log.outputTokens", view.locale, { value: int(event.usage.output, view.locale) }),
  ].filter(Boolean).join(" · ") : "";
  return (
    <Box flexDirection="column">
      <Text wrap="wrap">
        <Text color={INK.faint}>{`${clock(at(event), view.locale)} `}</Text>
        <Text bold color={hex(color)}>{`${glyph} `}</Text>
        <Text color={INK.ink}>{what}</Text>
        <Text color={INK.dim}>
          {[
            confidence === undefined ? "" : ` · ${formatDecimal(confidence, view.locale)}`,
            event.jev ? ` · ${int(event.jev.latencyMs, view.locale)} ms` : "",
            usage ? ` · ${usage}` : "",
            text("ui.log.duration", view.locale, { value: formatDecimal(event.durationMs / 1000, view.locale, 1) + text("format.seconds", view.locale, { value: "" }) }),
          ].join("")}
        </Text>
      </Text>
      {event.reason ? <Text color={kind === "failed" ? INK.fail : INK.faint} wrap="wrap">{text("ui.log.reason", view.locale, { reason: reasonDetail })}</Text> : null}
      {kind === "failed" && event.error ? <Text color={INK.fail} wrap="wrap">{text("ui.log.cause", view.locale, { cause: event.error })}</Text> : null}
      {kind === "failed" ? <Text color={INK.pass} wrap="wrap">{text("ui.log.hint", view.locale, { hint: failureHint(failureKind(event.error ?? "", event.reason), view.locale) })}</Text> : null}
      {kind === "failed"
        ? (event.jevRaw ?? []).map((raw, index, all) => (
            <Box flexDirection="column" marginLeft={2}>
              <Text color={INK.ink} bold wrap="truncate">
                {text("ui.log.raw", view.locale, {
                  part: all.length > 1 ? text("ui.log.rawPart", view.locale, { n: formatNumber(index + 1, view.locale), total: formatNumber(all.length, view.locale) }) : "",
                  chars: formatNumber(raw.length, view.locale),
                })}
              </Text>
              <Text color={INK.dim} wrap="wrap">{rawReply(raw, view.locale)}</Text>
            </Box>
          ))
        : null}
    </Box>
  );
}

/** Rows of a raw reply the log shows before saying how many more there are. */
const RAW_ROWS = 120;

/** A reply body for reading: indented when it is JSON, cut after RAW_ROWS rows. */
function rawReply(raw: string, locale: Locale): string {
  let body = raw;
  try {
    body = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {}
  const lines = body.split("\n");
  if (lines.length <= RAW_ROWS) return body;
  return [...lines.slice(0, RAW_ROWS), text("ui.log.rawMore", locale, { count: formatNumber(lines.length - RAW_ROWS, locale) })].join("\n");
}

/** One step of the setup: a number, a label column, and what is set there. */
function step(els: Els, n: number, label: string, done: boolean, body: RenderChildren) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="row" columnGap={1}>
      <Box width={13} flexShrink={0}>
        <Text wrap="truncate">
          <Text bold color={done ? INK.route : INK.dim}>{done ? "● " : `${n} `}</Text>
          <Text bold color={INK.ink}>{label}</Text>
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {body}
      </Box>
    </Box>
  );
}

function configurationView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button, Select, Input } = els;
  const chosen = PROVIDER_IDS.includes(view.setup.provider as never) ? view.setup.provider : PROVIDER_IDS.includes(view.key.provider as never) ? view.key.provider : "typesafe";
  const info = PROVIDERS[chosen as keyof typeof PROVIDERS];
  const saved = view.key.source !== "none";
  const typed = view.setup.typed ?? "";
  const message = view.setup.message;
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text color={INK.dim} wrap="wrap">{text("ui.setup.intro", view.locale)}</Text>
        {!view.routing ? <Text color={INK.pass} wrap="wrap">{text("ui.configuration.routingOff", view.locale)}</Text> : null}
      </Box>
      <Box flexDirection="column" rowGap={1}>
        {section(els, text("ui.configuration.agents", view.locale))}
        {features(view.locale).map((feature) => {
          const on = view.features[feature.id];
          return (
            <Box flexDirection="column">
              <Button
                key={"feature-" + feature.id}
                label={on ? `● ${text("ui.configuration.enabled", view.locale, { hotkey: feature.hotkey })}` : `○ ${text("ui.configuration.disabled", view.locale, { hotkey: feature.hotkey })}`}
                hotkey={feature.hotkey}
                onPress={() => act.feature(feature.id, !on)}
              />
              <Text color={INK.dim} wrap="wrap">{feature.description}</Text>
            </Box>
          );
        })}
      </Box>
      <Box flexDirection="column">
        {section(els, text("ui.configuration.provider", view.locale))}
        <Select
          key="language"
          label={text("ui.setup.language", view.locale)}
          value={view.localeOption}
          options={[
            { value: "auto", label: text("ui.setup.languageAuto", view.locale) },
            { value: "en", label: text("ui.setup.languageEnglish", view.locale) },
            { value: "pt", label: text("ui.setup.languagePortuguese", view.locale) },
          ]}
          onSelect={(value) => act.locale(value as LocaleOption)}
        />
        <Text color={INK.faint} wrap="wrap">{text("ui.setup.languageHelp", view.locale)}</Text>
      </Box>
      {step(
        els,
        1,
        text("ui.setup.provider", view.locale),
        true,
        <Box flexDirection="column">
          <Select
            key="provider"
            value={chosen}
            options={PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDERS[id].label }))}
            onSelect={(value) => act.provider(value)}
          />
          <Text color={INK.faint} wrap="wrap">{text("ui.setup.providerNote", view.locale, { note: text(info.noteKey, view.locale), url: info.keyUrl })}</Text>
        </Box>,
      )}
      {step(
        els,
        2,
        text("ui.setup.keyLabel", view.locale),
        saved && !typed,
        <Box flexDirection="column">
          {saved ? (
            <Text wrap="wrap">
              <Text color={INK.route}>{`••••${view.key.tail}`}</Text>
              <Text color={INK.dim}>{text("ui.setup.keyInUse", view.locale, { source: text(`source.${view.key.source}` as LocaleKey, view.locale) })}</Text>
            </Text>
          ) : (
            <Text color={INK.pass} wrap="wrap">{text("ui.setup.noKeyYet", view.locale, { env: info.keyEnv })}</Text>
          )}
          <Input
            key="api-key"
            value={typed}
            placeholder={text(saved ? "ui.setup.keyPlaceholder" : "ui.setup.keyPlaceholderEmpty", view.locale)}
            submitLabel={text("ui.setup.testSave", view.locale)}
            onInput={(value) => act.typeKey(value)}
            onSubmit={(value) => act.submitKey(value)}
          />
          <Text color={INK.faint} wrap="wrap">
            {text("ui.setup.maskedHelp", view.locale)}
          </Text>
        </Box>,
      )}
      {step(
        els,
        3,
        text("ui.setup.connection", view.locale),
        view.setup.isOk && Boolean(message) && !view.setup.busy,
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            <Button key="validate" label={`${text(typed ? "ui.setup.testSave" : "ui.setup.testConnection", view.locale)} (v)`} hotkey="v" onPress={() => act.validate()} />
            {saved && view.key.source === "plugin" ? <Button key="forget" label={`${text("ui.setup.removeKey", view.locale)} (f)`} hotkey="f" onPress={() => act.forgetKey()} /> : null}
          </Box>
          {message ? (
            <Text bold color={view.setup.busy ? INK.dim : view.setup.isOk ? INK.route : INK.fail} wrap="wrap">
              {`${view.setup.busy ? "◌" : view.setup.isOk ? "●" : "×"} ${message}`}
            </Text>
          ) : null}
        </Box>,
      )}
      <Text color={INK.pass} wrap="wrap">
        {text("ui.setup.privacy", view.locale)}
      </Text>
      <Box flexDirection="column">
        <Text color={INK.faint} wrap="wrap">{view.meta}</Text>
        <Box flexDirection="row">
          <Button key="clear" label={`${text("ui.setup.clearHistory", view.locale)} (c)`} hotkey="c" onPress={() => act.clear()} />
        </Box>
      </Box>
    </Box>
  );
}

const TONE_INK: Record<FeedTone, string> = {
  info: INK.ink,
  good: INK.route,
  warn: INK.pass,
  bad: INK.fail,
  muted: INK.dim,
};

/** Who speaks on a line of the live log: a face, a name and a color, so Jev and you never blur. */
export function speaker(entry: Pick<FeedEntry, "who" | "name" | "tone" | "mascot">, locale: Locale = localeFor()): { face: string; name: string; color: string } {
  switch (entry.who) {
    case "you":
      return { face: "●", name: text("ui.live.you", locale), color: INK.you };
    case "jev": {
      const mood: Mood = entry.tone === "bad" ? "failing" : entry.tone === "muted" ? "passthrough" : "routing";
      return { face: MOODS[mood].face, name: text("ui.live.jev", locale), color: hex(MOODS[mood].color) };
    }
    case "claude":
      return { face: "", name: text("ui.live.claude", locale), color: INK.claude };
    case "agent":
      if (isMascot(entry.mascot)) {
        const mascot = AGENT_MASCOTS[entry.mascot];
        return { face: "◆", name: mascot.name, color: hex(mascot.color) };
      }
      return { face: "◆", name: entry.name ?? text("ui.live.subagent", locale), color: INK.ink };
    default:
      return { face: "⠿", name: text("ui.live.mod", locale), color: INK.faint };
  }
}

const FACE_WIDTH = 6;
const NAME_WIDTH = 7;
/** The finer points under a log line: one row each, cut at the edge, never wrapped under the time. */
const DETAIL_ROWS = 3;
/** Jev's and Claude's own words take at most this many rows: the log shows more events at once. */
const SPOKEN_ROWS = 2;
/** A Jev call's card: what it read, each question's prompt and Jev's answer under it. */
const JEV_DETAIL_ROWS = 18;
/** A prompt or a hint wraps to at most this many rows, so a long one never buries the log. */
const PROMPT_ROWS = 3;

/**
 * One line of the live log, dense: time, who (only where the speaker changes), what happened and
 * a short figure at the end. The finer points go on a faint line under it; bookkeeping (a request
 * sent, a turn's end) is one faint line with its figures folded in.
 */
function feedLine(els: Els, view: View, entry: FeedEntry, maxRows?: number) {
  const { Box, Text } = els;
  const who = speaker(entry, view.locale);
  // The time is no column: it sits faint under the text (at the end of a bookkeeping line).
  const gutter = FACE_WIDTH + NAME_WIDTH;
  const minor = entry.minor === true;
  const metaWidth = entry.meta ? Math.min(14, [...entry.meta].length) : 0;
  const when = clock(entry.time, view.locale);
  const spoken = entry.who === "jev" || entry.who === "claude";
  const room = Math.max(10, view.width - gutter - metaWidth - 3);
  const jev = entry.who === "jev";
  const detailRoom = Math.max(10, view.width - gutter - 2);
  // A single card must fit in the live log's physical viewport so the user can scroll to it whole.
  const bodyLimit = jev && maxRows !== undefined ? room * Math.max(1, Math.min(SPOKEN_ROWS, maxRows - 1)) : room * SPOKEN_ROWS;
  const body = spoken ? clip(entry.text, bodyLimit) : entry.text;
  let rows = !minor && entry.detail ? entry.detail.split("\n").slice(0, jev ? JEV_DETAIL_ROWS : DETAIL_ROWS) : [];
  if (jev && maxRows !== undefined) {
    const bodyRows = rowsOf({ type: "Text", props: { wrap: "wrap" }, children: [body] }, room);
    const detailBudget = Math.max(0, maxRows - bodyRows);
    let used = 0;
    const visible: string[] = [];
    for (const [index, row] of rows.entries()) {
      const shown = index === 0 ? `${when} · ${row}` : clip(row, detailRoom * PROMPT_ROWS);
      const height = index === 0 ? 1 : rowsOf({ type: "Text", props: { wrap: "wrap" }, children: [shown] }, detailRoom);
      if (used + height > detailBudget) break;
      visible.push(row);
      used += height;
    }
    // Completed cards keep question and answer pairs intact when the viewport runs out.
    if (visible.at(-1)?.startsWith("?") && rows[visible.length]?.startsWith("→")) visible.pop();
    rows = visible;
  }
  const detailLines = rows.length ? rows : jev && maxRows !== undefined && entry.detail ? [] : [""];
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row">
        <Box width={gutter} flexShrink={0} flexDirection="row">
          {who.face ? (
            <Box width={FACE_WIDTH} flexShrink={0}>
              <Text wrap="truncate" bold={!minor} color={minor ? INK.faint : who.color}>{who.face}</Text>
            </Box>
          ) : null}
          <Box width={who.face ? NAME_WIDTH : FACE_WIDTH + NAME_WIDTH} flexShrink={0}>
            <Text wrap="truncate" bold={!minor} color={minor ? INK.faint : who.color}>{who.name}</Text>
          </Box>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          {minor ? (
            <Text color={INK.faint} wrap="truncate-end">{`${entry.detail ? `${entry.text} · ${entry.detail}` : entry.text} · ${when}`}</Text>
          ) : (
            <Text color={spoken && entry.tone === "info" ? INK.dim : TONE_INK[entry.tone]} bold={entry.kind === "turn" && entry.who === "you"} wrap="wrap">
              {body}
            </Text>
          )}
        </Box>
        {entry.meta ? (
          <Box flexShrink={0} marginLeft={1} width={metaWidth}>
            <Text color={INK.faint} wrap="truncate">{entry.meta}</Text>
          </Box>
        ) : null}
      </Box>
      {!minor
        ? detailLines.map((row, index) => (
            <Box flexDirection="row">
              <Box width={gutter} flexShrink={0} />
              <Box width={2} flexShrink={0}>
                <Text color={INK.faint}>{index === 0 ? "╰ " : "  "}</Text>
              </Box>
              <Box flexShrink={1} flexGrow={1}>
                {jev && index > 0 ? (
                  // A Jev card: the prompts wrap so they can be read, Jev's answers stand out.
                  <Text color={row.startsWith("✕") ? INK.fail : row.startsWith("→") ? (entry.tone === "bad" ? INK.fail : INK.route) : row.startsWith("?") ? INK.dim : INK.faint} wrap="wrap">
                    {clip(row, detailRoom * PROMPT_ROWS)}
                  </Text>
                ) : (
                  <Text color={INK.faint} wrap="truncate-end">{index === 0 ? (row ? `${when} · ${row}` : when) : row}</Text>
                )}
              </Box>
            </Box>
          ))
        : null}
    </Box>
  );
}

/**
 * The log as a conversation, newest last: no gaps between speakers, the face and name drawn where
 * the speaker changes. The Live tab draws every line; a subagent's pane draws only its own.
 */
function conversation(els: Els, view: View, lines: readonly FeedEntry[], empty: string, maxEntryRows?: number) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column" flexShrink={0}>
      {lines.length === 0 ? <Text color={INK.dim}>{empty}</Text> : null}
      {lines.map((entry) => feedLine(els, view, entry, maxEntryRows))}
    </Box>
  );
}

/**
 * A log that sticks to its newest line: the box is as tall as `rows`, the lines sit at its
 * bottom, older ones are cut off at the top, and `back` lines are skipped from the end while the
 * person scrolls up. The line under it says how many newer ones are hidden.
 */
function stuckLog(els: Els, view: View, lines: readonly FeedEntry[], rows: number, empty: string, back: number, before?: RenderChildren) {
  const { Box, Text } = els;
  const end = lines.length - back;
  // Every line takes at least one row, so `rows` lines always fill the box.
  const shown = lines.slice(Math.max(0, end - rows), end);
  const atStart = end - rows <= 0;
  const footer = back > 0 ? 1 : 0;
  const cardRows = Math.max(1, rows - footer - (atStart && before ? rowsOf(before, view.width) : 0));
  return (
    <Box flexDirection="column" height={rows} overflow="hidden" flexShrink={0}>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} justifyContent="flex-end" overflow="hidden">
        <Box flexDirection="column" flexShrink={0}>
          {atStart && before ? before : null}
          {conversation(els, view, shown, empty, cardRows)}
        </Box>
      </Box>
      {footer ? (
        <Text color={INK.pass} wrap="truncate">{text(back === 1 ? "ui.live.scrollFooter.one" : "ui.live.scrollFooter.many", view.locale, { count: formatNumber(back, view.locale) })}</Text>
      ) : null}
    </Box>
  );
}

/** The live log: who speaks, then every observable event, newest last. */
function liveView(els: Els, view: View, act: Actions, rows: number) {
  const { Box, Text } = els;
  const top = liveTop(els, view, act);
  const flow = runFlow(els, view);
  const empty = text("ui.live.emptyFeed", view.locale);
  if (!view.fixed) {
    return (
      <Box flexDirection="column" rowGap={1}>
        {top}
        {flow}
        {conversation(els, view, view.feed.slice(-Math.max(5, view.rows - 20)), empty)}
      </Box>
    );
  }
  if (view.flowDetails) {
    const bodyRows = Math.max(4, rows - rowsOf(top, view.width));
    const total = rowsOf(flow, view.width);
    const max = Math.max(0, total - bodyRows + 1);
    const offset = Math.min(view.scroll, max);
    act.layout(max, false);
    return (
      <Box flexDirection="column" height={rows} overflow="hidden">
        {top}
        <Box flexDirection="column" height={bodyRows - (max ? 1 : 0)} overflow="hidden" flexShrink={0}>
          <Box flexDirection="column" flexShrink={0} marginTop={-offset}>{flow}</Box>
        </Box>
        {max ? <Text color={INK.faint} wrap="truncate">{text("ui.scroll.footer", view.locale, { up: offset > 0 ? "▲" : " ", down: total - offset > bodyRows - 1 ? "▼" : " ", percent: formatNumber((100 * offset) / max, view.locale) })}</Text> : null}
      </Box>
    );
  }
  // Pingo and the run sequence stay visible; the live log below scrolls newest-last.
  const logRows = Math.max(3, rows - rowsOf(top, view.width) - rowsOf(flow, view.width) - 1);
  const { back, max } = feedBack("live", view, view.feed);
  act.layout(max, true);
  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      {top}
      {flow}
      <Text color={INK.faint} wrap="truncate">{"┄".repeat(Math.max(1, view.width))}</Text>
      {stuckLog(els, view, view.feed, logRows, empty, back)}
    </Box>
  );
}

/** Jev calls observed in this session; token counts stay unknown when a response did not report them. */
function jevTally(trace: TraceState, events: readonly RouteEvent[], now: number) {
  const consults = traceConsults(trace);
  if (consults.length) {
    const reportedTokens = consults.flatMap((consult) => consult.usage?.input === undefined ? [] : [consult.usage.input]);
    const durations = consults.flatMap((consult) => consult.endedAt === undefined ? [] : [Math.max(0, consult.endedAt - consult.startedAt)]);
    return {
      calls: consults.length,
      tokens: reportedTokens.length ? reportedTokens.reduce((sum, count) => sum + count, 0) : undefined,
      reported: reportedTokens.length,
      latency: durations.length ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length) : undefined,
      retained: trace.turns > trace.runs.length,
    };
  }
  const asked = events.filter((event) => event.jev);
  const reportedTokens = asked.flatMap((event) => event.jev?.inputTokens === undefined ? [] : [event.jev.inputTokens]);
  return {
    calls: asked.length,
    tokens: reportedTokens.length ? reportedTokens.reduce((sum, count) => sum + count, 0) : undefined,
    reported: reportedTokens.length,
    latency: asked.length ? Math.round(asked.reduce((sum, event) => sum + event.jev!.latencyMs, 0) / asked.length) : undefined,
    retained: false,
  };
}

/**
 * The Live tab's fixed top: current model and activity, and a compact Jev usage tally.
 */
function liveTop(els: Els, view: View, act: Actions) {
  const { Box, Text, Button } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const running = view.agents.filter((run) => run.state === "running").length;
  const mood = MOODS[moodOf(view)];
  const now = view.live;
  const tally = jevTally(view.trace, view.events, view.now);
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="column" flexShrink={1}>
          {section(els, text("ui.live.title", view.locale))}
          <Text wrap="truncate">
            <Text bold color={hex(mood.color)}>{`${mood.face} Jev`}</Text>
            <Text color={now.asking ? INK.route : INK.dim}>{` · ${now.asking ? text("ui.live.asking", view.locale) : state.title}`}</Text>
            <Text color={INK.faint}>{` · ${text("ui.live.nowModel", view.locale, { model: modelName(now.model), effort: now.effort ? ` · ${now.effort}` : "" })}`}</Text>
          </Text>
          <Text wrap="truncate" color={now.activity ? INK.ink : INK.faint}>{now.activity ? `▶ ${now.activity}` : text("ui.live.nowIdle", view.locale)}</Text>
          <Text wrap="truncate" color={INK.dim}>
            {text("ui.live.session", view.locale, {
              calls: formatNumber(tally.calls, view.locale),
              tokens: tally.tokens === undefined ? "–" : formatCompact(tally.tokens, view.locale),
              latency: tally.latency === undefined ? "" : text("ui.live.sessionLatency", view.locale, { value: formatNumber(tally.latency, view.locale) }),
            })}
          </Text>
          {tally.reported < tally.calls ? <Text color={INK.faint} wrap="truncate">{text("ui.live.sessionTokensPartial", view.locale, { reported: formatNumber(tally.reported, view.locale), total: formatNumber(tally.calls, view.locale) })}</Text> : null}
          {tally.retained ? <Text color={INK.faint} wrap="truncate">{text("ui.live.sessionRetained", view.locale)}</Text> : null}
          <Text wrap="truncate">
            <Text bold color={INK.you}>{`● ${text("ui.live.you", view.locale)}`}</Text>
            <Text color={INK.faint}>{" · "}</Text>
            <Text bold color={INK.claude}>Claude</Text>
            <Text color={INK.faint}>{` · ⠿ ${text("ui.live.mod", view.locale)} ·`}</Text>
            {MASCOT_ORDER.map((id) => (
              <Text bold color={hex(AGENT_MASCOTS[id].color)}>{` ◆ ${AGENT_MASCOTS[id].name}`}</Text>
            ))}
          </Text>
          {running ? <Text color={INK.route} wrap="wrap">{text("ui.live.runningAgents", view.locale, { count: formatNumber(running, view.locale), unit: text(running === 1 ? "unit.agent" : "unit.agents", view.locale) })}</Text> : null}
          <Button
            key="flow-details"
            label={text(view.flowDetails ? "ui.flow.backToLive" : "ui.flow.details", view.locale)}
            hotkey={view.flowDetails ? "b" : "f"}
            onPress={() => act.flowDetails(!view.flowDetails)}
          />
      </Box>
    </Box>
  );
}

const AGENT_STATE: Record<AgentState, [label: LocaleKey, glyph: string, color: string]> = {
  running: ["ui.agents.state.running", "●", INK.route],
  done: ["ui.agents.state.done", "✓", INK.dim],
  error: ["ui.agents.state.error", "✗", INK.fail],
  aborted: ["ui.agents.state.aborted", "⊘", INK.pass],
};

/** A subagent's figures in one line: tools, requests, tokens. */
function agentNumbers(run: AgentRun, locale: Locale): string {
  const input = run.inputUsageRequests === undefined || run.tokensIn === undefined ? "–" : formatCompact(run.tokensIn, locale);
  const output = run.outputUsageRequests === undefined || run.tokensOut === undefined ? "–" : formatCompact(run.tokensOut, locale);
  const counts = text("ui.agent.numbers", locale, {
    tools: formatNumber(run.tools, locale),
    toolUnit: text(run.tools === 1 ? "unit.toolCall" : "unit.toolCalls", locale),
    requests: formatNumber(run.requests, locale),
    requestUnit: text(run.requests === 1 ? "unit.request" : "unit.requests", locale),
    input,
    output,
  });
  const partial = [
    run.inputUsageRequests !== undefined && run.inputUsageRequests < run.requests ? text("ui.agent.inputPartial", locale, { reported: formatNumber(run.inputUsageRequests, locale), total: formatNumber(run.requests, locale) }) : "",
    run.outputUsageRequests !== undefined && run.outputUsageRequests < run.requests ? text("ui.agent.outputPartial", locale, { reported: formatNumber(run.outputUsageRequests, locale), total: formatNumber(run.requests, locale) }) : "",
  ].filter(Boolean).join(" · ");
  return partial ? `${counts} · ${partial}` : counts;
}

/** The model a subagent runs on, its effort, and what Jev chose for it. */
function agentModel(run: AgentRun, locale: Locale): string {
  return [modelName(run.model), run.effort ? text("ui.agent.model", locale, { effort: run.effort }) : "", run.jev ? text("ui.agent.jev", locale, { choice: run.jev }) : ""].filter(Boolean).join(" · ");
}

/** A subagent's name and color, when its identifier is known. */
const mascotOf = (run: AgentRun) => (isMascot(run.mascot) ? AGENT_MASCOTS[run.mascot] : undefined);

/** "/•ᴗ•\ Tetra  Explore #3": the mascot's face and name in its color, then the type and number. */
function agentName(els: Els, run: AgentRun, locale: Locale) {
  const { Text } = els;
  const mascot = mascotOf(run);
  return (
    <Text>
      {mascot ? <Text bold color={hex(mascot.color)}>{`◆ ${mascot.name}`}</Text> : <Text bold color={INK.ink}>◆</Text>}
      <Text color={INK.ink}>{`  ${text("ui.agent.number", locale, { type: run.type, number: formatNumber(run.n, locale) })}`}</Text>
    </Text>
  );
}

/** The Agents tab: every subagent Claude started, running ones first, each with its own live. */
function agentsView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button } = els;
  const list = [...view.agents].sort((a, b) => Number(b.state === "running") - Number(a.state === "running") || b.n - a.n);
  const finished = list.filter((run) => run.state !== "running").length;
  return (
    <Box flexDirection="column" rowGap={1}>
      {section(els, text("ui.agents.title", view.locale))}
      {finished ? (
        <Box flexDirection="row">
          <Button key="agents-clear" label={text("ui.agents.clearFinished", view.locale, { count: formatNumber(finished, view.locale) })} hotkey="l" onPress={() => act.clearAgents()} />
        </Box>
      ) : null}
      {list.length === 0 ? (
        <Text color={INK.dim} wrap="wrap">{text("ui.agents.emptyDescription", view.locale)}</Text>
      ) : null}
      {list.map((run) => {
        const [stateKey, glyph, color] = AGENT_STATE[run.state];
        return (
          <Box flexDirection="column">
            <Text wrap="wrap">
              {agentName(els, run, view.locale)}
              <Text bold color={color}>{`  ${glyph} ${text(stateKey, view.locale)}`}</Text>
              <Text color={INK.dim}>{` · ${formatDuration((run.endedAt ?? view.now) - run.startedAt, view.locale)} · ${agentModel(run, view.locale)}`}</Text>
            </Text>
            <Text color={INK.ink} wrap="wrap">{`   ${run.description}`}</Text>
            <Text color={INK.dim} wrap="wrap">
              {`   ${run.state === "running" ? (run.activity ?? text("ui.agent.running", view.locale)) : run.text ? `“${oneLine(run.text, 121)}”` : text("ui.agent.noResponse", view.locale)} · ${agentNumbers(run, view.locale)}`}
            </Text>
            <Box flexDirection="row" marginLeft={3} columnGap={2}>
              <Button key={`agent-open-${run.n}`} label={text("ui.agent.liveOpen", view.locale, { number: formatNumber(run.n, view.locale) })} onPress={() => act.openAgent(run.n)} />
              {run.state === "running" ? null : <Button key={`agent-remove-${run.n}`} label={text("ui.agent.remove", view.locale)} onPress={() => act.removeAgent(run.n)} />}
            </Box>
          </Box>
        );
      })}
      <Text color={INK.faint} wrap="wrap">{text("ui.agent.instructions", view.locale)}</Text>
    </Box>
  );
}

/** One subagent's own live pane: its task and numbers at the top, then only its lines, as they happen. */
export function renderAgentPane(els: Els, view: View, run: AgentRun | undefined, n: number, act: Actions) {
  const { Box, Text, Button } = els;
  const buttons = (
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      <Button key="agent-jev" label={text("ui.agent.openJev", view.locale)} hotkey="j" onPress={() => act.jevLive()} />
      <Button key="agent-close" label={text("ui.agent.close", view.locale)} hotkey="x" onPress={() => act.closeAgent(n)} />
    </Box>
  );
  if (!run) {
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text color={INK.dim} wrap="wrap">{text("ui.agent.unavailable", view.locale, { number: formatNumber(n, view.locale) })}</Text>
        {buttons}
      </Box>
    );
  }
  const [stateKey, glyph, color] = AGENT_STATE[run.state];
  const lines: FeedEntry[] = view.feed.filter((entry) => entry.agent === run.id);
  const modelSteps = view.trace.runs.flatMap((entry) => entry.steps).filter((step) => step.agentId === run.id).slice(-6);
  // Its answer closes the log, in full, once it has ended.
  if (run.state !== "running" && run.text) {
    lines.push({ seq: -1, time: run.endedAt ?? view.now, who: "agent", agent: run.id, mascot: run.mascot, kind: "agent", tone: "info", text: text("ui.agent.result", view.locale, { text: run.text }) });
  }
  const top = (
    <Box flexDirection="column" flexShrink={0}>
      <Text wrap="wrap">
        {agentName(els, run, view.locale)}
        <Text bold color={color}>{`  ${glyph} ${text(stateKey, view.locale)}`}</Text>
        <Text color={INK.dim}>{` · ${formatDuration((run.endedAt ?? view.now) - run.startedAt, view.locale)}`}</Text>
      </Text>
      <Text color={INK.ink} wrap="truncate-end">{run.description}</Text>
      <Text color={INK.dim} wrap="truncate-end">{agentModel(run, view.locale)}</Text>
      <Text color={INK.faint} wrap="truncate-end">{agentNumbers(run, view.locale)}</Text>
      {run.state === "running" ? (
        <Text wrap="truncate-end">
          <Text color={INK.faint}>{text("ui.agent.now", view.locale)} </Text>
          <Text bold color={INK.ink}>{run.activity ?? text("ui.agent.running", view.locale)}</Text>
        </Text>
      ) : null}
      {buttons}
    </Box>
  );
  // The task Claude gave it opens the log: shown once scrolled back to the start.
  const task = (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      <Text color={INK.faint} wrap="truncate">{text("ui.agent.task", view.locale)}</Text>
      <Text color={INK.dim} wrap="wrap">{clip(run.prompt, 480)}</Text>
      {modelSteps.length ? (
        <Box flexDirection="column" marginTop={1}>
          {section(els, text("ui.agent.requests", view.locale))}
          {modelSteps.map((step) => (
            <Box flexDirection="column">
              <Text color={INK.dim} wrap="wrap">
                {text("ui.models.request", view.locale, { number: formatNumber(step.index + 1, view.locale) })}
                {" · "}
                {step.observed
                  ? text("ui.models.responseModel", view.locale, { model: modelName(step.observed) })
                  : text("ui.models.requestedModel", view.locale, { model: modelName(step.sent) })}
                {step.effort ? ` · ${text("ui.models.effort", view.locale, { effort: step.effort })}` : ""}
              </Text>
              <Text color={INK.faint} wrap="wrap">{stepUsage(step.usage, view.locale)}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
  const empty = text("ui.agent.emptyPane", view.locale);
  if (!view.fixed) {
    return (
      <Box flexDirection="column" rowGap={1}>
        {top}
        {task}
        {conversation(els, view, lines.slice(-Math.max(5, view.rows - 20)), empty)}
      </Box>
    );
  }
  const logRows = Math.max(3, view.rows - rowsOf(top, view.width) - 1);
  const { back, max } = feedBack(`agent-${n}`, view, lines);
  act.layout(max, true);
  return (
    <Box flexDirection="column" height={view.rows} overflow="hidden">
      {top}
      <Text color={INK.faint} wrap="truncate">{"┄".repeat(Math.max(1, view.width))}</Text>
      {stuckLog(els, view, lines, logRows, empty, back, task)}
    </Box>
  );
}

/** The latest run's observed sequence and earlier runs, embedded in Live. */
function runFlow(els: Els, view: View) {
  const { Box, Text } = els;
  const run = view.trace.runs.find((candidate) => candidate.id === view.trace.active) ?? view.trace.runs.at(-1);
  const timing = run ? runTiming(run, view.now) : undefined;
  const scene = flowScene(view.trace, view.now, view.locale);
  const compact = view.fixed && !view.flowDetails && scene.nodes.length > 0;
  const compactDetails = compact ? [
    ...(scene.nodes.find((node) => node.id === "message")?.details.slice(-2) ?? []),
    ...(scene.nodes.find((node) => node.id === "agents")?.details.slice(-2) ?? []),
    ...(scene.nodes.find((node) => node.id === "answer")?.details.slice(0, 2) ?? []),
  ] : [];
  const lines = flowLines({ trace: view.trace, now: view.now, width: Math.max(1, view.width - 2), locale: view.locale });
  return (
    <Box flexDirection="column">
      {compact ? (
        <Box flexDirection="column">
          <Text bold color={INK.ink}>{text("ui.flow.sequence", view.locale)}</Text>
          <Text wrap="wrap">
            {scene.nodes.map((node, index) => (
              <Text color={node.color} bold>{`${index ? " → " : ""}${node.glyph} ${node.label}`}</Text>
            ))}
          </Text>
          {compactDetails.map((detail) => <Text color={detail.color} wrap="wrap">{detail.text}</Text>)}
        </Box>
      ) : lines.map((parts) => (
        <Text wrap="truncate">
          {parts.length === 0 ? " " : null}
          {parts.map((part) => (
            <Text color={part.color} bold={part.bold ?? false} {...(part.bg ? { backgroundColor: part.bg } : {})}>
              {part.text}
            </Text>
          ))}
        </Text>
      ))}
      {timing ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={INK.ink}>{text("ui.flow.timing.main", view.locale, { duration: timing.mainResponseMs === undefined ? text("ui.flow.timing.pending", view.locale) : formatDuration(timing.mainResponseMs, view.locale) })}</Text>
          <Text color={INK.dim}>{text("ui.flow.timing.total", view.locale, { duration: formatDuration(timing.totalMs, view.locale), state: text(timing.complete ? "ui.flow.timing.complete" : "ui.flow.timing.active", view.locale) })}</Text>
          <Text color={INK.faint} wrap="wrap">{text("ui.flow.timing.note", view.locale)}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={INK.faint} wrap="wrap">{text("ui.flow.help", view.locale)}</Text>
      </Box>
    </Box>
  );
}

// --- Models tab ---

function stepUsage(usage: TraceStep["usage"], locale: Locale): string {
  if (!usage) return text("ui.models.usageUnavailable", locale);
  const parts = [
    usage.input === undefined ? "" : text("ui.models.inputTokens", locale, { value: formatCompact(usage.input, locale) }),
    usage.output === undefined ? "" : text("ui.models.outputTokens", locale, { value: formatCompact(usage.output, locale) }),
    usage.cacheRead === undefined ? "" : text("ui.models.cacheReadTokens", locale, { value: formatCompact(usage.cacheRead, locale) }),
    usage.cacheWrite === undefined ? "" : text("ui.models.cacheWriteTokens", locale, { value: formatCompact(usage.cacheWrite, locale) }),
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")}${parts.length < 4 ? ` · ${text("ui.models.usagePartial", locale)}` : ""}` : text("ui.models.usageUnavailable", locale);
}

function jevUsageGroups(trace: TraceState) {
  type Counter = "input" | "output" | "cacheRead" | "cacheWrite";
  type Group = { model: string; observed: boolean; calls: number; sums: Partial<Record<Counter, number>>; reported: Partial<Record<Counter, number>> };
  const counters: readonly Counter[] = ["input", "output", "cacheRead", "cacheWrite"];
  const groups = new Map<string, Group>();
  for (const consult of traceConsults(trace)) {
    const observed = consult.observed !== undefined;
    const model = consult.observed ?? consult.model;
    const key = `${observed ? "observed" : "requested"}:${model}`;
    const group = groups.get(key) ?? { model, observed, calls: 0, sums: {}, reported: {} };
    group.calls++;
    for (const counter of counters) {
      const value = consult.usage?.[counter];
      if (value !== undefined) {
        group.sums[counter] = (group.sums[counter] ?? 0) + value;
        group.reported[counter] = (group.reported[counter] ?? 0) + 1;
      }
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

function jevCounterText(group: ReturnType<typeof jevUsageGroups>[number], counter: "input" | "output" | "cacheRead" | "cacheWrite", locale: Locale): string {
  const labels = {
    input: "ui.models.inputTokens",
    output: "ui.models.outputTokens",
    cacheRead: "ui.models.cacheReadTokens",
    cacheWrite: "ui.models.cacheWriteTokens",
  } as const;
  const label = text(labels[counter], locale, { value: "" }).trim();
  const sum = group.sums[counter];
  if (sum === undefined) return text("ui.models.counterUnknown", locale, { name: label });
  const value = text(labels[counter], locale, { value: formatCompact(sum, locale) });
  const reported = group.reported[counter] ?? 0;
  return reported < group.calls ? `${value} ${text("ui.models.counterPartial", locale, { reported: formatNumber(reported, locale), total: formatNumber(group.calls, locale) })}` : value;
}

/** The Models tab reports recorded requests and responses, without predicting later choices. */
function modelsView(els: Els, view: View) {
  const { Box, Text } = els;
  const run = view.trace.runs.find((candidate) => candidate.id === view.trace.active) ?? view.trace.runs.at(-1);
  const steps = run?.steps.filter((step) => !step.agentId) ?? [];
  const jevGroups = jevUsageGroups(view.trace);
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        {section(els, text("ui.models.now", view.locale))}
        <Text bold color={INK.ink}>{`◆ ${modelName(view.live.model)}${view.live.effort ? ` · ${view.live.effort}` : ""}`}</Text>
      </Box>
      <Box flexDirection="column" rowGap={1}>
        {section(els, text("ui.models.requests", view.locale))}
        {steps.length ? steps.slice(-12).map((step, index, shown) => {
          const actual = step.observed ?? step.sent;
          const previous = shown[index - 1];
          const priorModel = previous ? previous.observed ?? previous.sent : undefined;
          return (
            <Box flexDirection="column">
              <Text color={INK.faint} wrap="truncate">
                {text("ui.models.request", view.locale, { number: formatNumber(step.index + 1, view.locale) })}
                {` · ${clock(step.startedAt, view.locale)} · ${step.endedAt === undefined ? text("ui.models.inProgress", view.locale) : formatDuration(step.endedAt - step.startedAt, view.locale)}`}
              </Text>
              <Text wrap="wrap">
                {step.observed
                  ? text("ui.models.responseModel", view.locale, { model: modelName(step.observed) })
                  : text("ui.models.requestedModel", view.locale, { model: modelName(step.sent) })}
                {step.effort ? ` · ${text("ui.models.effort", view.locale, { effort: step.effort })}` : ""}
              </Text>
              {step.observed && step.observed !== step.sent ? (
                <Text color={INK.pass} wrap="wrap">{text("ui.models.requestResponseDiff", view.locale, { requested: modelName(step.sent), observed: modelName(step.observed) })}</Text>
              ) : null}
              {step.original !== step.sent ? (
                <Text color={INK.dim} wrap="wrap">{text("ui.models.engineModelDiff", view.locale, { original: modelName(step.original), sent: modelName(step.sent) })}</Text>
              ) : null}
              {priorModel && actual !== priorModel ? (
                <Text color={INK.dim} wrap="wrap">{text("ui.models.modelChanged", view.locale, { from: modelName(priorModel), to: modelName(actual) })}</Text>
              ) : null}
              <Text color={INK.faint} wrap="wrap">{stepUsage(step.usage, view.locale)}</Text>
            </Box>
          );
        }) : <Text color={INK.faint} wrap="wrap">{text("ui.models.empty", view.locale)}</Text>}
        <Text color={INK.faint} wrap="wrap">{text("ui.models.observedNote", view.locale)}</Text>
        <Text color={INK.faint} wrap="wrap">{text("ui.models.costUnavailable", view.locale)}</Text>
      </Box>
      <Box flexDirection="column" rowGap={1}>
        {section(els, text("ui.models.jevUsage", view.locale))}
        {jevGroups.length ? jevGroups.map((group) => (
          <Box flexDirection="column">
            <Text bold color={INK.ink} wrap="wrap">{text(group.observed ? "ui.models.jevObserved" : "ui.models.jevRequested", view.locale, { model: modelName(group.model), calls: formatNumber(group.calls, view.locale) })}</Text>
            <Text color={INK.faint} wrap="wrap">{jevCounterText(group, "input", view.locale)} · {jevCounterText(group, "output", view.locale)} · {jevCounterText(group, "cacheRead", view.locale)} · {jevCounterText(group, "cacheWrite", view.locale)}</Text>
          </Box>
        )) : <Text color={INK.faint} wrap="wrap">{text("ui.models.jevNoUsage", view.locale)}</Text>}
        {view.trace.turns > view.trace.runs.length ? <Text color={INK.faint} wrap="wrap">{text("ui.models.jevRetained", view.locale)}</Text> : null}
      </Box>
    </Box>
  );
}

export function renderPane(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const top = header(els, view, act);
  if (!view.fixed) {
    return (
      <Box flexDirection="column" rowGap={1}>
        {top}
        {tabBody(els, view, act, view.rows)}
      </Box>
    );
  }
  // The header stays; the body below it is exactly the room left, and moves by its own offset.
  const rows = Math.max(4, view.rows - rowsOf(top, view.width));
  if (view.tab === "live") {
    return (
      <Box flexDirection="column" height={view.rows} overflow="hidden">
        {top}
        {liveView(els, view, act, rows)}
      </Box>
    );
  }
  const body = <Box flexDirection="column" flexShrink={0}>{tabBody(els, view, act, rows)}</Box>;
  const total = rowsOf(body, view.width);
  const max = Math.max(0, total - rows + 1);
  // Logs has its newest on top: scrolled down, it keeps to the requests it showed.
  const newest = view.events.at(-1)?.seq ?? 0;
  const offset =
    view.tab === "logs"
      ? anchored("log", view.scroll, newest, (since) => view.events.filter((event) => event.seq > since).reduce((s, event) => s + rowsOf(logEntry(els, view, event), view.width), 0), max)
      : Math.min(view.scroll, max);
  act.layout(view.tab === "logs" ? view.scroll + max - offset : max, false);
  const more = total - offset > rows - 1;
  return (
    <Box flexDirection="column" height={view.rows} overflow="hidden">
      {top}
      <Box flexDirection="column" height={rows - (max ? 1 : 0)} overflow="hidden" flexShrink={0}>
        <Box flexDirection="column" flexShrink={0} marginTop={-offset}>
          {body}
        </Box>
      </Box>
      {max ? (
        <Text color={INK.faint} wrap="truncate">
          {text("ui.scroll.footer", view.locale, { up: offset > 0 ? "▲" : " ", down: more ? "▼" : " ", percent: formatNumber((100 * offset) / max, view.locale) })}
        </Text>
      ) : null}
    </Box>
  );
}

/** What the active tab draws under the header. */
function tabBody(els: Els, view: View, act: Actions, rows: number) {
  return view.tab === "live"
      ? liveView(els, view, act, rows)
      : view.tab === "agents"
        ? agentsView(els, view, act)
      : view.tab === "models"
        ? modelsView(els, view)
      : view.tab === "logs"
              ? logView(els, view)
              : view.tab === "configuration"
                ? configurationView(els, view, act)
                : overview(els, view, act);
}

/** Above the prompt: current status, observed Jev metrics, model, activity, and running agents. */
export function renderBand(els: ElementTable, view: View) {
  const { Box, Text } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const mood = moodOf(view);
  const moodInk = hex(MOODS[mood].color);
  const stats = recentStats(view);
  const now = view.live;
  const running = view.agents.filter((run) => run.state === "running").length;
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text bold color={moodInk}>{`${MOODS[mood].face} ${text("ui.live.jev", view.locale)}: ${view.live.asking ? text("ui.band.asking", view.locale) : state.title}`}</Text>
        <Text color={INK.dim}>{statsLine(stats, view.locale)}</Text>
        {statsPartial(stats, view.locale) ? <Text color={INK.faint}>{statsPartial(stats, view.locale)}</Text> : null}
      </Box>
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text color={INK.ink}>{`◆ ${modelName(now.model)}${now.effort ? ` · ${now.effort}` : ""}`}</Text>
        <Text color={INK.faint}>·</Text>
        <Text color={now.activity ? INK.ink : INK.faint}>{now.activity ? `▶ ${now.activity}` : text("ui.band.idle", view.locale)}</Text>
        {running ? <Text color={INK.faint}>·</Text> : null}
        {running
          ? view.agents
              .filter((run) => run.state === "running")
              .map((run) => {
                const mascot = mascotOf(run);
                return <Text bold color={mascot ? hex(mascot.color) : INK.route}>◆</Text>;
              })
          : null}
        {running ? <Text color={INK.route}>{text("ui.band.runningCount", view.locale, { count: formatNumber(running, view.locale), agents: text(running === 1 ? "ui.band.running.agent" : "ui.band.running.agents", view.locale) })}</Text> : null}
      </Box>
    </Box>
  );
}
