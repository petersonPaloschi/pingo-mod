/** One model request as the dashboard sees it: metadata only. */
export type RouteEvent = {
  seq: number;
  time: string;
  session: string;
  model: string | null;
  tools?: number;
  mode: "hint" | "passthrough";
  reason?: string;
  tool?: string;
  confidence?: number;
  durationMs: number;
  /** Raw counters; input excludes cache, cached is cache read, cacheWrite is cache creation. */
  usage?: { input?: number; output?: number; cached?: number; cacheWrite?: number };
  jev?: { choice?: string; confidence?: number; latencyMs: number; inputTokens?: number; shortlist?: number };
  /** Main loop or a subagent's request. */
  agent?: string;
  /** Effort the request was sent with. */
  effort?: string;
  /** What Jev changed for it, in a few words ("model sonnet · effort low"). */
  plan?: string;
  /** The observed cause when Jev failed or its answer was unusable: a message, never a key or a prompt. */
  error?: string;
  /** Jev's reply bodies behind a failed decision, as the provider sent them (clipped): the log shows them whole. */
  jevRaw?: string[];
};

export type JevTab = "overview" | "live" | "models" | "agents" | "logs" | "configuration" | "deck";

/**
 * A message as the Live run view records it. Its run is tied only when the engine confirms it: the turn
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

/** Legacy plan summary kept so older run records can still show their reason and outcome. */
export type TracePlan = {
  outcome: "consulted" | "declined" | "failed" | "skipped";
  /** A reason code ("jev_declined", "routing_disabled", "mid_turn", ...). */
  reason: string;
  /** The same one-line summary the live log shows. */
  summary: string;
  latencyMs?: number;
  checkpoints?: TraceCheckpoint[];
};

/** A review requested by the harness, never proof that validation or advice succeeded. */
export type TraceCheckpoint = {
  kind: "plan" | "recovery" | "completion";
  at: number;
  tool?: string;
  attempts?: number;
  agentId?: string;
};

/** One Jev call: where it was asked from, the model asked, and the questions it carried. */
export type TraceConsult = {
  id: string;
  origin: "prompt" | "tool" | "agent" | "sift" | "setup";
  model: string;
  /** Response model and raw provider counters, when supplied; input excludes cache. */
  observed?: string;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
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
  /** Raw counters; input excludes cache, cacheRead/cacheWrite are separate. Missing values stay unknown. */
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
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
  /** Effort on the latest observed request. */
  effort?: string;
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
  checkpoints?: TraceCheckpoint[];
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

/** The one remaining feature toggle: model and effort planning for native agent spawns. */
export type FeatureFlags = { agents: boolean };
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
  /** Its lightweight identifier in hooks/mascots/agents.ts, used for a readable name and color. */
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
  tokensIn?: number;
  tokensOut?: number;
  /** Agent requests with reported input/output counters, for marking partial totals. */
  inputUsageRequests?: number;
  outputUsageRequests?: number;
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
      flowDetails: boolean;
      feed: FeedEntry[];
      now: LiveNow;
      agents: AgentRun[];
      /** The highest AgentRun.n handed out this session: numbers are never reused. */
      agentCount: number;
      flowV2: TraceState;
      scroll: PaneScroll;
      /** Deck's preferences as shown (hooks/deck/settings.ts DeckSettings); the store keeps the same value across sessions. */
      deckSettings: {
        show: Record<"plans" | "agents" | "context" | "limits" | "route" | "pet" | "clock" | "weather", boolean>;
        style: { terminal: string; desktop: string };
        open: boolean;
        auto: boolean;
        sound: boolean;
        quiet: boolean;
        size: "compact" | "roomy";
        collapsed: "chips" | "text" | "rings";
        cost: boolean;
        city: { name: string; lat: number; lon: number } | null;
      };
      /** Whether Deck's band is expanded now. */
      deckExpanded: boolean;
      /** Counts Deck's changes: the band and its panes read it, so a change redraws them. */
      deckRevision: number;
    };
  }
}
