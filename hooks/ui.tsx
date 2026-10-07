// The dashboard uses dotted meters and timelines, text status, and animated mascots for the user
// and subagents. DESIGN.md describes the visual system; dots.ts draws the shared primitives.
import type { ElementTable, RenderChildren } from "claude-code";

import type { AgentRun, AgentState, FeatureFlags, FeedEntry, FeedTone, FlowState, JevTab, LiveNow, RouteEvent, SetupDraft } from "../types";
import type { FeatureId } from "./core/plan.ts";
import { FEATURES, modelName } from "./feed.ts";
import { PROVIDER_IDS, PROVIDERS } from "./core/jev.ts";
import {
  ago,
  at,
  CATEGORIES,
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
import { flowLines } from "./flow.ts";
import { rowsOf } from "./layout.ts";
import { DICE, diceFrame, diceSize, diceSvg } from "./mascots/dice.ts";
import { AGENT_MASCOTS, isMascot, MASCOT_ORDER, mascotFrame, mascotSvg, type AgentMascot } from "./mascots/agents.ts";

/** The pane needs Select and Input, which the terminal and the desktop app draw. */
export type Els = ElementTable<"terminal" | "desktop">;

export const TABS: readonly (readonly [JevTab, string, string])[] = [
  ["overview", "Overview", "1"],
  ["live", "Live", "2"],
  ["agents", "Agents", "3"],
  ["features", "Features", "4"],
  ["reasons", "Reasons", "5"],
  ["baseline", "Baseline", "6"],
  ["log", "Log", "7"],
  ["setup", "Setup", "8"],
  ["flow", "Flow", "9"],
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

const STATUS_INK: Record<StatusKind, string> = {
  routing: INK.route,
  passthrough: INK.pass,
  failing: INK.fail,
  idle: INK.dim,
  baseline: hex(DOT.base),
};
const CATEGORY_DOT: Record<Category, [glyph: string, color: number]> = {
  hint: ["●", DOT.route],
  passthrough: ["○", DOT.dim],
  failed: ["×", DOT.fail],
};

export interface View {
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
  flow: FlowState;
  /** The session's directory, for the Flow tab's prompt line. */
  cwd: string;
  /**
   * The body's own scroll position: rows from the top on most tabs, log lines back from the newest
   * on a live log. Only read when `fixed`: the pane is drawn exactly as tall as its room, the header
   * stays put, and the mod scrolls the body itself (ui.scroll).
   */
  scroll: number;
  fixed: boolean;
}

export interface Actions {
  tab: (tab: JevTab) => void;
  range: (range: number) => void;
  routing: (on: boolean) => void;
  feature: (id: FeatureId, on: boolean) => void;
  provider: (id: string) => void;
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
  /** How far the body can scroll as drawn, and whether it counts from the newest line up. */
  layout: (max: number, fromEnd: boolean) => void;
}

const fit = (text: string, width: number) => (text.length > width ? text.slice(0, Math.max(0, width - 1)) + "…" : text.padEnd(width));
const clock = (time: number) => new Date(time).toTimeString().slice(0, 8);
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

function header(els: Els, view: View, act: Actions) {
  const { Box, Button, Text } = els;
  const state = status(view.events, view.routing, view.now);
  const stateInk = STATUS_INK[state.kind];
  const stateLabel = view.live.asking ? "Asking Jev…" : state.title;
  const stateIcon = view.live.asking ? "◌" : state.icon;
  const { recent, confidence, latency, routedCount } = recentStats(view);
  // Kept short: it stays on screen above every tab while the body scrolls under it.
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text wrap="truncate">
          <Text bold color={INK.ink}>⠿ jev </Text>
          <Text bold color={stateInk}>{`${stateIcon} ${stateLabel}`}</Text>
        </Text>
        <Button
          key="routing"
          label={view.routing ? "Turn Jev off (r)" : "Turn Jev on (r)"}
          hotkey="r"
          onPress={() => act.routing(!view.routing)}
        />
      </Box>
      <Text wrap="truncate">
        {confidenceMeter(els, confidence, stateInk)}
        <Text color={INK.dim}>{confidence === undefined ? " confidence –  " : ` confidence ${confidence.toFixed(2)}  `}</Text>
        {routedRail(els, routedCount, recent.length, stateInk)}
        <Text color={INK.dim}>{` ${routedCount}/${recent.length} routed · 5 min${latency === undefined ? "" : ` · ${latency} ms`}`}</Text>
      </Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
        {TABS.map(([id, label, hotkey]) => (
          <Button
            key={"tab-" + id}
            label={view.tab === id ? `● ${label}` : label}
            hotkey={hotkey}
            plain
            dimColor={view.tab !== id}
            onPress={() => act.tab(id)}
          />
        ))}
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
      label="Range"
      value={String(view.range)}
      options={RANGES.map(([label, ms]) => ({ value: String(ms), label }))}
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
  const all = tiles(events);
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
function dotsBar(els: Els, events: readonly RouteEvent[], width: number) {
  const { Box, Text } = els;
  const counts = new Map(tally(events.map(category)));
  const present = CATEGORIES.filter(([name]) => counts.get(name));
  const room = Math.max(10, width);
  return (
    <Box flexDirection="column">
      <Text>
        {present.length === 0 ? <Text color={INK.faint}>{"⣀".repeat(room)}</Text> : null}
        {present.map(([name]) => (
          <Text color={hex(CATEGORY_DOT[name][1])}>{"⣿".repeat(Math.max(1, Math.round((room * (counts.get(name) ?? 0)) / events.length)))}</Text>
        ))}
      </Text>
      {(present.length ? present : CATEGORIES).map(([name, label]) => (
        <Text>
          <Text color={hex(CATEGORY_DOT[name][1])}>{`${CATEGORY_DOT[name][0]} `}</Text>
          <Text color={INK.dim}>{label} </Text>
          <Text bold color={INK.ink}>{`${int(counts.get(name) ?? 0)} · ${pct(counts.get(name) ?? 0, events.length)}`}</Text>
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
      <Text color={INK.faint}>{`${view.range > 0 ? ago(view.range) + " ago" : "start"} … now · one dot per request · top ${int(peak)} tokens`}</Text>
    </Box>
  );
}

function overview(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const events = inRange(view);
  const state = status(view.events, view.routing, view.now);
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text color={INK.ink} wrap="wrap">{state.text}</Text>
        <Text color={INK.faint} wrap="wrap">{view.meta}</Text>
      </Box>
      {figures(els, view, events)}
      {section(els, "What happened to each request")}
      {dotsBar(els, events, view.width - 2)}
      {sky(els, view, events)}
      {rangePicker(els, view, act)}
    </Box>
  );
}

function reasonsView(els: Els, view: View, act: Actions) {
  const { Box, Text } = els;
  const events = inRange(view);
  const list = reasons(events);
  const top = list[0]?.count ?? 1;
  const passed = events.filter((event) => !routed(event)).length;
  const colorFor = (who: string) => (who === "Jev failed" ? INK.fail : who === "Jev asked" ? INK.pass : INK.dim);
  return (
    <Box flexDirection="column">
      {section(els, "Why requests were not routed")}
      {list.length === 0 ? (
        <Text color={INK.dim}>{events.length ? "Every request in this range was routed by Jev." : "No requests in this range yet."}</Text>
      ) : null}
      {list.map((reason) => (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text bold color={colorFor(reason.who)}>{reason.name}</Text>
            <Text color={INK.faint}>{reason.who ? `  · ${reason.who}` : ""}</Text>
            <Text color={INK.ink}>{`  ${int(reason.count)} · ${pct(reason.count, passed)}`}</Text>
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
  const table = compare(inRange(view));
  const label = Math.max(12, Math.min(20, view.width - 36));
  const deltaInk = (delta: string) => (delta.startsWith("-") ? INK.route : delta.startsWith("+") ? INK.fail : INK.dim);
  return (
    <Box flexDirection="column" rowGap={1}>
      {section(els, "Token use: with Jev routing vs. baseline")}
      <Box flexDirection="column">
        <Text bold color={INK.ink}>{fit("", label) + fit("With Jev", 11) + fit("Baseline", 11) + "Diff"}</Text>
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
          ? "Per-request averages in the selected range. Only meaningful when both columns did similar work."
          : "No baseline yet. Switch routing off, do a comparable piece of work, then switch it back on."}
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
      {section(els, "Request log")}
      <Box flexDirection="column">
        {rows.length === 0 ? <Text color={INK.dim}>No requests yet.</Text> : null}
        {rows.map((event) => {
          const kind = category(event);
          const [glyph, color] = CATEGORY_DOT[kind];
          const what =
            event.mode === "hint"
              ? `suggested ${event.tool}`
              : event.jev
                ? `picked (${event.jev.choice}), Claude chose`
                : "stayed out";
          const confidence = event.confidence ?? event.jev?.confidence;
          return (
            <Box flexDirection="column">
              <Text wrap="wrap">
                <Text color={INK.faint}>{`${clock(at(event))} `}</Text>
                <Text bold color={hex(color)}>{`${glyph} `}</Text>
                <Text color={INK.ink}>{what}</Text>
                <Text color={INK.dim}>
                  {[
                    confidence === undefined ? "" : ` · ${confidence.toFixed(2)}`,
                    event.jev ? ` · ${int(event.jev.latencyMs)} ms` : "",
                    event.usage ? ` · in ${int(event.usage.input)} out ${int(event.usage.output)}` : "",
                    ` · ${(event.durationMs / 1000).toFixed(1)}s`,
                  ].join("")}
                </Text>
              </Text>
              {event.reason ? <Text color={kind === "failed" ? INK.fail : INK.faint}>{fit(`         ↳ ${event.reason}`, view.width - 2)}</Text> : null}
            </Box>
          );
        })}
      </Box>
      <Text color={INK.faint} wrap="wrap">Newest first. A tool in brackets is what Jev picked when Claude still made the call alone.</Text>
    </Box>
  );
}

function setupView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button, Select } = els;
  const chosen = PROVIDER_IDS.includes(view.setup.provider as never) ? view.setup.provider : "typesafe";
  const info = PROVIDERS[chosen as keyof typeof PROVIDERS];
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        {section(els, "Setup")}
        <Text color={INK.ink} wrap="wrap">{`Choose ${info.label}, configure its key securely, then test the connection.`}</Text>
      </Box>
      {view.setup.message ? (
        <Text bold color={view.setup.isOk ? INK.route : INK.fail} wrap="wrap">
          {`${view.setup.isOk ? "●" : "×"} ${view.setup.message}`}
        </Text>
      ) : null}
      <Select
        key="provider"
        label="Provider"
        value={chosen}
        options={PROVIDER_IDS.map((id) => ({ value: id, label: `${PROVIDERS[id].label}: ${PROVIDERS[id].note}` }))}
        onSelect={(value) => act.provider(value)}
      />
      <Text color={INK.faint} wrap="wrap">{`Get a key at ${info.keyUrl}. Set the sensitive api_key option with /plugin configure jev@inline, or use ${info.keyEnv}. The plugin never writes keys to its own state.`}</Text>
      <Text color={INK.pass} wrap="wrap">
        {"Requests send recent conversation and tool data to the selected provider. Review the privacy details in the README before enabling routing."}
      </Text>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        <Button key="validate" label="Test connection (v)" hotkey="v" onPress={() => act.validate()} />
        <Button key="clear" label="Clear history (c)" hotkey="c" onPress={() => act.clear()} />
      </Box>
      <Text color={INK.faint} wrap="wrap">{view.meta}</Text>
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
    return <Svg source={diceSvg(view.now / 1000)} alt={DICE.label} />;
  }
  return null;
}

/** Who speaks on a line of the live log: a face, a name and a color, so Jev and you never blur. */
export function speaker(entry: Pick<FeedEntry, "who" | "name" | "tone" | "mascot">): { face: string; name: string; color: string } {
  switch (entry.who) {
    case "you":
      return { face: DICE.face, name: "You", color: INK.you };
    case "jev": {
      const color = entry.tone === "bad" ? INK.fail : entry.tone === "muted" ? INK.dim : INK.route;
      return { face: "◆", name: "Jev", color };
    }
    case "claude":
      return { face: "✻", name: "Claude", color: INK.claude };
    case "agent":
      if (isMascot(entry.mascot)) {
        const mascot = AGENT_MASCOTS[entry.mascot];
        return { face: mascot.face, name: mascot.name, color: hex(mascot.color) };
      }
      return { face: "◆", name: entry.name ?? "Subagent", color: INK.ink };
    default:
      return { face: "⠿", name: "Plugin", color: INK.faint };
  }
}

const FACE_WIDTH = 6;
const NAME_WIDTH = 7;

/**
 * One line of the live log, dense: time, who (only where the speaker changes), what happened and
 * a short figure at the end. The finer points go on a faint line under it; bookkeeping (a request
 * sent, a turn's end) is one faint line with its figures folded in.
 */
function feedLine(els: Els, view: View, entry: FeedEntry, first: boolean) {
  const { Box, Text } = els;
  const who = speaker(entry);
  const withTime = view.width >= 64;
  const gutter = (withTime ? 9 : 0) + FACE_WIDTH + NAME_WIDTH;
  const minor = entry.minor === true;
  const metaWidth = entry.meta ? Math.min(14, [...entry.meta].length) : 0;
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row">
        <Box width={gutter} flexShrink={0}>
          <Text wrap="truncate">
            {withTime ? <Text color={INK.faint}>{`${clock(entry.time)} `}</Text> : null}
            {first ? (
              <Text bold={!minor} color={minor ? INK.faint : who.color}>{fit(who.face, FACE_WIDTH) + fit(who.name, NAME_WIDTH)}</Text>
            ) : (
              <Text color={INK.faint}>{" ".repeat(FACE_WIDTH + NAME_WIDTH)}</Text>
            )}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          {minor ? (
            <Text color={INK.faint} wrap="truncate-end">{entry.detail ? `${entry.text} · ${entry.detail}` : entry.text}</Text>
          ) : (
            <Text color={TONE_INK[entry.tone]} bold={entry.kind === "turn" && entry.who === "you"} wrap="wrap">
              {entry.text}
            </Text>
          )}
        </Box>
        {entry.meta ? (
          <Box flexShrink={0} marginLeft={1} width={metaWidth}>
            <Text color={INK.faint} wrap="truncate">{entry.meta}</Text>
          </Box>
        ) : null}
      </Box>
      {!minor && entry.detail ? (
        <Box flexDirection="row">
          <Box width={gutter} flexShrink={0} />
          <Box flexShrink={1}>
            <Text color={INK.faint} wrap="wrap">{`└ ${entry.detail}`}</Text>
          </Box>
        </Box>
      ) : null}
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
      {lines.map((entry, i) => {
        const before = lines[i - 1];
        const first = !before || before.who !== entry.who || before.name !== entry.name || before.agent !== entry.agent;
        return feedLine(els, view, entry, first);
      })}
    </Box>
  );
}

/**
 * A log that sticks to its newest line: the box is as tall as `rows`, the lines sit at its
 * bottom, older ones are cut off at the top, and `back` lines are skipped from the end while the
 * person scrolls up. The line under it says how many newer ones are hidden.
 */
function stuckLog(els: Els, view: View, lines: readonly FeedEntry[], rows: number, empty: string, before?: RenderChildren) {
  const { Box, Text } = els;
  const back = view.fixed ? Math.min(view.scroll, Math.max(0, lines.length - 1)) : 0;
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
        <Text color={INK.pass} wrap="truncate">{`▼ ${back} newer line${back === 1 ? "" : "s"} below · scroll down or End`}</Text>
      ) : null}
    </Box>
  );
}

/** The live log: who speaks, then every observable event, newest last. */
function liveView(els: Els, view: View, act: Actions, rows: number) {
  const { Box, Text } = els;
  const top = liveTop(els, view);
  const empty = "Nothing yet. Send Claude a request to see events here.";
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
  act.layout(Math.max(0, view.feed.length - 1), true);
  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      {top}
      <Text color={INK.faint} wrap="truncate">{"┄".repeat(Math.max(1, view.width))}</Text>
      {stuckLog(els, view, view.feed, logRows, empty)}
    </Box>
  );
}

