// The Jev dashboard, drawn as a binder (DESIGN.md, Fichário): Pingo and what is going on at the top, the screens
// filed in three folders down a rail on the left, and the open screen as cards beside it: a rounded frame, a ■ and
// its label, the figures, a ▰▱ meter for a share. A narrow pane folds the rail into a few lines over the cards.
import type { ElementTable, RenderChildren, RenderNode } from "claude-code";

import type { AgentRun, AgentState, FeatureFlags, FeatureId, FeaturePreferences, FeedEntry, FeedTone, JevTab, LiveNow, QualityCycle, QualityItem, RouteEvent, SetupDraft, TraceState, TraceStep } from "../types";
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
import { trailLines } from "./trail.ts";
import { runTiming, traceConsults } from "./trace.ts";
import { formatAge, formatClock, formatCompact, formatDecimal, formatDuration, formatNumber, localeFor, reasonTitle, text, type Locale, type LocaleKey, type LocaleOption } from "./i18n.ts";
import { displayWidth, rowsOf } from "./layout.ts";
import { css, DECK_DESIGN, FEATURE_MASCOT_PALETTE, GLYPH, HUE, inkOn, meter, PAINT, UI_DESIGN, UI_INK as INK } from "./theme.ts";
import { MOODS, type Mood } from "./mascots/pingo.ts";
import { miniPingo } from "./mascots/pixel.ts";
import { AGENT_MASCOTS, isMascot, type MascotId } from "./mascots/agents.ts";
import { memberFrame } from "./deck/cast.ts";
import { renderDeck, type DeckBand, type Surface } from "./deck/band.tsx";
import { COLLAPSED, SECTIONS, SIZES, type DeckSettings } from "./deck/settings.ts";
import { DESKTOP_STYLE_NAMES, DESKTOP_STYLES } from "./deck/styles-desktop.ts";
import { CLAUDE_MODELS, defaultPolicy, MODEL_LABEL, PROFILE_EFFORTS, ROLES, type OrchestrationPolicy, type Profile, type Role, type WorkMode } from "./core/orchestration.ts";
import { EFFORT_TEXT_VALUES, MODEL_TEXT_VALUES } from "./core/contracts.ts";
import { TERMINAL_STYLE_NAMES, TERMINAL_STYLES } from "./deck/styles-terminal.ts";
import { COMANDANTE_ALL, COMANDANTE_DECISIONS, COMANDANTE_SOURCES, comandanteCounts, comandanteSessions, comandanteSourcesAll, filterComandante } from "./core/comandante.ts";
import type { ComandanteDecision, ComandanteFilter, ComandanteRecord, ComandanteSource } from "../types";

/** The pane needs Select and Input, which the terminal and the desktop app draw. */
export type Els = ElementTable<"terminal" | "desktop">;
/** What a card and a line need, which every site draws: a feature's pane and the band above the prompt too. */
type Frame = Pick<ElementTable, "Box" | "Text">;

/**
 * The thirteen screens in their three folders, in the order the rail lists them, with their keys (1 to 9, then 0, o,
 * q and d): what this session is doing, the work Pingo and the agents do, and the settings.
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
const AI_FEATURES: ReadonlySet<FeatureId> = new Set(["agents", "clareza", "lapida", "farol", "prisma", "semente", "vigia", "contexto", "codeQuality", "comandante"]);
/** Keys the AI screen's own buttons hold (routing, test, remove key): a feature sharing one is toggled without it. */
const AI_KEYS: ReadonlySet<string> = new Set(["r", "v", "f"]);

function toggleButton(els: Els, key: string, on: boolean, label: string, onPress: () => void, hotkey?: string) {
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
  /** The orchestration policy and what it is doing; made only on the AI tab. */
  orchestration?: OrchestrationView;
  /** Code Quality's cycles and what it is doing; made only on its own tab. */
  quality?: QualityPanel;
  /** The Comandante's log of every session of the project and its filters; made only on its own tab. */
  comandante?: ComandantePanel;
}

/** What the Comandante tab shows: the decisions of every session, newest first, the filters, and who this session is. */
export interface ComandantePanel {
  log: readonly ComandanteRecord[];
  filter: ComandanteFilter;
  /** This session's id, so its own decisions read "this session". */
  me: string;
  /** Waiting for Jev's verdict now. */
  busy: boolean;
}

