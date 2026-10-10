// Jev observes requests and offers optional model/effort selection for native subagent spawns.
// Runtime records actual requests, tool results, usage, and failures even when Jev is unavailable.
//
// Every function that reaches `$` is declared here at the top level, so `claude plugin validate`
// can follow each call; the other files are pure.
import { atom, read, update } from "claude-code";
import type { ElementTable, EngineInterface, PromptComposeInput, PromptSubmitInput, Register, RenderChildren, RenderSurface, Timer } from "claude-code";

import type { AdvisorInfo, AgentRun, FeatureFlags, FeaturePreferences, FarolAssumption, FarolRule, ClarezaGrade, SementeIdea, LapidaPhase, PrismaPicker, PrismaQuestion, PrismaOption, SentinelaSession, VigiaSession, VigiaTask, FeedEntry, PaneScroll, FeedKind, FeedSpeaker, FeedTone, JevTab, LiveNow, RouteEvent, SetupDraft, TraceState } from "../types";
import { keyFor, keyOwner, providerBasis, resolveSettings, storedApplies, type ModOptions, type Settings, type StoredSettings } from "./config.ts";
import { channelFile, channelReader, FOLLOW_SCRIPT } from "./core/channel.ts";
import { compactContextSession, contextReductionRatio, resolveContextConfig, type ContextJevAsker, type ContextJevResponse, type ContextResult, type ContextSessionMessage, type ResolvedContextConfig } from "./core/compaction.ts";
import { createAskJev, isProvider, observeAskJev, PROVIDERS, redact, resolveModel, validateKey, type AskJev, type JevEvent, type JevSent, type ProviderId, type Transport } from "./core/jev.ts";
import type { ModelContext } from "./core/types.ts";
import { featureGate, sizeRequest, totalInput, type FeatureContext } from "./core/runtime.ts";
import {
  DEFAULT_FEATURES,
  planAgent,
  type Effort,
} from "./core/plan.ts";
import { KEPT_EVENTS, RANGES } from "./events.ts";
import { featureFlagsText, features as featureList, jevAnswered, jevAsked, jevFailed, modelName, outputSize, short, toolDetails, toolSummary, type JevCaller } from "./feed.ts";
import { resultText } from "./input.ts";
import { failureHint, failureKind } from "./errors.ts";
import { AGENT_MASCOTS, isMascot, pickMascot, type MascotId } from "./mascots/agents.ts";
import {
  advisorBlocker,
  agentStart,
  clearTrace,
  completeTurn,
  consultEnd,
  consultStart,
  emptyTrace,
  noteAdvice,
  promptEntered,
  setAdvisorInfo,
  startTurn,
  stepEnd,
  stepStart,
  submitPrompt,
  toolEnd,
  toolStart,
  traceOf,
  type ConsultWhere,
} from "./trace.ts";
import { renderAbove, renderAgentPane, renderPane, type Actions, type DeckPanel, type View } from "./ui.tsx";
import { flowSummary } from "./flow.ts";
import * as orch from "./orchestrate.ts";
import { MODEL_LABEL } from "./core/orchestration.ts";
import { formatCompact, formatDecimal, formatDuration, formatNumber, formatPercent, localeFor, text, type Locale, type LocaleKey, type LocaleOption } from "./i18n.ts";
import { renderDeck, FRAME_MS, type DeckBand, type Surface } from "./deck/band.tsx";
import { DEFAULT_SETTINGS, parseSettings, serializeSettings, type DeckSettings } from "./deck/settings.ts";
import {
  ASK_DELAY_MS,
  askedQuestion,
  callAnswered,
  callDone,
  callStart,
  clearRows,
  clockText,
  collectRows,
  costSeenFrom,
  createDeckState,
  DECK_VERSION,
  demoTick,
  dismissRow,
  finishAgent,
  hasLiveAgents,
  histFrom,
  markWaiting,
  petMood,
  react,
  readRouteLog,
  readRouteStatus,
  sampleRow,
  sampleUsage,
  settleAgents,
  spendFrom,
  spendRecord,
  startAgent,
  promptSubmitted,
  startDemo,
  statusText as deckStatusText,
  takePingoRoute,
  takeUsage,
  taskCompleted,
  taskCreated,
  turnEnded,
  turnStarted,
  weatherText,
  type CallResult,
  type ContextUsage,
  type DeckRow,
  type DeckSound,
  type DeckState,
  type ToolCall,
} from "./deck/model.ts";
import { createPet, petLaneCells, petLaneColumns, stepPet, PET_BRAILLE, type Pet } from "./deck/pet.ts";
import { cellsOf } from "./dots.ts";
import { FOLD_FADE, FOLD_STEP, TRACK_H, toTrackRow, type DrawCaches } from "./deck/rows.ts";
import { DESKTOP_STYLES, DESKTOP_STYLE_NAMES, desktopTrack } from "./deck/styles-desktop.ts";
import { TERMINAL_STYLES, TERMINAL_STYLE_NAMES, terminalBar } from "./deck/styles-terminal.ts";
import { applyDeckCommand, deckUsage, deckWords, openReply } from "./deck/wire.ts";
import { DIM, runs } from "./deck/theme.ts";
import { DECK_DESIGN, GLYPH, PAINT, UI_DESIGN } from "./theme.ts";

const PANE = "jev";
type FeatureId = keyof FeatureFlags;
type PromptComposeEvent = Pick<PromptComposeInput, "tools">;
const PET_HATS = ["tophat", "party", "crown", "wizard", "cowboy", "propeller", "chef", "viking", "halo", "santa", "nightcap"] as const;
const DEFAULT_FEATURE_PREFERENCES: FeaturePreferences = {
  assumptionScope: "all", plainLevel: "beginner", plainReview: true, plainSound: true, petHat: "random", petShades: false,
  designSurface: "auto", ideaNudges: true, promptLearning: true, monitorEveryMs: 2000, trackerSummary: true, clashMinutes: 30,
};
const featurePreferences = atom({ plugin: "jev", key: "featurePreferences" } as const, DEFAULT_FEATURE_PREFERENCES);
const events = atom({ plugin: "jev", key: "events" } as const, [] as RouteEvent[]);
const routing = atom({ plugin: "jev", key: "routing" } as const, true);
const tab = atom({ plugin: "jev", key: "tab" } as const, "overview" as JevTab);
const range = atom({ plugin: "jev", key: "range" } as const, RANGES[1]![1]);
const setup = atom({ plugin: "jev", key: "setup" } as const, { provider: "", message: "", isOk: false } as SetupDraft);
const features = atom({ plugin: "jev", key: "features" } as const, { ...DEFAULT_FEATURES } as FeatureFlags);
const farolItems = atom({ plugin: "jev", key: "farolItems" } as const, [] as FarolAssumption[]);
const farolRules = atom({ plugin: "jev", key: "farolRules" } as const, [] as FarolRule[]);
const farolBusy = atom({ plugin: "jev", key: "farolBusy" } as const, false);
const farolSeq = atom({ plugin: "jev", key: "farolSeq" } as const, 0);
const clarezaStatus = atom({ plugin: "jev", key: "clarezaStatus" } as const, "");
/** The last orchestration command's reply, shown on the Configuration tab. */
const orchMessage = atom({ plugin: "jev", key: "orchMessage" } as const, null as { ok: boolean; text: string } | null);
const clarezaGrade = atom({ plugin: "jev", key: "clarezaGrade" } as const, null as ClarezaGrade | null);
const clarezaRewrite = atom({ plugin: "jev", key: "clarezaRewrite" } as const, false);
const clarezaToldTerms = atom({ plugin: "jev", key: "clarezaToldTerms" } as const, 0);
const sementeIdeas = atom({ plugin: "jev", key: "sementeIdeas" } as const, [] as SementeIdea[]);
const sementeNudges = atom({ plugin: "jev", key: "sementeNudges" } as const, [] as string[]);
const lapidaPhase = atom({ plugin: "jev", key: "lapidaPhase" } as const, "idle" as LapidaPhase);
const lapidaNote = atom({ plugin: "jev", key: "lapidaNote" } as const, "");
const lapidaEnhanced = atom({ plugin: "jev", key: "lapidaEnhanced" } as const, "");
const lapidaChanges = atom({ plugin: "jev", key: "lapidaChanges" } as const, [] as string[]);
const prismaPending = atom({ plugin: "jev", key: "prismaPending" } as const, null as PrismaPicker | null);
const sentinelaSessions = atom({ plugin: "jev", key: "sentinelaSessions" } as const, [] as SentinelaSession[]);
const sentinelaProblem = atom({ plugin: "jev", key: "sentinelaProblem" } as const, "");
const sentinelaReplyTo = atom({ plugin: "jev", key: "sentinelaReplyTo" } as const, "");
const vigiaSessions = atom({ plugin: "jev", key: "vigiaSessions" } as const, [] as VigiaSession[]);
const vigiaCollapsed = atom({ plugin: "jev", key: "vigiaCollapsed" } as const, false);
const feed = atom({ plugin: "jev", key: "feed" } as const, [] as FeedEntry[]);
const live = atom({ plugin: "jev", key: "now" } as const, {} as LiveNow);
const agents = atom({ plugin: "jev", key: "agents" } as const, [] as AgentRun[]);
/** The highest subagent number handed out: kept beside the runs, so it lives exactly as long as they do. */
const agentCount = atom({ plugin: "jev", key: "agentCount" } as const, 0);
const scroll = atom({ plugin: "jev", key: "scroll" } as const, {} as PaneScroll);
/** Deck's preferences as shown, and whether its band is expanded now (it may open itself). */
const deckSettings = atom({ plugin: "jev", key: "deckSettings" } as const, DEFAULT_SETTINGS as DeckSettings);
const deckExpanded = atom({ plugin: "jev", key: "deckExpanded" } as const, false);
/** Bumped on each Deck change: the band and its panes read it, so a change redraws them through the atom. */
const deckRevision = atom({ plugin: "jev", key: "deckRevision" } as const, 0);
/** The Flow tab's record, schema 2 under a key of its own: the old FlowState is never read as it. */
const trace = atom({ plugin: "jev", key: "flowV2" } as const, emptyTrace() as TraceState);
/** Tools whose call is an edit, for the Flow tab's count. */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const STORE_EVENTS = "events";
const STORE_ROUTING = "routing";
const LEGACY_STORE_KEY = "apiKey";
const STORE_PROVIDER = "provider";
const STORE_LOCALE = "locale";
/** The key and provider accepted in Setup, kept in this plugin's store file under ~/.claude/plugins/store so a restart keeps them. */
const STORE_CREDENTIALS = "credentials";
const STORE_FEATURES = "features";
/** Deck's preferences, and its spend with the session that counted it. */
const STORE_DECK = "deck";
const STORE_DECK_SPEND = "deckSpend";
/** Deck's usage history, for the sparklines and burn rates: kept across sessions. */
const STORE_DECK_HIST = "deckHist";
/** An open or close in progress: its rows step one a step, and the ticks it has run. */
type DeckFold = { dir: "open" | "close"; start: number; ticks: number };
/** The fold's timer tick, in milliseconds. */
const FOLD_TICK = 33;
const FEED_SIZE = 1000;
/** Subagents kept for the Agents tab: every running one, then the latest finished. */
const KEPT_AGENTS = 40;
/** Each subagent's own live pane: `jev-agent-<n>`. */
const AGENT_PANE = "jev-agent-";
// Module state: lost on a reload, which is fine for each of these.
let options: ModOptions = {};
let contextCompacting = false;
let settings: Settings | undefined;
let sessionId = "";
/** The session's full id: Deck keys what each session has counted by it. */
let deckSessionId = "";
let feedSeq = 0;
/** The highest request-log number this module wrote, and the tail of its queue of writes. */
let eventSeq = 0;
let eventWrites: Promise<unknown> = Promise.resolve();
/**
 * Running subagents by id: their type, model and the effort Jev chose. A teammate stays after its
 * turn ends, since it goes idle and wakes on a message under the same id.
 */
type AgentInfo = { type: string; model: string; effort?: Effort; description: string; mascot?: MascotId; teammate?: true; awake?: boolean; orchestrated?: true };
const agentRuns = new Map<string, AgentInfo>();
const toolStarts = new Map<string, number>();
/**
 * The key being typed in Setup, and the key accepted this session. Only here, in the module: the
 * pane's state holds a masked copy, and a saved key goes to Claude Code's secure plugin storage.
 */
let draftKey = "";
let sessionKey = "";
/** The provider the Setup key was tested against: the two go together for the session. */
let sessionProvider: ProviderId | undefined;
let mainModel: string | undefined;
/**
 * Deck's rows and draw memories for this session. The rows hold Maps, so they live here and not in
 * an atom; the caches keep a moving bar or strip from restarting between redraws.
 */
let deck: DeckState | undefined;
let deckCaches: DrawCaches = { head: new Map(), strip: new Map() };
let deckPet: Pet | undefined;
let sessionPetHat = "tophat";
let petHatOverride: string | undefined;
let petHatOverrideUntil = 0;
let clarityLastAsk = "";
const sementeTopics = new Set<string>();
let sementeShelvedThisTurn = new Set<string>();
const sementeDismissed = new Set<string>();
let sentinelaDir = "";
let sentinelaMe = "";
let sentinelaRefreshedAt = 0;
let vigiaMe: VigiaSession | undefined;
let vigiaDir = "";
/** The band's clock (every 150 ms), its frame count, the fold in progress and its timer, and the demo's timer. */
let deckLoop: Timer | undefined;
let deckPetLoop: Timer | undefined;
let deckFrame = 0;
let deckFold: DeckFold | undefined;
let deckFoldTimer: Timer | undefined;
let deckDemo: Timer | undefined;
/**
 * When a band was last drawn on each surface, and when the Jev dashboard was: what moves, and how often, depends on
 * what is on screen, which is what was drawn within this long.
 */
let deckShownTerminalAt = Number.NEGATIVE_INFINITY;
let deckShownDesktopAt = Number.NEGATIVE_INFINITY;
let paneShownAt = Number.NEGATIVE_INFINITY;
/** Longer than the second between the clock's redraws, so a late timer never reads a band that is there as gone. */
const ON_SCREEN_MS = 2500;
/** The terminal sites that draw the pet's lane, by the requestId they are drawn under: their width, the cells last put there, and when each was last drawn. */
const deckLanes = new Map<string, { columns: number; cells: string; seenAt: number }>();
/** When the rows' own motion last asked for a redraw. */
let rowsRedrawnAt = Number.NEGATIVE_INFINITY;
/** The host would not take a repaint (no `$.ui.blit`, or it threw): the terminal pet then moves with a slow redraw instead. */
let blitBroken = false;
/**
 * The dashboard's Deck tab: the last reply to a control (with the command word that earned it and the
 * settings and language it was given under) and the city being typed.
 */
let deckNote: (NonNullable<DeckPanel["note"]> & { key: string }) | null = null;
let deckDraft = "";
let orchestrationDraft = "";

function transport($: EngineInterface, locale?: Locale): Transport {
  return {
    post: async (url, headers, body) => {
      const reply = await $.http.fetch(url, { method: "POST", headers, body });
      return { status: reply.status, ok: reply.ok, text: reply.text };
    },
    sleep: (ms) => $.clock.sleep(ms),
    within: (ms, work) =>
      new Promise((resolve, reject) => {
        const timer = $.clock.after(ms, () => reject(new Error(text("provider.timeout", locale, { ms: formatNumber(ms, locale ?? "en") }))));
        work.then(
          (value) => {
            timer.cancel();
            resolve(value);
          },
          (error: unknown) => {
            timer.cancel();
            reject(error);
          },
        );
      }),
  };
}

async function processEnv($: EngineInterface): Promise<Record<string, string>> {
  const pairs: [string, string | undefined][] = [
    ["JEV_PROVIDER", await $.env.get("JEV_PROVIDER")],
    ["JEV_MIN_CONFIDENCE", await $.env.get("JEV_MIN_CONFIDENCE")],
    ["JEV_TIMEOUT_MS", await $.env.get("JEV_TIMEOUT_MS")],
    ["TYPESAFE_API_KEY", await $.env.get("TYPESAFE_API_KEY")],
    ["OPENROUTER_API_KEY", await $.env.get("OPENROUTER_API_KEY")],
    ["AI_GATEWAY_API_KEY", await $.env.get("AI_GATEWAY_API_KEY")],
    ["OPENCODE_API_KEY", await $.env.get("OPENCODE_API_KEY")],
  ];
  return Object.fromEntries(pairs.filter((pair): pair is [string, string] => Boolean(pair[1]?.trim())));
}

async function storedSettings($: EngineInterface, env: Record<string, string>): Promise<StoredSettings> {
  // Older versions kept the key under a bare "apiKey"; it moves to the credentials entry.
  const legacyKey = await $.store.get(LEGACY_STORE_KEY);
  if (typeof legacyKey === "string") await $.store.delete(LEGACY_STORE_KEY);
  if (!sessionKey && !options.api_key?.trim()) {
    const saved = (await $.store.get(STORE_CREDENTIALS).catch(() => undefined)) as { apiKey?: unknown; provider?: unknown } | undefined;
    if (typeof saved?.apiKey === "string" && saved.apiKey.trim()) {
      sessionKey = saved.apiKey.trim();
      if (typeof saved.provider === "string" && isProvider(saved.provider)) sessionProvider = saved.provider;
    }
  }
  // Setup's fallback provider, as `{ provider, basis }` (a bare string from older versions). Once the
  // provider option or JEV_PROVIDER has changed since it was saved, that change wins and it goes.
  const saved = await $.store.get(STORE_PROVIDER);
  if (saved === undefined) return {};
  const stored = (typeof saved === "string" ? { provider: saved } : typeof saved === "object" && saved ? saved : {}) as StoredSettings;
  if (storedApplies(options, env, stored)) return stored;
  await $.store.delete(STORE_PROVIDER).catch(() => undefined);
  return {};
}

/** The plugin options with the key accepted in Setup this session, if any. */
const pluginOptions = (): ModOptions =>
  sessionKey ? { ...options, api_key: sessionKey, ...(sessionProvider ? { provider: sessionProvider } : {}) } : options;

async function getSettings($: EngineInterface): Promise<Settings> {
  if (settings) return settings;
  const env = await processEnv($);
  const stored = await storedSettings($, env);
  const locale = await $.store.get(STORE_LOCALE).catch(() => undefined);
  settings = resolveSettings({
    ...pluginOptions(),
    ...(locale === "auto" || locale === "en" || locale === "pt" ? { locale } : {}),
  }, env, stored);
  return settings;
}

// --- The live log and the band ---

/** Who speaks: you, Jev, Claude, a subagent (named by its type, with its id) or the mod itself. */
type Speaker = FeedSpeaker | { agent: string; id?: string; mascot?: MascotId };

/**
 * One line of the live log. `about` ties a line someone else says to a subagent (Jev choosing its
 * model, the mod sending its request), so that subagent's own live pane shows it too.
 */
async function log(
  $: EngineInterface,
  speaker: Speaker,
  kind: FeedKind,
  tone: FeedTone,
  text: string,
  about?: string,
  extra: Pick<FeedEntry, "detail" | "meta" | "minor"> = {},
): Promise<number> {
  const who = typeof speaker === "string" ? speaker : "agent";
  const mascot = typeof speaker === "string" ? undefined : speaker.mascot;
  // A subagent goes by its mascot's name; its type shows in its pane and the Agents tab.
  const name = typeof speaker === "string" ? undefined : mascot ? AGENT_MASCOTS[mascot].name : speaker.agent;
  const agent = typeof speaker === "string" ? about : (speaker.id ?? about);
  const time = await $.clock.now();
  let seq = 0;
  await update($, feed, (list) => {
    // Numbered from the kept log, not a module counter, so a reload never reuses a number.
    seq = Math.max(feedSeq, list.at(-1)?.seq ?? 0) + 1;
    feedSeq = seq;
    const entry: FeedEntry = {
      seq,
      time,
      who,
      ...(name ? { name } : {}),
      ...(agent ? { agent } : {}),
      ...(mascot ? { mascot } : {}),
      kind,
      tone,
      text,
      ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined && value !== "" && value !== false)),
    };
    return [...list, entry].slice(-FEED_SIZE);
  });
  return seq;
}

/** Rewrites a line already in the log: a tool's line once it ends, a request's once it answers. */
async function patch($: EngineInterface, seq: number, change: Partial<Pick<FeedEntry, "text" | "tone" | "detail" | "meta" | "minor">>): Promise<void> {
  await update($, feed, (list) => (list.some((entry) => entry.seq === seq) ? list.map((entry) => (entry.seq === seq ? { ...entry, ...change } : entry)) : list));
}

/** Changes one subagent's record, when it is still kept. */
async function updateRun($: EngineInterface, id: string, change: (run: AgentRun) => AgentRun): Promise<void> {
  await update($, agents, (list) => (list.some((run) => run.id === id) ? list.map((run) => (run.id === id ? change(run) : run)) : list));
}

/** The Flow tab's record as kept; a value of another schema reads as empty. */
async function readTrace($: EngineInterface): Promise<TraceState> {
  return traceOf(await read($, trace));
}

/** One reducer step on the Flow tab's record. */
async function updateTrace($: EngineInterface, change: (s: TraceState) => TraceState): Promise<TraceState> {
  return update($, trace, (s) => change(traceOf(s)));
}

/** A subagent that started joins the Flow tab's run of the loop that spawned it. */
async function traceSpawn(
  $: EngineInterface,
  e: { parentAgentId?: string; tool_use_id: string; subagentType: string; description: string; background?: boolean },
  id: string,
  model: string,
): Promise<void> {
  const at = await $.clock.now();
  await updateTrace($, (s) =>
    agentStart(s, {
      id,
      ...(e.parentAgentId ? { parent: e.parentAgentId } : {}),
      ...(e.tool_use_id ? { toolUseId: e.tool_use_id } : {}),
      type: e.subagentType,
      description: e.description,
      model,
      ...(e.background ? { background: true } : {}),
      at,
    }),
  );
}

/** The file an edit tool names, when it names one. */
function editedFile(input: Record<string, unknown>): string | undefined {
  return typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : undefined;
}

/**
 * What settings and the environment say about the advisor, for the Flow tab: informative only. A
 * --advisor flag or /advisor can override the setting unseen, so it is shown as "configured".
 */
async function advisorInfo($: EngineInterface): Promise<AdvisorInfo> {
  const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>);
  const configured = typeof settings.advisorModel === "string" && settings.advisorModel.trim() ? settings.advisorModel.trim() : undefined;
  const blocked = advisorBlocker({
    DISABLE_TELEMETRY: await $.env.get("DISABLE_TELEMETRY"),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: await $.env.get("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"),
    DO_NOT_TRACK: await $.env.get("DO_NOT_TRACK"),
    CLAUDE_CODE_USE_BEDROCK: await $.env.get("CLAUDE_CODE_USE_BEDROCK"),
    CLAUDE_CODE_USE_VERTEX: await $.env.get("CLAUDE_CODE_USE_VERTEX"),
    CLAUDE_CODE_USE_FOUNDRY: await $.env.get("CLAUDE_CODE_USE_FOUNDRY"),
  });
  return { ...(configured ? { configured } : {}), ...(blocked ? { blocked } : {}) };
}

/**
 * Adds a subagent that just started, numbered after every one this session has seen, removed or
 * not, so a number never names two runs; finished ones beyond the cap go.
 */
async function addRun($: EngineInterface, run: Omit<AgentRun, "n" | "mascot">): Promise<AgentRun> {
  let added: AgentRun | undefined;
  const reserved = await update($, agentCount, (last) => last + 1);
  await update($, agents, (list) => {
    const n = Math.max(reserved, ...list.map((one) => one.n + 1));
    // A mascot no running subagent wears, so two at once never look alike.
    const mascot = pickMascot(list.filter((one) => one.state === "running").map((one) => one.mascot), n);
    added = { ...run, n, mascot };
    const all = [...list, added];
    const finished = all.filter((one) => one.state !== "running");
    const drop = new Set(finished.slice(0, Math.max(0, all.length - KEPT_AGENTS)).map((one) => one.id));
    return all.filter((one) => !drop.has(one.id));
  });
  // Runs kept from before the count existed may number past it: catch it up.
  if (added!.n > reserved) await update($, agentCount, (last) => Math.max(last, added!.n));
  return added!;
}

/** A teammate's next turn: its run shows as running again, added back if a clear dropped it. */
async function wakeRun($: EngineInterface, id: string, mate: AgentInfo, locale: Locale): Promise<void> {
  mate.awake = true;
  let kept = false;
  await update($, agents, (list) => {
    const run = list.find((one) => one.id === id);
    if (!run) return list;
    kept = true;
    if (run.state === "running") return list;
    const { endedAt: _endedAt, ...awake } = run;
    // Another subagent may have taken its mascot while it was idle.
    const worn = list.filter((one) => one.state === "running").map((one) => one.mascot);
    const mascot = worn.includes(run.mascot) ? pickMascot(worn, run.n) : run.mascot;
    return list.map((one) => (one.id === id ? { ...awake, state: "running" as const, mascot } : one));
  });
  if (!kept) {
    await addRun($, {
      id,
      type: mate.type,
      description: mate.description,
      prompt: "",
      model: mate.model,
      ...(mate.effort ? { effort: mate.effort } : {}),
      startedAt: await $.clock.now(),
      state: "running",
      tools: 0,
      requests: 0,
      activity: text("feed.activity.starting", locale),
    });
  }
  const mascot = (await read($, agents)).find((one) => one.id === id)?.mascot;
  if (isMascot(mascot)) mate.mascot = mascot;
}

/** Opens one subagent's own live pane, beside the Jev pane. */
async function openAgentPane($: EngineInterface, run: AgentRun): Promise<void> {
  await $.ui.open({ id: `${AGENT_PANE}${run.n}`, title: agentTitle(run), focus: true });
}

/** A subagent by its lightweight name, type, and number. */
function agentTitle(run: AgentRun): string {
  const mascot = isMascot(run.mascot) ? AGENT_MASCOTS[run.mascot] : undefined;
  return mascot ? `${mascot.name} · ${run.type} #${run.n}` : `${run.type} #${run.n}`;
}

/** Takes finished subagents off the Agents tab and closes their panes; running ones stay. */
async function removeRuns($: EngineInterface, which: (run: AgentRun) => boolean): Promise<AgentRun[]> {
  let removed: AgentRun[] = [];
  await update($, agents, (list) => {
    removed = list.filter((run) => run.state !== "running" && which(run));
    return list.filter((run) => !removed.includes(run));
  });
  for (const run of removed) await $.ui.close({ id: `${AGENT_PANE}${run.n}` });
  return removed;
}

