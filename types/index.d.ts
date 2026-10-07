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
  jev?: { choice?: string; confidence?: number; latencyMs: number; inputTokens: number; shortlist?: number };
  /** Main loop or a subagent's request. */
  agent?: string;
  /** Effort the request was sent with. */
  effort?: string;
  /** What Jev changed for it, in a few words ("model sonnet · effort low"). */
  plan?: string;
  /** The observed cause when Jev failed or its answer was unusable: a message, never a key or a prompt. */
  error?: string;
};

export type JevTab = "overview" | "live" | "models" | "agents" | "flow" | "reasons" | "baseline" | "log" | "features" | "setup";

/** The functions Jev can decide a turn's plan with, in the order the Models tab lists them. */
export type FnId = Exclude<FeatureId, "agents">;

/**
 * What one function did for one turn. `why` is a code the pane words in the person's language
 * (a ModelReason, "user_model", "model_id", "blocked", "same_model", "feature_off", "routing_disabled",
 * "no_api_key", "jev_error", "low_confidence", "haiku_no_effort", "no_delegation", ...).
 */
export type FnResult = {
  id: FnId;
  /** applied: changed something; kept: Jev wanted a change that was held back; none: Jev had nothing to change; off: not asked; failed: Jev could not answer. */
  result: "applied" | "kept" | "none" | "off" | "failed";
  why?: string;
  /** What Jev chose: a tool, a model id, an effort, a subagent type, or the participation share. */
  value?: string;
  /** What was in place before: the model or effort the turn would have run on. */
  from?: string;
  /** Jev's confidence in `value`, and the confidence it needed to count. */
  confidence?: number;
  needed?: number;
};

/** One routing point: what Jev was asked at a prompt and what each function came to. */
export type TurnDecision = {
  seq: number;
  time: number;
  /** Main-loop turns seen this session, as TraceState.turns counts them. */
  turn: number;
  consulted: boolean;
  latencyMs?: number;
  fns: FnResult[];
  /** The turn's first model request has been sent, so the model result is final. */
  settled: boolean;
};

/** The Models tab: the latest routing points, newest last. */
export type WatchState = {
  turns: TurnDecision[];
  /** The highest TurnDecision.seq handed out. */
  count: number;
};

/**
 * A message as the Flow tab records it. Its run is tied only when the engine confirms it: the turn
 * that starts while its idle submission is still entering. A message typed into a running turn
 * names that turn (`during`) and stays "queued": the engine may deliver it into that turn or run
 * it later, and nothing observable says which.
 */
export type TraceMessage = {
  id: string;
  text: string;
  at: number;
  /** PromptOrigin.kind: "composer", "peer", "plugin", ... */
  origin: string;
  /** The turn that was running when it was submitted (prompt.submit's turnId). */
  during?: string;
  state: "waiting" | "linked" | "queued" | "dropped";
  dropped?: string;
  plan?: TracePlan;
  /** Jev calls made for it before its run started. */
  consults: TraceConsult[];
};

/** What Jev's routing point came to for a message. */
export type TracePlan = {
  outcome: "consulted" | "declined" | "failed" | "skipped";
  /** A reason code ("jev_declined", "routing_disabled", "mid_turn", ...). */
  reason: string;
  /** The same one-line summary the live log shows. */
  summary: string;
  latencyMs?: number;
  /** What the context Claude reads carried: the tool hint, the delegation hint, the advisor hint. */
  tool?: string;
  delegate?: string;
  advisor?: boolean;
  /** The advisor question was part of the routing point (the feature was on). */
  advisorAsked?: boolean;
};

/** One Jev call: where it was asked from, the model asked, and the questions it carried. */
export type TraceConsult = {
  id: string;
  origin: "prompt" | "tool" | "agent";
  model: string;
  questions: string[];
  startedAt: number;
  endedAt?: number;
  error?: string;
};

/** One model request: the model the engine resolved, the one sent, and the one the response named. */
export type TraceStep = {
  agentId?: string;
  turnId: string;
  index: number;
  original: string;
  sent: string;
  /** usage.model of the response; absent when no response (or no usage) arrived. */
  observed?: string;
  effort?: string;
  startedAt: number;
  endedAt?: number;
  stop?: string | null;
};

