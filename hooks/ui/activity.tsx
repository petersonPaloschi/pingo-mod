import type { ElementTable, RenderChildren } from "claude-code";
import type { AgentRun, AgentState, FeedEntry, RouteEvent, TraceState, TraceStep } from "../../types";
import { modelName } from "../feed.ts";
import { at, status, tally } from "../events.ts";
import { cellsOf, hex } from "../dots.ts";
import { trailLines } from "../trail.ts";
import { traceConsults } from "../trace.ts";
import { formatCompact, formatDuration, formatNumber, localeFor, text, type Locale, type LocaleKey } from "../i18n.ts";
import { rowsOf } from "../layout.ts";
import { css, DECK_DESIGN, GLYPH, HUE, UI_DESIGN, UI_INK as INK } from "../theme.ts";
import { MOODS, type Mood } from "../mascots/pingo.ts";
import { AGENT_MASCOTS, isMascot, type MascotId } from "../mascots/agents.ts";
import { memberFrame } from "../deck/cast.ts";
import { type Els, type View, type Actions } from "./types.ts";
import { clock, clip, oneLine, feedBack, moodOf, pill, INDENT, card, stack, section, emptyLine, liveLines, step, TONE_INK } from "./shared.tsx";

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
export const mascotOf = (run: AgentRun) => (isMascot(run.mascot) ? AGENT_MASCOTS[run.mascot] : undefined);

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
export function agentsView(els: Els, view: View, act: Actions) {
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
export function flowView(els: Els, view: View) {
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
export function modelsView(els: Els, view: View) {
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