/** The Live tab's fixed top: Dice, and the face and color of everyone who speaks in the log. */
function liveTop(els: Els, view: View) {
  const { Box, Text } = els;
  const state = status(view.events, view.routing, view.now);
  const stateInk = STATUS_INK[state.kind];
  const running = view.agents.filter((run) => run.state === "running").length;
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" columnGap={2}>
        {diceArt(els, view)}
        <Box flexDirection="column" flexShrink={1}>
          {section(els, "Live")}
          <Text wrap="wrap">
            <Text bold color={INK.you}>{`${DICE.face} You`}</Text>
            <Text color={INK.dim}>{` · ${DICE.name}, your dotted die`}</Text>
          </Text>
          <Text wrap="wrap">
            <Text bold color={stateInk}>{`${view.live.asking ? "◌" : state.icon} Jev`}</Text>
            <Text color={INK.dim}>{` · ${view.live.asking ? "Asking" : state.title}`}</Text>
          </Text>
          <Text wrap="wrap">
            <Text bold color={INK.claude}>✻ Claude</Text>
            <Text color={INK.faint}>{"   ⠿ plugin"}</Text>
          </Text>
          <Text wrap="wrap">
            <Text color={INK.dim}>Subagents </Text>
            {MASCOT_ORDER.map((id) => (
              <Text bold color={hex(AGENT_MASCOTS[id].color)}>{` ${AGENT_MASCOTS[id].face} ${AGENT_MASCOTS[id].name} `}</Text>
            ))}
          </Text>
          {running ? <Text color={INK.route} wrap="wrap">{`${running} subagent(s) running now: open the Agents tab (3) or /jev agent <n>.`}</Text> : null}
          <Text color={INK.faint} wrap="wrap">Observable events only: the model's reasoning is never read or shown.</Text>
        </Box>
      </Box>
    </Box>
  );
}