/** One tool call Claude or a subagent made. `source` is "builtin" or "mcp:<server>". */
export type TraceTool = {
  id: string;
  agentId?: string;
  name: string;
  source: string;
  startedAt: number;
  endedAt?: number;
  result?: "ok" | "error" | "denied";
};

/** A subagent as the run keeps it: its summary outlives the Agents tab entry. */
export type TraceAgent = {
  id: string;
  parent?: string;
  toolUseId?: string;
  type: string;
  description: string;
  /** What the engine said it starts on; `observed` is what its responses named. */
  model?: string;
  observed: string[];
  state: AgentState;
  background?: boolean;
  startedAt: number;
  endedAt?: number;
  tools: number;
  requests: number;
};

/**
 * A server tool call (the advisor) read off a step's response. `endedAt` means its result arrived,
 * not that the consultation succeeded; the SDK exposes no model, tokens or outcome for it.
 */
export type TraceAdvisor = {
  id: string;
  name: string;
  agentId?: string;
  turnId: string;
  step: number;
  startedAt: number;
  endedAt?: number;
};

/** One main-loop run: a turn, from what started it to how it ended, with everything inside. */
export type TraceRun = {
  /** The engine's turnId, or a local id until one is seen (`confirmed` false). */
  id: string;
  confirmed: boolean;
  /** Its number among the main-loop turns of this session. */
  n: number;
  kind: "message" | "continuation" | "unlinked";
  /** turn.start's text, clipped. */
  text: string;
  startedAt: number;
  endedAt?: number;
  reason?: "answer" | "aborted" | "refusal" | "error" | "superseded";
  message?: TraceMessage;
  /** Messages submitted while it ran. */
  received: TraceMessage[];
  consults: TraceConsult[];
  consultCount: number;
  /** The main loop's models: the first the engine resolved, every one sent, every one a response named. */
  main: { original?: string; sent: string[]; observed: string[]; effort?: string; requests: number };
  steps: TraceStep[];
  tools: TraceTool[];
  toolCount: number;
  toolSources: Record<string, number>;
  denied: number;
  failed: number;
  agents: TraceAgent[];
  advisor: TraceAdvisor[];
  edits: number;
  files: string[];
  /** Tokens the responses reported, main loop and subagents (cache reads and writes in `input`); the advisor's are not exposed. */
  tokens?: { input: number; output: number };
};

/** The Flow tab (schema 2): what each run did, as observed. A value of another schema is not read. */
export type TraceState = {
  schemaVersion: 2;
  /** The last local id handed out. */
  seq: number;
  /** Main-loop turns seen this session (the Models tab numbers prompts by it). */
  turns: number;
  /** The main loop's running run, by id. */
  active?: string;
  /** The idle message whose prompt.submit is still entering: the run that starts meanwhile is its. */
  entering?: string;
  /** Messages not tied to a run: awaiting their turn, or refused. */
  inbox: TraceMessage[];
  /** Oldest first: every run still active and the latest finished. */
  runs: TraceRun[];
  /** What settings and the environment say about the advisor: informative, never proof it runs. */
  advisor?: AdvisorInfo;
};

/**
 * `advisorModel` as settings.json has it (a --advisor flag or /advisor can override it unseen), and
 * a variable that keeps the advisor off: one that stops feature-flag fetching, or a provider other
 * than the Anthropic API.
 */
export type AdvisorInfo = {
  configured?: string;
  blocked?: { kind: "flags" | "provider"; variable: string };
};

/** The setup pane selects a provider and reports the connection check. */
export type SetupDraft = {
  provider: string;
  message: string;
  isOk: boolean;
  /** The key being typed, masked ("••••••a1b2"): the key itself stays in the module, never in state. */
  typed?: string;
  /** A check or a save is in flight. */
  busy?: boolean;
};

/** The features the person switches on and off, by id (see hooks/core/plan.ts). */
/** Canonical feature schema; the public plugin contract must be self-contained. */
export type FeatureFlags = {
  tools: boolean;
  participation: boolean;
  model: boolean;
  effort: boolean;
  delegation: boolean;
  agents: boolean;
  advisor: boolean;
};
export type FeatureId = keyof FeatureFlags;

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
      /** The highest AgentRun.n handed out this session: numbers are never reused. */
      agentCount: number;
      flowV2: TraceState;
      watch: WatchState;
      scroll: PaneScroll;
    };
  }
}