/** What the Quality tab shows: whether a cycle runs now, the files changed since the last one began, the cycles. */
export interface QualityPanel {
  running: boolean;
  /** Edited since the last cycle began: the next one reviews them first. */
  queued: readonly string[];
  /** Newest first. */
  cycles: readonly QualityCycle[];
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
  /** Starts a Code Quality cycle now, over everything pending. */
  qualityRun: () => void;
  /** Changes the Comandante tab's filters: a session's id or "all", a decision or "all". */
  comandanteFilter: (change: Partial<ComandanteFilter>) => void;
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
function pill(els: Els, label: string, ground: string) {
  const { Text } = els;
  return <Text bold color={inkFor(ground)} backgroundColor={ground}>{` ${label} `}</Text>;
}

/** Columns a card's frame and air take from its width: the border and one column inside it on each side. */
const INDENT = UI_DESIGN.layout.indent;

/**
 * A card, the one part every screen is built of: a rounded frame, a ■ in its accent and its title in bold on the
 * first line, then its body. The title is alone in its Text, so a section can be found by its words. `rule` paints
 * the ■ (a mascot, a state), `color` the title, `glyph` replaces the ■; an alert draws "!" and turns the frame red.
 */
function card(els: Frame, title: string, body: RenderChildren, opts: { width: number; color?: string; rule?: string; note?: string; alert?: boolean; glyph?: string }) {
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
function stack(els: Els, cards: RenderChildren) {
  const { Box } = els;
  return <Box flexDirection="column">{cards}</Box>;
}

/** Columns between cards side by side. */
const GUTTER = UI_DESIGN.layout.gutter;

/** Cards side by side, as many to a row as `width` holds at `min` columns each (up to `maxColumns`), one otherwise. */
function grid(els: Els, width: number, cards: readonly ((width: number) => RenderChildren)[], min: number = UI_DESIGN.layout.gridMinWidth, maxColumns: number = UI_DESIGN.layout.gridMaxColumns) {
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
function railColumns(locale: Locale): number {
  const longest = Math.max(...TABS.flat().map(([, label]) => displayWidth(text(label as LocaleKey, locale))));
  return Math.max(UI_DESIGN.layout.rail.minColumns, longest + 3 + HOTKEY_COLUMNS);
}

/** The rail down the left: each folder's name, faint and in capitals, then its screens, a blank row between folders. */
function rail(els: Els, view: View, act: Actions, columns: number) {
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
function foldedRail(els: Els, view: View, act: Actions) {
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
function railed(view: View): boolean {
  return view.width >= UI_DESIGN.layout.rail.minPaneWidth && !(view.fixed && view.rows < UI_DESIGN.layout.rail.minRows);
}

/** Jev's on/off switch, on the AI screen. */
function routingButton(els: Els, view: View, act: Actions) {
  const { Button } = els;
  return <Button key="routing" plain label={text(view.routing ? "ui.header.turnOff" : "ui.header.turnOn", view.locale)} hotkey="r" onPress={() => act.routing(!view.routing)} />;
}

/**
 * The top of the pane at every width: Pingo, then "jev" on the brand's ground and the state in bold, and under them,
 * in plain words, what is going on and the last five minutes. A short terminal pane keeps the first line only, with
 * Pingo's face.
 */
function header(els: Els, view: View) {
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
function titleBar(els: Els, view: View) {
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
 * A group of figures, `width` columns wide: the label, the value in bold, and its note, in aligned columns with room
 * between them. A figure that flags a failure is red and marked "!". A label too long for its column wraps there
 * rather than being cut; a note too narrow beside them goes under.
 */
function figures(els: Els, group: readonly Tile[], width: number) {
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
function outcomeBar(els: Els, events: readonly RouteEvent[], width: number, locale: Locale) {
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
 * The selected range at a glance. The range picker leads, since it scopes every figure; the header keeps its own
 * last five minutes. The status sentence shows only when it says more than the header does. Then the cards:
 * Routing and Jev's answers side by side, Token usage and the Timeline across the width under them.
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
      <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
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
      <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
        {head}
        {emptyLine(els, text("ui.overview.empty", view.locale))}
      </Box>
    );
  }
  const alertOf = (group: readonly Tile[]) => group.some((tile) => tile.alert);
  // Routing and Jev's answers side by side where they fit; usage and the timeline across the whole width under them.
  const pair: ((width: number) => RenderChildren)[] = [];
  if (events.length) {
    pair.push((width) => card(els, text("ui.overview.routing", view.locale), [outcomeBar(els, events, width - INDENT, view.locale), figures(els, group("routing"), width - INDENT)], { width, alert: alertOf(group("routing")) }));
  }
  if (group("jev").length) pair.push((width) => card(els, text("ui.overview.jev", view.locale), figures(els, group("jev"), width - INDENT), { width, alert: alertOf(group("jev")) }));
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      {head}
      {stack(els, [
        pair.length ? grid(els, view.width, pair) : null,
        group("tokens").length ? card(els, text("ui.overview.tokens", view.locale), figures(els, group("tokens"), view.width - INDENT), { width: view.width, alert: alertOf(group("tokens")) }) : null,
        events.length ? card(els, text("ui.overview.timeline", view.locale), sparkline(els, view, events, view.width - INDENT), { width: view.width }) : null,
      ])}
    </Box>
  );
}

/** AI calls the Logs screen lists, newest first. */
const CALLS_SHOWN = 20;
/** Entries the Live log and the Logs request log draw at most; older ones stay in the kept history. */
export const ENTRIES_SHOWN = 50;

/** The newest `ENTRIES_SHOWN` entries of a log, newest first: what Live and Logs draw, a new one pushing the oldest out. */
function newestFirst<T>(list: readonly T[]): T[] {
  return list.slice(-ENTRIES_SHOWN).reverse();
}

/** The latest Jev call in the live log (its line, rewritten when the call ends), if one is still kept. */
function lastJevCall(feed: readonly FeedEntry[]): FeedEntry | undefined {
  return feed.findLast((entry) => entry.who === "jev" && entry.kind === "call");
}

/**
 * What the Live log draws: the latest Jev call pinned on top, so newer lines never push it out, then the newest
 * other lines, newest first, `ENTRIES_SHOWN` in all.
 */
function liveLines(feed: readonly FeedEntry[]): { pinned: FeedEntry | undefined; lines: FeedEntry[] } {
  const pinned = lastJevCall(feed);
  if (!pinned) return { pinned, lines: newestFirst(feed) };
  return { pinned, lines: newestFirst(feed.filter((entry) => entry.seq !== pinned.seq)).slice(0, ENTRIES_SHOWN - 1) };
}

/** Rows the entries newer than `since` take at the top of a newest-first log, as drawn at `width`. */
function rowsAbove<T extends { seq: number }>(shown: readonly T[], since: number, draw: (entry: T) => RenderChildren, width: number): number {
  return shown.filter((entry) => entry.seq > since).reduce((sum, entry) => sum + rowsOf(draw(entry), width), 0);
}

/**
 * The Logs screen: a card of reason groups, each with a meter for its share of the largest, then the request
 * log itself, its newest `ENTRIES_SHOWN` newest first, one line per request with its outcome's glyph in its color,
 * then the latest AI calls.
 */
function logView(els: Els, view: View) {
  const { Box, Text } = els;
  const grouped = reasons(view.events, view.locale);
  const unhandled = view.events.filter((event) => !routed(event)).length;
  const colorFor = (who: string) => (who === text("reason.who.failed", view.locale) ? INK.fail : who === text("reason.who.asked", view.locale) ? INK.pass : INK.dim);
  const most = Math.max(1, ...grouped.map((reason) => reason.count));
  const reasonsShown = grouped.slice(0, 6);
  const rows = newestFirst(view.events);
  // Every AI call (Jev's and the features' own) as Live wrote it, newest first: the same lines, not a second record.
  const calls = view.feed.filter((entry) => entry.kind === "call");
  const shownCalls = calls.slice(-CALLS_SHOWN).reverse();
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      {card(
        els,
        text("ui.log.reasons", view.locale),
        grouped.length === 0
          ? <Text color={INK.faint}>{text("ui.log.noReasons", view.locale)}</Text>
          : grid(els, view.width - 4, reasonsShown.map((reason) => (reasonWidth) => {
                const [filled, empty] = meter(reason.count / most, Math.max(6, reasonWidth - 2));
                return (
                  <Box flexDirection="column" width={reasonWidth} flexShrink={0}>
                    <Text bold color={colorFor(reason.who)} wrap="wrap">{`${reasonTitle(reason.name, view.locale)} · ${int(reason.count, view.locale)} · ${pct(reason.count, unhandled, view.locale)}`}</Text>
                    <Text wrap="truncate">
                      <Text color={colorFor(reason.who)}>{filled}</Text>
                      <Text color={INK.border}>{empty}</Text>
                    </Text>
                  </Box>
                );
              }), 28),
        { width: view.width, note: grouped.length > reasonsShown.length ? text("ui.log.moreReasons", view.locale, { hidden: formatNumber(grouped.length - reasonsShown.length, view.locale) }) : undefined },
      )}
      {card(els, text("ui.log.title", view.locale), rows.length ? rows.map((event) => logEntry(els, { ...view, width: view.width - 4 }, event)) : <Text color={INK.dim}>{text("ui.log.empty", view.locale)}</Text>, {
        width: view.width,
        note: text("ui.log.recent", view.locale, { shown: formatNumber(rows.length, view.locale), total: formatNumber(view.events.length, view.locale) }),
      })}
      {card(els, text("ui.log.calls", view.locale), conversation(els, { ...view, width: view.width - 4 }, shownCalls, text("ui.log.noCalls", view.locale)), {
        width: view.width,
        note: text("ui.log.recent", view.locale, { shown: formatNumber(shownCalls.length, view.locale), total: formatNumber(calls.length, view.locale) }),
      })}
    </Box>
  );
}

/**
 * One request of the log, in two columns: its time, then what happened (its outcome's glyph in its color) and how
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
          <Text bold color={hex(color)}>{glyph}</Text>
          <Text bold color={INK.ink}>{` ${what}`}</Text>
          <Text color={INK.dim}>{text("ui.log.duration", view.locale, { value: formatDecimal(event.durationMs / 1000, view.locale, 1) + text("format.seconds", view.locale, { value: "" }) })}</Text>
        </Text>
        {figures ? <Text color={INK.faint} wrap="wrap">{figures}</Text> : null}
        {event.reason ? <Text color={kind === "failed" ? INK.fail : INK.dim} wrap="wrap">{text("ui.log.reason", view.locale, { reason: reasonDetail })}</Text> : null}
        {kind === "failed" && event.error ? <Text color={INK.fail} wrap="wrap">{text("ui.log.cause", view.locale, { cause: event.error })}</Text> : null}
        {kind === "failed" ? <Text color={INK.pass} wrap="wrap">{text("ui.log.hint", view.locale, { hint: failureHint(failureKind(event.error ?? "", event.reason), view.locale) })}</Text> : null}
        {kind === "failed"
          ? (event.jevRaw ?? []).map((raw, index, all) => (
              <Box flexDirection="column" borderStyle="round" borderColor={INK.fail} paddingX={UI_DESIGN.space.xs}>
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

/** One step of the setup: a ✓ once done or a hollow dot, its number and label, and what is set there. */
function step(els: Els, n: number, label: string, done: boolean, body: RenderChildren) {
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

/** Feature switches and the preferences that control their behavior, except the AI screen's. */
function featuresView(els: Els, view: View, act: Actions) {
  return featurePanel(els, view, act, false);
}

/** Feature switches and their preferences: the AI screen's (`ai`) or the Features screen's, never both. */
function featurePanel(els: Els, view: View, act: Actions, ai: boolean) {
  const { Box, Text, Select } = els;
  const state = `${GLYPH.check} ${text("ui.configuration.enabledValue", view.locale)}  ${GLYPH.off} ${text("ui.configuration.disabledValue", view.locale)}`;
  const preferenceToggle = (key: keyof FeaturePreferences, label: string, on: boolean) => () =>
    toggleButton(els, key, on, label, () => act.preference(key, !on));
  const locale = view.locale;
  const preferences = view.preferences;
  const featuresList = features(locale).filter((feature) => AI_FEATURES.has(feature.id) === ai).map((feature) => (cellWidth: number) => {
    const on = view.features[feature.id];
    const name = feature.id === "agents" ? text("ui.features.agentsShort", locale) : feature.name;
    return (
      <Box flexDirection="column" width={cellWidth} flexShrink={0}>
        {toggleButton(els, "feature-" + feature.id, on, name, () => act.feature(feature.id, !on), ai && AI_KEYS.has(feature.hotkey) ? undefined : feature.hotkey)}
        <Text key={`feature-${feature.id}-description`} color={INK.dim} wrap="wrap">{feature.description}</Text>
      </Box>
    );
  });
  const scope = () => <Select key="assumption-scope" label={text("ui.features.scope", locale)} value={preferences.assumptionScope} options={[
    { value: "all", label: text("ui.features.scopeAll", locale) },
    { value: "important", label: text("ui.features.scopeImportant", locale) },
  ]} onSelect={(value) => act.preference("assumptionScope", value as FeaturePreferences["assumptionScope"])} />;
  const style = () => <Select key="plain-level" label={text("ui.features.style", locale)} value={preferences.plainLevel} options={[
    { value: "beginner", label: text("ui.features.beginner", locale) },
    { value: "expert", label: text("ui.features.expert", locale) },
  ]} onSelect={(value) => act.preference("plainLevel", value as FeaturePreferences["plainLevel"])} />;
  const hat = () => <Select key="pet-hat" label={text("ui.features.hat", locale)} value={preferences.petHat} options={[
    { value: "random", label: text("ui.features.randomHat", locale) },
    ...["tophat", "party", "crown", "wizard", "cowboy", "propeller", "chef", "viking", "halo", "santa", "nightcap"].map((hat) => ({ value: hat, label: text(`deck.pet.hat.${hat}` as LocaleKey, locale) })),
  ]} onSelect={(value) => act.preference("petHat", String(value))} />;
  const surface = () => <Select key="design-surface" label={text("ui.features.surface", locale)} value={preferences.designSurface} options={[
    { value: "auto", label: text("ui.configuration.surfaceAuto", locale) },
    { value: "pane", label: text("ui.configuration.surfacePane", locale) },
    { value: "browser", label: text("ui.configuration.surfaceBrowser", locale) },
  ]} onSelect={(value) => act.preference("designSurface", value as FeaturePreferences["designSurface"])} />;
  const monitor = () => <Select key="monitor-interval" label={text("ui.features.monitor", locale)} value={String(preferences.monitorEveryMs)} options={[2000, 5000, 10000].map((ms) => ({ value: String(ms), label: `${ms / 1000}s` }))} onSelect={(value) => act.preference("monitorEveryMs", Number(value) as FeaturePreferences["monitorEveryMs"])} />;
  const clash = () => <Select key="clash-window" label={text("ui.features.clashWindow", locale)} value={String(preferences.clashMinutes)} options={[15, 30, 60].map((minutes) => ({ value: String(minutes), label: `${minutes} min` }))} onSelect={(value) => act.preference("clashMinutes", Number(value) as FeaturePreferences["clashMinutes"])} />;
  // What is sent to the model (Farol's scope, Clareza's level and review, Prisma, Semente, Lapida, Vigia's summary)
  // goes with the AI screen; sound, mascot and monitoring stay on Features.
  const preferenceGroups: [LocaleKey, readonly (() => RenderChildren)[]][] = ai ? [
    ["ui.features.replyGroup", [
      scope,
      style,
      preferenceToggle("plainReview", text("ui.features.answerReview", locale), preferences.plainReview),
    ]],
    ["ui.features.workflowGroup", [
      surface,
      preferenceToggle("ideaNudges", text("ui.features.ideaNudges", locale), preferences.ideaNudges),
      preferenceToggle("promptLearning", text("ui.features.promptLearning", locale), preferences.promptLearning),
      preferenceToggle("trackerSummary", text("ui.features.trackerSummary", locale), preferences.trackerSummary),
    ]],
  ] : [
    ["ui.features.replyGroup", [preferenceToggle("plainSound", text("ui.features.completionSound", locale), preferences.plainSound)]],
    ["ui.features.mascotGroup", [hat, preferenceToggle("petShades", text("ui.features.petShades", locale), preferences.petShades)]],
    ["ui.features.monitorGroup", [monitor, clash]],
  ];
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs} width={view.width}>
      {card(els, text("ui.configuration.features", locale), grid(els, view.width - 4, featuresList, 32), { width: view.width, note: `${state} · ${text("ui.features.clickToChange", locale)}` })}
      {section(els, text("ui.features.preferencesTitle", locale))}
      {stack(els, preferenceGroups.map(([title, controls]) => card(els, text(title, locale), <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>{controls.map((make) => make())}</Box>, { width: view.width })))}
    </Box>
  );
}

/** The language and history controls; the provider and its key are on the AI screen. */
function configurationView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button, Select } = els;
  const cardWidth = view.width >= UI_DESIGN.layout.configurationTwoColumnMinWidth ? Math.floor((view.width - GUTTER) / 2) : view.width;
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={GUTTER} rowGap={UI_DESIGN.space.xs}>
        {card(els, text("ui.configuration.interface", view.locale), [
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
        ], { width: cardWidth })}
        {card(els, text("ui.configuration.history", view.locale), [
          <Text color={INK.faint} wrap="truncate">{view.meta}</Text>,
          <Box flexDirection="row">
            <Button key="clear" label={`${text("ui.setup.clearHistory", view.locale)} (c)`} hotkey="c" onPress={() => act.clear()} />
          </Box>,
        ], { width: cardWidth })}
      </Box>
    </Box>
  );
}