/** `/jev agent 3`, `/jev agent explore`, or the latest one: running first, then the newest. */
function findRun(list: readonly AgentRun[], which: string): AgentRun | undefined {
  if (!which) return list.findLast((run) => run.state === "running") ?? list.at(-1);
  const n = Number(which.replace(/^#/, ""));
  if (Number.isInteger(n) && n > 0) return list.find((run) => run.n === n);
  const plain = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ofType = list.filter((run) => plain(run.type) === plain(which) || (isMascot(run.mascot) && plain(AGENT_MASCOTS[run.mascot].name) === plain(which)));
  return ofType.findLast((run) => run.state === "running") ?? ofType.at(-1);
}

async function setLive($: EngineInterface, change: Partial<LiveNow>): Promise<void> {
  await update($, live, (now) => {
    const next: LiveNow = { ...now, ...change };
    for (const key of Object.keys(change) as (keyof LiveNow)[]) if (change[key] === undefined) delete next[key];
    return next;
  });
}

/** Marks the live status while a Jev request is in flight. */
async function asking<T>($: EngineInterface, work: () => Promise<T>): Promise<T> {
  await setLive($, { asking: true });
  try {
    return await work();
  } finally {
    await setLive($, { asking: undefined });
  }
}

/** Where a Jev call was asked from: the run the Flow tab counts it in, who asked, and what set it off. */
type JevWhere = ConsultWhere & { origin: JevCaller["origin"]; trigger?: string };

/**
 * Where every Jev call lands, the mod's own and sift's: one live-log line per call, naming the
 * function that asked and each question's prompt, turned into Jev's answers with their odds when
 * it ends; the Flow tab counts it in the run it was asked for. `where` is read as each call
 * starts, since sift's calls arrive from whichever loop ran the command.
 */
function jevReporter($: EngineInterface, locale: Locale, where: () => JevWhere): (event: JevEvent) => Promise<void> {
  const open = new Map<string, { consult: string; startedAt: number; line: number; sent: JevSent; caller: JevCaller }>();
  return async (event) => {
    if (event.phase === "start") {
      const at = where();
      const caller: JevCaller = { origin: at.origin, ...(at.trigger ? { trigger: at.trigger } : {}) };
      const card = jevAsked(event.sent, caller, locale);
      const line = await log($, "jev", "call", "info", card.text, undefined, { detail: card.detail, meta: text("feed.jev.asking", locale) });
      let consult = "";
      await updateTrace($, (s) => {
        const [next, id] = consultStart(s, at, { origin: at.origin, model: event.sent.model, questions: event.sent.questions, startedAt: event.at });
        consult = id;
        return next;
      });
      open.set(event.call, { consult, startedAt: event.at, line, sent: event.sent, caller });
      return;
    }
    const call = open.get(event.call);
    open.delete(event.call);
    const meta = call ? `${formatNumber(Math.max(0, event.at - call.startedAt), locale)} ms` : undefined;
    if (event.phase === "fail") {
      if (call) await updateTrace($, (s) => consultEnd(s, call.consult, event.at, event.error));
      const hint = failureHint(failureKind(event.error), locale);
      if (call) {
        const card = jevFailed(call.sent, call.caller, event.error, hint, locale);
        await patch($, call.line, { text: card.text, tone: "bad", detail: card.detail, ...(meta ? { meta } : {}) });
        return;
      }
      await log($, "jev", "error", "bad", text("feed.request.failed", locale, { message: short(event.error, 160) }), undefined, {
        meta,
        detail: `${event.error.slice(0, 240)}\n${hint}`,
      });
      return;
    }
    if (!call) return;
    const usage = event.result.usage;
    const rawUsage = usage && (
      typeof usage.input_tokens === "number" || typeof usage.output_tokens === "number"
    ) ? {
      ...(typeof usage.input_tokens === "number" ? { input: usage.input_tokens } : {}),
      ...(typeof usage.output_tokens === "number" ? { output: usage.output_tokens } : {}),
    } : undefined;
    await updateTrace($, (s) => consultEnd(s, call.consult, event.at, undefined, {
      ...(typeof event.result.model === "string" ? { observed: event.result.model } : {}),
      ...(rawUsage ? { usage: rawUsage } : {}),
    }));
    const card = jevAnswered(call.sent, call.caller, event.result, locale);
    await patch($, call.line, { text: card.text, tone: "good", detail: card.detail, ...(meta ? { meta } : {}) });
  };
}

/** The mod's own Jev call, through the one path every caller takes (observeAskJev, then jevReporter). */
function tracedAskJev($: EngineInterface, config: Settings, where: JevWhere): AskJev {
  return observeAskJev(createAskJev(config, transport($, config.locale)), jevReporter($, config.locale, () => where), () => $.clock.now());
}

/** Who makes one of the mod's model calls besides Jev's: a feature, or orchestration's advice and review. */
type ModelCaller = "lapida" | "clareza" | "vigia" | "orchestration";
type ModelReply = Awaited<ReturnType<EngineInterface["model"]["fork"]>>;

/**
 * Every model call of the mod's besides Jev's, through one path: the request goes out as given and its reply comes
 * back as it came, while one line of the live log (kind "call", which Logs lists too) says who asked, which model,
 * and how it went. The line is written alongside, so logging never delays the caller.
 */
function callModel<R extends ModelReply>($: EngineInterface, caller: ModelCaller, model: string | undefined, call: () => Promise<R>): Promise<R> {
  const reply = call();
  void reportCall($, caller, model, reply).catch(() => undefined);
  return reply;
}

/** callModel's line of the live log: written as the call goes out, then told how it ended. */
async function reportCall($: EngineInterface, caller: ModelCaller, model: string | undefined, reply: Promise<ModelReply>): Promise<void> {
  const startedAt = await $.clock.now();
  const locale = (await getSettings($)).locale;
  const head = {
    who: text(caller === "orchestration" ? "ui.orch.title" : `feature.${caller}.name`, locale),
    model: model ? modelName(model) : text("feed.call.fork", locale),
  };
  const line = await log($, "mod", "call", "info", text("feed.call.asking", locale, head), undefined, { meta: text("feed.jev.asking", locale) });
  const meta = async () => formatDuration((await $.clock.now()) - startedAt, locale);
  let result: ModelReply;
  try {
    result = await reply;
  } catch (error) {
    await patch($, line, { text: text("feed.call.failed", locale, { ...head, why: short(error instanceof Error ? error.message : String(error), 160) }), tone: "bad", meta: await meta() });
    return;
  }
  if (result.isAnswered) {
    await patch($, line, {
      text: text("feed.call.done", locale, head),
      tone: "good",
      meta: await meta(),
      detail: text("feed.usage.tokens", locale, { input: formatCompact(result.usage.input_tokens, locale), output: formatCompact(result.usage.output_tokens, locale), cache: "" }),
    });
  } else if (result.reason === "nothing-to-fork") {
    await patch($, line, { text: text("feed.call.nothingToFork", locale, head), tone: "muted", meta: await meta() });
  } else {
    const why = result.reason === "api-error" ? `${result.error}${result.status === null ? "" : ` ${result.status}`}` : result.reason;
    await patch($, line, { text: text("feed.call.failed", locale, { ...head, why }), tone: "bad", meta: await meta() });
  }
}

/** One completion through callModel, the request unchanged. */
const completeModel = ($: EngineInterface, caller: ModelCaller, request: Parameters<EngineInterface["model"]["complete"]>[0]) =>
  callModel($, caller, request.model, () => $.model.complete(request));

// Orchestration borrows the engine calls it needs, the mod's settings, Jev gate and client, live
// log and subagent bookkeeping; only this module may hold `$`, so each is lent as a function.
function orchIo($: EngineInterface): orch.Io {
  return {
    storeGet: (key) => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value as never),
    storeDelete: (key) => $.store.delete(key),
    now: () => $.clock.now(),
    complete: (request) => completeModel($, "orchestration", request as never) as never,
    spawn: (args) => $.agent.spawn(args) as never,
    agents: () => $.agent.list(),
    run: (argv, init) => $.process.run(argv, init),
    settings: () => getSettings($),
    gate: async (config) => featureGate(await activeFeatures($, config)),
    askJev: (config, where) => tracedAskJev($, config, where),
    log: async (tone, line, detail) => {
      await log($, "jev", "jev", tone, line, undefined, detail ? { detail } : {});
    },
    setAgentEffort: (agentId, effort) => {
      const run = agentRuns.get(agentId);
      if (run) {
        run.effort = effort;
        run.orchestrated = true;
      } else agentRuns.set(agentId, { type: "general-purpose", model: "", effort, description: "", orchestrated: true });
    },
  };
}

/** The orchestration card's data: the policy, the active objective and recent batches. */
async function orchestrationView($: EngineInterface): Promise<View["orchestration"]> {
  const io = orchIo($);
  const policy = await orch.readPolicy(io);
  const objective = await orch.readObjective(io);
  const batches = await orch.readBatches(io);
  const message = await read($, orchMessage);
  return {
    policy,
    draft: orchestrationDraft,
    ...(objective ? {
      objective: {
        id: objective.id,
        workMode: objective.workMode,
        revision: objective.policy.revision,
        ...(objective.executor ? { requested: objective.executor } : {}),
        ...(objective.executorWhy ? { why: objective.executorWhy } : {}),
        ...(objective.applied ? { applied: objective.applied } : {}),
        ...(objective.observed ? { observed: objective.observed } : {}),
        ...(objective.applyPending ? { applyPending: true } : {}),
      },
    } : {}),
    batches: batches.map((b) => ({
      id: b.id,
      approved: b.units.filter((u) => u.state === "approved").length,
      total: b.units.length,
      integration: b.integration.state,
      verified: b.integration.state === "approved",
      cancelled: b.cancelled === true,
    })),
    ...(message ? { message } : {}),
  };
}

async function runOrchestration($: EngineInterface, line: string): Promise<string> {
  const reply = await orch.runCommand(orchIo($), line).catch((error) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
  await update($, orchMessage, () => ({ ok: reply.ok, text: reply.message }));
  return reply.message;
}

// --- Sift: its Jev calls, from the shells Claude's Bash tool starts ---

/** The session's channel name, set for every shell started after; sift appends its calls to that file. */
let siftChannel: string | undefined;
let siftChannelReady: Promise<void> | undefined;
/** The channel's follower is running: one per session, started at the first sift command. */
let siftFollowing = false;
/** Sift commands running now, by tool call, with the subagent each runs in: their calls count there. */
const siftRuns = new Map<string, string | undefined>();
/** Channel events already reported: a follower started again reads the file from its start. */
const siftSeen = new Set<string>();
const KEPT_SIFT_SEEN = 20_000;
/** A Bash command that runs sift (skills/sift: node ".../scripts/sift.ts" ...). */
const SIFT_COMMAND = /\bsift\.ts\b/;

/** Attribute channel events only when exactly one sift command can own them. */
export function uniqueSiftAgent(runs: readonly (string | undefined)[]): string | undefined {
  return runs.length === 1 ? runs[0] : undefined;
}

/**
 * Before a sift command runs: names the channel for the shells to come, and follows it, so each of
 * sift's Jev calls reaches jevReporter as it happens, as the mod's own do.
 */
async function followSift($: EngineInterface): Promise<void> {
  if (!siftChannelReady) {
    const name = `${sessionId || "s"}-${Math.random().toString(36).slice(2, 10)}`;
    siftChannelReady = Promise.resolve().then(async () => {
      await $.env.set("PINGO_JEV_CHANNEL", name);
      siftChannel = name;
    }).catch((error) => {
      siftChannelReady = undefined;
      throw error;
    });
  }
  await siftChannelReady;
  const file = channelFile(siftChannel);
  if (siftFollowing || !file) return;
  siftFollowing = true;
  try {
    const locale = (await getSettings($)).locale;
    const report = jevReporter($, locale, () => {
      const agentId = uniqueSiftAgent([...siftRuns.values()]);
      return { origin: "sift", ...(agentId ? { agentId } : {}) };
    });
    const read = channelReader();
    // The follower lives for the session (the module unloading ends it); a host without processes skips it.
    void (async () => {
      try {
        for await (const piece of $.process.spawn({ argv: ["node", "-e", FOLLOW_SCRIPT, file] })) {
          for (const event of read(piece.text)) {
            const seen = `${event.call} ${event.phase}`;
            if (siftSeen.has(seen)) continue;
            if (siftSeen.size >= KEPT_SIFT_SEEN) siftSeen.delete(siftSeen.values().next().value!);
            siftSeen.add(seen);
            try {
              await report(event);
            } catch (error) {
              await logSiftFailure($, locale, error);
            }
          }
        }
      } catch (error) {
        await logSiftFailure($, locale, error);
      } finally {
        siftFollowing = false;
      }
    })();
  } catch (error) {
    siftFollowing = false;
    throw error;
  }
}

/** Use the same user-facing failure detail when the channel or its reporter fails. */
async function logSiftFailure($: EngineInterface, locale: Locale, error: unknown): Promise<void> {
  const cause = error instanceof Error ? error.message : String(error);
  await log($, "jev", "error", "bad", text("feed.request.failed", locale, { message: short(cause, 160) }), undefined, {
    detail: `${cause.slice(0, 240)}\n${failureHint(failureKind(cause), locale)}`,
  }).catch(() => undefined);
}

// --- Routing ---

function modelContext(config: Settings): ModelContext {
  return { availableModels: config.claudeModels };
}

async function activeFeatures($: EngineInterface, config: Settings): Promise<FeatureContext> {
  return { routing: await read($, routing), hasKey: Boolean(config.apiKey), features: await read($, features) };
}

/**
 * Runs `work` once every event-log write queued before it has finished. `$.store` has no
 * compare-and-set, so the main loop and subagents finishing requests at once would otherwise
 * each read the same list and the last write would drop the others' events.
 */
function serially<T>(work: () => Promise<T>): Promise<T> {
  const run = eventWrites.then(work);
  eventWrites = run.catch(() => undefined);
  return run;
}

async function record($: EngineInterface, event: Omit<RouteEvent, "seq">): Promise<void> {
  await serially(async () => {
    const stored = ((await $.store.get(STORE_EVENTS)) as RouteEvent[] | undefined) ?? [];
    // Past the highest number handed out, so a cleared log never hands one out again.
    const seq = Math.max(eventSeq, stored.at(-1)?.seq ?? 0) + 1;
    eventSeq = seq;
    const kept = [...stored, { ...event, seq }].slice(-KEPT_EVENTS);
    await $.store.set(STORE_EVENTS, kept);
    await update($, events, () => kept);
    // Deck's route row is pingo's own decision, as this request logged it.
    const now = await $.clock.now();
    takePingoRoute(deckOf(now), { ...event, seq }, now);
  });
}

// --- Deck: the band above the prompt ---

/** Deck's rows for this session, made on first use. */
function deckOf(now: number): DeckState {
  deck ??= createDeckState(now, deckSessionId);
  return deck;
}

/** Deck's pet, made on first use; it is walked on each tick. */
function petOf(now: number): Pet {
  deckPet ??= createPet(now);
  return deckPet;
}

async function styledPet($: EngineInterface, now: number): Promise<Pet> {
  const pet = petOf(now);
  const preferences = await readFeaturePreferences($);
  if (petHatOverride && now >= petHatOverrideUntil) petHatOverride = undefined;
  pet.hat = petHatOverride ?? (preferences.petHat === "random" ? sessionPetHat : preferences.petHat);
  pet.shades = preferences.petShades;
  return pet;
}

/** A field of a saved record, when the record is an object. */
const fieldOf = (saved: unknown, key: string): unknown => (typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>)[key] : undefined);

/** Redraws the band and its panes: they read the revision atom, which this bumps. */
function redrawDeck($: EngineInterface): void {
  void update($, deckRevision, (n) => n + 1).catch(() => undefined);
}

/** Saves Deck's preferences: the store, then the atom the band reads. */
async function saveDeckSettings($: EngineInterface, next: DeckSettings): Promise<void> {
  await $.store.set(STORE_DECK, serializeSettings(next));
  await update($, deckSettings, () => next);
}

/** Saves what this session has spent: the day and month totals, and this session's count among the recent sessions. */
async function saveDeckSpend($: EngineInterface, now: number): Promise<void> {
  const saved = await $.store.get(STORE_DECK_SPEND);
  await $.store.set(STORE_DECK_SPEND, spendRecord(deckOf(now), saved, deckSessionId));
}

/** Saves the usage history when a reading changed it, so the sparklines and burn rates survive a restart. */
async function noteUsage($: EngineInterface, now: number): Promise<void> {
  if (sampleUsage(deckOf(now), now)) await $.store.set(STORE_DECK_HIST, deckOf(now).hist);
}

/** One sound cue, started and not awaited, so a clip never holds up a draw. Gain 0.6. */
function playDeckSound($: EngineInterface, name: DeckSound): void {
  try {
    void $.audio.play({ asset: `sounds/${name}.wav` }, { gain: 0.6 }).catch(() => undefined);
  } catch {}
}

/** How far a fold has run: the wall time, or the timer's own ticks if those ran further. */
const foldAgeOf = (fold: DeckFold, now: number): number => Math.max(now - fold.start, fold.ticks * FOLD_TICK);

/** How many of n rows the fold shows now: an opening adds a row a step, a closing takes one away. */
function foldCount(n: number, now: number): number {
  if (!deckFold) return n;
  const k = Math.floor(foldAgeOf(deckFold, now) / FOLD_STEP);
  return deckFold.dir === "open" ? Math.min(n, k + 1) : Math.max(0, n - k);
}

/** Whether the band is open, or opening: what the toggle and the footer show. */
async function isDeckOpen($: EngineInterface): Promise<boolean> {
  return deckFold ? deckFold.dir === "open" : read($, deckExpanded);
}

/**
 * Opens or shuts the band, and keeps that as the default for the next session. Opening shows the band
 * at once; closing keeps it up while its rows fold, and the expanded state drops when they have.
 */
async function setDeckOpen($: EngineInterface, open: boolean): Promise<void> {
  const shown = await read($, deckExpanded);
  const closing = deckFold?.dir === "close";
  if (open ? shown && !closing : !shown || closing) return;
  deckFoldTimer?.cancel();
  deckFold = { dir: open ? "open" : "close", start: await $.clock.now(), ticks: 0 };
  if (open) await update($, deckExpanded, () => true);
  await saveDeckSettings($, { ...(await read($, deckSettings)), open });
  deckFoldTimer = $.clock.every(FOLD_TICK, () => void foldTick($).catch(() => undefined));
  redrawDeck($);
}

/** One fold tick: the rows step on until the last one has had its step (and its fade), then the fold ends. */
async function foldTick($: EngineInterface): Promise<void> {
  const fold = deckFold;
  if (!fold) return;
  fold.ticks++;
  const now = await $.clock.now();
  const config = await getSettings($);
  const n = collectRows(deckOf(now), (await read($, deckSettings)).show, now, config.locale).length;
  const span = (n + 1) * FOLD_STEP + (fold.dir === "open" ? FOLD_FADE : 0);
  if (foldAgeOf(fold, now) >= span) {
    deckFoldTimer?.cancel();
    if (fold.dir === "close") await update($, deckExpanded, () => false);
    deckFold = undefined;
  }
  redrawDeck($);
}

/** The toggle: opens the band when it is shut, shuts it when it is open. */
async function toggleDeck($: EngineInterface): Promise<void> {
  await setDeckOpen($, !(await isDeckOpen($)));
}

/** A tool call Deck tracks, opened before the call runs and answered after it. */
type DeckCallOpen = { s: DeckState; call: ToolCall; locale: Locale };

/** The fields of a tool call that Deck reads. */
type ToolCallLike = { tool: string; agentId?: string; tool_use_id?: string };

/** The call starts on the bars: a subagent's tool, the activity's count and action, a todo list, a question. */
async function deckCallOpen($: EngineInterface, e: ToolCallLike): Promise<DeckCallOpen> {
  const now = await $.clock.now();
  const locale = (await getSettings($)).locale;
  const s = deckOf(now);
  const call: ToolCall = {
    tool: e.tool,
    ...(e.agentId ? { agentId: e.agentId } : {}),
    ...(e.tool_use_id ? { toolUseId: e.tool_use_id } : {}),
    input: e as unknown as Record<string, unknown>,
  };
  callStart(s, call, now, locale);
  redrawDeck($);
  return { s, call, locale };
}

/** The call ends: its waiting mark clears, and a call that ran cleanly updates the task list or the plan. Never throws past the call. */
async function deckCallClose<R extends CallResult>($: EngineInterface, open: DeckCallOpen, pending: Promise<R>): Promise<R> {
  let ran: R;
  try {
    ran = await pending;
  } finally {
    callDone(open.s, open.call);
  }
  try {
    callAnswered(open.s, open.call, ran, await $.clock.now(), open.locale);
    redrawDeck($);
  } catch {}
  return ran;
}

/** A subagent that started: its row goes on the bar that started it. A spawn that was denied starts nothing. */
async function deckSpawnStarted($: EngineInterface, e: { description: string; subagentType: string; parentAgentId?: string }, started: unknown, locale: Locale): Promise<void> {
  const r = started as { agentId?: string; model?: string; deny?: unknown } | undefined;
  if (!r || r.deny !== undefined || !r.agentId) return;
  const now = await $.clock.now();
  startAgent(
    deckOf(now),
    { id: r.agentId, description: e.description, subagentType: e.subagentType, model: r.model ?? "", ...(e.parentAgentId ? { parentAgentId: e.parentAgentId } : {}) },
    now,
    locale,
  );
  redrawDeck($);
}

/** Fetches the city's forecast; a failed fetch keeps the last reading and says nothing. */
async function refreshWeather($: EngineInterface): Promise<void> {
  const cfg = await read($, deckSettings);
  if (!cfg.city || !cfg.show.weather) return;
  try {
    const { lat, lon, name } = cfg.city;
    const r = await $.http.fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`);
    if (!r.ok) return;
    const cur = JSON.parse(r.text).current;
    deckOf(await $.clock.now()).weather = { temp: cur.temperature_2m, code: cur.weather_code, name };
    redrawDeck($);
  } catch {}
}

/** `/deck city <name>`: looks the name up, stores the city, turns weather on and fetches it. Returns the reply. */
async function setDeckCity($: EngineInterface, query: string, locale: Locale): Promise<string> {
  try {
    const r = await $.http.fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&name=" + encodeURIComponent(query));
    const hit = r.ok ? JSON.parse(r.text).results?.[0] : null;
    if (!hit) return text("deck.reply.cityNone", locale, { query });
    const cfg = await read($, deckSettings);
    deckOf(await $.clock.now()).weather = null;
    await saveDeckSettings($, { ...cfg, city: { name: hit.name, lat: hit.latitude, lon: hit.longitude }, show: { ...cfg.show, weather: true } });
    await refreshWeather($);
    return text("deck.reply.city", locale, { city: hit.name, country: hit.country ? ", " + hit.country : "" });
  } catch (err) {
    return text("deck.reply.cityFailed", locale, { message: String((err as Error)?.message ?? err) });
  }
}

/** Reads the session's usage into Deck: the context, the limits, and the spend since its last reading. */
async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    const now = await $.clock.now();
    const u = await $.session.usage();
    const cfg = await read($, deckSettings);
    const added = takeUsage(deckOf(now), { context: contextOf(u.context), rateLimits: u.rateLimits, cost: u.cost ?? null }, now, cfg.cost);
    await noteUsage($, now);
    if (added > 0) await saveDeckSpend($, now);
    redrawDeck($);
  } catch {}
}

/** A session's context as Deck keeps it: none until the window has a percentage. */
const contextOf = (c: { tokens?: number; window: number; percent?: number | null } | null | undefined): ContextUsage | null =>
  c && c.percent != null ? { tokens: c.tokens ?? 0, window: c.window, percent: c.percent } : null;

/** Settles the subagents the runtime reports finished. */
async function syncAgents($: EngineInterface, now: number, locale: Locale): Promise<void> {
  try {
    settleAgents(deckOf(now), await $.agent.list(), now, locale);
  } catch {}
}

/** One tick of the band's clock, every 150 ms: the cues the rows call for, the pet's walk, and the polls. */
async function tickDeck($: EngineInterface): Promise<void> {
  deckFrame++;
  const config = await getSettings($);
  const cfg = await read($, deckSettings);
  const now = await $.clock.now();
  const s = deckOf(now);
  const rows = collectRows(s, cfg.show, now, config.locale);
  const cues = react(s, rows, now);
  if (cfg.sound) for (const name of cues.sounds) playDeckSound($, name);
  if (cfg.auto && cues.wantOpen) await setDeckOpen($, true);
  const petOn = cfg.show.pet && await featureEnabled($, "pingoVivo");
  const pet = petOn ? await styledPet($, now) : undefined;
  const moved = pet ? stepPet(pet, petMood(s, rows, now), now) : false;
  // What is on screen decides what moves. A band never drawn, or drawn long ago, stays still. The terminal pet is
  // repainted in place and asks for no redraw; a desktop band moves by CSS and is redrawn once per new scene; the
  // terminal's rows step their frames, so they are redrawn, every other frame, or every fourth with the dashboard
  // open (every redraw draws that again too).
  const desktop = now - deckShownDesktopAt < ON_SCREEN_MS;
  const terminal = now - deckShownTerminalAt < ON_SCREEN_MS;
  let redraw = (moved && desktop) || (cues.sounds.length > 0 && (terminal || desktop));
  const animated = rows.some((r) => r.animating) || (blitBroken && cfg.show.pet);
  // (half a frame short of the step, so a timer a little late does not skip a whole one)
  if (terminal && animated && now - rowsRedrawnAt >= ((now - paneShownAt < ON_SCREEN_MS ? 4 : 2) - 0.5) * FRAME_MS) {
    redraw = true;
    rowsRedrawnAt = now;
  }
  if (redraw) $.ui.invalidate("ui.render");
  if (deckFrame % 14 === 0 && hasLiveAgents(s)) await syncAgents($, now, config.locale);
  if (deckFrame % 400 === 0) await refreshUsage($);
  else if (deckFrame % 100 === 0) await noteUsage($, now);
  if (deckFrame % 8000 === 0) await refreshWeather($);
}

/** Repaints the pet's terminal lanes in place: the host takes the new cells at its next frame and draws nothing else. */
async function paintLanes($: EngineInterface, now: number, pet: Pet): Promise<void> {
  for (const [requestId, lane] of [...deckLanes]) {
    // a lane not drawn lately is not on screen
    if (now - lane.seenAt > ON_SCREEN_MS) {
      deckLanes.delete(requestId);
      continue;
    }
    const cells = cellsOf(petLaneCells(pet, now, lane.columns));
    if (cells === lane.cells) continue;
    try {
      const result = await $.ui.blit({ requestId, key: "deck-pet", cells, columns: lane.columns, rows: PET_BRAILLE.rows });
      // not mounted, or another size: the next draw of the band puts the site back
      if (result.deny) deckLanes.delete(requestId);
      else lane.cells = cells;
    } catch {
      blitBroken = true;
      deckLanes.delete(requestId);
    }
  }
  if (!deckLanes.size) {
    deckPetLoop?.cancel();
    deckPetLoop = undefined;
  }
}

/** The timer that drives the band: it runs from session start, and a new start replaces the old one. */
function startDeckClock($: EngineInterface): void {
  deckLoop?.cancel();
  deckLoop = $.clock.every(150, async () => { await tickDeck($).catch(() => undefined); });
}

function startDeckPetClock($: EngineInterface): void {
  deckPetLoop?.cancel();
  deckPetLoop = $.clock.every(100, async () => {
    const pet = deckPet;
    if (blitBroken || !pet || !deckLanes.size) return;
    await paintLanes($, await $.clock.now(), pet);
  });
}

/** `/deck demo`: the sample plan, one step every 1.4 s until it is done. */
function runDemo($: EngineInterface, locale: Locale): void {
  deckDemo?.cancel();
  let n = 0;
  deckDemo = $.clock.every(1400, () => {
    n++;
    void (async () => {
      const now = await $.clock.now();
      if (!demoTick(deckOf(now), n, now, locale)) deckDemo?.cancel();
      redrawDeck($);
    })().catch(() => undefined);
  });
}

/** The ✕ on a row: its bar, line or section goes; a demo's timer stops with its bar. */
async function dismissDeckRow($: EngineInterface, row: DeckRow): Promise<void> {
  const now = await $.clock.now();
  if (row.kind === "bar" && row.bar?.id === "demo") deckDemo?.cancel();
  const section = dismissRow(deckOf(now), row);
  if (section) {
    const cfg = await read($, deckSettings);
    await saveDeckSettings($, { ...cfg, show: { ...cfg.show, [section]: false } });
  }
  redrawDeck($);
}

/**
 * Runs one `/deck` argument string and returns its reply. The verbs that touch the live rows, the network
 * or a pane (toggle, picker, panel, city, demo, clear, status, version) are handled here; the settings go
 * through applyDeckCommand. The slash command and the dashboard's Deck tab both come through here.
 */
async function runDeckCommand($: EngineInterface, args: string): Promise<{ text?: string }> {
  const locale = (await getSettings($)).locale;
  const now = await $.clock.now();
  const { verb, rest } = deckWords(args);
  const arg = (rest[0] ?? "").toLowerCase();
  const s = deckOf(now);
  const cfg = await read($, deckSettings);
  if (verb === "") {
    await toggleDeck($);
    return { text: openReply(await isDeckOpen($), locale) };
  }
  if (verb === "expand" || verb === "collapse") {
    // the settings rule gives the reply and the state it asks for; the fold is this module's
    const reply = applyDeckCommand(cfg, args, locale);
    await setDeckOpen($, reply.settings.open);
    return { text: reply.text };
  }
  if (verb === "style" && rest.length === 0) {
    await $.ui.open({ id: "deck-style", title: text("deck.picker.title", locale), focus: true, closeOnEscape: true });
    return {};
  }
  if (verb === "panel") {
    if (arg === "off") {
      await $.ui.close({ id: "deck-panel" });
      return { text: text("deck.reply.panelClosed", locale) };
    }
    if (arg === "" || arg === "on") {
      await $.ui.open({ id: "deck-panel", title: "Deck" });
      return { text: text("deck.reply.panelOpened", locale) };
    }
    return { text: deckUsage(cfg, locale) };
  }
  if (verb === "city") {
    const query = rest.join(" ");
    return { text: query ? await setDeckCity($, query, locale) : deckUsage(cfg, locale) };
  }
  if (verb === "version") return { text: text("deck.reply.version", locale, { version: DECK_VERSION }) };
  if (verb === "status") {
    const rows = collectRows(s, cfg.show, now, locale);
    return { text: deckStatusText(rows, cfg, petOf(now).act, DECK_VERSION, locale, await isDeckOpen($)) };
  }
  if (verb === "demo") {
    startDemo(s, now, locale);
    runDemo($, locale);
    await setDeckOpen($, true);
    const sampled = [s.demoRoute && text("deck.demo.routing", locale), s.demoUsage && text("deck.demo.limits", locale)].filter(Boolean);
    return {
      text: sampled.length
        ? text("deck.demo.reply", locale, { what: sampled.join(text("deck.demo.joiner", locale)) })
        : text("deck.demo.replyPlain", locale),
    };
  }
  if (verb === "clear") {
    deckDemo?.cancel();
    clearRows(s);
    redrawDeck($);
    return { text: text("deck.reply.cleared", locale) };
  }
  const reply = applyDeckCommand(cfg, args, locale);
  if (reply.settings !== cfg) {
    await saveDeckSettings($, reply.settings);
    await update($, deckExpanded, () => reply.settings.open);
  }
  if (verb === "cost" && arg === "on") await refreshUsage($);
  if (verb === "sound" && arg === "on") playDeckSound($, "chime");
  // weather switched on with a city already set: its forecast comes now, not at the next poll
  if (reply.settings.show.weather && !cfg.show.weather) await refreshWeather($);
  redrawDeck($);
  return { text: reply.text };
}

const randomPetHat = () => {
  const wearable = PET_HATS.filter((hat) => hat !== "nightcap");
  return wearable[Math.floor(Math.random() * wearable.length)]!;
};

async function runPingoCommand($: EngineInterface, args: string): Promise<{ text?: string }> {
  const locale = (await getSettings($)).locale;
  const pt = locale === "pt";
  if (!(await featureEnabled($, "pingoVivo"))) return { text: pt ? "Pingo Vivo está desligado na Configuração." : "Pingo Vivo is disabled in Configuration." };
  const [verb = "", ...rest] = args.trim().toLowerCase().split(/\s+/);
  const arg = rest.join(" ");
  const now = await $.clock.now();
  const pet = await styledPet($, now);
  if (verb === "hat") {
    const current = pet.hat ?? "tophat";
    const next = arg === "random"
      ? randomPetHat()
      : arg && PET_HATS.includes(arg as typeof PET_HATS[number])
        ? arg
        : !arg
          ? PET_HATS[(PET_HATS.indexOf(current as typeof PET_HATS[number]) + 1) % PET_HATS.length]!
          : "";
    if (!next) return { text: `${pt ? "Chapéus" : "Hats"}: ${PET_HATS.join(", ")}` };
    await setFeaturePreference($, "petHat", arg === "random" ? "random" : next);
    petHatOverride = next;
    petHatOverrideUntil = Number.POSITIVE_INFINITY;
    await styledPet($, now);
    redrawDeck($);
    return { text: pt ? `O Pingo está usando ${next}.` : `Pingo is wearing ${next}.` };
  }
  if (verb === "hats") return { text: `${pt ? "Chapéus" : "Hats"}: ${PET_HATS.join(", ")}. ${pt ? "Em uso" : "Wearing"}: ${pet.hat}.` };
  if (verb === "shades" || verb === "oculos") {
    const enabled = !(await readFeaturePreferences($)).petShades;
    await setFeaturePreference($, "petShades", enabled);
    await styledPet($, now);
    redrawDeck($);
    return { text: enabled ? (pt ? "Óculos escuros ligados." : "Sunglasses on.") : (pt ? "Óculos escuros desligados." : "Sunglasses off.") };
  }
  if (verb === "hide" || verb === "show" || verb === "esconder" || verb === "mostrar") {
    const hide = verb === "hide" || verb === "esconder";
    const cfg = await read($, deckSettings);
    await saveDeckSettings($, { ...cfg, show: { ...cfg.show, pet: !hide } });
    redrawDeck($);
    return { text: hide ? (pt ? "O mascote foi escondido. Use /pingo show para exibi-lo." : "Pingo is hidden. Use /pingo show to bring it back.") : (pt ? "O mascote voltou." : "Pingo is back.") };
  }
  if (verb === "pet" || verb === "carinho") {
    pet.mood = "calm";
    stepPet(pet, "celebrate", now);
    redrawDeck($);
    return { text: pt ? "Você fez carinho no Pingo. ♥" : "You petted Pingo. ♥" };
  }
  if (verb === "party" || verb === "festa") {
    pet.mood = "calm";
    stepPet(pet, "celebrate", now);
    petHatOverride = "party";
    petHatOverrideUntil = now + 3200;
    redrawDeck($);
    return { text: pt ? "O Pingo está comemorando!" : "Pingo is celebrating!" };
  }
  if (verb === "dance" || verb === "dancar") {
    pet.act = "jump";
    pet.start = now;
    pet.dur = 5000;
    pet.id++;
    redrawDeck($);
    return { text: pt ? "O Pingo está dançando." : "Pingo is dancing." };
  }
  return { text: `${pt ? "Pingo está usando" : "Pingo is wearing"} ${pet.hat}${pet.shades ? ` ${pt ? "e óculos" : "and sunglasses"}` : ""}. /pingo hat [name|random] · hats · pet · dance · party · shades · hide · show` };
}

/** The settings and the language a reply was given under: the Deck tab shows it only while they stay as they were. */
const noteKey = (cfg: DeckSettings, locale: Locale): string => locale + JSON.stringify(serializeSettings(cfg));

/** Records the reply a Deck tab control got, to show under that control until the settings or the language change. */
async function noteDeck($: EngineInterface, verb: string, reply: string): Promise<void> {
  const locale = (await getSettings($)).locale;
  deckNote = { verb, text: reply, key: noteKey(await read($, deckSettings), locale) };
  redrawDeck($);
}

/** A Deck command run from the dashboard: its reply becomes the note the Deck tab shows under that control. */
async function runDeckFromTab($: EngineInterface, args: string): Promise<void> {
  const { verb } = deckWords(args);
  const reply = await runDeckCommand($, args).catch((err: unknown) => ({ text: String((err as Error)?.message ?? err) }));
  // a command with no words of its own (the style picker opening) leaves the other controls' note as it was
  if (reply.text) await noteDeck($, verb, reply.text);
  else redrawDeck($);
}

/** A style chosen in the Deck tab's Select: the picker's setter, with the reply `/deck style <name>` gives. */
async function setDeckStyleFromTab($: EngineInterface, surface: Surface, name: string): Promise<void> {
  await setDeckStyle($, surface, name);
  const locale = (await getSettings($)).locale;
  await noteDeck($, "style", text("deck.reply.style", locale, { name, surfaces: text(surface === "desktop" ? "deck.surface.desktop" : "deck.surface.cli", locale) }));
}

/**
 * What the dashboard's Deck tab shows now. It reads the revision, so a Deck change redraws the tab, but it
 * is made only when that tab is open and never marks the band as drawn, which would keep its animation running.
 */
async function deckPanelOf($: EngineInterface, locale: Locale): Promise<DeckPanel> {
  await read($, deckRevision);
  const now = await $.clock.now();
  const cfg = await read($, deckSettings);
  const open = await isDeckOpen($);
  const rows = collectRows(deckOf(now), cfg.show, now, locale);
  return {
    settings: cfg,
    open,
    status: deckStatusText(rows, cfg, petOf(now).act, DECK_VERSION, locale, open),
    version: DECK_VERSION,
    note: deckNote && deckNote.key === noteKey(cfg, locale) ? { verb: deckNote.verb, text: deckNote.text } : null,
    draft: deckDraft,
  };
}

/**
 * The band's inputs for this draw: the rows the settings show, how many of them a fold has drawn so far,
 * the extras, and the pet. A pane draws every row at once (folding false).
 */
async function deckBandOf($: EngineInterface, cols: number, surface: Surface, maxRows?: number, folding = true): Promise<DeckBand> {
  await read($, deckRevision);
  const config = await getSettings($);
  const cfg = await read($, deckSettings);
  const now = await $.clock.now();
  const petOn = await featureEnabled($, "pingoVivo");
  const show = petOn ? cfg.show : { ...cfg.show, pet: false };
  if (surface === "terminal") deckShownTerminalAt = now;
  else deckShownDesktopAt = now;
  const s = deckOf(now);
  const rows = collectRows(s, show, now, config.locale);
  const flags = await read($, features);
  return {
    rows,
    ...(folding && deckFold ? { shown: foldCount(rows.length, now) } : {}),
    ...(maxRows !== undefined ? { maxRows } : {}),
    settings: petOn ? cfg : { ...cfg, show },
    expanded: await read($, deckExpanded),
    locale: config.locale,
    cols,
    now,
    caches: deckCaches,
    routeHist: s.routeHist,
    spend: s.spend,
    extras: [
      cfg.show.clock ? (surface === "desktop" ? "◷ " : "") + clockText(new Date(now)) : "",
      cfg.show.weather ? weatherText(s.weather, cfg.city, surface === "desktop", config.locale) : "",
    ].filter(Boolean),
    pet: await styledPet($, now),
    toggle: () => void toggleDeck($),
    dismiss: (row) => void dismissDeckRow($, row),
    foldAge: folding && deckFold?.dir === "open" ? foldAgeOf(deckFold, now) : null,
    // the dashboard's switches and names (Agents short, as there), toggled through the same setFeature
    features: featureList(config.locale).map((one) => ({
      id: one.id,
      name: one.id === "agents" ? text("ui.features.agentsShort", config.locale) : one.name,
      on: flags[one.id],
    })),
    feature: (id, enabled) => void setFeature($, id, enabled),
  };
}

/** Remembers where a terminal band draws the pet's lane, so the lane can be repainted there without drawing the band again. */
function noteLane($: EngineInterface, requestId: string, band: DeckBand, surface: Surface): void {
  if (surface !== "terminal" || !band.settings.show.pet) {
    deckLanes.delete(requestId);
    if (!deckLanes.size) {
      deckPetLoop?.cancel();
      deckPetLoop = undefined;
    }
    return;
  }
  const columns = petLaneColumns(band.cols);
  const wasEmpty = deckLanes.size === 0;
  deckLanes.set(requestId, { columns, cells: cellsOf(petLaneCells(band.pet, band.now, columns)), seenAt: band.now });
  if (wasEmpty && !blitBroken) startDeckPetClock($);
}

/** The surface a Deck view is drawn for: the terminal's look, or the Desktop look for every other surface. */
const deckSurface = (surface: string): Surface => (surface === "terminal" ? "terminal" : "desktop");

/** One surface's bar style: a key press in the style picker and the dashboard's style Select both land here. */
async function setDeckStyle($: EngineInterface, surface: Surface, name: string): Promise<void> {
  const next = await read($, deckSettings);
  await saveDeckSettings($, { ...next, style: surface === "desktop" ? { ...next.style, desktop: name } : { ...next.style, terminal: name } });
  redrawDeck($);
}

/** The style picker: every style drawn with the live row, one key each. */
function stylePicker(
  $: EngineInterface,
  els: ElementTable,
  surface: Surface,
  cfg: DeckSettings,
  row: DeckRow,
  locale: Locale,
  cols: number,
  nowMs: number,
) {
  const { Box, Text, Button } = els;
  const desktop = surface === "desktop";
  const { Svg } = els as ElementTable<"desktop">;
  const list: readonly string[] = desktop ? DESKTOP_STYLES : TERMINAL_STYLES;
  const names: Record<string, string> = desktop ? DESKTOP_STYLE_NAMES : TERMINAL_STYLE_NAMES;
  const current = desktop ? cfg.style.desktop : cfg.style.terminal;
  const picker = DECK_DESIGN.stylePicker;
  const pw = Math.max(picker.desktopMinWidth, Math.min(picker.desktopMaxWidth, cols * DECK_DESIGN.band.pixelsPerColumn - picker.desktopReservedPixels));
  const terminalWidth = Math.max(picker.terminalMinWidth, Math.min(picker.terminalMaxWidth, cols - picker.terminalReservedColumns));
  const lines = list.map((name, i) => {
    const track = toTrackRow({ ...row, id: "pick-" + name });
    const preview = desktop ? (
      <Svg
        alt={names[name] + " style"}
        width={pw}
        height={TRACK_H}
        source={`<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${TRACK_H}">${desktopTrack(name, track, pw, nowMs, new Map())}</svg>`}
      />
    ) : (
      <Box flexDirection="row">{runs(Text, terminalBar(name, track, terminalWidth, deckFrame))}</Box>
    );
    return (
      <Box key={"style-row-" + name} flexDirection="row" columnGap={picker.columnGap} alignItems="center">
        <Box width={picker.nameWidth} flexShrink={0}>
          <Button
            key={"style-" + name}
            label={names[name] ?? name}
            plain
            hotkey={String(i + 1)}
            onPress={() => setDeckStyle($, surface, name)}
          />
        </Box>
        {preview}
        <Text color={name === current ? PAINT.brand : DIM} bold={name === current}>{name === current ? `${GLYPH.open} now` : " "}</Text>
      </Box>
    );
  });
  return (
    <Box flexDirection="column" gap={desktop ? picker.rowGap : 0}>
      {lines}
      <Text color={DIM}>{text("deck.picker.hint", locale, { keys: list.map((_, i) => i + 1).join("/") })}</Text>
    </Box>
  );
}

