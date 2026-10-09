// Deck state and its rules: plans and task bars, subagent strips, the activity line, model routes,
// usage history, spend, and the rows the band draws. Pure: every function takes the state it reads
// and the time it needs; the few that change state say so in their name and take DeckState first.
// Drawing lives in rows.ts; the hooks that feed this module live with the band.

import type { RouteEvent } from "../../types";
import { EFFORTS } from "../core/contracts.ts";
import { DECK_GLYPH } from "../theme.ts";
import { text, type Locale, type LocaleKey } from "../i18n.ts";
import { type DeckSettings, type Section, type Show, SECTIONS } from "./settings.ts";
import { trunc } from "./theme.ts";

const MAX_BARS = 4;
const BAR_LINGER_MS = 120_000;
const AGENTS_LINGER_MS = 30_000;
const ACTIVITY_LINGER_MS = 20_000;
const FOLD_MS = 5000;
const MAX_STRIPS = 4;
export const ASK_DELAY_MS = 600;
const SLEEPY_MS = 180_000;
const HIST_KEEP_MS = 26 * 3600_000;
const HIST_MAX_POINTS = 400;
const ROUTE_HISTORY = 8;
const ROUTE_CARRY_MS = 5000;
const CELEBRATE_MS = 3500;
/** Sessions whose spend already counted is kept; older ones are dropped. */
export const COST_SESSIONS = 30;
/** The version `/deck version` and `/deck status` print: the plugin's own. Keep it equal to `version` in `.claude-plugin/plugin.json`. */
export const DECK_VERSION = "0.1.0";

export { EFFORTS };
export const TIER_MODEL: Record<string, string> = { fast: "haiku", balanced: "sonnet", deep: "opus" };
const MODEL_RANK: Record<string, number> = { haiku: 0, sonnet: 1, opus: 2 };

// the row styles: a state's glyph and its color role (rows.ts maps a style to the palette)
export type RowStyle = keyof typeof DECK_GLYPH;
export const STYLE_GLYPH: Record<RowStyle, string> = DECK_GLYPH;
const STATE_STYLE: Record<BarState, RowStyle> = { running: "run", needs_input: "ask", error: "hot", done: "done" };

export type BarState = "running" | "needs_input" | "done" | "error";
export type StepStatus = "pending" | "active" | "done" | "skipped" | "error";
export type Step = { title: string; status: StepStatus; active?: string };
export type Stage = { name: string; steps: Step[] };

export type Bar = {
  id: string;
  title: string;
  source: string;
  stages: Stage[];
  explicit: "needs_input" | "error" | null;
  startedAt: number;
  doneAt: number | null;
  agentsDoneAt: number | null;
  dismissed: boolean;
};

export type AgentState = "running" | "waiting" | "done" | "error";
export type AgentTodo = { done: number; total: number; active: string };
export type Agent = {
  id: string;
  title: string;
  state: AgentState;
  tool: string;
  model: string;
  startedAt: number;
  endedAt: number | null;
  depth: number;
  /** The bar this agent belongs to: a bar id, or "activity". */
  home: string;
  todo: AgentTodo | null;
};

export type Task = { subject: string; active: string; status: string };

export type Activity = {
  title: string;
  start: number;
  tools: number;
  action: string;
  done: boolean;
  doneAt: number | null;
  agentsDoneAt: number | null;
};

export type ContextUsage = { tokens: number; window: number; percent: number };
export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string | null };
export type Usage = { context: ContextUsage | null; rateLimits: RateLimit[] };
export type UsageReading = { context?: ContextUsage | null; rateLimits?: RateLimit[]; cost?: { usd: number } | null };
export type HistPoint = { t: number; p: number };
export type Weather = { temp: number; code: number; name: string };
export type Spend = { day: string; dayUsd: number; month: string; monthUsd: number };

// a route as the router reported it, or the failure that replaced it
export type RouteRoute = {
  noAnswer: false;
  /** Jev's tier: fast, balanced or deep; "" when the source named no tier. */
  tier: string;
  conf: number | null;
  /** The model the router switched to; "" when it kept the session's model. */
  model: string;
  effort: string;
  unchanged: boolean;
  effortScore: number | null;
  risky: number | null;
  ms: number | null;
  at: number;
};
export type RouteNoAnswer = {
  noAnswer: true;
  /** Why the router's last answer failed; null when the source gave no reason. */
  reason: string | null;
  fails: number;
  last: RouteRoute | null;
  at: number;
};
export type DeckRoute = RouteRoute | RouteNoAnswer;

export type DeckState = {
  bars: Map<string, Bar>;
  agents: Map<string, Agent>;
  tasks: Map<string, Task>;
  /** tool-use id -> agent id, while a tool call runs. */
  inFlight: Map<string, string>;
  waiting: Set<string>;
  askedUser: boolean;
  lastSeen: Map<string, { state: BarState; stage: number }>;
  lastPrompt: string;
  route: DeckRoute | null;
  /** Recent route outcomes, oldest first: a model name, "~model" for a suggestion, or "none". */
  routeHist: string[];
  routeFail: string | null;
  routeFails: number;
  sessionModel: string;
  seen: { model: string; effort: string };
  activity: Activity | null;
  hist: Record<string, HistPoint[]>;
  usage: Usage;
  weather: Weather | null;
  /** The demo fills in a sample route and limits until real readings arrive. */
  demoRoute: boolean;
  demoUsage: boolean;
  turnActive: boolean;
  lastActivity: number;
  celebrateUntil: number;
  spend: Spend;
  /** Spend this session already counted, in USD. */
  costSeen: number | null;
  sessionId: string;
};

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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

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
  if (s.includes("haiku")) return "haiku";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("opus")) return "opus";
  if (s.includes("fable")) return "fable";
  return trunc(id ?? "", 14);
}

