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
import type { EngineInterface, Register } from "claude-code";

import type { AgentRun, FeatureFlags, FeedEntry, FlowState, PaneScroll, FeedKind, FeedSpeaker, FeedTone, JevTab, LiveNow, RouteEvent, SetupDraft } from "../types";
import { resolveSettings, type ModOptions, type Settings, type StoredSettings } from "./config.ts";
import { decide, hintText, type Decision } from "./core/decide.ts";
import { createAskJev, isProvider, PROVIDERS, resolveModel, validateKey, type Transport } from "./core/jev.ts";
import {
  DEFAULT_FEATURES,
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
import { compactNumber, featureFlagsText, featureName, FEATURES, modelName, outputSize, short, toolDetails, toolSummary } from "./feed.ts";
import { resultText, toInput, type PendingResult } from "./input.ts";
import { cellsOf } from "./dots.ts";
import { diceFrame, diceSize } from "./mascots/dice.ts";
import { AGENT_MASCOTS, isMascot, mascotFrame, pickMascot, type MascotId } from "./mascots/agents.ts";
import { renderAgentPane, renderBand, renderPane, type Actions, type View } from "./ui.tsx";

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
const USAGE =
  "Usage: /jev [dashboard|live|agents [clear]|agent [n|type|mascot] [remove]|flow|features|reasons|baseline|logs|setup [provider]|status|routing on|off|feature <id> on|off|clear]";

// Module state: lost on a reload, which is fine for each of these.
let options: ModOptions = {};
let settings: Settings | undefined;
let system: string | undefined;
/** The tool decision for the main loop's next model request. */
let pending: Decision | undefined;
/** What Jev decided for the running turn: model and effort for its main-loop requests. */
let turnPlan: { model?: string; effort?: Effort; effortIgnored?: Effort; declined?: boolean; summary?: string } | undefined;
let lastToolCount = 0;
let sessionId = "";
let feedSeq = 0;
/** Subagent types Claude Code offers, as agent.offer reports them. */
const agentTypes = new Map<string, AgentType>();
/** Running subagents by id: their type, model and the effort Jev chose. */
const agentRuns = new Map<string, { type: string; model: string; effort?: Effort; description: string; mascot?: MascotId }>();
const toolStarts = new Map<string, number>();
/**
 * The key being typed in Setup, and the key accepted this session. Only here, in the module: the
 * pane's state holds a masked copy, and a saved key goes to Claude Code's secure plugin storage.
 */
let draftKey = "";
let sessionKey = "";
/** Set when a model Jev chose was refused: model changes stop for the session. */
let modelBroken = false;
/** Dice at the top of the live tab: drawn while that tab shows. */
let dice: { columns: number; rows: number } | undefined;
/** Each open subagent pane's mascot, by pane id. */
const agentArt = new Map<string, { mascot: MascotId; columns: number; rows: number }>();
const MASCOT_FPS = 10;

function transport($: EngineInterface): Transport {
  return {
    post: async (url, headers, body) => {
      const reply = await $.http.fetch(url, { method: "POST", headers, body });
      return { status: reply.status, ok: reply.ok, text: reply.text };
    },
    sleep: (ms) => $.clock.sleep(ms),
    within: (ms, work) =>
      new Promise((resolve, reject) => {
        const timer = $.clock.after(ms, () => reject(new Error(`timed out after ${ms} ms`)));
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
    ["TYPESAFE_API_KEY", await $.env.get("TYPESAFE_API_KEY")],
    ["OPENROUTER_API_KEY", await $.env.get("OPENROUTER_API_KEY")],
    ["AI_GATEWAY_API_KEY", await $.env.get("AI_GATEWAY_API_KEY")],
    ["OPENCODE_API_KEY", await $.env.get("OPENCODE_API_KEY")],
  ];
  return Object.fromEntries(pairs.filter((pair): pair is [string, string] => Boolean(pair[1]?.trim())));
}

async function storedSettings($: EngineInterface): Promise<StoredSettings> {
  // Older versions saved credentials as plain text in plugin state. Remove that copy and
  // continue using only Claude Code's sensitive option or the provider's environment variable.
  const legacyKey = await $.store.get(LEGACY_STORE_KEY);
  if (typeof legacyKey === "string") await $.store.delete(LEGACY_STORE_KEY);
  const provider = await $.store.get(STORE_PROVIDER);
  return {
    ...(typeof provider === "string" ? { provider } : {}),
  };
}

async function getSettings($: EngineInterface): Promise<Settings> {
  settings ??= resolveSettings(sessionKey ? { ...options, api_key: sessionKey } : options, await processEnv($), await storedSettings($));
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

/** Adds a subagent that just started, numbered after the last one; finished ones beyond the cap go. */
async function addRun($: EngineInterface, run: Omit<AgentRun, "n" | "mascot">): Promise<AgentRun> {
  let added: AgentRun | undefined;
  await update($, agents, (list) => {
    const n = Math.max(0, ...list.map((one) => one.n)) + 1;
    // A mascot no running subagent wears, so two at once never look alike.
    const mascot = pickMascot(list.filter((one) => one.state === "running").map((one) => one.mascot), n);
    added = { ...run, n, mascot };
    const all = [...list, added];
    const finished = all.filter((one) => one.state !== "running");
    const drop = new Set(finished.slice(0, Math.max(0, all.length - KEPT_AGENTS)).map((one) => one.id));
    return all.filter((one) => !drop.has(one.id));
  });
  return added!;
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

/** Repaints visible mascots in place; each stops when its pane no longer shows it. */
async function animateMascots($: EngineInterface): Promise<void> {
  const t = (await $.clock.now()) / 1000;
  if (dice) {
    const { columns, rows } = dice;
    const result = await $.ui.blit({ requestId: PANE, key: "dice", cells: cellsOf(diceFrame(t, columns, rows)), columns, rows });
    if (result.deny !== undefined) dice = undefined;
  }
  for (const [requestId, art] of agentArt) {
    const result = await $.ui.blit({ requestId, key: "mascot", cells: cellsOf(mascotFrame(art.mascot, t, art.columns, art.rows)), columns: art.columns, rows: art.rows });
    if (result.deny !== undefined) agentArt.delete(requestId);
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
  const input = toInput(await systemText($), messages, roster, config.maxMessageChars, { userText });
  return asking($, () => planTurn(input, config, createAskJev(config, transport($)), flags, [...agentTypes.values()]));
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
  const input = toInput(await systemText($), messages, roster, config.maxMessageChars, extra);
  return asking($, () => decide(input, config, createAskJev(config, transport($))));
}

async function record($: EngineInterface, event: Omit<RouteEvent, "seq">): Promise<void> {
  const stored = ((await $.store.get(STORE_EVENTS)) as RouteEvent[] | undefined) ?? [];
  const seq = (stored.at(-1)?.seq ?? 0) + 1;
  const kept = [...stored, { ...event, seq }].slice(-KEPT_EVENTS);
  await $.store.set(STORE_EVENTS, kept);
  await update($, events, () => kept);
}

/** Restore persisted choices after a session reset such as /clear, /resume, or /branch. */
async function restoreStoredState($: EngineInterface): Promise<void> {
  const storedEvents = (await $.store.get(STORE_EVENTS)) as RouteEvent[] | undefined;
  if (storedEvents) await update($, events, () => storedEvents);
  const storedRouting = (await $.store.get(STORE_ROUTING)) as boolean | undefined;
  if (typeof storedRouting === "boolean") await update($, routing, () => storedRouting);
  const storedFeatures = (await $.store.get(STORE_FEATURES)) as Partial<FeatureFlags> | undefined;
  if (storedFeatures) await update($, features, () => ({ ...DEFAULT_FEATURES, ...storedFeatures }));
}

// --- Settings, features, setup ---

async function setRouting($: EngineInterface, enabled: boolean): Promise<void> {
  await $.store.set(STORE_ROUTING, enabled);
  await update($, routing, () => enabled);
  await log($, "you", "feature", enabled ? "good" : "warn", enabled ? "Jev routing enabled" : "Jev routing disabled (baseline)");
}

async function setFeature($: EngineInterface, id: FeatureId, enabled: boolean): Promise<void> {
  const flags = await update($, features, (current) => ({ ...current, [id]: enabled }));
  await $.store.set(STORE_FEATURES, flags);
  await log($, "you", "feature", enabled ? "good" : "muted", `${featureName(id)}: ${enabled ? "enabled" : "disabled"}`);
}

async function clearHistory($: EngineInterface): Promise<void> {
  await $.store.set(STORE_EVENTS, []);
  await update($, events, () => []);
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
  return [
    `Routing: ${(await read($, routing)) ? "on" : "off (baseline)"}`,
    `Provider: ${PROVIDERS[config.provider].label} (${config.url})`,
    `Model: ${config.jevModel} · minimum confidence ${config.minConfidence} · timeout ${config.timeoutMs} ms`,
    `Key source: ${config.keySource}`,
    `Features: ${featureFlagsText(await read($, features))}`,
    `Requests logged: ${list.length} (the last ${KEPT_EVENTS}, shared by every session)`,
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

/** The `/config` row of this plugin's sensitive api_key option, as `$.config` names it. */
async function keyRow($: EngineInterface): Promise<string | undefined> {
  try {
    const rows = await $.config.list();
    return rows.find((row) => /^jev(@[^.]*)?\.api_key$/.test(row.key))?.key;
  } catch {
    return undefined;
  }
}

/** Writes the api_key option (secure storage); `""` removes it. Says why when Claude Code refused. */
async function saveKey($: EngineInterface, key: string): Promise<string | undefined> {
  const safe = (message: string) => (key ? message.replaceAll(key, "[redacted]") : message);
  const row = await keyRow($);
  if (!row) return "this Claude Code has no api_key option for the plugin";
  try {
    const result = await $.config.set({ key: row, value: key });
    return result.deny ? safe(result.deny) : undefined;
  } catch (error) {
    return safe(error instanceof Error ? error.message : String(error));
  }
}

/** Removes the saved key: the option, and this session's copy. The environment's stays. */
async function forgetKey($: EngineInterface): Promise<void> {
  draftKey = "";
  sessionKey = "";
  const refused = await saveKey($, "");
  settings = undefined;
  const config = await getSettings($);
  await update($, setup, (d) => ({
    ...d,
    typed: "",
    isOk: !refused,
    message: refused
      ? `The saved key could not be removed: ${refused}. Use /plugin configure jev@inline.`
      : config.apiKey
        ? `Saved key removed. The key from the ${config.keySource} is in use now.`
        : "Saved key removed. Paste a new one to route again.",
  }));
}

async function checkSetup($: EngineInterface): Promise<void> {
  const draft = await read($, setup);
  if (draftKey) return submitKey($, draft.provider);
  const current = await getSettings($);
  const id = isProvider(draft.provider) ? draft.provider : current.provider;
  try {
    await $.store.set(STORE_PROVIDER, id);
  } catch {
    await update($, setup, (d) => ({ ...d, message: "The provider selection could not be saved.", isOk: false }));
    return;
  }
  settings = undefined;
  const config = await getSettings($);
  if (!config.apiKey) {
    await update($, setup, (d) => ({
      ...d,
      provider: id,
      message: `No key is configured. Set the sensitive api_key option or ${PROVIDERS[id].keyEnv}, then test the connection.`,
      isOk: false,
    }));
    return;
  }
  await update($, setup, (d) => ({ ...d, provider: id, message: `Checking the connection to ${PROVIDERS[id].label}…`, isOk: true }));
  const check = await validateKey(id, config.apiKey, transport($), resolveModel(id, options.model?.trim()));
  if (!check.ok) {
    const message = check.refused
      ? `${PROVIDERS[id].label} refused the configured key. ${check.message}`
      : `Could not check the connection: ${check.message}`;
    await update($, setup, (d) => ({ ...d, message, isOk: false }));
    return;
  }
  await update($, setup, (d) => ({
    ...d,
    isOk: true,
    message: `Connection successful: ${PROVIDERS[id].label} responded in ${check.ms} ms. The key remains in secure plugin configuration or your environment.`,
  }));
}

/** Tests the typed key with the chosen provider; a key that works is saved and used at once. */
async function submitKey($: EngineInterface, provider: string): Promise<void> {
  const key = draftKey.trim();
  const current = await getSettings($);
  const id = isProvider(provider) ? provider : current.provider;
  if (!key) {
    await update($, setup, (d) => ({ ...d, message: "Paste a key first.", isOk: false }));
    return;
  }
  await update($, setup, (d) => ({ ...d, provider: id, busy: true, isOk: true, message: `Testing the key with ${PROVIDERS[id].label}…` }));
  const check = await validateKey(id, key, transport($), resolveModel(id, options.model?.trim()));
  if (!check.ok) {
    await update($, setup, (d) => ({
      ...d,
      busy: false,
      isOk: false,
      message: check.refused ? `${PROVIDERS[id].label} refused this key: ${check.message}` : `Could not reach ${PROVIDERS[id].label}: ${check.message}`,
    }));
    return;
  }
  await $.store.set(STORE_PROVIDER, id).catch(() => undefined);
  sessionKey = key;
  draftKey = "";
  settings = undefined;
  const refused = await saveKey($, key);
  await update($, setup, (d) => ({
    ...d,
    busy: false,
    typed: "",
    isOk: true,
    message: refused
      ? `Key works (${check.ms} ms) and is in use for this session, but it was not saved: ${refused}. Save it for good with /plugin configure jev@inline.`
      : `Key works (${check.ms} ms) and is saved in Claude Code's secure plugin storage.`,
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
    meta: `${PROVIDERS[config.provider].label} · ${config.jevModel} · minimum confidence ${config.minConfidence} · key source: ${config.keySource}`,
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

  on("session.start", async ($, e, next) => {
    sessionId = (await $.session.id()).slice(0, 8);
    await getSettings($);
    await restoreStoredState($);
    await setLive($, { model: await $.session.model() });
    // "Idle" and the 5-minute windows move with the clock, not only with events.
    $.clock.every(5000, () => $.ui.invalidate("ui.render"));
    // Visible mascot animations stop when their pane is closed.
    $.clock.every(1000 / MASCOT_FPS, () => void animateMascots($));
    await $.command.register({
      name: "jev",
      description: "Jev routing: dashboard, live log, features, routing on|off, status, setup",
      argumentHint: "[dashboard|live|agents [clear]|agent [n|type|mascot] [remove]|flow|features|reasons|baseline|logs|setup|status|routing on|off|feature <id> on|off|clear]",
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

  // Subagent types, for the delegation question. Observed only: every type stays offered.
  on("agent.offer", async ($, e, next) => {
    agentTypes.set(e.agent, { name: e.agent, description: e.description });
    return next(e);
  }).catch((_$, e, next) => next(e));

  // The turn's routing point: decide on the conversation plus the prompt being submitted.
  on("prompt.submit", async ($, e, next) => {
    const plan = await planFor($, e.text);
    pending = plan.decision;
    const reason = plan.decision.mode === "passthrough" ? plan.decision.reason : "";
    // A prompt typed into a running turn keeps that turn's model and effort.
    if (!e.turnId) {
      turnPlan = {
        ...(plan.model ? { model: TIER_MODEL[plan.model.value] } : {}),
        ...(plan.effort ? { effort: plan.effort.value } : {}),
        ...(plan.effortIgnored ? { effortIgnored: plan.effortIgnored.value } : {}),
        ...(reason === "jev_declined" ? { declined: true } : {}),
      };
    }
    const failed = reason.startsWith("jev_error") || reason === "jev_unexpected_answer";
    const asked = plan.jev !== undefined || failed;
    const summary = asked ? planSummary(plan) : reason;
    if (turnPlan) turnPlan.summary = summary;
    await setLive($, { decision: summary, jevUsed: asked });
    if (asked) {
      await log($, "jev", "jev", failed ? "bad" : "good", `consulted: ${summary}`, undefined, {
        ...(plan.jev ? { meta: `${plan.jev.latencyMs} ms`, detail: `confidence ${plan.jev.confidence.toFixed(2)} · ${compactNumber(plan.jev.inputTokens)} tokens in · pick ${plan.jev.choice}` } : {}),
      });
    } else {
      await log($, "jev", "jev", "muted", `not consulted: ${summary}`, undefined, { minor: true });
    }
    const hint = planHint(plan, hintText);
    if (!hint) return next(e);
    return next({ ...e, context: [...(e.context ?? []), `<system-reminder>${hint}</system-reminder>`] });
  }).catch((_$, e, next) => next(e));

  on("turn.start", async ($, e, next) => {
    if (e.text.trim()) await log($, "you", "turn", "info", short(e.text, 600));
    else await log($, "you", "turn", "muted", "continues the turn", undefined, { minor: true });
    await setLive($, { activity: "waiting for the model" });
    // A turn you start once the wave has come back is your go-ahead for the fixes.
    const ended = await waveEnded($);
    await update($, flow, (f) => ({ ...f, turn: f.turn + 1, working: true, prompt: e.text, confirmed: f.confirmed || ended }));
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const seconds = `${(e.durationMs / 1000).toFixed(1)}s`;
    const tokens = e.usage ? ` · in ${compactNumber(e.usage.input_tokens + (e.usage.cache_read_input_tokens ?? 0) + (e.usage.cache_creation_input_tokens ?? 0))} · out ${compactNumber(e.usage.output_tokens)}` : "";
    if (e.agentId) {
      const id = e.agentId;
      const state = e.isAborted ? "aborted" : e.reason === "error" ? "error" : "done";
      await log($, actor(id), "agent", state === "done" ? "good" : "bad", `■ ${state}${e.answer?.trim() ? `: “${short(e.answer, 160)}”` : ""}`, undefined, {
        meta: seconds,
        detail: `${tokens.slice(3) || "no usage reported"}${e.reason && e.reason !== "answer" ? ` · ended by ${e.reason}` : ""}`,
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
      agentRuns.delete(id);
      await setLive($, { activity: agentRuns.size ? `${agentRuns.size} subagent(s) running` : "waiting for the model" });
      return next(e);
    }
    const state = e.isAborted ? "aborted" : e.reason === "error" ? "failed" : e.reason === "refusal" ? "refused" : "completed";
    const troubled = e.isAborted || e.reason !== "answer";
    await log($, "mod", "turn", troubled ? "warn" : "muted", `■ turn ${state}`, undefined, {
      meta: seconds,
      ...(tokens ? { detail: tokens.slice(3) } : {}),
      minor: !troubled,
    });
    turnPlan = undefined;
    await setLive($, { activity: undefined, changed: undefined });
    await update($, flow, (f) => ({ ...f, working: false }));
    return next(e);
  });

  // Tools: log each call; after the batch's last result, route the next tool.
  on("tool.call", async ($, e, next) => {
    const who = actor(e.agentId);
    const summary = toolSummary(e.tool, e as unknown as Record<string, unknown>);
    toolStarts.set(e.tool_use_id, await $.clock.now());
    // One line per call: written as it starts, rewritten with its outcome when it ends.
    const input = e as unknown as Record<string, unknown>;
    const toolDetail = toolDetails(e.tool, input);
    const line = await log($, who, "tool", "info", `▸ ${summary}`, e.agentId, { meta: "running", ...(toolDetail ? { detail: toolDetail } : {}) });
    if (!e.agentId) await setLive($, { activity: `running ${short(summary, 40)}` });
    else await updateRun($, e.agentId, (run) => ({ ...run, tools: run.tools + 1, activity: `▸ ${short(summary, 60)}` }));
    const result = await next(e);
    const took = `${(((await $.clock.now()) - (toolStarts.get(e.tool_use_id) ?? 0)) / 1000).toFixed(1)}s`;
    toolStarts.delete(e.tool_use_id);
    if (result.deny !== undefined) {
      await patch($, line, { text: `⊘ ${summary}`, tone: "warn", meta: "denied", detail: [toolDetail, `denied: ${short(result.deny, 160)}`].filter(Boolean).join("\n") });
    } else {
      const outcome = result.isError ? `error: ${short(String(result.text ?? ""), 160)}` : outputSize(resultText(result.result));
      await patch($, line, {
        text: `${result.isError ? "✗" : "✓"} ${summary}`,
        tone: result.isError ? "bad" : "good",
        meta: took,
        detail: [toolDetail, outcome].filter(Boolean).join(" → "),
      });
    }
    if (e.agentId) await updateRun($, e.agentId, (run) => ({ ...run, activity: "waiting for the model" }));
    if (!e.agentId && EDIT_TOOLS.has(e.tool) && result.deny === undefined && !result.isError) await countEdit($, e as unknown as Record<string, unknown>);
    if (e.agentId || result.deny !== undefined) return result;
    await setLive($, { activity: "waiting for the model" });
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
      const what = decision.mode === "hint" ? `next tool ${decision.tool} (${decision.confidence.toFixed(2)})` : `no hint (${decision.reason})`;
      await log($, "jev", "jev", "good", `consulted: ${what}`, undefined, {
        meta: `${decision.jev.latencyMs} ms`,
        detail: `after ${e.tool} · confidence ${decision.jev.confidence.toFixed(2)} · pick ${decision.jev.choice}${decision.jev.shortlist ? ` · shortlist of ${decision.jev.shortlist.length}` : ""}`,
      });
      await setLive($, { decision: what, jevUsed: true });
    } else if (decision.mode === "passthrough" && decision.reason.startsWith("jev_error")) {
      await log($, "jev", "jev", "bad", `failed: ${short(decision.reason.slice(11), 80)}`);
      await setLive($, { decision: "Jev failed", jevUsed: true });
    }
    if (decision.mode !== "hint") return result;
    return { ...result, context: [...(result.context ?? []), hintText(decision.tool)] };
  }).catch((_$, e, next) => next(e));

  // Subagents: Jev picks the model and effort, unless Claude asked for a model itself.
  on("agent.spawn", async ($, e, next) => {
    if (e.workflow) return next(e);
    const flags = await read($, features);
    const config = await getSettings($);
    const routingOn = await read($, routing);
    const plan =
      flags.agents && routingOn && config.apiKey && !e.fork && !e.model
        ? await asking($, () => planAgent(e, config, createAskJev(config, transport($)), flags))
        : {};
    const result = await next(plan.model ? { ...e, model: plan.model.value } : e);
    if (result.deny !== undefined) {
      await log($, "claude", "agent", "warn", `◆ Subagent ${e.subagentType} was not started: ${short(result.deny, 80)}`);
      return result;
    }
    const id = result.agentId ?? e.tool_use_id;
    const haikuTarget = result.model.toLowerCase().includes("haiku");
    const appliedEffort = haikuTarget ? undefined : plan.effort;
    const ignoredEffort = plan.effortIgnored ?? (haikuTarget ? plan.effort : undefined);
    agentRuns.set(id, { type: e.subagentType, model: result.model, ...(appliedEffort ? { effort: appliedEffort.value } : {}), description: e.description });
    const chosen = [
      plan.model ? `model ${plan.model.value} (Jev ${plan.model.confidence.toFixed(2)})` : `model ${modelName(result.model)}${e.model ? " (requested by Claude)" : ""}`,
      appliedEffort ? `effort ${appliedEffort.value} (Jev)` : undefined,
    ].filter(Boolean);
    const jevChose = [plan.model ? `model ${plan.model.value}` : "", appliedEffort ? `effort ${appliedEffort.value}` : ""].filter(Boolean).join(" · ");
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
      activity: "starting",
    });
    if (plan.error) await log($, "jev", "jev", "bad", `failed to choose a model for ${e.subagentType}: ${short(plan.error, 80)}`, id);
    else if (plan.latencyMs !== undefined) await log($, "jev", "jev", "good", `chose for ${e.subagentType}: ${jevChose || "nothing confident"}`, id, { meta: `${plan.latencyMs} ms` });
    if (ignoredEffort) await log($, "mod", "feature", "warn", `Ignored ${ignoredEffort.value} effort: ${modelName(result.model)} does not support it.`, id);
    if (isMascot(run.mascot)) agentRuns.get(id)!.mascot = run.mascot;
    // The first subagent of a turn starts a new wave; the rest of that turn's join it.
    await update($, flow, (f) =>
      f.waveTurn === f.turn && f.wave.length
        ? { ...f, wave: [...f.wave, run.n] }
        : { ...f, wave: [run.n], waveTurn: f.turn, ...(f.prompt ? { text: short(f.prompt, 200) } : {}), confirmed: false, edits: 0, files: [] },
    );
    await log($, actor(id), "agent", "info", `◆ started as ${e.subagentType} #${run.n}: “${short(e.description, 80)}”`, undefined, {
      meta: `/jev agent ${run.n}`,
      detail: `${chosen.join(" · ")} · task: ${short(e.prompt, 220)}`,
    });
    await setLive($, { activity: `subagent ${e.subagentType} (${modelName(result.model)})` });
    return result;
  }).catch((_$, e, next) => next(e));

  // Each model request: apply Jev's model and effort, then meter it.
  on("turn.step", async function* ($, e, next) {
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
        if (ignoredEffort) changes.push(`ignored ${ignoredEffort} effort: ${modelName(model)} does not support it`);
        effort = undefined;
      } else if (run?.effort) {
        if (typeof e.effort === "string") {
          if (e.effort !== run.effort) {
            effort = run.effort;
            changes.push(`effort ${e.effort}→${run.effort}`);
          }
        } else {
          changes.push(`effort ${run.effort} not applied: model does not support it`);
        }
      }
    } else {
      decision = pending ?? { mode: "passthrough", reason: (await read($, routing)) ? "not_asked" : "routing_disabled" };
      pending = undefined;
      if (turnPlan?.model && !modelBroken && turnPlan.model !== e.model) {
        model = turnPlan.model;
        changes.push(`model ${modelName(e.model)}→${modelName(model)}`);
      }
      const haikuTarget = model.toLowerCase().includes("haiku");
      if (haikuTarget) {
        const ignoredEffort = turnPlan?.effortIgnored ?? turnPlan?.effort ?? (typeof e.effort === "string" ? e.effort : undefined);
        if (ignoredEffort) changes.push(`ignored ${ignoredEffort} effort: ${modelName(model)} does not support it`);
        effort = undefined;
      } else if (turnPlan?.effort) {
        if (typeof e.effort === "string" || model !== e.model) {
          if (e.effort !== turnPlan.effort) {
            effort = turnPlan.effort;
            changes.push(`effort ${e.effort ?? "default"}→${turnPlan.effort}`);
          }
        } else {
          changes.push(`effort ${turnPlan.effort} not applied: model does not support it`);
        }
      }
    }
    const who = actor(e.agentId);
    const effortText = effort === undefined ? "" : ` · effort ${effort}`;
    const loop = typeof who === "string" ? "" : ` of ${who.agent}`;
    if (changes.length) await log($, "jev", "step", "warn", `changed request ${e.index + 1}${loop}: ${changes.join(", ")}`, e.agentId);
    // Bookkeeping: drawn faint, filled in with its tokens and time once the model answers.
    const requestLine = await log($, "mod", "step", "muted", `→ request ${e.index + 1}${loop} · ${modelName(model)}${effortText}`, e.agentId, { minor: true, meta: "…" });
    if (e.agentId) await updateRun($, e.agentId, (run) => ({ ...run, model, requests: run.requests + 1, activity: "model responding" }));
    if (!e.agentId) {
      await setLive($, {
        model,
        effort: effort === undefined ? undefined : String(effort),
        changed: changes.length ? changes.join(", ") : undefined,
        activity: "model responding",
      });
    }
    let sent = e;
    if (changes.length) {
      const { effort: _originalEffort, ...withoutEffort } = e;
      sent = { ...withoutEffort, model, ...(effort === undefined ? {} : { effort }) };
    }
    const result = yield* next(sent);
    // A model Jev picked that this account cannot use comes back empty: stop changing models.
    if (model !== e.model && result.stopReason === null && !result.usage) {
      modelBroken = true;
      await log($, "mod", "error", "bad", `Model ${modelName(model)} did not respond; model switching is disabled for this session.`);
    }
    if (result.answer.trim()) {
      await log($, who, "message", "info", `“${short(result.answer, 600)}”`, e.agentId);
    }
    const usage = result.usage;
    const cacheRead = usage?.cache_read_input_tokens ?? 0;
    const inTokens = usage ? usage.input_tokens + cacheRead + (usage.cache_creation_input_tokens ?? 0) : 0;
    const asked = [...new Set(result.toolUses.map((use) => use.name))];
    await patch($, requestLine, {
      meta: `${(((await $.clock.now()) - startedAt) / 1000).toFixed(1)}s`,
      detail: [
        usage ? `in ${compactNumber(inTokens)} · out ${compactNumber(usage.output_tokens)}${inTokens ? ` · cache ${Math.round((100 * cacheRead) / inTokens)}%` : ""}` : "no usage reported",
        result.toolUses.length ? `asks for ${result.toolUses.length} tool${result.toolUses.length === 1 ? "" : "s"}: ${asked.join(", ")}` : result.stopReason ? `stop: ${result.stopReason}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
    if (e.agentId) {
      await updateRun($, e.agentId, (run) => ({
        ...run,
        tokensIn: run.tokensIn + (usage ? usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : 0),
        tokensOut: run.tokensOut + (usage?.output_tokens ?? 0),
        ...(result.answer.trim() ? { text: short(result.answer, 2000) } : {}),
        ...(run.state === "running" && result.toolUses.length === 0 ? { activity: "writing a response" } : {}),
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
      return { text: removed.length ? `Removed ${removed.length} finished subagent(s) from the Agents tab.` : "No finished subagent to remove." };
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
      return { text: arg === "on" ? "Jev routing is on." : "Jev routing is off: baseline mode, tokens still metered." };
    }
    if (verb === "feature") {
      const feature = FEATURES.find((one) => one.id === arg);
      if (!feature || (value !== "on" && value !== "off")) {
        return { text: `Usage: /jev feature <${FEATURES.map((one) => one.id).join("|")}> on|off` };
      }
      await setFeature($, feature.id, value === "on");
      return { text: `${feature.name}: ${value === "on" ? "enabled" : "disabled"}.` };
    }
    if (verb === "agent") {
      const list = await read($, agents);
      const run = findRun(list, arg);
      if (!run) {
        return { text: list.length ? `No subagent "${arg}". /jev agents lists them.` : "No subagent has run in this session yet." };
      }
      if (value === "remove") {
        if (run.state === "running") return { text: `${agentTitle(run)} is still running; remove it once it ends.` };
        await removeRuns($, (one) => one.id === run.id);
        return { text: `Removed ${agentTitle(run)} from the Agents tab.` };
      }
      await openAgentPane($, run);
      return {};
    }
    if (verb === "status") return { text: await statusText($) };
    if (verb === "clear") {
      await clearHistory($);
      return { text: "Jev request history cleared." };
    }
    return { text: USAGE };
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
      return <Text>{run ? `${agentTitle(run)}: ${run.state}${run.activity ? ` · ${run.activity}` : ""}` : `Subagent #${n} is no longer kept.`}</Text>;
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
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const els = $.ui.resolve(e);
    return renderBand(els, await view($, e.props.bodyColumns ?? 80, 2, e.surface));
  });
};
