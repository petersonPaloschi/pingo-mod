// The dashboard uses dotted meters and timelines, text status, and animated mascots for the user
// and subagents. DESIGN.md describes the visual system; dots.ts draws the shared primitives.
import type { ElementTable, RenderChildren } from "claude-code";

import type { AgentRun, AgentState, FeatureFlags, FeedEntry, FeedTone, FnResult, JevTab, LiveNow, RouteEvent, SetupDraft, TraceState, TurnDecision, WatchState } from "../types";
import type { FeatureId } from "./core/plan.ts";
import { features, modelName } from "./feed.ts";
import { PROVIDER_IDS, PROVIDERS } from "./core/jev.ts";
import {
  at,
  categories,
  category,
  compare,
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
} from "./events.ts";
import { cellsOf, constellation, DOT, hex, meter, rail } from "./dots.ts";
import { failureHint, failureKind } from "./errors.ts";
import { flowLines } from "./flow.ts";
import { advisorStats, type HintGroup } from "./trace.ts";
import { modelOf, type Forecast } from "./watch.ts";
import { formatAge, formatClock, formatCompact, formatDecimal, formatDuration, formatNumber, formatPercent, localeFor, reasonTitle, text, type Locale, type LocaleKey, type LocaleOption } from "./i18n.ts";
import { displayWidth, rowsOf } from "./layout.ts";
import { DICE, diceFrame, diceSize, diceSvg } from "./mascots/dice.ts";
import { brailleFrame, MOODS, pingoSvg, type Mood } from "./mascots/pingo.ts";
import { AGENT_MASCOTS, isMascot, MASCOT_ORDER, mascotFrame, mascotSvg, type AgentMascot } from "./mascots/agents.ts";

/** The pane needs Select and Input, which the terminal and the desktop app draw. */
export type Els = ElementTable<"terminal" | "desktop">;