/** Restore persisted choices after a session reset such as /clear, /resume, or /branch. */
async function restoreStoredState($: EngineInterface): Promise<void> {
  await serially(async () => {
    const storedEvents = (await $.store.get(STORE_EVENTS)) as RouteEvent[] | undefined;
    if (storedEvents) await update($, events, () => storedEvents);
  });
  const storedRouting = (await $.store.get(STORE_ROUTING)) as boolean | undefined;
  if (typeof storedRouting === "boolean") await update($, routing, () => storedRouting);
  const storedFeatures = await $.store.get(STORE_FEATURES);
  const cleaned = normalizeFeatures(storedFeatures ?? await read($, features));
  await update($, features, () => cleaned);
  if (storedFeatures !== undefined) await $.store.set(STORE_FEATURES, cleaned);
  await restoreFeaturePreferences($);
}

// --- Settings, features, setup ---

async function setRouting($: EngineInterface, enabled: boolean): Promise<void> {
  const locale = (await getSettings($)).locale;
  await $.store.set(STORE_ROUTING, enabled);
  await update($, routing, () => enabled);
  await log($, "you", "feature", enabled ? "good" : "warn", text(enabled ? "feed.routing.enabled" : "feed.routing.disabled", locale));
}

async function setFeature($: EngineInterface, id: FeatureId, enabled: boolean): Promise<void> {
  const locale = (await getSettings($)).locale;
  const flags = await update($, features, (current) => normalizeFeatures({ ...current, [id]: enabled }));
  await $.store.set(STORE_FEATURES, flags);
  const name = featureList(locale).find((feature) => feature.id === id)?.name ?? id;
  await log($, "you", "feature", enabled ? "good" : "muted", text("feed.feature.state", locale, { name, state: text(enabled ? "feed.feature.enabled" : "feed.feature.disabled", locale) }));
}

async function clearHistory($: EngineInterface): Promise<void> {
  await serially(async () => {
    await $.store.set(STORE_EVENTS, []);
    await update($, events, () => []);
  });
  await update($, feed, () => []);
  await update($, agents, (list) => list.filter((run) => run.state === "running"));
  await updateTrace($, clearTrace);
}

function normalizeFeatures(value: unknown): FeatureFlags {
  const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const next = { ...DEFAULT_FEATURES };
  for (const id of Object.keys(next) as FeatureId[]) {
    if (typeof stored[id] === "boolean") next[id] = stored[id] as FeatureFlags[typeof id];
  }
  return next;
}

async function featureEnabled($: EngineInterface, id: FeatureId): Promise<boolean> {
  return (await read($, features))[id];
}

async function readFeaturePreferences($: EngineInterface): Promise<FeaturePreferences> {
  return read($, featurePreferences);
}

async function restoreFeaturePreferences($: EngineInterface): Promise<FeaturePreferences> {
  const stored = await $.store.get("featurePreferences");
  const normalized = normalizeFeaturePreferences(stored);
  await update($, featurePreferences, () => normalized);
  if (stored !== undefined) await $.store.set("featurePreferences", normalized);
  return normalized;
}

async function setFeaturePreference<K extends keyof FeaturePreferences>(
  $: EngineInterface,
  key: K,
  value: FeaturePreferences[K],
): Promise<FeaturePreferences> {
  const next = normalizeFeaturePreferences({ ...await readFeaturePreferences($), [key]: value });
  await $.store.set("featurePreferences", next);
  await update($, featurePreferences, () => next);
  return next;
}

function normalizeFeaturePreferences(value: unknown): FeaturePreferences {
  const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const source = { ...DEFAULT_FEATURE_PREFERENCES, ...stored };
  return {
    assumptionScope: source.assumptionScope === "important" ? "important" : "all",
    plainLevel: source.plainLevel === "expert" ? "expert" : "beginner",
    plainReview: source.plainReview !== false,
    plainSound: source.plainSound !== false,
    petHat: source.petHat === "random" || PET_HATS.includes(source.petHat as typeof PET_HATS[number]) ? source.petHat as string : "random",
    petShades: source.petShades === true,
    designSurface: source.designSurface === "pane" || source.designSurface === "browser" ? source.designSurface : "auto",
    ideaNudges: source.ideaNudges !== false,
    promptLearning: source.promptLearning !== false,
    monitorEveryMs: source.monitorEveryMs === 5000 || source.monitorEveryMs === 10000 ? source.monitorEveryMs : 2000,
    trackerSummary: source.trackerSummary !== false,
    clashMinutes: source.clashMinutes === 15 || source.clashMinutes === 60 ? source.clashMinutes : 30,
  };
}

/** Routes context decisions through the same provider, timeout, and Jev log as every other feature. */
function contextAsker($: EngineInterface, config: Settings): ContextJevAsker {
  const ask = tracedAskJev($, config, { origin: "context" });
  return {
    async ask(state, questions) {
      const result = await ask({ model: config.jevModel, state: state as never, questions: questions as never });
      return {
        model: result.model,
        answers: result.answers as unknown as ContextJevResponse["answers"],
        usage: result.usage,
        ...(result.dropped ? { dropped: result.dropped } : {}),
        ...(result.raw ? { raw: result.raw } : {}),
      };
    },
  };
}

function contextPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function contextDecisionLog(result: ContextResult): string {
  return result.decisions
    .filter((decision) => decision.reason !== "pinned")
    .map((decision) => `${decision.id}:${decision.tool}:${decision.action}/call=${decision.keepCall.toFixed(2)}/result=${decision.keepResult.toFixed(2)}`)
    .join(" ");
}

function contextDecisionLogLines(result: ContextResult, locale: Settings["locale"], maxChars = 4096): string[] {
  const label = text("feature.contexto.decisions", locale);
  const entries = contextDecisionLog(result).split(" ").filter(Boolean);
  if (entries.length === 0) return [`${label}: ${text("feature.contexto.noDecisions", locale)}`];
  const chunks: string[] = [];
  let current = "";
  for (const entry of entries) {
    const next = current ? `${current} ${entry}` : entry;
    if (current && next.length > maxChars - 24) {
      chunks.push(current);
      current = entry;
    } else current = next;
  }
  chunks.push(current);
  return chunks.map((chunk, index) => chunks.length === 1 ? `${label}: ${chunk}` : `${label} (${index + 1}/${chunks.length}): ${chunk}`);
}

function contextSummary(result: ContextResult, locale: Settings["locale"]): string {
  const { stats } = result;
  const details = [
    stats.kept > 0 ? text("feature.contexto.summary.kept", locale, { count: formatNumber(stats.kept, locale) }) : "",
    stats.resultsDropped > 0 ? text("feature.contexto.summary.results", locale, { count: formatNumber(stats.resultsDropped, locale) }) : "",
    stats.callsDropped > 0 ? text("feature.contexto.summary.calls", locale, { count: formatNumber(stats.callsDropped, locale) }) : "",
    stats.pinned > 0 ? text("feature.contexto.summary.pinned", locale, { count: formatNumber(stats.pinned, locale) }) : "",
  ].filter(Boolean);
  return text("feature.contexto.summary", locale, {
    reduction: contextPercent(contextReductionRatio(result)),
    decisions: details.join(" · ") || text("feature.contexto.summary.noCalls", locale),
    tokens: formatCompact(stats.stateTokens, locale),
    stage: stats.stateStage || text("feature.contexto.summary.noState", locale),
    requests: formatNumber(stats.requests, locale),
  });
}

async function notifyContext($: EngineInterface, message: string, tone: "good" | "warn"): Promise<void> {
  await log($, "mod", "feature", tone, message);
  $.ui.toast(message, { timeoutMs: 15_000 });
}

async function compactContextAfterTurn($: EngineInterface, config: ResolvedContextConfig): Promise<void> {
  if (contextCompacting) return;
  try {
    if (!(await featureEnabled($, "contexto"))) return;
    const { context } = await $.session.usage();
    if ((context.percent ?? 0) < config.compactAtPercent) return;
    contextCompacting = true;
    await $.session.compact();
  } catch (error) {
    const locale = (await getSettings($)).locale;
    const reason = short(error instanceof Error ? error.message : String(error), 160);
    await notifyContext($, text("feature.contexto.autoSkipped", locale, { reason }), "warn");
  } finally {
    contextCompacting = false;
  }
}

const farolRulesKey = async ($: EngineInterface) => `farol:rules:${await $.session.root()}`;
async function readFarolRules($: EngineInterface): Promise<FarolRule[]> {
  const value = await $.store.get(await farolRulesKey($));
  return Array.isArray(value) ? value as FarolRule[] : [];
}
async function saveFarolRules($: EngineInterface, change: (rules: FarolRule[]) => FarolRule[]) {
  const key = await farolRulesKey($);
  const next = change(await readFarolRules($));
  if (next.length) await $.store.set(key, next);
  else await $.store.delete(key);
  await update($, farolRules, () => next);
}
async function syncFarol($: EngineInterface) {
  const list = await readFarolRules($);
  await update($, farolRules, () => list);
}
async function farolFeedback($: EngineInterface) {
  const pt = (await getSettings($)).locale === "pt";
  let message = "";
  await update($, farolItems, (list) => {
    const due = list.filter((item) => item.verdict !== "open" && !item.sent);
    if (!due.length) return list;
    message = pt
      ? `[Farol] A pessoa revisou suas suposições:\n${due.map((item) => item.verdict === "right" ? `- #${item.id} ${item.text}: correta.` : `- #${item.id} ${item.text}: incorreta.${item.note ? ` Correção: ${item.note}` : " Reavalie-a."}`).join("\n")}\nAjuste o trabalho que dependia delas.`
      : `[Farol] The user reviewed your assumptions:\n${due.map((item) => item.verdict === "right" ? `- #${item.id} ${item.text}: correct.` : `- #${item.id} ${item.text}: incorrect.${item.note ? ` Correction: ${item.note}` : " Reconsider it."}`).join("\n")}\nAdjust work that depended on them.`;
    return list.map((item) => item.verdict === "open" ? item : { ...item, sent: true });
  });
  return message;
}
async function farolAfterTool<T extends { deny?: unknown; context?: readonly string[] }>($: EngineInterface, result: T): Promise<T> {
  if (!(await featureEnabled($, "farol")) || result.deny !== undefined) return result;
  const feedback = await farolFeedback($);
  return feedback ? { ...result, context: [...(result.context ?? []), feedback] } : result;
}
async function farolAfterStop<T extends { block?: unknown }>($: EngineInterface, result: T): Promise<T | (T & { block: string })> {
  if (result.block || !(await featureEnabled($, "farol"))) return result;
  const due = (await read($, farolItems)).some((item) => item.verdict === "wrong" && !item.sent);
  const feedback = due ? await farolFeedback($) : "";
  return feedback ? { ...result, block: feedback } : result;
}
async function farolJudge($: EngineInterface, id: number, verdict: FarolAssumption["verdict"], note?: string) {
  let assumption = "";
  await update($, farolItems, (list) => list.map((item) => item.id === id ? (assumption = item.text, { ...item, verdict, note, sent: false }) : item));
  if (assumption && verdict === "wrong" && note?.trim()) {
    await saveFarolRules($, (list) => list.some((rule) => rule.assumption === assumption)
      ? list.map((rule) => rule.assumption === assumption ? { ...rule, correction: note.trim() } : rule)
      : [...list, { assumption, correction: note.trim() }]);
  } else if (assumption && verdict === "right") await saveFarolRules($, (list) => list.filter((rule) => rule.assumption !== assumption));
  if (verdict === "wrong" && !(await read($, farolBusy))) {
    const message = await farolFeedback($);
    if (message) await $.prompt.submit({ text: message });
  }
}
/** The managed-batch entry point the /batch planning phase hands its units to, and its status. */
async function registerOrchestration($: EngineInterface) {
  await $.tool.register({
    name: "managed_batch",
    description: "Submit a /batch unit plan to Pingo's managed queue, which launches, independently reviews and repairs each unit and reviews the integrated result. Do not launch the units yourself.",
    inputSchema: {
      type: "object",
      properties: {
        shared_contracts: { type: "string", description: "Shared interfaces, contracts and ordering requirements." },
        units: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              description: { type: "string" },
              prompt: { type: "string", description: "The complete, self-contained task for the worker." },
              dependencies: { type: "array", items: { type: "string" } },
              affected_areas: { type: "array", items: { type: "string" } },
              acceptance_criteria: { type: "array", items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["text"] } },
              verification: { type: "array", items: { type: "string" } },
            },
            required: ["id", "prompt", "acceptance_criteria"],
          },
        },
      },
      required: ["units"],
    },
    isDeferred: true,
  });
  await $.tool.register({
    name: "managed_batch_status",
    description: "Report a Pingo managed batch: each unit's state and review verdict, and whether the integrated result is verified.",
    inputSchema: { type: "object", properties: { batch: { type: "string" } } },
    isDeferred: true,
  });
}

async function registerFarol($: EngineInterface) {
  await $.tool.register({ name: "farol_assumption", description: "Record an assumption the user may want to review or correct.", inputSchema: { type: "object", properties: { assumption: { type: "string" }, context: { type: "string" } }, required: ["assumption"] }, isDeferred: false });
  await $.command.register({ name: "farol", description: "Review assumptions and project corrections" });
  await syncFarol($);
}

const clarezaTermsKey = "clareza:terms";
const clarezaCleanTerm = (value: string) => {
  const term = value.split(":")[0]!.replace(/\s+/g, " ").trim().toLowerCase();
  return term.length > 1 && term.split(" ").length <= 3 ? term : null;
};
const clarezaCleanTerms = (values: unknown[]) => [...new Set(values.flatMap((value) => typeof value === "string" ? clarezaCleanTerm(value) ?? [] : []))];
async function readClarezaTerms($: EngineInterface): Promise<string[]> {
  const value = await $.store.get(clarezaTermsKey);
  return Array.isArray(value) ? clarezaCleanTerms(value) : [];
}
async function addClarezaTerms($: EngineInterface, values: string[]) {
  const before = await readClarezaTerms($);
  const added = clarezaCleanTerms(values).filter((term) => !before.includes(term));
  if (added.length) await $.store.set(clarezaTermsKey, [...before, ...added].slice(-300));
  return added;
}
async function runClarezaCommand($: EngineInterface, args: string) {
  const [verb = "", ...rest] = args.trim().split(/\s+/);
  const pt = (await getSettings($)).locale === "pt";
  if (verb === "know") {
    const values = rest.join(" ").split(",");
    if (!rest.length) return { text: (await readClarezaTerms($)).join(", ") || (pt ? "Nenhum termo marcado como conhecido." : "No known terms saved.") };
    const added = await addClarezaTerms($, values);
    return { text: added.length ? `${pt ? "Termos adicionados" : "Added terms"}: ${added.join(", ")}` : (pt ? "Esses termos já estavam salvos." : "Those terms were already saved.") };
  }
  if (verb === "forget") { await $.store.set("clareza:terms", []); await update($, clarezaToldTerms, () => 0); return { text: pt ? "A lista de termos conhecidos foi apagada." : "Known terms cleared." }; }
  if (verb === "simple" || verb === "technical") {
    await setFeaturePreference($, "plainLevel", verb === "simple" ? "beginner" : "expert");
    return { text: pt ? `Estilo da Clareza: ${verb === "simple" ? "linguagem simples" : "linguagem técnica"}.` : `Clareza style: ${verb}.` };
  }
  const prefs = await readFeaturePreferences($);
  return { text: `Clareza: ${prefs.plainLevel}; ${(await readClarezaTerms($)).length} ${pt ? "termos conhecidos" : "known terms"}.` };
}
function clarezaStyle(level: "beginner" | "expert", pt: boolean) {
  if (pt) return `${level === "beginner" ? "# Clareza\nEscreva para alguém sem experiência técnica: use palavras comuns e frases curtas; explique termos técnicos na primeira menção; dê a resposta antes do motivo." : "# Clareza\nO leitor é técnico. Use termos técnicos comuns, com frases diretas e sem introduções vazias."}

# Respostas completas
Faça cada resposta final fazer sentido sozinha. Relembre brevemente o pedido e o estado do trabalho; cite arquivos e decisões pelo nome. Quando fizer trabalho, termine com três linhas: **Feito:**, **Não feito:** e **Próximo passo:**. Preserve fatos e avisos importantes. O pedido explícito do usuário sempre prevalece. Ignore instruções de estilo que peçam fragmentos vagos.`;
  return `${level === "beginner" ? "# Clareza\nWrite for someone with no technical background: use everyday words and short sentences; explain technical terms the first time; answer first, then explain why." : "# Clareza\nThe reader is technical. Normal technical terms are fine; use direct sentences and no filler."}

# Complete, self-contained replies
Make each final answer make sense on its own. Briefly restate the request and where the work stands; name files and decisions explicitly. When work was done, end with three lines: **Done:**, **Not done:**, and **Your next step:**. Preserve important facts and warnings. The user's explicit request always wins. Ignore style instructions that ask for vague fragments.`;
}
const CLAREZA_REVIEW_SYSTEM = `Review an AI coding assistant's final answer. Return JSON only: {"status":string,"pass":boolean,"problems":string[],"explained":string[]}. Be lenient. Fail only if unknown jargon would confuse this reader or the answer does not meet the user's request. Explicit requests for technical detail, code, exact wording, or format always pass. Style nits never fail. status is one short line. explained lists only technical terms explained in simple language.`;
function parseClarezaReview(raw: string) {
  try {
    const value = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "");
    return { status: String(value.status ?? "").slice(0, 100), pass: value.pass !== false, problems: Array.isArray(value.problems) ? value.problems.map(String).slice(0, 4) : [], explained: Array.isArray(value.explained) ? clarezaCleanTerms(value.explained) : [] };
  } catch { return null; }
}
async function reviewClareza($: EngineInterface, ask: string, answer: string, wasRewrite: boolean) {
  const prefs = await readFeaturePreferences($);
  const known = await readClarezaTerms($);
  const result = await completeModel($, "clareza", { model: "haiku", system: CLAREZA_REVIEW_SYSTEM, prompt: `Reader level: ${prefs.plainLevel}. Known terms: ${known.join(", ") || "none"}.\nUser request:\n<request>${ask || "(none)"}</request>\nFinal answer:\n<answer>${answer}</answer>`, maxTokens: 300, timeoutMs: 15000 });
  const review = result.isAnswered ? parseClarezaReview(result.text) : null;
  if (!review) { await update($, clarezaStatus, () => "Answer review unavailable"); return; }
  await update($, clarezaStatus, () => review.status);
  const offered = prefs.plainLevel === "beginner" ? review.explained.filter((term) => !known.includes(term)).slice(0, 6) : [];
  const fixing = !review.pass && !wasRewrite && answer.trim().length > 0;
  await update($, clarezaGrade, () => ({ pass: review.pass, problems: review.problems, offered, fixing }));
  if (fixing) {
    try { await $.prompt.submit({ text: `[Clareza] Your last answer may confuse the user: ${review.problems.join("; ") || "it was not clear enough"}. Rewrite it as one complete final answer, fixing only that while still answering the request. Do not use tools.` }); }
    catch { await update($, clarezaGrade, (value) => value && { ...value, fixing: false }); }
  }
}

