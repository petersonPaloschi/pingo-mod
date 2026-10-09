// Jev observes requests and offers optional model/effort selection for native subagent spawns.
// Runtime records actual requests, tool results, usage, and failures even when Jev is unavailable.
//
// Every function that reaches `$` is declared here at the top level, so `claude plugin validate`
// can follow each call; the other files are pure.
import { atom, read, update } from "claude-code";
import type { ElementTable, EngineInterface, Register, Timer } from "claude-code";

import type { AdvisorInfo, AgentRun, FeatureFlags, FeedEntry, PaneScroll, FeedKind, FeedSpeaker, FeedTone, JevTab, LiveNow, RouteEvent, SetupDraft, TraceState } from "../types";
import { keyFor, keyOwner, providerBasis, resolveSettings, storedApplies, type ModOptions, type Settings, type StoredSettings } from "./config.ts";
import { channelFile, channelReader, FOLLOW_SCRIPT } from "./core/channel.ts";
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
import { formatCompact, formatDecimal, formatDuration, formatNumber, formatPercent, text, type Locale, type LocaleKey, type LocaleOption } from "./i18n.ts";
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
import { DIM, STYLE, runs } from "./deck/theme.ts";

const PANE = "jev";
type FeatureId = keyof FeatureFlags;
const events = atom({ plugin: "jev", key: "events" } as const, [] as RouteEvent[]);
const routing = atom({ plugin: "jev", key: "routing" } as const, true);
const tab = atom({ plugin: "jev", key: "tab" } as const, "overview" as JevTab);
const range = atom({ plugin: "jev", key: "range" } as const, RANGES[1]![1]);
const setup = atom({ plugin: "jev", key: "setup" } as const, { provider: "", message: "", isOk: false } as SetupDraft);
const features = atom({ plugin: "jev", key: "features" } as const, { ...DEFAULT_FEATURES } as FeatureFlags);
const flowDetails = atom({ plugin: "jev", key: "flowDetails" } as const, false);
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
/** How far each pane body can scroll as last drawn, and whether it counts up from the newest line. */
const scrollRoom = new Map<string, { max: number; fromEnd: boolean }>();
/** The Flow tab's record, schema 2 under a key of its own: the old FlowState is never read as it. */
const trace = atom({ plugin: "jev", key: "flowV2" } as const, emptyTrace() as TraceState);
/** Tools whose call is an edit, for the Flow tab's count. */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const STORE_EVENTS = "events";
const STORE_ROUTING = "routing";
const LEGACY_STORE_KEY = "apiKey";
const STORE_PROVIDER = "provider";
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
type AgentInfo = { type: string; model: string; effort?: Effort; description: string; mascot?: MascotId; teammate?: true; awake?: boolean };
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
/** The band's clock (every 150 ms), its frame count, the fold in progress and its timer, and the demo's timer. */
let deckLoop: Timer | undefined;
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
  settings = resolveSettings(pluginOptions(), env, stored);
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
      const line = await log($, "jev", "jev", "info", card.text, undefined, { detail: card.detail, meta: text("feed.jev.asking", locale) });
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
  const moved = cfg.show.pet && stepPet(petOf(now), petMood(s, rows, now), now);
  // What is on screen decides what moves. A band never drawn, or drawn long ago, stays still. The terminal pet is
  // repainted in place and asks for no redraw; a desktop band moves by CSS and is redrawn once per new scene; the
  // terminal's rows step their frames, so they are redrawn, every other frame, or every fourth with the dashboard
  // open (every redraw draws that again too).
  const terminal = now - deckShownTerminalAt < ON_SCREEN_MS;
  const desktop = now - deckShownDesktopAt < ON_SCREEN_MS;
  if (cfg.show.pet && terminal && !blitBroken) await paintLanes($, now);
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
async function paintLanes($: EngineInterface, now: number): Promise<void> {
  const pet = petOf(now);
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
}