// ---------- agents ----------

export function agentsOf(s: DeckState, home: string): Agent[] {
  return [...s.agents.values()].filter((a) => a.home === home);
}

// the tool's name as a strip shows it: an MCP tool's server prefix dropped
export const toolName = (tool: string): string => String(tool).replace(/^mcp__[^_]+__/, "");

// the verbs an action line uses, from the tool a call ran
export type ToolUse = { tool: string; file_path?: string | null; notebook_path?: string | null; command?: string | null };

export function actionOf(e: ToolUse, locale: Locale): string {
  const base = (p: string | null | undefined) => String(p ?? "").split("/").pop() ?? "";
  switch (e.tool) {
    case "Read":
      return text("deck.action.reading", locale, { file: base(e.file_path) });
    case "Grep":
    case "Glob":
      return text("deck.action.searching", locale);
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return text("deck.action.editing", locale, { file: base(e.file_path ?? e.notebook_path) });
    case "Bash":
      return text("deck.action.running", locale, { command: trunc(String(e.command ?? "").trim().split(/\s+/).slice(0, 2).join(" "), 22) });
    case "WebFetch":
    case "WebSearch":
      return text("deck.action.browsing", locale);
    case "Agent":
    case "Task":
      return text("deck.action.delegating", locale);
    case "TodoWrite":
      return text("deck.action.planning", locale);
    default:
      return toolName(e.tool);
  }
}

export type AgentOutcome = "done" | "failed" | "stopped";

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
export type ToolCall = { tool: string; agentId?: string; toolUseId?: string; input: Record<string, unknown> };
/** What a tool call answered: a denial or an error means it did not run cleanly. */
export type CallResult = { result?: unknown; deny?: unknown; isError?: unknown };

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

export type SavedSpend = { spend: Spend; costSeen: Record<string, number> };

// the counts saved per session, sanitized
function costSeenMap(saved: unknown): Record<string, number> {
  const map: Record<string, number> = {};
  const raw = isRecord(saved) && isRecord(saved.costSeen) ? saved.costSeen : {};
  for (const [id, usd] of Object.entries(raw)) if (typeof usd === "number" && Number.isFinite(usd)) map[id] = usd;
  return map;
}

// what this session has counted so far, from the saved record; null when it has counted nothing yet
export function costSeenFrom(saved: unknown, sessionId: string): number | null {
  return costSeenMap(saved)[sessionId] ?? null;
}

// the spend record to save: the day and month totals, and what each of the last sessions has counted
export function spendRecord(s: DeckState, saved: unknown, sessionId: string): SavedSpend {
  const seen = costSeenMap(saved);
  if (s.costSeen != null) seen[sessionId] = s.costSeen;
  const ids = Object.keys(seen);
  for (const id of ids.slice(0, Math.max(0, ids.length - COST_SESSIONS))) delete seen[id];
  return { spend: s.spend, costSeen: seen };
}

// the usage history as saved: each window's points within the retention, the newest of them kept
export function histFrom(saved: unknown, now: number): Record<string, HistPoint[]> {
  const out: Record<string, HistPoint[]> = {};
  if (!isRecord(saved)) return out;
  for (const [key, list] of Object.entries(saved)) {
    if (!Array.isArray(list)) continue;
    const points = list.filter((x): x is HistPoint => isRecord(x) && typeof x.t === "number" && typeof x.p === "number" && now - x.t <= HIST_KEEP_MS);
    if (points.length) out[key] = points.slice(-HIST_MAX_POINTS);
  }
  return out;
}

// ---------- bars: plans and task lists ----------

const isFinished = (status: StepStatus): boolean => status === "done" || status === "skipped";
const todoStatus = (status: string): StepStatus => (status === "completed" ? "done" : status === "in_progress" ? "active" : "pending");
const allSteps = (bar: Bar): Step[] => bar.stages.flatMap((st) => st.steps);

export type Where = {
  pos: number;
  total: number;
  finished: number;
  active: Step | null;
  stage: number;
  step: number;
  stageSize: number;
};

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

export type TodoInput = { content: string; activeForm: string; status: string };

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

export type TaskInput = { tool: string; subject?: string; activeForm?: string; taskId?: string | number; status?: string };
export type TaskResult = { task?: { id?: string | number | null; subject?: string } | null; success?: boolean; tasks?: { id: string | number; status: string }[] } | null;

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

export function emptyRoute(now: number): RouteRoute {
  return { noAnswer: false, tier: "", conf: null, model: "", effort: "", unchanged: true, effortScore: null, risky: null, ms: null, at: now };
}

