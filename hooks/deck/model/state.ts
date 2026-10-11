import { MODEL_NAMES } from "../../core/contracts.ts";
import { text, type Locale, type LocaleKey } from "../../i18n.ts";
import { type Section } from "../settings.ts";
import { trunc } from "../theme.ts";
import { type Task, type Weather, type DeckState, type AgentOutcome, type ToolCall, type CallResult, type TodoInput, type TaskInput, type TaskResult, type DeckRow } from "./types.ts";
import { agentsOf, toolName, actionOf } from "./agents.ts";
import { newBar, barState, liveBar, placeBar, syncAgentsBar, parsePlan, upsertTodos, applyTaskResult, syncTasksBar } from "./bars.ts";

export function createDeckState(now: number, sessionId = "", date: Date = new Date(now)): DeckState {
  return {
    bars: new Map(),
    agents: new Map(),
    tasks: new Map(),
    inFlight: new Map(),
    waiting: new Set(),
    askedUser: false,
    lastSeen: new Map(),
    lastPrompt: "",
    route: null,
    routeHist: [],
    routeFail: null,
    routeFails: 0,
    sessionModel: "",
    seen: { model: "", effort: "" },
    activity: null,
    hist: {},
    usage: { context: null, rateLimits: [] },
    weather: null,
    demoRoute: false,
    demoUsage: false,
    turnActive: false,
    lastActivity: now,
    celebrateUntil: 0,
    spend: { day: today(date), dayUsd: 0, month: today(date).slice(0, 7), monthUsd: 0 },
    costSeen: null,
    sessionId,
  };
}

// ---------- small helpers ----------

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function slug(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "plan";
}

// the words the person typed: tagged blocks (system reminders, pasted content, attachments) removed
export function cleanPrompt(text: string): string {
  return String(text)
    .replace(/<([a-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fmtK(n: number | null | undefined): string {
  if (n == null) return "?";
  if (n >= 1_000_000) return +(n / 1_000_000).toFixed(1) + "M";
  return n >= 1000 ? Math.round(n / 1000) + "k" : String(n);
}

export const fmtUsd = (v: number): string => "$" + (v < 100 ? v.toFixed(2) : String(Math.round(v)));

export function today(date: Date): string {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

// "0:04:09", or "3d 5h 07m" once a day or more is left
export function countdown(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  let s = Math.max(0, Math.floor((Date.parse(iso) - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  s = s % 60;
  if (d > 0) return d + "d " + h + "h " + String(m).padStart(2, "0") + "m";
  return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// "1h7m", "3d 5h", "42m": for the rings, where seconds would only flicker
export function humanReset(iso: string | null | undefined, now: number): string {
  const s = Math.max(0, Math.floor((Date.parse(String(iso)) - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? d + "d " + h + "h" : h > 0 ? h + "h" + m + "m" : m + "m";
}

// how long a row has run, as the activity line shows it: "42s", then "1m 5s" (unpadded, unlike the i18n duration)
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
}

export function clockText(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

// WMO weather codes: the highest code of each band, its icon, and its word
const WMO: readonly (readonly [number, string, LocaleKey])[] = [
  [0, "☀", "deck.weather.clear"],
  [3, "⛅", "deck.weather.cloudy"],
  [48, "🌫", "deck.weather.fog"],
  [57, "☂", "deck.weather.drizzle"],
  [67, "☂", "deck.weather.rain"],
  [77, "❄", "deck.weather.snow"],
  [82, "☂", "deck.weather.showers"],
  [86, "❄", "deck.weather.snow"],
  [99, "⛈", "deck.weather.storm"],
];

export function weatherText(weather: Weather | null, city: { name: string } | null, desktop: boolean, locale: Locale): string {
  if (!weather) return city ? text("deck.weather.loading", locale, { city: city.name }) : "";
  const [, icon, key] = WMO.find(([max]) => weather.code <= max) ?? WMO[WMO.length - 1]!;
  const t = Math.round(weather.temp) + "°";
  return desktop ? icon + " " + t + " " + weather.name : t + " " + text(key, locale) + " · " + weather.name;
}

export function limitName(kind: string, locale: Locale): [string, string] {
  if (kind === "five_hour") return [text("deck.limit.session", locale), text("deck.limit.sessionTag", locale)];
  if (kind === "seven_day") return [text("deck.limit.weekly", locale), text("deck.limit.weeklyTag", locale)];
  if (kind === "seven_day_opus") return [text("deck.limit.opus", locale), text("deck.limit.opusTag", locale)];
  if (kind === "spend_limit") return [text("deck.limit.spend", locale), text("deck.limit.spendTag", locale)];
  return [kind, kind];
}

export function shortModel(id: string | null | undefined): string {
  const s = String(id ?? "").toLowerCase();
  for (const name of MODEL_NAMES) if (s.includes(name)) return name;
  return trunc(id ?? "", 14);
}

// ---------- agents ----------


// an agent ends: its state, its label, and its bar's done time once every agent there has ended

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