/** Two groups: activity first, then controls and records. The header flattens them into clickable labels. */
export const TABS: readonly (readonly (readonly [JevTab, string, string])[])[] = [
  [
    ["overview", "ui.tab.overview", "1"],
    ["live", "ui.tab.live", "2"],
    ["models", "ui.tab.models", "3"],
    ["agents", "ui.tab.agents", "4"],
    ["flow", "ui.tab.flow", "5"],
  ],
  [
    ["features", "ui.tab.features", "6"],
    ["reasons", "ui.tab.reasons", "7"],
    ["baseline", "ui.tab.baseline", "8"],
    ["log", "ui.tab.log", "9"],
    ["setup", "ui.tab.setup", "0"],
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
  /** The Flow tab's record of each run. */
  trace: TraceState;
  /** The Models tab: each routing point's decisions, and what it takes for the model to change next. */
  watch: WatchState;
  forecast: Forecast;
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

export { cellsOf };

/** The last five minutes: average confidence and latency, routed count, the window's requests. */
function recentStats(view: View) {
  const recent = view.events.filter((event) => view.now - at(event) < 5 * 60e3);
  const asked = recent.filter((event) => event.jev);
  const confidence = asked.length ? asked.reduce((s, event) => s + event.jev!.confidence, 0) / asked.length : undefined;
  const latency = asked.length ? Math.round(asked.reduce((s, event) => s + event.jev!.latencyMs, 0) / asked.length) : undefined;
  return { recent, confidence, latency, routedCount: recent.filter(routed).length };
}

/** Dots of Jev's average confidence, 0.1 each in the full ten. */
function confidenceMeter(els: Els | ElementTable, confidence: number | undefined, color: string, count = 10) {
  const { Text } = els;
  const [full, empty] = meter(confidence, count);
  return (
    <Text>
      <Text color={color}>{full}</Text>
      <Text color={INK.faint}>{empty}</Text>
    </Text>
  );
}

/** A rail of dots: the share of requests Jev routed. */
function routedRail(els: Els | ElementTable, part: number, whole: number, color: string, count = 10) {
  const { Text } = els;
  const [full, empty] = rail(part, whole, count);
  return (
    <Text>
      <Text color={color}>{full}</Text>
      <Text color={INK.faint}>{empty}</Text>
    </Text>
  );
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
  const { recent, confidence, latency, routedCount } = recentStats(view);
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
          <Text wrap="truncate">
            {confidenceMeter(els, confidence, moodInk)}
            <Text color={INK.dim}>{`  ${text("ui.header.confidence", view.locale, { value: confidence === undefined ? "–" : formatDecimal(confidence, view.locale) })}`}</Text>
          </Text>
          <Text wrap="truncate">
            {routedRail(els, routedCount, recent.length, moodInk)}
            <Text color={INK.dim}>{`  ${text("ui.header.routed", view.locale, { routed: formatNumber(routedCount, view.locale), total: formatNumber(recent.length, view.locale), requests: text(recent.length === 1 ? "unit.request" : "unit.requests", view.locale), latency: latency === undefined ? "" : text("ui.header.latency", view.locale, { value: formatNumber(latency, view.locale) }) })}`}</Text>
          </Text>
        </Box>
        <Button
          key="routing"
          label={text(view.routing ? "ui.header.turnOff" : "ui.header.turnOn", view.locale)}
          hotkey="r"
          onPress={() => act.routing(!view.routing)}
        />
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        {TABS.flat().map(([id, label]) => {
          const name = text(label as LocaleKey, view.locale);
          // The open tab is bracketed and bright; the others are dim labels you press.
          const open = view.tab === id;
          return <Button key={"tab-" + id} label={open ? `❮ ${name} ❯` : ` ${name} `} plain {...(open ? {} : { dimColor: true })} onPress={() => act.tab(id)} />;
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

/** The figures, as label / value / note columns with no boxes around them. */
function figures(els: Els, view: View, events: readonly RouteEvent[]) {
  const { Box, Text } = els;
  const perRow = view.width >= 75 ? 3 : 2;
  const cellWidth = Math.max(14, Math.floor(view.width / perRow) - 2);
  const all = tiles(events, view.locale);
  const rows = Array.from({ length: Math.ceil(all.length / perRow) }, (_, i) => all.slice(i * perRow, i * perRow + perRow));
  return (
    <Box flexDirection="column" rowGap={1}>
      {rows.map((row) => (
        <Box flexDirection="row" columnGap={2}>
          {row.map((tile) => (
            <Box flexDirection="column" width={cellWidth}>
              <Text color={INK.dim}>{fit(tile.label, cellWidth)}</Text>
              <Text bold color={INK.ink}>{fit(tile.value, cellWidth)}</Text>
              <Text color={INK.faint}>{fit(tile.sub, cellWidth)}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

/** What happened to each request, as a strip of dots per category and a legend. */
function dotsBar(els: Els, events: readonly RouteEvent[], width: number, locale: Locale) {
  const { Box, Text } = els;
  const counts = new Map(tally(events.map(category)));
  const allCategories = categories(locale);
  const present = allCategories.filter(([name]) => counts.get(name));
  const room = Math.max(10, width);
  const dots = shares(present.map(([name]) => counts.get(name) ?? 0), room);
  return (
    <Box flexDirection="column">
      <Text>
        {present.length === 0 ? <Text color={INK.faint}>{"⣀".repeat(room)}</Text> : null}
        {present.map(([name], i) => (
          <Text color={hex(CATEGORY_DOT[name][1])}>{"⣿".repeat(dots[i]!)}</Text>
        ))}
      </Text>
      {(present.length ? present : allCategories).map(([name, label]) => (
        <Text>
          <Text color={hex(CATEGORY_DOT[name][1])}>{`${CATEGORY_DOT[name][0]} `}</Text>
          <Text color={INK.dim}>{label} </Text>
          <Text bold color={INK.ink}>{`${int(counts.get(name) ?? 0, locale)} · ${pct(counts.get(name) ?? 0, events.length, locale)}`}</Text>
        </Text>
      ))}
    </Box>
  );
}

/** The timeline as a constellation: one dot per request, left to right in time, higher with more tokens. */
function sky(els: Els, view: View, events: readonly RouteEvent[]) {
  const { Box, Text } = els;
  const columns = Math.max(20, Math.min(72, view.width - 2));
  const rows = 6;
  const end = view.now;
  const start = view.range > 0 ? end - view.range : Math.min(end - 60e3, ...events.map(at));
  const tokens = (event: RouteEvent) => (event.usage ? event.usage.input + event.usage.output : 0);
  const peak = Math.max(1, ...events.map(tokens));
  const priority: Record<Category, number> = { passthrough: 0, hint: 1, failed: 2 };
  const points = events.map((event) => ({
    x: (at(event) - start) / Math.max(1, end - start),
    // Square root, so a few huge requests do not flatten the rest onto the ground.
    y: Math.sqrt(tokens(event) / peak),
    color: CATEGORY_DOT[category(event)][1],
    priority: priority[category(event)],
  }));
  return (
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
    </Box>
  );
}

function overview(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const events = inRange(view);
  const state = status(view.events, view.routing, view.now, view.locale);
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text color={INK.ink} wrap="wrap">{state.text}</Text>
        <Text color={INK.faint} wrap="wrap">{view.meta}</Text>
      </Box>
      {figures(els, view, events)}
      {section(els, text("ui.overview.outcome", view.locale))}
      {dotsBar(els, events, view.width - 2, view.locale)}
      {sky(els, view, events)}
      {rangePicker(els, view, act)}
    </Box>
  );
}

function reasonsView(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const events = inRange(view);
  const list = reasons(events, view.locale);
  const top = list[0]?.count ?? 1;
  const passed = events.filter((event) => !routed(event)).length;
  const colorFor = (who: string) => (who === text("reason.who.failed", view.locale) ? INK.fail : who === text("reason.who.asked", view.locale) ? INK.pass : INK.dim);
  return (
    <Box flexDirection="column">
      {section(els, text("ui.reasons.title", view.locale))}
      {list.length === 0 ? (
        <Text color={INK.dim}>{events.length ? text("ui.reasons.allRouted", view.locale) : text("ui.reasons.empty", view.locale)}</Text>
      ) : null}
      {list.map((reason) => (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text bold color={colorFor(reason.who)}>{reasonTitle(reason.name, view.locale)}</Text>
            <Text color={INK.faint}>{reason.who ? `  · ${reason.who}` : ""}</Text>
            <Text color={INK.ink}>{`  ${int(reason.count, view.locale)} · ${pct(reason.count, passed, view.locale)}`}</Text>
          </Text>
          <Text color={colorFor(reason.who)}>{"⣿".repeat(Math.max(1, Math.round(((view.width - 4) * reason.count) / top)))}</Text>
          <Text color={INK.dim} wrap="wrap">{reason.meaning}</Text>
        </Box>
      ))}
      <Text> </Text>
      {rangePicker(els, view, act)}
    </Box>
  );
}

function baselineView(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const table = compare(inRange(view), view.locale);
  const label = Math.max(12, Math.min(20, view.width - 36));
  const deltaInk = (delta: string) => (delta.startsWith("-") ? INK.route : delta.startsWith("+") ? INK.fail : INK.dim);
  return (
    <Box flexDirection="column" rowGap={1}>
      {section(els, text("ui.baseline.title", view.locale))}
      <Box flexDirection="column">
        <Text bold color={INK.ink}>{fit("", label) + fit(text("ui.baseline.withJev", view.locale), 11) + fit(text("ui.baseline.withoutJev", view.locale), 11) + text("ui.baseline.diff", view.locale)}</Text>
        <Text color={INK.faint}>{"⠤".repeat(Math.min(view.width - 2, label + 30))}</Text>
        {table.rows.map((row) => (
          <Text>
            <Text color={INK.dim}>{fit(row.label, label)}</Text>
            <Text color={INK.ink}>{fit(row.withJev, 11) + fit(row.without, 11)}</Text>
            <Text bold color={deltaInk(row.delta)}>{row.delta}</Text>
          </Text>
        ))}
      </Box>
      <Text color={INK.dim} wrap="wrap">
        {table.hasBaseline
          ? text("ui.baseline.comparable", view.locale)
          : text("ui.baseline.noData", view.locale)}
      </Text>
      {rangePicker(els, view, act)}
    </Box>
  );
}

/** The request log: newest first, one line per request, marked ● hint, ○ passthrough, × failed. */
function logView(els: Els, view: View) {
  const { Box, Text } = els;
  const room = view.fixed ? 200 : Math.max(3, view.rows - 18);
  const rows = view.events.slice(-room).reverse();
  return (
    <Box flexDirection="column" rowGap={1}>
      {section(els, text("ui.log.title", view.locale))}
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
      : event.jev
        ? text("ui.log.picked", view.locale, { choice: event.jev.choice })
        : text("ui.log.stayedOut", view.locale);
  const confidence = event.confidence ?? event.jev?.confidence;
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
            event.usage ? text("ui.log.inputOutput", view.locale, { input: int(event.usage.input, view.locale), output: int(event.usage.output, view.locale) }) : "",
            text("ui.log.duration", view.locale, { value: formatDecimal(event.durationMs / 1000, view.locale, 1) + text("format.seconds", view.locale, { value: "" }) }),
          ].join("")}
        </Text>
      </Text>
      {event.reason ? <Text color={kind === "failed" ? INK.fail : INK.faint}>{fit(text("ui.log.reason", view.locale, { reason: reasonTitle(event.reason, view.locale) }), view.width - 2)}</Text> : null}
      {kind === "failed" && event.error ? <Text color={INK.fail} wrap="wrap">{text("ui.log.cause", view.locale, { cause: event.error })}</Text> : null}
      {kind === "failed" ? <Text color={INK.pass} wrap="wrap">{text("ui.log.hint", view.locale, { hint: failureHint(failureKind(event.error ?? "", event.reason), view.locale) })}</Text> : null}
    </Box>
  );
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

function setupView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button, Select, Input } = els;
  const chosen = PROVIDER_IDS.includes(view.setup.provider as never) ? view.setup.provider : PROVIDER_IDS.includes(view.key.provider as never) ? view.key.provider : "typesafe";
  const info = PROVIDERS[chosen as keyof typeof PROVIDERS];
  const saved = view.key.source !== "none";
  const typed = view.setup.typed ?? "";
  const message = view.setup.message;
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        {section(els, text("ui.setup.title", view.locale))}
        <Text color={INK.dim} wrap="wrap">{text("ui.setup.intro", view.locale)}</Text>
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

/** Dice, your mascot: braille in a terminal raster and SVG circles on the desktop. */
function diceArt(els: Els, view: View) {
  if (view.surface === "terminal" && "Raster" in els) {
    const { Raster } = els as ElementTable<"terminal">;
    const { columns, rows } = diceSize(view.width);
    return <Raster key="dice" columns={columns} rows={rows} cells={cellsOf(diceFrame(view.now / 1000, columns, rows))} />;
  }
  if (view.surface === "desktop" && "Svg" in els) {
    const { Svg } = els as ElementTable<"desktop">;
    return <Svg source={diceSvg(view.now / 1000)} alt={text("mascot.dice.alt", view.locale)} />;
  }
  return null;
}

/** Who speaks on a line of the live log: a face, a name and a color, so Jev and you never blur. */
export function speaker(entry: Pick<FeedEntry, "who" | "name" | "tone" | "mascot">, locale: Locale = localeFor()): { face: string; name: string; color: string } {
  switch (entry.who) {
    case "you":
      return { face: DICE.face, name: text("ui.live.you", locale), color: INK.you };
    case "jev": {
      const mood: Mood = entry.tone === "bad" ? "failing" : entry.tone === "muted" ? "passthrough" : "routing";
      return { face: MOODS[mood].face, name: text("ui.live.jev", locale), color: hex(MOODS[mood].color) };
    }
    case "claude":
      return { face: "", name: text("ui.live.claude", locale), color: INK.claude };
    case "agent":
      if (isMascot(entry.mascot)) {
        const mascot = AGENT_MASCOTS[entry.mascot];
        return { face: mascot.face, name: mascot.name, color: hex(mascot.color) };
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

/**
 * One line of the live log, dense: time, who (only where the speaker changes), what happened and
 * a short figure at the end. The finer points go on a faint line under it; bookkeeping (a request
 * sent, a turn's end) is one faint line with its figures folded in.
 */
function feedLine(els: Els, view: View, entry: FeedEntry) {
  const { Box, Text } = els;
  const who = speaker(entry, view.locale);
  // The time is no column: it sits faint under the text (at the end of a bookkeeping line).
  const gutter = FACE_WIDTH + NAME_WIDTH;
  const minor = entry.minor === true;
  const metaWidth = entry.meta ? Math.min(14, [...entry.meta].length) : 0;
  const when = clock(entry.time, view.locale);
  const spoken = entry.who === "jev" || entry.who === "claude";
  const room = Math.max(10, view.width - gutter - metaWidth - 3);
  const body = spoken ? clip(entry.text, room * SPOKEN_ROWS) : entry.text;
  const rows = !minor && entry.detail ? entry.detail.split("\n").slice(0, DETAIL_ROWS) : [];
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
        ? (rows.length ? rows : [""]).map((row, index) => (
            <Box flexDirection="row">
              <Box width={gutter} flexShrink={0} />
              <Box width={2} flexShrink={0}>
                <Text color={INK.faint}>{index === 0 ? "╰ " : "  "}</Text>
              </Box>
              <Box flexShrink={1} flexGrow={1}>
                <Text color={INK.faint} wrap="truncate-end">{index === 0 ? (row ? `${when} · ${row}` : when) : row}</Text>
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
function conversation(els: Els, view: View, lines: readonly FeedEntry[], empty: string) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column" flexShrink={0}>
      {lines.length === 0 ? <Text color={INK.dim}>{empty}</Text> : null}
      {lines.map((entry) => feedLine(els, view, entry))}
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
  return (
    <Box flexDirection="column" height={rows} overflow="hidden" flexShrink={0}>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} justifyContent="flex-end" overflow="hidden">
        <Box flexDirection="column" flexShrink={0}>
          {atStart && before ? before : null}
          {conversation(els, view, shown, empty)}
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
  const top = liveTop(els, view);
  const empty = text("ui.live.emptyFeed", view.locale);
  if (!view.fixed) {
    return (
      <Box flexDirection="column" rowGap={1}>
        {top}
        {conversation(els, view, view.feed.slice(-Math.max(5, view.rows - 20)), empty)}
      </Box>
    );
  }
  // The top (Dice and who is who) stays; the log under it scrolls by lines, newest at the bottom.
  const logRows = Math.max(3, rows - rowsOf(top, view.width) - 1);
  const { back, max } = feedBack("live", view, view.feed);
  act.layout(max, true);
  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      {top}
      <Text color={INK.faint} wrap="truncate">{"┄".repeat(Math.max(1, view.width))}</Text>
      {stuckLog(els, view, view.feed, logRows, empty, back)}
    </Box>
  );
}

/** The Live tab's fixed top: Dice, and the face and color of everyone who speaks in the log. */
function liveTop(els: Els, view: View) {
  const { Box, Text } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const running = view.agents.filter((run) => run.state === "running").length;
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" columnGap={2}>
        {diceArt(els, view)}
        <Box flexDirection="column" flexShrink={1}>
          {section(els, text("ui.live.title", view.locale))}
          <Text wrap="wrap">
            <Text bold color={INK.you}>{`${DICE.face} ${text("ui.live.you", view.locale)}`}</Text>
            <Text color={INK.dim}>{` · ${text("ui.live.dice", view.locale)}`}</Text>
          </Text>
          <Text wrap="wrap">
            <Text bold color={hex(MOODS[moodOf(view)].color)}>{`${MOODS[moodOf(view)].face} Jev`}</Text>
            <Text color={INK.dim}>{` · ${text("ui.live.pingo", view.locale)} · ${view.live.asking ? text("ui.live.asking", view.locale) : state.title}`}</Text>
          </Text>
          <Text wrap="wrap">
            <Text bold color={INK.claude}>Claude</Text>
            <Text color={INK.faint}>{`   ⠿ ${text("ui.live.mod", view.locale)}`}</Text>
          </Text>
          <Text wrap="wrap">
            <Text color={INK.dim}>{text("ui.live.subagents", view.locale)} </Text>
            {MASCOT_ORDER.map((id) => (
              <Text bold color={hex(AGENT_MASCOTS[id].color)}>{` ${AGENT_MASCOTS[id].face} ${AGENT_MASCOTS[id].name} `}</Text>
            ))}
          </Text>
          {running ? <Text color={INK.route} wrap="wrap">{text("ui.live.runningAgents", view.locale, { count: formatNumber(running, view.locale), unit: text(running === 1 ? "unit.agent" : "unit.agents", view.locale) })}</Text> : null}
          <Text color={INK.faint} wrap="wrap">{text("ui.live.observable", view.locale)}</Text>
        </Box>
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
  return text("ui.agent.numbers", locale, {
    tools: formatNumber(run.tools, locale),
    toolUnit: text(run.tools === 1 ? "unit.toolCall" : "unit.toolCalls", locale),
    requests: formatNumber(run.requests, locale),
    requestUnit: text(run.requests === 1 ? "unit.request" : "unit.requests", locale),
    input: formatCompact(run.tokensIn, locale),
    output: formatCompact(run.tokensOut, locale),
  });
}

/** The model a subagent runs on, its effort, and what Jev chose for it. */
function agentModel(run: AgentRun, locale: Locale): string {
  return [modelName(run.model), run.effort ? text("ui.agent.model", locale, { effort: run.effort }) : "", run.jev ? text("ui.agent.jev", locale, { choice: run.jev }) : ""].filter(Boolean).join(" · ");
}

/** A subagent's mascot, when it has one. */
const mascotOf = (run: AgentRun): AgentMascot | undefined => (isMascot(run.mascot) ? AGENT_MASCOTS[run.mascot] : undefined);

/** "/•ᴗ•\ Tetra  Explore #3": the mascot's face and name in its color, then the type and number. */
function agentName(els: Els, run: AgentRun, locale: Locale) {
  const { Text } = els;
  const mascot = mascotOf(run);
  return (
    <Text>
      {mascot ? <Text bold color={hex(mascot.color)}>{`${mascot.face} ${mascot.name}`}</Text> : <Text bold color={INK.ink}>◆</Text>}
      <Text color={INK.ink}>{`  ${text("ui.agent.number", locale, { type: run.type, number: formatNumber(run.n, locale) })}`}</Text>
    </Text>
  );
}

/** A subagent's mascot, drawn: braille in a Raster in the terminal (the mod animates it), SVG on the desktop. */
function mascotArt(els: Els, view: View, run: AgentRun) {
  const mascot = mascotOf(run);
  if (!mascot) return null;
  if (view.surface === "terminal" && "Raster" in els) {
    const { Raster } = els as ElementTable<"terminal">;
    const { columns, rows } = diceSize(view.width);
    return <Raster key="mascot" columns={columns} rows={rows} cells={cellsOf(mascotFrame(mascot.id, view.now / 1000, columns, rows))} />;
  }
  if (view.surface === "desktop" && "Svg" in els) {
    const { Svg } = els as ElementTable<"desktop">;
    return <Svg source={mascotSvg(mascot.id, view.now / 1000)} alt={`${mascot.name}, ${text(`mascot.agentShape.${mascot.id}` as LocaleKey, view.locale)}`} />;
  }
  return null;
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
  // Its answer closes the log, in full, once it has ended.
  if (run.state !== "running" && run.text) {
    lines.push({ seq: -1, time: run.endedAt ?? view.now, who: "agent", agent: run.id, mascot: run.mascot, kind: "agent", tone: "info", text: text("ui.agent.result", view.locale, { text: run.text }) });
  }
  const top = (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" columnGap={2}>
        {mascotArt(els, view, run)}
        <Box flexDirection="column" flexShrink={1}>
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
      </Box>
    </Box>
  );
  // The task Claude gave it opens the log: shown once scrolled back to the start.
  const task = (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      <Text color={INK.faint} wrap="truncate">{text("ui.agent.task", view.locale)}</Text>
      <Text color={INK.dim} wrap="wrap">{clip(run.prompt, 480)}</Text>
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

/**
 * The Flow tab: the latest run as observed, from the message through Jev and the main loop to its
 * tools, subagents, advisor calls and answer, with the earlier runs under it.
 */
function flowView(els: Els, view: View) {
  const { Box, Text } = els;
  const lines = flowLines({ trace: view.trace, now: view.now, width: Math.max(1, view.width - 2), locale: view.locale });
  return (
    <Box flexDirection="column">
      {lines.map((parts) => (
        <Text wrap="truncate">
          {parts.length === 0 ? " " : null}
          {parts.map((part) => (
            <Text color={part.color} bold={part.bold ?? false} {...(part.bg ? { backgroundColor: part.bg } : {})}>
              {part.text}
            </Text>
          ))}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text color={INK.faint} wrap="wrap">{text("ui.flow.help", view.locale)}</Text>
      </Box>
      <Text color={INK.faint} wrap="wrap">{text("ui.flow.running", view.locale)}</Text>
    </Box>
  );
}

// --- Models tab ---

const FN_MARK: Record<FnResult["result"], [glyph: string, color: string]> = {
  applied: ["●", INK.route],
  kept: ["◐", INK.pass],
  none: ["○", INK.dim],
  off: ["–", INK.faint],
  failed: ["×", INK.fail],
};
const HELD_WHY = new Set(["user_model", "model_id", "blocked"]);
const FN_NAME_WIDTH = 14;

/** What one function did, in a sentence: the model's says what changed, what held it back, or what it takes. */
export function describeFn(fn: FnResult, settled: boolean, locale: Locale): string {
  const key = (id: string) => id as LocaleKey;
  const conf = formatDecimal(fn.confidence ?? 0, locale, 2);
  const needed = formatDecimal(fn.needed ?? 0, locale, 2);
  if (fn.result === "off") return text(key(`ui.models.off.${fn.why}`), locale);
  if (fn.result === "failed") return text("ui.models.failed", locale);
  const why = fn.why ?? "";
  if (fn.id === "model") {
    const values = { from: modelName(fn.from), to: modelName(fn.value), model: modelName(fn.value ?? fn.from), confidence: conf, needed };
    if (fn.result === "applied") return text(settled ? "ui.models.model.switched" : "ui.models.model.pending", locale, values);
    if (fn.result === "kept") {
      return HELD_WHY.has(why)
        ? text("ui.models.model.heldWhy", locale, { ...values, reason: text(key(`ui.models.heldReason.${why}`), locale) })
        : text("ui.models.model.keptConfidence", locale, { ...values, reason: text(key(`planning.modelReason.${why}`), locale) });
    }
    return text(key(`ui.models.model.${why}`), locale, values);
  }
  if (fn.id === "tools") {
    return fn.result === "applied" ? text("ui.models.tools.applied", locale, { tool: fn.value ?? "", confidence: conf }) : reasonTitle(why, locale);
  }
  if (fn.id === "effort") {
    if (fn.result === "applied") return text("ui.models.effort.applied", locale, { value: fn.value ?? "", confidence: conf });
    return text(key(fn.result === "kept" ? `ui.models.effort.${why}` : "ui.models.effort.none"), locale, { value: fn.value ?? "", confidence: conf, needed });
  }
  if (fn.id === "delegation") {
    if (fn.result === "applied") return text("ui.models.delegation.applied", locale, { agent: fn.value ?? "", confidence: conf });
    if (fn.result === "kept") return text("ui.models.delegation.low_confidence", locale, { agent: fn.value ?? "", confidence: conf, needed });
    return text(why === "no_delegation" || why === "jev_declined" ? key(`ui.models.delegation.${why}`) : "ui.models.delegation.none", locale);
  }
  if (fn.id === "advisor") {
    // Applied means the hint was attached, never that the advisor ran.
    if (fn.result === "applied") return text("ui.models.advisor.applied", locale, { confidence: conf });
    if (fn.result === "kept") return text("ui.models.advisor.low_confidence", locale, { confidence: conf, needed });
    return text(key(`ui.models.advisor.${why || "unavailable"}`), locale);
  }
  return fn.result === "applied" ? text(fn.value === "out" ? "ui.models.participation.out" : "ui.models.participation.in", locale, { confidence: conf }) : text("ui.models.participation.none", locale);
}

function fnRow(els: Els, view: View, fn: FnResult, settled: boolean) {
  const { Box, Text } = els;
  const [glyph, color] = FN_MARK[fn.result];
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text bold color={color}>{glyph}</Text>
      <Box width={FN_NAME_WIDTH} flexShrink={0}>
        <Text color={INK.ink} wrap="truncate">{text(`ui.models.fn.${fn.id}` as LocaleKey, view.locale)}</Text>
      </Box>
      <Box flexShrink={1} flexGrow={1}>
        <Text color={fn.result === "off" ? INK.faint : INK.dim} wrap="wrap">{describeFn(fn, settled, view.locale)}</Text>
      </Box>
    </Box>
  );
}

/** One routing point: its time, whether Jev was asked, and what each function came to. */
function turnBlock(els: Els, view: View, turn: TurnDecision) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column">
      <Text color={INK.dim} wrap="truncate">
        <Text bold color={INK.ink}>{text("ui.models.turn", view.locale, { turn: formatNumber(turn.turn, view.locale) })}</Text>
        {`  ${clock(turn.time, view.locale)}  ·  `}
        {turn.consulted
          ? text("ui.models.asked", view.locale, { latency: `${formatNumber(turn.latencyMs ?? 0, view.locale)} ms` })
          : text("ui.models.skipped", view.locale)}
      </Text>
      {turn.fns.map((fn) => fnRow(els, view, fn, turn.settled))}
    </Box>
  );
}

/** An earlier routing point in one line: what the model did. */
function turnLine(els: Els, view: View, turn: TurnDecision) {
  const { Box, Text } = els;
  const fn = modelOf(turn);
  const [glyph, color] = fn ? FN_MARK[fn.result] : FN_MARK.off;
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text bold color={color}>{glyph}</Text>
      <Text color={INK.faint}>{clock(turn.time, view.locale)}</Text>
      <Text color={INK.dim} wrap="truncate">{fn ? describeFn(fn, turn.settled, view.locale) : ""}</Text>
    </Box>
  );
}

const ARROW = { up: "↑", same: "→", down: "↓" } as const;

/** The forecast: what blocks a model change now, and the confidence each model needs. */
function forecastView(els: Els, view: View) {
  const { Box, Text } = els;
  const { blockers, targets, cacheWarm } = view.forecast;
  const blocked = blockers.length > 0;
  return (
    <Box flexDirection="column">
      <Text color={INK.dim} wrap="wrap">{text(view.trace.active ? "ui.models.nextWorking" : "ui.models.nextTurn", view.locale)}</Text>
      <Text color={blocked ? INK.pass : INK.route} wrap="wrap">{text(blocked ? "ui.models.blocked" : "ui.models.canChange", view.locale)}</Text>
      {blockers.map((id) => (
        <Text color={INK.pass} wrap="wrap">{`  ✕ ${text(`ui.models.blocker.${id}` as LocaleKey, view.locale)}`}</Text>
      ))}
      {targets.map((target) => {
        const values = { arrow: ARROW[target.direction], model: modelName(target.id), needed: formatDecimal(target.needed, view.locale, 2), reason: text(`ui.models.targetReason.${target.why}` as LocaleKey, view.locale) };
        return (
          <Box flexDirection="row" columnGap={1}>
            {target.blocked ? <Text color={INK.faint}>{"  ··········"}</Text> : <Text>{"  "}{confidenceMeter(els, target.needed, blocked ? INK.faint : INK.route, 10)}</Text>}
            <Text color={target.blocked || blocked ? INK.faint : INK.ink} wrap="truncate">{text(target.blocked ? "ui.models.targetExcluded" : "ui.models.target", view.locale, values)}</Text>
          </Box>
        );
      })}
      {cacheWarm && targets.some((target) => target.direction === "down") ? <Text color={INK.faint} wrap="wrap">{text("ui.models.cache", view.locale)}</Text> : null}
    </Box>
  );
}

/** One group of runs, measured: how often the advisor was called, how long the runs took, what they cost. */
function hintLine(group: HintGroup, label: LocaleKey, locale: Locale): string {
  const runs = group.runs;
  return text("ui.models.hint.line", locale, {
    label: text(label, locale),
    runs: formatNumber(runs, locale),
    runUnit: text(runs === 1 ? "unit.run" : "unit.runs", locale),
    called: formatPercent(group.withCall, runs, locale),
    calls: formatDecimal(runs ? group.calls / runs : 0, locale, 1),
    duration: formatDuration(runs ? group.durationMs / runs : 0, locale),
    tokens: formatCompact(runs ? group.tokens / runs : 0, locale),
    completed: formatPercent(group.completed, runs, locale),
  });
}

/** The advisor hint, measured over the runs kept: with it against without it, where the question was asked. */
function hintView(els: Els, view: View) {
  const { Box, Text } = els;
  const { hinted, plain } = advisorStats(view.trace);
  if (!view.features.advisor && !hinted.runs && !plain.runs) return null;
  return (
    <Box flexDirection="column">
      {section(els, text("ui.models.hint.title", view.locale))}
      {hinted.runs || plain.runs ? (
        <Box flexDirection="column">
          <Text color={INK.ink} wrap="wrap">{hintLine(hinted, "ui.models.hint.with", view.locale)}</Text>
          <Text color={INK.dim} wrap="wrap">{hintLine(plain, "ui.models.hint.without", view.locale)}</Text>
        </Box>
      ) : (
        <Text color={INK.faint} wrap="wrap">{text("ui.models.hint.empty", view.locale)}</Text>
      )}
      <Text color={INK.faint} wrap="wrap">{text("ui.models.hint.note", view.locale)}</Text>
    </Box>
  );
}

/** The Models tab: the model running, what it takes to change it, and what Jev decided at each prompt. */
function modelsView(els: Els, view: View) {
  const { Box, Text } = els;
  const turns = [...view.watch.turns].reverse();
  const [latest, ...earlier] = turns;
  const agents = [...view.agents].sort((a, b) => b.n - a.n).slice(0, 5);
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        {section(els, text("ui.models.now", view.locale))}
        <Text bold color={INK.ink}>{`◆ ${modelName(view.live.model)}${view.live.effort ? ` · ${view.live.effort}` : ""}`}</Text>
      </Box>
      <Box flexDirection="column">
        {section(els, text("ui.models.next", view.locale))}
        {forecastView(els, view)}
      </Box>
      <Box flexDirection="column" rowGap={1}>
        {section(els, text("ui.models.last", view.locale))}
        {latest ? turnBlock(els, view, latest) : <Text color={INK.faint} wrap="wrap">{text("ui.models.empty", view.locale)}</Text>}
        {earlier.length ? <Box flexDirection="column">{earlier.slice(0, 12).map((turn) => turnLine(els, view, turn))}</Box> : null}
        <Text color={INK.faint} wrap="wrap">{text("ui.models.legend", view.locale)}</Text>
      </Box>
      {hintView(els, view)}
      <Box flexDirection="column">
        {section(els, text("ui.models.subagents", view.locale))}
        {agents.length === 0 ? <Text color={INK.faint}>{text("ui.models.noSubagents", view.locale)}</Text> : null}
        {agents.map((run) => (
          <Box flexDirection="row" columnGap={1}>
            {agentName(els, run, view.locale)}
            <Text color={INK.dim} wrap="truncate">{agentModel(run, view.locale)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** One-click switches, each with what it does. */
function featuresView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button } = els;
  return (
    <Box flexDirection="column" rowGap={1}>
      {section(els, text("ui.tab.features", view.locale))}
      {!view.routing ? <Text color={INK.pass} wrap="wrap">{text("ui.features.off", view.locale)}</Text> : null}
      {features(view.locale).map((feature) => {
        const on = view.features[feature.id];
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Button
                key={"feature-" + feature.id}
                label={on ? `● ${text("ui.features.enabled", view.locale, { hotkey: feature.hotkey })}` : `○ ${text("ui.features.disabled", view.locale, { hotkey: feature.hotkey })}`}
                hotkey={feature.hotkey}
                onPress={() => act.feature(feature.id, !on)}
              />
              <Text bold color={on ? INK.route : INK.ink}>{feature.name}</Text>
            </Box>
            <Text color={INK.dim} wrap="wrap">{feature.description}</Text>
          </Box>
        );
      })}
      <Box flexDirection="row" columnGap={2}>
        <Button
          key="routing-features"
          label={text(view.routing ? "ui.features.routingOn" : "ui.features.routingOff", view.locale)}
          hotkey="r"
          onPress={() => act.routing(!view.routing)}
        />
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
  // The request log has its newest on top: scrolled down, it keeps to the requests it showed.
  const newest = view.events.at(-1)?.seq ?? 0;
  const offset =
    view.tab === "log"
      ? anchored("log", view.scroll, newest, (since) => view.events.filter((event) => event.seq > since).reduce((s, event) => s + rowsOf(logEntry(els, view, event), view.width), 0), max)
      : Math.min(view.scroll, max);
  act.layout(view.tab === "log" ? view.scroll + max - offset : max, false);
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
      : view.tab === "flow"
        ? flowView(els, view)
      : view.tab === "features"
        ? featuresView(els, view, act)
        : view.tab === "reasons"
          ? reasonsView(els, view, act)
          : view.tab === "baseline"
            ? baselineView(els, view, act)
            : view.tab === "log"
              ? logView(els, view)
              : view.tab === "setup"
                ? setupView(els, view, act)
                : overview(els, view, act);
}

/**
 * Above the prompt: the status, a dot meter for confidence and a dot rail for routed requests;
 * line 2 says what is happening now: the active model and effort, what
 * Jev decided and what is running.
 */
export function renderBand(els: ElementTable, view: View) {
  const { Box, Text } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const mood = moodOf(view);
  const moodInk = hex(MOODS[mood].color);
  const { recent, confidence, latency, routedCount } = recentStats(view);
  const input = recent.reduce((s, event) => s + (event.usage?.input ?? 0), 0);
  const cached = recent.reduce((s, event) => s + (event.usage?.cached ?? 0), 0);
  const parts = [
    text("ui.band.routed", view.locale, { routed: formatNumber(routedCount, view.locale), total: formatNumber(recent.length, view.locale) }),
    latency === undefined ? undefined : `${formatNumber(latency, view.locale)} ms`,
    input ? text("ui.band.cache", view.locale, { percent: pct(cached, input, view.locale) }) : undefined,
    "/jev",
  ].filter(Boolean);
  const now = view.live;
  const running = view.agents.filter((run) => run.state === "running").length;
  const used = now.jevUsed;
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text bold color={moodInk}>{`${MOODS[mood].face} ${text("ui.live.jev", view.locale)}: ${view.live.asking ? text("ui.band.asking", view.locale) : state.title}`}</Text>
        {confidenceMeter(els, confidence, moodInk, 5)}
        {routedRail(els, routedCount, recent.length, moodInk, 10)}
        <Text color={INK.dim}>{parts.join(" · ")}</Text>
      </Box>
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text color={INK.ink}>{`◆ ${modelName(now.model)}${now.effort ? ` · ${now.effort}` : ""}`}</Text>
        {now.changed ? <Text color={INK.pass}>{text("ui.band.changed", view.locale, { change: now.changed })}</Text> : null}
        <Text color={INK.faint}>·</Text>
        <Text color={used === undefined ? INK.faint : used ? INK.route : INK.dim}>
          {used === undefined ? text("ui.band.decision", view.locale, { summary: "—" }) : used ? text("ui.band.decision", view.locale, { summary: now.decision ?? text("ui.band.consulted", view.locale) }) : text("ui.band.skipped", view.locale, { reason: now.decision ?? text("category.mode.passthrough", view.locale) })}
        </Text>
        <Text color={INK.faint}>·</Text>
        <Text color={now.activity ? INK.ink : INK.faint}>{now.activity ? `▶ ${now.activity}` : text("ui.band.idle", view.locale)}</Text>
        {running ? <Text color={INK.faint}>·</Text> : null}
        {running
          ? view.agents
              .filter((run) => run.state === "running")
              .map((run) => {
                const mascot = mascotOf(run);
                return <Text bold color={mascot ? hex(mascot.color) : INK.route}>{mascot?.face ?? "◆"}</Text>;
              })
          : null}
        {running ? <Text color={INK.route}>{text("ui.band.runningCount", view.locale, { count: formatNumber(running, view.locale), agents: text(running === 1 ? "ui.band.running.agent" : "ui.band.running.agents", view.locale) })}</Text> : null}
      </Box>
    </Box>
  );
}