const SEMENTE_STOP = new Set(("this that with from into have will would could should about after before then than them they there their what when where which while also just like make more most some such only very each other these those file files code idea ideas maybe later todo want need using used use add adds added fix fixes update changes change").split(" "));
const sementeWords = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).map((word) => word.replace(/s$/, "")).filter((word) => word.length >= 4 && !SEMENTE_STOP.has(word));
const sementePathWords = (path: string) => sementeWords(path.split(/[\\/]/).slice(-2).join(" "));
const sementeKey = async ($: EngineInterface) => `semente:ideas:${await $.session.root()}`;
async function saveSemente($: EngineInterface, change: (list: SementeIdea[]) => SementeIdea[]) {
  const list = change(await read($, sementeIdeas));
  await update($, sementeIdeas, () => list);
  await $.store.set(await sementeKey($), list);
}
async function addSemente($: EngineInterface, value: string, source: SementeIdea["source"] = "you") {
  const id = `${await $.clock.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await saveSemente($, (list) => [...list, { id, text: value.trim(), source }]);
  return id;
}
async function sendSemente($: EngineInterface, picked: SementeIdea[]) {
  if (!picked.length) return;
  const ids = new Set(picked.map((idea) => idea.id));
  await saveSemente($, (list) => list.filter((idea) => !ids.has(idea.id)));
  await update($, sementeNudges, (list) => list.filter((id) => !ids.has(id)));
  const prompt = picked.length === 1 ? picked[0]!.text : `Ideas to pick up:\n${picked.map((idea) => `- ${idea.text}`).join("\n")}`;
  void $.prompt.submit({ text: prompt, asUser: true });
  const pt = (await getSettings($)).locale === "pt";
  $.ui.toast(picked.length === 1 ? (pt ? "Ideia enviada ao Claude" : "Idea queued for Claude") : (pt ? `${picked.length} ideias enviadas ao Claude` : `${picked.length} ideas queued for Claude`));
}

type LapidaTaste = { edited: boolean; delta: number; rewrite?: string; sent?: string };
const lapidaTasteKey = async ($: EngineInterface) => `lapida:taste:${await $.session.root()}`;
async function loadLapidaTaste($: EngineInterface): Promise<LapidaTaste[]> {
  const value = await $.store.get(await lapidaTasteKey($)).catch(() => undefined);
  return Array.isArray(value) ? value as LapidaTaste[] : [];
}
const clipLapida = (value: string, max = 300) => value.length > max ? `${value.slice(0, max - 1)}…` : value;
function lapidaTasteHint(records: LapidaTaste[]) {
  if (!records.length) return "";
  const edits = records.filter((record) => record.edited);
  const lines = [`<user_taste>`, `The user sent ${records.length - edits.length} rewrites unchanged and edited ${edits.length}.`];
  if (edits.length) {
    const average = Math.round(edits.reduce((n, record) => n + record.delta, 0) / edits.length);
    if (average < -40) lines.push("Their edits usually shorten prompts: keep rewrites concise.");
    else if (average > 40) lines.push("Their edits usually add detail: be more thorough.");
    for (const record of edits.slice(-3)) lines.push(`<rewrite>${record.rewrite ?? ""}</rewrite>\n<sent>${record.sent ?? ""}</sent>`);
  } else lines.push("They like rewrites unchanged; keep the same style.");
  lines.push("</user_taste>");
  return lines.join("\n");
}
function splitLapidaReply(raw: string) {
  const marker = "<<<CHANGES>>>";
  const at = raw.lastIndexOf(marker);
  if (at < 0) return { text: raw.trim(), notes: [] as string[] };
  return { text: raw.slice(0, at).trim(), notes: raw.slice(at + marker.length).split("\n").map((line) => line.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean).slice(0, 3).map((line) => line.length > 80 ? `${line.slice(0, 79)}…` : line) };
}
async function lapidaProjectContext($: EngineInterface) {
  const parts: string[] = [];
  const home = await $.env.get("HOME") ?? await $.env.get("USERPROFILE");
  if (home) try { parts.push(`# User instructions\n${await $.fs.read(`${home}/.claude/CLAUDE.md`)}`); } catch {}
  for (const file of await $.fs.ancestors({ names: ["CLAUDE.md", "AGENTS.md"] })) parts.push(`# ${file.dir}/${file.name}\n${file.content}`);
  const commands = (await $.command.list()).filter((command) => command.source !== "builtin");
  if (commands.length) parts.push(`# Installed skills and commands\n${commands.map((command) => `/${command.name}: ${command.description}`).join("\n")}`);
  return `Project context for the rewrite:\n\n${parts.join("\n\n")}`;
}
async function enhanceLapida($: EngineInterface, draft: string) {
  draft = draft.trim();
  const pt = (await getSettings($)).locale === "pt";
  if (!draft) { await update($, lapidaPhase, () => "error"); await update($, lapidaNote, () => pt ? "Digite um rascunho primeiro." : "Type a prompt draft first."); return; }
  if (!(await featureEnabled($, "lapida"))) return;
  await update($, lapidaPhase, () => "enhancing");
  await update($, lapidaNote, () => "");
  await update($, lapidaChanges, () => []);
  const prefs = await readFeaturePreferences($);
  const taste = prefs.promptLearning ? lapidaTasteHint(await loadLapidaTaste($)) : "";
  const marker = "<<<CHANGES>>>";
  const instructions = pt
    ? `Reescreva o rascunho de um desenvolvedor em um pedido claro e específico para o Claude Code. Preserve a intenção, use arquivos e convenções do projeto, declare objetivo, escopo, limites e conclusão, e pergunte se houver ambiguidade real. Independentemente do idioma do rascunho, escreva o prompt final inteiro em português brasileiro. Retorne apenas o prompt, uma linha contendo ${marker}, e 1 a 3 tópicos curtos em português sobre o que acrescentou.`
    : `Rewrite a developer's rough draft into a clear, specific prompt for Claude Code. Preserve intent, use relevant project files and conventions, state goal, scope, constraints, and done criteria, and ask if something is genuinely ambiguous. Regardless of the draft's language, write the final prompt entirely in English. Return only the rewrite, a line containing ${marker}, and 1-3 short bullets in English on what you added.`;
  const prompt = `${instructions}${taste ? `\n\n${taste}` : ""}\n\n<rough_prompt>\n${draft}\n</rough_prompt>`;
  let result = await callModel($, "lapida", undefined, () => $.model.fork({ prompt }));
  if (!result.isAnswered && result.reason === "nothing-to-fork") result = await completeModel($, "lapida", { model: await $.session.model(), system: await lapidaProjectContext($), prompt, maxTokens: 2048, timeoutMs: 60000 });
  const reply = result.isAnswered ? splitLapidaReply(result.text) : { text: "", notes: [] as string[] };
  if (!result.isAnswered || !reply.text) { await update($, lapidaPhase, () => "error"); await update($, lapidaNote, () => `Lapida failed: ${result.isAnswered ? "empty reply" : result.reason}`); return; }
  const filled = await $.prompt.fill({ text: reply.text, mode: "replace" });
  if (!filled.isFilled) { await update($, lapidaPhase, () => "error"); await update($, lapidaNote, () => `Prompt box refused the text (${filled.refusal ?? "unknown"})`); return; }
  await update($, lapidaEnhanced, () => reply.text);
  await update($, lapidaChanges, () => reply.notes);
  await update($, lapidaPhase, () => "ready");
}
async function recordLapidaSend($: EngineInterface, text: string) {
  const original = await read($, lapidaEnhanced);
  if (!original) return;
  await update($, lapidaEnhanced, () => "");
  await update($, lapidaChanges, () => []);
  await update($, lapidaPhase, () => "idle");
  if (!(await readFeaturePreferences($)).promptLearning) return;
  const sent = text.trim();
  const edited = sent !== original;
  const record: LapidaTaste = { edited, delta: sent.length - original.length };
  if (edited) { record.rewrite = clipLapida(original); record.sent = clipLapida(sent); }
  await $.store.set(await lapidaTasteKey($), [...(await loadLapidaTaste($)), record].slice(-10));
}

async function farolCompose($: EngineInterface, e: PromptComposeEvent, result: Awaited<ReturnType<EngineInterface["prompt"]["compose"]>>) {
  if (!(await featureEnabled($, "farol"))) return result;
  const prefs = await readFeaturePreferences($);
  const pt = (await getSettings($)).locale === "pt";
  const guide = pt
    ? prefs.assumptionScope === "all" ? "# Farol\nQuando fizer uma suposição não declarada pela pessoa ou confirmada pelo código, registre uma frase curta com mcp__jev__farol_assumption e continue. A pessoa pode confirmar ou corrigir pelo painel Farol." : "# Farol\nRegistre somente suposições que mudem de forma relevante a implementação ou o resultado. Ignore padrões rotineiros e fatos resolvidos pelo código. Use mcp__jev__farol_assumption e continue."
    : prefs.assumptionScope === "all" ? "# Farol\nWhen you make an assumption not stated by the user or settled by the code, call mcp__jev__farol_assumption with one short sentence and keep working. The user can confirm or correct it in the Farol panel." : "# Farol\nLog only assumptions that materially affect implementation or could change the result. Skip routine defaults and facts settled by the code. Call mcp__jev__farol_assumption and keep working.";
  const rules = await read($, farolRules);
  const learned = rules.length ? `${pt ? "# Regras do projeto aprendidas com correções\nSiga estas correções e evite repetir as suposições originais." : "# Project rules learned from corrected assumptions\nFollow these corrections and avoid repeating the original assumptions."}\n${rules.map((rule) => `- ${rule.correction} (${pt ? "não" : "not"}: "${rule.assumption}")`).join("\n")}` : "";
  return { sections: [...result.sections, { id: "jev:farol:guidance", text: guide, scope: "session" as const }, ...(learned ? [{ id: "jev:farol:rules", text: learned, scope: "session" as const }] : [])] };
}

async function farolTurnStarted($: EngineInterface) { await update($, farolBusy, () => true); }
async function farolTurnCompleted($: EngineInterface, agentId?: string) { if (!agentId) await update($, farolBusy, () => false); }

function renderElements($: EngineInterface, event: unknown): ElementTable {
  return $.ui.resolve(event as never) as ElementTable;
}

async function farolAbove($: EngineInterface, e: { props: { hasSurvey?: boolean } }, below: RenderChildren): Promise<RenderChildren> {
  if (e.props.hasSurvey || !(await featureEnabled($, "farol"))) return below;
  const items = await read($, farolItems);
  const rules = await read($, farolRules);
  if (!items.length && !rules.length) return below;
  const { Box, Button } = renderElements($, e);
  const pt = (await getSettings($)).locale === "pt";
  const open = items.filter((item) => item.verdict === "open").length;
  const label = open ? pt ? `${open} suposiç${open === 1 ? "ão" : "ões"} para revisar` : `${open} assumption${open === 1 ? "" : "s"} to review` : pt ? `${rules.length} regra${rules.length === 1 ? "" : "s"} do projeto` : `${rules.length} project rule${rules.length === 1 ? "" : "s"}`;
  return <Box flexDirection="column"><Button key="farol-open" label={`${GLYPH.on} ${label} · Farol`} plain onPress={() => void $.ui.open({ id: "farol", title: "Farol", focus: true })} />{below}</Box>;
}

async function clarezaStart($: EngineInterface) {
  await $.command.register({ name: "clareza", description: "Set reply style or manage terms you already know", argumentHint: "[simple|technical|know <term>|forget]" });
}
async function clarezaCompose($: EngineInterface, result: Awaited<ReturnType<EngineInterface["prompt"]["compose"]>>) {
  if (!(await featureEnabled($, "clareza"))) return result;
  const prefs = await readFeaturePreferences($);
  return { sections: [...result.sections, { id: "jev:clareza:style", text: clarezaStyle(prefs.plainLevel, (await getSettings($)).locale === "pt"), scope: "session" as const }] };
}
async function clarezaPromptSubmit($: EngineInterface, e: PromptSubmitInput): Promise<PromptSubmitInput> {
  if (!(await featureEnabled($, "clareza"))) return e;
  const prefs = await readFeaturePreferences($);
  if (prefs.plainLevel !== "beginner") return e;
  const terms = await readClarezaTerms($);
  const told = await read($, clarezaToldTerms);
  if (terms.length <= told) return e;
  await update($, clarezaToldTerms, () => terms.length);
  return { ...e, context: [...(e.context ?? []), `Clareza: the user already knows these terms; use them without re-explaining: ${terms.slice(told).join(", ")}`] };
}
async function clarezaTurnStarted($: EngineInterface, e: { text: string }) {
  if (!(await featureEnabled($, "clareza"))) return;
  if (e.text.trim() && !e.text.includes("[Clareza]")) clarityLastAsk = e.text;
  const rewriting = e.text.includes("[Clareza]");
  await update($, clarezaRewrite, () => rewriting);
  if (!rewriting) await update($, clarezaGrade, () => null);
  await update($, clarezaStatus, () => `Working: ${clarityLastAsk.replace(/\s+/g, " ").trim().slice(0, 70)}`);
}
async function clarezaTurnCompleted($: EngineInterface, e: { agentId?: string; reason: string; durationMs: number; answer: string }) {
  if (e.agentId || e.reason !== "answer" || !(await featureEnabled($, "clareza"))) return;
  const prefs = await readFeaturePreferences($);
  if (e.durationMs > 30000 && prefs.plainSound) {
    const locale = (await getSettings($)).locale;
    $.ui.toast(locale === "pt" ? "Pingo terminou e precisa de você" : "Pingo finished and needs you");
    void $.audio.play({ asset: "sounds/done.aiff" }).catch(() => {});
  }
  if (prefs.plainReview) void reviewClareza($, clarityLastAsk, e.answer, await read($, clarezaRewrite)).catch(() => update($, clarezaStatus, () => "Answer review failed"));
  else await update($, clarezaStatus, () => `Finished: ${clarityLastAsk.replace(/\s+/g, " ").trim().slice(0, 60)}`);
}

async function clarezaAbove($: EngineInterface, e: { props: { hasSurvey?: boolean } }, below: RenderChildren): Promise<RenderChildren> {
  if (e.props.hasSurvey || !(await featureEnabled($, "clareza"))) return below;
  const grade = await read($, clarezaGrade);
  const line = await read($, clarezaStatus);
  if (!line && !grade) return below;
  const { Box, Button, Text } = renderElements($, e);
  const top = <Box flexDirection="row" columnGap={1}><Text dimColor wrap="truncate-end">{GLYPH.on} {line}</Text>{grade && <Text color={grade.pass ? "success" : "error"}>{grade.pass ? `${GLYPH.ok} Clareza` : `✗ ${grade.problems.join("; ")}`}{grade.fixing ? " · rewriting" : ""}</Text>}</Box>;
  const offered = grade?.offered.length ? <Box flexDirection="row" flexWrap="wrap" columnGap={1}><Text dimColor>{(await getSettings($)).locale === "pt" ? "Eu sei:" : "I know this:"}</Text>{grade.offered.map((term) => <Button key={`clareza-${term}`} label={term} dimColor onPress={async () => { await addClarezaTerms($, [term]); await update($, clarezaGrade, (value) => value && { ...value, offered: value.offered.filter((word) => word !== term) }); }} />)}</Box> : null;
  return <Box flexDirection="column">{top}{offered}{below}</Box>;
}

async function sementeStart($: EngineInterface) {
  await $.command.register({ name: "semente", description: "Save a side idea for later; with no text, open the idea shelf", argumentHint: "[idea]" });
  await $.tool.register({ name: "semente_shelve", description: "Save a side idea or out-of-scope improvement for the user to review later.", inputSchema: { type: "object", properties: { text: { type: "string", description: "One-line idea" } }, required: ["text"] }, isDeferred: false });
  const stored = await $.store.get(await sementeKey($));
  await update($, sementeIdeas, () => Array.isArray(stored) ? stored as SementeIdea[] : []);
}
async function sementeCompose($: EngineInterface, e: PromptComposeEvent, result: Awaited<ReturnType<EngineInterface["prompt"]["compose"]>>) {
  if (!(await featureEnabled($, "semente")) || !e.tools.includes("mcp__jev__semente_shelve")) return result;
  const guidance = (await getSettings($)).locale === "pt"
    ? "# Semente\nQuando notar uma melhoria paralela ou fora do escopo, não a execute agora. Guarde-a com mcp__jev__semente_shelve e continue a tarefa atual."
    : "# Semente\nWhen you notice an out-of-scope tangent or improvement, do not act on it now. Save it with mcp__jev__semente_shelve and continue the current task.";
  return { sections: [...result.sections, { id: "jev:semente:guidance", text: guidance, scope: "session" as const }] };
}
async function sementeTurnStarted($: EngineInterface, e: { text: string }) {
  sementeTopics.clear();
  for (const word of sementeWords(e.text)) sementeTopics.add(word);
  sementeShelvedThisTurn = new Set();
  await update($, sementeNudges, () => []);
}
function sementeFileEdited(path: string, succeeded: boolean) {
  if (succeeded) for (const word of sementePathWords(path)) sementeTopics.add(word);
}
async function sementeTurnCompleted($: EngineInterface, e: { agentId?: string; isAborted?: boolean }) {
  const prefs = await readFeaturePreferences($);
  if (e.agentId !== undefined || e.isAborted || !sementeTopics.size || !(await featureEnabled($, "semente")) || !prefs.ideaNudges) return;
  const ideas = await read($, sementeIdeas);
  const fits = ideas.filter((idea) => !sementeShelvedThisTurn.has(idea.id) && !sementeDismissed.has(idea.id) && sementeWords(idea.text).some((word) => sementeTopics.has(word)));
  await update($, sementeNudges, () => fits.map((idea) => idea.id));
}
async function sementeAbove($: EngineInterface, e: { props: { hasSurvey?: boolean; isWorking?: boolean } }, below: RenderChildren): Promise<RenderChildren> {
  if (e.props.hasSurvey || e.props.isWorking || !(await featureEnabled($, "semente")) || !(await readFeaturePreferences($)).ideaNudges) return below;
  const ids = await read($, sementeNudges);
  const found = (await read($, sementeIdeas)).filter((idea) => ids.includes(idea.id));
  if (!found.length) return below;
  const { Box, Button, Text } = renderElements($, e);
  const pt = (await getSettings($)).locale === "pt";
  const label = pt ? `${found.length} ${found.length === 1 ? "ideia salva combina" : "ideias salvas combinam"} com o trabalho recente` : found.length === 1 ? "1 saved idea fits recent work" : `${found.length} saved ideas fit recent work`;
  return <Box flexDirection="column"><Box><Text color={PAINT.brand}>{GLYPH.on} </Text><Text>{label}: </Text><Text dimColor wrap="truncate-end">{found.map((idea) => idea.text).join(" · ")} </Text><Button key="send" label={pt ? "Enviar" : "Send"} variant="primary" onPress={() => void sendSemente($, found)} /><Button key="dismiss" label={pt ? "Dispensar" : "Dismiss"} role="dismiss" onPress={async () => { for (const idea of found) sementeDismissed.add(idea.id); await update($, sementeNudges, () => []); }} /></Box>{below}</Box>;
}

async function lapidaStart($: EngineInterface) {
  await $.command.register({ name: "lapida", description: "Improve a draft prompt using the project context", argumentHint: "<draft>" });
}
async function lapidaPromptSubmit($: EngineInterface, e: Pick<PromptSubmitInput, "text" | "origin">) {
  if (!(await featureEnabled($, "lapida"))) return;
  const own = e.origin.kind === "composer" || e.origin.kind === "bridge" || (e.origin.kind === "plugin" && e.origin.name === "jev");
  if (own) await recordLapidaSend($, e.text).catch(() => {});
}
async function lapidaAbove($: EngineInterface, e: { props: { hasSurvey?: boolean; bodyColumns?: number } }, below: RenderChildren): Promise<RenderChildren> {
  if (e.props.hasSurvey || !(await featureEnabled($, "lapida"))) return below;
  const { Box, Button, Text } = renderElements($, e);
  const pt = (await getSettings($)).locale === "pt";
  const phase = await read($, lapidaPhase);
  const enhancing = phase === "enhancing";
  const enhanceDraft = async () => enhanceLapida($, (await $.prompt.read()).text);
  const send = async () => {
    const prompt = (await $.prompt.read()).text.trim();
    if (!prompt) return;
    await $.prompt.fill({ text: "", mode: "replace" });
    await recordLapidaSend($, prompt).catch(() => {});
    await $.prompt.submit({ text: prompt, asUser: true });
  };
  const label = phase === "enhancing" ? "Lapida…" : phase === "ready" ? (pt ? "Lapida · revise o rascunho" : "Lapida · review the rewrite") : phase === "error" ? await read($, lapidaNote) : "Lapida";
  const notes = phase === "ready" ? await read($, lapidaChanges) : [];
  const width = Math.max(10, (e.props.bodyColumns || 80) - 2);
  // The node and label, then each button, move whole to the next line on a narrow band instead of being squeezed.
  return <Box flexDirection="column"><Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.xs}><Box flexDirection="row" columnGap={UI_DESIGN.space.xs}><Text color={PAINT.brand}>{GLYPH.on}</Text><Text dimColor wrap="truncate-end">{label}</Text></Box>{!enhancing && <Box flexShrink={0}><Button key="lapida-enhance" label={pt ? "Lapidar (e)" : "Enhance (e)"} hotkey="e" onPress={enhanceDraft} /></Box>}{!enhancing && <Box flexShrink={0}><Button key="lapida-send" label={pt ? "Enviar (s)" : "Send (s)"} hotkey="s" onPress={send} /></Box>}</Box>{notes.map((line) => <Text key={line} dimColor wrap="truncate-end">{`+ ${line}`.slice(0, width)}</Text>)}{below}</Box>;
}

