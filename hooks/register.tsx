// Jev routing and a live dashboard for Claude Code.
//
// At the start of each turn (prompt.submit) the mod asks Jev, in one call, about every feature
// that is switched on: whether to take part, which tool fits, which model and effort the turn
// runs on, and whether to hand work to a subagent. After each tool batch (tool.call) it asks
// again about the next tool. When a subagent starts (agent.spawn) it asks for that agent's model
// and effort. turn.step applies the model and effort and meters every request; the live log
// records what can be observed, never the model's reasoning.
//
// Every function that reaches `$` is declared here at the top level, so `claude plugin validate`
// can follow each call; the other files are pure.
import { atom, read, update } from "claude-code";
import type { EngineInterface, Register, UiBlitArgs } from "claude-code";

import type { AgentRun, FeatureFlags, FeedEntry, FlowState, PaneScroll, FeedKind, FeedSpeaker, FeedTone, JevTab, LiveNow, RouteEvent, SetupDraft } from "../types";
import { keyFor, keyOwner, providerBasis, resolveSettings, storedApplies, type ModOptions, type Settings, type StoredSettings } from "./config.ts";
import { decide, hintText, type Decision } from "./core/decide.ts";
import { createAskJev, isProvider, PROVIDERS, redact, resolveModel, validateKey, type ProviderId, type Transport } from "./core/jev.ts";
import {
  DEFAULT_FEATURES,
  isSafeAgentName,
  planAgent,
  planHint,
  planSummary,
  planTurn,
  TIER_MODEL,
  type AgentType,
  type Effort,
  type FeatureId,
  type TurnPlan,
} from "./core/plan.ts";
import { KEPT_EVENTS, RANGES, reasonKey } from "./events.ts";
import { featureFlagsText, features as featureList, modelName, outputSize, short, toolDetails, toolSummary } from "./feed.ts";
import { resultText, toInput, type PendingResult } from "./input.ts";
import { cellsOf } from "./dots.ts";
import { diceFrame, diceSize } from "./mascots/dice.ts";
import { brailleFrame, type Mood } from "./mascots/pingo.ts";
import { AGENT_MASCOTS, isMascot, mascotFrame, pickMascot, type MascotId } from "./mascots/agents.ts";
import { moodOf, pingoSize, renderAgentPane, renderBand, renderPane, type Actions, type View } from "./ui.tsx";
import { formatCompact, formatDecimal, formatDuration, formatNumber, formatPercent, reasonTitle, text, type Locale, type LocaleKey, type LocaleOption } from "./i18n.ts";

const PANE = "jev";
const events = atom({ plugin: "jev", key: "events" } as const, [] as RouteEvent[]);
const routing = atom({ plugin: "jev", key: "routing" } as const, true);
const tab = atom({ plugin: "jev", key: "tab" } as const, "overview" as JevTab);
const range = atom({ plugin: "jev", key: "range" } as const, RANGES[1]![1]);
const setup = atom({ plugin: "jev", key: "setup" } as const, { provider: "", message: "", isOk: false } as SetupDraft);
const features = atom({ plugin: "jev", key: "features" } as const, { ...DEFAULT_FEATURES } as FeatureFlags);
const feed = atom({ plugin: "jev", key: "feed" } as const, [] as FeedEntry[]);
const live = atom({ plugin: "jev", key: "now" } as const, {} as LiveNow);
const agents = atom({ plugin: "jev", key: "agents" } as const, [] as AgentRun[]);
/** The highest subagent number handed out: kept beside the runs, so it lives exactly as long as they do. */
const agentCount = atom({ plugin: "jev", key: "agentCount" } as const, 0);
const scroll = atom({ plugin: "jev", key: "scroll" } as const, {} as PaneScroll);
/** How far each pane body can scroll as last drawn, and whether it counts up from the newest line. */
const scrollRoom = new Map<string, { max: number; fromEnd: boolean }>();
const flow = atom({ plugin: "jev", key: "flow" } as const, { turn: 0, wave: [], waveTurn: 0, confirmed: false, edits: 0, files: [], working: false } as FlowState);
/** Tools whose call is an edit, for the Flow tab's count. */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const STORE_EVENTS = "events";
const STORE_ROUTING = "routing";
const LEGACY_STORE_KEY = "apiKey";
const STORE_PROVIDER = "provider";
const STORE_FEATURES = "features";
const FEED_SIZE = 1000;
/** Subagents kept for the Agents tab: every running one, then the latest finished. */
const KEPT_AGENTS = 40;
/** Each subagent's own live pane: `jev-agent-<n>`. */
const AGENT_PANE = "jev-agent-";
// Module state: lost on a reload, which is fine for each of these.
let options: ModOptions = {};
let settings: Settings | undefined;
let system: string | undefined;
/** The tool decision for the main loop's next model request. */
let pending: Decision | undefined;
/** What Jev decided for the running turn: model and effort for its main-loop requests. */
let turnPlan: { model?: string; effort?: Effort; effortIgnored?: Effort; declined?: boolean; summary?: string; modelKept?: boolean } | undefined;
let lastToolCount = 0;
let sessionId = "";
let feedSeq = 0;
/** The highest request-log number this module wrote, and the tail of its queue of writes. */
let eventSeq = 0;
let eventWrites: Promise<unknown> = Promise.resolve();
/** Subagent types Claude Code offers, as agent.offer reports them. */
const agentTypes = new Map<string, AgentType>();
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
/** Set when a model Jev chose was refused: model changes stop for the session. */
let modelBroken = false;
/** Empty answers in a row from a model Jev switched to; two in a row count as a refusal. */
let switchedEmpty = 0;
/**
 * Set when the person picked the main loop's model this session (/model, the picker, the SDK):
 * Jev's model then stays out, as it does for a subagent Claude named a model for. turn.step
 * carries no such signal, and a model chosen before the session (--model, settings) is not seen.
 */
