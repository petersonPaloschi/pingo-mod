import type { AgentRun, AgentState, FeedEntry } from "../../../types";
import { modelName } from "../../feed.ts";
import { formatCompact, formatNumber, text, type Locale, type LocaleKey } from "../../i18n.ts";
import { displayWidth, rowsOf } from "../../layout.ts";
import { GLYPH, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { memberFrame } from "../../deck/cast.ts";
import { type Els, type View, type Actions } from "../types.ts";
import { mascotOf } from "./mascot.ts";
import { conversation, stuckLog, logRule } from "./feed.tsx";
import { stepUsage } from "./models.tsx";
import { oneLine, feedBack, clip, INDENT, card, section, emptyLine } from "../shared.tsx";

const AGENT_STATE: Record<AgentState, [label: LocaleKey, glyph: string]> = {
  running: ["ui.agents.state.running", GLYPH.run],
  done: ["ui.agents.state.done", GLYPH.ok],
  error: ["ui.agents.state.error", GLYPH.fail],
  aborted: ["ui.agents.state.aborted", GLYPH.slash],
};

/** A time as `m:ss` (`h:mm:ss` from the hour): the same in every language. */
function clockTime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const rest = String(seconds % 60).padStart(2, "0");
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}:${rest}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${rest}`;
}

/** A subagent's figures in one line: tools, requests, tokens. */
function agentNumbers(run: AgentRun, locale: Locale): string {
  const input = run.inputUsageRequests === undefined || run.tokensIn === undefined ? "-" : formatCompact(run.tokensIn, locale);
  const output = run.outputUsageRequests === undefined || run.tokensOut === undefined ? "-" : formatCompact(run.tokensOut, locale);
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
  ].filter(Boolean).join(" - ");
  return partial ? `${counts} - ${partial}` : counts;
}

/** The model a subagent runs on, its effort, and what Jev chose for it. */
function agentModel(run: AgentRun, locale: Locale): string {
  return [modelName(run.model), run.effort ? text("ui.agent.model", locale, { effort: run.effort }) : "", run.jev ? text("ui.agent.jev", locale, { choice: run.jev }) : ""].filter(Boolean).join(" - ");
}

/** "Explore #3": the type and the number, in bold. */
function agentName(els: Els, run: AgentRun, locale: Locale) {
  const { Text } = els;
  const mascot = mascotOf(run);
  return (
    <Text>
      <Text bold color={INK.ink}>{`${GLYPH.on} ${mascot ? `${mascot.name}  ` : ""}`}</Text>
      <Text bold color={INK.ink}>{text("ui.agent.number", locale, { type: run.type, number: formatNumber(run.n, locale) })}</Text>
    </Text>
  );
}

/** A subagent's state as a glyph and a word, and how long it has run. */
function agentState(els: Els, view: View, run: AgentRun) {
  const { Text } = els;
  const [stateKey, glyph] = AGENT_STATE[run.state];
  return (
    <Text wrap="truncate">
      <Text bold color={INK.ink}>{`${glyph} ${text(stateKey, view.locale)}`}</Text>
      <Text color={INK.dim}>{` - ${clockTime((run.endedAt ?? view.now) - run.startedAt)}`}</Text>
    </Text>
  );
}

/** "Explore #3", the title of a subagent's section. */
const agentTitle = (run: AgentRun, locale: Locale) => text("ui.agent.number", locale, { type: run.type, number: formatNumber(run.n, locale) });

/** What a subagent is doing, or did: its activity while it runs, its last words once it has ended, else its task. */
function agentTask(run: AgentRun, locale: Locale): string {
  const said = run.text?.trim().split("\n")[0];
  return (run.state === "running" ? (run.activity ?? run.description) : (said || run.description)) || text("ui.agent.running", locale);
}

/** The subagents in the order the list shows them: each one's children right under it, running ones first, newest first. */
function agentTree(view: View, list: readonly AgentRun[]): { run: AgentRun; depth: number }[] {
  const parents = new Map<string, string>();
  for (const traced of view.trace.runs.flatMap((one) => one.agents)) if (traced.parent) parents.set(traced.id, traced.parent);
  const ids = new Set(list.map((run) => run.id));
  const kids = (id: string) => list.filter((run) => parents.get(run.id) === id);
  const out: { run: AgentRun; depth: number }[] = [];
  const place = (run: AgentRun, depth: number, seen: ReadonlySet<string>) => {
    out.push({ run, depth });
    for (const child of kids(run.id)) if (!seen.has(child.id)) place(child, depth + 1, new Set([...seen, child.id]));
  };
  for (const run of list) {
    const parent = parents.get(run.id);
    if (!parent || !ids.has(parent)) place(run, 0, new Set([run.id]));
  }
  return out;
}

/** The columns of a subagent's drawing. */
const DRAWING_COLUMNS = 8;

/** The subagent's drawing, 8 columns by 4 rows, as the cast draws it on the lane: still, crossed eyes after an error. */
function mascotDrawing(els: Els, run: AgentRun) {
  const { Box, Text } = els;
  const mascot = mascotOf(run);
  if (!mascot) return null;
  const cells = memberFrame({ kind: mascot.id, state: run.state === "error" ? "failed" : "idle", since: 0 }, 0, 1, false);
  return (
    <Box flexDirection="column" width={cells[0]!.length} flexShrink={0}>
      {cells.map((row, i) => <Text key={`drawing-${i}`} color={INK.ink} wrap="truncate">{row.map((cell) => cell[0]).join("")}</Text>)}
    </Box>
  );
}

/** The chosen subagent as a card: its drawing, then its name, its mascot, its state and its task, one to a row. */
function agentDetail(els: Els, view: View, run: AgentRun, width: number) {
  const { Box, Text } = els;
  const mascot = mascotOf(run);
  const [stateKey, glyph] = AGENT_STATE[run.state];
  // the words beside the drawing: the card's inside, less the drawing and its gap
  const room = Math.max(1, width - INDENT - DRAWING_COLUMNS - UI_DESIGN.space.sm);
  const lines = [
    <Text key="name" bold color={INK.ink} wrap="truncate">{oneLine(agentTitle(run, view.locale), room)}</Text>,
    mascot ? <Text key="mascot" color={INK.ink} wrap="truncate">{oneLine(text("ui.agents.detail.mascot", view.locale, { kind: mascot.id, form: text(`mascot.form.${mascot.id}` as LocaleKey, view.locale) }), room)}</Text> : null,
    <Text key="state" color={INK.ink} wrap="truncate">{oneLine(text("ui.agents.detail.state", view.locale, { glyph, state: text(stateKey, view.locale), time: clockTime((run.endedAt ?? view.now) - run.startedAt) }), room)}</Text>,
    <Text key="task" color={INK.ink} wrap="truncate">{oneLine(text("ui.agents.detail.task", view.locale, { task: agentTask(run, view.locale) }), room)}</Text>,
  ];
  return card(els, text("ui.agents.detail.title", view.locale), (
    <Box flexDirection="row" columnGap={UI_DESIGN.space.sm}>
      {mascotDrawing(els, run)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>{lines}</Box>
    </Box>
  ), { width });
}

/** One row of the list: the chosen mark, the branch of a child, the state's glyph, the name, the task and the time. */
function agentRow(els: Els, view: View, act: Actions, run: AgentRun, depth: number, chosen: boolean, nameWidth: number) {
  const { Button, Text } = els;
  const [, glyph] = AGENT_STATE[run.state];
  const branch = depth ? `${"  ".repeat(depth - 1)}${GLYPH.branch} ` : "";
  const lead = `${chosen ? GLYPH.open : " "} `;
  const time = clockTime((run.endedAt ?? view.now) - run.startedAt);
  const head = `${branch}${glyph} `;
  const name = clip(run.type, nameWidth).padEnd(nameWidth);
  const room = Math.max(1, view.width - displayWidth(lead) - displayWidth(head) - nameWidth - displayWidth(time) - 2);
  const task = oneLine(agentTask(run, view.locale), room);
  const gap = " ".repeat(Math.max(2, view.width - displayWidth(lead) - displayWidth(head) - nameWidth - displayWidth(task) - displayWidth(time)));
  return (
    <Button key={`agent-row-${run.n}`} label={agentTitle(run, view.locale)} plain onPress={() => act.openAgent(run.n)}>
      <Text bold={chosen} color={INK.ink}>{lead}</Text>
      <Text color={INK.ink}>{head}{name}</Text>
      <Text color={INK.dim}>{`${task}${gap}${time}`}</Text>
    </Button>
  );
}

/**
 * The Agents screen: a list with one row to each subagent Claude started (running ones first, a child under its
 * parent), then a card for the first running one, else the newest. A row opens that agent's own pane.
 */
export function agentsView(els: Els, view: View, act: Actions) {
  const { Box, Text, Button } = els;
  const list = [...view.agents].sort((a, b) => Number(b.state === "running") - Number(a.state === "running") || b.n - a.n);
  const finished = list.filter((run) => run.state !== "running").length;
  const shown = agentTree(view, list.slice(0, view.width >= 70 ? 6 : 4));
  const hidden = list.length - shown.length;
  const chosen = list[0];
  const nameWidth = Math.min(Math.floor(view.width / 3), Math.max(0, ...shown.map(({ run }) => run.type.length)) + 2);
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs} marginTop={UI_DESIGN.space.xs}>
      {list.length === 0 ? (
        emptyLine(els, text("ui.agents.emptyDescription", view.locale))
      ) : (
        <Box flexDirection="column">
          {shown.map(({ run, depth }) => agentRow(els, view, act, run, depth, run === chosen, nameWidth))}
        </Box>
      )}
      {hidden ? <Text color={INK.faint} wrap="truncate">{text("ui.agents.more", view.locale, { hidden: formatNumber(hidden, view.locale) })}</Text> : null}
      {chosen ? agentDetail(els, view, chosen, view.width) : null}
      {finished ? <Button key="agents-clear" label={text("ui.agents.clearFinished", view.locale, { count: formatNumber(finished, view.locale) })} hotkey="l" onPress={() => act.clearAgents()} /> : null}
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
  // the top is a card: who it is, its state, its task and its figures
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
      ], { width: view.width, glyph: AGENT_STATE[run.state][1] })}
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
                {" - "}
                {step.observed
                  ? text("ui.models.responseModel", view.locale, { model: modelName(step.observed) })
                  : text("ui.models.requestedModel", view.locale, { model: modelName(step.sent) })}
                {step.effort ? ` - ${text("ui.models.effort", view.locale, { effort: step.effort })}` : ""}
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