export function dropDemoRoute(s: DeckState): void {
  if (!s.demoRoute) return;
  s.demoRoute = false;
  s.route = null;
  s.routeHist.splice(0);
}

function pushHist(s: DeckState, entry: string): void {
  s.routeHist.push(entry);
  if (s.routeHist.length > ROUTE_HISTORY) s.routeHist.shift();
}

// the history token for a route: an applied model, a suggested one ("~"), or a failure
function histToken(tier: string, model: string): string {
  return model ? model : "~" + (TIER_MODEL[tier] ?? tier);
}

// "jev · fast 0.87 → haiku/low", "jev · fast 0.41 · unchanged", "jev · no answer"
export function readRouteStatus(s: DeckState, text: string, now: number): boolean {
  const t = String(text);
  if (/^jev · no answer/.test(t)) {
    dropDemoRoute(s);
    const prev = s.route ? (s.route.noAnswer ? s.route.last : s.route) : null;
    s.route = { noAnswer: true, reason: s.routeFail, fails: s.routeFails, last: prev, at: now };
    pushHist(s, "none");
    return true;
  }
  const m = t.match(/^jev · (\w+) ([\d.]+|n\/d)(?: → (\S+)| · unchanged)?/);
  if (!m) return false;
  dropDemoRoute(s);
  let model = "";
  let effort = "";
  for (const part of String(m[3] ?? "").split("/").filter(Boolean)) {
    if ((EFFORTS as readonly string[]).includes(part)) effort = part;
    else model = shortModel(part);
  }
  const tier = m[1] ?? "";
  const prev = s.route && !s.route.noAnswer && now - s.route.at < ROUTE_CARRY_MS ? s.route : emptyRoute(now);
  s.route = {
    ...prev,
    noAnswer: false,
    tier,
    conf: m[2] === "n/d" ? null : Number(m[2]),
    model,
    effort,
    unchanged: !m[3],
    at: now,
  };
  // filled when the router changed the model, outlined when Jev only suggested it
  pushHist(s, histToken(tier, model));
  return true;
}

// "[jev-model-router] jev: tier fast (0.87) · effort 0.4 → low (0.71) · risky 0.02 · 249ms"
export function readRouteLog(s: DeckState, text: string, now: number): boolean {
  const t = String(text);
  const fail =
    t.match(/\] (\w+) responded (\d+)/)?.slice(1).join(" ") ??
    (t.match(/classification passed (\d+)ms/)?.[1] ? "timeout " + t.match(/classification passed (\d+)ms/)![1] + "ms" : null) ??
    (/classification failed|built-in classifier failed/.test(t) ? "request failed" : null);
  if (fail) {
    s.routeFail = fail;
    s.routeFails++;
    return true;
  }
  const m = t.match(/jev: tier (\w+) \(([\d.]+|n\/d)\)(?: · effort ([\d.]+) → (\w+) \([^)]*\))?(?: · risky ([\d.]+|n\/d))?(?: · (\d+)ms)?/);
  if (!m) return false;
  dropDemoRoute(s);
  s.routeFail = null;
  s.routeFails = 0;
  const prev = s.route && !s.route.noAnswer ? s.route : emptyRoute(now);
  s.route = {
    ...prev,
    noAnswer: false,
    tier: m[1] ?? "",
    conf: m[2] === "n/d" ? null : Number(m[2]),
    effortScore: m[3] ? Number(m[3]) : null,
    risky: m[5] && m[5] !== "n/d" ? Number(m[5]) : null,
    ms: m[6] ? Number(m[6]) : null,
    at: now,
  };
  return true;
}

// Pingo's own route events, in the same shape as the deck's route. Mapping:
//   tier        the deck tier of the choice Jev made: a tier name, or its model (haiku/sonnet/opus); else ""
//   model       the model the request ran with, only when Jev changed it (mode "hint"); "" when kept
//   effort      the effort the request was sent with
//   conf        Jev's confidence (jev.confidence, else the event's confidence)
//   ms          the request's duration
//   risky       null (Pingo reports no risk score)
//   failure     an event with an error becomes a no-answer route, reason = the error
export function routeFromPingoEvent(e: RouteEvent, now: number): DeckRoute {
  const parsed = Date.parse(e.time);
  const at = Number.isFinite(parsed) ? parsed : now;
  if (e.error) return { noAnswer: true, reason: trunc(e.error, 40), fails: 1, last: null, at };
  const choice = e.jev?.choice ?? "";
  const tier = TIER_MODEL[choice] ? choice : Object.keys(TIER_MODEL).find((k) => TIER_MODEL[k] === choice) ?? "";
  const model = e.mode === "hint" && e.model ? shortModel(e.model) : "";
  return {
    noAnswer: false,
    tier,
    conf: e.jev?.confidence ?? e.confidence ?? null,
    model,
    effort: e.effort ?? "",
    unchanged: !model,
    effortScore: null,
    risky: null,
    ms: e.durationMs,
    at,
  };
}

