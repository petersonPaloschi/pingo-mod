// The Jev dashboard: a rail with the screens, Pingo and the last five minutes down the left of the pane (a bar on
// top when the pane is narrow), and the open screen beside it, built of framed cards, colored pills and block bars.
import type { ElementTable, RenderChildren } from "claude-code";

import type { AgentRun, AgentState, FeatureFlags, FeatureId, FeaturePreferences, FeedEntry, FeedTone, JevTab, LiveNow, RouteEvent, SetupDraft, TraceState, TraceStep } from "../types";
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
import { cellsOf, DOT, hex } from "./dots.ts";
import { failureHint, failureKind } from "./errors.ts";
import { flowLines, flowScene } from "./flow.ts";
import { runTiming, traceConsults } from "./trace.ts";
import { formatAge, formatClock, formatCompact, formatDecimal, formatDuration, formatNumber, localeFor, reasonTitle, text, type Locale, type LocaleKey, type LocaleOption } from "./i18n.ts";
import { displayWidth, rowsOf } from "./layout.ts";
import { blockBar, css, EIGHTHS, GLYPH, HUE, PAINT } from "./theme.ts";
import { brailleFrame, MOODS, pingoLiveSvg, type Mood } from "./mascots/pingo.ts";
import { AGENT_MASCOTS, isMascot } from "./mascots/agents.ts";
import { renderDeck, type DeckBand, type Surface } from "./deck/band.tsx";
import { COLLAPSED, SECTIONS, SIZES, type DeckSettings } from "./deck/settings.ts";
import { DESKTOP_STYLE_NAMES, DESKTOP_STYLES } from "./deck/styles-desktop.ts";
import { CLAUDE_MODELS, MODEL_LABEL, PROFILE_EFFORTS, ROLES, type OrchestrationPolicy, type Profile, type Role, type WorkMode } from "./core/orchestration.ts";
import { TERMINAL_STYLE_NAMES, TERMINAL_STYLES } from "./deck/styles-terminal.ts";

/** The pane needs Select and Input, which the terminal and the desktop app draw. */
export type Els = ElementTable<"terminal" | "desktop">;

/** The eight screens, in the order the rail lists them, with their number keys. */
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
    ["deck", "ui.tab.deck", "7"],
    ["features", "ui.tab.features", "8"],
  ],
];

/**
 * Text colors, all from hooks/theme.ts: theme keys for content, labels and rules (they follow the person's light
 * or dark theme), the rest only for state, each state also told by a glyph.
 */
const INK = {
  ink: PAINT.text,
  dim: PAINT.muted,
  faint: PAINT.muted,
  border: PAINT.rule,
  brand: PAINT.brand,
  route: PAINT.ok,
  pass: PAINT.warn,
  fail: PAINT.fail,
  you: PAINT.you,
  claude: PAINT.claude,
};

function toggleButton(els: Els, key: string, on: boolean, label: string, onPress: () => void, hotkey?: string) {
  const { Button } = els;
  return <Button key={key} label={`${on ? GLYPH.on : GLYPH.off} ${label}`} plain hotkey={hotkey} dimColor={!on} onPress={onPress} />;
}

const MOOD_OF: Record<StatusKind, Mood> = {
  routing: "routing",
  passthrough: "passthrough",
  failing: "failing",
  idle: "idle",
  baseline: "baseline",
};
const CATEGORY_DOT: Record<Category, [glyph: string, color: number]> = {
  hint: [GLYPH.on, DOT.route],
  passthrough: [GLYPH.off, DOT.dim],
  failed: [GLYPH.fail, DOT.fail],
};

/** What the Deck tab shows: Deck's settings as saved, how its band stands, and the last reply to a control. */
export interface DeckPanel {
  settings: DeckSettings;
  /** The band is expanded, or opening. */
  open: boolean;
  /** The words `/deck status` prints, and the version `/deck version` names. */
  status: string;
  version: string;
  /** The last reply to a control, with the command word that earned it. */
  note: { verb: string; text: string } | null;
  /** The city being typed. */
  draft: string;
}

export interface View {
  locale: Locale;
  localeOption: LocaleOption;
  events: readonly RouteEvent[];
  routing: boolean;
  tab: JevTab;
  range: number;
  setup: SetupDraft;
  features: FeatureFlags;
  preferences: FeaturePreferences;
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
  /** The Deck tab's data, made only when that tab is open: the other tabs and the band never read Deck's state. */
  deck: DeckPanel | null;
  /** The orchestration policy and what it is doing; made only on the Configuration tab. */
  orchestration?: OrchestrationView;
}

/** Requested, applied and observed are kept apart: what the runtime did not report stays unknown. */
export interface OrchestrationView {
  policy: OrchestrationPolicy;
  /** The command being typed. */
  draft: string;
  objective?: {
    id: string;
    workMode: WorkMode;
    revision: number;
    requested?: Profile;
    why?: string;
    applied?: { model?: string; effort?: string };
    observed?: { model?: string; effort?: string };
    applyPending?: boolean;
  };
  batches: { id: string; approved: number; total: number; integration: string; verified: boolean; cancelled: boolean }[];
  /** The last command's reply. */
  message?: { ok: boolean; text: string };
}

export interface Actions {
  tab: (tab: JevTab) => void;
  range: (range: number) => void;
  routing: (on: boolean) => void;
  feature: (id: FeatureId, on: boolean) => void;
  preference: (key: keyof FeaturePreferences, value: FeaturePreferences[keyof FeaturePreferences]) => void;
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
  /** Runs one `/deck` command line, as it is typed after `/deck`; the reply shows in the Deck tab. */
  deck: (args: string) => void;
  /** Sets one surface's bar style, as the style picker does. */
  deckStyle: (surface: "terminal" | "desktop", name: string) => void;
  /** The city field: each change, and Enter. */
  deckType: (value: string) => void;
  deckCity: (value: string) => void;
  /** One orchestration settings command (core/orchestration.ts applyCommand, plus apply/end/cancel). */
  orchestration: (line: string) => void;
  /** The orchestration command field: each change, then Enter. */
  orchestrationType: (value: string) => void;
  orchestrationSubmit: (line: string) => void;
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

function statsParts(stats: ReturnType<typeof recentStats>, locale: Locale) {
  return {
    calls: text("ui.stats.calls", locale, { count: formatNumber(stats.calls, locale) }),
    latency: stats.latency === undefined ? "" : text("ui.stats.latency", locale, { value: formatNumber(stats.latency, locale) }),
    tokens: text("ui.stats.tokens", locale, { value: stats.tokens === undefined ? "–" : formatCompact(stats.tokens, locale) }),
    failures: text("ui.stats.failures", locale, { count: formatNumber(stats.failures, locale) }),
  };
}

function statsLine(stats: ReturnType<typeof recentStats>, locale: Locale): string {
  const parts = statsParts(stats, locale);
  return [parts.calls, parts.latency, parts.tokens, parts.failures].filter(Boolean).join(" · ");
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

/** Pingo's size in cells: the small sphere beside its speech bubble, smaller still in a narrow pane. */
export function pingoSize(width: number): { columns: number; rows: number } {
  return width < 60 ? { columns: 8, rows: 4 } : { columns: 12, rows: 5 };
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
    // one still sphere per mood: the source never changes, so the app keeps the CSS animation it started
    return <Svg source={pingoLiveSvg(mood)} alt={`Pingo, ${text(`mascot.mood.${mood}` as LocaleKey, view.locale)}`} />;
  }
  return null;
}

/** Dark ink for a label drawn on a colored ground. */
const PILL_INK = PAINT.onFill;

/** A label on a colored ground: a state, a model, the kind of a request. The ground is a mid-tone hex. */
function pill(els: Els, label: string, ground: string) {
  const { Text } = els;
  return <Text bold color={PILL_INK} backgroundColor={ground}>{` ${label} `}</Text>;
}

/** Columns a section's body is indented under its title. */
const INDENT = 2;

/**
 * A section, the one part every screen is built of: its title alone in the first Text (so a title can be found
 * by its words), a rule to the right edge, then the body indented under it. No frame: the rule and the indent
 * group it, so sections side by side never leave empty boxes. `color` paints the title, `rule` the rule (a state
 * or a mascot); an alert writes "!" on the rule and paints both red.
 */
function card(els: Els, title: string, body: RenderChildren, opts: { width: number; color?: string; rule?: string; note?: string; alert?: boolean }) {
  const { Box, Text } = els;
  const width = Math.max(10, opts.width);
  const mark = opts.alert ? ` ${GLYPH.warn}` : "";
  const room = width - displayWidth(title) - displayWidth(mark) - 1;
  return (
    <Box flexDirection="row" flexWrap="wrap" width={width} flexShrink={0}>
      <Text bold color={opts.alert ? INK.fail : opts.color ?? INK.ink} wrap="wrap">{title}</Text>
      {room >= 2 ? <Text color={opts.alert ? INK.fail : opts.rule ?? INK.border}>{`${mark} ${GLYPH.rule.repeat(room)}`}</Text> : null}
      <Box flexDirection="column" width={width} paddingLeft={INDENT}>
        {opts.note ? <Text color={INK.faint} wrap="wrap">{opts.note}</Text> : null}
        {body}
      </Box>
    </Box>
  );
}

/** Columns between sections side by side. */
const GUTTER = 3;

/** Sections side by side, two to a row where `width` holds two of at least `min` columns, one to a row otherwise. */
function grid(els: Els, width: number, cards: readonly ((width: number) => RenderChildren)[], min = 34, maxColumns = 2) {
  const { Box } = els;
  const columns = Math.max(1, Math.min(maxColumns, Math.floor((width + GUTTER) / (min + GUTTER))));
  const each = Math.floor((width - GUTTER * (columns - 1)) / columns);
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={GUTTER} rowGap={1}>
      {cards.map((make) => make(each))}
    </Box>
  );
}

