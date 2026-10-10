import type { On } from "claude-code";
import { mock } from "claude-code/testing";
import { mockEngineServices } from "../helpers.ts";

/** The mock clock's start: every reset time below is counted from here. */
export const NOW = Date.parse("2026-10-07T12:00:00Z");

/** A reset time an hour and fourteen minutes after the mock clock's start. */
export const inAnHour = () => new Date(NOW + 3600_000 + 14 * 60_000).toISOString();

/** The origin the tests send commands and prompts from: the person's composer, as the other tests do. */
export const ORIGIN = { kind: "composer" } as const;

/** What a command carries from the composer: its origin and the pane it was typed in, as the other tests send it. */
export const ASK = { origin: ORIGIN, presentation: { isFullscreen: true, columns: 160 } } as const;

/** The surfaces a Deck view is drawn for, as the host names them. */
export const TERMINAL = "terminal" as const;
export const DESKTOP = "desktop" as const;

/** The usage the session reports unless a test gives its own. */
export const DEFAULT_USAGE = {
  startedAt: 0,
  context: { tokens: 124_000, window: 1_000_000, percent: 12 },
  cost: { usd: 0.42 },
  rateLimits: [
    { kind: "five_hour", percentUsed: 31, resetsAt: inAnHour() },
    { kind: "seven_day", percentUsed: 64, resetsAt: inAnHour() },
  ],
};

/** Open-Meteo's answer to a city lookup: the first hit, or none. */
export const LISBON = { name: "Lisbon", latitude: 38.72, longitude: -9.14, country: "Portugal" };

export type DeckWorldOptions = {
  /** The session's usage at the start; `state.usage` changes it later. */
  usage?: unknown;
  /** What `$.tool.call` answers; the engine's default is a plain result. */
  toolCall?: (...args: any[]) => unknown;
  /** The engine's `prompt.submit` answer; the default enters the text at once. */
  promptSubmit?: (...args: any[]) => unknown;
  /** What `$.agent.spawn` answers, as the engine's `agent.spawn` hook. */
  spawn?: (...args: any[]) => unknown;
  /** The city lookup's answer; `null` finds nothing. */
  city?: typeof LISBON | null;
  /** The forecast's current conditions. */
  forecast?: { temperature_2m: number; weather_code: number };
};

/**
 * Everything the engine answers for Deck: its store (in memory, returned so a test can read what
 * was saved), the mock clock, the session, the subagents, the audio, the panes, the network, and
 * what Claude Code shows of the router's status and log lines. `state` changes what the engine
 * answers from then on: the session's id, its usage, its subagents and the network.
 */
export function deckWorld(on: On, saved = new Map<string, unknown>(), options: DeckWorldOptions = {}) {
  const clock = mock.clock(on, { now: NOW });
  mockEngineServices(on);
  mock.env(on, {});
  const state = {
    sessionId: "session-1",
    usage: (options.usage ?? DEFAULT_USAGE) as any,
    agents: [] as { id: string; status: string }[],
    network: true,
    city: options.city === undefined ? LISBON : options.city,
    forecast: options.forecast ?? { temperature_2m: 21.4, weather_code: 3 },
    /** What the host answers a repaint: it takes it, refuses it (nothing mounted there), or has no such call. */
    blit: "take" as "take" | "deny" | "throw",
  };
  const blits: { requestId: string; key: string; columns: number | undefined; rows: number | undefined; cells: string }[] = [];
  const invalidations: string[] = [];
  const fetched: string[] = [];
  const played: { asset: string; gain?: number }[] = [];
  const panes: string[] = [];
  const logs: { text: string; to: string }[] = [];
  const statuses: string[] = [];
  const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  on("store.get", async (_$, e) => ({ value: clone(saved.get(e.key)) }));
  on("store.set", async (_$, e) => {
    saved.set(e.key, clone(e.value));
    return { value: undefined };
  });
  on("store.delete", async (_$, e) => {
    saved.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", async () => ({ value: [...saved.keys()] }));
  on("command.register", async () => ({ value: { command: "deck" } }));
  on("audio.play", async (_$, e) => {
    played.push({ asset: e.clip.asset ?? "", gain: e.gain });
    return { value: undefined };
  });
  on("agent.list", async () => ({ value: state.agents }) as never);
  on("ui.open", async (_$, e) => {
    panes.push(e.id);
    return { value: { isPlaced: true } };
  });
  on("ui.close", async (_$, e) => {
    panes.splice(0, panes.length, ...panes.filter((id) => id !== e.id));
    return { value: undefined };
  });
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: state.sessionId }));
  on("session.usage", async () => ({ value: state.usage }));
  on("session.start", async () => ({ cwd: "/work" }));
  on("tool.list", async () => ({ value: [] }));
  on("session.messages", async () => ({ value: [] }));
  on("http.fetch", async (_$, e) => {
    fetched.push(e.url);
    if (!state.network) return { deny: "no network in tests" } as never;
    if (e.url.startsWith("https://geocoding-api.open-meteo.com/")) {
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ results: state.city ? [state.city] : [] }) } };
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ current: state.forecast }) } };
  });
  on("prompt.submit", (options.promptSubmit ?? (async (_$: unknown, e: { text: string }) => ({ text: e.text }))) as never);
  on("turn.start", async (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", async () => ({ text: "" }));
  on("tool.call", (options.toolCall ?? (async () => ({ result: "ok" }))) as never);
  on("tool.check", async () => ({ decision: "ask" }) as never);
  on("classic.Stop", async () => ({}) as never);
  on("classic.SubagentStop", async () => ({}) as never);
  on("classic.TaskCreated", async () => ({}) as never);
  on("classic.TaskCompleted", async () => ({}) as never);
  on("agent.spawn", (options.spawn ?? (async () => ({ model: "claude-opus-5-5", agentId: "a0" }))) as never);
  on("session.measure", async (_$, e) => ({ changed: e.changed }));
  on("ui.status", async (_$, e) => {
    if (e.text) statuses.push(e.text);
    return { value: undefined } as never;
  });
  on("ui.log", async (_$, e) => {
    logs.push({ text: e.text, to: e.to });
    return { value: undefined } as never;
  });
  on("ui.blit", async (_$, e) => {
    if (state.blit === "throw") throw new Error("no repaint here");
    blits.push({ requestId: e.requestId, key: e.key, columns: e.columns, rows: e.rows, cells: "cells" in e ? e.cells : "" });
    return { value: state.blit === "deny" ? { deny: "nothing of this plugin's is mounted there" } : {} };
  });
  on("ui.invalidate", async (_$, e, next) => {
    invalidations.push(e.event);
    return next(e);
  });
  on("ui.render", async () => ({ type: "Text", props: {}, children: ["engine"] }) as never);
  return { saved, clock, state, fetched, played, panes, logs, statuses, blits, invalidations };
}

/** A TodoWrite list in the middle of its third step. */
export const TODOS = [
  { content: "Map routes", activeForm: "Mapping routes", status: "completed" },
  { content: "Write tests", activeForm: "Writing tests", status: "completed" },
  { content: "Fix auth", activeForm: "Fixing auth", status: "in_progress" },
  { content: "Run suite", activeForm: "Running suite", status: "pending" },
  { content: "Report", activeForm: "Reporting", status: "pending" },
];

/** The shape a subagent spawn takes, as `$.agent.spawn` is called with it. */
export const spawn = (description: string) => ({
  tool_use_id: "t-" + description,
  provider: { plugin: "engine", tier: "core" } as const,
  parentModel: "claude-opus-5-5",
  background: false,
  fork: false,
  prompt: "go",
  description,
  subagentType: "Explore",
});