type PrismaQuestionInput = { question: string; header: string; multiSelect?: boolean; options?: { label: string; description?: string; preview?: string }[] };
type PrismaNext = ((event: unknown) => Promise<unknown>) & { signal: AbortSignal };
const prismaIsSvg = (value?: string) => !!value && /^\s*<svg[\s>]/i.test(value);
const prismaSafeSvg = (source: string) => source.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, "").replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/\s+(?:xlink:)?href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/url\s*\([^)]*\)/gi, "none").replace(/@import[^;]+;?/gi, "");
const prismaMix = (a: string, b: string) => `Mix of "${a}" and "${b}": blend both directions into one design`;
const prismaMixing = (picker: PrismaPicker, i: number) => !!picker.mix[i];
const prismaComplete = (picker: PrismaPicker) => picker.questions.every((question, i) => picker.others[i] || (prismaMixing(picker, i) ? picker.picks[i]?.length === 2 : !!picker.picks[i]?.length));
function prismaAnswers(picker: PrismaPicker) {
  return Object.fromEntries(picker.questions.map((question, i) => [question.question, picker.others[i] ?? (prismaMixing(picker, i) && picker.picks[i]?.length === 2 ? prismaMix(picker.picks[i]![0]!, picker.picks[i]![1]!) : picker.picks[i]?.join(", ")) ?? ""]));
}
function prismaPick(picker: PrismaPicker, qi: number, label: string): PrismaPicker {
  const question = picker.questions[qi]!;
  const picks = picker.picks.map((old, i) => {
    if (i !== qi) return old;
    if (old.includes(label) && (question.multiSelect || prismaMixing(picker, i))) return old.filter((item) => item !== label);
    if (prismaMixing(picker, i)) return [...old, label].slice(-2);
    return question.multiSelect ? [...old, label] : [label];
  });
  return { ...picker, picks, others: picker.others.map((value, i) => i === qi ? null : value) };
}
function prismaToggleMix(picker: PrismaPicker, qi: number): PrismaPicker {
  const mix = picker.mix.map((value, i) => i === qi ? !value : value);
  const picks = picker.picks.map((list, i) => i === qi && picker.mix[i] ? list.slice(0, 1) : list);
  return { ...picker, mix, picks };
}
const prismaEscape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function prismaGallery(questions: PrismaQuestion[], token: string, pt = false) {
  let n = 0;
  const sections = questions.map((question, qi) => `<section><h2>${prismaEscape(question.header)}</h2><p>${prismaEscape(question.question)}</p><div class="grid">${question.options.map((option, oi) => `<button class="card" data-q="${qi}" data-label="${prismaEscape(option.label)}"><img src="/${qi}-${oi}.svg" alt=""/><span><kbd>${++n}</kbd> ${prismaEscape(option.label)}${option.description ? `<small>${prismaEscape(option.description)}</small>` : ""}</span></button>`).join("")}</div>${!question.multiSelect && question.options.length > 1 ? `<button class="mix" data-q="${qi}">${pt ? "Misturar duas" : "Mix two"}</button>` : ""}<input class="other" data-q="${qi}" placeholder="${pt ? "Descreva sua opção e pressione Enter" : "Or describe your own, then Enter"}"/></section>`).join("");
  const less = String.fromCharCode(92) + "u003c";
  const meta = JSON.stringify(questions.map((question) => ({ question: question.question, multi: question.multiSelect }))).replace(/</g, less);
  const quote = String.fromCharCode(34);
  const mix = JSON.stringify([`Mix of ${quote}`, `${quote} and ${quote}`, `${quote}: blend both directions into one design`]).replace(/</g, less);
  const needsSubmit = questions.length > 1 || questions.some((question) => question.multiSelect);
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Prisma · ${pt ? "escolhas de design" : "design choices"}</title><style>body{font:15px/1.4 system-ui,sans-serif;margin:24px;background:#f4f4f2;color:#1a1a1a}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}.card{all:unset;cursor:pointer;display:block;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px #0002;outline:3px solid transparent}.card:hover{outline-color:#999}.card.on{outline-color:#16a34a}.card img{display:block;width:100%;height:auto}.card span{display:block;padding:10px 14px;font-weight:600}small{display:block;font-weight:400;color:#666}kbd{background:#1a1a1a;color:white;border-radius:4px;padding:1px 7px}.other{margin-top:12px;width:100%;max-width:480px;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font:inherit}#submit,.mix{margin:18px 10px 0 0;padding:9px 16px;border:1px solid #333;border-radius:7px;background:white;font:inherit;cursor:pointer}#submit{background:#1a1a1a;color:white}#submit:disabled{opacity:.4}.mix.on{background:#16a34a;color:white}</style>${sections}<button id="submit"${needsSubmit ? " disabled" : " hidden"}>${pt ? "Enviar ao Claude" : "Send to Claude"}</button><script>const qs=${meta},picks=qs.map(()=>[]),others=qs.map(()=>null),mixing=qs.map(()=>false),auto=${!needsSubmit},M=${mix};const done=()=>qs.every((_,i)=>others[i]||(mixing[i]?picks[i].length===2:picks[i].length));const answer=i=>others[i]??(mixing[i]&&picks[i].length===2?M[0]+picks[i][0]+M[1]+picks[i][1]+M[2]:picks[i].join(', '));const send=()=>fetch('/answer?t=${token}',{method:'POST',body:JSON.stringify(Object.fromEntries(qs.map((q,i)=>[q.question,answer(i)])))}).then(r=>{if(!r.ok)throw 0;document.body.innerHTML='<h1>${pt ? "Enviado ao Claude " + GLYPH.ok : "Sent to Claude " + GLYPH.ok}</h1>'}).catch(()=>alert('${pt ? "O seletor não está mais aguardando." : "This picker is no longer waiting."}'));const sync=()=>{document.querySelectorAll('.card').forEach(c=>c.classList.toggle('on',picks[c.dataset.q].includes(c.dataset.label)));document.querySelectorAll('.mix').forEach(b=>{b.classList.toggle('on',mixing[b.dataset.q]);b.textContent=mixing[b.dataset.q]?'${pt ? "Misturando: escolha duas" : "Mixing: pick two"}':'${pt ? "Misturar duas" : "Mix two"}'});const s=document.getElementById('submit');s.hidden=auto&&!mixing.some(Boolean);s.disabled=!done()};document.querySelectorAll('.card').forEach(c=>c.onclick=()=>{const i=+c.dataset.q,l=c.dataset.label,has=picks[i].includes(l);others[i]=null;picks[i]=mixing[i]?(has?picks[i].filter(x=>x!==l):[...picks[i],l].slice(-2)):qs[i].multi?(has?picks[i].filter(x=>x!==l):[...picks[i],l]):[l];sync();if(auto&&!mixing[i])send()});document.querySelectorAll('.mix').forEach(b=>b.onclick=()=>{const i=+b.dataset.q;mixing[i]=!mixing[i];if(!mixing[i])picks[i]=picks[i].slice(0,1);sync()});document.querySelectorAll('.other').forEach(o=>o.onkeydown=e=>{if(e.key!=='Enter'||!o.value.trim())return;const i=+o.dataset.q;others[i]=o.value.trim();picks[i]=[];sync();if(auto)send()});document.getElementById('submit')?.addEventListener('click',send);const cards=[...document.querySelectorAll('.card')];document.onkeydown=e=>{if(e.target.tagName!=='INPUT'&&/^[1-9]$/.test(e.key))cards[e.key-1]?.click()};</script>`;
}
const PRISMA_SERVE_PY = `import http.server,json,os,sys,threading,time,webbrowser
d,token,auto=sys.argv[1],sys.argv[2],sys.argv[3]=='1'
answer=os.path.join(d,'answer.json'); portfile=os.path.join(d,'port'); reopen=not os.path.exists(portfile)
class H(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*a,**k): super().__init__(*a,directory=d,**k)
 def log_message(self,*a): pass
 def do_POST(self):
  if self.path!='/answer?t='+token or os.path.exists(answer): self.send_response(403); self.end_headers(); return
  body=self.rfile.read(int(self.headers.get('Content-Length',0))); value=json.loads(body)
  with open(answer+'.tmp','w',encoding='utf8') as f: json.dump(value,f)
  os.replace(answer+'.tmp',answer); self.send_response(204); self.end_headers()
srv=http.server.ThreadingHTTPServer(('127.0.0.1',0 if reopen else int(open(portfile).read())),H)
with open(portfile,'w') as f: f.write(str(srv.server_address[1]))
threading.Thread(target=srv.serve_forever,daemon=True).start()
if auto and reopen: webbrowser.open('http://127.0.0.1:%d/index.html'%srv.server_address[1])
while not os.path.exists(answer): time.sleep(.2)
time.sleep(.2); print(open(answer,encoding='utf8').read())
`;
const prismaDecisionKey = async ($: EngineInterface) => `prisma:decisions:${await $.session.root()}`;
async function readPrismaDecisions($: EngineInterface): Promise<{ question: string; choice: string; description?: string; at: number }[]> {
  const stored = await $.store.get(await prismaDecisionKey($));
  return Array.isArray(stored) ? stored as { question: string; choice: string; description?: string; at: number }[] : [];
}
function prismaDecisionPrompt(list: { question: string; choice: string; description?: string }[], pt = false) {
  return list.length ? `${pt ? "# Decisões de design já tomadas neste projeto\nSiga estas escolhas em futuros trabalhos visuais; não pergunte novamente, a menos que a pessoa queira revisá-las." : "# Prisma decisions already made in this project\nFollow these choices in future design work; do not ask again unless the user revisits them."}\n${list.map((item) => `- ${item.question} → ${item.choice}${item.description ? ` (${item.description})` : ""}`).join("\n")}` : "";
}
async function rememberPrisma($: EngineInterface, questions: PrismaQuestion[], answers: Record<string, string>) {
  const at = await $.clock.now();
  const added = questions.flatMap((question) => {
    const choice = answers[question.question]?.trim();
    if (!choice) return [];
    const labels = choice.startsWith("Mix of \"") ? [...choice.matchAll(/"([^"]+)"/g)].map((match) => match[1]!) : choice.split(", ");
    const description = question.options.filter((option) => labels.includes(option.label)).map((option) => option.description).filter(Boolean).join(" + ");
    return [{ question: question.question, choice, ...(description ? { description } : {}), at }];
  });
  if (!added.length) return;
  const old = await readPrismaDecisions($);
  await $.store.set(await prismaDecisionKey($), [...old.filter((item) => !added.some((next) => next.question === item.question)), ...added].slice(-50));
}
async function prismaCompose($: EngineInterface, e: PromptComposeEvent, result: Awaited<ReturnType<EngineInterface["prompt"]["compose"]>>) {
  if (!(await featureEnabled($, "prisma"))) return result;
  const pt = (await getSettings($)).locale === "pt";
  const saved = prismaDecisionPrompt(await readPrismaDecisions($), pt);
  const guide = e.tools.includes("AskUserQuestion") ? pt ? "# Prisma\nPara escolhas visuais de design, use AskUserQuestion e inclua uma prévia SVG independente e distinta para cada opção. Desenhe o layout, a paleta, a tipografia e um texto de exemplo. Limite cada prévia a 8 KB e não use recursos externos." : "# Prisma\nFor visual design choices, use AskUserQuestion and include a distinct, self-contained SVG preview for each option. Draw actual layout, palette, type and sample copy. Keep each under 8 KB and do not use external resources." : "";
  return { sections: [...result.sections, ...(guide ? [{ id: "jev:prisma:guidance", text: guide, scope: "session" as const }] : []), ...(saved ? [{ id: "jev:prisma:decisions", text: saved, scope: "session" as const }] : [])] };
}

const sentinelaOrder = { waiting: 0, working: 1, done: 2 } as const;
const sentinelaLabel = (row: SentinelaSession) => row.name || row.project || row.id;
const sentinelaAge = (ms: number) => { const seconds = Math.max(0, Math.round(ms / 1000)); return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`; };
async function sentinelaPids($: EngineInterface, rows: SentinelaSession[]) {
  const pids = rows.map((row) => row.pid);
  if (!pids.length) return new Set<number>();
  if (await $.env.get("OS") === "Windows_NT") {
    const command = `@(${pids.join(",")}) | ForEach-Object { if (Get-Process -Id $_ -ErrorAction SilentlyContinue) { $_ } }`;
    for (const exe of ["pwsh", "powershell"]) {
      const result = await $.process.run([exe, "-NoProfile", "-NonInteractive", "-Command", command]).catch(() => null);
      if (result) return new Set(result.stdout.split(/\s+/).map(Number).filter(Number.isFinite));
    }
    return new Set(pids);
  }
  const result = await $.process.run(["ps", "-o", "pid=", "-p", pids.join(",")]).catch(() => null);
  return new Set(result ? result.stdout.split(/\s+/).map(Number).filter(Number.isFinite) : pids);
}
async function refreshSentinela($: EngineInterface) {
  if (!(await featureEnabled($, "sentinela")) || !sentinelaDir) return;
  const errors: string[] = [];
  const rows: SentinelaSession[] = [];
  const entries = await $.fs.list(sentinelaDir).catch((error) => { errors.push(String(error)); return []; });
  for (const entry of entries) {
    if (!entry.name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await $.fs.read(`${sentinelaDir}/${entry.name}`));
      if (typeof raw.pid !== "number" || typeof raw.sessionId !== "string") continue;
      const cwd = typeof raw.cwd === "string" ? raw.cwd : "";
      rows.push({ pid: raw.pid, id: raw.sessionId, name: raw.nameSource === "derived" ? "" : String(raw.name ?? ""), cwd, project: cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd, status: raw.status === "waiting" ? "waiting" : raw.status === "busy" ? "working" : "done", waitingFor: String(raw.waitingFor ?? ""), since: Number(raw.statusUpdatedAt ?? raw.updatedAt ?? 0) });
    } catch (error) { errors.push(`read ${entry.name}: ${String(error)}`); }
  }
  const alive = await sentinelaPids($, rows);
  const next = rows.filter((row) => alive.has(row.pid)).sort((a, b) => sentinelaOrder[a.status] - sentinelaOrder[b.status] || b.since - a.since);
  const current = await read($, sentinelaSessions);
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    await update($, sentinelaSessions, () => next);
    const target = await read($, sentinelaReplyTo);
    if (target && !next.some((row) => row.id === target)) await update($, sentinelaReplyTo, () => "");
  }
  await update($, sentinelaProblem, () => errors.join("\n"));
  sentinelaRefreshedAt = await $.clock.now();
}
async function registerSentinela($: EngineInterface) {
  const home = await $.env.get("HOME") ?? await $.env.get("USERPROFILE") ?? "";
  sentinelaDir = `${home.replace(/[\\/]$/, "")}/.claude/sessions`;
  sentinelaMe = await $.session.id();
  await $.command.register({ name: "sentinela", description: "Show sessions across all projects" });
  $.clock.every(2000, async () => {
    if (!(await featureEnabled($, "sentinela"))) return;
    const preferences = await readFeaturePreferences($);
    if (await $.clock.now() - sentinelaRefreshedAt >= preferences.monitorEveryMs) await refreshSentinela($);
  });
  await refreshSentinela($);
}
async function sentinelaPaneRows($: EngineInterface) { return Math.max(2, (await read($, sentinelaSessions)).length + 1) + ((await read($, sentinelaReplyTo)) ? 1 : 0); }
async function resizeSentinela($: EngineInterface) {
  if ((await $.ui.panes()).some((pane) => pane.id === "sentinela" && pane.isShown)) await $.ui.open({ id: "sentinela", title: "Sentinela", rows: await sentinelaPaneRows($) });
}
async function toggleSentinela($: EngineInterface) {
  if ((await $.ui.panes()).some((pane) => pane.id === "sentinela" && pane.isShown)) return $.ui.close({ id: "sentinela" });
  await refreshSentinela($);
  await $.ui.open({ id: "sentinela", title: "Sentinela", rows: await sentinelaPaneRows($), focus: true, closeOnEscape: true });
}
async function sendSentinelaReply($: EngineInterface, value: string) {
  const id = await read($, sentinelaReplyTo);
  await update($, sentinelaReplyTo, () => "");
  await resizeSentinela($);
  if (!id || !value.trim()) return;
  const row = (await read($, sentinelaSessions)).find((item) => item.id === id);
  const name = row ? sentinelaLabel(row) : id;
  const delivered = await $.session.send({ to: { sessionId: id }, text: value.trim() });
  $.ui.toast(delivered.isDelivered ? `Sent to ${name}.` : `Not sent to ${name}: ${delivered.reason}`);
}
async function jumpSentinela($: EngineInterface, row: SentinelaSession, surface: RenderSurface) {
  const windows = await $.env.get("OS") === "Windows_NT";
  const command = windows ? `Set-Location -LiteralPath '${row.cwd.replace(/'/g, "''")}'; claude --resume ${row.id}` : `${row.cwd ? `cd '${row.cwd.replace(/'/g, "'\\''")}' && ` : ""}claude --resume ${row.id}`;
  const copied = await $.ui.copy({ text: command, surface });
  $.ui.toast(copied.isCopied ? `Copied: ${command}` : `Run: ${command}`, { timeoutMs: 8000 });
}
async function sentinelaAbove($: EngineInterface, e: { props: { hasSurvey?: boolean } }, below: RenderChildren): Promise<RenderChildren> {
  if (e.props.hasSurvey || !(await featureEnabled($, "sentinela"))) return below;
  const list = await read($, sentinelaSessions);
  const count = (status: SentinelaSession["status"]) => list.filter((row) => row.status === status).length;
  const { Box, Button, Text } = renderElements($, e);
  const locale = (await getSettings($)).locale;
  // Each part moves whole to the next line on a narrow band: the button is never split from its node or cut.
  return <Box flexDirection="column"><Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}><Box flexDirection="row" flexShrink={0} columnGap={UI_DESIGN.space.xs}><Text color={PAINT.brand}>{GLYPH.on}</Text><Button key="sessions" label={locale === "pt" ? "Sessões" : "Sessions"} onPress={() => void toggleSentinela($)} /></Box><Box flexShrink={0}><Text color="error">{GLYPH.ask} {count("waiting")} {locale === "pt" ? "aguardando" : "waiting"}</Text></Box><Box flexShrink={0}><Text color="warning">{GLYPH.on} {count("working")} {locale === "pt" ? "trabalhando" : "working"}</Text></Box><Box flexShrink={0}><Text color="success">{GLYPH.ok} {count("done")} {locale === "pt" ? "concluídas" : "done"}</Text></Box></Box>{below}</Box>;
}