// takes a Pingo route event into the state, the same way a deck route line would be taken
export function takePingoRoute(s: DeckState, e: RouteEvent, now: number): void {
  dropDemoRoute(s);
  const route = routeFromPingoEvent(e, now);
  s.route = route;
  if (route.noAnswer) {
    s.routeFail = route.reason;
    s.routeFails = 1;
    pushHist(s, "none");
    return;
  }
  s.routeFail = null;
  s.routeFails = 0;
  pushHist(s, histToken(route.tier, route.model));
}

export type RouteView = {
  noAnswer: boolean;
  reason: string;
  hint: string;
  from: string;
  want: string;
  to: string;
  effort: string;
  dir: "↓" | "↑" | "=";
  conf: number | null;
  risky: number | null;
  ms: number | null;
  tier: string;
  unapplied: boolean;
};

export function routeRow(s: DeckState, show: Show, locale: Locale): DeckRow | null {
  if (!show.route || !s.route) return null;
  const from = shortModel(s.seen.model || s.sessionModel) || text("deck.route.session", locale);
  const title = text("deck.title.modelRoute", locale);
  const route = s.route;
  if (route.noAnswer) {
    const reason = route.reason ?? text("deck.route.noAnswer", locale);
    const view: RouteView = {
      noAnswer: true,
      reason,
      hint: route.fails >= 3 ? text("deck.route.checkKey", locale) : "",
      from,
      want: from,
      to: from,
      effort: s.seen.effort || "",
      dir: "=",
      conf: null,
      risky: null,
      ms: null,
      tier: "",
      unapplied: false,
    };
    return {
      id: "route",
      kind: "route",
      style: "warn",
      title,
      pct: 0,
      marks: [],
      right: "! " + text("deck.route.noAnswer", locale),
      short: "⇄ " + from + " · " + text("deck.route.noAnswer", locale),
      strips: null,
      route: view,
    };
  }
  if (!route.tier && !route.model) return null;
  const want = route.tier ? (TIER_MODEL[route.tier] ?? route.tier) : "";
  const to = route.model || from;
  const effort = route.effort || s.seen.effort || "";
  const toRank = MODEL_RANK[to];
  const fromRank = MODEL_RANK[from];
  // only a model the router actually switched to counts as cheaper or deeper
  const dir: "↓" | "↑" | "=" =
    !route.model ? "=" : toRank != null && fromRank != null ? (toRank < fromRank ? "↓" : toRank > fromRank ? "↑" : "=") : "=";
  const view: RouteView = {
    noAnswer: false,
    reason: "",
    hint: "",
    from,
    want,
    to,
    effort,
    dir,
    conf: route.conf,
    risky: route.risky,
    ms: route.ms,
    tier: route.tier,
    unapplied: !!want && want !== to,
  };
  return {
    id: "route",
    kind: "route",
    style: "run",
    title,
    pct: 0,
    marks: [],
    right: dir === "↓" ? text("deck.route.cheaper", locale) : dir === "↑" ? text("deck.route.deeper", locale) : text("deck.route.keptMark", locale),
    short: "⇄ " + to + (effort ? "·" + effort : ""),
    strips: null,
    route: view,
  };
}

// ---------- rows ----------

export type Mark = { f: number; stage?: boolean };
export type Strips = { shown: Agent[]; hidden: Agent[] };

export type DeckRow = {
  id: string;
  kind: "bar" | "activity" | "meter" | "route";
  style: RowStyle;
  title: string;
  pct: number;
  marks: Mark[];
  /** The value at the row's right edge. */
  right: string;
  /** The compact line for the collapsed chips and the spoken status. */
  short: string;
  strips: Strips | null;
  state?: BarState;
  /** Finished steps: how far the row has come, for the tick cue. */
  stage?: number;
  animating?: boolean;
  bar?: Bar;
  name?: string;
  count?: string;
  steps?: number;
  finished?: number;
  limit?: boolean;
  section?: Section;
  kindKey?: string;
  resets?: string;
  hist?: number[];
  rate?: string;
  route?: RouteView;
};

export function visibleStrips(s: DeckState, home: string, agentsDoneAt: number | null, show: Show, now: number): Strips | null {
  if (!show.agents) return null;
  const list = agentsOf(s, home);
  if (!list.length) return null;
  const hasError = list.some((a) => a.state === "error");
  if (agentsDoneAt && now - agentsDoneAt > FOLD_MS && !hasError) return null;
  if (list.length <= MAX_STRIPS) return { shown: list, hidden: [] };
  const keep = new Set(list.filter((a) => a.state !== "done").slice(0, MAX_STRIPS - 1).map((a) => a.id));
  for (const a of [...list].reverse()) {
    if (keep.size >= MAX_STRIPS - 1) break;
    keep.add(a.id);
  }
  return { shown: list.filter((a) => keep.has(a.id)), hidden: list.filter((a) => !keep.has(a.id)) };
}

export function stripTool(a: Agent, locale: Locale): string {
  if (a.state === "waiting") return text("deck.tool.needsApproval", locale);
  if (a.todo && a.todo.total && a.state === "running") {
    return trunc(a.todo.active || text("deck.title.tasks", locale), 24) + " " + Math.min(a.todo.total, a.todo.done + 1) + "/" + a.todo.total;
  }
  return a.tool;
}