/** The last five minutes in one line, what Pingo's bubble says under its sentence. A failure count above zero is red. */
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

/** The tab buttons side by side; the open one on the brand ground and marked ▸, so it reads without color too. */
function navButtons(els: Els, view: View, act: Actions) {
  const { Button, Text } = els;
  return TABS.flat().map(([id, label, hotkey]) => {
    const name = text(label as LocaleKey, view.locale);
    return view.tab === id ? (
      <Button key={"tab-" + id} label={`${GLYPH.open} ${name}`} hotkey={hotkey} plain onPress={() => act.tab(id)}>
        <Text bold color={PILL_INK} backgroundColor={INK.brand}>{` ${GLYPH.open} ${name} `}</Text>
      </Button>
    ) : (
      <Button key={"tab-" + id} label={name} hotkey={hotkey} plain dimColor onPress={() => act.tab(id)} />
    );
  });
}

function routingButton(els: Els, view: View, act: Actions) {
  const { Button } = els;
  return <Button key="routing" plain label={text(view.routing ? "ui.header.turnOff" : "ui.header.turnOn", view.locale)} {...(view.tab === "features" ? {} : { hotkey: "r" })} onPress={() => act.routing(!view.routing)} />;
}

/**
 * The top of the pane at every width: Pingo, and beside it the name, its mood as a face and a word, the routing
 * switch, and a speech bubble in the mood's color with what is going on and the last five minutes. The screens
 * follow on one line (two where narrow), the open one on the brand ground. A short terminal pane keeps one line
 * of header and the screens.
 */
function header(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const mood = moodOf(view);
  const ink = hex(MOODS[mood].color);
  const compact = view.surface === "terminal" && view.rows < 24;
  const said = view.live.asking ? text("ui.header.asking", view.locale) : state.title;
  const nameLine = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text bold color={INK.brand}>⠿ jev</Text>
      <Text wrap="truncate">{pill(els, MOODS[mood].face, ink)}</Text>
      <Text bold color={ink}>{`${state.icon} ${said}`}</Text>
      <Text color={INK.border}>·</Text>
      {routingButton(els, view, act)}
    </Box>
  );
  const nav = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {navButtons(els, view, act)}
    </Box>
  );
  if (compact) {
    return (
      <Box flexDirection="column">
        {nameLine}
        {nav}
      </Box>
    );
  }
  const bubble = (
    <Box flexDirection="column" borderStyle="round" borderColor={ink} paddingX={1}>
      <Text color={INK.ink} wrap="wrap">{view.live.asking ? text("ui.header.asking", view.locale) : state.text}</Text>
      {recentLine(els, view)}
    </Box>
  );
  // a narrow pane puts the bubble under Pingo and its name, across the whole width, so it does not wrap word by word
  const narrow = view.width < 60;
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2}>
          <Box flexDirection="column" flexShrink={0} paddingLeft={1}>
            {pingoArt(els, view, mood)}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} justifyContent={narrow ? "center" : "flex-start"}>
            {nameLine}
            {narrow ? null : bubble}
          </Box>
        </Box>
        {narrow ? bubble : null}
      </Box>
      {nav}
    </Box>
  );
}

/** The open screen's name in the brand color and, beside it, what the screen is for. */
function titleBar(els: Els, view: View) {
  const { Box, Text } = els;
  const entry = TABS.flat().find(([id]) => id === view.tab) ?? TABS[0]![0]!;
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text bold color={INK.brand}>{text(entry[1] as LocaleKey, view.locale)}</Text>
      <Text color={INK.dim} wrap="wrap">{`· ${text(`ui.purpose.${view.tab}` as LocaleKey, view.locale)}`}</Text>
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

/** A heading inside a section: bold and dim, its words alone in the Text so they can be found as they are. */
function section(els: Els, title: string) {
  const { Text } = els;
  return <Text bold color={INK.dim} wrap="truncate">{title}</Text>;
}

/** A line that stands where a section has nothing to show: a hollow glyph, then why. */
function emptyLine(els: Els, message: string) {
  const { Text } = els;
  return <Text color={INK.dim} wrap="wrap">{`${GLYPH.off} ${message}`}</Text>;
}

/**
 * A group of figures, `width` columns wide: the label, dotted leaders to the value in bold, and its note. A figure
 * that flags a failure is red and marked "!". A label too long for its column wraps there rather than being cut;
 * a note too narrow beside them goes under.
 */
function figures(els: Els, group: readonly Tile[], width: number) {
  const { Box, Text } = els;
  const valueWidth = Math.min(Math.max(...group.map((tile) => displayWidth(tile.value) + (tile.alert ? 2 : 0))), 16);
  const longest = Math.max(...group.map((tile) => displayWidth(tile.label)));
  const labelWidth = Math.max(8, Math.min(longest + 4, width - valueWidth - 2));
  const noteWidth = width - labelWidth - valueWidth - 4;
  const under = noteWidth < 16;
  const note = (tile: Tile) => <Text color={tile.alert ? INK.fail : INK.faint} wrap="wrap">{tile.sub}</Text>;
  const led = (label: string) => {
    const dots = labelWidth - displayWidth(label) - 1;
    return dots >= 1 ? `${label} ${GLYPH.leader.repeat(dots)}` : label;
  };
  return (
    <Box flexDirection="column" rowGap={under ? 1 : 0}>
      {group.map((tile) => (
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1}>
            <Box width={labelWidth} flexShrink={0}>
              <Text color={INK.dim} wrap="wrap">{led(tile.label)}</Text>
            </Box>
            <Box width={valueWidth} flexShrink={0} justifyContent="flex-end">
              <Text bold color={tile.alert ? INK.fail : INK.ink}>{`${tile.alert ? `${GLYPH.warn} ` : ""}${tile.value}`}</Text>
            </Box>
            {under ? null : <Box width={noteWidth} flexShrink={0} marginLeft={1}>{note(tile)}</Box>}
          </Box>
          {under ? <Box paddingLeft={2}>{note(tile)}</Box> : null}
        </Box>
      ))}
    </Box>
  );
}

/**
 * What happened to the requests: each outcome on its own line, its glyph and name, then a bar as long as its share
 * of all requests, with the count and share. The glyph and the words tell the outcome; the color repeats them.
 */