const AGENT_STATE: Record<AgentState, [label: string, color: string]> = {
  running: ["● running", INK.route],
  done: ["✓ done", INK.dim],
  error: ["✗ error", INK.fail],
  aborted: ["⊘ aborted", INK.pass],
};

/** "8s", "2m 05s", "1h 03m": how long a subagent has run, or ran. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** "950", "12.3k", "1.2M": tokens in a few characters. */
const compact = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`);

/** A subagent's figures in one line: tools, requests, tokens. */
function agentNumbers(run: AgentRun): string {
  return [
    `${run.tools} tool${run.tools === 1 ? "" : "s"}`,
    `${run.requests} request${run.requests === 1 ? "" : "s"}`,
    `in ${compact(run.tokensIn)} · out ${compact(run.tokensOut)}`,
  ].join(" · ");
}

/** The model a subagent runs on, its effort, and what Jev chose for it. */
function agentModel(run: AgentRun): string {
  return [modelName(run.model), run.effort ? `effort ${run.effort}` : "", run.jev ? `(Jev: ${run.jev})` : ""].filter(Boolean).join(" · ");
}

/** A subagent's mascot, when it has one. */
const mascotOf = (run: AgentRun): AgentMascot | undefined => (isMascot(run.mascot) ? AGENT_MASCOTS[run.mascot] : undefined);

/** "/•ᴗ•\ Tetra  Explore #3": the mascot's face and name in its color, then the type and number. */
function agentName(els: Els, run: AgentRun) {
  const { Text } = els;
  const mascot = mascotOf(run);
  return (
    <Text>
      {mascot ? <Text bold color={hex(mascot.color)}>{`${mascot.face} ${mascot.name}`}</Text> : <Text bold color={INK.ink}>◆</Text>}
      <Text color={INK.ink}>{`  ${run.type} #${run.n}`}</Text>
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
    return <Svg source={mascotSvg(mascot.id, view.now / 1000)} alt={`${mascot.name}, ${mascot.shape}`} />;
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
      {section(els, "Agents")}
      {finished ? (
        <Box flexDirection="row">
          <Button key="agents-clear" label={`Clear finished (${finished}) (l)`} hotkey="l" onPress={() => act.clearAgents()} />
        </Box>
      ) : null}
      {list.length === 0 ? (
        <Text color={INK.dim} wrap="wrap">No subagents in this session yet. When Claude starts one, it appears here with its activity and its own live pane.</Text>
      ) : null}
      {list.map((run) => {
        const [label, color] = AGENT_STATE[run.state];
        return (
          <Box flexDirection="column">
            <Text wrap="wrap">
              {agentName(els, run)}
              <Text bold color={color}>{`  ${label}`}</Text>
              <Text color={INK.dim}>{` · ${elapsed((run.endedAt ?? view.now) - run.startedAt)} · ${agentModel(run)}`}</Text>
            </Text>
            <Text color={INK.ink} wrap="wrap">{`   ${run.description}`}</Text>
            <Text color={INK.dim} wrap="wrap">
              {`   ${run.state === "running" ? (run.activity ?? "running") : run.text ? `“${run.text.replace(/\s+/g, " ").slice(0, 120)}${run.text.length > 120 ? "…" : ""}”` : "no visible response"} · ${agentNumbers(run)}`}
            </Text>
            <Box flexDirection="row" marginLeft={3} columnGap={2}>
              <Button key={`agent-open-${run.n}`} label={`Open live #${run.n}`} onPress={() => act.openAgent(run.n)} />
              {run.state === "running" ? null : <Button key={`agent-remove-${run.n}`} label="Remove" onPress={() => act.removeAgent(run.n)} />}
            </Box>
          </Box>
        );
      })}
      <Text color={INK.faint} wrap="wrap">{"Each subagent gets an available mascot when it starts. Open its live pane with /jev agent <n>, <type>, or <mascot>. Only finished subagents can be removed: use Remove, l, /jev agent <n> remove, or /jev agents clear. Press Ctrl+X X to close the focused pane."}</Text>
    </Box>
  );
}

