import { text, type Locale } from "../../../i18n.ts";
import type { Section } from "../../settings.ts";
import { trunc } from "../../theme.ts";
import type { DeckState, ToolCall, CallResult, TodoInput, TaskInput, TaskResult, DeckRow } from "../types.ts";
import { agentsOf, toolName, actionOf } from "../agents.ts";
import { newBar, liveBar, placeBar, parsePlan, upsertTodos, applyTaskResult, syncTasksBar } from "../bars.ts";
import { cleanPrompt, slug } from "./base.ts";

const textOf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

// a tool call begins: its tool on the subagent's line, its action and count on the activity line, a todo list or a question

export function callStart(s: DeckState, call: ToolCall, now: number, locale: Locale): void {
  const key = call.agentId ?? "main";
  const a = call.agentId ? s.agents.get(call.agentId) : undefined;
  if (a) {
    if (a.state === "waiting") a.state = "running";
    a.tool = toolName(call.tool);
  }
  if (!call.agentId && s.activity && !s.activity.done) {
    s.activity.tools += 1;
    s.activity.action = actionOf(
      { tool: call.tool, file_path: textOf(call.input.file_path), notebook_path: textOf(call.input.notebook_path), command: textOf(call.input.command) },
      locale,
    );
  }
  if (call.tool === "TodoWrite" && Array.isArray(call.input.todos)) upsertTodos(s, key, call.input.todos as TodoInput[], now, locale);
  if (call.tool === "AskUserQuestion") {
    s.waiting.add(key);
    if (a) a.state = "waiting";
    if (key === "main") {
      const bar = liveBar(s);
      if (bar) bar.explicit = "needs_input";
    }
  }
  if (call.toolUseId) s.inFlight.set(call.toolUseId, key);
}

// a tool call is over, however it ended: it leaves the in-flight set and its waiting mark clears
export function callDone(s: DeckState, call: ToolCall): void {
  const key = call.agentId ?? "main";
  if (call.toolUseId) s.inFlight.delete(call.toolUseId);
  if (s.waiting.delete(key)) {
    const a = call.agentId ? s.agents.get(call.agentId) : undefined;
    if (a && a.state === "waiting") a.state = "running";
    if (key === "main" && !s.askedUser) for (const bar of s.bars.values()) if (bar.explicit === "needs_input") bar.explicit = null;
  }
}

// a tool call that ran cleanly: a task tool on the main thread updates the task list; an approved plan becomes a bar
export function callAnswered(s: DeckState, call: ToolCall, ran: CallResult, now: number, locale: Locale): void {
  const ok = ran.deny === undefined && ran.isError !== true;
  if (ok && !call.agentId && /^Task(Create|Update|List)$/.test(call.tool)) {
    const input: TaskInput = {
      tool: call.tool,
      subject: textOf(call.input.subject),
      activeForm: textOf(call.input.activeForm),
      taskId: call.input.taskId as string | number | undefined,
      status: textOf(call.input.status),
    };
    applyTaskResult(s, input, ran.result as TaskResult, now, locale);
  }
  if (call.tool === "ExitPlanMode" && ok) {
    const text = textOf(call.input.plan) ?? textOf((ran.result as { plan?: unknown } | null | undefined)?.plan);
    const plan = text === undefined ? null : parsePlan(text, locale);
    if (plan) placeBar(s, newBar("plan-" + slug(plan.title), plan.title, "plan", plan.stages, now));
  }
}

// a call held past its delay waits for the person (a permission prompt): its subagent, or the live bar for the main thread
export function markWaiting(s: DeckState, key: string): void {
  s.waiting.add(key);
  const a = s.agents.get(key);
  if (a && a.state === "running") a.state = "waiting";
  if (key === "main") {
    const bar = liveBar(s);
    if (bar) bar.explicit = "needs_input";
  }
}

// a reply ending in a question: the live bar waits for the person; false when no bar is live
export function askedQuestion(s: DeckState): boolean {
  const bar = liveBar(s);
  if (!bar) return false;
  bar.explicit = "needs_input";
  s.askedUser = true;
  return true;
}

// a prompt the person typed (not a slash command): it titles the bars, and the waiting marks clear
export function promptSubmitted(s: DeckState, text: string, now: number): void {
  if (!text || text.startsWith("/")) return;
  s.lastPrompt = trunc(cleanPrompt(text), 40) || s.lastPrompt;
  s.askedUser = false;
  s.lastActivity = now;
  for (const bar of s.bars.values()) if (bar.explicit === "needs_input") bar.explicit = null;
}

// a turn starts: a prompt's turn gets an activity line, which takes the last prompt as its title
export function turnStarted(s: DeckState, prompt: string, now: number, locale: Locale): void {
  if (!prompt.startsWith("/")) {
    for (const a of [...s.agents.values()]) if (a.home === "activity") s.agents.delete(a.id);
    s.activity = {
      title: s.lastPrompt || text("deck.title.working", locale),
      start: now,
      tools: 0,
      action: text("deck.action.thinking", locale),
      done: false,
      doneAt: null,
      agentsDoneAt: null,
    };
  }
  s.turnActive = true;
  s.lastActivity = now;
}

// the main turn ends: its activity line is done, and the pet's mood follows
export function turnEnded(s: DeckState, now: number): void {
  if (s.activity && !s.activity.done) {
    s.activity.done = true;
    s.activity.doneAt = now;
  }
  s.turnActive = false;
  s.lastActivity = now;
}

// the runtime's own task events: a task created, a task completed
export function taskCreated(s: DeckState, id: string, subject: string, now: number, locale: Locale): void {
  if (!s.tasks.has(id)) s.tasks.set(id, { subject: trunc(subject, 80), active: "", status: "pending" });
  syncTasksBar(s, now, locale);
}

export function taskCompleted(s: DeckState, id: string, now: number, locale: Locale): void {
  const t = s.tasks.get(id);
  if (t) t.status = "completed";
  syncTasksBar(s, now, locale);
}

// the ✕ on a row: an activity line ends with its agents; a bar leaves with its agents (a plan or task list is only
// dismissed); a route or meter row names the section to hide, which the caller turns off
export function dismissRow(s: DeckState, row: DeckRow): Section | null {
  if (row.kind === "activity") {
    for (const a of [...s.agents.values()]) if (a.home === "activity") s.agents.delete(a.id);
    s.activity = null;
    return null;
  }
  if (row.kind === "bar" && row.bar) {
    const bar = row.bar;
    for (const a of agentsOf(s, bar.id)) s.agents.delete(a.id);
    if (bar.id === "todo" || bar.id === "tasks") bar.dismissed = true;
    else s.bars.delete(bar.id);
    if (bar.id === "tasks") s.tasks.clear();
    return null;
  }
  return row.kind === "route" ? "route" : (row.section ?? null);
}

// /deck clear, and a session cleared: the bars, subagents and tasks go; the spend and the route stay
export function clearRows(s: DeckState): void {
  s.bars.clear();
  s.agents.clear();
  s.tasks.clear();
}

// ---------- what Deck keeps across sessions ----------
