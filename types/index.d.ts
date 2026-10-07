/** One model request as the dashboard sees it: metadata only. */
export type RouteEvent = {
  seq: number;
  time: string;
  session: string;
  model: string | null;
  tools: number;
  mode: "hint" | "passthrough";
  reason?: string;
  tool?: string;
  confidence?: number;
  durationMs: number;
  usage?: { input: number; output: number; cached: number; cacheWrite: number };
  jev?: { choice: string; confidence: number; latencyMs: number; inputTokens: number; shortlist?: number };
  /** Main loop or a subagent's request. */
  agent?: string;
  /** Effort the request was sent with. */
  effort?: string;
  /** What Jev changed for it, in a few words ("model sonnet · effort low"). */
  plan?: string;
};

export type JevTab = "overview" | "live" | "agents" | "flow" | "reasons" | "baseline" | "log" | "features" | "setup";

/** The Flow tab: the latest batch of subagents, from the prompt that sent them to the edits after. */
export type FlowState = {
  /** Main-loop turns seen this session; a wave belongs to the turn it started in. */
  turn: number;
  /** The running turn's prompt, kept so a wave it starts can show it. */
  prompt?: string;
  /** The latest wave: its subagents' numbers (AgentRun.n), the turn it started in, that turn's prompt. */
  wave: number[];
  waveTurn: number;
  text?: string;
  /** You started a turn after every subagent of the wave had ended. */
  confirmed: boolean;
  /** Main-loop edits since the wave ended, and the files they touched. */
  edits: number;
  files: string[];
  /** The main loop is running a turn. */
  working: boolean;
};

/** The setup pane selects a provider and reports the connection check. */
export type SetupDraft = { provider: string; message: string; isOk: boolean };

/** The features the person switches on and off, by id (see hooks/core/plan.ts). */
export type FeatureFlags = {
  tools: boolean;
  participation: boolean;
  model: boolean;
  effort: boolean;
  delegation: boolean;
  agents: boolean;
};

export type FeedKind = "turn" | "step" | "jev" | "tool" | "agent" | "message" | "feature" | "error";
export type FeedTone = "info" | "good" | "warn" | "bad" | "muted";

/** Who a live-log line belongs to: you, Jev, Claude, a subagent, or the plugin itself. */
export type FeedSpeaker = "you" | "jev" | "claude" | "agent" | "mod";

/** One line of the live log: an observable event, never the model's reasoning. */
export type FeedEntry = {
  seq: number;
  time: number;
  who: FeedSpeaker;
  /** The speaker's name when it is not the default one: a subagent's type. */
  name?: string;
  /** The subagent the line belongs to, by its id: what its own live log shows. */
  agent?: string;
  /** That subagent's mascot (hooks/mascots/agents.ts), when the line is its own. */
  mascot?: string;
  kind: FeedKind;
  tone: FeedTone;
  text: string;
  /** The finer points, drawn small (faint) under the line: a command in full, tokens, a result's size. */
  detail?: string;
  /** A short figure drawn faint at the line's end: a duration, a token count. */
  meta?: string;
  /** Bookkeeping rather than an action (a request sent, a turn's end): the whole line drawn faint. */
  minor?: boolean;
};

/** The pane's own scroll positions, by pane id and tab: the header stays fixed while the body moves. */
export type PaneScroll = Record<string, number>;

/** What is happening right now, for the band above the prompt. */
export type LiveNow = {
  /** The model and effort of the latest main-loop request. */
  model?: string;
  effort?: string;
  /** What Jev changed for this turn, if anything. */
  changed?: string;
  /** Jev's latest decision, in a few words, and whether it was consulted at all. */
  decision?: string;
  jevUsed?: boolean;
  /** What runs now: "thinking", a tool, an agent; absent when idle. */
  activity?: string;
  /** True while a Jev call is in flight. */
  asking?: boolean;
};

export type AgentState = "running" | "done" | "error" | "aborted";

/** One subagent Claude started, for the Agents tab and its own live pane. */
export type AgentRun = {
  /** The engine's id for its loop: the lines in the live log carry it. */
  id: string;
  /** A short number for the person: `/jev agent 3`, pane `jev-agent-3`. */
  n: number;
  /** Its mascot, one of five (hooks/mascots/agents.ts): the face and name it goes by. */
  mascot: string;
  type: string;
  description: string;
  /** The task Claude gave it, clipped. */
  prompt: string;
  model: string;
  effort?: string;
  /** What Jev chose for it, when Jev chose. */
  jev?: string;
  startedAt: number;
  endedAt?: number;
  state: AgentState;
  tools: number;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  /** What it runs now: a tool, or waiting on the model. */
  activity?: string;
  /** Its latest visible text, then its final answer. */
  text?: string;
};

declare module "claude-code" {
  interface PluginState {
    jev: {
      events: RouteEvent[];
      routing: boolean;
      tab: JevTab;
      range: number;
      setup: SetupDraft;
      features: FeatureFlags;
      feed: FeedEntry[];
      now: LiveNow;
      agents: AgentRun[];
      flow: FlowState;
      scroll: PaneScroll;
    };
  }
}