function outcomeBar(els: Els, events: readonly RouteEvent[], width: number, locale: Locale) {
  const { Box, Text } = els;
  const counts = new Map(tally(events.map(category)));
  const present = categories(locale).filter(([name]) => counts.get(name));
  const room = Math.max(6, width - 16);
  return (
    <Box flexDirection="column" marginBottom={1}>
      {present.map(([name, label]) => {
        const count = counts.get(name) ?? 0;
        const [glyph, color] = CATEGORY_DOT[name];
        return (
          <Box flexDirection="column">
            <Text wrap="wrap">
              <Text bold color={hex(color)}>{`${glyph} `}</Text>
              <Text color={INK.ink}>{label}</Text>
            </Text>
            <Text wrap="truncate">
              <Text color={hex(color)}>{`  ${blockBar(count / Math.max(1, events.length), room).padEnd(room)}`}</Text>
              <Text bold color={INK.ink}>{` ${int(count, locale)} · ${pct(count, events.length, locale)}`}</Text>
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
function sparkline(els: Els, view: View, events: readonly RouteEvent[], width: number) {
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
 * The selected range at a glance. The range picker leads, since it scopes every figure; the rail's figures keep
 * their own last five minutes. The status sentence shows only when it says more than the rail does. Then cards:
 * Routing, Jev's answers and Token usage side by side where they fit, and the Timeline across the whole width.
 */
function overview(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const events = inRange(view);
  const consults = consultsInRange(view);
  const state = status(view.events, view.routing, view.now, view.locale);
  const all = consults.length ? tiles(events, view.locale, consults) : tiles(events, view.locale);
  const group = (id: TileGroup) => all.filter((tile) => tile.group === id);
  // With nothing ever recorded, "no requests in the last 5 minutes" only repeats the empty line.
  const note = state.kind === "routing" || (state.kind === "idle" && view.events.length === 0) ? null : state.text;
  const head = (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {rangePicker(els, view, act)}
        {events.length === 0 ? null : (
          <Text bold color={INK.ink} wrap="truncate">
            {text("ui.overview.scope", view.locale, { count: int(events.length, view.locale), requests: text(events.length === 1 ? "unit.request" : "unit.requests", view.locale) })}
          </Text>
        )}
        {consults.length ? <Text color={INK.dim} wrap="truncate">{text(view.range <= 0 && view.trace.turns > view.trace.runs.length ? "ui.overview.consultScopeRetained" : "ui.overview.consultScope", view.locale, { count: int(consults.length, view.locale) })}</Text> : null}
      </Box>
      {note === null ? null : <Text color={INK.pass} wrap="wrap">{note}</Text>}
      <Text color={INK.faint} wrap="wrap">{view.meta}</Text>
    </Box>
  );
  if (events.length === 0 && consults.length === 0) {
    return (
      <Box flexDirection="column" rowGap={1}>
        {head}
        {emptyLine(els, text("ui.overview.empty", view.locale))}
      </Box>
    );
  }
  const alertOf = (group: readonly Tile[]) => group.some((tile) => tile.alert);
  const cards: ((width: number) => RenderChildren)[] = [];
  if (events.length) {
    cards.push((width) => card(els, text("ui.overview.routing", view.locale), [outcomeBar(els, events, width - INDENT, view.locale), figures(els, group("routing"), width - INDENT)], { width, alert: alertOf(group("routing")) }));
  }
  if (group("jev").length) cards.push((width) => card(els, text("ui.overview.jev", view.locale), figures(els, group("jev"), width - INDENT), { width, alert: alertOf(group("jev")) }));
  if (group("tokens").length) cards.push((width) => card(els, text("ui.overview.tokens", view.locale), figures(els, group("tokens"), width - INDENT), { width, alert: alertOf(group("tokens")) }));
  return (
    <Box flexDirection="column" rowGap={1}>
      {head}
      {grid(els, view.width, cards, 44)}
      {events.length ? card(els, text("ui.overview.timeline", view.locale), sparkline(els, view, events, view.width - INDENT), { width: view.width }) : null}
    </Box>
  );
}

/**
 * The Logs screen: a card of reason groups, each with a bar as long as its share of the largest, then the request
 * log itself, newest first, one line per request with its outcome on a colored ground.
 */
function logView(els: Els, view: View) {
  const { Box, Text } = els;
  const grouped = reasons(view.events, view.locale);
  const unhandled = view.events.filter((event) => !routed(event)).length;
  const colorFor = (who: string) => (who === text("reason.who.failed", view.locale) ? INK.fail : who === text("reason.who.asked", view.locale) ? INK.pass : INK.dim);
  const most = Math.max(1, ...grouped.map((reason) => reason.count));
  const reasonsShown = grouped.slice(0, 6);
  const rows = [...view.events].reverse();
  return (
    <Box flexDirection="column" rowGap={1}>
      {card(
        els,
        text("ui.log.reasons", view.locale),
        grouped.length === 0
          ? <Text color={INK.faint}>{text("ui.log.noReasons", view.locale)}</Text>
          : grid(els, view.width - 4, reasonsShown.map((reason) => (reasonWidth) => (
                <Box flexDirection="column" width={reasonWidth} flexShrink={0}>
                  <Text bold color={colorFor(reason.who)} wrap="wrap">{`${reasonTitle(reason.name, view.locale)} · ${int(reason.count, view.locale)} · ${pct(reason.count, unhandled, view.locale)}`}</Text>
                  <Text color={colorFor(reason.who)} wrap="truncate">{blockBar(reason.count / most, Math.max(6, reasonWidth - 2)) || EIGHTHS[0]}</Text>
                </Box>
              )), 28),
        { width: view.width, note: grouped.length > reasonsShown.length ? text("ui.log.moreReasons", view.locale, { hidden: formatNumber(grouped.length - reasonsShown.length, view.locale) }) : undefined },
      )}
      {card(els, text("ui.log.title", view.locale), rows.length ? rows.map((event) => logEntry(els, { ...view, width: view.width - 4 }, event)) : <Text color={INK.dim}>{text("ui.log.empty", view.locale)}</Text>, {
        width: view.width,
        note: text("ui.log.recent", view.locale, { shown: formatNumber(rows.length, view.locale), total: formatNumber(view.events.length, view.locale) }),
      })}
    </Box>
  );
}

/**
 * One request of the log, in two columns: its time, then what happened (its outcome on a colored ground) and how
 * long it took; its figures faint under that; why it went that way under them. Wrapped lines stay in the second
 * column, and a blank row closes each request so they stand apart.
 */
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
  const figures = [
    confidence === undefined ? "" : formatDecimal(confidence, view.locale),
    event.jev ? `${int(event.jev.latencyMs, view.locale)} ms` : "",
    usage,
  ].filter(Boolean).join(" · ");
  return (
    <Box flexDirection="row" marginBottom={1}>
      <Box width={clockWidth(view.locale)} flexShrink={0}>
        <Text color={INK.faint}>{clock(at(event), view.locale)}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text wrap="wrap">
          {pill(els, glyph, hex(color))}
          <Text bold color={INK.ink}>{` ${what}`}</Text>
          <Text color={INK.dim}>{text("ui.log.duration", view.locale, { value: formatDecimal(event.durationMs / 1000, view.locale, 1) + text("format.seconds", view.locale, { value: "" }) })}</Text>
        </Text>
        {figures ? <Text color={INK.faint} wrap="wrap">{figures}</Text> : null}
        {event.reason ? <Text color={kind === "failed" ? INK.fail : INK.dim} wrap="wrap">{text("ui.log.reason", view.locale, { reason: reasonDetail })}</Text> : null}
        {kind === "failed" && event.error ? <Text color={INK.fail} wrap="wrap">{text("ui.log.cause", view.locale, { cause: event.error })}</Text> : null}
        {kind === "failed" ? <Text color={INK.pass} wrap="wrap">{text("ui.log.hint", view.locale, { hint: failureHint(failureKind(event.error ?? "", event.reason), view.locale) })}</Text> : null}
        {kind === "failed"
          ? (event.jevRaw ?? []).map((raw, index, all) => (
              <Box flexDirection="column" borderStyle="round" borderColor={INK.fail} paddingX={1}>
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

/** One step of the setup: its number on a colored ground (a check once done), its label, and what is set there. */
function step(els: Els, n: number, label: string, done: boolean, body: RenderChildren) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text wrap="truncate">
        {pill(els, done ? GLYPH.ok : String(n), done ? css(HUE.ok) : css(HUE.neutral))}
        <Text bold color={INK.ink}>{` ${label}`}</Text>
      </Text>
      <Box flexDirection="column" marginLeft={4}>
        {body}
      </Box>
    </Box>
  );
}

/** Feature switches and the preferences that control their behavior. */
function featuresView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button, Select } = els;
  const state = `${GLYPH.on} ${text("ui.configuration.enabledValue", view.locale)}  ${GLYPH.off} ${text("ui.configuration.disabledValue", view.locale)}`;
  const summaryKeys: Record<FeatureId, LocaleKey> = {
    agents: "ui.features.summary.agents",
    farol: "ui.features.summary.farol",
    clareza: "ui.features.summary.clareza",
    pingoVivo: "ui.features.summary.pingoVivo",
    prisma: "ui.features.summary.prisma",
    semente: "ui.features.summary.semente",
    lapida: "ui.features.summary.lapida",
    sentinela: "ui.features.summary.sentinela",
    vigia: "ui.features.summary.vigia",
  };
  const preferenceToggle = (key: keyof FeaturePreferences, label: string, on: boolean) => () =>
    toggleButton(els, key, on, label, () => act.preference(key, !on));
  const locale = view.locale;
  const preferences = view.preferences;
  const featuresList = features(locale).map((feature) => (cellWidth: number) => {
    const on = view.features[feature.id];
    const name = feature.id === "agents" ? text("ui.features.agentsShort", locale) : feature.name;
    return (
      <Box flexDirection="column" width={cellWidth} flexShrink={0}>
        {toggleButton(els, "feature-" + feature.id, on, name, () => act.feature(feature.id, !on), feature.hotkey)}
        <Text color={INK.dim} wrap="wrap">{text(summaryKeys[feature.id], locale)}</Text>
      </Box>
    );
  });
  const preferenceGroups: [LocaleKey, readonly (() => RenderChildren)[]][] = [
    ["ui.features.replyGroup", [
    () => <Select key="assumption-scope" label={text("ui.features.scope", locale)} value={preferences.assumptionScope} options={[
      { value: "all", label: text("ui.features.scopeAll", locale) },
      { value: "important", label: text("ui.features.scopeImportant", locale) },
    ]} onSelect={(value) => act.preference("assumptionScope", value as FeaturePreferences["assumptionScope"])} />,
    () => <Select key="plain-level" label={text("ui.features.style", locale)} value={preferences.plainLevel} options={[
      { value: "beginner", label: text("ui.features.beginner", locale) },
      { value: "expert", label: text("ui.features.expert", locale) },
    ]} onSelect={(value) => act.preference("plainLevel", value as FeaturePreferences["plainLevel"])} />,
    preferenceToggle("plainReview", text("ui.features.answerReview", locale), preferences.plainReview),
    preferenceToggle("plainSound", text("ui.features.completionSound", locale), preferences.plainSound),
    ]],
    ["ui.features.mascotGroup", [
    () => <Select key="pet-hat" label={text("ui.features.hat", locale)} value={preferences.petHat} options={[
      { value: "random", label: text("ui.features.randomHat", locale) },
      ...["tophat", "party", "crown", "wizard", "cowboy", "propeller", "chef", "viking", "halo", "santa", "nightcap"].map((hat) => ({ value: hat, label: text(`deck.pet.hat.${hat}` as LocaleKey, locale) })),
    ]} onSelect={(value) => act.preference("petHat", String(value))} />,
    preferenceToggle("petShades", text("ui.features.petShades", locale), preferences.petShades),
    ]],
    ["ui.features.workflowGroup", [
    () => <Select key="design-surface" label={text("ui.features.surface", locale)} value={preferences.designSurface} options={[
      { value: "auto", label: text("ui.configuration.surfaceAuto", locale) },
      { value: "pane", label: text("ui.configuration.surfacePane", locale) },
      { value: "browser", label: text("ui.configuration.surfaceBrowser", locale) },
    ]} onSelect={(value) => act.preference("designSurface", value as FeaturePreferences["designSurface"])} />,
    preferenceToggle("ideaNudges", text("ui.features.ideaNudges", locale), preferences.ideaNudges),
    preferenceToggle("promptLearning", text("ui.features.promptLearning", locale), preferences.promptLearning),
    preferenceToggle("trackerSummary", text("ui.features.trackerSummary", locale), preferences.trackerSummary),
    ]],
    ["ui.features.monitorGroup", [
    () => <Select key="monitor-interval" label={text("ui.features.monitor", locale)} value={String(preferences.monitorEveryMs)} options={[2000, 5000, 10000].map((ms) => ({ value: String(ms), label: `${ms / 1000}s` }))} onSelect={(value) => act.preference("monitorEveryMs", Number(value) as FeaturePreferences["monitorEveryMs"])} />,
    () => <Select key="clash-window" label={text("ui.features.clashWindow", locale)} value={String(preferences.clashMinutes)} options={[15, 30, 60].map((minutes) => ({ value: String(minutes), label: `${minutes} min` }))} onSelect={(value) => act.preference("clashMinutes", Number(value) as FeaturePreferences["clashMinutes"])} />,
    ]],
  ];
  return (
    <Box flexDirection="column" rowGap={1} width={view.width}>
      {card(els, text("ui.configuration.features", locale), grid(els, view.width - 4, featuresList, 32), { width: view.width, note: `${state} · ${text("ui.features.clickToChange", locale)}` })}
      {section(els, text("ui.features.preferencesTitle", locale))}
      {grid(els, view.width, preferenceGroups.map(([title, controls]) => (width) => card(els, text(title, locale), <Box flexDirection="column" rowGap={1}>{controls.map((make) => make())}</Box>, { width })), 38)}
    </Box>
  );
}

/** Provider and language setup, saved credentials, and history controls. */
function configurationView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button, Select, Input } = els;
  const chosen = PROVIDER_IDS.includes(view.setup.provider as never) ? view.setup.provider : PROVIDER_IDS.includes(view.key.provider as never) ? view.key.provider : "typesafe";
  const info = PROVIDERS[chosen as keyof typeof PROVIDERS];
  const saved = view.key.source !== "none";
  const typed = view.setup.typed ?? "";
  const message = view.setup.message;
  const connected = view.setup.isOk && Boolean(message) && !view.setup.busy;
  const cardWidth = view.width >= 101 ? Math.floor((view.width - GUTTER) / 2) : view.width;
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text color={INK.dim} wrap="wrap">{text("ui.setup.intro", view.locale)}</Text>
        {!view.routing ? <Text color={INK.pass} wrap="wrap">{text("ui.configuration.routingOff", view.locale)}</Text> : null}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={GUTTER} rowGap={1}>
        {card(
          els,
          text("ui.configuration.provider", view.locale),
          [
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
          />,
          <Text color={INK.faint} wrap="wrap">{text("ui.setup.languageHelp", view.locale)}</Text>,
          step(
            els,
            1,
            text("ui.setup.provider", view.locale),
            true,
            <Box flexDirection="column">
              <Select key="provider" value={chosen} options={PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDERS[id].label }))} onSelect={(value) => act.provider(value)} />
              <Text color={INK.faint} wrap="wrap">{text("ui.setup.providerNote", view.locale, { note: text(info.noteKey, view.locale), url: info.keyUrl })}</Text>
            </Box>,
          ),
          step(
            els,
            2,
            text("ui.setup.keyLabel", view.locale),
            saved && !typed,
            <Box flexDirection="column">
              {saved ? (
                <Text wrap="truncate">
                  <Text color={INK.route}>{`••••${view.key.tail}`}</Text>
                  <Text color={INK.dim}>{text("ui.setup.keyInUse", view.locale, { source: text(`source.${view.key.source}` as LocaleKey, view.locale) })}</Text>
                </Text>
              ) : (
                <Text color={INK.pass} wrap="truncate">{text("ui.setup.noKeyYet", view.locale, { env: info.keyEnv })}</Text>
              )}
              <Input
                key="api-key"
                value={typed}
                placeholder={text(saved ? "ui.setup.keyPlaceholder" : "ui.setup.keyPlaceholderEmpty", view.locale)}
                submitLabel={text("ui.setup.testSave", view.locale)}
                onInput={(value) => act.typeKey(value)}
                onSubmit={(value) => act.submitKey(value)}
              />
              <Text color={INK.faint} wrap="wrap">{text("ui.setup.maskedHelp", view.locale)}</Text>
            </Box>,
          ),
          step(
            els,
            3,
            text("ui.setup.connection", view.locale),
            connected,
            <Box flexDirection="column">
              <Box flexDirection="row" columnGap={2} flexWrap="wrap">
                <Button key="validate" label={`${text(typed ? "ui.setup.testSave" : "ui.setup.testConnection", view.locale)} (v)`} hotkey="v" onPress={() => act.validate()} />
                {saved && view.key.source === "plugin" ? <Button key="forget" label={`${text("ui.setup.removeKey", view.locale)} (f)`} hotkey="f" onPress={() => act.forgetKey()} /> : null}
              </Box>
              {message ? (
                <Text bold color={view.setup.busy ? INK.dim : view.setup.isOk ? INK.route : INK.fail} wrap="truncate">
                  {`${view.setup.busy ? "◌" : view.setup.isOk ? GLYPH.on : GLYPH.fail} ${message}`}
                </Text>
              ) : null}
            </Box>,
          ),
          <Box marginTop={1}>
            <Text color={INK.pass} wrap="wrap">{text("ui.setup.privacy", view.locale)}</Text>
          </Box>,
          ],
          { width: cardWidth, ...(connected ? { rule: INK.route } : {}) },
        )}
        {card(els, text("ui.configuration.history", view.locale), [
          <Text color={INK.faint} wrap="truncate">{view.meta}</Text>,
          <Box flexDirection="row">
            <Button key="clear" label={`${text("ui.setup.clearHistory", view.locale)} (c)`} hotkey="c" onPress={() => act.clear()} />
          </Box>,
        ], { width: cardWidth })}
      </Box>
      {view.orchestration ? orchestrationCard(els, view, view.orchestration, act) : null}
    </Box>
  );
}

const profileText = (profile: { model?: string; effort?: string } | undefined, locale: Locale) =>
  profile?.model ? `${MODEL_LABEL[profile.model as keyof typeof MODEL_LABEL] ?? modelName(profile.model)} ${profile.effort ?? text("ui.orch.unknown", locale)}` : text("ui.orch.unknown", locale);

const fixedModelOptions = (locale: Locale) =>
  CLAUDE_MODELS.map((id) => ({ value: id, label: `${text("ui.orch.fixed", locale)}: ${MODEL_LABEL[id]}` }));

/** One role's model and effort: AUTO with its allowlist, or one fixed value. */
function roleRows(els: Els, view: View, policy: OrchestrationPolicy, role: Role, act: Actions) {
  const { Box, Text, Button, Select } = els;
  const locale = view.locale;
  const setting = policy.roles[role];
  const chip = (on: boolean, label: string, line: string, key: string) => (
    <Button key={key} label={`${on ? GLYPH.ok : GLYPH.leader} ${label}`} plain dimColor={!on} onPress={() => act.orchestration(line)} />
  );
  return (
    <Box flexDirection="column" key={"role-" + role}>
      <Text bold color={INK.ink} wrap="wrap">{text(`ui.orch.role.${role}` as LocaleKey, locale)}</Text>
      <Text color={INK.faint} wrap="wrap">{text(`ui.orch.role.${role}.purpose` as LocaleKey, locale)}</Text>
      <Select
        key={`model-${role}`}
        label={text("ui.orch.model", locale)}
        value={setting.model.mode === "auto" ? "auto" : setting.model.fixed}
        options={[{ value: "auto", label: text("ui.orch.auto", locale) }, ...fixedModelOptions(locale)]}
        onSelect={(value) => act.orchestration(value === "auto" ? `role ${role} model auto` : `role ${role} model fixed ${value}`)}
      />
      {setting.model.mode === "auto" ? (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {CLAUDE_MODELS.map((id) => chip(setting.model.allowed.includes(id), MODEL_LABEL[id], `role ${role} model allow ${id}`, `allow-${role}-${id}`))}
        </Box>
      ) : null}
      <Select
        key={`effort-${role}`}
        label={text("ui.orch.effort", locale)}
        value={setting.effort.mode === "auto" ? "auto" : setting.effort.fixed}
        options={[{ value: "auto", label: text("ui.orch.auto", locale) }, ...PROFILE_EFFORTS.map((level) => ({ value: level, label: `${text("ui.orch.fixed", locale)}: ${level}` }))]}
        onSelect={(value) => act.orchestration(value === "auto" ? `role ${role} effort auto` : `role ${role} effort fixed ${value}`)}
      />
      {setting.effort.mode === "auto" ? (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {PROFILE_EFFORTS.map((level) => chip(setting.effort.allowed.includes(level), level, `role ${role} effort allow ${level}`, `allow-${role}-${level}`))}
        </Box>
      ) : null}
      {setting.model.fallback.length || setting.effort.fallback.length ? (
        <Text color={INK.faint} wrap="wrap">{text("ui.orch.fallback", locale, { models: setting.model.fallback.map((id) => MODEL_LABEL[id]).join(", ") || "–", efforts: setting.effort.fallback.join(", ") || "–" })}</Text>
      ) : null}
      {policy.override[role] ? <Text color={INK.pass} wrap="wrap">{text("ui.orch.override", locale, { value: profileText(policy.override[role], locale) })}</Text> : null}
    </Box>
  );
}

/** The Configuration tab's orchestration card: roles, switches, limits, the live objective and batches. */
function orchestrationCard(els: Els, view: View, orch: OrchestrationView, act: Actions) {
  const { Box, Text, Button, Select, Input } = els;
  const locale = view.locale;
  const policy = orch.policy;
  const toggle = (on: boolean, label: string, line: string, key: string) => toggleButton(els, key, on, label, () => act.orchestration(line));
  const objective = orch.objective;
  const limits = policy.limits;
  const nativeValue = policy.nativeAdvisor.mode === "fixed" ? policy.nativeAdvisor.model : policy.nativeAdvisor.mode;
  return card(els, text("ui.orch.title", locale), [
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} key="orch-switches">
      {toggle(policy.enabled, text(policy.enabled ? "ui.orch.on" : "ui.orch.off", locale), policy.enabled ? "off" : "on", "orch-enabled")}
      {toggle(policy.review, text("ui.orch.review", locale), policy.review ? "review off" : "review on", "orch-review")}
      {toggle(policy.advice === "auto", text("ui.orch.advice", locale), policy.advice === "auto" ? "advice off" : "advice auto", "orch-advice")}
      {toggle(policy.batch === "auto", text("ui.orch.batch", locale), policy.batch === "auto" ? "batch off" : "batch auto", "orch-batch")}
    </Box>,
    <Text color={INK.faint} wrap="wrap" key="orch-intro">{text("ui.orch.intro", locale, { revision: formatNumber(policy.revision, locale) })}</Text>,
    ...(policy.review ? [] : [<Text color={INK.fail} wrap="wrap" key="orch-review-off">{text("ui.orch.reviewOff", locale)}</Text>]),
    grid(els, view.width - 4, ROLES.map((role) => (width: number) => <Box width={width} flexShrink={0} key={"cell-" + role}>{roleRows(els, view, policy, role, act)}</Box>), 30, 3),
    <Box flexDirection="column" key="orch-native" marginTop={1}>
      <Select
        key="native-advisor"
        label={text("ui.orch.nativeLabel", locale)}
        value={nativeValue}
        options={[
          { value: "off", label: text("ui.orch.nativeOff", locale) },
          { value: "auto", label: text("ui.orch.nativeAuto", locale) },
          ...fixedModelOptions(locale),
        ]}
        onSelect={(value) => act.orchestration(value === "off" || value === "auto" ? `native ${value}` : `native fixed ${value}`)}
      />
      <Text color={INK.faint} wrap="wrap">{text("ui.orch.nativeNote", locale)}</Text>
      {policy.nativeAdvisor.mode !== "off" ? <Text color={INK.pass} wrap="wrap">{text("ui.orch.nativeHeld", locale)}</Text> : null}
    </Box>,
    <Text color={INK.dim} wrap="wrap" key="orch-limits">{text("ui.orch.limits", locale, {
      workers: limits.workers, reviewers: limits.reviewers, calls: limits.activeCalls, units: limits.units,
      advice: limits.adviceCalls, repairs: limits.repairRounds, reviews: limits.reviewPasses, turns: limits.workerTurns,
      timeout: formatNumber(Math.round(limits.callTimeoutMs / 1000), locale),
    })}</Text>,
    <Input
      key="orch-command"
      value={orch.draft}
      placeholder={text("ui.orch.commandPlaceholder", locale)}
      submitLabel={text("ui.orch.commandSubmit", locale)}
      onInput={(value) => act.orchestrationType(value)}
      onSubmit={(value) => act.orchestrationSubmit(value)}
    />,
    orch.message ? <Text key="orch-message" color={orch.message.ok ? INK.route : INK.fail} wrap="wrap">{orch.message.text}</Text> : null,
    <Box flexDirection="column" key="orch-objective" marginTop={1}>
      <Text bold color={INK.ink}>{text("ui.orch.objective", locale)}</Text>
      {objective ? (
        <Box flexDirection="column">
          <Text color={INK.dim} wrap="wrap">{text("ui.orch.objectiveLine", locale, { id: objective.id, mode: objective.workMode, revision: formatNumber(objective.revision, locale) })}</Text>
          <Text wrap="wrap">{text("ui.orch.requested", locale, { value: objective.requested ? profileText(objective.requested, locale) : text("ui.orch.nativeRequest", locale) + (objective.why ? ` (${objective.why})` : "") })}</Text>
          <Text wrap="wrap">{text("ui.orch.applied", locale, { value: objective.applied ? profileText(objective.applied, locale) : text("ui.orch.unknown", locale) })}</Text>
          <Text wrap="wrap">{text("ui.orch.observed", locale, { value: objective.observed?.model ? `${modelName(objective.observed.model)} · ${text("ui.orch.effortUnknown", locale)}` : text("ui.orch.unknown", locale) })}</Text>
          <Box flexDirection="row" columnGap={2}>
            <Button key="orch-apply" label={text(objective.applyPending ? "ui.orch.applyPending" : "ui.orch.apply", locale)} plain dimColor={objective.applyPending === true} onPress={() => act.orchestration("apply")} />
            <Button key="orch-end" label={text("ui.orch.end", locale)} plain onPress={() => act.orchestration("end")} />
          </Box>
        </Box>
      ) : <Text color={INK.faint} wrap="wrap">{text("ui.orch.noObjective", locale)}</Text>}
    </Box>,
    ...(orch.batches.length ? [
      <Box flexDirection="column" key="orch-batches" marginTop={1}>
        <Text bold color={INK.ink}>{text("ui.orch.batches", locale)}</Text>
        {orch.batches.map((b) => (
          <Box flexDirection="row" columnGap={2} key={"batch-" + b.id}>
            <Text color={b.verified ? INK.route : INK.pass} wrap="truncate">{text("ui.orch.batchLine", locale, { id: b.id, approved: b.approved, total: b.total, integration: b.integration, state: text(b.verified ? "ui.orch.verified" : "ui.orch.unverified", locale) })}</Text>
            {!b.cancelled && !b.verified ? <Button key={"cancel-" + b.id} label={text("ui.orch.cancel", locale)} plain onPress={() => act.orchestration(`cancel ${b.id}`)} /> : null}
          </Box>
        ))}
      </Box>,
    ] : []),
  ], { width: view.width, ...(policy.enabled ? { rule: INK.route } : {}), note: text("ui.orch.note", locale) });
}