let userModel = false;
/**
 * A main-loop model Jev may replace: a plain first-party id. One with a suffix (`[1m]`) or a
 * provider's id (Bedrock, Vertex, a gateway) would lose its context window or fail the request.
 */
const switchableModel = (id: string) => /^claude-[a-z0-9.-]+$/i.test(id);
/** Dice at the top of the live tab: drawn while that tab shows. */
let dice: { columns: number; rows: number } | undefined;
/** Pingo in the dashboard header: its terminal frame follows the latest Jev status. */
let pingo: { mood: Mood; columns: number; rows: number } | undefined;
/** Each open subagent pane's mascot, by pane id. */
const agentArt = new Map<string, { mascot: MascotId; columns: number; rows: number }>();
const MASCOT_FPS = 10;
/** A mascot frame is being sent. */
let animating = false;

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
  // Older versions saved credentials as plain text in plugin state. Remove that copy and
  // continue using only Claude Code's sensitive option or the provider's environment variable.
  const legacyKey = await $.store.get(LEGACY_STORE_KEY);
  if (typeof legacyKey === "string") await $.store.delete(LEGACY_STORE_KEY);
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
  settings = resolveSettings(pluginOptions(), env, await storedSettings($, env));
  return settings;
}

async function systemText($: EngineInterface): Promise<string> {
  if (system !== undefined) return system;
  try {
    system = (await $.prompt.compose()).sections.map((section) => section.text).join("\n\n");
  } catch {
    system = "";
  }
  return system;
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

/** True when the Flow tab's wave has subagents and none of them still runs. */
async function waveEnded($: EngineInterface): Promise<boolean> {
  const f = await read($, flow);
  const list = await read($, agents);
  const wave = list.filter((run) => f.wave.includes(run.n));
  return wave.length > 0 && wave.every((run) => run.state !== "running");
}

/** A main-loop edit after the wave came back: the Flow tab counts it and its file. */
async function countEdit($: EngineInterface, input: Record<string, unknown>): Promise<void> {
  if (!(await waveEnded($))) return;
  const file = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : undefined;
  await update($, flow, (f) => ({ ...f, edits: f.edits + 1, files: file && !f.files.includes(file) ? [...f.files, file] : f.files }));
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
      tokensIn: 0,
      tokensOut: 0,
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

/** "/•ᴗ•\ Tetra · Explore #3": a subagent by its mascot, then its type and number. */
function agentTitle(run: AgentRun): string {
  const mascot = isMascot(run.mascot) ? AGENT_MASCOTS[run.mascot] : undefined;
  return mascot ? `${mascot.face} ${mascot.name} · ${run.type} #${run.n}` : `◆ ${run.type} #${run.n}`;
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

// --- Animated artwork ---

/** A blit that throws counts as refused: that mascot stops like one whose pane is gone. */
async function blitted($: EngineInterface, args: UiBlitArgs): Promise<boolean> {
  try {
    return (await $.ui.blit(args)).deny === undefined;
  } catch {
    return false;
  }
}

/** Repaints visible mascots in place; each stops when its pane no longer shows it. */
async function animateMascots($: EngineInterface): Promise<void> {
  // One frame at a time: a tick that comes while the last frame is still out is skipped.
  if (animating) return;
  animating = true;
  try {
    const t = (await $.clock.now()) / 1000;
    if (dice) {
      const { columns, rows } = dice;
      if (!(await blitted($, { requestId: PANE, key: "dice", cells: cellsOf(diceFrame(t, columns, rows)), columns, rows }))) dice = undefined;
    }
    if (pingo) {
      const { mood, columns, rows } = pingo;
      if (!(await blitted($, { requestId: PANE, key: "pingo", cells: cellsOf(brailleFrame(mood, t, columns, rows)), columns, rows }))) pingo = undefined;
    }
    for (const [requestId, art] of agentArt) {
      if (!(await blitted($, { requestId, key: "mascot", cells: cellsOf(mascotFrame(art.mascot, t, art.columns, art.rows)), columns: art.columns, rows: art.rows }))) agentArt.delete(requestId);
    }
  } finally {
    animating = false;
  }
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

// --- Routing ---

/** The turn's routing point: every feature that is on, in one Jev call. */
async function planFor($: EngineInterface, userText: string): Promise<TurnPlan> {
  if (!(await read($, routing))) return { decision: { mode: "passthrough", reason: "routing_disabled" } };
  const config = await getSettings($);
  if (!config.apiKey) return { decision: { mode: "passthrough", reason: "no_api_key" } };
  const flags = await read($, features);
  const [messages, roster] = await Promise.all([$.session.messages(), $.tool.list()]);
  lastToolCount = roster.length;
  const input = toInput(await systemText($), messages, roster, config.maxMessageChars, { userText }, config.locale);
  return asking($, () => planTurn(input, config, createAskJev(config, transport($, config.locale)), flags, [...agentTypes.values()]));
}

/** After a tool batch: only the next tool, when that feature is on and Jev did not stay out. */
async function routeTool($: EngineInterface, extra: { pending?: PendingResult }): Promise<Decision | undefined> {
  if (!(await read($, routing))) return { mode: "passthrough", reason: "routing_disabled" };
  if (turnPlan?.declined) return { mode: "passthrough", reason: "jev_declined" };
  if (!(await read($, features)).tools) return undefined;
  const config = await getSettings($);
  if (!config.apiKey) return { mode: "passthrough", reason: "no_api_key" };
  const [messages, roster] = await Promise.all([$.session.messages(), $.tool.list()]);
  lastToolCount = roster.length;
  const input = toInput(await systemText($), messages, roster, config.maxMessageChars, extra, config.locale);
  return asking($, () => decide(input, config, createAskJev(config, transport($, config.locale))));
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
  });
}

/** Restore persisted choices after a session reset such as /clear, /resume, or /branch. */
async function restoreStoredState($: EngineInterface): Promise<void> {
  await serially(async () => {
    const storedEvents = (await $.store.get(STORE_EVENTS)) as RouteEvent[] | undefined;
    if (storedEvents) await update($, events, () => storedEvents);
  });
  const storedRouting = (await $.store.get(STORE_ROUTING)) as boolean | undefined;
  if (typeof storedRouting === "boolean") await update($, routing, () => storedRouting);
  const storedFeatures = (await $.store.get(STORE_FEATURES)) as Partial<FeatureFlags> | undefined;
  if (storedFeatures) await update($, features, () => ({ ...DEFAULT_FEATURES, ...storedFeatures }));
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
  const flags = await update($, features, (current) => ({ ...current, [id]: enabled }));
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
  const check = await validateKey(id, apiKey, transport($, locale), resolveModel(id, options.model?.trim()), locale);
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
  const check = await validateKey(id, key, transport($, locale), resolveModel(id, options.model?.trim()), locale);
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
  const refused = await saveKey($, key);
  // Saved together or not at all: the provider without its key would get the old key next session.
  if (refused) await restoreProvider($, providerBefore, storedBefore);
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
  };
}

/** The key a pane's scroll position is kept under: the Jev pane's per tab, a subagent pane's by its id. */
async function scrollKeyOf($: EngineInterface, requestId: string): Promise<string> {
  return requestId === PANE ? `${PANE}:${await read($, tab)}` : requestId;
}

async function view($: EngineInterface, width: number, rows: number, surface: string, scrollKey = ""): Promise<View> {
  const config = await getSettings($);
  return {
    locale: config.locale,
    localeOption: config.localeOption,
    scroll: scrollKey ? ((await read($, scroll))[scrollKey] ?? 0) : 0,
    // The terminal draws the header fixed and the body scrolled by the mod; other surfaces flow.
    fixed: Boolean(scrollKey) && surface === "terminal",
    events: await read($, events),
    routing: await read($, routing),
    tab: await read($, tab),
    range: await read($, range),
    setup: await read($, setup),
    features: await read($, features),
    feed: await read($, feed),
    live: await read($, live),
    agents: await read($, agents),
    flow: await read($, flow),
    cwd: await $.session.cwd().catch(() => ""),
    now: await $.clock.now(),
    width,
    rows,
    surface,
    meta: text("ui.meta", config.locale, { provider: PROVIDERS[config.provider].label, model: config.jevModel, confidence: formatNumber(config.minConfidence, config.locale, 2), source: text(`source.${config.keySource}`, config.locale) }),
    key: { source: config.keySource, tail: config.apiKey ? config.apiKey.slice(-4) : "", provider: config.provider },
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
  settings = undefined;
  draftKey = "";
  sessionKey = "";
  sessionProvider = undefined;

  on("session.start", async ($, e, next) => {
    sessionId = (await $.session.id()).slice(0, 8);
    const config = await getSettings($);
    await restoreStoredState($);
    await setLive($, { model: await $.session.model() });
    // "Idle" and the 5-minute windows move with the clock, not only with events.
    $.clock.every(1000, () => $.ui.invalidate("ui.render"));
    // Visible mascot animations stop when their pane is closed.
    $.clock.every(1000 / MASCOT_FPS, () => void animateMascots($).catch(() => undefined));
    await $.command.register({
      name: "jev",
      description: text("ui.command.description", config.locale),
      argumentHint: text("ui.command.argumentHint", config.locale),
      immediate: true,
    });
    return next(e);
  });

  on("classic.SessionStart", async ($, e, next) => {
    if (e.source === "clear" || e.source === "resume" || e.source === "fork") {
      await restoreStoredState($);
    }
    return next(e);
  }).catch((_$, e, next) => next(e));

  // A model the person picks is theirs: Jev's model stays out until they go back to the default.
  on("classic.PostModelSwitch", async (_$, e, next) => {
    if (e.source === "command" || e.source === "picker" || e.source === "sdk") userModel = e.requested_model !== null;
    return next(e);
  }).catch((_$, e, next) => next(e));

  // Subagent types, for the delegation question. Observed only: every type stays offered.
  // A name is written into the hint Claude reads, so only one inert token is kept.
  on("agent.offer", async ($, e, next) => {
    if (isSafeAgentName(e.agent)) agentTypes.set(e.agent, { name: e.agent, description: e.description });
    return next(e);
  }).catch((_$, e, next) => next(e));

  // The turn's routing point: decide on the conversation plus the prompt being submitted.
  on("prompt.submit", async ($, e, next) => {
    const config = await getSettings($);
    // A prompt typed into a running turn keeps that turn's plan: its tool hint, model and effort.
    if (e.turnId) {
      await log($, "jev", "jev", "muted", text("feed.request.midTurn", config.locale), undefined, { minor: true });
      return next(e);
    }
    const plan = await planFor($, e.text);
    pending = plan.decision;
    const reason = plan.decision.mode === "passthrough" ? plan.decision.reason : "";
    turnPlan = {
      ...(plan.model ? { model: TIER_MODEL[plan.model.value] } : {}),
      ...(plan.effort ? { effort: plan.effort.value } : {}),
      ...(plan.effortIgnored ? { effortIgnored: plan.effortIgnored.value } : {}),
      ...(reason === "jev_declined" ? { declined: true } : {}),
    };
    const failed = reason.startsWith("jev_error") || reason === "jev_unexpected_answer";
    const asked = plan.jev !== undefined || failed;
    const summary = asked ? planSummary(plan, config.locale) : reasonTitle(reason, config.locale);
    if (turnPlan) turnPlan.summary = summary;
    await setLive($, { decision: summary, jevUsed: asked });
    if (asked) {
      await log($, "jev", "jev", failed ? "bad" : "good", text("feed.request.consulted", config.locale, { summary }), undefined, {
        ...(plan.jev ? { meta: `${formatNumber(plan.jev.latencyMs, config.locale)} ms`, detail: text("feed.request.confidence", config.locale, { value: formatDecimal(plan.jev.confidence, config.locale), tokens: formatCompact(plan.jev.inputTokens, config.locale), choice: plan.jev.choice }) } : {}),
      });
    } else {
      await log($, "jev", "jev", "muted", text("feed.request.notConsulted", config.locale, { summary }), undefined, { minor: true });
    }
    const hint = planHint(plan, hintText, config.locale);
    if (!hint) return next(e);
    return next({ ...e, context: [...(e.context ?? []), `<system-reminder>${hint}</system-reminder>`] });
  }).catch((_$, e, next) => next(e));

  on("turn.start", async ($, e, next) => {
    const locale = (await getSettings($)).locale;
    if (e.text.trim()) await log($, "you", "turn", "info", short(e.text, 600));
    else await log($, "you", "turn", "muted", text("feed.request.continues", locale), undefined, { minor: true });
    await setLive($, { activity: text("feed.activity.waiting", locale) });
    // A turn you start once the wave has come back is your go-ahead for the fixes.
    const ended = await waveEnded($);
    await update($, flow, (f) => ({ ...f, turn: f.turn + 1, working: true, prompt: e.text, confirmed: f.confirmed || ended }));
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const locale = (await getSettings($)).locale;
    const seconds = formatDuration(e.durationMs, locale);
    const tokens = e.usage ? text("feed.usage.tokens", locale, { input: formatCompact(e.usage.input_tokens + (e.usage.cache_read_input_tokens ?? 0) + (e.usage.cache_creation_input_tokens ?? 0), locale), output: formatCompact(e.usage.output_tokens, locale), cache: "" }) : "";
    if (e.agentId) {
      const id = e.agentId;
      const state = e.isAborted ? "aborted" : e.reason === "error" ? "error" : "done";
      await log($, actor(id), "agent", state === "done" ? "good" : "bad", text("feed.turn.agentState", locale, { state: text(`feed.turn.state.${state}`, locale), answer: e.answer?.trim() ? text("feed.turn.answer", locale, { text: short(e.answer, 160) }) : "" }), undefined, {
        meta: seconds,
        detail: `${tokens || text("feed.turn.noUsage", locale)}${e.reason && e.reason !== "answer" ? text("feed.turn.endedBy", locale, { reason: ["error", "refusal", "aborted"].includes(e.reason) ? text(`feed.turn.reason.${e.reason}` as LocaleKey, locale) : e.reason }) : ""}`,
      });
      const endedAt = await $.clock.now();
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
    turnPlan = undefined;
    await setLive($, { activity: undefined, changed: undefined });
    await update($, flow, (f) => ({ ...f, working: false }));
    return next(e);
  });

  // Tools: log each call; after the batch's last result, route the next tool.
  on("tool.call", async ($, e, next) => {
    // Another plugin's own call ($.tool.call) is no step of Claude's: no routing, hint or count.
    if (!e.tool_use_id || next.origin.plugin !== "engine") return next(e);
    const locale = (await getSettings($)).locale;
    const who = actor(e.agentId);
    const summary = toolSummary(e.tool, e as unknown as Record<string, unknown>);
    toolStarts.set(e.tool_use_id, await $.clock.now());
    // One line per call: written as it starts, rewritten with its outcome when it ends.
    const input = e as unknown as Record<string, unknown>;
    const toolDetail = toolDetails(e.tool, input, locale);
    const line = await log($, who, "tool", "info", `▸ ${summary}`, e.agentId, { meta: text("feed.tool.running", locale), ...(toolDetail ? { detail: toolDetail } : {}) });
    if (!e.agentId) await setLive($, { activity: text("feed.activity.running", locale, { activity: short(summary, 40) }) });
    else await updateRun($, e.agentId, (run) => ({ ...run, tools: run.tools + 1, activity: text("feed.activity.agentTool", locale, { activity: short(summary, 60) }) }));
    const result = await next(e);
    const took = formatDuration((await $.clock.now()) - (toolStarts.get(e.tool_use_id) ?? 0), locale);
    toolStarts.delete(e.tool_use_id);
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
    if (!e.agentId && EDIT_TOOLS.has(e.tool) && result.deny === undefined && !result.isError) await countEdit($, e as unknown as Record<string, unknown>);
    if (e.agentId || result.deny !== undefined) return result;
    await setLive($, { activity: text("feed.activity.waiting", locale) });
    const messages = await $.session.messages();
    const batch = [...messages].reverse().find((message) => message.toolUses?.some((use) => use.tool_use_id === e.tool_use_id));
    const stillRunning = batch?.toolUses.some((use) => use.tool_use_id !== e.tool_use_id && use.text === undefined);
    if (stillRunning) return result;
    const decision = await routeTool($, {
      pending: {
        toolUseId: e.tool_use_id,
        tool: e.tool,
        text: result.isError ? String(result.text ?? "") : resultText(result.result),
      },
    });
    if (!decision) return result;
    pending = decision;
    if (decision.jev) {
      const what = decision.mode === "hint"
        ? text("feed.tool.next", locale, { tool: decision.tool, confidence: formatDecimal(decision.confidence, locale) })
        : text("feed.tool.noHint", locale, { reason: reasonTitle(decision.reason, locale) });
      await log($, "jev", "jev", "good", text("feed.request.consulted", locale, { summary: what }), undefined, {
        meta: `${formatNumber(decision.jev.latencyMs, locale)} ms`,
        detail: text("feed.tool.after", locale, {
          tool: e.tool,
          confidence: formatDecimal(decision.jev.confidence, locale),
          choice: decision.jev.choice,
          shortlist: decision.jev.shortlist ? text("feed.tool.shortlist", locale, { count: formatNumber(decision.jev.shortlist.length, locale) }) : "",
        }),
      });
      await setLive($, { decision: what, jevUsed: true });
    } else if (decision.mode === "passthrough" && decision.reason.startsWith("jev_error")) {
      const message = short(decision.reason.slice("jev_error: ".length), 80);
      await log($, "jev", "jev", "bad", text("feed.request.failed", locale, { message }));
      await setLive($, { decision: text("ui.band.jevFailed", locale), jevUsed: true });
    }
    if (decision.mode !== "hint") return result;
    return { ...result, context: [...(result.context ?? []), hintText(decision.tool, locale)] };
  }).catch((_$, e, next) => next(e));

  // Subagents: Jev picks the model and effort, unless Claude asked for a model itself.
  on("agent.spawn", async ($, e, next) => {
    if (e.workflow) return next(e);
    const flags = await read($, features);
    const config = await getSettings($);
    const routingOn = await read($, routing);
    const plan =
      flags.agents && routingOn && config.apiKey && !e.fork && !e.model
        ? await asking($, () => planAgent(e, config, createAskJev(config, transport($, config.locale)), flags))
        : {};
    const result = await next(plan.model ? { ...e, model: plan.model.value } : e);
    if (result.deny !== undefined) {
      await log($, "claude", "agent", "warn", text("feed.subagent.denied", config.locale, { type: e.subagentType, message: short(result.deny, 80) }));
      return result;
    }
    const id = result.agentId ?? e.tool_use_id;
    const haikuTarget = result.model.toLowerCase().includes("haiku");
    const appliedEffort = haikuTarget ? undefined : plan.effort;
    const ignoredEffort = plan.effortIgnored ?? (haikuTarget ? plan.effort : undefined);
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
      tokensIn: 0,
      tokensOut: 0,
      activity: text("feed.activity.starting", config.locale),
    });
    if (plan.error) await log($, "jev", "jev", "bad", text("feed.subagent.failedModel", config.locale, { type: e.subagentType, message: short(plan.error, 80) }), id);
    else if (plan.latencyMs !== undefined) await log($, "jev", "jev", "good", text("feed.subagent.chose", config.locale, { type: e.subagentType, choice: jevChose || text("feed.subagent.nothingConfident", config.locale) }), id, { meta: `${formatNumber(plan.latencyMs, config.locale)} ms` });
    if (ignoredEffort) await log($, "mod", "feature", "warn", text("feed.subagent.ignoredEffort", config.locale, { effort: ignoredEffort.value, model: modelName(result.model) }), id);
    if (isMascot(run.mascot)) agentRuns.get(id)!.mascot = run.mascot;
    // The first subagent of a turn starts a new wave; the rest of that turn's join it.
    await update($, flow, (f) =>
      f.waveTurn === f.turn && f.wave.length
        ? { ...f, wave: [...f.wave, run.n] }
        : { ...f, wave: [run.n], waveTurn: f.turn, ...(f.prompt ? { text: short(f.prompt, 200) } : {}), confirmed: false, edits: 0, files: [] },
    );
    await log($, actor(id), "agent", "info", text("feed.subagent.started", config.locale, { type: e.subagentType, number: formatNumber(run.n, config.locale), description: short(e.description, 80) }), undefined, {
      meta: `/jev agent ${run.n}`,
      detail: `${chosen.join(text("feed.usage.separator", config.locale))} · ${text("feed.subagent.task", config.locale, { prompt: short(e.prompt, 220) })}`,
    });
    await setLive($, { activity: text("ui.band.agent", config.locale, { name: `${e.subagentType} (${modelName(result.model)})` }) });
    return result;
  }).catch((_$, e, next) => next(e));

  // Each model request: apply Jev's model and effort, then meter it.
  on("turn.step", async function* ($, e, next) {
    const config = await getSettings($);
    const locale = config.locale;
    const startedAt = await $.clock.now();
    let decision: Decision;
    let model = e.model;
    let effort = e.effort;
    const changes: string[] = [];
    if (e.agentId) {
      decision = { mode: "passthrough", reason: "subagent" };
      const run = agentRuns.get(e.agentId);
      const haikuTarget = model.toLowerCase().includes("haiku");
      if (haikuTarget) {
        const ignoredEffort = run?.effort ?? (typeof e.effort === "string" ? e.effort : undefined);
        if (ignoredEffort) changes.push(text("feed.change.ignoredEffort", locale, { effort: ignoredEffort, model: modelName(model) }));
        effort = undefined;
      } else if (run?.effort) {
        if (typeof e.effort === "string") {
          if (e.effort !== run.effort) {
            effort = run.effort;
            changes.push(text("feed.change.effortSwitched", locale, { from: e.effort, to: run.effort }));
          }
        } else {
          changes.push(text("feed.change.effortNotApplied", locale, { effort: run.effort }));
        }
      }
    } else {
      decision = pending ?? { mode: "passthrough", reason: (await read($, routing)) ? "not_asked" : "routing_disabled" };
      pending = undefined;
      if (turnPlan?.model && !modelBroken && turnPlan.model !== e.model) {
        const kept: LocaleKey | undefined = userModel ? "feed.change.modelKeptChosen" : !switchableModel(e.model) ? "feed.change.modelKeptId" : undefined;
        if (!kept) {
          model = turnPlan.model;
          changes.push(text("feed.change.modelSwitched", locale, { from: modelName(e.model), to: modelName(model) }));
        } else if (!turnPlan.modelKept) {
          turnPlan.modelKept = true;
          await log($, "mod", "feature", "muted", text(kept, locale, { model: modelName(e.model), target: modelName(turnPlan.model) }), undefined, { minor: true });
        }
      }
      const haikuTarget = model.toLowerCase().includes("haiku");
      if (haikuTarget) {
        const ignoredEffort = turnPlan?.effortIgnored ?? turnPlan?.effort ?? (typeof e.effort === "string" ? e.effort : undefined);
        if (ignoredEffort) changes.push(text("feed.change.ignoredEffort", locale, { effort: ignoredEffort, model: modelName(model) }));
        effort = undefined;
      } else if (turnPlan?.effort) {
        if (typeof e.effort === "string" || model !== e.model) {
          if (e.effort !== turnPlan.effort) {
            effort = turnPlan.effort;
            changes.push(text("feed.change.effortSwitched", locale, { from: e.effort ?? text("feed.change.effortDefault", locale), to: turnPlan.effort }));
          }
        } else {
          changes.push(text("feed.change.effortNotApplied", locale, { effort: turnPlan.effort }));
        }
      }
    }
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
        changed: changes.length ? changes.join(", ") : undefined,
        activity: text("feed.activity.responding", locale),
      });
    }
    let sent = e;
    if (changes.length) {
      const { effort: _originalEffort, ...withoutEffort } = e;
      sent = { ...withoutEffort, model, ...(effort === undefined ? {} : { effort }) };
    }
    const result = yield* next(sent);
    // A model Jev picked that this account cannot use comes back empty: stop changing models.
    // An interrupted step (Esc) comes back empty too and is not counted; a dropped connection
    // looks the same as a refusal, so it takes two empty answers in a row.
    if (model !== e.model && !next.signal.aborted) {
      switchedEmpty = result.stopReason === null && !result.usage ? switchedEmpty + 1 : 0;
      if (switchedEmpty >= 2) {
        modelBroken = true;
        await log($, "mod", "error", "bad", text("feed.model.failed", locale, { model: modelName(model) }));
      }
    }
    if (result.answer.trim()) {
      await log($, who, "message", "info", `“${short(result.answer, 600)}”`, e.agentId);
    }
    const usage = result.usage;
    const cacheRead = usage?.cache_read_input_tokens ?? 0;
    const inTokens = usage ? usage.input_tokens + cacheRead + (usage.cache_creation_input_tokens ?? 0) : 0;
    const asked = [...new Set(result.toolUses.map((use) => use.name))];
    await patch($, requestLine, {
      meta: formatDuration((await $.clock.now()) - startedAt, locale),
      detail: [
        usage ? text("feed.usage.tokens", locale, { input: formatCompact(inTokens, locale), output: formatCompact(usage.output_tokens, locale), cache: inTokens ? text("feed.usage.cache", locale, { percent: formatPercent(cacheRead, inTokens, locale) }) : "" }) : text("feed.turn.noUsage", locale),
        result.toolUses.length ? text("feed.usage.tools", locale, { count: formatNumber(result.toolUses.length, locale), unit: text(result.toolUses.length === 1 ? "unit.toolCall" : "unit.toolCalls", locale), tools: asked.join(", ") }) : result.stopReason ? text("feed.usage.stop", locale, { reason: result.stopReason }) : "",
      ]
        .filter(Boolean)
        .join(text("feed.usage.separator", locale)),
    });
    if (e.agentId) {
      await updateRun($, e.agentId, (run) => ({
        ...run,
        tokensIn: run.tokensIn + (usage ? usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : 0),
        tokensOut: run.tokensOut + (usage?.output_tokens ?? 0),
        ...(result.answer.trim() ? { text: short(result.answer, 2000) } : {}),
        ...(run.state === "running" && result.toolUses.length === 0 ? { activity: text("feed.activity.writing", locale) } : {}),
      }));
    }
    await record($, {
      time: new Date(startedAt).toISOString(),
      session: sessionId,
      model: usage?.model ?? model ?? null,
      tools: lastToolCount,
      mode: decision.mode,
      ...(decision.mode === "passthrough" ? { reason: reasonKey(decision.reason) } : { tool: decision.tool, confidence: decision.confidence }),
      durationMs: (await $.clock.now()) - startedAt,
      ...(e.agentId ? { agent: agentRuns.get(e.agentId)?.type ?? "agent" } : {}),
      ...(effort === undefined ? {} : { effort: String(effort) }),
      ...(changes.length ? { plan: changes.join(", ") } : {}),
      ...(usage
        ? {
            usage: {
              input: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
              output: usage.output_tokens,
              cached: usage.cache_read_input_tokens ?? 0,
              cacheWrite: usage.cache_creation_input_tokens ?? 0,
            },
          }
        : {}),
      ...(decision.jev
        ? {
            jev: {
              choice: decision.jev.choice,
              confidence: decision.jev.confidence,
              latencyMs: decision.jev.latencyMs,
              inputTokens: decision.jev.inputTokens,
              ...(decision.jev.shortlist ? { shortlist: decision.jev.shortlist.length } : {}),
            },
          }
        : {}),
    });
    if (!e.agentId && result.toolUses.length === 0) await setLive($, { activity: undefined });
    return result;
  });

  on("command.run", { command: "jev" }, async ($, e) => {
    const locale = (await getSettings($)).locale;
    const [verb = "", arg = "", value = ""] = e.args.trim().toLowerCase().split(/\s+/);
    const tabFor: Record<string, JevTab> = {
      "": "overview",
      dashboard: "overview",
      overview: "overview",
      live: "live",
      agents: "agents",
      flow: "flow",
      features: "features",
      reasons: "reasons",
      baseline: "baseline",
      logs: "log",
      log: "log",
      setup: "setup",
    };
    if (verb === "agents" && arg === "clear") {
      const removed = await removeRuns($, () => true);
      return { text: removed.length === 1 ? text("ui.command.agentRemovedFromTab", locale) : removed.length > 1 ? text("ui.command.agentsRemoved", locale, { count: formatNumber(removed.length, locale) }) : text("ui.command.noFinished", locale) };
    }
    const which = tabFor[verb];
    if (which === "setup") {
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
    const width = Math.max(30, e.props.bodyColumns ?? 60);
    const rows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30;
    const key = await scrollKeyOf($, PANE);
    const shown = await view($, width, rows, e.surface, key);
    pingo = e.surface === "terminal" ? { mood: moodOf(shown), ...pingoSize(width) } : undefined;
    dice = e.surface === "terminal" && shown.tab === "live" ? diceSize(width) : undefined;
    return renderPane(els, shown, actions($, key));
  });

  // Each subagent's own live pane, `jev-agent-<n>`: its task, its numbers and its lines only.
  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (!e.requestId.startsWith(AGENT_PANE)) return next(e);
    const n = Number(e.requestId.slice(AGENT_PANE.length));
    const width = Math.max(30, e.props.bodyColumns ?? 60);
    const rows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30;
    const shown = await view($, width, rows, e.surface, e.requestId);
    const run = shown.agents.find((one) => one.n === n);
    if (e.surface !== "terminal" && e.surface !== "desktop") {
      const { Text } = $.ui.resolve(e);
      return <Text>{run
        ? text("ui.features.status", shown.locale, { name: agentTitle(run), state: text(`ui.agents.state.${run.state}` as LocaleKey, shown.locale), activity: run.activity ?? "" })
        : text("ui.features.agentNotKept", shown.locale, { number: formatNumber(n, shown.locale) })}</Text>;
    }
    if (e.surface === "terminal" && run && isMascot(run.mascot)) agentArt.set(e.requestId, { mascot: run.mascot, ...diceSize(width) });
    else agentArt.delete(e.requestId);
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

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const els = $.ui.resolve(e);
    return renderBand(els, await view($, e.props.bodyColumns ?? 80, 2, e.surface));
  });
};
