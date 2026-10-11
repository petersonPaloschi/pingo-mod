import { text, type Locale } from "../../i18n.ts";
import { trunc } from "../theme.ts";
import { type BarState, type StepStatus, type Step, type Stage, type Bar, type Agent, type DeckState, type Where, type TodoInput, type TaskInput, type TaskResult } from "./types.ts";
import { MAX_BARS } from "./constants.ts";
import { agentsOf } from "./agents.ts";

// ---------- bars: plans and task lists ----------

export const isFinished = (status: StepStatus): boolean => status === "done" || status === "skipped";
const todoStatus = (status: string): StepStatus => (status === "completed" ? "done" : status === "in_progress" ? "active" : "pending");
export const allSteps = (bar: Bar): Step[] => bar.stages.flatMap((st) => st.steps);


export function where(bar: Bar): Where {
  const flat = bar.stages.flatMap((st, i) => st.steps.map((step, j) => ({ i, j, step })));
  const at = flat.findIndex((x) => !isFinished(x.step.status));
  const pos = at < 0 ? flat.length : at;
  const cur = flat[Math.min(pos, flat.length - 1)];
  const stage = cur?.i ?? 0;
  return {
    pos,
    total: flat.length,
    finished: flat.filter((x) => isFinished(x.step.status)).length,
    active: flat.find((x) => x.step.status === "active")?.step ?? null,
    stage,
    step: pos >= flat.length ? (bar.stages[stage]?.steps.length ?? 0) : (cur?.j ?? 0) + 1,
    stageSize: bar.stages[stage]?.steps.length ?? 0,
  };
}

export function newBar(id: string, title: string, source: string, stages: Stage[], now: number): Bar {
  return { id, title, source, stages, explicit: null, startedAt: now, doneAt: null, agentsDoneAt: null, dismissed: false };
}

export function barState(s: DeckState, bar: Bar): BarState {
  if (bar.explicit === "error") return "error";
  if (bar.id === "agents") {
    const list = agentsOf(s, bar.id);
    if (list.some((a) => a.state === "waiting")) return "needs_input";
    if (list.length && list.every((a) => a.state === "done" || a.state === "error")) {
      return list.some((a) => a.state === "error") ? "error" : "done";
    }
    return "running";
  }
  const steps = allSteps(bar);
  if (steps.length && steps.every((st) => isFinished(st.status))) return "done";
  if (bar.explicit === "needs_input") return "needs_input";
  if (agentsOf(s, bar.id).some((a) => a.state === "waiting")) return "needs_input";
  return "running";
}

export function liveBar(s: DeckState): Bar | undefined {
  return [...s.bars.values()].reverse().find((b) => b.id !== "agents" && !b.dismissed && barState(s, b) !== "done");
}

// a bar moves to the newest place; past the limit, the oldest finished bar leaves first
export function placeBar(s: DeckState, bar: Bar): void {
  s.bars.delete(bar.id);
  s.bars.set(bar.id, bar);
  while (s.bars.size > MAX_BARS) {
    const victim = [...s.bars.values()].find((b) => barState(s, b) === "done") ?? s.bars.values().next().value;
    if (!victim) break;
    s.bars.delete(victim.id);
  }
}

export function syncAgentsBar(s: DeckState, locale: Locale): void {
  const bar = s.bars.get("agents");
  if (!bar) return;
  const rank = (a: Agent) => (a.state === "done" ? 0 : a.state === "error" ? 1 : 2);
  const list = agentsOf(s, "agents").sort((a, b) => rank(a) - rank(b));
  bar.stages = [
    {
      name: text("deck.stage.agents", locale),
      steps: list.map((a) => ({ title: a.title, status: a.state === "done" ? "done" : a.state === "error" ? "error" : "active" })),
    },
  ];
}

// moves a demo bar one step: the active step finishes and the next pending one becomes active
export function stepOn(stages: Stage[]): Stage[] {
  const next = stages.map((st) => ({ ...st, steps: st.steps.map((x) => ({ ...x })) }));
  const steps = next.flatMap((st) => st.steps);
  let at = steps.findIndex((x) => x.status === "active");
  if (at < 0) at = steps.findIndex((x) => !isFinished(x.status));
  const current = steps[at];
  if (current) current.status = "done";
  const following = steps.slice(at + 1).find((x) => x.status === "pending");
  if (following) following.status = "active";
  return next;
}