export function barRow(s: DeckState, bar: Bar, show: Show, now: number, locale: Locale): DeckRow {
  const state = barState(s, bar);
  const w = where(bar);
  const done = state === "done";
  const single = bar.stages.length === 1;
  const list = agentsOf(s, bar.id);
  const agentNote =
    list.length && bar.id !== "agents"
      ? text("deck.agentNote", locale, { done: list.filter((a) => a.state === "done").length, total: list.length })
      : "";
  let name: string;
  let count: string;
  if (bar.id === "agents") {
    name = done ? text("deck.name.done", locale) : text("deck.name.agents", locale);
    count = w.finished + "/" + w.total;
  } else if (done) {
    name = text("deck.name.done", locale);
    count = w.total + "/" + w.total;
  } else if (single) {
    name = w.active ? w.active.active || w.active.title : (bar.stages[0]?.name ?? "");
    count = Math.min(w.total, w.pos + 1) + "/" + w.total;
  } else {
    name = bar.stages[w.stage]?.name ?? "";
    count = w.step + "/" + w.stageSize;
  }
  const marks: Mark[] = [];
  let k = 0;
  for (const st of bar.stages) {
    st.steps.forEach((_, j) => {
      if (k > 0) marks.push({ f: k / w.total, stage: !single && j === 0 });
      k++;
    });
  }
  const pct = done ? 100 : ((w.finished + (w.active ? 0.4 : 0)) / Math.max(1, w.total)) * 100;
  const shortName = trunc(name, 30);
  return {
    id: "bar:" + bar.id,
    kind: "bar",
    bar,
    style: STATE_STYLE[state],
    state,
    title: bar.title || text("deck.stage.plan", locale),
    pct,
    marks,
    steps: w.total,
    finished: w.finished,
    name: shortName,
    count: count + agentNote,
    right: Math.round(pct) + "%",
    short: done ? STYLE_GLYPH.done + " " + trunc(bar.title, 14) : trunc(name, 16) + " " + count,
    stage: w.finished,
    animating: !done,
    strips: visibleStrips(s, bar.id, bar.agentsDoneAt, show, now),
  };
}

export function activityRow(s: DeckState, show: Show, now: number, locale: Locale): DeckRow | null {
  const act = s.activity;
  if (!act || !show.plans) return null;
  if (act.done && act.doneAt && now - act.doneAt > ACTIVITY_LINGER_MS) return null;
  // a plain chat turn: worth a row while it thinks, not once it has answered
  if (act.done && act.tools === 0 && !agentsOf(s, "activity").length) return null;
  const planned = [...s.bars.values()].some((b) => b.id !== "agents" && !b.dismissed && b.startedAt >= act.start - 1000);
  if (planned) return null;
  const asking = !act.done && (s.waiting.has("main") || agentsOf(s, "activity").some((a) => a.state === "waiting"));
  const style: RowStyle = act.done ? "done" : asking ? "ask" : "run";
  const pct = act.done ? 100 : 95 * (1 - Math.exp(-act.tools / 18));
  const time = elapsed((act.done && act.doneAt ? act.doneAt : now) - act.start);
  const name = act.done ? text("deck.name.done", locale) : asking ? text("deck.name.needsYou", locale) : trunc(act.action, 28);
  const mine = agentsOf(s, "activity");
  const agentNote = mine.length ? text("deck.agentNote", locale, { done: mine.filter((a) => a.state === "done").length, total: mine.length }) : "";
  const tools = act.tools === 1 ? text("deck.unit.tool", locale) : text("deck.unit.tools", locale);
  return {
    id: "activity",
    kind: "activity",
    style,
    state: act.done ? "done" : asking ? "needs_input" : "running",
    title: act.title,
    pct,
    marks: [],
    steps: 0,
    finished: 0,
    name,
    count: act.tools + " " + tools + agentNote,
    strips: visibleStrips(s, "activity", act.agentsDoneAt, show, now),
    right: time,
    short: name + " · " + act.tools,
    stage: 0,
    animating: !act.done,
  };
}

// usage history, for sparklines and burn rates
function addPoint(s: DeckState, key: string, p: number | null | undefined, now: number): boolean {
  if (p == null) return false;
  const list = (s.hist[key] = s.hist[key] ?? []);
  const last = list[list.length - 1];
  if (last && last.p === p && now - last.t < 300_000) return false;
  if (last && now - last.t < 20_000) last.p = p;
  else list.push({ t: now, p });
  while (list.length && now - list[0]!.t > HIST_KEEP_MS) list.shift();
  if (list.length > HIST_MAX_POINTS) list.splice(0, list.length - HIST_MAX_POINTS);
  return true;
}

// records the context and limit percentages; true when the history changed and should be saved
export function sampleUsage(s: DeckState, now: number): boolean {
  let changed = addPoint(s, "context", s.usage.context?.percent, now);
  for (const rl of s.usage.rateLimits) changed = addPoint(s, rl.kind, rl.percentUsed, now) || changed;
  return changed;
}

// the values over a window, for a sparkline; the newest point is now
export function series(s: DeckState, key: string, windowMs: number, now: number): number[] {
  return (s.hist[key] ?? []).filter((x) => now - x.t <= windowMs).map((x) => x.p);
}

