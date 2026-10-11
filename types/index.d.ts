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

export type JevTab = "overview" | "live" | "models" | "agents" | "logs" | "configuration" | "deck" | "features" | "ai" | "flow" | "orchestration" | "quality" | "comandante" | "autonomos";

/**
 * A message as the Live run view records it. The conversation's own rows say where it went: a prompt row
 * means it entered and the next main turn carries it; a queued_command delivery means Claude read it inside
 * the turn it was typed in (`during`). A queued message neither row named was withdrawn. An idle message
 * with no row seen is still the next turn's (`entering`): the engine settles its submission before turn.start.
 */
export type TraceMessage = {
  id: string;
  text: string;
  at: number;
  /** PromptOrigin.kind: "composer", "peer", "plugin", ... */
  origin: string;
  /** The turn that was running when it was submitted (prompt.submit's turnId). */
  during?: string;
  /**
   * waiting: idle, its turn not started yet; queued: typed during a turn, not taken yet; linked: a run carries it;
   * delivered: Claude read it inside the turn it was typed in; withdrawn: taken back before it ran; dropped: refused.
   */
  state: "waiting" | "linked" | "queued" | "delivered" | "withdrawn" | "dropped";
  dropped?: string;
  /** For a queued message a later turn carried: that run's id. */
  ranIn?: string;
  plan?: TracePlan;
  /** Jev calls made for it before its run started. */
  consults: TraceConsult[];
  /** The controlled advisor's decision for it, and the consult's outcome once it returned. */
  advice?: TraceAdvice;
};

/**
 * The controlled advisor for one message, as orchestration decided it: on or off, why (a
 * `feed.advice.why.*` code), who decided (`feed.advice.decider.*`), the profile, and the outcome.
 */