/** The timer that drives the band: it runs from session start, and a new start replaces the old one. */
function startDeckClock($: EngineInterface): void {
  deckLoop?.cancel();
  deckLoop = $.clock.every(150, () => void tickDeck($).catch(() => undefined));
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
  if (surface === "terminal") deckShownTerminalAt = now;
  else deckShownDesktopAt = now;
  const s = deckOf(now);
  const rows = collectRows(s, cfg.show, now, config.locale);
  return {
    rows,
    ...(folding && deckFold ? { shown: foldCount(rows.length, now) } : {}),
    ...(maxRows !== undefined ? { maxRows } : {}),
    settings: cfg,
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
    pet: petOf(now),
    toggle: () => void toggleDeck($),
    dismiss: (row) => void dismissDeckRow($, row),
    foldAge: folding && deckFold?.dir === "open" ? foldAgeOf(deckFold, now) : null,
  };
}

/** Remembers where a terminal band draws the pet's lane, so the lane can be repainted there without drawing the band again. */
function noteLane(requestId: string, band: DeckBand, surface: Surface): void {
  if (surface !== "terminal" || !band.settings.show.pet) {
    deckLanes.delete(requestId);
    return;
  }
  const columns = petLaneColumns(band.cols);
  deckLanes.set(requestId, { columns, cells: cellsOf(petLaneCells(band.pet, band.now, columns)), seenAt: band.now });
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
  const pw = Math.max(200, Math.min(420, cols * 8 - 160));
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
      <Box flexDirection="row">{runs(Text, terminalBar(name, track, Math.max(24, Math.min(48, cols - 26)), deckFrame))}</Box>
    );
    return (
      <Box key={"style-row-" + name} flexDirection="row" columnGap={2} alignItems="center">
        <Box width={14} flexShrink={0}>
          <Button
            key={"style-" + name}
            label={names[name] ?? name}
            plain
            hotkey={String(i + 1)}
            onPress={() => setDeckStyle($, surface, name)}
          />
        </Box>
        {preview}
        <Text color={name === current ? STYLE.ok.fill : DIM}>{name === current ? "← now" : " "}</Text>
      </Box>
    );
  });
  return (
    <Box flexDirection="column" gap={desktop ? 1 : 0}>
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

export function normalizeTab(value: unknown): JevTab {
  switch (value) {
    case "overview":
    case "live":
    case "models":
    case "agents":
    case "logs":
    case "configuration":
    case "deck":
      return value;
    case "flow":
      return "live";
    case "reasons":
    case "baseline":
    case "log":
      return "logs";
    case "features":
    case "setup":
      return "configuration";
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
  const row = await optionRow($, "locale");
  if (!row) {
    await update($, setup, (draft) => ({ ...draft, message: text("ui.setup.languageOptionUnavailable", current.locale), isOk: false }));
    return;
  }
  try {
    const result = await $.config.set({ key: row, value: locale });
    if (result.deny) throw new Error(result.deny);
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

function actions($: EngineInterface, scrollKey = ""): Actions {
  return {
    layout: (max, fromEnd) => void scrollRoom.set(scrollKey, { max, fromEnd }),
    tab: (which) => void update($, tab, () => which),
    range: (ms) => void update($, range, () => ms),
    flowDetails: (open) => {
      void update($, flowDetails, () => open);
      if (scrollKey) void update($, scroll, (all) => ({ ...all, [scrollKey]: 0 }));
    },
    routing: (enabled) => void setRouting($, enabled),
    feature: (id, enabled) => void setFeature($, id, enabled),
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
    // The terminal draws the header fixed and the body scrolled by the mod; other surfaces flow.
    fixed: Boolean(scrollKey) && surface === "terminal",
    events: await read($, events),
    routing: await read($, routing),
    tab: normalized,
    range: await read($, range),
    flowDetails: await read($, flowDetails),
    setup: await read($, setup),
    features: await read($, features),
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
  mainModel = undefined;
  settings = undefined;
  draftKey = "";
  deckNote = null;
  deckDraft = "";
  deckLanes.clear();
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
    const config = await getSettings($);
    await restoreStoredState($);
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
    $.clock.every(1000, () => $.ui.invalidate("ui.render"));
    await $.command.register({
      name: "jev",
      description: text("ui.command.description", config.locale),
      argumentHint: text("ui.command.argumentHint", config.locale),
      immediate: true,
    });
    await $.command.register({
      name: "deck",
      description: text("deck.command.description", config.locale),
      argumentHint: text("deck.command.argumentHint", config.locale),
      immediate: true,
    });
    return next(e);
  });

  on("classic.SessionStart", async ($, e, next) => {
    if (e.source === "clear" || e.source === "resume" || e.source === "fork") {
      await restoreStoredState($);
      mainModel = await $.session.model();
    }
    return next(e);
  }).catch((_$, e, next) => next(e));

  on("classic.PostModelSwitch", async ($, e, next) => {
    mainModel = e.to_model;
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
    const submittedAt = await $.clock.now();
    promptSubmitted(deckOf(submittedAt), e.text, submittedAt);
    let messageId = "";
    await updateTrace($, (s) => {
      const [nextState, id] = submitPrompt(s, { text: e.text, at: submittedAt, origin: e.origin.kind, ...(e.turnId ? { during: e.turnId } : {}) });
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
    return entered(await next(e));
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
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const locale = (await getSettings($)).locale;
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
      await updateTrace($, (s) => completeTurn(s, e.turnId, endedAt, e.isAborted ? "aborted" : e.reason, id));
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
    await updateTrace($, (s) => completeTurn(s, e.turnId, endedAt, e.isAborted ? "aborted" : e.reason));
    return next(e);
  });

  // Log every native tool call and its result; advice never interrupts the tool flow.
  on("tool.call", async ($, e, next) => {
    // Deck tracks every call, another plugin's own included; the Jev path below is Claude's calls only.
    const deckCall = await deckCallOpen($, e);
    // Another plugin's own call ($.tool.call) is no step of Claude's.
    if (!e.tool_use_id || next.origin.plugin !== "engine") return deckCallClose($, deckCall, next(e));
    const locale = (await getSettings($)).locale;
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
    const input = e as unknown as Record<string, unknown>;
    const toolDetail = toolDetails(e.tool, input, locale);
    const line = await log($, who, "tool", "info", `▸ ${summary}`, e.agentId, { meta: text("feed.tool.running", locale), ...(toolDetail ? { detail: toolDetail } : {}) });
    if (!e.agentId) await setLive($, { activity: text("feed.activity.running", locale, { activity: short(summary, 40) }) });
    else await updateRun($, e.agentId, (run) => ({ ...run, tools: run.tools + 1, activity: text("feed.activity.agentTool", locale, { activity: short(summary, 60) }) }));
    // The follower reads the channel every 100 ms: the command's last calls still count where it ran.
    const result = await deckCallClose($, deckCall, next(e).finally(() => {
      if (sift) $.clock.after(1000, () => siftRuns.delete(toolUseId));
    }));
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
          text: `${result.isError ? "✗" : "✓"} ${summary}`,
          tone: result.isError ? "bad" : "good",
          meta: took,
          detail: [toolDetail, outcome].filter(Boolean).join(" → "),
        });
      }
      if (e.agentId) await updateRun($, e.agentId, (run) => ({ ...run, activity: text("feed.activity.waiting", locale) }));
      if (!e.agentId) await setLive($, { activity: text("feed.activity.waiting", locale) });
      return result;
    } catch {
      return result;
    }
  }).catch((_$, e, next) => next(e));

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
    const proposed =
      !featureGate(ctx, "agents") && !e.fork && !e.model
        ? await asking($, () => planAgent(e, config, tracedAskJev($, config, { origin: "agent", trigger: e.subagentType, ...(e.parentAgentId ? { agentId: e.parentAgentId } : {}) }), ctx.features, undefined, modelContext(config)))
        : {};
    const current = await activeFeatures($, config);
    const plan = featureGate(current, "agents") ? {} : proposed;
    const result = await next(plan.model ? { ...e, model: plan.model.value } : e);
    await deckSpawnStarted($, e, result, config.locale);
    if (result.deny !== undefined) {
      await log($, "claude", "agent", "warn", text("feed.subagent.denied", config.locale, { type: e.subagentType, message: short(result.deny, 80) }));
      return result;
    }
    const id = result.agentId ?? e.tool_use_id;
    const sized = sizeRequest({ model: result.model }, { effort: plan.effort?.value }, { effort: !featureGate(current, "agents") });
    const appliedEffort = sized.effortOutcome?.kind === "applied" ? plan.effort : undefined;
    const ignoredEffort = sized.effortOutcome?.kind === "ignored" ? plan.effort : undefined;
    agentRuns.set(id, { type: e.subagentType, model: result.model, ...(appliedEffort ? { effort: appliedEffort.value } : {}), description: e.description, ...(e.isTeammate ? { teammate: true as const, awake: true } : {}) });
    const chosen = [
      plan.model
        ? text("feed.subagent.jevModel", config.locale, { model: plan.model.value, confidence: formatDecimal(plan.model.confidence, config.locale) })
        : text("feed.subagent.model", config.locale, { model: modelName(result.model) }) + (e.model ? text("feed.subagent.requested", config.locale) : ""),
      appliedEffort ? text("feed.subagent.jevEffort", config.locale, { effort: appliedEffort.value }) : undefined,
    ].filter(Boolean);
    const jevChose = [plan.model ? text("feed.subagent.model", config.locale, { model: plan.model.value }) : "", appliedEffort ? text("feed.subagent.effort", config.locale, { effort: appliedEffort.value }) : ""].filter(Boolean).join(text("feed.usage.separator", config.locale));
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
    const sized = sizeRequest(e, e.agentId ? { effort: run?.effort } : {}, { effort: current ? !featureGate(current, "agents") : false });
    const sent = sized.request;
    const model = sent.model;
    const effort = sent.effort;
    const changes: string[] = [];
    const reason = e.agentId ? "subagent" : await read($, routing) ? "not_asked" : "routing_disabled";
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
      flow: "live",
      features: "configuration",
      configuration: "configuration",
      deck: "deck",
      reasons: "logs",
      logs: "logs",
      log: "logs",
      setup: "configuration",
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
    return renderPane(els, { ...shown, deck: panel }, actions($, key));
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

  // The panes scroll their own bodies so the header stays: the engine's window never moves, the
  // offset kept in state does, and its write redraws the pane.
  on("ui.scroll", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE && !e.requestId.startsWith(AGENT_PANE)) return next(e);
    const key = await scrollKeyOf($, e.requestId);
    const room = scrollRoom.get(key);
    if (!room) return next(e);
    await update($, scroll, (all) => {
      const now = all[key] ?? 0;
      const moved = Math.max(0, Math.min(room.max, room.fromEnd ? now - e.by : now + e.by));
      return moved === now ? all : { ...all, [key]: moved };
    });
    return {};
  }).catch((_$, e, next) => next(e));

  // --- Deck's hooks: events no pingo hook above takes; the events pingo already hooks carry Deck's calls inside them ---

  // a session cleared empties the rows; the rest of the state stays
  on("session.end", async ($, e, next) => {
    if (e.reason === "clear") {
      clearRows(deckOf(await $.clock.now()));
      redrawDeck($);
    }
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
    return result;
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
    noteLane(e.requestId, band, surface);
    return renderDeck($.ui.resolve(e), { ...band, expanded: true }, surface);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const els = $.ui.resolve(e);
    const cols = e.props.bodyColumns ?? 80;
    const surface = deckSurface(e.surface);
    const band = await deckBandOf($, cols, surface, e.props.maxRows);
    noteLane(e.requestId, band, surface);
    return renderAbove(els, await view($, cols, 2, e.surface), band, surface);
  });
};
