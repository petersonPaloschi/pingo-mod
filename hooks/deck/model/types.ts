import { type DeckGlyphName } from "../../theme.ts";
import { type Section } from "../settings.ts";

export type RowStyle = DeckGlyphName;


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

export type ToolUse = { tool: string; file_path?: string | null; notebook_path?: string | null; command?: string | null };

export type AgentOutcome = "done" | "failed" | "stopped";

export type ToolCall = { tool: string; agentId?: string; toolUseId?: string; input: Record<string, unknown> };
/** What a tool call answered: a denial or an error means it did not run cleanly. */
export type CallResult = { result?: unknown; deny?: unknown; isError?: unknown };

export type SavedSpend = { spend: Spend; costSeen: Record<string, number> };

export type Where = {
  pos: number;
  total: number;
  finished: number;
  active: Step | null;
  stage: number;
  step: number;
  stageSize: number;
};

export type TodoInput = { content: string; activeForm: string; status: string };

export type TaskInput = { tool: string; subject?: string; activeForm?: string; taskId?: string | number; status?: string };
export type TaskResult = { task?: { id?: string | number | null; subject?: string } | null; success?: boolean; tasks?: { id: string | number; status: string }[] } | null;

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

export type PetMood = "alert" | "celebrate" | "working" | "sleepy" | "calm";

export type DeckSound = "alert" | "error" | "fanfare" | "chime" | "tick";
export type ReactCues = { sounds: DeckSound[]; wantOpen: boolean };