// how fast a window moves: percent per hour (or per day for the weekly window)
export function burnRate(s: DeckState, key: string, now: number, locale: Locale): string {
  const daily = key.startsWith("seven_day");
  const list = (s.hist[key] ?? []).filter((x) => now - x.t <= (daily ? 24 : 1) * 3600_000);
  if (list.length < 2) return "";
  const a = list[0]!;
  const b = list[list.length - 1]!;
  const span = b.t - a.t;
  if (span < 5 * 60_000 || b.p < a.p) return "";
  const per = ((b.p - a.p) / span) * (daily ? 86_400_000 : 3_600_000);
  if (per < 0.05) return "";
  const unit = text(daily ? "deck.rate.day" : "deck.rate.hour", locale);
  return "+" + (per < 10 ? per.toFixed(1) : String(Math.round(per))) + unit;
}

// a response may report only some windows; keep the others, drop ones already reset
export function mergeLimits(old: readonly RateLimit[], fresh: readonly RateLimit[] | undefined, now: number): RateLimit[] {
  const byKind = new Map(old.map((r) => [r.kind, r]));
  for (const r of fresh ?? []) byKind.set(r.kind, r);
  return [...byKind.values()].filter((r) => !r.resetsAt || Date.parse(r.resetsAt) > now).sort((a, b) => (a.kind < b.kind ? -1 : 1));
}

// a reading replaces the demo's sample numbers, then is merged in; returns the spend it added. The session's own
// measure drops the sample at once; a poll drops it only once the poll has real numbers.
export function takeUsage(s: DeckState, reading: UsageReading, now: number, costOn: boolean, measured = false): number {
  if (s.demoUsage && (measured || (reading.rateLimits ?? []).length || reading.context?.percent != null)) dropDemoUsage(s);
  // a reading that carries no context figures (null) clears the row; an absent one keeps it
  s.usage = { context: reading.context === undefined ? s.usage.context : reading.context, rateLimits: mergeLimits(s.usage.rateLimits, reading.rateLimits, now) };
  return reading.cost ? addSpend(s, reading.cost.usd, new Date(now), costOn) : 0;
}

export function dropDemoUsage(s: DeckState): void {
  if (!s.demoUsage) return;
  s.demoUsage = false;
  s.usage = { context: null, rateLimits: [] };
}

// the saved spend, for today and this month; a stale day or month starts at zero
export function spendFrom(saved: unknown, date: Date): Spend {
  const day = today(date);
  const month = day.slice(0, 7);
  const o = isRecord(saved) ? saved : {};
  return {
    day,
    dayUsd: o.day === day && typeof o.dayUsd === "number" ? o.dayUsd : 0,
    month,
    monthUsd: o.month === month && typeof o.monthUsd === "number" ? o.monthUsd : 0,
  };
}

// adds what this session spent since its last reading; the cost reported is a running total per session
export function addSpend(s: DeckState, usd: number, date: Date, costOn: boolean): number {
  if (!costOn || typeof usd !== "number") return 0;
  const seen = s.costSeen ?? 0;
  const delta = usd >= seen ? usd - seen : usd;
  s.costSeen = usd;
  const day = today(date);
  const month = day.slice(0, 7);
  s.spend = {
    day,
    dayUsd: (s.spend.day === day ? s.spend.dayUsd : 0) + delta,
    month,
    monthUsd: (s.spend.month === month ? s.spend.monthUsd : 0) + delta,
  };
  return delta;
}

// ---------- the rows the band shows ----------

export function sectionsOn(show: Show): Section[] {
  return SECTIONS.filter((x) => show[x]);
}

export function collectRows(s: DeckState, show: Show, now: number, locale: Locale): DeckRow[] {
  const rows: DeckRow[] = [];
  const rr = routeRow(s, show, locale);
  if (rr) rows.push(rr);
  for (const bar of s.bars.values()) {
    if (bar.dismissed) continue;
    if (bar.id === "agents" ? !show.agents : !show.plans) continue;
    if (bar.id === "agents" && !agentsOf(s, bar.id).length) continue;
    if (!allSteps(bar).length) continue;
    const linger = bar.id === "agents" ? AGENTS_LINGER_MS : BAR_LINGER_MS;
    if (barState(s, bar) === "done" && bar.doneAt && now - bar.doneAt > linger) continue;
    rows.push(barRow(s, bar, show, now, locale));
  }
  const act = activityRow(s, show, now, locale);
  if (act) rows.push(act);
  const ctx = s.usage.context;
  if (show.context && ctx && ctx.percent != null) {
    const p = ctx.percent;
    rows.push({
      id: "context",
      kind: "meter",
      style: p >= 80 ? "hot" : p >= 60 ? "warn" : "run",
      title: text("deck.title.context", locale),
      pct: p,
      marks: [{ f: 0.5 }, { f: 0.8 }],
      right: Math.round(p) + "%",
      short: text("deck.context.short", locale) + " " + Math.round(p) + "%",
      strips: null,
      name: fmtK(ctx.tokens) + " / " + fmtK(ctx.window),
      count: "",
      section: "context",
      hist: series(s, "context", 3600_000, now),
      rate: burnRate(s, "context", now, locale),
    });
  }
  if (show.limits) {
    for (const rl of s.usage.rateLimits) {
      const [title, tag] = limitName(rl.kind, locale);
      const p = rl.percentUsed;
      const resets = rl.resetsAt ? humanReset(rl.resetsAt, now) : "";
      rows.push({
        id: "limit:" + rl.kind,
        kind: "meter",
        style: p >= 80 ? "hot" : p >= 50 ? "warn" : "ok",
        title,
        pct: Math.min(100, p),
        marks: [{ f: 0.25 }, { f: 0.5 }, { f: 0.75 }],
        right: rl.resetsAt ? "↻ " + countdown(rl.resetsAt, now) : "",
        short: tag + " " + Math.round(p) + "%" + (rl.resetsAt ? " ↻" + resets : ""),
        strips: null,
        name: text("deck.limit.used", locale, { tag, percent: Math.round(p) }),
        count: "",
        limit: true,
        section: "limits",
        kindKey: rl.kind,
        resets,
        hist: series(s, rl.kind, rl.kind.startsWith("seven_day") ? 24 * 3600_000 : 3600_000, now),
        rate: burnRate(s, rl.kind, now, locale),
      });
    }
  }
  return rows;
}