export type TraceAdvice = {
  at: number;
  on: boolean;
  why: string;
  decider: string;
  /** The local score, the score it turns on from, its tier and the signals behind it. */
  score?: number;
  need?: number;
  tier?: string;
  signals?: string[];
  /** "plan" or "recover": what the guidance was asked for. */
  purpose?: string;
  model?: string;
  effort?: string;
  /** Where the profile came from: the advisor role's override, fixed values or AUTO allowlist. */
  source?: string;
  outcome?: "given" | "failed";
  endedAt?: number;
  /** The guidance, clipped, or why the consult failed. */
  guidance?: string;
  problem?: string;
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
  origin: "prompt" | "tool" | "agent" | "sift" | "setup" | "unit" | "context" | "comandante" | "portao" | "ensaio" | "rumo" | "chaveiro" | "oficina";
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
  /** Why the request went as it did: "orchestrated", "not_asked", "routing_disabled" or "subagent". */
  route?: string;
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
  /** Its last answer, clipped. */
  result?: string;
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
  /** The main loop's final answer, clipped. */
  answer?: string;
  message?: TraceMessage;
  /** Further messages that entered with it: queued ones the engine runs together in one turn, oldest first. */
  also?: TraceMessage[];
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
  /** The idle message submitted last: the next main turn is its unless prompt rows name others (`carried`). */
  entering?: string;
  /** Messages whose prompt row the conversation took, oldest first: the next main turn carries them. */
  carried?: string[];
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

/** Dashboard switches for Jev and its integrated modules. */
export type FeatureFlags = {
  agents: boolean;
  farol: boolean;
  clareza: boolean;
  pingoVivo: boolean;
  prisma: boolean;
  semente: boolean;
  lapida: boolean;
  sentinela: boolean;
  vigia: boolean;
  contexto: boolean;
  codeQuality: boolean;
  comandante: boolean;
  portao: boolean;
  ensaio: boolean;
  rumo: boolean;
  chaveiro: boolean;
  oficina: boolean;
};
export type FeatureId = keyof FeatureFlags;

/** Preferences for the modules surfaced in Jev's Configuration dashboard. */
export type FeaturePreferences = {
  assumptionScope: "all" | "important";
  plainLevel: "beginner" | "expert";
  plainReview: boolean;
  plainSound: boolean;
  petHat: string;
  petShades: boolean;
  designSurface: "auto" | "pane" | "browser";
  ideaNudges: boolean;
  promptLearning: boolean;
  monitorEveryMs: 2000 | 5000 | 10000;
  trackerSummary: boolean;
  clashMinutes: 15 | 30 | 60;
  /** The assistants whose alerts the Comandante judges; one switched off goes on as if the Comandante were off. */
  comandanteSources: ComandanteSources;
};

/** One Farol assumption; `comandante` is the Comandante's ruling on it, when it judged it. */
export type FarolAssumption = { id: number; text: string; context?: string; verdict: "open" | "right" | "wrong"; note?: string; sent: boolean; comandante?: ComandanteRuling };
export type FarolRule = { assumption: string; correction: string };
export type ClarezaGrade = { pass: boolean; problems: string[]; offered: string[]; fixing: boolean };
/**
 * Clareza's plan for an unclear answer: what may confuse, the rewrite request it would send once the person agrees, and
 * the Comandante's ruling on it. `sent`: the Comandante approved it and sent it in the person's place; the pane shows
 * it done, with no Enviar or Rejeitar, until the person clears it or asks something new.
 */
export type ClarezaProposal = { problems: string[]; prompt: string; at: number; comandante?: ComandanteRuling; sent?: boolean };
/** One idea on Semente's shelf; `comandante` is the Comandante's ruling on keeping it, when it judged it. */
export type SementeIdea = { id: string; text: string; source: "you" | "claude"; comandante?: ComandanteRuling };
export type LapidaPhase = "idle" | "enhancing" | "ready" | "error";
export type PrismaOption = { label: string; description?: string; svg?: string; file?: string };
export type PrismaQuestion = { question: string; header: string; multiSelect?: boolean; options: PrismaOption[] };
export type PrismaPicker = { id: string; questions: PrismaQuestion[]; picks: string[][]; others: (string | null)[]; mix: boolean[]; answerFile: string; gallery: string };
export type SentinelaSession = { pid: number; id: string; name: string; cwd: string; project: string; status: "working" | "waiting" | "done"; waitingFor: string; since: number };
export type VigiaTask = { id: string; text: string; status: "pending" | "in_progress" | "completed" };
export type VigiaSession = { id: string; root: string; startedAt: number; beatAt: number; endedAt?: number; isBusy?: boolean; turns?: number; lastPrompt?: string; lastAnswer?: string; title?: string; done?: string; doing?: string; next?: string; tasks: VigiaTask[]; files?: string[]; edits?: Record<string, number>; running?: { what: "tests" | "app"; at: number } };
/** One message or notice between two sessions of a project, as the Vigia pane lists it: `in` arrived here, `out` left from here; a message that arrived carries the Comandante's ruling, when it judged it, and `isReleased` once the person let a held one through to Claude. */
export type VigiaMail = { id: string; at: number; way: "in" | "out"; peer: string; peerId: string; kind: "message" | "clash"; text: string; file?: string; isDelivered?: boolean; comandante?: ComandanteRuling; isReleased?: boolean };
/**
 * Where an alert the Comandante judges came from: a Farol assumption, a Semente idea, a Vigia message, a Clareza plan, a
 * call of the Code Quality agent, or what an autonomous agent proposes to the person (Portão's and Ensaio's requests to
 * Claude, Chaveiro's permission rules, Rumo's goals).
 */
export type ComandanteSource = "farol" | "semente" | "vigia" | "clareza" | "codeQuality" | "portao" | "ensaio" | "chaveiro" | "rumo";
/** Which sources the Comandante judges: one switch per source. */
export type ComandanteSources = Record<ComandanteSource, boolean>;
/** The Comandante's decision: let it through, block it, or send a question back to whoever raised it. */
export type ComandanteDecision = "approved" | "rejected" | "questioned";
/**
 * The Comandante's ruling as the item it judged keeps it: the decision and its reason, a key of COMANDANTE_VERDICTS,
 * and its record's id in the log, so a later step can note on it what became of the item.
 */
export type ComandanteRuling = { decision: ComandanteDecision; reason: string; record?: string };
/**
 * One decision of the Comandante, as the log every session of the project shares keeps it: when, the session
 * (id, name and project) and the agent that raised it, what it said, the decision and its reason, a key of
 * COMANDANTE_VERDICTS (hooks/core/comandante.ts), with Jev's confidence; `releasedAt` once the person let a message
 * it held (a Vigia message) through to Claude.
 */
export type ComandanteRecord = { id: string; at: number; session: string; sessionName: string; project: string; source: ComandanteSource; agent?: string; summary: string; decision: ComandanteDecision; reason: string; confidence: number; releasedAt?: number };
/** The Comandante tab's filters: a session's id or "all", a decision or "all". */
export type ComandanteFilter = { session: string; decision: ComandanteDecision | "all" };
/** One finding of a Code Quality cycle: where it is (`file:line`, when the agent named it) and what it says. */
export type QualityItem = { where?: string; text: string };
/** One review cycle of the Code Quality agent, from the edits that started it to the report it gave back. */
export type QualityCycle = {
  n: number;
  startedAt: number;
  endedAt?: number;
  /** The files edited since the cycle before, which started this one; empty when started by hand. */
  files: string[];
  state: "running" | "done" | "failed";
  reviewed: string[];
  fixed: QualityItem[];
  /** What the agent left as it was, and why (another session's work in the way, nowhere to fix it). */
  skipped: QualityItem[];
  summary?: string;
};

/**
 * What an autonomous agent offers the person, with Enviar and Rejeitar: the words that go to Claude (or what Enviar
 * changes), and what became of it: waiting on the person, sent, rejected, or `blocked` by the Comandante, whose ruling
 * it keeps. Enviar never acts without the person, whatever the Comandante decided.
 */
export type AgentProposal = { text: string; state: "waiting" | "sent" | "rejected" | "blocked"; comandante?: ComandanteRuling };
/** One check of a Portão run: Code Quality over the files no cycle reviewed, the tests the change reaches, a security review. */
export type PortaoCheck = { kind: "quality" | "tests" | "security"; state: "waiting" | "running" | "passed" | "failed" | "skipped"; note?: string };
/**
 * One Portão run: the git command it held, at the edit count it was held at (one run per change set), the checks Jev
 * chose and how they ended. `passed` and `failed` wait on the person's proposal (redo the command; send the failures
 * to Claude); `released` was let through anyway. `verified` is the independent review of the security reviewer's
 * result, when one ran. `cleared`: the person's Limpar feitos hid it from the tab; it stays in the record, where the
 * newest run still holds the gate's state and numbers the next one.
 */
export type PortaoRun = { n: number; at: number; endedAt?: number; command: string; verb: "commit" | "push"; generation: number; state: "checking" | "passed" | "failed" | "released"; checks: PortaoCheck[]; findings: string[]; summary?: string; proposal?: AgentProposal; verified?: boolean; cleared?: boolean };
/**
 * Rumo's goal: the condition taken from the person's request, the objective it belongs to, the turns it may add and
 * has added, and where it stands: `proposed` waits on the person, `active` keeps Claude going, and it ends `met`,
 * `impossible`, at its `limit`, `stopped` by the person or rejected. `why` is Jev's last reading.
 */
export type RumoGoal = { id: string; at: number; endedAt?: number; condition: string; request: string; objective?: string; turnsMax: number; turnsUsed: number; state: "proposed" | "active" | "met" | "impossible" | "limit" | "stopped" | "rejected" | "blocked"; why?: string; comandante?: ComandanteRuling };
/**
 * One Ensaio run: the files that changed, whether it ran the app and what it saw (`works`, `broken`, or `not_run` when
 * it could not), the problems it found and its proposal (a fix request, or a run book when the project has none).
 * `skipped` says why it did not start (another session runs the app or its tests).
 */
export type EnsaioRun = { n: number; at: number; endedAt?: number; files: string[]; state: "running" | "done" | "failed" | "skipped"; verdict?: "works" | "broken" | "not_run"; summary?: string; problems: QualityItem[]; note?: string; proposal?: AgentProposal & { kind: "fix" | "runbook" }; verified?: boolean };
/** One permission rule Chaveiro proposes: the command it was asked for, the rule and the settings file Jev chose, how many approvals led to it. */
export type ChaveiroRule = { id: string; at: number; tool: string; sample: string; rule: string; scope: "project" | "local" | "user"; count: number; proposal: AgentProposal };
/** One Oficina check: why it ran (a new Claude Code version, a full context at the start), what `claude doctor` found, and its suggestion. */
export type OficinaCheck = { id: string; at: number; version: string; reason: "version" | "context"; findings: string[]; proposal?: AgentProposal };

export type FeedKind = "turn" | "step" | "jev" | "call" | "tool" | "agent" | "message" | "feature" | "error";
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
      featurePreferences: FeaturePreferences;
      farolItems: FarolAssumption[];
      farolRules: FarolRule[];
      farolBusy: boolean;
      farolSeq: number;
      clarezaStatus: string;
      clarezaGrade: ClarezaGrade | null;
      clarezaProposal: ClarezaProposal | null;
      clarezaReviewing: boolean;
      contextoBusy: boolean;
      /** True while Vigia summarizes this session for the others. */
      vigiaSummarizing: boolean;
      /** Guidance the local advisor gave this session with orchestration off, counted under limits.adviceCalls. */
      localAdviceUsed: number;
      clarezaRewrite: boolean;
      clarezaToldTerms: number;
      sementeIdeas: SementeIdea[];
      sementeNudges: string[];
      lapidaPhase: LapidaPhase;
      lapidaNote: string;
      lapidaEnhanced: string;
      lapidaChanges: string[];
      prismaPending: PrismaPicker | null;
      sentinelaSessions: SentinelaSession[];
      sentinelaProblem: string;
      sentinelaReplyTo: string;
      vigiaSessions: VigiaSession[];
      vigiaCollapsed: boolean;
      qualityCycles: QualityCycle[];
      /** The autonomous agents' records, newest first: Portão's runs, Rumo's goals (the first the current one), Ensaio's runs, Chaveiro's rules, Oficina's checks. */
      portaoRuns: PortaoRun[];
      rumoGoals: RumoGoal[];
      ensaioRuns: EnsaioRun[];
      chaveiroRules: ChaveiroRule[];
      oficinaChecks: OficinaCheck[];
      vigiaMail: VigiaMail[];
      /** The Comandante's decisions of every session of the project, newest first, as last read from their files. */
      comandanteLog: ComandanteRecord[];
      comandanteFilter: ComandanteFilter;
      /** True while the Comandante waits for Jev's verdict. */
      comandanteBusy: boolean;
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
      /** The last orchestration command's reply, shown on the Configuration tab. */
      orchMessage: { ok: boolean; text: string } | null;
    };
  }
}