/** Jev's provider, its key and the connection test. */
function providerCard(els: Els, view: View, act: Actions) {
  const { Box, Text, Button, Select, Input } = els;
  const chosen = PROVIDER_IDS.includes(view.setup.provider as never) ? view.setup.provider : PROVIDER_IDS.includes(view.key.provider as never) ? view.key.provider : "typesafe";
  const info = PROVIDERS[chosen as keyof typeof PROVIDERS];
  const saved = view.key.source !== "none";
  const typed = view.setup.typed ?? "";
  const message = view.setup.message;
  const connected = view.setup.isOk && Boolean(message) && !view.setup.busy;
  return card(
    els,
    text("ui.configuration.provider", view.locale),
    [
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
          <Box flexDirection="row" columnGap={UI_DESIGN.space.sm} flexWrap="wrap">
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
      <Box marginTop={UI_DESIGN.space.xs}>
        <Text color={INK.pass} wrap="wrap">{text("ui.setup.privacy", view.locale)}</Text>
      </Box>,
    ],
    { width: view.width, ...(connected ? { rule: INK.route } : {}) },
  );
}

/**
 * The AI screen: everything that changes which model runs, how it runs or what is sent to it. Jev's switch and
 * provider, then the features and preferences that reach the model; orchestration has its own tab.
 */
function aiView(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      <Box flexDirection="column">
        <Text color={INK.dim} wrap="wrap">{text("ui.setup.intro", view.locale)}</Text>
        {!view.routing ? <Text color={INK.pass} wrap="wrap">{text("ui.configuration.routingOff", view.locale)}</Text> : null}
        <Box flexDirection="row">{routingButton(els, view, act)}</Box>
      </Box>
      {providerCard(els, view, act)}
      {featurePanel(els, view, act, true)}
    </Box>
  );
}