// collapsed: what needs you first, then limits, context, bars, the route
export function collapsedOrder(rows: readonly DeckRow[]): DeckRow[] {
  const rank = (r: DeckRow) => (r.state === "needs_input" ? 0 : r.limit ? 1 : r.id === "context" ? 2 : r.kind === "bar" ? 3 : 4);
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

export type PetMood = "alert" | "celebrate" | "working" | "sleepy" | "calm";

export function petMood(s: DeckState, rows: readonly DeckRow[], now: number): PetMood {
  if (rows.some((r) => r.state === "needs_input")) return "alert";
  if (now < s.celebrateUntil) return "celebrate";
  if (s.turnActive) return "working";
  if (now - s.lastActivity > SLEEPY_MS) return "sleepy";
  return "calm";
}

export type DeckSound = "alert" | "error" | "fanfare" | "chime" | "tick";
export type ReactCues = { sounds: DeckSound[]; wantOpen: boolean };

// compares the rows with the last tick: which sounds to play, the done times, the celebration;
// wantOpen says a row needs the person (the caller expands when settings.auto allows)
export function react(s: DeckState, rows: readonly DeckRow[], now: number): ReactCues {
  for (const bar of s.bars.values()) {
    const st = barState(s, bar);
    if (st === "done" && !bar.doneAt) bar.doneAt = now;
    if (st !== "done") bar.doneAt = null;
  }
  const live = rows.filter((r) => r.kind === "bar" && r.animating).length;
  const sounds: DeckSound[] = [];
  let anyAsk = false;
  for (const row of rows) {
    if (row.kind !== "bar" || !row.state) continue;
    const prev = s.lastSeen.get(row.id);
    const stage = row.stage ?? 0;
    if (row.state === "needs_input") anyAsk = true;
    if (prev) {
      if (row.state === "needs_input" && prev.state !== "needs_input") sounds.push("alert");
      else if (row.state === "error" && prev.state !== "error") sounds.push("error");
      else if (row.state === "done" && prev.state !== "done") {
        sounds.push(live === 0 ? "fanfare" : "chime");
        s.celebrateUntil = now + CELEBRATE_MS;
      } else if (stage > prev.stage && row.state !== "done") sounds.push("tick");
    }
    s.lastSeen.set(row.id, { state: row.state, stage });
  }
  return { sounds, wantOpen: anyAsk };
}

// the words the terminal's status prints: each row, its strips, and the preferences in force
export function statusText(
  rows: readonly DeckRow[],
  settings: DeckSettings,
  petAct: string,
  version: string,
  locale: Locale,
  expanded: boolean,
): string {
  const lines: string[] = [];
  for (const r of rows) {
    if (r.kind === "route" && r.route?.noAnswer) {
      const hint = r.route.hint ? " · " + r.route.hint : "";
      lines.push(text("deck.route.statusNoAnswer", locale, { reason: r.route.reason, to: r.route.to, hint }));
      continue;
    }
    if (r.kind === "route" && r.route) {
      const v = r.route;
      const effort = v.effort ? text("deck.route.effortNote", locale, { effort: v.effort }) : "";
      const conf = v.conf != null ? " " + v.conf.toFixed(2) : "";
      const suggested = v.unapplied ? text("deck.route.statusSuggested", locale, { want: v.want }) : "";
      lines.push(
        text("deck.route.statusLine", locale, {
          from: v.from,
          arrow: v.dir === "=" ? "=" : "→",
          to: v.to,
          effort,
          tier: v.tier,
          conf,
          suggested,
          right: r.right,
        }),
      );
      continue;
    }
    lines.push(
      STYLE_GLYPH[r.style] + " " + r.title + " — " + (r.name ?? "") + (r.count ? " " + r.count : "") + (r.right ? " (" + r.right + ")" : ""),
    );
    for (const a of r.strips?.shown ?? []) {
      lines.push("   ↳ " + a.title + ": " + stripTool(a, locale) + " [" + a.state + "]" + (a.model ? " {" + a.model + "}" : ""));
    }
  }
  const on = sectionsOn(settings.show).map((x) => text(("deck.section." + x) as LocaleKey, locale)).join(", ") || text("deck.nothing", locale);
  const head = lines.length ? lines.join("\n") : text("deck.noRows", locale);
  const city = settings.city ? text("deck.status.city", locale, { city: settings.city.name }) : "";
  return (
    head +
    "\n" +
    text("deck.status.showing", locale, {
      sections: on,
      state: text(expanded ? "deck.expanded" : "deck.collapsed", locale),
      terminal: settings.style.terminal,
      desktop: settings.style.desktop,
      pet: petAct,
      auto: text(settings.auto ? "deck.on" : "deck.off", locale),
      sound: text(settings.sound ? "deck.on" : "deck.off", locale),
      city,
      version,
    })
  );
}

// ---------- demo and sample fixtures ----------

export const DEMO_ROUTE_HIST = ["haiku", "opus", "sonnet", "haiku", "haiku", "opus"];

export function demoStages(locale: Locale): Stage[] {
  const st = (key: LocaleKey, status: StepStatus = "pending"): Step => ({ title: text(key, locale), status });
  return [
    { name: text("deck.demo.stage.analysis", locale), steps: [st("deck.demo.step.readModules", "done"), st("deck.demo.step.findDeps", "done"), st("deck.demo.step.listChanges", "active")] },
    { name: text("deck.demo.stage.migration", locale), steps: [st("deck.demo.step.tableSchema"), st("deck.demo.step.createMigration"), st("deck.demo.step.moveData"), st("deck.demo.step.indexes")] },
    { name: text("deck.demo.stage.api", locale), steps: [st("deck.demo.step.endpoints"), st("deck.demo.step.validation"), st("deck.demo.step.accessRules")] },
    { name: text("deck.demo.stage.verify", locale), steps: [st("deck.demo.step.tests"), st("deck.demo.step.build")] },
  ];
}

// /deck demo: the plan, two agents, and sample route and limits until real ones arrive
export function startDemo(s: DeckState, now: number, locale: Locale): void {
  for (const a of [...s.agents.values()]) if (a.home === "demo") s.agents.delete(a.id);
  placeBar(s, newBar("demo", text("deck.demo.plan", locale), "demo", demoStages(locale), now));
  if (!s.route) {
    s.route = { noAnswer: false, tier: "fast", conf: 0.89, model: "", effort: "medium", unchanged: true, effortScore: null, risky: 0.02, ms: 249, at: now };
    s.routeHist.splice(0, s.routeHist.length, ...DEMO_ROUTE_HIST);
    s.demoRoute = true;
  }
  if (!s.usage.rateLimits.length) {
    s.usage = {
      context: s.usage.context ?? { tokens: 124_000, window: 1_000_000, percent: 12 },
      rateLimits: [
        { kind: "five_hour", percentUsed: 31, resetsAt: new Date(now + (2 * 60 + 14) * 60_000).toISOString() },
        { kind: "seven_day", percentUsed: 64, resetsAt: new Date(now + (3 * 24 + 5) * 3_600_000).toISOString() },
      ],
    };
    s.demoUsage = true;
  }
  const base = { startedAt: now, endedAt: null, depth: 0, home: "demo", todo: null };
  s.agents.set("demo-a1", { ...base, id: "demo-a1", title: text("deck.demo.agent.mapTables", locale), state: "running", tool: "Grep", model: "haiku" });
  s.agents.set("demo-a2", { ...base, id: "demo-a2", title: text("deck.demo.agent.draftMigration", locale), state: "running", tool: "Read", model: "sonnet" });
  s.turnActive = true;
}

// one tick of the demo; false when the demo has finished or its bar is gone
export function demoTick(s: DeckState, n: number, now: number, locale: Locale): boolean {
  const d = s.bars.get("demo");
  if (!d) return false;
  const a1 = s.agents.get("demo-a1");
  const a2 = s.agents.get("demo-a2");
  if (n === 2 && a1) a1.tool = "Read";
  if (n === 3) finishAgent(s, "demo-a1", "done", now, locale);
  if (n === 5 && a2) {
    a2.state = "waiting";
    d.explicit = "needs_input";
  }
  if (n === 8 && a2) {
    a2.state = "running";
    a2.tool = "Write";
    d.explicit = null;
  }
  if (n === 10) finishAgent(s, "demo-a2", "done", now, locale);
  if (d.explicit !== "needs_input") d.stages = stepOn(d.stages);
  if (allSteps(d).every((st) => isFinished(st.status))) {
    s.turnActive = false;
    return false;
  }
  return true;
}

export function sampleRow(locale: Locale): DeckRow {
  return {
    id: "sample",
    kind: "bar",
    style: "run",
    state: "running",
    title: text("deck.sample.title", locale),
    pct: 52,
    marks: [0.2, 0.4, 0.6, 0.8].map((f, i) => ({ f, stage: i === 1 })),
    steps: 5,
    finished: 2,
    name: text("deck.sample.name", locale),
    count: "3/5",
    right: "52%",
    short: text("deck.sample.name", locale) + " 3/5",
    strips: null,
    animating: true,
  };
}