/**
 * The Deck screen: every /deck command as a control, in cards, each with the command it runs beneath it. A
 * control sends its command line through act.deck, so the screen and the slash command are one code path.
 */
function deckView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button, Select, Input } = els;
  const { locale, deck } = view;
  if (!deck) return <Text color={INK.faint} wrap="wrap">{text("ui.deck.intro", locale)}</Text>;
  const { settings } = deck;
  const toggle = (key: string, on: boolean, label: string, command: string) => toggleButton(els, key, on, label, () => act.deck(`${command} ${on ? "off" : "on"}`));
  const choices = (names: Record<string, string>, list: readonly string[]) => list.map((value) => ({ value, label: names[value] ?? value }));
  const verb = deck.note?.verb;
  const noteGroup = !verb ? undefined
    : ["expand", "collapse", "style", "collapsed", "size"].includes(verb) ? "ui.deck.band"
    : verb === "all" || (SECTIONS as readonly string[]).includes(verb) ? "ui.deck.show"
    : ["auto", "sound", "quiet", "cost"].includes(verb) ? "ui.deck.extras"
    : verb === "city" ? "ui.deck.city"
    : ["panel", "demo", "clear"].includes(verb) ? "ui.deck.tools"
    : "ui.deck.status";
  const groups: [LocaleKey, RenderChildren][] = [
    ["ui.deck.band", <Box flexDirection="column" rowGap={1}>
      {toggleButton(els, "deck-band", deck.open, text(deck.open ? "ui.deck.bandOpen" : "ui.deck.bandShut", locale, { hotkey: "e" }), () => act.deck(deck.open ? "collapse" : "expand"), "e")}
      <Box flexDirection="column">
        <Text color={INK.dim}>{text("ui.deck.look", locale)}</Text>
        <Select key="deck-look" value={settings.collapsed} options={COLLAPSED.map((value) => ({ value, label: text(`ui.deck.look.${value}`, locale) }))} onSelect={(value) => act.deck(`collapsed ${value}`)} />
      </Box>
      <Select key="deck-size" label={text("ui.deck.size", locale)} value={settings.size} options={SIZES.map((value) => ({ value, label: text(`ui.deck.size.${value}`, locale) }))} onSelect={(value) => act.deck(`size ${value}`)} />
      <Select key="deck-style-cli" label={text("ui.deck.styleCli", locale)} value={settings.style.terminal} options={choices(TERMINAL_STYLE_NAMES, TERMINAL_STYLES)} onSelect={(value) => act.deckStyle("terminal", value)} />
      <Select key="deck-style-desktop" label={text("ui.deck.styleDesktop", locale)} value={settings.style.desktop} options={choices(DESKTOP_STYLE_NAMES, DESKTOP_STYLES)} onSelect={(value) => act.deckStyle("desktop", value)} />
      <Button key="deck-style-pick" plain label={text("ui.deck.stylePick", locale, { hotkey: "s" })} hotkey="s" onPress={() => act.deck("style")} />
    </Box>],
    ["ui.deck.show", <Box flexDirection="column">
      {SECTIONS.map((id) => toggle(`deck-show-${id}`, settings.show[id], text(`deck.section.${id}`, locale), id))}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
        <Button key="deck-all-on" plain label={text("ui.deck.showAll", locale)} onPress={() => act.deck("all on")} />
        <Button key="deck-all-off" plain label={text("ui.deck.hideAll", locale)} dimColor onPress={() => act.deck("all off")} />
      </Box>
    </Box>],
    ["ui.deck.extras", <Box flexDirection="column">
      {toggle("deck-auto", settings.auto, text("ui.deck.auto", locale), "auto")}
      {toggle("deck-sound", settings.sound, text("ui.deck.sound", locale), "sound")}
      {toggle("deck-quiet", settings.quiet, text("ui.deck.quiet", locale), "quiet")}
      {toggle("deck-cost", settings.cost, text("ui.deck.cost", locale), "cost")}
    </Box>],
    ["ui.deck.city", <Box flexDirection="column" rowGap={1}>
      <Text color={INK.dim} wrap="wrap">{settings.city ? text("ui.deck.cityNow", locale, { city: settings.city.name }) : text("ui.deck.cityNone", locale)}</Text>
      <Input key="deck-city" value={deck.draft} placeholder={text("ui.deck.cityPlaceholder", locale)} submitLabel={text("ui.deck.citySet", locale)} onInput={(value) => act.deckType(value)} onSubmit={(value) => act.deckCity(value)} />
    </Box>],
    ["ui.deck.tools", <Box flexDirection="column">
      <Button key="deck-panel-open" plain label={text("ui.deck.panelOpen", locale, { hotkey: "p" })} hotkey="p" onPress={() => act.deck("panel")} />
      <Button key="deck-panel-close" plain label={text("ui.deck.panelClose", locale)} onPress={() => act.deck("panel off")} />
      <Button key="deck-demo" plain label={text("ui.deck.demo", locale)} onPress={() => act.deck("demo")} />
      <Button key="deck-clear" plain label={text("ui.deck.clear", locale)} onPress={() => act.deck("clear")} />
    </Box>],
    ["ui.deck.status", <Box flexDirection="column" rowGap={1}>
      <Text color={INK.dim} wrap="wrap">{deck.status}</Text>
      <Text color={INK.faint}>{text("deck.reply.version", locale, { version: deck.version })}</Text>
    </Box>],
  ];
  return (
    <Box flexDirection="column" rowGap={1} width={view.width}>
      {grid(els, view.width, groups.map(([title, body]) => (width) => card(els, text(title, locale), <Box flexDirection="column" rowGap={1}>
        {body}
        {deck.note && noteGroup === title ? <Text color={INK.route} wrap="wrap">{deck.note.text}</Text> : null}
      </Box>, { width })), 38)}
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

/** A one-row divider over a log: its name in bold, then a rule to the edge. */
function logRule(els: Els, view: View, title: string) {
  const { Text } = els;
  return (
    <Text wrap="truncate">
      <Text bold color={INK.dim}>{title}</Text>
      <Text color={INK.faint}>{` ${"─".repeat(Math.max(1, view.width - displayWidth(title) - 1))}`}</Text>
    </Text>
  );
}

/** The live log: who speaks, then every observable event, newest last. */
function liveView(els: Els, view: View, act: Actions, rows: number) {
  const { Box, Text, Button } = els;
  const empty = text("ui.live.emptyFeed", view.locale);
  if (view.fixed && view.flowDetails) {
    const top = <Box marginBottom={1}><Button key="flow-details" label={text("ui.flow.backToLive", view.locale)} hotkey="b" onPress={() => act.flowDetails(false)} /></Box>;
    const flow = runFlow(els, view);
    const topRows = Math.min(rowsOf(top, view.width), Math.max(1, rows - 3));
    const room = Math.max(1, rows - topRows);
    const max = Math.max(0, rowsOf(flow, view.width) - room + 1);
    const offset = Math.min(view.scroll, max);
    act.layout(max, false);
    return <Box flexDirection="column" height={rows} overflow="hidden">
      <Box flexDirection="column" height={topRows} overflow="hidden" flexShrink={0}>{top}</Box>
      <Box flexDirection="column" height={room - (max ? 1 : 0)} overflow="hidden" flexShrink={0}>
        <Box flexDirection="column" marginTop={-offset} flexShrink={0}>{flow}</Box>
      </Box>
      {max ? <Text color={INK.dim} wrap="truncate">{text("ui.scroll.footer", view.locale, { up: offset ? "▲" : " ", down: offset < max ? "▼" : " ", percent: formatNumber(100 * offset / max, view.locale) })}</Text> : null}
    </Box>;
  }
  const head = (
    <Box flexDirection="column" rowGap={1}>
      {view.flowDetails ? <Box flexDirection="column" rowGap={1}>{liveTop(els, view, act)}{runFlow(els, view)}</Box> : grid(els, view.width, [
        (width) => <Box width={width} flexShrink={0}>{liveTop(els, { ...view, width }, act)}</Box>,
        (width) => <Box width={width} flexShrink={0}>{runFlow(els, { ...view, width })}</Box>,
      ], 48)}
      {logRule(els, view, text("ui.live.title", view.locale))}
    </Box>
  );
  if (!view.fixed) return <Box flexDirection="column" rowGap={1}>{head}{conversation(els, view, view.feed, empty)}</Box>;
  const { back, max } = feedBack("live", view, view.feed);
  act.layout(max, true);
  const headRows = Math.min(rowsOf(head, view.width), Math.max(2, rows - 4));
  return <Box flexDirection="column" height={rows} overflow="hidden">
    <Box flexDirection="column" height={headRows} overflow="hidden" flexShrink={0}>{head}</Box>
    {stuckLog(els, view, view.feed, Math.max(1, rows - headRows), empty, back)}
  </Box>;
}

/** Jev calls observed in this session; token counts stay unknown when a response did not report them. */
function jevTally(trace: TraceState, events: readonly RouteEvent[]) {
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
 * The Live tab's fixed top: a row of pills (Jev and its state, the main model, each subagent at work in its
 * mascot's color), what Claude is doing now, the session's Jev tally, and the switch to the full run details.
 */
function liveTop(els: Els, view: View, act: Actions) {
  const { Box, Text, Button } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const running = view.agents.filter((run) => run.state === "running");
  const mood = MOODS[moodOf(view)];
  const now = view.live;
  const tally = jevTally(view.trace, view.events);
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" marginBottom={1}>
        <Button key="flow-details" label={text(view.flowDetails ? "ui.flow.backToLive" : "ui.flow.details", view.locale)} hotkey={view.flowDetails ? "b" : "f"} onPress={() => act.flowDetails(!view.flowDetails)} />
      </Box>
      <Text wrap="wrap">
        {pill(els, `${mood.face} ${text("ui.live.jev", view.locale)}`, hex(mood.color))}
        <Text color={now.asking ? INK.route : INK.dim}>{` ${now.asking ? text("ui.live.asking", view.locale) : state.title}  `}</Text>
        {pill(els, `◆ ${modelName(now.model)}${now.effort ? ` · ${now.effort}` : ""}`, css(HUE.claude))}
        {running.map((run) => {
          const mascot = mascotOf(run);
          return (
            <Text>
              <Text> </Text>
              {pill(els, `◆ ${mascot ? mascot.name : text("ui.live.subagent", view.locale)}`, mascot ? hex(mascot.color) : css(HUE.ok))}
            </Text>
          );
        })}
      </Text>
      <Text wrap="truncate" bold={Boolean(now.activity)} color={now.activity ? INK.ink : INK.faint}>{now.activity ? `${GLYPH.run} ${now.activity}` : text("ui.live.nowIdle", view.locale)}</Text>
      <Text wrap="truncate" color={INK.dim}>
        {text("ui.live.session", view.locale, {
          calls: formatNumber(tally.calls, view.locale),
          tokens: tally.tokens === undefined ? "–" : formatCompact(tally.tokens, view.locale),
          latency: tally.latency === undefined ? "" : text("ui.live.sessionLatency", view.locale, { value: formatNumber(tally.latency, view.locale) }),
        })}
      </Text>
      {tally.reported < tally.calls ? <Text color={INK.faint} wrap="truncate">{text("ui.live.sessionTokensPartial", view.locale, { reported: formatNumber(tally.reported, view.locale), total: formatNumber(tally.calls, view.locale) })}</Text> : null}
      {tally.retained ? <Text color={INK.faint} wrap="truncate">{text("ui.live.sessionRetained", view.locale)}</Text> : null}
      {running.length ? <Text color={INK.route} wrap="wrap">{text("ui.live.runningAgents", view.locale, { count: formatNumber(running.length, view.locale), unit: text(running.length === 1 ? "unit.agent" : "unit.agents", view.locale) })}</Text> : null}
    </Box>
  );
}

const AGENT_STATE: Record<AgentState, [label: LocaleKey, glyph: string, color: string]> = {
  running: ["ui.agents.state.running", GLYPH.on, INK.route],
  done: ["ui.agents.state.done", GLYPH.ok, INK.dim],
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

/** "◆ Tetra  Explore #3": the mascot's name on its color, then the type and number. */
function agentName(els: Els, run: AgentRun, locale: Locale) {
  const { Text } = els;
  const mascot = mascotOf(run);
  return (
    <Text>
      {mascot ? pill(els, `◆ ${mascot.name}`, hex(mascot.color)) : <Text bold color={INK.ink}>◆</Text>}
      <Text bold color={INK.ink}>{`  ${text("ui.agent.number", locale, { type: run.type, number: formatNumber(run.n, locale) })}`}</Text>
    </Text>
  );
}

/** A subagent's state as a word in its color, and how long it has run. */
function agentState(els: Els, view: View, run: AgentRun) {
  const { Text } = els;
  const [stateKey, glyph, color] = AGENT_STATE[run.state];
  return (
    <Text wrap="truncate">
      <Text bold color={color}>{`${glyph} ${text(stateKey, view.locale)}`}</Text>
      <Text color={INK.dim}>{` · ${formatDuration((run.endedAt ?? view.now) - run.startedAt, view.locale)}`}</Text>
    </Text>
  );
}

/** A subagent's accent: its mascot's color while it runs, red after an error, the rule color once it has ended. */
function agentAccent(run: AgentRun): string {
  const mascot = mascotOf(run);
  return run.state === "running" ? (mascot ? hex(mascot.color) : INK.route) : run.state === "error" ? INK.fail : INK.border;
}

/** "Explore #3", the title of a subagent's section. */
const agentTitle = (run: AgentRun, locale: Locale) => text("ui.agent.number", locale, { type: run.type, number: formatNumber(run.n, locale) });

/** One subagent as a section `width` wide, its rule in its mascot's color while it runs: who, state, task, figures. */
function agentCard(els: Els, view: View, act: Actions, run: AgentRun, width: number) {
  const { Box, Text, Button } = els;
  const mascot = mascotOf(run);
  const lineWidth = Math.max(1, width - INDENT);
  return card(els, agentTitle(run, view.locale), [
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {mascot ? <Text>{pill(els, `◆ ${mascot.name}`, hex(mascot.color))}</Text> : null}
      {agentState(els, view, run)}
    </Box>,
    <Text bold color={INK.ink} wrap="truncate">{oneLine(run.description, lineWidth)}</Text>,
    <Text color={INK.dim} wrap="truncate">{oneLine(`${agentModel(run, view.locale)} · ${agentNumbers(run, view.locale)}`, lineWidth)}</Text>,
    <Text color={run.state === "running" ? INK.ink : INK.dim} wrap="wrap">
      {oneLine(run.state === "running" ? `${GLYPH.run} ${run.activity ?? text("ui.agent.running", view.locale)}` : run.text ? `“${run.text}”` : text("ui.agent.noResponse", view.locale), lineWidth)}
    </Text>,
    <Box flexDirection="row" columnGap={1} flexWrap="wrap">
      <Button key={`agent-open-${run.n}`} label={text("ui.agent.liveOpen", view.locale, { number: formatNumber(run.n, view.locale) })} onPress={() => act.openAgent(run.n)} />
    </Box>,
  ], { width, rule: agentAccent(run), ...(run.state === "running" && mascot ? { color: hex(mascot.color) } : {}) });
}

/** The Agents screen: every subagent Claude started as a card, running ones first, two to a row where they fit. */
function agentsView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button } = els;
  const list = [...view.agents].sort((a, b) => Number(b.state === "running") - Number(a.state === "running") || b.n - a.n);
  const running = list.filter((run) => run.state === "running").length;
  const finished = list.length - running;
  const shown = list.slice(0, view.width >= 70 ? 6 : 4);
  const hidden = list.length - shown.length;
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {section(els, text("ui.agents.title", view.locale))}
        {running ? <Text color={INK.route}>{text("ui.live.runningAgents", view.locale, { count: formatNumber(running, view.locale), unit: text(running === 1 ? "unit.agent" : "unit.agents", view.locale) })}</Text> : null}
        {finished ? <Button key="agents-clear" label={text("ui.agents.clearFinished", view.locale, { count: formatNumber(finished, view.locale) })} hotkey="l" onPress={() => act.clearAgents()} /> : null}
      </Box>
      {list.length === 0 ? (
        emptyLine(els, text("ui.agents.emptyDescription", view.locale))
      ) : (
        grid(els, view.width, shown.map((run) => (width: number) => agentCard(els, view, act, run, width)), 36, 3)
      )}
      {hidden ? <Text color={INK.faint} wrap="truncate">{text("ui.agents.more", view.locale, { hidden: formatNumber(hidden, view.locale) })}</Text> : null}
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
  const lines: FeedEntry[] = view.feed.filter((entry) => entry.agent === run.id);
  const modelSteps = view.trace.runs.flatMap((entry) => entry.steps).filter((step) => step.agentId === run.id).slice(-6);
  // Its answer closes the log, in full, once it has ended.
  if (run.state !== "running" && run.text) {
    lines.push({ seq: -1, time: run.endedAt ?? view.now, who: "agent", agent: run.id, mascot: run.mascot, kind: "agent", tone: "info", text: text("ui.agent.result", view.locale, { text: run.text }) });
  }
  // the top is a section ruled in the mascot’s color: who it is, its state, its task and its figures
  const top = (
    <Box flexDirection="column" flexShrink={0}>
      {card(els, agentTitle(run, view.locale), [
        <Text wrap="truncate">{agentName(els, run, view.locale)}</Text>,
        agentState(els, view, run),
        <Text bold color={INK.ink} wrap="truncate-end">{run.description}</Text>,
        <Text color={INK.dim} wrap="truncate-end">{agentModel(run, view.locale)}</Text>,
        <Text color={INK.faint} wrap="truncate-end">{agentNumbers(run, view.locale)}</Text>,
        run.state === "running" ? (
          <Text wrap="truncate-end">
            <Text color={INK.faint}>{text("ui.agent.now", view.locale)} </Text>
            <Text bold color={INK.ink}>{run.activity ?? text("ui.agent.running", view.locale)}</Text>
          </Text>
        ) : null,
        buttons,
      ], { width: view.width, rule: agentAccent(run) })}
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
      {logRule(els, view, text("ui.live.title", view.locale))}
      {stuckLog(els, view, lines, logRows, empty, back, task)}
    </Box>
  );
}

