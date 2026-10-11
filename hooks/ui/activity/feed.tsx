import type { RenderChildren } from "claude-code";
import type { FeedEntry, RouteEvent, TraceState } from "../../../types";
import { modelName } from "../../feed.ts";
import { status } from "../../events.ts";
import { hex } from "../../dots.ts";
import { traceConsults } from "../../trace.ts";
import { formatCompact, formatNumber, localeFor, text, type Locale } from "../../i18n.ts";
import { rowsOf } from "../../layout.ts";
import { css, GLYPH, HUE, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { MOODS, type Mood } from "../../mascots/pingo.ts";
import { AGENT_MASCOTS, isMascot } from "../../mascots/agents.ts";
import { type Els, type View } from "../types.ts";
import { clock, clip, moodOf, pill, card, liveLines, TONE_INK } from "../shared.tsx";
import { mascotOf } from "./mascot.ts";
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
export function feedLine(els: Els, view: View, entry: FeedEntry, maxRows?: number) {
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
export function conversation(els: Els, view: View, lines: readonly FeedEntry[], empty: string, maxEntryRows?: number) {
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
export function stuckLog(els: Els, view: View, lines: readonly FeedEntry[], rows: number, empty: string, back: number, before?: RenderChildren) {
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
export function logRule(els: Els, view: View, title: string) {
  const { Text } = els;
  return (
    <Text wrap="truncate">
      <Text bold color={INK.brand}>{`${GLYPH.run} `}</Text>
      <Text bold color={INK.ink}>{title}</Text>
    </Text>
  );
}

/** The live log: who speaks, the latest Jev call pinned, then its newest `ENTRIES_SHOWN` events, newest first. */
export function liveView(els: Els, view: View) {
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