/** One subagent's own live pane: its task and numbers at the top, then only its lines, as they happen. */
export function renderAgentPane(els: Els, view: View, run: AgentRun | undefined, n: number, act: Actions) {
  const { Box, Text, Button } = els;
  const buttons = (
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      <Button key="agent-jev" label="Jev live (j)" hotkey="j" onPress={() => act.jevLive()} />
      <Button key="agent-close" label="Close (x)" hotkey="x" onPress={() => act.closeAgent(n)} />
    </Box>
  );
  if (!run) {
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text color={INK.dim} wrap="wrap">{`Subagent #${n} is no longer available (the history was cleared or it fell outside the last 40 runs).`}</Text>
        {buttons}
      </Box>
    );
  }
  const [label, color] = AGENT_STATE[run.state];
  const lines: FeedEntry[] = view.feed.filter((entry) => entry.agent === run.id);
  // Its answer closes the log, in full, once it has ended.
  if (run.state !== "running" && run.text) {
    lines.push({ seq: -1, time: run.endedAt ?? view.now, who: "agent", agent: run.id, mascot: run.mascot, kind: "agent", tone: "info", text: `■ result: ${run.text}` });
  }
  const top = (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" columnGap={2}>
        {mascotArt(els, view, run)}
        <Box flexDirection="column" flexShrink={1}>
          <Text wrap="wrap">
            {agentName(els, run)}
            <Text bold color={color}>{`  ${label}`}</Text>
            <Text color={INK.dim}>{` · ${elapsed((run.endedAt ?? view.now) - run.startedAt)}`}</Text>
          </Text>
          <Text color={INK.ink} wrap="truncate-end">{run.description}</Text>
          <Text color={INK.dim} wrap="truncate-end">{agentModel(run)}</Text>
          <Text color={INK.faint} wrap="truncate-end">{agentNumbers(run)}</Text>
          {run.state === "running" ? (
            <Text wrap="truncate-end">
              <Text color={INK.faint}>now </Text>
              <Text bold color={INK.ink}>{run.activity ?? "running"}</Text>
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
      <Text color={INK.faint} wrap="truncate">⠿ task</Text>
      <Text color={INK.dim} wrap="wrap">{run.prompt.length > 480 ? run.prompt.slice(0, 479) + "…" : run.prompt}</Text>
    </Box>
  );
  const empty = "Nothing yet. This subagent's tool calls and responses appear here as they happen.";
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
  act.layout(Math.max(0, lines.length - 1), true);
  return (
    <Box flexDirection="column" height={view.rows} overflow="hidden">
      {top}
      <Text color={INK.faint} wrap="truncate">{"┄".repeat(Math.max(1, view.width))}</Text>
      {stuckLog(els, view, lines, logRows, empty, task)}
    </Box>
  );
}

/**
 * The Flow tab: the latest wave of subagents as one diagram, from the main session out to each
 * subagent and back, then your go-ahead and the edits. Before any wave, a pre-ship check sample.
 */
function flowView(els: Els, view: View) {
  const { Box, Text } = els;
  const lines = flowLines({
    flow: view.flow,
    agents: view.agents,
    ...(view.live.model ? { model: view.live.model } : {}),
    ...(view.live.effort ? { effort: view.live.effort } : {}),
    cwd: view.cwd,
    now: view.now,
    width: view.width - 2,
  });
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
      {view.flow.wave.length === 0 ? (
        <Box marginTop={1}>
          <Text color={INK.faint} wrap="wrap">
            A sample: no subagents yet. When Claude sends out a wave of subagents, this tab draws it live: each one's state and effort, the answers coming back, your go-ahead and the edits after.
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** One-click switches, each with what it does. */
function featuresView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button } = els;
  return (
    <Box flexDirection="column" rowGap={1}>
      {section(els, "Features")}
      {!view.routing ? <Text color={INK.pass} wrap="wrap">Routing is off (baseline mode): features are paused until it is turned back on.</Text> : null}
      {FEATURES.map((feature) => {
        const on = view.features[feature.id];
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Button
                key={"feature-" + feature.id}
                label={on ? `● Enabled (${feature.hotkey})` : `○ Disabled (${feature.hotkey})`}
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
          label={view.routing ? "Routing: on (r)" : "Routing: off (r)"}
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
  act.layout(max, false);
  const offset = Math.min(view.scroll, max);
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
          {`${offset > 0 ? "▲" : " "}${more ? "▼" : " "} ${Math.round((100 * offset) / max)}% · scroll for more`}
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
  const state = status(view.events, view.routing, view.now);
  const statusInk = STATUS_INK[state.kind];
  const { recent, confidence, latency, routedCount } = recentStats(view);
  const input = recent.reduce((s, event) => s + (event.usage?.input ?? 0), 0);
  const cached = recent.reduce((s, event) => s + (event.usage?.cached ?? 0), 0);
  const parts = [
    `${routedCount}/${recent.length} routed (5 min)`,
    latency === undefined ? undefined : `${latency} ms`,
    input ? `cache ${pct(cached, input)}` : undefined,
    "/jev",
  ].filter(Boolean);
  const now = view.live;
  const running = view.agents.filter((run) => run.state === "running").length;
  const used = now.jevUsed;
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text bold color={statusInk}>{`${view.live.asking ? "◌ Asking Jev…" : `${state.icon} Jev: ${state.title}`}`}</Text>
        {confidenceMeter(els, confidence, statusInk, 5)}
        {routedRail(els, routedCount, recent.length, statusInk, 10)}
        <Text color={INK.dim}>{parts.join(" · ")}</Text>
      </Box>
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text color={INK.ink}>{`◆ ${modelName(now.model)}${now.effort ? ` · ${now.effort}` : ""}`}</Text>
        {now.changed ? <Text color={INK.pass}>{`(Jev: ${now.changed})`}</Text> : null}
        <Text color={INK.faint}>·</Text>
        <Text color={used === undefined ? INK.faint : used ? INK.route : INK.dim}>
          {used === undefined ? "Jev: —" : used ? `Jev: ${now.decision ?? "consulted"}` : `Jev skipped: ${now.decision ?? "passthrough"}`}
        </Text>
        <Text color={INK.faint}>·</Text>
        <Text color={now.activity ? INK.ink : INK.faint}>{now.activity ? `▶ ${now.activity}` : "idle"}</Text>
        {running ? <Text color={INK.faint}>·</Text> : null}
        {running
          ? view.agents
              .filter((run) => run.state === "running")
              .map((run) => {
                const mascot = mascotOf(run);
                return <Text bold color={mascot ? hex(mascot.color) : INK.route}>{mascot?.face ?? "◆"}</Text>;
              })
          : null}
        {running ? <Text color={INK.route}>{`${running} subagent${running === 1 ? "" : "s"} · /jev agents`}</Text> : null}
      </Box>
    </Box>
  );
}