/**
 * The latest run as Live shows it. On a fixed terminal pane it is a card: the run's sequence as a chain of nodes,
 * its latest details and its timing. Opened in full (or on the desktop), it is the whole drawn run and its history.
 */
function runFlow(els: Els, view: View) {
  const { Box, Text } = els;
  const run = view.trace.runs.find((candidate) => candidate.id === view.trace.active) ?? view.trace.runs.at(-1);
  const timing = run ? runTiming(run, view.now) : undefined;
  const scene = flowScene(view.trace, view.now, view.locale);
  const compact = view.surface === "terminal" && !view.flowDetails && scene.nodes.length > 0;
  const times = timing ? [
    <Text color={INK.ink} wrap="wrap">{text("ui.flow.timing.main", view.locale, { duration: timing.mainResponseMs === undefined ? text("ui.flow.timing.pending", view.locale) : formatDuration(timing.mainResponseMs, view.locale) })}</Text>,
    <Text color={INK.dim} wrap="wrap">{text("ui.flow.timing.total", view.locale, { duration: formatDuration(timing.totalMs, view.locale), state: text(timing.complete ? "ui.flow.timing.complete" : "ui.flow.timing.active", view.locale) })}</Text>,
  ] : [];
  if (compact) {
    const details = [
      ...(scene.nodes.find((node) => node.id === "message")?.details ?? []),
      ...(scene.nodes.find((node) => node.id === "tools")?.details ?? []),
      ...(scene.nodes.find((node) => node.id === "agents")?.details.slice(-2) ?? []),
      ...(scene.nodes.find((node) => node.id === "answer")?.details ?? []),
    ];
    return card(els, text("ui.flow.sequence", view.locale), [
      <Text wrap="wrap">
        {scene.nodes.map((node, index) => (
          <Text>
            {index ? <Text color={INK.faint}>{" → "}</Text> : null}
            <Text color={node.color} bold>{`${node.glyph} ${node.label}`}</Text>
          </Text>
        ))}
      </Text>,
      ...details.map((detail) => <Text color={detail.color} wrap="wrap">{detail.text}</Text>),
      ...times,
    ], { width: view.width });
  }
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
      {times.length ? (
        <Box flexDirection="column" marginTop={1}>
          {times}
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

/**
 * The Models screen reports recorded requests and responses, without predicting later choices: the main model
 * now as a card, the latest run's requests one row each (a change of model marked in yellow), and Jev's usage.
 */
function modelsView(els: Els, view: View) {
  const { Box, Text } = els;
  const run = view.trace.runs.find((candidate) => candidate.id === view.trace.active) ?? view.trace.runs.at(-1);
  const steps = run?.steps.filter((step) => !step.agentId) ?? [];
  const jevGroups = jevUsageGroups(view.trace).slice(-2);
  const shown = steps.slice(-5);
  return (
    <Box flexDirection="column" rowGap={1}>
      {grid(els, view.width, [
        (width) => card(els, text("ui.models.now", view.locale), <Text wrap="truncate">{pill(els, `◆ ${modelName(view.live.model)}`, css(HUE.claude))}{view.live.effort ? <Text color={INK.ink}>{` ${text("ui.models.effort", view.locale, { effort: view.live.effort })}`}</Text> : null}</Text>, { color: INK.claude, width }),
        (width) => card(els, text("ui.models.jevUsage", view.locale), jevGroups.length
          ? jevGroups.map((group) => {
              const counters = (["input", "output", "cacheRead", "cacheWrite"] as const).filter((counter) => group.sums[counter] !== undefined).map((counter) => jevCounterText(group, counter, view.locale));
              return <Box flexDirection="column"><Text bold color={INK.ink} wrap="truncate">{text(group.observed ? "ui.models.jevObserved" : "ui.models.jevRequested", view.locale, { model: modelName(group.model), calls: formatNumber(group.calls, view.locale) })}</Text><Text color={INK.dim} wrap="truncate">{counters.join(" · ") || text("ui.models.jevNoUsage", view.locale)}</Text></Box>;
            })
          : <Text color={INK.faint} wrap="wrap">{text("ui.models.jevNoUsage", view.locale)}</Text>, { width }),
      ], 40)}
      {card(els, text("ui.models.requests", view.locale), shown.length
        ? shown.map((step) => {
            const model = step.observed && step.observed !== step.sent
              ? `${modelName(step.sent)} → ${modelName(step.observed)}`
              : modelName(step.observed ?? step.sent);
            const elapsed = step.endedAt === undefined ? text("ui.models.inProgress", view.locale) : formatDuration(step.endedAt - step.startedAt, view.locale);
            return <Text color={INK.ink} wrap="truncate">{`${clock(step.startedAt, view.locale)} · ${model}${step.effort ? ` · ${step.effort}` : ""} · ${elapsed} · ${stepUsage(step.usage, view.locale)}`}</Text>;
          })
        : <Text color={INK.faint} wrap="truncate">{text("ui.models.empty", view.locale)}</Text>, {
          width: view.width,
          note: text("ui.models.recent", view.locale, { shown: formatNumber(shown.length, view.locale), total: formatNumber(steps.length, view.locale) }),
        })}
    </Box>
  );
}

/**
 * The Jev pane: the header (Pingo and its speech bubble, then the screens) on top at every width, the open
 * screen's title, then the screen itself across the whole width. Every screen is drawn and measured at the width
 * it really gets. On the terminal the pane is exactly its room tall: the header stays, and the screen below the
 * title moves by its own offset.
 */
export function renderPane(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const width = view.width;
  const inner: View = view;
  const top = (
    <Box flexDirection="column" rowGap={1}>
      {header(els, view, act)}
      {titleBar(els, inner)}
    </Box>
  );
  const fixed = view.fixed ? { height: view.rows, overflow: "hidden" as const } : {};
  const frame = (main: RenderChildren) => (
    <Box flexDirection="column" {...(view.fixed ? fixed : { rowGap: 1 })}>
      {main}
    </Box>
  );
  if (!view.fixed) return frame([top, tabBody(els, inner, act, view.rows)]);
  const rows = Math.max(4, view.rows - rowsOf(top, width));
  if (view.tab === "live") return frame([top, liveView(els, inner, act, rows)]);
  const body = <Box flexDirection="column" flexShrink={0}>{tabBody(els, inner, act, rows)}</Box>;
  const total = rowsOf(body, width);
  const max = Math.max(0, total - rows + 1);
  // Logs has its newest on top: scrolled down, it keeps to the requests it showed.
  const newest = view.events.at(-1)?.seq ?? 0;
  const offset =
    view.tab === "logs"
      ? anchored("log", view.scroll, newest, (since) => view.events.filter((event) => event.seq > since).reduce((s, event) => s + rowsOf(logEntry(els, { ...inner, width: width - 4 }, event), width - 4), 0), max)
      : Math.min(view.scroll, max);
  act.layout(view.tab === "logs" && max ? view.scroll + max - offset : max, false);
  const more = total - offset > rows - 1;
  return frame([
    top,
    <Box flexDirection="column" height={rows - (max ? 1 : 0)} overflow="hidden" flexShrink={0}>
      <Box flexDirection="column" flexShrink={0} marginTop={-offset}>
        {body}
      </Box>
    </Box>,
    max ? (
      <Text color={INK.faint} wrap="truncate">
        {text("ui.scroll.footer", view.locale, { up: offset > 0 ? "▲" : " ", down: more ? "▼" : " ", percent: formatNumber((100 * offset) / max, view.locale) })}
      </Text>
    ) : null,
  ]);
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
              : view.tab === "features"
                ? featuresView(els, view, act)
              : view.tab === "configuration"
                ? configurationView(els, view, act)
                : view.tab === "deck"
                  ? deckView(els, view, act)
                  : overview(els, view, act);
}

/**
 * Above the prompt: the Jev band, then the Deck band beneath it. A surface Deck does not draw
 * (neither the terminal nor the desktop) gets the Jev band alone.
 */
export function renderAbove(els: ElementTable, view: View, deck: DeckBand | null, surface: string) {
  const { Box } = els;
  if (!deck || (surface !== "terminal" && surface !== "desktop")) return renderBand(els, view);
  return (
    <Box flexDirection="column">
      {renderBand(els, view)}
      {renderDeck(els, deck, surface as Surface)}
    </Box>
  );
}

/**
 * Above the prompt, in the dashboard's language: Pingo's face and Jev's state in the mood's color with the last five
 * minutes beside it, then the main model, what Claude is doing, and the subagents at work in their mascots' colors.
 */
export function renderBand(els: ElementTable, view: View) {
  const { Box, Text } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const mood = moodOf(view);
  const moodInk = hex(MOODS[mood].color);
  const stats = recentStats(view);
  const now = view.live;
  const runningAgents = view.agents.filter((run) => run.state === "running");
  const running = runningAgents.length;
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text bold color={INK.brand}>⠿</Text>
        <Text bold color={moodInk}>{`${MOODS[mood].face} ${text("ui.live.jev", view.locale)}: ${view.live.asking ? text("ui.band.asking", view.locale) : state.title}`}</Text>
        <Text color={INK.border}>·</Text>
        <Text color={stats.failures > 0 ? INK.fail : INK.dim}>{`${stats.failures > 0 ? `${GLYPH.warn} ` : ""}${statsLine(stats, view.locale)}`}</Text>
        {statsPartial(stats, view.locale) ? <Text color={INK.faint}>{statsPartial(stats, view.locale)}</Text> : null}
      </Box>
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text color={INK.claude}>◆</Text>
        <Text color={INK.ink}>{`${modelName(now.model)}${now.effort ? ` · ${now.effort}` : ""}`}</Text>
        <Text color={INK.border}>·</Text>
        <Text color={now.activity ? INK.ink : INK.faint}>{now.activity ? `${GLYPH.run} ${now.activity}` : text("ui.band.idle", view.locale)}</Text>
        {running ? <Text color={INK.border}>·</Text> : null}
        {running
          ? runningAgents.map((run) => {
              const mascot = mascotOf(run);
              return <Text bold color={mascot ? hex(mascot.color) : INK.route}>◆</Text>;
            })
          : null}
        {running ? <Text color={INK.route}>{text("ui.band.runningCount", view.locale, { count: formatNumber(running, view.locale), agents: text(running === 1 ? "ui.band.running.agent" : "ui.band.running.agents", view.locale) })}</Text> : null}
      </Box>
    </Box>
  );
}