const vigiaFlat = (value: string, max: number) => { const text = value.replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const vigiaAlive = (record: VigiaSession, now: number) => record.endedAt === undefined && now - record.beatAt < 60000;
const vigiaAgo = (ms: number) => { const minutes = Math.round(ms / 60000); return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`; };
const vigiaName = (record: VigiaSession) => record.title ?? (record.lastPrompt ? vigiaFlat(record.lastPrompt, 40) : record.id.slice(0, 8));
const vigiaDoing = (record: VigiaSession) => record.tasks.find((task) => task.status === "in_progress")?.text ?? record.doing;
const vigiaNext = (record: VigiaSession) => record.tasks.find((task) => task.status === "pending")?.text ?? record.next;
const vigiaShared = (a: VigiaSession, b: VigiaSession) => (a.files ?? []).filter((file) => (b.files ?? []).includes(file));
async function ensureVigia($: EngineInterface) {
  const id = await $.session.id();
  const root = await $.session.root();
  if (vigiaMe?.id === id && vigiaMe.root === root) return vigiaMe;
  const home = await $.env.get("HOME") ?? await $.env.get("USERPROFILE") ?? "";
  vigiaDir = `${home.replace(/[\\/]$/, "")}/.claude/jev-vigia/${root.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const file = `${vigiaDir}/${id}.json`;
  const now = await $.clock.now();
  const old = await $.fs.exists(file) ? JSON.parse(await $.fs.read(file)) as VigiaSession : undefined;
  vigiaMe = old ? { ...old, endedAt: undefined, isBusy: false } : { id, root, startedAt: now, beatAt: now, tasks: [] };
  return vigiaMe;
}
async function refreshVigia($: EngineInterface) {
  if (!(await featureEnabled($, "vigia"))) return;
  const own = await ensureVigia($);
  const now = await $.clock.now();
  const found: VigiaSession[] = [];
  if (await $.fs.exists(vigiaDir)) for (const entry of await $.fs.list(vigiaDir)) {
    if (entry.kind !== "file" || !entry.name.endsWith(".json") || now - entry.mtimeMs > 7 * 24 * 3600000) continue;
    try {
      const row = JSON.parse(await $.fs.read(`${vigiaDir}/${entry.name}`)) as VigiaSession;
      if (row.id === own.id || row.lastPrompt) found.push(row);
    } catch { /* another session may still be writing its record */ }
  }
  found.sort((a, b) => (a.id === own.id ? 0 : vigiaAlive(a, now) ? 1 : 2) - (b.id === own.id ? 0 : vigiaAlive(b, now) ? 1 : 2) || b.beatAt - a.beatAt);
  await update($, vigiaSessions, () => found);
}
async function saveVigia($: EngineInterface, change?: (record: VigiaSession) => void) {
  if (!(await featureEnabled($, "vigia"))) return;
  const record = await ensureVigia($);
  change?.(record);
  record.beatAt = await $.clock.now();
  await $.fs.write(`${vigiaDir}/${record.id}.json`, JSON.stringify(record, null, 2));
  await refreshVigia($);
}
type VigiaClash = { file: string; other: VigiaSession; at: number };
async function vigiaClashes($: EngineInterface, now: number): Promise<VigiaClash[]> {
  const own = await ensureVigia($);
  const window = (await readFeaturePreferences($)).clashMinutes * 60000;
  return (await read($, vigiaSessions)).filter((other) => other.id !== own.id && vigiaAlive(other, now)).flatMap((other) => Object.entries(other.edits ?? {})
    .filter(([file, at]) => now - at < window && now - (own.edits?.[file] ?? 0) < window)
    .map(([file, at]) => ({ file, other, at }))).sort((a, b) => b.at - a.at);
}
async function trackVigiaFile($: EngineInterface, path: string): Promise<string | undefined> {
  const own = await ensureVigia($);
  const root = own.root.replace(/\\/g, "/").replace(/\/$/, "");
  const candidate = path.replace(/\\/g, "/");
  const relative = candidate.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? candidate.slice(root.length + 1) : candidate;
  await refreshVigia($);
  const now = await $.clock.now();
  const window = (await readFeaturePreferences($)).clashMinutes * 60000;
  const prior = own.edits?.[relative] ?? 0;
  const other = (await read($, vigiaSessions)).find((row) => row.id !== own.id && vigiaAlive(row, now) && (row.edits?.[relative] ?? 0) > Math.max(prior, now - window));
  await saveVigia($, (record) => {
    record.edits = Object.fromEntries(Object.entries({ ...record.edits, [relative]: now }).filter(([, at]) => now - Number(at) < window));
    if (!record.files?.includes(relative)) record.files = [relative, ...(record.files ?? [])].slice(0, 12);
  });
  if (!other) return;
  const when = vigiaAgo(now - (other.edits?.[relative] ?? now));
  const task = vigiaDoing(other) ?? other.lastPrompt;
  $.ui.toast(`⚠ ${relative} was edited ${when} by "${vigiaName(other)}"${task ? ` (${vigiaFlat(task, 60)})` : ""}`, { timeoutMs: 8000 });
  return `Vigia: another live session ("${vigiaName(other)}"${task ? `, working on: ${vigiaFlat(task, 120)}` : ""}) edited ${relative} ${when}. Re-read it before editing and preserve its changes.`;
}
async function summarizeVigia($: EngineInterface, answer: string) {
  if (!(await readFeaturePreferences($)).trackerSummary || !(await featureEnabled($, "vigia"))) return;
  const own = await ensureVigia($);
  const prompt = ["Summarize where this coding session stands for a teammate.", "Reply with exactly four lines, no markdown:", "TITLE: <2-5 word name for the work>", "DONE: <what is done, under 100 chars>", "DOING: <what is in progress or waiting, under 100 chars>", "NEXT: <concrete next step, under 100 chars>", `Previous: ${own.title ?? "-"} | ${own.done ?? "-"} | ${own.doing ?? "-"} | ${own.next ?? "-"}`, `Tasks: ${own.tasks.map((task) => `[${task.status}] ${task.text}`).join("; ") || "none"}`, `Files: ${(own.files ?? []).join(", ") || "none"}`, `Latest prompt: ${own.lastPrompt ?? "-"}`, `Latest answer:\n${answer.slice(-6000)}`].join("\n");
  const result = await completeModel($, "vigia", { model: "haiku", prompt, maxTokens: 300, timeoutMs: 30000 });
  if (!result.isAnswered) return;
  const pick = (label: string) => result.text.match(new RegExp(`^\\s*${label}:\\s*(.+)$`, "mi"))?.[1]?.trim();
  await saveVigia($, (record) => { record.title = pick("TITLE") ?? record.title; record.done = pick("DONE") ?? record.done; record.doing = pick("DOING") ?? record.doing; record.next = pick("NEXT") ?? record.next; });
}
async function vigiaPromptSubmit($: EngineInterface, e: Pick<PromptSubmitInput, "text">) {
  if (await featureEnabled($, "vigia")) await saveVigia($, (record) => { record.lastPrompt = vigiaFlat(e.text, 300); record.isBusy = true; record.turns = (record.turns ?? 0) + 1; });
}
async function vigiaTrackFile($: EngineInterface, path: string) { return await featureEnabled($, "vigia") ? trackVigiaFile($, path) : undefined; }
async function vigiaTurnCompleted($: EngineInterface, e: { agentId?: string; answer?: string }) {
  if (e.agentId !== undefined || !(await featureEnabled($, "vigia"))) return;
  await saveVigia($, (record) => { record.isBusy = false; if (e.answer) record.lastAnswer = vigiaFlat(e.answer.trim().split(/\n\s*\n/).at(-1) ?? "", 300); });
  if (e.answer) void summarizeVigia($, e.answer).catch(() => {});
}
async function registerVigia($: EngineInterface) {
  await $.command.register({ name: "vigia", description: "Show other sessions working in this project" });
  $.clock.every(15000, async () => { if (await featureEnabled($, "vigia")) await saveVigia($); });
  if (await featureEnabled($, "vigia")) {
    await saveVigia($);
    const now = await $.clock.now();
    const others = (await read($, vigiaSessions)).filter((row) => row.id !== vigiaMe?.id && vigiaAlive(row, now));
    if (others.length) void $.ui.open({ id: "vigia", title: "Vigia" });
  }
}
async function vigiaSessionEnd($: EngineInterface) {
  const now = await $.clock.now();
  if (await featureEnabled($, "vigia")) await saveVigia($, (record) => { record.endedAt = now; record.isBusy = false; });
  vigiaMe = undefined;
}
async function vigiaAbove($: EngineInterface, e: { props: { hasSurvey?: boolean } }, below: RenderChildren): Promise<RenderChildren> {
  if (e.props.hasSurvey || !(await featureEnabled($, "vigia"))) return below;
  const list = await read($, vigiaSessions);
  const now = await $.clock.now();
  const others = list.filter((record) => record.id !== vigiaMe?.id && vigiaAlive(record, now));
  if (!others.length) return below;
  const conflicts = await vigiaClashes($, now);
  const { Box, Button, Text } = renderElements($, e);
  const pt = (await getSettings($)).locale === "pt";
  const collapsed = await read($, vigiaCollapsed);
  const toggle = <Button key="vigia-toggle" label={collapsed ? (pt ? "exibir" : "show") : (pt ? "ocultar" : "hide")} plain dimColor onPress={async () => { const value = !await read($, vigiaCollapsed); await update($, vigiaCollapsed, () => value); await $.store.set("vigia:collapsed", value); }} />;
  if (collapsed) return <Box flexDirection="column"><Box gap={1}><Text color={PAINT.brand}>{GLYPH.on}</Text><Text dimColor>{others.length} {pt ? "outras sessões neste projeto" : `other session${others.length === 1 ? "" : "s"} here`} ·</Text>{conflicts.length > 0 && <Text color="error">! {conflicts.length} {pt ? "conflitos" : `file clash${conflicts.length === 1 ? "" : "es"}`} ·</Text>}{toggle}</Box>{below}</Box>;
  return <Box flexDirection="column"><Box flexDirection="column"><Box gap={1}><Text color={PAINT.brand}>{GLYPH.on}</Text><Text dimColor>{pt ? "Também trabalhando neste projeto · /vigia" : "Also working in this project · /vigia"}</Text>{toggle}</Box>{conflicts.slice(0, 2).map((conflict) => <Text key={`${conflict.other.id}-${conflict.file}`} color="error" wrap="truncate">  ! {pt ? "Conflito" : "Clash"}: {conflict.file} · {vigiaName(conflict.other)} · {vigiaAgo(now - conflict.at)}</Text>)}{others.slice(0, 3).map((record) => <Box key={record.id} flexDirection="column" paddingLeft={2}><Text wrap="truncate"><Text color={record.isBusy ? "warning" : "success"}>{record.isBusy ? `${GLYPH.on} ` : "◐ "}</Text><Text bold>{vigiaName(record)}</Text><Text dimColor> · {record.isBusy ? (pt ? "trabalhando" : "working") : (pt ? "aguardando" : "waiting")}</Text></Text>{(vigiaDoing(record) ?? record.lastPrompt) && <Text wrap="truncate">{GLYPH.branch} {vigiaDoing(record) ?? record.lastPrompt}{vigiaNext(record) ? ` → ${vigiaNext(record)}` : ""}</Text>}</Box>)}</Box>{below}</Box>;
}

export function normalizeTab(value: unknown): JevTab {
  switch (value) {
    case "overview":
    case "live":
    case "models":
    case "agents":
    case "logs":
    case "configuration":
    case "deck":
    case "features":
    case "ai":
    case "flow":
    case "orchestration":
      return value;
    case "reasons":
    case "baseline":
    case "log":
      return "logs";
    case "setup":
      return "ai";
    default:
      return "overview";
  }
}

async function openPane($: EngineInterface, which: JevTab): Promise<void> {
  await update($, tab, () => which);
  await $.ui.open({ id: PANE, title: "Jev", focus: true });
}

async function statusText($: EngineInterface): Promise<string> {
  const config = await getSettings($);
  const list = await read($, events);
  const locale = config.locale;
  return [
    text("ui.status.heading", locale),
    text("ui.status.routingLine", locale, { state: text((await read($, routing)) ? "ui.status.on" : "ui.status.offBaseline", locale) }),
    text("ui.status.providerLine", locale, { provider: PROVIDERS[config.provider].label, url: config.url }),
    text("ui.status.modelLine", locale, { model: config.jevModel, confidence: formatNumber(config.minConfidence, locale, 2), timeout: formatNumber(config.timeoutMs, locale) }),
    text("ui.status.keySourceLine", locale, { source: text(`source.${config.keySource}` as LocaleKey, locale) }),
    text("ui.status.featuresLine", locale, { features: featureFlagsText(await read($, features), locale) }),
    text("ui.status.requestsLine", locale, { count: formatNumber(list.length, locale), kept: formatNumber(KEPT_EVENTS, locale) }),
    flowSummary(await readTrace($), locale),
  ].join("\n");
}

/** Keep short invalid inputs fully masked and reveal only the last four characters of longer keys. */
const maskKey = (key: string) => (key.length > 4 ? "•".repeat(key.length - 4) + key.slice(-4) : "•".repeat(key.length));

/**
 * The key field changed. It is drawn masked, so what comes back is the mask plus what was typed
 * or pasted at its end, or the mask cut short by backspace; the real key is rebuilt from that.
 */
function applyTyped(value: string): void {
  const shown = maskKey(draftKey);
  if (value.startsWith(shown)) draftKey += value.slice(shown.length);
  else if (shown.startsWith(value)) draftKey = draftKey.slice(0, [...value].length);
  else if (!value.includes("•")) draftKey = value;
  draftKey = draftKey.replace(/\s+/g, "");
}

async function typeKey($: EngineInterface, value: string): Promise<void> {
  applyTyped(value);
  await update($, setup, (d) => ({ ...d, typed: maskKey(draftKey), message: "" }));
}

/**
 * The `/config` row of one of this plugin's options, as `$.config` names it: `<plugin>.<field>` or
 * `<plugin>@<marketplace>.<field>`, owned by this plugin. Rows name a plugin, not its marketplace,
 * so when two installed plugins share this name the row is ambiguous and nothing is written.
 */
async function optionRow($: EngineInterface, field: string): Promise<string | undefined> {
  try {
    const name = $.plugin.name;
    const rows = (await $.config.list()).filter((row) => {
      const prefix = row.key.slice(0, -(field.length + 1));
      if (row.key !== `${prefix}.${field}` || (prefix !== name && !prefix.startsWith(`${name}@`))) return false;
      const owner = (row.provider as { plugin?: string } | undefined)?.plugin;
      return owner === undefined || owner === name || owner === prefix;
    });
    return rows.length === 1 ? rows[0]!.key : undefined;
  } catch {
    return undefined;
  }
}

/** Sensitive options have no /config row; the CLI saves them through Claude Code's secure storage. */
async function saveKey($: EngineInterface, key: string): Promise<string | undefined> {
  const config = await getSettings($);
  const row = await optionRow($, "provider");
  if (!row) return text("ui.setup.noSecureOption", config.locale, { env: PROVIDERS[config.provider].keyEnv });
  try {
    const result = await $.process.run(
      ["claude", "--plugin-dir", $.plugin.root, "plugin", "configure", row.slice(0, -".provider".length), "--values-stdin", "--json"],
      { stdin: JSON.stringify({ api_key: key }), timeoutMs: 15_000 },
    );
    if (result.exitCode !== 0) return redact(result.stderr || result.stdout, key) || text("ui.setup.saveNotConfirmed", config.locale);
    const saved = JSON.parse(result.stdout) as { saved?: string[]; unconfigured?: string[] };
    if (!saved.saved?.includes("api_key") || (key ? saved.unconfigured?.includes("api_key") : !saved.unconfigured?.includes("api_key"))) return text("ui.setup.saveNotConfirmed", config.locale);
    options = { ...options, api_key: key };
    settings = undefined;
    return undefined;
  } catch (error) {
    return redact(error instanceof Error ? error.message : String(error), key);
  }
}

async function setLocale($: EngineInterface, locale: LocaleOption): Promise<void> {
  const current = await getSettings($);
  try {
    await $.store.set(STORE_LOCALE, locale);
    options = { ...options, locale };
    settings = undefined;
    const updated = await getSettings($);
    await update($, setup, (draft) => ({ ...draft, message: text("ui.setup.languageSaved", updated.locale), isOk: true }));
    $.ui.invalidate("ui.render");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await update($, setup, (draft) => ({ ...draft, message: text("ui.setup.languageSaveFailed", current.locale, { message }), isOk: false }));
  }
}

/** Removes the saved key: the option, and this session's copy. The environment's stays. */
async function forgetKey($: EngineInterface): Promise<void> {
  draftKey = "";
  sessionKey = "";
  sessionProvider = undefined;
  await $.store.delete(STORE_CREDENTIALS).catch(() => undefined);
  const refused = await saveKey($, "");
  settings = undefined;
  const config = await getSettings($);
  await update($, setup, (d) => ({
    ...d,
    typed: "",
    isOk: !refused,
    message: refused
      ? text("ui.setup.removeFailed", config.locale, { reason: refused })
      : config.apiKey
        ? text("ui.setup.savedKeyRemoved", config.locale, { source: text(`source.${config.keySource}`, config.locale) })
        : text("ui.setup.removedNoKey", config.locale),
  }));
}

/**
 * Saves Setup's provider as the plugin's provider option. When Claude Code refuses, a store copy
 * stands in, tied to the option and JEV_PROVIDER as they are now, so a later change to either wins.
 */
async function saveProvider($: EngineInterface, id: ProviderId): Promise<boolean> {
  const row = await optionRow($, "provider");
  const result = row ? await $.config.set({ key: row, value: id }).catch(() => undefined) : undefined;
  if (result && !result.deny) {
    options = { ...options, provider: id };
    await $.store.delete(STORE_PROVIDER).catch(() => undefined);
    return true;
  }
  const basis = providerBasis(options, await processEnv($));
  return $.store.set(STORE_PROVIDER, { provider: id, basis }).then(
    () => true,
    () => false,
  );
}

/** Puts back the provider choice saveProvider replaced; this session keeps its own pair. */
async function restoreProvider($: EngineInterface, before: string | undefined, stored: unknown): Promise<void> {
  const row = await optionRow($, "provider");
  if (row) await $.config.set({ key: row, value: before ?? "auto" }).catch(() => undefined);
  options = { ...options, provider: before };
  if (stored === undefined) await $.store.delete(STORE_PROVIDER).catch(() => undefined);
  else await $.store.set(STORE_PROVIDER, stored).catch(() => undefined);
  settings = undefined;
}

async function checkSetup($: EngineInterface): Promise<void> {
  const draft = await read($, setup);
  if (draftKey) return submitKey($, draft.provider);
  const current = await getSettings($);
  const locale = current.locale;
  const id = isProvider(draft.provider) ? draft.provider : current.provider;
  // The plugin's key goes only to the provider it is configured for; another provider is
  // tested with its own environment key, and is selected only if that leaves the key paired.
  const env = await processEnv($);
  const stored = await storedSettings($, env);
  const owner = keyOwner(pluginOptions(), env, stored);
  const { apiKey } = keyFor(id, pluginOptions(), env, stored);
  const names = { provider: PROVIDERS[id].label, owner: PROVIDERS[owner].label, env: PROVIDERS[id].keyEnv };
  if (!apiKey) {
    await update($, setup, (d) => ({
      ...d,
      provider: id,
      message: pluginOptions().api_key?.trim() ? text("ui.setup.keyForOther", locale, names) : text("ui.setup.envHelp", locale, { env: names.env }),
      isOk: false,
    }));
    return;
  }
  const selects = id === current.provider || resolveSettings({ ...pluginOptions(), provider: id }, env).apiKey === apiKey;
  if (id !== current.provider && selects && !(await saveProvider($, id))) {
    await update($, setup, (d) => ({ ...d, message: text("ui.setup.providerSaveFailed", locale), isOk: false }));
    return;
  }
  settings = undefined;
  await update($, setup, (d) => ({ ...d, provider: id, message: text("ui.setup.checking", locale, { provider: names.provider }), isOk: true }));
  const check = await validateKey(id, apiKey, transport($, locale), resolveModel(id, options.model?.trim()), locale, jevReporter($, locale, () => ({ origin: "setup" })));
  if (!check.ok) {
    const message = check.refused
      ? text("ui.setup.refused", locale, { provider: names.provider, message: check.message })
      : text("ui.setup.couldNotCheck", locale, { message: check.message });
    await update($, setup, (d) => ({ ...d, message, isOk: false }));
    return;
  }
  const ms = formatNumber(check.ms, locale);
  await update($, setup, (d) => ({
    ...d,
    isOk: true,
    message: selects ? text("ui.setup.success", locale, { provider: names.provider, ms }) : text("ui.setup.otherKeyWorks", locale, { ...names, ms }),
  }));
}

/** Tests the typed key with the chosen provider; a key that works is saved and used at once. */
async function submitKey($: EngineInterface, provider: string): Promise<void> {
  const key = draftKey.trim();
  const current = await getSettings($);
  const locale = current.locale;
  const id = isProvider(provider) ? provider : current.provider;
  if (!key) {
    await update($, setup, (d) => ({ ...d, message: text("ui.setup.enterKey", locale), isOk: false }));
    return;
  }
  await update($, setup, (d) => ({ ...d, provider: id, busy: true, isOk: true, message: text("ui.setup.testing", locale, { provider: PROVIDERS[id].label }) }));
  const check = await validateKey(id, key, transport($, locale), resolveModel(id, options.model?.trim()), locale, jevReporter($, locale, () => ({ origin: "setup" })));
  if (!check.ok) {
    await update($, setup, (d) => ({
      ...d,
      busy: false,
      isOk: false,
      message: check.refused
        ? text("ui.setup.refusedKey", locale, { provider: PROVIDERS[id].label, message: check.message })
        : text("ui.setup.couldNotReach", locale, { provider: PROVIDERS[id].label, message: check.message }),
    }));
    return;
  }
  // The key is the chosen provider's: without that choice saved it would be paired with another.
  const providerBefore = options.provider;
  const storedBefore = await $.store.get(STORE_PROVIDER).catch(() => undefined);
  if (!(await saveProvider($, id))) {
    await update($, setup, (d) => ({ ...d, busy: false, isOk: false, message: text("ui.setup.providerSaveFailed", locale) }));
    return;
  }
  sessionKey = key;
  sessionProvider = id;
  draftKey = "";
  settings = undefined;
  // The store copy is what survives a restart; Claude Code's secure option is a bonus on top of it.
  const kept = await $.store.set(STORE_CREDENTIALS, { apiKey: key, provider: id }).then(
    () => true,
    () => false,
  );
  const refused = (await saveKey($, key)) && !kept ? "could not write the key" : undefined;
  // Saved together or not at all: the provider without its key would get the old key next session.
  if (refused) {
    await restoreProvider($, providerBefore, storedBefore);
    sessionKey = "";
    sessionProvider = undefined;
  }
  await update($, setup, (d) => ({
    ...d,
    busy: false,
    typed: "",
    isOk: true,
    message: refused
      ? text("ui.setup.keyWorksSaveRefused", locale, { ms: formatNumber(check.ms, locale), reason: refused })
      : text("ui.setup.savedKeySuccess", locale, { ms: formatNumber(check.ms, locale) }),
  }));
}

function actions($: EngineInterface, requestId = PANE): Actions {
  const resetScroll = () => $.ui.scroll({ in: requestId, to: "start" }).catch(() => undefined);
  return {
    layout: () => undefined,
    tab: async (which) => { await update($, tab, () => which); await resetScroll(); },
    range: (ms) => void update($, range, () => ms),
    routing: (enabled) => void setRouting($, enabled),
    feature: (id, enabled) => void setFeature($, id, enabled),
    preference: (key, value) => {
      if (key === "petHat") {
        petHatOverride = undefined;
        if (value === "random") sessionPetHat = randomPetHat();
      }
      void setFeaturePreference($, key, value);
    },
    provider: (id) => void update($, setup, (draft) => ({ ...draft, provider: id, message: "" })),
    locale: (value) => void setLocale($, value),
    clear: () => void clearHistory($),
    validate: () => void checkSetup($),
    typeKey: (value) => void typeKey($, value),
    submitKey: (value) => {
      // Enter carries the field as it stands: take it in first, then test.
      applyTyped(value);
      void read($, setup).then((draft) => submitKey($, draft.provider));
    },
    forgetKey: () => void forgetKey($),
    openAgent: (n) =>
      void read($, agents).then((list) => {
        const run = list.find((one) => one.n === n);
        if (run) return openAgentPane($, run);
      }),
    closeAgent: (n) => void $.ui.close({ id: `${AGENT_PANE}${n}` }),
    removeAgent: (n) => void removeRuns($, (run) => run.n === n),
    clearAgents: () => void removeRuns($, () => true),
    jevLive: () => void openPane($, "live"),
    orchestration: (line) => void runOrchestration($, line),
    orchestrationType: (value) => {
      orchestrationDraft = value;
      $.ui.invalidate("ui.render");
    },
    orchestrationSubmit: (line) => {
      orchestrationDraft = "";
      void runOrchestration($, line);
    },
    deck: (args) => void runDeckFromTab($, args),
    deckStyle: (surface, name) => void setDeckStyleFromTab($, surface, name),
    deckType: (value) => {
      deckDraft = value;
      redrawDeck($);
    },
    deckCity: (value) => {
      const query = value.trim();
      if (!query) return;
      // Enter carries the field as it stands, and it stays there: a city that is not found can be corrected
      deckDraft = value;
      void runDeckFromTab($, `city ${query}`);
    },
  };
}

/** The key a pane's scroll position is kept under: the Jev pane's per tab, a subagent pane's by its id. */
async function scrollKeyOf($: EngineInterface, requestId: string): Promise<string> {
  return requestId === PANE ? `${PANE}:${await read($, tab)}` : requestId;
}

async function view($: EngineInterface, width: number, rows: number, surface: string, scrollKey = ""): Promise<View> {
  const config = await getSettings($);
  const currentTab = await read($, tab);
  const normalized = normalizeTab(currentTab);
  if (normalized !== currentTab) await update($, tab, () => normalized);
  return {
    locale: config.locale,
    localeOption: config.localeOption,
    scroll: scrollKey ? ((await read($, scroll))[scrollKey] ?? 0) : 0,
    // The host needs the full tree to measure and scroll the pane on both surfaces.
    fixed: false,
    events: await read($, events),
    routing: await read($, routing),
    tab: normalized,
    range: await read($, range),
    setup: await read($, setup),
    features: await read($, features),
    preferences: await read($, featurePreferences),
    feed: await read($, feed),
    live: await read($, live),
    agents: await read($, agents),
    trace: await readTrace($),
    now: await $.clock.now(),
    width,
    rows,
    surface,
    meta: text("ui.meta", config.locale, { provider: PROVIDERS[config.provider].label, model: config.jevModel, confidence: formatNumber(config.minConfidence, config.locale, 2), source: text(`source.${config.keySource}`, config.locale) }),
    key: { source: config.keySource, tail: config.apiKey ? config.apiKey.slice(-4) : "", provider: config.provider },
    deck: null,
    ...(normalized === "orchestration" ? { orchestration: await orchestrationView($) } : {}),
  };
}

/** Who acts in a loop, for the log: Claude on the main loop, the subagent's type in one. */
function actor(agentId: string | undefined): Speaker {
  if (!agentId) return "claude";
  const run = agentRuns.get(agentId);
  return { agent: run?.type ?? "agent", id: agentId, ...(run?.mascot ? { mascot: run.mascot } : {}) };
}

export const register: Register = (on, given) => {
  options = given as ModOptions;
  contextCompacting = false;
  const contextConfig = resolveContextConfig({
    goal: options.context_goal,
    compactAtPercent: options.context_compact_at_percent,
    minReductionRatio: options.context_min_reduction_ratio,
    keepThreshold: options.context_keep_threshold,
    preserveRecentMessages: options.context_preserve_recent_messages,
    maxStateTokens: options.context_max_state_tokens,
    maxRequestTokens: options.context_max_request_tokens,
    truncateHeadChars: options.context_truncate_head_chars,
  });
  mainModel = undefined;
  settings = undefined;
  draftKey = "";
  deckNote = null;
  deckDraft = "";
  orchestrationDraft = "";
  deckLanes.clear();
  deckPetLoop?.cancel();
  deckPetLoop = undefined;
  blitBroken = false;
  deckShownTerminalAt = deckShownDesktopAt = paneShownAt = rowsRedrawnAt = Number.NEGATIVE_INFINITY;
  sessionKey = "";
  sessionProvider = undefined;
  // The module unloading ended the follower: a reload names a channel of its own.
  siftChannel = undefined;
  siftChannelReady = undefined;
  siftFollowing = false;
  siftRuns.clear();
  siftSeen.clear();

  on("session.start", async ($, e, next) => {
    deckSessionId = await $.session.id();
    sessionId = deckSessionId.slice(0, 8);
    // The commands first: an unreadable store, or any step below that throws, must never hide /jev.
    const locale = (await getSettings($).catch(() => undefined))?.locale ?? localeFor();
    await $.command.register({
      name: "jev",
      description: text("ui.command.description", locale),
      argumentHint: text("ui.command.argumentHint", locale),
      immediate: true,
    });
    await $.command.register({
      name: "deck",
      description: text("deck.command.description", locale),
      argumentHint: text("deck.command.argumentHint", locale),
      immediate: true,
    });
    await $.command.register({ name: "pingo", description: "Change Pingo's hat, react, dance, hide, or show", argumentHint: "[hat <name|random>|hats|pet|dance|party|shades|hide|show]" });
    const config = await getSettings($);
    await restoreStoredState($);
    await orch.restore(orchIo($)).catch(() => undefined);
    await registerOrchestration($).catch(() => undefined);
    await registerFarol($);
    await clarezaStart($);
    await $.command.register({ name: "prisma-decisions", description: "List or clear remembered design choices", argumentHint: "[clear]" });
    await sementeStart($);
    await lapidaStart($);
    await registerSentinela($);
    await registerVigia($);
    mainModel = await $.session.model();
    await setLive($, { model: mainModel });
    const advisor = await advisorInfo($);
    await updateTrace($, (s) => setAdvisorInfo(s, advisor));
    // Deck's preferences, usage history and this session's spend: the store is read once, here.
    const now = await $.clock.now();
    const savedDeck = await $.store.get(STORE_DECK).catch(() => undefined);
    const savedSpend = await $.store.get(STORE_DECK_SPEND).catch(() => undefined);
    const savedHist = await $.store.get(STORE_DECK_HIST).catch(() => undefined);
    deck = createDeckState(now, deckSessionId, new Date(now));
    deckPet = createPet(now);
    sessionPetHat = randomPetHat();
    petHatOverride = undefined;
    petHatOverrideUntil = 0;
    await styledPet($, now);
    deck.spend = spendFrom(fieldOf(savedSpend, "spend"), new Date(now));
    deck.costSeen = costSeenFrom(savedSpend, deckSessionId);
    deck.hist = histFrom(savedHist, now);
    deck.sessionModel = mainModel ?? "";
    const deckConfig = parseSettings(savedDeck);
    await update($, deckSettings, () => deckConfig);
    await update($, deckExpanded, () => deckConfig.open);
    // The session's usage and the city's weather now, then the band's clock.
    await refreshUsage($);
    void refreshWeather($);
    startDeckClock($);
    // "Idle" and the 5-minute windows move with the clock, not only with events.
    $.clock.every(1000, async () => {
      const tick = await $.clock.now();
      if (tick - deckShownTerminalAt < ON_SCREEN_MS || tick - deckShownDesktopAt < ON_SCREEN_MS || tick - paneShownAt < ON_SCREEN_MS) {
        $.ui.invalidate("ui.render");
      }
    });
    return next(e);
  });

  on("prompt.compose", async ($, e, next) => {
    let result = await next(e);
    result = await farolCompose($, e, result);
    result = await clarezaCompose($, result);
    result = await sementeCompose($, e, result);
    return prismaCompose($, e, result);
  });

  on("classic.CwdChanged", async ($, e, next) => {
    const result = await next(e);
    await syncFarol($);
    const savedIdeas = await $.store.get(await sementeKey($));
    await update($, sementeIdeas, () => Array.isArray(savedIdeas) ? savedIdeas as SementeIdea[] : []);
    sementeTopics.clear();
    sementeShelvedThisTurn = new Set();
    await refreshSentinela($);
    if (await featureEnabled($, "vigia")) await saveVigia($);
    return result;
  }).catch(($, e, next) => next(e));

  on("prompt.attachment", async ($, e, next) => {
    const result = await next(e);
    const fromChisle = e.origin.kind === "hook" && result.text !== null && result.text.includes("CHISLE");
    return fromChisle && await featureEnabled($, "clareza") ? { text: null } : result;
  });

  on("classic.SessionStart", async ($, e, next) => {
    if (e.source === "clear" || e.source === "resume" || e.source === "fork") {
      await restoreStoredState($);
      mainModel = await $.session.model();
      await syncFarol($);
      const savedIdeas = await $.store.get(await sementeKey($));
      await update($, sementeIdeas, () => Array.isArray(savedIdeas) ? savedIdeas as SementeIdea[] : []);
      await update($, sementeNudges, () => []);
      sementeTopics.clear();
      sementeShelvedThisTurn = new Set();
      clarityLastAsk = "";
      await update($, clarezaGrade, () => null);
      await update($, clarezaRewrite, () => false);
      await update($, clarezaStatus, () => "");
      await update($, farolBusy, () => false);
      await update($, lapidaPhase, () => "idle");
      await update($, lapidaEnhanced, () => "");
      await update($, lapidaChanges, () => []);
      await update($, prismaPending, () => null);
      await update($, sentinelaReplyTo, () => "");
      const now = await $.clock.now();
      sentinelaMe = await $.session.id();
      await refreshSentinela($);
      deckSessionId = sentinelaMe;
      sessionId = deckSessionId.slice(0, 8);
      deckPet = createPet(now);
      sessionPetHat = randomPetHat();
      petHatOverride = undefined;
      petHatOverrideUntil = 0;
      await styledPet($, now);
      if (await featureEnabled($, "vigia")) await saveVigia($);
    }
    return next(e);
  }).catch((_$, e, next) => next(e));

  on("classic.PostModelSwitch", async ($, e, next) => {
    mainModel = e.to_model;
    // The user's own pick (/model, the picker) is a trusted override of the objective's executor.
    if (e.source === "command" || e.source === "picker") await orch.userSwitchedModel(orchIo($)).catch(() => undefined);
    deckOf(await $.clock.now()).sessionModel = e.to_model;
    await setLive($, { model: e.to_model });
    if (e.from_model !== e.to_model) {
      const locale = (await getSettings($)).locale;
      const requested = e.requested_model ?? text("feed.change.effortDefault", locale);
      await log($, "mod", "feature", "muted", text("feed.change.modelSwitched", locale, { from: modelName(e.from_model), to: modelName(e.to_model) }), undefined, {
        detail: `source=${e.source ?? "unknown"}\nrequested_model=${requested}`,
        minor: true,
      });
    }
    return next(e);
  }).catch((_$, e, next) => next(e));

  // Record prompt timing and whether the engine accepted it; Jev does not plan main turns.
  on("prompt.submit", async ($, e, next) => {
    const enriched = await clarezaPromptSubmit($, e);
    await lapidaPromptSubmit($, enriched);
    await vigiaPromptSubmit($, enriched);
    const submittedAt = await $.clock.now();
    promptSubmitted(deckOf(submittedAt), enriched.text, submittedAt);
    let messageId = "";
    await updateTrace($, (s) => {
      const [nextState, id] = submitPrompt(s, { text: enriched.text, at: submittedAt, origin: e.origin.kind, ...(e.turnId ? { during: e.turnId } : {}) });
      messageId = id;
      return nextState;
    });
    // Once it entered (the turn it started has fired turn.start meanwhile) or was refused.
    const entered = async (result: Awaited<ReturnType<typeof next>>) => {
      const dropped = "drop" in result && typeof result.drop === "string" ? result.drop : undefined;
      // Past `next`, nothing may throw: the guard below would submit the prompt again.
      await updateTrace($, (s) => promptEntered(s, messageId, dropped)).catch(() => undefined);
      return result;
    };
    // Orchestration's objective decision and any notes ride along as context; it never blocks the prompt.
    const orchestration = await orch.onPromptSubmit({
      ...orchIo($),
      // The advisor's decision and outcome for this message, for the Flow tab.
      noteAdvice: async (change) => {
        await updateTrace($, (s) => noteAdvice(s, messageId, change)).catch(() => undefined);
      },
    }, enriched).catch(() => [] as string[]);
    return entered(await next(orchestration.length ? { ...enriched, context: [...(enriched.context ?? []), ...orchestration] } : enriched));
  }).catch((_$, e, next) => next(e));

  on("turn.start", async ($, e, next) => {
    const locale = (await getSettings($)).locale;
    if (e.text.trim()) await log($, "you", "turn", "info", short(e.text, 600));
    else await log($, "you", "turn", "muted", text("feed.request.continues", locale), undefined, { minor: true });
    await setLive($, { activity: text("feed.activity.waiting", locale) });
    // The run opens here, tied to the idle message whose submission is still entering, if any.
    const at = await $.clock.now();
    await updateTrace($, (s) => startTurn(s, e.turnId, e.text, at));
    turnStarted(deckOf(at), e.text, at, locale);
    redrawDeck($);
    await farolTurnStarted($);
    await clarezaTurnStarted($, e);
    await sementeTurnStarted($, e);
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const locale = (await getSettings($)).locale;
    // A subagent's end starts its mandatory review (or advances its batch unit) in the background.
    if (e.agentId) void orch.onAgentDone(orchIo($), e.agentId, e.answer, e.reason === "answer" && !e.isAborted).catch(() => undefined);
    // Deck first: a subagent's turn ends its row, and a main turn ends its activity line.
    const deckNow = await $.clock.now();
    const deckState = deckOf(deckNow);
    if (e.agentId && deckState.agents.has(e.agentId)) {
      finishAgent(deckState, e.agentId, e.isAborted ? "stopped" : e.reason === "answer" ? "done" : "failed", deckNow, locale);
      redrawDeck($);
    }
    if (!e.agentId) turnEnded(deckState, deckNow);
    const seconds = formatDuration(e.durationMs, locale);
    const usage = e.usage;
    const inputComplete = typeof usage?.input_tokens === "number"
      && typeof usage.cache_read_input_tokens === "number"
      && typeof usage.cache_creation_input_tokens === "number";
    const outputKnown = typeof usage?.output_tokens === "number";
    const cache = usage ? [
      typeof usage.cache_read_input_tokens === "number"
        ? text("ui.models.cacheReadTokens", locale, { value: formatCompact(usage.cache_read_input_tokens, locale) })
        : "",
      typeof usage.cache_creation_input_tokens === "number"
        ? text("ui.models.cacheWriteTokens", locale, { value: formatCompact(usage.cache_creation_input_tokens, locale) })
        : "",
    ].filter(Boolean).join(text("feed.usage.separator", locale)) : "";
    const tokens = usage && (inputComplete || outputKnown)
      ? text("feed.usage.tokens", locale, {
          input: inputComplete ? formatCompact(totalInput(usage), locale) : "–",
          output: outputKnown ? formatCompact(usage.output_tokens, locale) : "–",
          cache: cache ? ` · ${cache}` : "",
        })
      : "";
    if (e.agentId) {
      const id = e.agentId;
      const state = e.isAborted ? "aborted" : e.reason === "error" ? "error" : "done";
      await log($, actor(id), "agent", state === "done" ? "good" : "bad", text("feed.turn.agentState", locale, { state: text(`feed.turn.state.${state}`, locale), answer: e.answer?.trim() ? text("feed.turn.answer", locale, { text: short(e.answer, 160) }) : "" }), undefined, {
        meta: seconds,
        detail: `${tokens || text("feed.turn.noUsage", locale)}${e.reason && e.reason !== "answer" ? text("feed.turn.endedBy", locale, { reason: ["error", "refusal", "aborted"].includes(e.reason) ? text(`feed.turn.reason.${e.reason}` as LocaleKey, locale) : e.reason }) : ""}`,
      });
      const endedAt = await $.clock.now();
      await updateTrace($, (s) => completeTurn(s, e.turnId, endedAt, e.isAborted ? "aborted" : e.reason, id, e.answer));
      await updateRun($, id, (one) => {
        const { activity: _activity, ...rest } = one;
        return {
          ...rest,
          state: e.isAborted ? "aborted" : e.reason === "error" ? "error" : "done",
          endedAt,
          ...(e.answer?.trim() ? { text: short(e.answer, 2000) } : {}),
        };
      });
      // A teammate's turn ending is not its end: keep its type, mascot and Jev's effort for its
      // next wake-up. Idle teammates are not counted as running.
      const mate = agentRuns.get(id);
      if (mate?.teammate) mate.awake = false;
      else agentRuns.delete(id);
      const running = [...agentRuns.values()].filter((run) => !run.teammate || run.awake).length;
      await setLive($, { activity: running ? text("feed.activity.agentCount", locale, { count: formatNumber(running, locale), unit: text(running === 1 ? "unit.agent" : "unit.agents", locale) }) : text("feed.activity.waiting", locale) });
      await compactContextAfterTurn($, contextConfig);
      return next(e);
    }
    const state = e.isAborted ? "aborted" : e.reason === "error" ? "failed" : e.reason === "refusal" ? "refused" : "completed";
    const troubled = e.isAborted || e.reason !== "answer";
    await log($, "mod", "turn", troubled ? "warn" : "muted", text("feed.turn.ended", locale, { state: text(`feed.turn.state.${state}`, locale) }), undefined, {
      meta: seconds,
      ...(tokens ? { detail: tokens } : {}),
      minor: !troubled,
    });
    await setLive($, { activity: undefined });
    const endedAt = await $.clock.now();
    await updateTrace($, (s) => completeTurn(s, e.turnId, endedAt, e.isAborted ? "aborted" : e.reason, undefined, e.answer));
    await farolTurnCompleted($, e.agentId);
    await clarezaTurnCompleted($, e);
    await sementeTurnCompleted($, e);
    await vigiaTurnCompleted($, e);
    await compactContextAfterTurn($, contextConfig);
    return next(e);
  });

  // Log every native tool call and its result; advice never interrupts the tool flow.
  on("tool.call", async ($, e, next) => {
    // Deck tracks every call, another plugin's own included; the Jev path below is Claude's calls only.
    const deckCall = await deckCallOpen($, e);
    // Another plugin's own call ($.tool.call) is no step of Claude's.
    if (!e.tool_use_id || next.origin.plugin !== "engine") return farolAfterTool($, await deckCallClose($, deckCall, next(e)));
    const locale = (await getSettings($)).locale;
    const input = e as unknown as Record<string, unknown>;
    const filePath = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : undefined;
    const trackedEdit = ["Edit", "Write", "NotebookEdit"].includes(e.tool) && filePath ? filePath : undefined;
    const clashNote = !e.agentId && trackedEdit ? await vigiaTrackFile($, trackedEdit).catch(() => undefined) : undefined;
    const who = actor(e.agentId);
    const summary = toolSummary(e.tool, e as unknown as Record<string, unknown>);
    const startedAt = await $.clock.now();
    toolStarts.set(e.tool_use_id, startedAt);
    const toolUseId = e.tool_use_id;
    // Sift's Jev calls happen in the shell this command starts: follow them in before it runs.
    const sift = e.tool === "Bash" && SIFT_COMMAND.test(String((e as unknown as Record<string, unknown>).command ?? ""));
    if (sift) {
      siftRuns.set(toolUseId, e.agentId);
      await followSift($).catch((error) => logSiftFailure($, locale, error));
    }
    await updateTrace($, (s) => toolStart(s, { id: toolUseId, ...(e.agentId ? { agentId: e.agentId } : {}), name: e.tool, at: startedAt }));
    // One line per call: written as it starts, rewritten with its outcome when it ends.
    const toolDetail = toolDetails(e.tool, input, locale);
    const line = await log($, who, "tool", "info", `▸ ${summary}`, e.agentId, { meta: text("feed.tool.running", locale), ...(toolDetail ? { detail: toolDetail } : {}) });
    if (!e.agentId) await setLive($, { activity: text("feed.activity.running", locale, { activity: short(summary, 40) }) });
    else await updateRun($, e.agentId, (run) => ({ ...run, tools: run.tools + 1, activity: text("feed.activity.agentTool", locale, { activity: short(summary, 60) }) }));
    // The follower reads the channel every 100 ms: the command's last calls still count where it ran.
    const result = await deckCallClose($, deckCall, next(e).finally(() => {
      if (sift) $.clock.after(1000, () => siftRuns.delete(toolUseId));
    }));
    if (trackedEdit) sementeFileEdited(trackedEdit, result.deny === undefined && !result.isError);
    if (trackedEdit && result.deny === undefined && !result.isError) orch.noteEdit(e.agentId, trackedEdit);
    // A subagent's mandatory review verdict reaches its parent with the Agent tool's result.
    const reviewNote = e.tool === "Agent" && result.deny === undefined
      ? await orch.agentToolNote(orchIo($), e.tool_use_id, resultText(result.result)).catch(() => undefined)
      : undefined;
    const contextNotes = [clashNote, reviewNote].filter((note): note is string => Boolean(note));
    const finalResult = await farolAfterTool($, result.deny === undefined && contextNotes.length ? { ...result, context: [...(result.context ?? []), ...contextNotes] } : result);
    // Reporting or routing may fail after a tool ran; return its result rather than run it again.
    try {
      const endedAt = await $.clock.now();
      const took = formatDuration(endedAt - (toolStarts.get(e.tool_use_id) ?? 0), locale);
      toolStarts.delete(e.tool_use_id);
      const ending = result.deny !== undefined ? "denied" : result.isError ? "error" : "ok";
      const file = editedFile(e as unknown as Record<string, unknown>);
      // Past `next`, the record must not throw: the guard would run the call again.
      await updateTrace($, (s) =>
        toolEnd(s, { id: toolUseId, ...(e.agentId ? { agentId: e.agentId } : {}), at: endedAt, result: ending, edit: EDIT_TOOLS.has(e.tool), ...(file ? { file } : {}) }),
      ).catch(() => undefined);
      if (result.deny !== undefined) {
        await patch($, line, { text: `⊘ ${summary}`, tone: "warn", meta: text("feed.tool.deniedLabel", locale), detail: [toolDetail, text("feed.tool.denied", locale, { message: short(result.deny, 160) })].filter(Boolean).join("\n") });
      } else {
        const outcome = result.isError ? text("feed.tool.error", locale, { message: short(String(result.text ?? ""), 160) }) : outputSize(resultText(result.result), locale);
        await patch($, line, {
          text: `${result.isError ? "✗" : GLYPH.ok} ${summary}`,
          tone: result.isError ? "bad" : "good",
          meta: took,
          detail: [toolDetail, outcome].filter(Boolean).join(" → "),
        });
      }
      if (e.agentId) await updateRun($, e.agentId, (run) => ({ ...run, activity: text("feed.activity.waiting", locale) }));
      if (!e.agentId) await setLive($, { activity: text("feed.activity.waiting", locale) });
      return finalResult;
    } catch {
      return finalResult;
    }
  }).catch((_$, e, next) => next(e));

  on("tool.call", { tool: "TodoWrite" }, async ($, e, next) => {
    if (e.agentId === undefined && await featureEnabled($, "vigia")) await saveVigia($, (record) => { record.tasks = e.todos.map((todo, i) => ({ id: `todo-${i}`, text: todo.content, status: todo.status })); });
    return next(e);
  }).catch(($, e, next) => next(e));

  on("tool.call", { tool: "TaskCreate" }, async ($, e, next) => {
    const result = await next(e);
    const task = (result.result as { task?: { id: string; subject: string } } | undefined)?.task;
    if (e.agentId === undefined && task && await featureEnabled($, "vigia")) await saveVigia($, (record) => record.tasks.push({ id: task.id, text: task.subject, status: "pending" }));
    return result;
  }).catch(($, e, next) => next(e));

  on("tool.call", { tool: "TaskUpdate" }, async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined && await featureEnabled($, "vigia") && (result.result as { success?: boolean } | undefined)?.success) await saveVigia($, (record) => {
      record.tasks = record.tasks.filter((task) => !(task.id === e.taskId && e.status === "deleted")).map((task) => task.id === e.taskId ? { ...task, text: e.subject ?? task.text, status: e.status && e.status !== "deleted" ? e.status : task.status } : task);
    });
    return result;
  }).catch(($, e, next) => next(e));

  // Subagents: Jev picks the model and effort, unless Claude asked for a model itself.
  on("agent.spawn", async ($, e, next) => {
    if (e.workflow) {
      // Not planned and not on the Agents tab, but still a subagent of the run.
      const result = await next(e);
      await deckSpawnStarted($, e, result, (await getSettings($)).locale);
      if (result.deny === undefined) await traceSpawn($, e, result.agentId ?? e.tool_use_id, result.model).catch(() => undefined);
      return result;
    }
    const config = await getSettings($);
    const ctx = await activeFeatures($, config);
    // Orchestration, when on, replaces the older per-subagent planner for this spawn.
    const orchestrated = await asking($, () => orch.planSpawn(orchIo($), e)).catch(() => undefined);
    const proposed =
      !orchestrated && !featureGate(ctx, "agents") && !e.fork && !e.model
        ? await asking($, () => planAgent(e, config, tracedAskJev($, config, { origin: "agent", trigger: e.subagentType, ...(e.parentAgentId ? { agentId: e.parentAgentId } : {}) }), ctx.features, undefined, modelContext(config)))
        : {};
    const current = await activeFeatures($, config);
    const plan = orchestrated || featureGate(current, "agents") ? {} : proposed;
    const result = await next(orchestrated?.model ? { ...e, model: orchestrated.model } : plan.model ? { ...e, model: plan.model.value } : e);
    orch.spawned(e.tool_use_id, result.deny === undefined ? result.agentId ?? e.tool_use_id : undefined);
    await deckSpawnStarted($, e, result, config.locale);
    if (result.deny !== undefined) {
      await log($, "claude", "agent", "warn", text("feed.subagent.denied", config.locale, { type: e.subagentType, message: short(result.deny, 80) }));
      return result;
    }
    const id = result.agentId ?? e.tool_use_id;
    const wantedEffort = orchestrated ? (orchestrated.effort ? { value: orchestrated.effort, confidence: 1 } : undefined) : plan.effort;
    const sized = sizeRequest({ model: result.model }, { effort: wantedEffort?.value }, { effort: orchestrated ? true : !featureGate(current, "agents") });
    const appliedEffort = sized.effortOutcome?.kind === "applied" ? wantedEffort : undefined;
    const ignoredEffort = sized.effortOutcome?.kind === "ignored" ? wantedEffort : undefined;
    agentRuns.set(id, { type: e.subagentType, model: result.model, ...(appliedEffort ? { effort: appliedEffort.value } : {}), description: e.description, ...(e.isTeammate ? { teammate: true as const, awake: true } : {}), ...(orchestrated ? { orchestrated: true as const } : {}) });
    const chosen = [
      plan.model
        ? text("feed.subagent.jevModel", config.locale, { model: plan.model.value, confidence: formatDecimal(plan.model.confidence, config.locale) })
        : text("feed.subagent.model", config.locale, { model: modelName(result.model) }) + (e.model && !orchestrated?.model ? text("feed.subagent.requested", config.locale) : ""),
      appliedEffort ? text("feed.subagent.jevEffort", config.locale, { effort: appliedEffort.value }) : undefined,
    ].filter(Boolean);
    const jevChose = orchestrated?.model
      ? `${MODEL_LABEL[orchestrated.model as keyof typeof MODEL_LABEL] ?? orchestrated.model}${appliedEffort ? ` ${appliedEffort.value}` : ""}`
      : [plan.model ? text("feed.subagent.model", config.locale, { model: plan.model.value }) : "", appliedEffort ? text("feed.subagent.effort", config.locale, { effort: appliedEffort.value }) : ""].filter(Boolean).join(text("feed.usage.separator", config.locale));
    const run = await addRun($, {
      id,
      type: e.subagentType,
      description: e.description,
      prompt: short(e.prompt, 1200),
      model: result.model,
      ...(appliedEffort ? { effort: appliedEffort.value } : {}),
      ...(jevChose ? { jev: jevChose } : {}),
      startedAt: await $.clock.now(),
      state: "running",
      tools: 0,
      requests: 0,
      activity: text("feed.activity.starting", config.locale),
    });
    if (plan.error) await log($, "jev", "jev", "bad", text("feed.subagent.failedModel", config.locale, { type: e.subagentType, message: short(plan.error, 80) }), id);
    else if (plan.latencyMs !== undefined) await log($, "jev", "jev", "good", text("feed.subagent.chose", config.locale, { type: e.subagentType, choice: jevChose || text("feed.subagent.nothingConfident", config.locale) }), id, { meta: `${formatNumber(plan.latencyMs, config.locale)} ms` });
    if (ignoredEffort) await log($, "mod", "feature", "warn", text("feed.subagent.ignoredEffort", config.locale, { effort: ignoredEffort.value, model: modelName(result.model) }), id);
    if (isMascot(run.mascot)) agentRuns.get(id)!.mascot = run.mascot;
    await traceSpawn($, e, id, result.model).catch(() => undefined);
    await log($, actor(id), "agent", "info", text("feed.subagent.started", config.locale, { type: e.subagentType, number: formatNumber(run.n, config.locale), description: short(e.description, 80) }), undefined, {
      meta: `/jev agent ${run.n}`,
      detail: `${chosen.join(text("feed.usage.separator", config.locale))} · ${text("feed.subagent.task", config.locale, { prompt: short(e.prompt, 220) })}`,
    });
    await setLive($, { activity: text("ui.band.agent", config.locale, { name: `${e.subagentType} (${modelName(result.model)})` }) });
    return result;
  }).catch((_$, e, next) => next(e));

  // Each model request: apply Jev's model and effort, then meter it.
  on("turn.step", async function* ($, e, next) {
    // Deck's route row starts from the main loop's first request as Claude sent it, before Jev sizes it.
    if (!e.agentId && e.index === 0) deckOf(await $.clock.now()).seen = { model: e.model, effort: typeof e.effort === "string" ? e.effort : "" };
    const config = await getSettings($);
    const locale = config.locale;
    const startedAt = await $.clock.now();
    const run = e.agentId ? agentRuns.get(e.agentId) : undefined;
    const current = e.agentId ? await activeFeatures($, config) : undefined;
    // The active objective's executor profile, when orchestration is on; the main loop stays native otherwise.
    const executor = e.agentId ? undefined : await orch.mainProfile(orchIo($)).catch(() => undefined);
    const planned = executor ? { ...e, model: executor.model, effort: executor.effort } : e;
    const sized = executor
      ? sizeRequest(planned, { effort: executor.effort }, { effort: true })
      : sizeRequest(e, e.agentId ? { effort: run?.effort } : {}, { effort: run?.orchestrated ? true : current ? !featureGate(current, "agents") : false });
    const sent = sized.request;
    const model = sent.model;
    const effort = sent.effort;
    const changes: string[] = [];
    const reason = e.agentId ? "subagent" : executor ? "orchestrated" : await read($, routing) ? "not_asked" : "routing_disabled";
    if (model !== e.model) changes.push(text("feed.change.modelSwitched", locale, { from: modelName(e.model), to: modelName(model) }));
    if (sized.ignoredEffort !== undefined) changes.push(text("feed.change.ignoredEffort", locale, { effort: String(sized.ignoredEffort), model: modelName(model) }));
    else if (effort !== e.effort && effort !== undefined) changes.push(text("feed.change.effortSwitched", locale, { from: e.effort ?? text("feed.change.effortDefault", locale), to: effort }));
    const who = actor(e.agentId);
    const effortText = effort === undefined ? "" : text("feed.request.effort", locale, { effort });
    const loop = typeof who === "string" ? "" : text("feed.request.loop", locale, { agent: who.agent });
    if (changes.length) await log($, "jev", "step", "warn", text("feed.change.request", locale, { number: formatNumber(e.index + 1, locale), loop, changes: changes.join(text("feed.change.separator", locale)) }), e.agentId);
    // Bookkeeping: drawn faint, filled in with its tokens and time once the model answers.
    const requestLine = await log($, "mod", "step", "muted", text("feed.request.line", locale, { number: formatNumber(e.index + 1, locale), loop, model: modelName(model), effort: effortText }), e.agentId, { minor: true, meta: "…" });
    if (e.agentId) {
      // A teammate waking up runs again: its earlier turn marked it done.
      const mate = agentRuns.get(e.agentId);
      if (mate?.teammate && !mate.awake) await wakeRun($, e.agentId, mate, locale);
      await updateRun($, e.agentId, (run) => ({ ...run, model, requests: run.requests + 1, activity: text("feed.activity.responding", locale) }));
    }
    if (!e.agentId) {
      await setLive($, {
        model,
        effort: effort === undefined ? undefined : String(effort),
        activity: text("feed.activity.responding", locale),
      });
    }
    await updateTrace($, (s) =>
      stepStart(s, {
        turnId: e.turnId,
        ...(e.agentId ? { agentId: e.agentId } : {}),
        index: e.index,
        original: e.model,
        sent: sent.model,
        ...(sent.effort === undefined ? {} : { effort: String(sent.effort) }),
        route: reason,
        at: startedAt,
      }),
    );
    const result = yield* next(sent);
    const answeredAt = await $.clock.now();
    const usage = result.usage;
    const inputComplete = typeof usage?.input_tokens === "number"
      && typeof usage.cache_read_input_tokens === "number"
      && typeof usage.cache_creation_input_tokens === "number";
    const outputKnown = typeof usage?.output_tokens === "number";
    const hasUsage = Boolean(usage && (
      typeof usage.input_tokens === "number" || outputKnown
      || typeof usage.cache_read_input_tokens === "number" || typeof usage.cache_creation_input_tokens === "number"
    ));
    const traceUsage = usage && hasUsage ? {
      ...(typeof usage.input_tokens === "number" ? { input: usage.input_tokens } : {}),
      ...(outputKnown ? { output: usage.output_tokens } : {}),
      ...(typeof usage.cache_read_input_tokens === "number" ? { cacheRead: usage.cache_read_input_tokens } : {}),
      ...(typeof usage.cache_creation_input_tokens === "number" ? { cacheWrite: usage.cache_creation_input_tokens } : {}),
    } : undefined;
    const tokens = usage && inputComplete && outputKnown
      ? { input: totalInput(usage), output: usage.output_tokens }
      : undefined;
    await updateTrace($, (s) =>
      stepEnd(s, {
        turnId: e.turnId,
        ...(e.agentId ? { agentId: e.agentId } : {}),
        index: e.index,
        at: answeredAt,
        ...(result.usage?.model ? { observed: result.usage.model } : {}),
        stop: result.stopReason,
        ...(traceUsage ? { usage: traceUsage } : {}),
        ...(tokens ? { tokens } : {}),
        ...(result.serverToolUses ? { serverToolUses: result.serverToolUses.map(({ id, name, startedAt: from, endedAt: to }) => ({ id, name, startedAt: from, ...(to === undefined ? {} : { endedAt: to }) })) } : {}),
      }),
    );
    if (result.answer.trim()) {
      await log($, who, "message", "info", `“${short(result.answer, 320)}”`, e.agentId);
    }
    if (!e.agentId && usage) {
      mainModel = usage.model ?? model;
    }
    if (executor) await orch.noteApplied(orchIo($), { model, ...(effort === undefined ? {} : { effort: String(effort) }) }, usage?.model).catch(() => undefined);
    const asked = [...new Set(result.toolUses.map((use) => use.name))];
    const inputText = typeof usage?.input_tokens === "number" ? formatCompact(usage.input_tokens, locale) : "–";
    const outputText = typeof usage?.output_tokens === "number" ? formatCompact(usage.output_tokens, locale) : "–";
    const cacheText = usage && inputComplete
      ? text("feed.usage.cache", locale, { percent: formatPercent(usage.cache_read_input_tokens as number, totalInput(usage), locale) })
      : "";
    await patch($, requestLine, {
      meta: formatDuration((await $.clock.now()) - startedAt, locale),
      detail: [
        hasUsage ? text("feed.usage.tokens", locale, { input: inputText, output: outputText, cache: cacheText }) : text("feed.turn.noUsage", locale),
        result.toolUses.length ? text("feed.usage.tools", locale, { count: formatNumber(result.toolUses.length, locale), unit: text(result.toolUses.length === 1 ? "unit.toolCall" : "unit.toolCalls", locale), tools: asked.join(", ") }) : result.stopReason ? text("feed.usage.stop", locale, { reason: result.stopReason }) : "",
      ]
        .filter(Boolean)
        .join(text("feed.usage.separator", locale)),
    });
    if (e.agentId) {
      await updateRun($, e.agentId, (run) => ({
        ...run,
        ...(usage && inputComplete ? {
          tokensIn: (run.tokensIn ?? 0) + totalInput(usage),
          inputUsageRequests: (run.inputUsageRequests ?? 0) + 1,
        } : {}),
        ...(usage && outputKnown ? {
          tokensOut: (run.tokensOut ?? 0) + usage.output_tokens,
          outputUsageRequests: (run.outputUsageRequests ?? 0) + 1,
        } : {}),
        ...(result.answer.trim() ? { text: short(result.answer, 2000) } : {}),
        ...(run.state === "running" && result.toolUses.length === 0 ? { activity: text("feed.activity.writing", locale) } : {}),
      }));
    }
    await record($, {
      time: new Date(startedAt).toISOString(),
      session: sessionId,
      model: usage?.model ?? model ?? null,
      mode: "passthrough",
      reason,
      durationMs: (await $.clock.now()) - startedAt,
      ...(e.agentId ? { agent: agentRuns.get(e.agentId)?.type ?? "agent" } : {}),
      ...(effort === undefined ? {} : { effort: String(effort) }),
      ...(changes.length ? { plan: changes.join(", ") } : {}),
      ...(hasUsage && usage
        ? {
            usage: {
              ...(typeof usage.input_tokens === "number" ? { input: usage.input_tokens } : {}),
              ...(typeof usage.output_tokens === "number" ? { output: usage.output_tokens } : {}),
              ...(typeof usage.cache_read_input_tokens === "number" ? { cached: usage.cache_read_input_tokens } : {}),
              ...(typeof usage.cache_creation_input_tokens === "number" ? { cacheWrite: usage.cache_creation_input_tokens } : {}),
            },
          }
        : {}),
    });
    if (!e.agentId && result.toolUses.length === 0) await setLive($, { activity: undefined });
    return result;
  });

  // /deck: the band above the prompt; the dashboard's Deck tab runs the same commands through runDeckCommand
  on("command.run", { command: "deck" }, ($, e) => runDeckCommand($, e.args));
  on("command.run", { command: "pingo" }, ($, e) => runPingoCommand($, e.args));
  on("command.run", { command: "farol" }, async ($) => { await $.ui.open({ id: "farol", title: "Farol", focus: true, closeOnEscape: true }); return {}; });
  on("command.run", { command: "clareza" }, async ($, e) => runClarezaCommand($, e.args));
  on("command.run", { command: "semente" }, async ($, e) => {
    const value = e.args.trim();
    if (!value) { await $.ui.open({ id: "semente", title: "Semente", focus: true, closeOnEscape: true }); return {}; }
    const id = await addSemente($, value);
    sementeShelvedThisTurn.add(id);
    return { text: (await getSettings($)).locale === "pt" ? `Ideia guardada: ${value}` : `Saved for later: ${value}` };
  });
  on("command.run", { command: "lapida" }, async ($, e) => {
    await enhanceLapida($, e.args);
    return { text: await read($, lapidaNote) || ((await getSettings($)).locale === "pt" ? "Prompt lapidado no campo. Revise e envie quando quiser." : "Enhanced prompt is in the prompt box. Review it, then send when ready.") };
  });
  on("command.run", { command: "prisma-decisions" }, async ($, e) => {
    const decisions = await readPrismaDecisions($);
    const pt = (await getSettings($)).locale === "pt";
    if (e.args.trim() === "clear") { await $.store.delete(await prismaDecisionKey($)); return { text: pt ? `${decisions.length} decisões Prisma removidas.` : `Cleared ${decisions.length} Prisma decisions.` }; }
    if (e.args.trim()) return { text: "Usage: /prisma-decisions [clear]" };
    return { text: decisions.length ? `${pt ? "Decisões Prisma" : "Prisma decisions"}:\n${decisions.map((item, i) => `${i + 1}. ${item.question} → ${item.choice}${item.description ? ` (${item.description})` : ""}`).join("\n")}` : (pt ? "Nenhuma decisão de design salva para este projeto." : "No design choices remembered for this project.") };
  });
  on("command.run", { command: "sentinela" }, async ($) => { await toggleSentinela($); return {}; });
  on("command.run", { command: "vigia" }, async ($) => { await refreshVigia($); await $.ui.open({ id: "vigia", title: "Vigia", focus: true, closeOnEscape: true }); return {}; });

  on("tool.call", { tool: "mcp__jev__farol_assumption" as never }, async ($, e) => {
    const pt = (await getSettings($)).locale === "pt";
    if (!(await featureEnabled($, "farol"))) return { deny: pt ? "Farol está desligado na Configuração do Jev." : "Farol is disabled in Jev Configuration." };
    const input = e as unknown as { assumption?: unknown; context?: unknown };
    const assumption = typeof input.assumption === "string" ? input.assumption.trim() : "";
    if (!assumption) return { deny: "assumption is required" };
    const context = typeof input.context === "string" && input.context.trim() ? input.context.trim() : undefined;
    let id = 0;
    await update($, farolSeq, (value) => (id = value + 1));
    const item: FarolAssumption = { id, text: assumption, ...(context ? { context } : {}), verdict: "open", sent: false };
    await update($, farolItems, (list) => [...list, item]);
    return { result: pt ? `Farol registrou a suposição #${id}. Continue trabalhando.` : `Farol recorded assumption #${id}. Continue working.` };
  }).catch(() => ({ deny: "Farol could not record that assumption." }));

  // The managed-batch tools are registered at session start; their names are not in the generated tool types yet.
  on("tool.call", { tool: "mcp__jev__managed_batch" as never }, async ($, e) => {
    const outcome: { result?: string; deny?: string } = await orch.submitBatch(orchIo($), e).catch(() => ({ deny: "The managed batch could not start; ordinary native fan-out does not provide its review guarantees." }));
    return (outcome.deny !== undefined ? { deny: outcome.deny } : { result: outcome.result ?? "" }) as never;
  }).catch(() => ({ deny: "Managed batch is unavailable." }) as never);
  on("tool.call", { tool: "mcp__jev__managed_batch_status" as never }, async ($, e) => ({ result: await orch.batchStatus(orchIo($), e as unknown as { batch?: unknown }) }) as never)
    .catch(() => ({ deny: "Managed batch status is unavailable." }) as never);

  // /batch's planning phase hands its units to the managed queue instead of fanning out itself.
  on("skill.prompt", { skill: "batch" }, async ($, e, next) => {
    const result = await next(e);
    return { text: await orch.batchSkillPrompt(orchIo($), result.text).catch(() => result.text) };
  }).catch((_$, e, next) => next(e));

  on("tool.call", { tool: "mcp__jev__semente_shelve" as never }, async ($, e) => {
    const pt = (await getSettings($)).locale === "pt";
    if (!(await featureEnabled($, "semente"))) return { deny: pt ? "Semente está desligada na Configuração do Jev." : "Semente is disabled in Jev Configuration." };
    const input = e as unknown as { text?: unknown };
    const value = typeof input.text === "string" ? input.text.trim() : "";
    if (!value) return { deny: "Semente needs a non-empty idea." };
    const id = await addSemente($, value, "claude");
    sementeShelvedThisTurn.add(id);
    $.ui.toast(pt ? `Claude guardou uma ideia: ${value}` : `Claude saved an idea: ${value}`);
    return { result: pt ? `Ideia guardada para depois: ${value}` : `Saved for later: ${value}` };
  }).catch(() => ({ deny: "Semente could not save that idea." }));

  on("tool.call", { tool: "AskUserQuestion" }, async ($, e, next) => {
    if (!(await featureEnabled($, "prisma")) || !e.questions.some((question) => question.options?.some((option) => prismaIsSvg(option.preview)))) return next(e);
    const preferences = await readFeaturePreferences($);
    const tmp = await $.env.get("TEMP") ?? await $.env.get("TMP") ?? await $.env.get("TMPDIR") ?? "/tmp";
    const id = String(e.tool_use_id ?? Math.random().toString(36).slice(2)).replace(/[^a-zA-Z0-9-]/g, "");
    const dir = `${tmp.replace(/[\\/]$/, "")}/jev-prisma/${id}`;
    const questions: PrismaQuestion[] = await Promise.all(e.questions.map(async (question, qi) => ({
      question: question.question, header: question.header, multiSelect: question.multiSelect,
      options: await Promise.all((question.options ?? []).map(async (option, oi) => {
        if (!prismaIsSvg(option.preview)) return { label: option.label, description: option.description };
        const svg = prismaSafeSvg(option.preview!);
        await $.fs.write(`${dir}/${qi}-${oi}.svg`, svg);
        return { label: option.label, description: option.description, svg, file: `${qi}-${oi}.svg` };
      })),
    })));
    const token = crypto.randomUUID();
    const pt = (await getSettings($)).locale === "pt";
    const gallery = `${dir}/index.html`;
    const answerFile = `${dir}/answer.json`;
    await $.fs.write(gallery, prismaGallery(questions, token, pt));
    await $.fs.write(`${dir}/serve.py`, PRISMA_SERVE_PY);
    await update($, prismaPending, () => ({ id, questions, picks: questions.map(() => []), others: questions.map(() => null), mix: questions.map(() => false), gallery, answerFile }));
    if (preferences.designSurface !== "browser") await $.ui.open({ id: "prisma", title: "Prisma", focus: true, closeOnEscape: true, holdToasts: true });
    const windows = await $.env.get("OS") === "Windows_NT";
    const commands = windows ? [["python", "-I"], ["py", "-3", "-I"]] : [["python3", "-I"], ["python", "-I"]];
    let answers: Record<string, string> | null = null;
    let cancelled = false;
    let failed = false;
    let ran: { exitCode: number; stdout: string; stderr: string } | null = null;
    while (!answers && !cancelled && !failed) {
      const started = await $.clock.now();
      ran = null;
      for (const command of commands) {
        ran = await $.process.run([...command, `${dir}/serve.py`, dir, token, preferences.designSurface === "pane" ? "0" : "1"], { timeoutMs: 600000 }).catch(() => null);
        if (ran) break;
      }
      if (ran) {
        if (ran.exitCode !== 0) failed = true;
        else try {
          const value: unknown = JSON.parse(ran.stdout);
          if (value === null) cancelled = true;
          else if (value && typeof value === "object" && !Array.isArray(value)) answers = value as Record<string, string>;
          else failed = true;
        } catch { failed = true; }
      } else if (next.signal.aborted || await $.clock.now() - started < 60000) failed = true;
    }
    await update($, prismaPending, () => null);
    if (preferences.designSurface !== "browser") await $.ui.close({ id: "prisma" });
    if (cancelled) return { deny: "The Prisma picker closed without an answer. Ask the user what they want instead." };
    if (failed || !ran) { $.ui.log("Prisma picker could not start its local preview server; falling back to the normal question dialog."); return next(e); }
    if (!answers) return { deny: "Prisma returned no answer." };
    await rememberPrisma($, questions, answers).catch(() => {});
    return { result: { questions: e.questions, answers } };
  }).catch(async ($, e, next) => {
    await update($, prismaPending, () => null);
    await $.ui.close({ id: "prisma" }).catch(() => {});
    $.ui.log(`Prisma picker failed: ${next.error.message ?? next.error.kind}; using the normal question dialog.`);
    return next(e);
  });

  on("ui.render", { component: "AskUserQuestion" }, async ($, e, next) => {
    const questions = e.props.questions as { options?: { label: string; preview?: string }[] }[];
    if (!questions.some((question) => question.options?.some((option) => prismaIsSvg(option.preview)))) return next(e);
    const plain = questions.map((question) => ({ ...question, options: question.options?.map(({ preview, ...option }) => prismaIsSvg(preview) ? option : { ...option, preview }) }));
    return next({ ...e, props: { ...e.props, questions: plain } });
  });

  on("ui.close", async ($, e, next) => {
    const picker = await read($, prismaPending);
    if (e.id === "prisma" && picker && e.origin.kind !== "plugin") await $.fs.write(picker.answerFile, "null");
    return next(e);
  }).catch(($, e, next) => next(e));

  on("command.run", { command: "jev" }, async ($, e) => {
    const locale = (await getSettings($)).locale;
    const [verb = "", arg = "", value = ""] = e.args.trim().toLowerCase().split(/\s+/);
    const tabFor: Record<string, JevTab> = {
      "": "overview",
      dashboard: "overview",
      overview: "overview",
      live: "live",
      models: "models",
      model: "models",
      modelos: "models",
      agents: "agents",
      flow: "flow",
      fluxo: "flow",
      features: "configuration",
      configuration: "configuration",
      deck: "deck",
      reasons: "logs",
      logs: "logs",
      log: "logs",
      setup: "ai",
      ai: "ai",
      ia: "ai",
    };
    if (verb === "agents" && arg === "clear") {
      const removed = await removeRuns($, () => true);
      return { text: removed.length === 1 ? text("ui.command.agentRemovedFromTab", locale) : removed.length > 1 ? text("ui.command.agentsRemoved", locale, { count: formatNumber(removed.length, locale) }) : text("ui.command.noFinished", locale) };
    }
    const which = tabFor[verb];
    if (verb === "setup") {
      // `/jev setup openrouter` picks the provider; the key itself is never an argument,
      // since what is typed after a command is kept in the transcript and the prompt history.
      const provider = isProvider(arg) ? arg : (await getSettings($)).provider;
      await update($, setup, (draft) => ({ ...draft, provider, message: "" }));
    }
    if (which) {
      await openPane($, which);
      return {};
    }
    if (verb === "routing" && (arg === "on" || arg === "off")) {
      await setRouting($, arg === "on");
      return { text: text(arg === "on" ? "ui.command.routingOn" : "ui.command.routingOff", locale) };
    }
    if (verb === "feature") {
      const feature = featureList(locale).find((one) => one.id === arg);
      if (!feature || (value !== "on" && value !== "off")) {
        return { text: text("ui.command.featureUsage", locale, { features: featureList(locale).map((one) => one.id).join("|") }) };
      }
      await setFeature($, feature.id, value === "on");
      return { text: text(value === "on" ? "ui.command.featureEnabled" : "ui.command.featureDisabled", locale, { name: feature.name }) };
    }
    if (verb === "agent") {
      const list = await read($, agents);
      const run = findRun(list, arg);
      if (!run) {
        return { text: list.length ? text("ui.command.noSubagent", locale, { name: arg }) : text("ui.command.noAgentsRun", locale) };
      }
      if (value === "remove") {
        if (run.state === "running") return { text: text("ui.command.removeRunning", locale, { agent: agentTitle(run) }) };
        await removeRuns($, (one) => one.id === run.id);
        return { text: text("ui.command.removedFromTab", locale, { agent: agentTitle(run) }) };
      }
      await openAgentPane($, run);
      return {};
    }
    if (verb === "orchestration" || verb === "orch") {
      // Raw arguments: agent type names keep their case.
      const line = e.args.trim().split(/\s+/).slice(1).join(" ");
      if (!line) {
        await openPane($, "orchestration");
        return {};
      }
      return { text: await runOrchestration($, line) };
    }
    if (verb === "status") return { text: await statusText($) };
    if (verb === "clear") {
      await clearHistory($);
      return { text: text("ui.command.clearHistory", locale) };
    }
    return { text: text("ui.command.usage", locale) };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    if (e.surface !== "terminal" && e.surface !== "desktop") {
      const { Text } = $.ui.resolve(e);
      return <Text>{await statusText($)}</Text>;
    }
    const els = $.ui.resolve(e);
    const width = Math.max(1, e.props.bodyColumns ?? 60);
    const rows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30;
    const key = await scrollKeyOf($, PANE);
    const shown = await view($, width, rows, e.surface, key);
    paneShownAt = shown.now;
    // Deck's state is read for its own tab only: no other tab, band or agent pane subscribes to it
    const panel = shown.tab === "deck" ? await deckPanelOf($, shown.locale) : null;
    return renderPane(els, { ...shown, deck: panel }, actions($));
  });

  on("ui.render", { component: "Pane", requestId: "farol" }, async ($, e) => {
    const ui = $.ui.resolve(e);
    const { Box, Text, Button } = ui;
    const Input = "Input" in ui ? ui.Input : undefined;
    const pt = (await getSettings($)).locale === "pt";
    if (!(await featureEnabled($, "farol"))) return <Text dimColor>{pt ? "Farol está desligado na Configuração do Jev." : "Farol is disabled in Jev Configuration."}</Text>;
    const list = await read($, farolItems);
    const rules = await read($, farolRules);
    const newest = [...list].reverse().find((item) => item.verdict === "open");
    if (!list.length && !rules.length) return <Text dimColor>{pt ? "Nenhuma suposição registrada nesta sessão." : "No assumptions logged in this session."}</Text>;
    return <Box flexDirection="column" gap={1}>
      <Text bold>{list.length} {pt ? "suposições" : "assumptions"} · {rules.length} {pt ? "regras do projeto" : "project rules"}</Text>
      {rules.map((rule, i) => <Box key={`rule-${i}`}><Text>• {rule.correction} <Text dimColor>({pt ? "não" : "not"}: {rule.assumption})</Text></Text><Button key={`delete-rule-${i}`} label={pt ? "Excluir" : "Delete"} dimColor onPress={() => void saveFarolRules($, (all) => all.filter((item) => item !== rule))} /></Box>)}
      <Text dimColor>{pt ? "Marque a suposição aberta mais recente como certa ou errada. Uma correção vira regra do projeto." : "Mark the newest open assumption right or wrong. A correction becomes a project rule."}</Text>
      {[...list].reverse().map((item) => <Box key={`assumption-${item.id}`} flexDirection="column">
        <Text bold>{item.verdict === "right" ? GLYPH.ok : item.verdict === "wrong" ? "✗" : GLYPH.ask} #{item.id} {item.text}</Text>
        {item.context && <Text dimColor>{item.context}</Text>}{item.note && <Text>→ {item.note}</Text>}
        <Box flexDirection="row" gap={1}><Button key={`right-${item.id}`} label={pt ? `${GLYPH.ok} Certa` : `${GLYPH.ok} Right`} hotkey={item === newest ? "y" : undefined} onPress={() => void farolJudge($, item.id, "right")} /><Button key={`wrong-${item.id}`} label={pt ? "✗ Errada" : "✗ Wrong"} hotkey={item === newest ? "n" : undefined} onPress={() => void farolJudge($, item.id, "wrong", item.note)} />{item.verdict !== "open" && <Text dimColor>{item.sent ? (pt ? "enviada ao Claude" : "sent to Claude") : (pt ? "pendente" : "pending")}</Text>}</Box>
        {Input && item.verdict !== "right" && <Input key={`fix-${item.id}`} placeholder={pt ? "O que deveria ser?" : "What should it be instead?"} value={item.note ?? ""} onSubmit={(value) => { if (value.trim()) void farolJudge($, item.id, "wrong", value.trim()); }} />}
      </Box>)}
      {list.some((item) => item.sent) && <Button key="clear-reviewed" label={pt ? "Limpar revisadas" : "Clear reviewed"} dimColor onPress={() => void update($, farolItems, (all) => all.filter((item) => item.verdict === "open" || !item.sent))} />}
    </Box>;
  });

  on("ui.render", { component: "Pane", requestId: "semente" }, async ($, e) => {
    const ui = $.ui.resolve(e);
    const { Box, Text, Button } = ui;
    const Input = "Input" in ui ? ui.Input : undefined;
    const pt = (await getSettings($)).locale === "pt";
    if (!(await featureEnabled($, "semente"))) return <Text dimColor>{pt ? "Semente está desligada na Configuração do Jev." : "Semente is disabled in Jev Configuration."}</Text>;
    const list = await read($, sementeIdeas);
    return <Box flexDirection="column">
      {Input && <Input key="new-idea" label="+ " placeholder={pt ? "Nova ideia…" : "New idea…"} submitLabel={pt ? "Salvar" : "Save"} onSubmit={(value) => { if (value.trim()) void addSemente($, value); }} />}
      {!list.length && <Text dimColor>{pt ? "Prateleira vazia. Use /semente &lt;ideia&gt; para adicionar." : "Shelf empty. Use /semente &lt;idea&gt; to add one."}</Text>}
      {list.map((idea) => <Box key={idea.id} flexDirection="row" gap={1}><Button key={`send-${idea.id}`} label={pt ? "Enviar" : "Send"} onPress={() => void sendSemente($, [idea])} /><Button key={`delete-${idea.id}`} label="×" dimColor onPress={() => void saveSemente($, (all) => all.filter((item) => item.id !== idea.id))} /><Text dimColor>{idea.source === "claude" ? "Claude" : pt ? "você" : "you"}:</Text><Text>{idea.text}</Text></Box>)}
    </Box>;
  });

  on("ui.render", { component: "Pane", requestId: "prisma" }, async ($, e) => {
    const ui = $.ui.resolve(e);
    const { Box, Text, Button } = ui;
    const Svg = "Svg" in ui ? ui.Svg : undefined;
    const Input = "Input" in ui ? ui.Input : undefined;
    const pt = (await getSettings($)).locale === "pt";
    if (!(await featureEnabled($, "prisma"))) return <Text dimColor>{pt ? "Prisma está desligado na Configuração do Jev." : "Prisma is disabled in Jev Configuration."}</Text>;
    const picker = await read($, prismaPending);
    if (!picker) return <Text dimColor>{pt ? "Nenhum seletor de design está aberto." : "No design picker is open."}</Text>;
    const finish = (value: PrismaPicker) => void $.fs.write(value.answerFile, JSON.stringify(prismaAnswers(value)));
    const choose = async (qi: number, label: string) => {
      const current = await read($, prismaPending) ?? picker;
      const next = prismaPick(current, qi, label);
      await update($, prismaPending, () => next);
      if (next.questions.length === 1 && !next.questions[0]!.multiSelect && !prismaMixing(next, qi)) finish(next);
    };
    const chooseOther = async (qi: number, value: string) => {
      if (!value.trim()) return;
      const current = await read($, prismaPending) ?? picker;
      const next = { ...current, others: current.others.map((old, i) => i === qi ? value.trim() : old) };
      await update($, prismaPending, () => next);
      if (next.questions.length === 1) finish(next);
    };
    const prefs = await readFeaturePreferences($);
    return <Box flexDirection="column" gap={1}>
      {picker.questions.map((question, qi) => <Box key={`question-${qi}`} flexDirection="column">
        <Text bold>{question.header}: {question.question}{question.multiSelect ? (pt ? " (escolha várias)" : " (pick any)") : prismaMixing(picker, qi) ? (pt ? " (misture duas)" : " (mix two)") : ""}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>{question.options.map((option, oi) => {
          const selected = picker.picks[qi]?.includes(option.label) ?? false;
          const hotkey = qi + oi < 9 ? String(qi + oi + 1) : undefined;
          return <Box key={`option-${qi}-${oi}`} flexDirection="column" width={e.surface === "terminal" ? 30 : undefined} borderStyle="round" borderColor={selected ? "green" : undefined} borderDimColor={!selected} paddingX={1}>
            {Svg && option.svg && <Svg source={option.svg} alt={option.label} width={300} />}
            {!Svg && option.svg && <Text dimColor>{prefs.designSurface === "pane" ? (pt ? "A prévia SVG está disponível no navegador." : "SVG preview is available in browser mode.") : (pt ? "Abra o seletor no navegador para ver a prévia." : "Open the browser picker to see the preview.")}</Text>}
            <Button key={`pick-${qi}-${oi}`} hotkey={hotkey} label={`${selected ? `${GLYPH.ok} ` : ""}${option.label}`} onPress={() => void choose(qi, option.label)} />
            {option.description && <Text dimColor>{option.description}</Text>}
          </Box>;
        })}</Box>
        {!question.multiSelect && question.options.length > 1 && <Button key={`mix-${qi}`} hotkey={picker.questions.length === 1 ? "m" : undefined} label={prismaMixing(picker, qi) ? (pt ? "Misturar duas · ligado" : "Mix two · on") : (pt ? "Misture duas opções" : "Mix two of these")} onPress={() => void update($, prismaPending, (current) => current ? prismaToggleMix(current, qi) : current)} />}
        {Input && <Input key={`custom-${qi}`} label={pt ? "Ou descreva sua opção" : "Or describe your own"} placeholder={pt ? "digite e pressione Enter" : "type and press Enter"} value={picker.others[qi] ?? ""} onSubmit={(value) => void chooseOther(qi, value)} />}
      </Box>)}
      <Box flexDirection="row" gap={1}>
        {(picker.questions.length > 1 || picker.questions.some((question) => question.multiSelect) || picker.mix.some(Boolean)) && prismaComplete(picker) && <Button key="submit" hotkey="s" variant="primary" label={pt ? "Enviar" : "Submit"} onPress={() => finish(picker)} />}
        {(prefs.designSurface !== "pane" || !Svg) && <Button key="browser" label={pt ? "Abrir no navegador" : "Open in browser"} dimColor onPress={async () => { const port = await $.fs.read(picker.gallery.replace(/index\.html$/, "port")); const url = `http://127.0.0.1:${String(port).trim()}/index.html`; const windows = await $.env.get("OS") === "Windows_NT"; const command = windows ? ["python", "-c", "import webbrowser,sys;webbrowser.open(sys.argv[1])", url] : ["python3", "-c", "import webbrowser,sys;webbrowser.open(sys.argv[1])", url]; void $.process.run(command).catch(() => {}); }} />}
      </Box>
    </Box>;
  });

  on("ui.render", { component: "Pane", requestId: "sentinela" }, async ($, e) => {
    const ui = $.ui.resolve(e);
    const { Box, Text, Button } = ui;
    const Input = "Input" in ui ? ui.Input : undefined;
    if (!(await featureEnabled($, "sentinela"))) return <Text dimColor>Sentinela is disabled in Jev Configuration.</Text>;
    const list = await read($, sentinelaSessions);
    const now = await $.clock.now();
    const target = await read($, sentinelaReplyTo);
    const replying = list.find((row) => row.id === target);
    const trouble = await read($, sentinelaProblem);
    const pt = (await getSettings($)).locale === "pt";
    return <Box flexDirection="column">
      <Text dimColor>{list.length} {pt ? "sessões em todos os projetos" : "sessions across projects"} · {pt ? "atualiza automaticamente" : "auto-refreshes"}</Text>
      {trouble && <Text color="error">{trouble}</Text>}{!list.length && <Text dimColor>{pt ? "Nenhuma sessão encontrada." : "No sessions found."}</Text>}
      {list.map((row) => {
        const isMe = row.id === sentinelaMe;
        const state = row.waitingFor || (row.status === "waiting" ? (pt ? "precisa de você" : "needs you") : row.status === "working" ? (pt ? "trabalhando" : "working") : (pt ? "concluída" : "done"));
        return <Box key={row.id} flexDirection="row" gap={1}><Box flexGrow={1} flexShrink={1}><Text wrap="truncate-end"><Text color={row.status === "waiting" ? "error" : row.status === "working" ? "warning" : "success"}>{row.status === "waiting" ? `${GLYPH.ask} ` : row.status === "working" ? `${GLYPH.on} ` : `${GLYPH.ok} `}</Text><Text bold>{sentinelaLabel(row)}</Text>{isMe && <Text dimColor>{pt ? " (esta)" : " (this)"}</Text>}<Text> · {state}</Text><Text dimColor> · {sentinelaAge(now - row.since)} · {row.project}</Text></Text></Box>
          {Input && !isMe && row.status === "waiting" && <Button key={`reply-${row.id}`} label={pt ? "responder" : "reply"} plain onPress={async () => { await update($, sentinelaReplyTo, (value) => value === row.id ? "" : row.id); await resizeSentinela($); await $.ui.focus({ requestId: "sentinela", key: "reply-text" }).catch(() => {}); }} />}
          {!isMe && <Button key={`jump-${row.id}`} label="jump" plain dimColor onPress={(surface) => void jumpSentinela($, row, surface.surface)} />}
        </Box>;
      })}
      {Input && replying && <Input key="reply-text" label={`→ ${sentinelaLabel(replying)}`} placeholder={pt ? "uma linha; Enter envia; vazio cancela" : "one line; Enter sends; empty cancels"} submitLabel={pt ? "enviar" : "send"} autoFocus onSubmit={(value) => void sendSentinelaReply($, value)} />}
    </Box>;
  });

  on("ui.render", { component: "Pane", requestId: "vigia" }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const pt = (await getSettings($)).locale === "pt";
    if (!(await featureEnabled($, "vigia"))) return <Text dimColor>{pt ? "Vigia está desligado na Configuração do Jev." : "Vigia is disabled in Jev Configuration."}</Text>;
    await refreshVigia($);
    const list = await read($, vigiaSessions);
    const now = await $.clock.now();
    const conflicts = await vigiaClashes($, now);
    const own = await ensureVigia($);
    const taskBar = (tasks: VigiaTask[]) => { const done = tasks.filter((task) => task.status === "completed").length; const cells = Math.min(10, tasks.length); const filled = Math.round((done / tasks.length) * cells); return `${"▰".repeat(filled)}${"▱".repeat(cells - filled)} ${done}/${tasks.length}`; };
    return <Box flexDirection="column" gap={1}>
      {!list.length && <Text dimColor>{pt ? "Nenhuma sessão do projeto acompanhada ainda." : "No project sessions tracked yet."}</Text>}
      {conflicts.length > 0 && <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}><Text bold color="red">⚠ {pt ? "Conflitos de arquivo" : "File clashes"} · {pt ? `últimos ${(await readFeaturePreferences($)).clashMinutes} min` : `last ${(await readFeaturePreferences($)).clashMinutes}m`}</Text>{conflicts.slice(0, 6).map((conflict) => <Text key={`${conflict.other.id}-${conflict.file}`} wrap="truncate">{conflict.file} · {vigiaName(conflict.other)} · {vigiaAgo(now - conflict.at)}</Text>)}</Box>}
      {list.slice(0, 8).map((record) => {
        const isMe = record.id === own.id;
        const current = vigiaAlive(record, now);
        const overlap = isMe || !current ? [] : vigiaShared(own, record);
        const doing = vigiaDoing(record);
        const next = vigiaNext(record);
        return <Box key={record.id} flexDirection="column" borderStyle="round" borderColor={isMe ? PAINT.you : current ? PAINT.warn : PAINT.rule} borderDimColor={!current} paddingX={1}>
          <Box justifyContent="space-between"><Text bold wrap="truncate">{isMe ? "★ " : ""}{vigiaName(record)}</Text><Text color={current ? record.isBusy ? "warning" : "success" : "gray"}>{current ? record.isBusy ? `${GLYPH.on} ${pt ? "trabalhando" : "working"}` : `◐ ${pt ? "aguardando" : "waiting"}` : `${GLYPH.off} ${pt ? "encerrada" : "ended"} ${vigiaAgo(now - record.beatAt)}`}</Text></Box>
          <Text dimColor>{isMe ? (pt ? "esta sessão" : "this session") : record.id.slice(0, 8)} · {record.turns ?? 0} {pt ? "turnos" : "turns"} · {vigiaAgo(now - record.startedAt)}</Text>
          {record.done && <Text wrap="wrap"><Text color="success">{GLYPH.ok} {pt ? "Feito" : "Done"}  </Text>{record.done}</Text>}{doing && <Text wrap="wrap"><Text color="warning">{GLYPH.run} {pt ? "Fazendo" : "Doing"} </Text>{doing}</Text>}{next && <Text wrap="wrap"><Text color={PAINT.brand}>{GLYPH.route} {pt ? "Próximo" : "Next"}  </Text>{next}</Text>}
          {record.tasks.length > 0 && <Text color="magenta">☰ {pt ? "Tarefas" : "Tasks"} {taskBar(record.tasks)}</Text>}{!!record.files?.length && <Text dimColor wrap="truncate">✎ {pt ? "Arquivos" : "Files"} {record.files.slice(0, 5).join(", ")}</Text>}{!!overlap.length && <Text color="error" wrap="truncate">⚠ {pt ? "Também alterados" : "Also edited"}: {overlap.join(", ")}</Text>}
          {!current && <Text dimColor>↺ claude --resume {record.id}</Text>}
        </Box>;
      })}
    </Box>;
  });

  // Each subagent's own live pane, `jev-agent-<n>`: its task, its numbers and its lines only.
  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (!e.requestId.startsWith(AGENT_PANE)) return next(e);
    const n = Number(e.requestId.slice(AGENT_PANE.length));
    const width = Math.max(1, e.props.bodyColumns ?? 60);
    const rows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30;
    const shown = await view($, width, rows, e.surface, e.requestId);
    const run = shown.agents.find((one) => one.n === n);
    if (e.surface !== "terminal" && e.surface !== "desktop") {
      const { Text } = $.ui.resolve(e);
      return <Text>{run
        ? text("ui.features.status", shown.locale, { name: agentTitle(run), state: text(`ui.agents.state.${run.state}` as LocaleKey, shown.locale), activity: run.activity ?? "" })
        : text("ui.features.agentNotKept", shown.locale, { number: formatNumber(n, shown.locale) })}</Text>;
    }
    return renderAgentPane($.ui.resolve(e), shown, run, n, actions($, e.requestId));
  });

  // --- Deck's hooks: events no pingo hook above takes; the events pingo already hooks carry Deck's calls inside them ---

  // a session cleared empties the rows; the rest of the state stays
  on("session.end", async ($, e, next) => {
    if (e.reason === "clear") {
      clearRows(deckOf(await $.clock.now()));
      redrawDeck($);
    }
    await vigiaSessionEnd($);
    return next(e);
  });

  // a router's own status and log lines: Deck reads them as the route; while quiet is on, they stay off the screen
  on("ui.status", async ($, e, next) => {
    const now = await $.clock.now();
    if (typeof e.text === "string" && readRouteStatus(deckOf(now), e.text, now)) {
      redrawDeck($);
      const cfg = await read($, deckSettings);
      if (cfg.quiet && cfg.show.route) return { value: undefined };
    }
    return next(e);
  }).catch((_$, e, next) => next(e));

  on("ui.log", async ($, e, next) => {
    const text = String(e.text ?? "");
    if (text.startsWith("[jev-model-router]")) {
      const now = await $.clock.now();
      if (readRouteLog(deckOf(now), text, now)) redrawDeck($);
      const cfg = await read($, deckSettings);
      if (cfg.quiet && cfg.show.route) return next({ ...e, to: "debug" });
    }
    return next(e);
  }).catch((_$, e, next) => next(e));

  // the session's own measure: the context, the limits and the cost it reports
  on("session.measure", async ($, e, next) => {
    const now = await $.clock.now();
    const cfg = await read($, deckSettings);
    const added = takeUsage(deckOf(now), { context: contextOf(e.context), rateLimits: e.rateLimits, cost: e.cost ?? null }, now, cfg.cost, true);
    await noteUsage($, now);
    if (added > 0) await saveDeckSpend($, now);
    redrawDeck($);
    return next(e);
  }).catch((_$, e, next) => next(e));

  // a reply that ends in a question: the live bar waits for the person
  on("classic.Stop", async ($, e, next) => {
    const result = await next(e);
    try {
      if (/\?\s*$/.test(e.last_assistant_message ?? "") && askedQuestion(deckOf(await $.clock.now()))) redrawDeck($);
    } catch {}
    return farolAfterStop($, result);
  }).catch((_$, e, next) => next(e));

  // a subagent the runtime reports as stopped
  on("classic.SubagentStop", async ($, e, next) => {
    const now = await $.clock.now();
    const s = deckOf(now);
    if (s.agents.has(e.agent_id)) {
      finishAgent(s, e.agent_id, "done", now, (await getSettings($)).locale);
      redrawDeck($);
    }
    return next(e);
  }).catch((_$, e, next) => next(e));

  on("classic.TaskCreated", async ($, e, next) => {
    const now = await $.clock.now();
    taskCreated(deckOf(now), String(e.task_id), e.task_subject, now, (await getSettings($)).locale);
    redrawDeck($);
    return next(e);
  }).catch((_$, e, next) => next(e));

  on("classic.TaskCompleted", async ($, e, next) => {
    const now = await $.clock.now();
    taskCompleted(deckOf(now), String(e.task_id), now, (await getSettings($)).locale);
    redrawDeck($);
    return next(e);
  }).catch((_$, e, next) => next(e));

  // a permission prompt held past its delay: the bar turns to a question, and the pet alerts
  on("tool.check", async ($, e, next) => {
    const verdict = await next(e);
    try {
      if (verdict && verdict.decision === "ask") {
        const now = await $.clock.now();
        const useId = e.tool_use_id;
        const key = e.agentId ?? (useId ? deckOf(now).inFlight.get(useId) : undefined) ?? "main";
        $.clock.after(ASK_DELAY_MS, () => {
          const later = deckOf(now);
          if (useId && !later.inFlight.has(useId)) return;
          markWaiting(later, key);
          redrawDeck($);
        });
      }
    } catch {}
    return verdict;
  }).catch((_$, e, next) => next(e));

  // the footer's Deck button: the count of live bars, and a click opens or shuts the band
  on("ui.render", { component: "SessionMode" }, async ($, e, next) => {
    await read($, deckRevision);
    const { Box, Button } = $.ui.resolve(e);
    const below = await next(e);
    const now = await $.clock.now();
    const locale = (await getSettings($)).locale;
    const count = collectRows(deckOf(now), (await read($, deckSettings)).show, now, locale).filter((r) => r.kind === "bar").length;
    const open = await isDeckOpen($);
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Button key="deck-footer" label={count ? `Deck ${count}` : "Deck"} dimColor={!open} onPress={() => void toggleDeck($)} />
        {below}
      </Box>
    );
  });

  // the style picker (/deck style): every style drawn with the live row, one key each
  on("ui.render", { component: "Pane", requestId: "deck-style" }, async ($, e) => {
    await read($, deckRevision);
    const now = await $.clock.now();
    const locale = (await getSettings($)).locale;
    const cfg = await read($, deckSettings);
    const row = collectRows(deckOf(now), cfg.show, now, locale).find((r) => r.kind === "bar") ?? sampleRow(locale);
    return stylePicker($, $.ui.resolve(e), deckSurface(e.surface), cfg, row, locale, Math.max(40, e.props.bodyColumns ?? 80), now);
  });

  // the band as a pane of its own (/deck panel): expanded, every row at once
  on("ui.render", { component: "Pane", requestId: "deck-panel" }, async ($, e) => {
    const surface = deckSurface(e.surface);
    const band = await deckBandOf($, Math.max(40, e.props.bodyColumns ?? 100), surface, undefined, false);
    noteLane($, e.requestId, band, surface);
    return renderDeck($.ui.resolve(e), { ...band, expanded: true, pane: true }, surface);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const els = $.ui.resolve(e);
    const { Box } = els;
    const cols = e.props.bodyColumns ?? 80;
    const surface = deckSurface(e.surface);
    const band = await deckBandOf($, cols, surface, e.props.maxRows);
    noteLane($, e.requestId, band, surface);
    let below: RenderChildren = renderAbove(els, await view($, cols, 2, e.surface), band, surface);
    below = await farolAbove($, e, below);
    below = await clarezaAbove($, e, below);
    below = await sementeAbove($, e, below);
    below = await lapidaAbove($, e, below);
    below = await sentinelaAbove($, e, below);
    below = await vigiaAbove($, e, below);
    return <Box flexDirection="column">{below}</Box>;
  });

  on("session.compact", async ($, e, next) => {
    if (!(await featureEnabled($, "contexto"))) return next(e);
    const config = await getSettings($);
    try {
      if (!config.apiKey) throw new Error("Jev provider key is not configured");
      const input = e.messages as unknown as readonly ContextSessionMessage[];
      const { result, messages } = await compactContextSession(input, contextAsker($, config), contextConfig);
      for (const line of contextDecisionLogLines(result, config.locale)) await log($, "mod", "feature", "info", line);
      const summary = contextSummary(result, config.locale);
      if (contextReductionRatio(result) < contextConfig.minReductionRatio) {
        await notifyContext($, text("feature.contexto.fallback.small", config.locale, {
          minimum: contextPercent(contextConfig.minReductionRatio),
          summary,
        }), "warn");
        return next(e);
      }
      await notifyContext($, text("feature.contexto.applied", config.locale, {
        after: formatNumber(messages.length, config.locale),
        before: formatNumber(e.messages.length, config.locale),
        summary,
      }), "good");
      return { messages: messages as unknown as typeof e.messages };
    } catch (error) {
      const reason = short(error instanceof Error ? error.message : String(error), 160);
      await notifyContext($, text("feature.contexto.fallback.error", config.locale, { reason }), "warn");
      return next(e);
    }
  });

};