/** The Orchestration screen: the orchestration card as it was on the AI screen; a fresh policy until the store is read. */
function orchestrationView(els: Els, view: View, act: Actions) {
  return orchestrationCard(els, view, view.orchestration ?? { policy: defaultPolicy(), draft: "", batches: [] }, act);
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
        <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
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
        <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
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

/** The advisor switch cycles AUTO → always on → off → AUTO. */
const ADVICE_NEXT = { auto: "on", on: "off", off: "auto" } as const;

/** The AI tab's orchestration card: roles, switches, limits, the live objective and batches. */
function orchestrationCard(els: Els, view: View, orch: OrchestrationView, act: Actions) {
  const { Box, Text, Button, Select, Input } = els;
  const locale = view.locale;
  const policy = orch.policy;
  const toggle = (on: boolean, label: string, line: string, key: string) => toggleButton(els, key, on, label, () => act.orchestration(line));
  const objective = orch.objective;
  const limits = policy.limits;
  const nativeValue = policy.nativeAdvisor.mode === "fixed" ? policy.nativeAdvisor.model : policy.nativeAdvisor.mode;
  return card(els, text("ui.orch.title", locale), [
    <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm} key="orch-switches">
      {toggle(policy.enabled, text(policy.enabled ? "ui.orch.on" : "ui.orch.off", locale), policy.enabled ? "off" : "on", "orch-enabled")}
      {toggle(policy.review, text("ui.orch.review", locale), policy.review ? "review off" : "review on", "orch-review")}
      {toggle(policy.advice !== "off", text(`ui.orch.advice.${policy.advice}`, locale), `advice ${ADVICE_NEXT[policy.advice]}`, "orch-advice")}
      {toggle(policy.batch === "auto", text("ui.orch.batch", locale), policy.batch === "auto" ? "batch off" : "batch auto", "orch-batch")}
    </Box>,
    <Text color={INK.faint} wrap="wrap" key="orch-intro">{text("ui.orch.intro", locale, { revision: formatNumber(policy.revision, locale) })}</Text>,
    ...(policy.review ? [] : [<Text color={INK.fail} wrap="wrap" key="orch-review-off">{text("ui.orch.reviewOff", locale)}</Text>]),
    grid(els, view.width - 4, ROLES.map((role) => (width: number) => <Box width={width} flexShrink={0} key={"cell-" + role}>{roleRows(els, view, policy, role, act)}</Box>), 30, 3),
    <Box flexDirection="column" key="orch-native" marginTop={UI_DESIGN.space.xs}>
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
      placeholder={text("ui.orch.commandPlaceholder", locale, { ...MODEL_TEXT_VALUES, ...EFFORT_TEXT_VALUES })}
      submitLabel={text("ui.orch.commandSubmit", locale)}
      onInput={(value) => act.orchestrationType(value)}
      onSubmit={(value) => act.orchestrationSubmit(value)}
    />,
    orch.message ? <Text key="orch-message" color={orch.message.ok ? INK.route : INK.fail} wrap="wrap">{orch.message.text}</Text> : null,
    <Box flexDirection="column" key="orch-objective" marginTop={UI_DESIGN.space.xs}>
      <Text bold color={INK.ink}>{text("ui.orch.objective", locale)}</Text>
      {objective ? (
        <Box flexDirection="column">
          <Text color={INK.dim} wrap="wrap">{text("ui.orch.objectiveLine", locale, { id: objective.id, mode: objective.workMode, revision: formatNumber(objective.revision, locale) })}</Text>
          <Text wrap="wrap">{text("ui.orch.requested", locale, { value: objective.requested ? profileText(objective.requested, locale) : text("ui.orch.nativeRequest", locale) + (objective.why ? ` (${objective.why})` : "") })}</Text>
          <Text wrap="wrap">{text("ui.orch.applied", locale, { value: objective.applied ? profileText(objective.applied, locale) : text("ui.orch.unknown", locale) })}</Text>
          <Text wrap="wrap">{text("ui.orch.observed", locale, { value: objective.observed?.model ? `${modelName(objective.observed.model)} · ${text("ui.orch.effortUnknown", locale)}` : text("ui.orch.unknown", locale) })}</Text>
          <Box flexDirection="row" columnGap={UI_DESIGN.space.sm}>
            <Button key="orch-apply" label={text(objective.applyPending ? "ui.orch.applyPending" : "ui.orch.apply", locale)} plain dimColor={objective.applyPending === true} onPress={() => act.orchestration("apply")} />
            <Button key="orch-end" label={text("ui.orch.end", locale)} plain onPress={() => act.orchestration("end")} />
          </Box>
        </Box>
      ) : <Text color={INK.faint} wrap="wrap">{text("ui.orch.noObjective", locale)}</Text>}
    </Box>,
    ...(orch.batches.length ? [
      <Box flexDirection="column" key="orch-batches" marginTop={UI_DESIGN.space.xs}>
        <Text bold color={INK.ink}>{text("ui.orch.batches", locale)}</Text>
        {orch.batches.map((b) => (
          <Box flexDirection="row" columnGap={UI_DESIGN.space.sm} key={"batch-" + b.id}>
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
  const choices = <T extends string,>(names: Readonly<Record<T, string>>, list: readonly T[]) => list.map((value) => ({ value, label: names[value] }));
  const verb = deck.note?.verb;
  const noteGroup = !verb ? undefined
    : ["expand", "collapse", "style", "collapsed", "size"].includes(verb) ? "ui.deck.band"
    : verb === "all" || (SECTIONS as readonly string[]).includes(verb) ? "ui.deck.show"
    : ["auto", "sound", "quiet", "cost"].includes(verb) ? "ui.deck.extras"
    : verb === "city" ? "ui.deck.city"
    : ["panel", "demo", "clear"].includes(verb) ? "ui.deck.tools"
    : "ui.deck.status";
  const groups: [LocaleKey, RenderChildren][] = [
    ["ui.deck.band", <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
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
      <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm} marginTop={UI_DESIGN.space.xs}>
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
    ["ui.deck.city", <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      <Text color={INK.dim} wrap="wrap">{settings.city ? text("ui.deck.cityNow", locale, { city: settings.city.name }) : text("ui.deck.cityNone", locale)}</Text>
      <Input key="deck-city" value={deck.draft} placeholder={text("ui.deck.cityPlaceholder", locale)} submitLabel={text("ui.deck.citySet", locale)} onInput={(value) => act.deckType(value)} onSubmit={(value) => act.deckCity(value)} />
    </Box>],
    ["ui.deck.tools", <Box flexDirection="column">
      <Button key="deck-panel-open" plain label={text("ui.deck.panelOpen", locale, { hotkey: "p" })} hotkey="p" onPress={() => act.deck("panel")} />
      <Button key="deck-panel-close" plain label={text("ui.deck.panelClose", locale)} onPress={() => act.deck("panel off")} />
      <Button key="deck-demo" plain label={text("ui.deck.demo", locale)} onPress={() => act.deck("demo")} />
      <Button key="deck-clear" plain label={text("ui.deck.clear", locale)} onPress={() => act.deck("clear")} />
    </Box>],
    ["ui.deck.status", <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      <Text color={INK.dim} wrap="wrap">{deck.status}</Text>
      <Text color={INK.faint}>{text("deck.reply.version", locale, { version: deck.version })}</Text>
    </Box>],
  ];
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs} width={view.width}>
      {stack(els, groups.map(([title, body]) => card(els, text(title, locale), <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
        {body}
        {deck.note && noteGroup === title ? <Text color={INK.route} wrap="wrap">{deck.note.text}</Text> : null}
      </Box>, { width: view.width })))}
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
      return { face: GLYPH.on, name: text("ui.live.you", locale), color: INK.you };
    case "jev": {
      const mood: Mood = entry.tone === "bad" ? "failing" : entry.tone === "muted" ? "passthrough" : "routing";
      return { face: MOODS[mood].face, name: text("ui.live.jev", locale), color: hex(MOODS[mood].color) };
    }
    case "claude":
      return { face: "", name: text("ui.live.claude", locale), color: INK.claude };
    case "agent":
      if (isMascot(entry.mascot)) {
        const mascot = AGENT_MASCOTS[entry.mascot];
        return { face: GLYPH.on, name: mascot.name, color: hex(mascot.color) };
      }
      return { face: GLYPH.on, name: entry.name ?? text("ui.live.subagent", locale), color: INK.ink };
    default:
      return { face: GLYPH.baseline, name: text("ui.live.mod", locale), color: INK.faint };
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
 * The log as a conversation, in the order given: no gaps between speakers, the face and name drawn where
 * the speaker changes. The Live tab draws its newest lines newest first; a subagent's pane draws only its own,
 * newest last.
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

/** The head of a log: the running glyph and the log's name in bold. */
function logRule(els: Els, view: View, title: string) {
  const { Text } = els;
  return (
    <Text wrap="truncate">
      <Text bold color={INK.brand}>{`${GLYPH.run} `}</Text>
      <Text bold color={INK.ink}>{title}</Text>
    </Text>
  );
}

/** The live log: who speaks, the latest Jev call pinned, then its newest `ENTRIES_SHOWN` events, newest first. */
function liveView(els: Els, view: View) {
  const { Box } = els;
  const empty = text("ui.live.emptyFeed", view.locale);
  const { pinned, lines } = liveLines(view.feed);
  const head = (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      {liveTop(els, view)}
      {logRule(els, view, text("ui.live.title", view.locale))}
    </Box>
  );
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      {head}
      {pinned ? card(els, text("ui.live.pinnedJev", view.locale), feedLine(els, { ...view, width: view.width - 4 }, pinned), { width: view.width, rule: pinned.tone === "bad" ? INK.fail : INK.brand }) : null}
      {lines.length || !pinned ? conversation(els, view, lines, empty) : null}
    </Box>
  );
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
 * mascot's color), what Claude is doing now and the session's Jev tally. The run itself is on the Flow tab.
 */
function liveTop(els: Els, view: View) {
  const { Box, Text } = els;
  const state = status(view.events, view.routing, view.now, view.locale);
  const running = view.agents.filter((run) => run.state === "running");
  const mood = MOODS[moodOf(view)];
  const now = view.live;
  const tally = jevTally(view.trace, view.events);
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text wrap="wrap">
        {pill(els, `${mood.face} ${text("ui.live.jev", view.locale)}`, hex(mood.color))}
        <Text color={now.asking ? INK.route : INK.dim}>{` ${now.asking ? text("ui.live.asking", view.locale) : state.title}  `}</Text>
        {pill(els, `${GLYPH.on} ${modelName(now.model)}${now.effort ? ` · ${now.effort}` : ""}`, css(HUE.claude))}
        {running.map((run) => {
          const mascot = mascotOf(run);
          return (
            <Text>
              <Text> </Text>
              {pill(els, `${GLYPH.on} ${mascot ? mascot.name : text("ui.live.subagent", view.locale)}`, mascot ? hex(mascot.color) : css(HUE.ok))}
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
  running: ["ui.agents.state.running", GLYPH.run, INK.route],
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

/** "■ Tetra  Explore #3": the mascot's name on its color, then the type and number. */
function agentName(els: Els, run: AgentRun, locale: Locale) {
  const { Text } = els;
  const mascot = mascotOf(run);
  return (
    <Text>
      {mascot ? pill(els, `${GLYPH.on} ${mascot.name}`, hex(mascot.color)) : <Text bold color={INK.ink}>{GLYPH.on}</Text>}
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

/** One subagent as a card `width` wide, its ■ in its mascot's color while it runs: who, state, task, figures. */
/**
 * A subagent's mascot, still, in the cast's pixel stroke, beside its card's words on the terminal (the desktop draws
 * no Raster): its idle self, or with crossed eyes after an error.
 */
function mascotSprite(els: Els, view: View, run: AgentRun, kind: MascotId) {
  if (view.surface !== "terminal" || !("Raster" in els)) return null;
  const { Box } = els;
  const { Raster } = els as unknown as ElementTable<"terminal">;
  const cells = memberFrame({ kind, state: run.state === "error" ? "failed" : "idle", since: 0 }, 0, 1, false);
  return (
    <Box width={cells[0]!.length} height={cells.length} flexShrink={0}>
      <Raster key={`agent-mascot-${run.n}`} columns={cells[0]!.length} rows={cells.length} cells={cellsOf(cells)} />
    </Box>
  );
}

function agentCard(els: Els, view: View, act: Actions, run: AgentRun, width: number) {
  const { Box, Text, Button } = els;
  const mascot = mascotOf(run);
  const sprite = mascot ? mascotSprite(els, view, run, mascot.id) : null;
  const spriteWidth = sprite ? DECK_DESIGN.pet.member.columns + UI_DESIGN.space.sm : 0;
  const lineWidth = Math.max(1, width - INDENT - spriteWidth);
  const lines = [
    <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.xs}>
      {mascot ? <Text>{pill(els, `${GLYPH.on} ${mascot.name}`, hex(mascot.color))}</Text> : null}
      {agentState(els, view, run)}
    </Box>,
    <Text bold color={INK.ink} wrap="truncate">{oneLine(run.description, lineWidth)}</Text>,
    <Text color={INK.dim} wrap="truncate">{oneLine(`${agentModel(run, view.locale)} · ${agentNumbers(run, view.locale)}`, lineWidth)}</Text>,
    <Text color={run.state === "running" ? INK.ink : INK.dim} wrap="wrap">
      {oneLine(run.state === "running" ? `${GLYPH.run} ${run.activity ?? text("ui.agent.running", view.locale)}` : run.text ? `“${run.text}”` : text("ui.agent.noResponse", view.locale), lineWidth)}
    </Text>,
    <Box flexDirection="row" columnGap={UI_DESIGN.space.xs} flexWrap="wrap">
      <Button key={`agent-open-${run.n}`} label={text("ui.agent.liveOpen", view.locale, { number: formatNumber(run.n, view.locale) })} onPress={() => act.openAgent(run.n)} />
    </Box>,
  ];
  const body = sprite ? (
    <Box flexDirection="row" columnGap={UI_DESIGN.space.sm}>
      {sprite}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>{lines}</Box>
    </Box>
  ) : lines;
  return card(els, agentTitle(run, view.locale), body, { width, rule: agentAccent(run), glyph: AGENT_STATE[run.state][1], ...(run.state === "running" && mascot ? { color: hex(mascot.color) } : {}) });
}

/** The Agents screen: every subagent Claude started as a card, running ones first. */
function agentsView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button } = els;
  const list = [...view.agents].sort((a, b) => Number(b.state === "running") - Number(a.state === "running") || b.n - a.n);
  const running = list.filter((run) => run.state === "running").length;
  const finished = list.length - running;
  const shown = list.slice(0, view.width >= 70 ? 6 : 4);
  const hidden = list.length - shown.length;
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
        {section(els, text("ui.agents.title", view.locale))}
        {running ? <Text color={INK.route}>{text("ui.live.runningAgents", view.locale, { count: formatNumber(running, view.locale), unit: text(running === 1 ? "unit.agent" : "unit.agents", view.locale) })}</Text> : null}
        {finished ? <Button key="agents-clear" label={text("ui.agents.clearFinished", view.locale, { count: formatNumber(finished, view.locale) })} hotkey="l" onPress={() => act.clearAgents()} /> : null}
      </Box>
      {list.length === 0 ? (
        emptyLine(els, text("ui.agents.emptyDescription", view.locale))
      ) : (
        stack(els, shown.map((run) => agentCard(els, view, act, run, view.width)))
      )}
      {hidden ? <Text color={INK.faint} wrap="truncate">{text("ui.agents.more", view.locale, { hidden: formatNumber(hidden, view.locale) })}</Text> : null}
    </Box>
  );
}

/** One subagent's own live pane: its task and numbers at the top, then only its lines, as they happen. */
export function renderAgentPane(els: Els, view: View, run: AgentRun | undefined, n: number, act: Actions) {
  const { Box, Text, Button } = els;
  const buttons = (
    <Box flexDirection="row" columnGap={UI_DESIGN.space.sm} flexWrap="wrap">
      <Button key="agent-jev" label={text("ui.agent.openJev", view.locale)} hotkey="j" onPress={() => act.jevLive()} />
      <Button key="agent-close" label={text("ui.agent.close", view.locale)} hotkey="x" onPress={() => act.closeAgent(n)} />
    </Box>
  );
  if (!run) {
    return (
      <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
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
  // the top is a card in the mascot’s color: who it is, its state, its task and its figures
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
      ], { width: view.width, rule: agentAccent(run), glyph: AGENT_STATE[run.state][1] })}
    </Box>
  );
  // The task Claude gave it opens the log: shown once scrolled back to the start.
  const task = (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      <Text color={INK.faint} wrap="truncate">{text("ui.agent.task", view.locale)}</Text>
      <Text color={INK.dim} wrap="wrap">{clip(run.prompt, 480)}</Text>
      {modelSteps.length ? (
        <Box flexDirection="column" marginTop={UI_DESIGN.space.xs}>
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
      <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
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

/** The Flow screen: every kept request as a log of what Pingo did, newest first (hooks/trail.ts). */
function flowView(els: Els, view: View) {
  const { Box, Text } = els;
  const lines = trailLines({ trace: view.trace, now: view.now, width: Math.max(1, view.width), locale: view.locale });
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
      <Box marginTop={UI_DESIGN.space.xs}>
        <Text color={INK.faint} wrap="wrap">{text("trail.help", view.locale)}</Text>
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
 * now, Jev's usage, and the latest run's requests one row each, as cards.
 */
function modelsView(els: Els, view: View) {
  const { Box, Text } = els;
  const run = view.trace.runs.find((candidate) => candidate.id === view.trace.active) ?? view.trace.runs.at(-1);
  const steps = run?.steps.filter((step) => !step.agentId) ?? [];
  const jevGroups = jevUsageGroups(view.trace).slice(-2);
  const shown = steps.slice(-5);
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      {stack(els, [
        card(els, text("ui.models.now", view.locale), <Text wrap="truncate">{pill(els, `${GLYPH.on} ${modelName(view.live.model)}`, css(HUE.claude))}{view.live.effort ? <Text color={INK.ink}>{` ${text("ui.models.effort", view.locale, { effort: view.live.effort })}`}</Text> : null}</Text>, { color: INK.claude, rule: INK.claude, width: view.width }),
        card(els, text("ui.models.jevUsage", view.locale), jevGroups.length
          ? jevGroups.map((group) => {
              const counters = (["input", "output", "cacheRead", "cacheWrite"] as const).filter((counter) => group.sums[counter] !== undefined).map((counter) => jevCounterText(group, counter, view.locale));
              return <Box flexDirection="column"><Text bold color={INK.ink} wrap="truncate">{text(group.observed ? "ui.models.jevObserved" : "ui.models.jevRequested", view.locale, { model: modelName(group.model), calls: formatNumber(group.calls, view.locale) })}</Text><Text color={INK.dim} wrap="truncate">{counters.join(" · ") || text("ui.models.jevNoUsage", view.locale)}</Text></Box>;
            })
          : <Text color={INK.faint} wrap="wrap">{text("ui.models.jevNoUsage", view.locale)}</Text>, { width: view.width }),
      ])}
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
 * The Jev pane: the header (Pingo and what it says) on top at every width, then the rail of screens down the left and
 * the open screen beside it, its title over its cards; a narrow or short pane folds the rail into lines under the
 * header and gives the screen the whole width. Every screen is drawn and measured at the width it really gets. On the
 * terminal the pane is exactly its room tall: the header, the rail and the title stay, and the screen under the title
 * moves by its own offset.
 */
export function renderPane(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const side = railed(view);
  const railWidth = side ? railColumns(view.locale) : 0;
  const gap = side ? UI_DESIGN.layout.rail.gap : 0;
  const width = view.width - railWidth - gap;
  const inner: View = { ...view, width };
  const top = side ? header(els, view) : (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
      {header(els, view)}
      {foldedRail(els, view, act)}
    </Box>
  );
  const title = titleBar(els, inner);
  // The rail beside the screen, or the screen alone; `height` clips both to the room under the header.
  const beside = (main: RenderChildren, height?: number) => (
    <Box flexDirection="row" columnGap={gap} {...(height === undefined ? {} : { height, overflow: "hidden" as const })}>
      {side ? rail(els, view, act, railWidth) : null}
      <Box flexDirection="column" width={width} flexShrink={0} rowGap={UI_DESIGN.space.xs}>
        {main}
      </Box>
    </Box>
  );
  if (!view.fixed) {
    return (
      <Box flexDirection="column" rowGap={UI_DESIGN.space.xs}>
        {top}
        {beside([title, tabBody(els, inner, act)])}
      </Box>
    );
  }
  const room = Math.max(5, view.rows - rowsOf(top, view.width) - UI_DESIGN.space.xs);
  const rows = Math.max(4, room - rowsOf(title, width) - UI_DESIGN.space.xs);
  const body = <Box flexDirection="column" flexShrink={0}>{tabBody(els, inner, act)}</Box>;
  const total = rowsOf(body, width);
  const max = Math.max(0, total - rows + 1);
  // Logs and Live have their newest on top: scrolled down, each keeps to the entries it showed.
  const offset =
    view.tab === "logs"
      ? anchored("log", view.scroll, view.events.at(-1)?.seq ?? 0, (since) => rowsAbove(newestFirst(view.events), since, (event) => logEntry(els, { ...inner, width: width - INDENT }, event), width - INDENT), max)
      : view.tab === "live"
        ? anchored("live", view.scroll, view.feed.at(-1)?.seq ?? 0, (since) => rowsAbove(liveLines(view.feed).lines, since, (entry) => feedLine(els, inner, entry), width), max)
        : Math.min(view.scroll, max);
  act.layout((view.tab === "logs" || view.tab === "live") && max ? view.scroll + max - offset : max, false);
  const more = total - offset > rows - 1;
  return (
    <Box flexDirection="column" height={view.rows} overflow="hidden" rowGap={UI_DESIGN.space.xs}>
      {top}
      {beside([
        title,
        <Box flexDirection="column" flexShrink={0}>
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
        </Box>,
      ], room)}
    </Box>
  );
}

/** Code Quality: its switch and what it is doing, then each cycle with what it fixed and what it left as it was. */
function qualityView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button } = els;
  const { locale } = view;
  const on = view.features.codeQuality;
  const { running, queued, cycles } = view.quality ?? { running: false, queued: [], cycles: [] };
  const name = text("feature.codeQuality.name", locale);
  const status = !on ? "feature.codeQuality.off" : running ? "feature.codeQuality.running" : "feature.codeQuality.idle";
  const item = (glyph: string, color: string, one: QualityItem) => (
    <Text wrap="wrap"><Text bold color={color}>{`${glyph} `}</Text>{one.where ? <Text bold>{`${one.where} `}</Text> : null}{one.text}</Text>
  );
  const cycleNode = (cycle: QualityCycle) => {
    const title = text("feature.codeQuality.cycle", locale, { n: formatNumber(cycle.n, locale), time: formatClock(cycle.startedAt, locale) });
    if (cycle.state === "running") {
      const files = cycle.files.length ? text("feature.codeQuality.queued", locale, { files: cycle.files.join(", ") }) : undefined;
      return card(els, title, <Text color={INK.dim} wrap="wrap">{text("feature.codeQuality.running", locale)}</Text>, { width: view.width, rule: INK.brand, glyph: GLYPH.run, ...(files ? { note: files } : {}) });
    }
    const counts = text("feature.codeQuality.counts", locale, { fixed: formatNumber(cycle.fixed.length, locale), skipped: formatNumber(cycle.skipped.length, locale) });
    return card(els, title, [
      cycle.summary ? <Text wrap="wrap">{cycle.summary}</Text> : null,
      cycle.state === "failed" && !cycle.summary ? <Text color={INK.fail} wrap="wrap">{text("feature.codeQuality.noReport", locale)}</Text> : null,
      cycle.reviewed.length ? <Text color={INK.faint} wrap="wrap">{text("feature.codeQuality.reviewed", locale, { files: cycle.reviewed.join(", ") })}</Text> : null,
      ...cycle.fixed.map((one) => item(GLYPH.ok, INK.route, one)),
      ...cycle.skipped.map((one) => item(GLYPH.off, INK.dim, one)),
    ], { width: view.width, note: counts, alert: cycle.state === "failed" });
  };
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs} width={view.width}>
      {card(els, name, [
        <Text color={INK.dim} wrap="wrap">{text(status, locale)}</Text>,
        on && queued.length ? <Text color={INK.faint} wrap="wrap">{text("feature.codeQuality.queued", locale, { files: queued.join(", ") })}</Text> : null,
        <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
          {toggleButton(els, "feature-codeQuality", on, name, () => act.feature("codeQuality", !on), "k")}
          {on && !running ? <Button key="quality-run" label={text("feature.codeQuality.runNow", locale)} onPress={() => act.qualityRun()} /> : null}
        </Box>,
      ], { width: view.width, rule: hex(FEATURE_MASCOT_PALETTE.codeQuality) })}
      {section(els, text("feature.codeQuality.cycles", locale))}
      {cycles.length ? stack(els, cycles.map(cycleNode)) : emptyLine(els, text("feature.codeQuality.none", locale))}
    </Box>
  );
}

/** Each decision's glyph and color, so it reads without color too. */
const DECISION_MARK: Record<ComandanteDecision, [glyph: string, color: string]> = {
  approved: [GLYPH.ok, INK.route],
  rejected: [GLYPH.fail, INK.fail],
  questioned: [GLYPH.ask, INK.pass],
};

/**
 * Which assistants the Comandante judges: "All" switches every one on (or, all on, off), then one switch per source,
 * each with its mascot's color stripe; on or off reads from ▣ or □, not from the color.
 */
function comandanteSourcesCard(els: Els, view: View, act: Actions) {
  const { Box, Text, Button } = els;
  const { locale } = view;
  const sources = view.preferences.comandanteSources;
  const onCount = COMANDANTE_SOURCES.filter((source) => sources[source]).length;
  const allOn = onCount === COMANDANTE_SOURCES.length;
  const toggle = (source: ComandanteSource) => {
    const on = sources[source];
    const label = `${on ? GLYPH.check : GLYPH.off} ${text(`feature.${source}.name`, locale)}`;
    return (
      <Button key={`comandante-source-${source}`} label={label} plain onPress={() => act.preference("comandanteSources", { ...sources, [source]: !on })}>
        <Text bold color={css(FEATURE_MASCOT_PALETTE[source])}>{GLYPH.tab}</Text>
        <Text dimColor={!on}>{` ${label}`}</Text>
      </Button>
    );
  };
  return card(els, text("feature.comandante.sources.title", locale), [
    <Text color={INK.dim} wrap="wrap">{text("feature.comandante.sources.hint", locale)}</Text>,
    <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
      {toggleButton(els, "comandante-sources-all", allOn, text("feature.comandante.sources.all", locale), () => act.preference("comandanteSources", comandanteSourcesAll(!allOn)))}
      <Text color={INK.faint}>{text("feature.comandante.sources.count", locale, { on: formatNumber(onCount, locale), total: formatNumber(COMANDANTE_SOURCES.length, locale) })}</Text>
    </Box>,
    <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>{COMANDANTE_SOURCES.map(toggle)}</Box>,
  ], { width: view.width });
}

/**
 * The Comandante: its switch and what it is doing, which assistants it judges, the filters by session and by
 * decision, then each decision of every session of the project as a card, newest first: what was judged, why, and
 * where it came from.
 */
function comandanteView(els: Els, view: View, act: Actions) {
  const { Box, Text, Select } = els;
  const { locale } = view;
  const on = view.features.comandante;
  const panel = view.comandante ?? { log: [], filter: { session: COMANDANTE_ALL, decision: COMANDANTE_ALL }, me: "", busy: false };
  const name = text("feature.comandante.name", locale);
  const status = !on ? "feature.comandante.off" : panel.busy ? "feature.comandante.busy" : "feature.comandante.idle";
  const sessions = comandanteSessions(panel.log);
  const sessionName = (id: string, label: string) => (id === panel.me ? text("feature.comandante.this", locale) : `${oneLine(label, 30)} · ${id.slice(0, 8)}`);
  const kept = filterComandante(panel.log, panel.filter);
  const shown = kept.slice(0, view.width >= 70 ? 30 : 15);
  const counts = comandanteCounts(kept);
  const lineWidth = Math.max(20, view.width - 6);
  const node = (record: ComandanteRecord) => {
    const [glyph, color] = DECISION_MARK[record.decision];
    const title = `${text(`feature.comandante.decision.${record.decision}`, locale)} · ${text(`feature.${record.source}.name`, locale)}`;
    const origin = [
      clock(record.at, locale),
      sessionName(record.session, record.sessionName),
      record.project,
      record.agent ? text("feature.comandante.by", locale, { agent: record.agent }) : "",
    ].filter(Boolean).join(" · ");
    return card(els, title, [
      <Text wrap="wrap">{oneLine(record.summary, lineWidth * 3)}</Text>,
      <Text color={INK.dim} wrap="wrap">{`${text(`feature.comandante.reason.${record.reason}` as LocaleKey, locale)} · ${text("feature.comandante.confidence", locale, { value: pct(record.confidence, 1, locale) })}`}</Text>,
      <Text color={INK.faint} wrap="truncate">{oneLine(origin, lineWidth)}</Text>,
      // a held message the person let through to Claude anyway
      record.releasedAt !== undefined ? <Text color={INK.you} wrap="wrap">{text("feature.comandante.released", locale, { time: clock(record.releasedAt, locale) })}</Text> : null,
    ], { width: view.width, rule: color, glyph, color });
  };
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs} width={view.width}>
      {card(els, name, [
        <Text color={INK.dim} wrap="wrap">{text(status, locale)}</Text>,
        <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
          {toggleButton(els, "feature-comandante", on, name, () => act.feature("comandante", !on), "m")}
        </Box>,
      ], { width: view.width, rule: hex(FEATURE_MASCOT_PALETTE.comandante) })}
      {comandanteSourcesCard(els, view, act)}
      {section(els, text("feature.comandante.log", locale))}
      <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
        <Select
          key="comandante-session"
          label={text("feature.comandante.filter.session", locale)}
          value={panel.filter.session}
          options={[
            { value: COMANDANTE_ALL, label: text("feature.comandante.filter.allSessions", locale) },
            ...sessions.map((one) => ({ value: one.id, label: `${sessionName(one.id, one.name)}${one.project ? ` · ${one.project}` : ""}` })),
          ]}
          onSelect={(value) => act.comandanteFilter({ session: String(value) })}
        />
        <Select
          key="comandante-decision"
          label={text("feature.comandante.filter.decision", locale)}
          value={panel.filter.decision}
          options={[
            { value: COMANDANTE_ALL, label: text("feature.comandante.filter.allDecisions", locale) },
            ...COMANDANTE_DECISIONS.map((decision) => ({ value: decision, label: text(`feature.comandante.decision.${decision}`, locale) })),
          ]}
          onSelect={(value) => act.comandanteFilter({ decision: value as ComandanteFilter["decision"] })}
        />
      </Box>
      {kept.length ? (
        <Text color={INK.faint} wrap="wrap">
          {[
            text("feature.comandante.counts", locale, { approved: formatNumber(counts.approved, locale), rejected: formatNumber(counts.rejected, locale), questioned: formatNumber(counts.questioned, locale) }),
            shown.length < kept.length ? text("feature.comandante.shown", locale, { shown: formatNumber(shown.length, locale), total: formatNumber(kept.length, locale) }) : "",
          ].filter(Boolean).join(" ")}
        </Text>
      ) : null}
      {shown.length ? stack(els, shown.map(node)) : emptyLine(els, text(panel.log.length ? "feature.comandante.noMatch" : "feature.comandante.empty", locale))}
    </Box>
  );
}

/** What the active tab draws under the header. */
function tabBody(els: Els, view: View, act: Actions) {
  return view.tab === "live"
      ? liveView(els, view)
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
              : view.tab === "ai"
                ? aiView(els, view, act)
              : view.tab === "flow"
                ? flowView(els, view)
              : view.tab === "orchestration"
                ? orchestrationView(els, view, act)
              : view.tab === "quality"
                ? qualityView(els, view, act)
              : view.tab === "comandante"
                ? comandanteView(els, view, act)
                : view.tab === "deck"
                  ? deckView(els, view, act)
                  : overview(els, view, act);
}

/**
 * Above the prompt: the Jev band, then the Deck band beneath it. A surface Deck does not draw
 * (neither the terminal nor the desktop) gets the Jev band alone.
 */
export function renderAbove(els: ElementTable, view: View, deck: DeckBand | null, surface: string, jev: RenderNode = renderBand(els, view)) {
  const { Box } = els;
  if (!deck || (surface !== "terminal" && surface !== "desktop")) return jev;
  return (
    <Box flexDirection="column">
      {jev}
      {renderDeck(els, deck, surface as Surface)}
    </Box>
  );
}

/**
 * One feature's lines above the prompt (Farol, Clareza, Semente, Lapida, Sentinela, Vigia): its first line, then its
 * details, one node per line, each already cut to the band's width.
 */
export type AboveBlock = {
  id: string;
  name: string;
  /** Its mascot's color, for its name on the "+N" line. */
  color: number;
  /** Which block keeps its rows first when they are short: 0 first. */
  rank: number;
  lines: readonly RenderNode[];
  /** Opens its pane, where the whole of it is. */
  open: () => void;
};

/**
 * The features' lines above the prompt, held to `DECK_DESIGN.band.messages.maxRows` terminal rows however long or many
 * their messages are. The first line of each comes first, by rank; one that does not fit leaves a row for a "+N" line
 * naming those left out, each pressed to open its pane. Then the details, by rank, while rows are left: a block that
 * cannot show them all shows what fits and a line saying how many more wait in its pane. The blocks keep the order they
 * came in, so nothing moves on screen when one is cut. Rows are counted with `rowsOf`, which rather counts too many.
 */
export function stackAbove(els: ElementTable, blocks: readonly AboveBlock[], cols: number, locale: Locale, maxRows: number = DECK_DESIGN.band.messages.maxRows): RenderNode[] {
  const rows = (node: unknown) => rowsOf(node, cols);
  const ranked = [...blocks].sort((a, b) => a.rank - b.rank);
  const heads = ranked.reduce((sum, block) => sum + rows(block.lines[0]), 0);
  let room = heads <= maxRows ? maxRows : maxRows - 1;
  const kept = new Map<string, number>();
  const left: AboveBlock[] = [];
  for (const block of ranked) {
    const need = rows(block.lines[0]);
    if (need <= room) {
      kept.set(block.id, 1);
      room -= need;
    } else left.push(block);
  }
  const tails = new Map<string, RenderNode>();
  for (const block of ranked) {
    if (!kept.has(block.id)) continue;
    const details = block.lines.slice(1);
    const need = details.reduce((sum, line) => sum + rows(line), 0);
    if (need <= room) {
      kept.set(block.id, block.lines.length);
      room -= need;
      continue;
    }
    // no row even for the "more in its pane" line: its first line still opens the pane
    if (room < 1) continue;
    let shown = 0;
    let used = 0;
    while (shown < details.length && used + rows(details[shown]) + 1 <= room) used += rows(details[shown++]);
    kept.set(block.id, 1 + shown);
    room -= used + 1;
    tails.set(block.id, hiddenLine(els, block, details.length - shown, locale));
  }
  const out: RenderNode[] = [];
  for (const block of blocks) {
    const count = kept.get(block.id);
    if (count === undefined) continue;
    out.push(...block.lines.slice(0, count));
    const tail = tails.get(block.id);
    if (tail) out.push(tail);
  }
  if (left.length) out.push(leftLine(els, left, cols, locale));
  return out;
}

// the line under a block whose details did not all fit: how many wait in its pane, pressed to open it
function hiddenLine(els: ElementTable, block: AboveBlock, count: number, locale: Locale): RenderNode {
  const { Button, Text } = els;
  const label = text("deck.messages.hidden", locale, { count: formatNumber(count, locale) });
  return (
    <Button key={`${block.id}-hidden`} label={label} plain onPress={block.open}>
      <Text color={INK.border}>{`  ${GLYPH.branch}${GLYPH.rule} `}</Text>
      <Text color={INK.dim} underline>{label}</Text>
    </Button>
  );
}

// the line for the blocks left out: "+N more:" and their names, underlined in their mascots' colors, each pressed to
// open its pane; the names that do not fit the line are only counted
function leftLine(els: ElementTable, left: readonly AboveBlock[], cols: number, locale: Locale): RenderNode {
  const { Box, Button, Text } = els;
  const { xs, sm } = UI_DESIGN.space;
  const lead = text("deck.messages.left", locale, { count: formatNumber(left.length, locale) });
  // the tab and the count as on every line above the prompt, then the names a little apart from each other
  let room = cols - displayWidth(GLYPH.tab) - xs - displayWidth(lead) - xs;
  const named: AboveBlock[] = [];
  for (const block of left) {
    const width = (named.length ? sm : 0) + displayWidth(block.name);
    if (width > room) break;
    named.push(block);
    room -= width;
  }
  return (
    <Box key="above-left" flexDirection="row" columnGap={xs} overflow="hidden">
      <Text color={INK.dim} bold>{GLYPH.tab}</Text>
      <Text color={INK.dim} wrap="truncate-end">{lead}</Text>
      <Box flexDirection="row" columnGap={sm}>
        {named.map((block) => (
          <Button key={`above-left-${block.id}`} label={block.name} plain onPress={block.open}>
            <Text color={css(block.color)} underline>{block.name}</Text>
          </Button>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Above the prompt, in the dashboard's language: Pingo's face and Jev's state in the mood's color with the last five
 * minutes beside it, then Jev's latest call (when and what, kept after it ends) under a tab in Jev's color, then the
 * main model under a tab in Claude's, what Claude is doing, and a ■ per subagent at work in its mascot's color.
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
  const lastJev = lastJevCall(view.feed);
  // three lines, each kept to one row on a narrow band, so the stack above the prompt can count them: the short parts
  // keep their width (each · rides with the part before or after it) and the long ones are cut with "…"
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={UI_DESIGN.space.xs} overflow="hidden">
        <Box flexShrink={0}>
          <Text bold color={moodInk} wrap="truncate-end">{MOODS[mood].face}</Text>
        </Box>
        <Box flexShrink={0}>
          <Text wrap="truncate-end">
            <Text bold color={INK.ink}>{`${text("ui.live.jev", view.locale)}: ${view.live.asking ? text("ui.band.asking", view.locale) : state.title}`}</Text>
            <Text color={INK.border}>{` ${GLYPH.leader}`}</Text>
          </Text>
        </Box>
        <Text color={stats.failures > 0 ? INK.fail : INK.dim} wrap="truncate-end">{`${stats.failures > 0 ? `${GLYPH.warn} ` : ""}${statsLine(stats, view.locale)}`}</Text>
        {statsPartial(stats, view.locale) ? <Text color={INK.faint} wrap="truncate-end">{statsPartial(stats, view.locale)}</Text> : null}
      </Box>
      <Box flexDirection="row" columnGap={UI_DESIGN.space.xs}>
        <Text bold color={!lastJev ? INK.faint : lastJev.tone === "bad" ? INK.fail : INK.brand}>{GLYPH.tab}</Text>
        <Text color={lastJev ? INK.ink : INK.faint} wrap="truncate-end">
          {lastJev ? text("ui.band.lastJev", view.locale, { age: formatAge(view.now - lastJev.time, view.locale), what: lastJev.text }) : text("ui.band.noJev", view.locale)}
        </Text>
      </Box>
      <Box flexDirection="row" columnGap={UI_DESIGN.space.xs} overflow="hidden">
        <Box flexShrink={0}>
          <Text color={INK.claude}>{GLYPH.tab}</Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={INK.ink} wrap="truncate-end">{`${modelName(now.model)}${now.effort ? ` · ${now.effort}` : ""}`}</Text>
        </Box>
        <Text wrap="truncate-end">
          <Text color={INK.border}>{`${GLYPH.leader} `}</Text>
          <Text color={now.activity ? INK.ink : INK.faint}>{now.activity ? `${GLYPH.run} ${now.activity}` : text("ui.band.idle", view.locale)}</Text>
        </Text>
        {/* the ■ per subagent keep their width; what Claude is doing and their count give way */}
        {running ? (
          <Box flexShrink={0}>
            <Text wrap="truncate-end">
              <Text color={INK.border}>{GLYPH.leader}</Text>
              {runningAgents.map((run) => {
                const mascot = mascotOf(run);
                return <Text key={run.id} bold color={mascot ? hex(mascot.color) : INK.route}>{" " + GLYPH.on}</Text>;
              })}
            </Text>
          </Box>
        ) : null}
        {running ? <Text color={INK.route} wrap="truncate-end">{text("ui.band.runningCount", view.locale, { count: formatNumber(running, view.locale), agents: text(running === 1 ? "ui.band.running.agent" : "ui.band.running.agents", view.locale) })}</Text> : null}
      </Box>
    </Box>
  );
}
