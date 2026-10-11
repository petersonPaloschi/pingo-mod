import type { ElementTable } from "claude-code";
import type { AgentRun, AgentState, FeedEntry } from "../../../types";
import { modelName } from "../../feed.ts";
import { cellsOf, hex } from "../../dots.ts";
import { formatCompact, formatDuration, formatNumber, text, type Locale, type LocaleKey } from "../../i18n.ts";
import { DECK_DESIGN, GLYPH, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { type MascotId } from "../../mascots/agents.ts";
import { memberFrame } from "../../deck/cast.ts";
import { type Els, type View, type Actions } from "../types.ts";
import { mascotOf } from "./mascot.ts";
import { conversation, stuckLog, logRule } from "./feed.tsx";
import { stepUsage } from "./models.tsx";
import { oneLine, feedBack, clip, pill, INDENT, card, stack, section, emptyLine } from "../shared.tsx";

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
