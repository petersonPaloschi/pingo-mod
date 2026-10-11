import { text, type Locale } from "../../../i18n.ts";
import { trunc } from "../../theme.ts";
import type { DeckState, AgentOutcome } from "../types.ts";
import { agentsOf } from "../agents.ts";
import { newBar, barState, liveBar, placeBar, syncAgentsBar } from "../bars.ts";
import { shortModel } from "./base.ts";

export function finishAgent(s: DeckState, id: string, outcome: AgentOutcome, now: number, locale: Locale): void {
  const a = s.agents.get(id);
  if (!a || a.state === "done" || a.state === "error") return;
  a.state = outcome === "done" ? "done" : "error";
  a.tool = text(outcome === "done" ? "deck.name.done" : outcome === "stopped" ? "deck.tool.stopped" : "deck.tool.failed", locale);
  a.endedAt = now;
  s.waiting.delete(id);
  syncAgentsBar(s, locale);
  const members = agentsOf(s, a.home);
  if (!members.every((x) => x.state === "done" || x.state === "error")) return;
  if (a.home === "activity") {
    if (s.activity) s.activity.agentsDoneAt = now;
  } else {
    const bar = s.bars.get(a.home);
    if (bar) bar.agentsDoneAt = now;
  }
}

// the runtime's view of its agents: anything it reports finished, ends here
export function settleAgents(
  s: DeckState,
  infos: readonly { id: string; status: string }[],
  now: number,
  locale: Locale,
): void {
  if (![...s.agents.values()].some((a) => a.state === "running" || a.state === "waiting")) return;
  for (const info of infos) {
    const a = s.agents.get(info.id);
    if (!a || a.state === "done" || a.state === "error") continue;
    if (info.status === "completed") finishAgent(s, a.id, "done", now, locale);
    else if (info.status === "failed") finishAgent(s, a.id, "failed", now, locale);
    else if (info.status === "killed") finishAgent(s, a.id, "stopped", now, locale);
  }
}

// ---------- what the hooks feed in ----------

export const hasLiveAgents = (s: DeckState): boolean => [...s.agents.values()].some((a) => a.state === "running" || a.state === "waiting");

// a subagent starts: its row goes on the bar that started it, else the live bar, else the activity line, else the Agents bar
export function startAgent(
  s: DeckState,
  spawn: { id: string; description: string; subagentType: string; model: string; parentAgentId?: string },
  now: number,
  locale: Locale,
): void {
  const parent = spawn.parentAgentId ? s.agents.get(spawn.parentAgentId) : undefined;
  let home: string | undefined = parent?.home ?? liveBar(s)?.id;
  if (!home && s.activity && !s.activity.done) {
    home = "activity";
    if (s.activity.agentsDoneAt) {
      for (const a of [...s.agents.values()]) if (a.home === "activity" && a.state === "done") s.agents.delete(a.id);
      s.activity.agentsDoneAt = null;
    }
  }
  if (!home) {
    const agentsBar = s.bars.get("agents");
    if (!agentsBar || barState(s, agentsBar) === "done") {
      for (const a of [...s.agents.values()]) if (a.home === "agents") s.agents.delete(a.id);
      placeBar(s, newBar("agents", text("deck.name.agents", locale), "agents", [], now));
    }
    home = "agents";
  }
  const bar = s.bars.get(home);
  if (bar?.agentsDoneAt) {
    for (const a of [...s.agents.values()]) if (a.home === home && a.state === "done") s.agents.delete(a.id);
    bar.agentsDoneAt = null;
  }
  s.agents.set(spawn.id, {
    id: spawn.id,
    title: trunc(spawn.description || spawn.subagentType, 60),
    state: "running",
    tool: text("deck.tool.starting", locale),
    model: shortModel(spawn.model),
    startedAt: now,
    endedAt: null,
    depth: parent ? 1 : 0,
    home,
    todo: null,
  });
  syncAgentsBar(s, locale);
}

/** A tool call as the bars read it: its tool, the subagent it runs in, its tool-use id and its input. */