// an approved plan's markdown: headings become stages, top-level list items steps
export function parsePlan(markdown: string, locale: Locale): { title: string; stages: Stage[] } | null {
  const clean = (x: string) =>
    x.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/^(\d+[.)]|[-*+]|\[[ xX]\])\s+/, "").trim();
  let title = "";
  const headed: { name: string; steps: Step[] }[] = [];
  const items: { depth: number; text: string }[] = [];
  for (const line of String(markdown).split(/\r?\n/)) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const text = clean(h[2] ?? "");
      if (h[1] === "#" && !title) title = text;
      else headed.push({ name: trunc(text, 60), steps: [] });
      continue;
    }
    const li = line.match(/^(\s*)(\d+[.)]|[-*+])\s+(.*)$/);
    if (!li) continue;
    const depth = Math.floor((li[1] ?? "").replace(/\t/g, "  ").length / 2);
    const text = trunc(clean(li[3] ?? ""), 80);
    if (!text) continue;
    items.push({ depth, text });
    const stage = headed[headed.length - 1];
    if (stage && depth === 0) stage.steps.push({ title: text, status: "pending" });
  }
  let stages = headed.filter((st) => st.steps.length > 0);
  if (!stages.length && items.length) {
    stages = [{ name: text("deck.stage.plan", locale), steps: items.filter((i) => i.depth === 0).map((i) => ({ title: i.text, status: "pending" as const })) }];
  }
  stages = stages.filter((st) => st.steps.length > 0);
  const first = stages[0]?.steps[0];
  if (!first) return null;
  first.status = "active";
  return { title: trunc(title, 60) || text("deck.title.plan", locale), stages };
}



// the todo list: the main thread's tasks become a bar, a subagent's counts become its line
export function upsertTodos(s: DeckState, key: string, todos: readonly TodoInput[], now: number, locale: Locale): void {
  const steps: Step[] = todos.map((t) => ({ title: trunc(t.content, 80), active: trunc(t.activeForm, 80), status: todoStatus(t.status) }));
  if (key !== "main") {
    const a = s.agents.get(key);
    if (a) {
      const cur = steps.find((st) => st.status === "active");
      a.todo = { done: steps.filter((st) => st.status === "done").length, total: steps.length, active: cur ? cur.active || cur.title : "" };
    }
    return;
  }
  const prev = s.bars.get("todo");
  const fresh = !prev || barState(s, prev) === "done" || prev.dismissed;
  const bar = fresh ? newBar("todo", s.lastPrompt || text("deck.title.tasks", locale), "todo", [], now) : prev;
  bar.stages = [{ name: text("deck.stage.tasks", locale), steps }];
  bar.explicit = null;
  placeBar(s, bar);
}



// the task tools' calls and results, kept as a list; then the task bar follows the list
export function applyTaskResult(s: DeckState, input: TaskInput, result: TaskResult, now: number, locale: Locale): void {
  if (input.tool === "TaskCreate") {
    const id = result?.task?.id;
    if (id == null) return;
    const list = [...s.tasks.values()].filter((t) => t.status !== "deleted");
    if (list.length && list.every((t) => t.status === "completed")) s.tasks.clear();
    s.tasks.set(String(id), {
      subject: trunc(input.subject ?? result?.task?.subject ?? "", 80),
      active: trunc(input.activeForm ?? "", 80),
      status: "pending",
    });
  } else if (input.tool === "TaskUpdate") {
    if (result && result.success === false) return;
    const t = s.tasks.get(String(input.taskId));
    if (!t) return;
    if (input.status) t.status = input.status;
    if (input.subject) t.subject = trunc(input.subject, 80);
    if (input.activeForm) t.active = trunc(input.activeForm, 80);
  } else if (Array.isArray(result?.tasks)) {
    const ids = new Set<string>();
    for (const r of result?.tasks ?? []) {
      const id = String(r.id);
      ids.add(id);
      const t = s.tasks.get(id);
      if (t) t.status = r.status;
    }
    for (const id of [...s.tasks.keys()]) if (!ids.has(id)) s.tasks.delete(id);
  }
  syncTasksBar(s, now, locale);
}

export function syncTasksBar(s: DeckState, now: number, locale: Locale): void {
  const list = [...s.tasks.values()].filter((t) => t.status !== "deleted");
  if (!list.length) return;
  const steps: Step[] = list.map((t) => ({ title: t.subject, active: t.active || t.subject, status: todoStatus(t.status) }));
  const prev = s.bars.get("tasks");
  const bar = prev && !prev.dismissed && barState(s, prev) !== "done" ? prev : newBar("tasks", s.lastPrompt || text("deck.title.tasks", locale), "tasks", [], now);
  bar.stages = [{ name: text("deck.stage.tasks", locale), steps }];
  placeBar(s, bar);
}

// ---------- routing ----------
