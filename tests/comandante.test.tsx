// The Comandante: with its switch on, Jev judges each Farol assumption and Semente idea where it arises. Rejected is
// denied with its reason, questioned goes back to the agent with a question and is not recorded, approved goes through.
// Its tab chooses which assistants it judges (all by default); one switched off goes on as if the Comandante were off.
// What waits unjudged (raised while it, or the source, was off) is judged the moment the switch turns on, never on a
// clock, and once only; the Farol and Semente panes name the ruling. Before Semente's nudge offers saved ideas, each
// is judged too. Each decision lands in this session's file of the project's shared folder, which the tab of every
// session reads, naming the session it came from. With the switch off, Jev is not asked and the tools answer as always.
import type { On } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";
import { COMANDANTE_VERDICTS, comandanteRecords, comandanteRequest, comandanteSourcesAll, comandanteVerdict, filterComandante, mergeComandante, normalizeComandanteSources } from "../hooks/core/comandante.ts";
import { DEFAULT_FEATURES, type Features } from "../hooks/core/plan.ts";
import type { Answer, SystemOneRequest } from "../hooks/core/types.ts";
import { text } from "../hooks/i18n.ts";
import type { ComandanteRecord } from "../types";
import { GLYPH } from "../hooks/theme.ts";
import { NOW } from "./deck/helpers.ts";
import { answerJev, mockStore, PANE_PROPS, pick, plain } from "./helpers.ts";

declare const setTimeout: (callback: () => void, ms: number) => unknown;

const LOCALE = { options: { locale: "en" } } as const;
// No HOME in the test's environment: this project's folder is /.claude/jev-vigia/-workspace (C:\ on Windows).
const DIR = "/.claude/jev-vigia/-workspace/comandante";
const OWN = "session-fix";
const PEER = "peer-aaaa-1111";

const peerRecord = (over: Partial<ComandanteRecord> = {}): ComandanteRecord => ({
  id: `${PEER}-1`, at: NOW - 60_000, session: PEER, sessionName: "Parser fix", project: "workspace", source: "semente",
  summary: "Cache the parsed config", decision: "approved", reason: "approve_fits", confidence: 0.8, ...over,
});

/** Jev's answers: one table for every request (live: a test may change it), or one per request. */
type Table = Record<string, Answer> | ((request: SystemOneRequest) => Record<string, Answer>);

/**
 * A session of the project at /workspace with Jev answering from `table`, its stored feature preferences `prefs`, and
 * its files in memory: the Comandante's folder holds the other sessions' files of `seed`, then whatever this session
 * (or `peer`, another session) writes; each write moves the file's time and size, as on disk.
 */
function comandanteWorld(on: On, flags: Partial<Features>, table: Table, seed: Record<string, ComandanteRecord[]> = {}, prefs?: Record<string, unknown>) {
  const clock = mock.clock(on, { now: NOW });
  const store: Record<string, unknown> = { provider: "typesafe", features: { ...DEFAULT_FEATURES, ...flags }, ...(prefs ? { featurePreferences: prefs } : {}) };
  mockStore(on, store);
  mock.env(on, { TYPESAFE_API_KEY: "test-key" });
  on("session.root", async () => ({ value: "/workspace" }));
  on("session.id", async () => ({ value: OWN }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.start", async () => ({ cwd: "/workspace" }) as never);
  on("session.messages", async () => ({ value: [] }));
  on("tool.list", async () => ({ value: [] }));
  on("tool.register", async (_$, e) => ({ value: { tool: `mcp__jev__${e.name}` } }));
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("ui.open", async () => ({ value: { isPlaced: true } }) as never);
  const toasts: string[] = [];
  on("ui.toast", async (_$, e) => {
    toasts.push(e.text);
    return { value: undefined } as never;
  });
  const jev = { asked: [] as SystemOneRequest[] };
  on("http.fetch", async (_$, e) => {
    const request = JSON.parse(e.init?.body ?? "{}") as SystemOneRequest;
    jev.asked.push(request);
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: answerJev(request, typeof table === "function" ? table(request) : table), usage: { input_tokens: 200, output_tokens: 0 } }) } };
  });
  const files = new Map<string, string>(Object.entries(seed).map(([id, records]) => [`${DIR}/${id}.json`, JSON.stringify(records)]));
  const written = new Map<string, number>();
  let writes = 0;
  on("fs.exists", async (_$, e) => ({ value: plain(e.path) === DIR ? [...files.keys()].some((file) => file.startsWith(DIR)) : files.has(plain(e.path)) }));
  on("fs.write", async (_$, e) => {
    files.set(plain(e.path), e.text);
    written.set(plain(e.path), ++writes);
    return { value: undefined };
  });
  on("fs.list", async (_$, e) => ({ value: [...files.entries()].filter(([file]) => file.startsWith(`${plain(e.path)}/`)).map(([file, body]) => ({ name: file.slice(plain(e.path).length + 1), kind: "file" as const, size: body.length, mtimeMs: NOW + (written.get(file) ?? 0) })) }) as never);
  on("fs.read", async (_$, e) => {
    const found = files.get(plain(e.path));
    if (found === undefined) throw new Error(`no such file: ${e.path}`);
    return { value: found } as never;
  });
  /** Another session of the project writes its whole file. */
  const peer = (id: string, records: ComandanteRecord[]) => {
    files.set(`${DIR}/${id}.json`, JSON.stringify(records));
    written.set(`${DIR}/${id}.json`, ++writes);
  };
  return { jev, store, toasts, files, clock, peer };
}

/** This session's records, as its file holds them. */
const ownRecords = (files: Map<string, string>) => comandanteRecords(JSON.parse(files.get(`${DIR}/${OWN}.json`) ?? "[]"));
/** Whether this session wrote any Comandante file. */
const wroteLog = (files: Map<string, string>) => [...files.keys()].some((file) => file.startsWith(DIR));

/** One short wait: the work in flight runs a little, the clock standing still. */
const wait = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
/** Lets the work in flight run, the clock standing still, until `done` (at most 60 short waits): no beat did it. */
async function settle(done: () => boolean) {
  for (let i = 0; i < 60 && !done(); i++) await wait();
}

/** What Jev was asked about, request by request: the alert's words. */
const alerts = (jev: { asked: SystemOneRequest[] }) => jev.asked.map((request) => String(request.state?.alert ?? ""));
/** Semente's shelf as stored for /workspace. */
const shelf = (store: Record<string, unknown>) => (store["semente:ideas:/workspace"] ?? []) as { id: string; text: string; source: string; comandante?: { decision: string; reason: string } }[];
const ASK = { origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as const;

/** The Jev pane mounted on the Comandante tab. */
async function comandanteTab($: { ui: { mount: (input: never) => Promise<unknown> } }) {
  const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS } as never) as {
    press: (input: { key: string }) => Promise<unknown>;
    find: (query: { type?: string; key?: string; text?: string | RegExp }) => Promise<{ props: Record<string, unknown> } | undefined>;
    select: (input: { key: string; value: string }) => Promise<unknown>;
    unmount: () => Promise<unknown>;
  };
  await ui.press({ key: "tab-comandante" });
  return ui;
}

/** The Farol pane as it is drawn now. */
async function farolPane($: { ui: { mount: (input: never) => Promise<{ find: (query: never) => Promise<unknown>; unmount: () => Promise<unknown> }> } }) {
  return await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "farol", props: PANE_PROPS } as never);
}

const farol = async ($: { tool: { call: (input: never) => Promise<unknown> } }, assumption: string) =>
  (await $.tool.call({ tool: "mcp__jev__farol_assumption", tool_use_id: "toolu-farol", assumption, context: "src/config.ts" } as never)) as { result?: string; deny?: string };
const semente = async ($: { tool: { call: (input: never) => Promise<unknown> } }, idea: string) =>
  (await $.tool.call({ tool: "mcp__jev__semente_shelve", tool_use_id: "toolu-semente", text: idea } as never)) as { result?: string; deny?: string };

describe("the Comandante's pure parts", () => {
  test("Jev is asked one choice among the verdicts, about the alert, the request and what is already recorded", () => {
    const request = comandanteRequest({ source: "farol", text: "The config is YAML", context: "src/config.ts" }, "Add a config loader", ["Use JSON (not: config is YAML)"]);
    const question = request.questions.verdict;
    expect(question?.type).toBe("choice");
    expect(Object.keys(question?.type === "choice" ? question.criteria : {})).toEqual(Object.keys(COMANDANTE_VERDICTS));
    expect(request.state).toMatchObject({ alert: "The config is YAML", context: "src/config.ts", request: "Add a config loader", known: ["Use JSON (not: config is YAML)"] });
  });

  test("each verdict reads as its decision; an answer not offered reads as none", () => {
    expect(comandanteVerdict({ answers: { verdict: pick("reject_risky", 0.7) } })).toEqual({ decision: "rejected", reason: "reject_risky", confidence: 0.7 });
    expect(comandanteVerdict({ answers: { verdict: pick("question_vague", 0.6) } })?.decision).toBe("questioned");
    expect(comandanteVerdict({ answers: { verdict: pick("approve_sound", 0.9) } })?.decision).toBe("approved");
    expect(comandanteVerdict({ answers: { verdict: pick("maybe", 0.9) } })).toBeUndefined();
    expect(comandanteVerdict({ answers: {} })).toBeUndefined();
  });

  test("every source is judged by default; a stored list keeps only a source switched off with false", () => {
    const all = { farol: true, semente: true, vigia: true, clareza: true, codeQuality: true };
    expect(normalizeComandanteSources(undefined)).toEqual(all);
    for (const broken of [null, "farol", 3, true, ["farol"], {}]) expect(normalizeComandanteSources(broken)).toEqual(all);
    // only false turns one off: a word, a number or an unknown source changes nothing
    expect(normalizeComandanteSources({ farol: false, semente: "no", vigia: 0, prisma: false })).toEqual({ ...all, farol: false });
    expect(comandanteSourcesAll(false)).toEqual({ farol: false, semente: false, vigia: false, clareza: false, codeQuality: false });
    expect(comandanteSourcesAll(true)).toEqual(all);
  });

  test("a nudge asks Jev whether a saved idea is worth offering now, not whether to save it", () => {
    const saving = comandanteRequest({ source: "semente", text: "Cache the parsed config" }, "", []);
    const nudge = comandanteRequest({ source: "semente", text: "Cache the parsed config", nudge: true }, "", []);
    expect(String(saving.state.kind)).toContain("save for later");
    expect(String(nudge.state.kind)).toContain("offered to the user");
  });

  test("a file's records keep only whole ones; the log merges every session's, newest first, and filters them", () => {
    const own = peerRecord({ id: "own-1", session: OWN, at: NOW, decision: "rejected", reason: "reject_noise", source: "farol" });
    expect(comandanteRecords([peerRecord(), { id: "broken" }, { ...peerRecord(), decision: "maybe" }, "text"])).toEqual([peerRecord()]);
    const log = mergeComandante([[peerRecord()], [own, peerRecord()]]);
    expect(log.map((record) => record.id)).toEqual(["own-1", `${PEER}-1`]);
    expect(filterComandante(log, { session: PEER, decision: "all" }).map((record) => record.id)).toEqual([`${PEER}-1`]);
    expect(filterComandante(log, { session: "all", decision: "rejected" }).map((record) => record.id)).toEqual(["own-1"]);
    expect(filterComandante(log, { session: PEER, decision: "rejected" })).toEqual([]);
  });
});

describe("the Comandante in a session", () => {
  test("rejected: the assumption is denied with its reason, Farol records nothing, and the log names this session", LOCALE, async ($, on) => {
    const table: Record<string, Answer> = { verdict: pick("reject_risky", 0.9) };
    const { jev, toasts, files } = comandanteWorld(on, { comandante: true }, table);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);

    const rejected = await farol($, "Dropping the old config format is fine");
    expect(rejected.deny).toBe(text("feature.comandante.tool.rejected.farol", "en", { reason: text("feature.comandante.reason.reject_risky", "en") }));
    expect(jev.asked).toHaveLength(1);
    expect(jev.asked[0]!.state).toMatchObject({ alert: "Dropping the old config format is fine", context: "src/config.ts" });
    expect(toasts.some((toast) => toast.startsWith("Comandante: rejected — Farol: Dropping the old config format is fine"))).toBe(true);
    const [record] = ownRecords(files);
    expect(record).toMatchObject({ session: OWN, project: "workspace", source: "farol", summary: "Dropping the old config format is fine", decision: "rejected", reason: "reject_risky", confidence: 0.9 });

    // the rejected assumption took no number: the next one, approved, is recorded as #1
    table.verdict = pick("approve_fits", 0.8);
    expect((await farol($, "Keep the loader synchronous")).result).toContain(text("feature.farol.recorded", "en", { id: 1 }));
  });

  test("questioned: the question goes back to the agent as the tool's result, and Semente saves nothing", LOCALE, async ($, on) => {
    const { jev, store, files } = comandanteWorld(on, { comandante: true }, { verdict: pick("question_vague", 0.6) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);

    const questioned = await semente($, "Improve things later");
    expect(questioned.deny).toBeUndefined();
    expect(questioned.result).toBe(text("feature.comandante.tool.questioned.semente", "en", {
      reason: text("feature.comandante.reason.question_vague", "en"),
      question: text("feature.comandante.question.question_vague", "en"),
    }));
    expect(jev.asked).toHaveLength(1);
    expect(store["semente:ideas:/workspace"]).toBeUndefined();
    expect(ownRecords(files)).toMatchObject([{ session: OWN, source: "semente", decision: "questioned", reason: "question_vague" }]);
  });

  test("approved: the idea is shelved and the assumption recorded, each answer saying the Comandante approved it", LOCALE, async ($, on) => {
    const { store, files } = comandanteWorld(on, { comandante: true }, { verdict: pick("approve_fits", 0.85) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);

    const approved = text("feature.comandante.tool.approved", "en", { reason: text("feature.comandante.reason.approve_fits", "en") });
    expect((await semente($, "Cache the parsed config")).result).toBe(`${text("feature.semente.shelved", "en", { idea: "Cache the parsed config" })} ${approved}`);
    expect((store["semente:ideas:/workspace"] as { text: string }[]).map((idea) => idea.text)).toEqual(["Cache the parsed config"]);
    expect((await farol($, "The loader stays synchronous")).result).toBe(`${text("feature.farol.recorded", "en", { id: 1 })} ${approved}`);
    expect(ownRecords(files).map((record) => [record.source, record.decision])).toEqual([["semente", "approved"], ["farol", "approved"]]);
  });

  test("Jev without a usable verdict leaves both tools as they are without the Comandante", LOCALE, async ($, on) => {
    const { jev, files } = comandanteWorld(on, { comandante: true }, {});
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);

    expect((await farol($, "The config is YAML")).result).toBe(text("feature.farol.recorded", "en", { id: 1 }));
    expect(jev.asked).toHaveLength(1);
    expect(wroteLog(files)).toBe(false);
  });

  test("switched off (the default): Jev is never asked and both tools answer exactly as before", LOCALE, async ($, on) => {
    const { jev, store, files, clock } = comandanteWorld(on, {}, { verdict: pick("reject_risky", 0.9) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);

    expect(await farol($, "The config is YAML")).toEqual({ result: text("feature.farol.recorded", "en", { id: 1 }) });
    expect(await semente($, "Cache the parsed config")).toEqual({ result: text("feature.semente.shelved", "en", { idea: "Cache the parsed config" }) });
    expect((store["semente:ideas:/workspace"] as { text: string }[]).map((idea) => idea.text)).toEqual(["Cache the parsed config"]);
    // the open assumption waits for the person: no beat of the clock puts it to Jev
    for (let i = 0; i < 5; i++) await clock.advance(1000);
    expect(jev.asked).toHaveLength(0);
    expect(wroteLog(files)).toBe(false);
  });

  test("approved: the Farol pane says the Comandante approved it, not that it was sent to Claude", LOCALE, async ($, on) => {
    comandanteWorld(on, { comandante: true }, { verdict: pick("approve_fits", 0.9) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await farol($, "Keep the loader synchronous");

    const ui = await farolPane($ as never);
    expect(await ui.find({ type: "Text", text: text("feature.farol.byComandante", "en") } as never)).toBeDefined();
    expect(await ui.find({ type: "Text", text: text("feature.farol.sent", "en") } as never)).toBeUndefined();
    await ui.unmount();
  });

  test("an assumption raised while the Comandante was off is judged the moment it is switched on: approved, it is marked right for Claude", LOCALE, async ($, on) => {
    const { jev, files } = comandanteWorld(on, {}, { verdict: pick("approve_sound", 0.8) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    expect((await farol($, "The loader stays synchronous")).result).toBe(text("feature.farol.recorded", "en", { id: 1 }));
    expect(jev.asked).toHaveLength(0);

    await $.command.run({ command: "jev", ...ASK, args: "feature comandante on" });
    await settle(() => ownRecords(files).length > 0);
    expect(jev.asked).toHaveLength(1);
    // judged as itself, not as a repeat of its own record
    expect(jev.asked[0]!.state).toMatchObject({ alert: "The loader stays synchronous", context: "src/config.ts", known: [] });
    expect(ownRecords(files)).toMatchObject([{ session: OWN, source: "farol", decision: "approved", reason: "approve_sound" }]);
    // right, and pending: Claude hears it with its next step, as with the person's ✓
    const ui = await farolPane($ as never);
    expect(await ui.find({ type: "Text", text: "#1 The loader stays synchronous" } as never)).toBeDefined();
    expect(await ui.find({ type: "Text", text: GLYPH.ok } as never)).toBeDefined();
    expect(await ui.find({ type: "Text", text: text("feature.farol.pending", "en") } as never)).toBeDefined();
    await ui.unmount();
  });

  test("an assumption Jev could not judge as it arrived is never put to it again, however often the Comandante looks", LOCALE, async ($, on) => {
    const table: Record<string, Answer> = {};
    const { jev, files, clock } = comandanteWorld(on, { comandante: true }, table);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    expect((await farol($, "The loader stays synchronous")).result).toBe(text("feature.farol.recorded", "en", { id: 1 }));
    expect(jev.asked).toHaveLength(1);

    // Jev answers now, and the Comandante looks again (Farol switched back on), and the clock runs: it stays open
    table.verdict = pick("approve_sound", 0.8);
    await $.command.run({ command: "jev", ...ASK, args: "feature farol off" });
    await $.command.run({ command: "jev", ...ASK, args: "feature farol on" });
    for (let i = 0; i < 5; i++) await clock.advance(1000);
    await settle(() => false);
    expect(jev.asked).toHaveLength(1);
    expect(wroteLog(files)).toBe(false);
  });

  test("a source switched on in the tab has its open items judged at once: questioned, the assumption stays open with the question", LOCALE, async ($, on) => {
    const { jev, files, store } = comandanteWorld(on, { comandante: true }, { verdict: pick("question_context", 0.6) }, {}, { comandanteSources: { farol: false } });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    // Farol off in the Comandante's list: recorded open, as without the Comandante
    expect(await farol($, "The config is YAML")).toEqual({ result: text("feature.farol.recorded", "en", { id: 1 }) });
    expect(jev.asked).toHaveLength(0);

    const tab = await comandanteTab($);
    await tab.press({ key: "comandante-source-farol" });
    await settle(() => ownRecords(files).length > 0);
    await tab.unmount();
    expect((store.featurePreferences as { comandanteSources: Record<string, boolean> }).comandanteSources.farol).toBe(true);
    expect(jev.asked).toHaveLength(1);
    expect(ownRecords(files)).toMatchObject([{ source: "farol", decision: "questioned", reason: "question_context" }]);
    const ruling = `${text("feature.farol.comandante", "en", { decision: text("feature.comandante.decision.questioned", "en"), reason: text("feature.comandante.reason.question_context", "en") })} ${text("feature.comandante.question.question_context", "en")}`;
    const ui = await farolPane($ as never);
    expect(await ui.find({ type: "Text", text: "#1 The config is YAML" } as never)).toBeDefined();
    expect(await ui.find({ type: "Text", text: GLYPH.ask } as never)).toBeDefined();
    expect(await ui.find({ type: "Text", text: ruling } as never)).toBeDefined();
    await ui.unmount();
    expect(jev.asked).toHaveLength(1);
  });

  test("a source switched off asks Jev nothing and records nothing; the others are still judged", LOCALE, async ($, on) => {
    const { jev, files } = comandanteWorld(on, { comandante: true }, { verdict: pick("reject_risky", 0.9) }, {}, { comandanteSources: { farol: false, clareza: false } });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);

    expect(await farol($, "Dropping the old config format is fine")).toEqual({ result: text("feature.farol.recorded", "en", { id: 1 }) });
    expect(jev.asked).toHaveLength(0);
    expect(wroteLog(files)).toBe(false);
    // Semente is still on: its idea is judged, and rejected
    expect((await semente($, "Rewrite everything")).deny).toBe(text("feature.comandante.tool.rejected.semente", "en", { reason: text("feature.comandante.reason.reject_risky", "en") }));
    expect(alerts(jev)).toEqual(["Rewrite everything"]);
    expect(ownRecords(files).map((record) => record.source)).toEqual(["semente"]);
  });

  test("every source is on by default, and a stored list that is not one reads as every source on", LOCALE, async ($, on) => {
    const { store } = comandanteWorld(on, { comandante: true }, {}, {}, { comandanteSources: "everything", monitorEveryMs: 5000 });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    // stored back whole: every source on, the other preferences kept
    expect((store.featurePreferences as Record<string, unknown>).comandanteSources).toEqual(comandanteSourcesAll(true));
    expect((store.featurePreferences as Record<string, unknown>).monitorEveryMs).toBe(5000);

    const ui = await comandanteTab($);
    expect((await ui.find({ key: "comandante-sources-all" }))?.props.label).toBe(`${GLYPH.check} All`);
    for (const source of ["farol", "semente", "vigia", "clareza", "codeQuality"] as const) {
      expect((await ui.find({ key: `comandante-source-${source}` }))?.props.label).toBe(`${GLYPH.check} ${text(`feature.${source}.name`, "en")}`);
    }
    expect(await ui.find({ type: "Text", text: "5 of 5 on" })).toBeDefined();
    await ui.unmount();
  });

  test("\"All\" switches every source off, and on again once any is off", LOCALE, async ($, on) => {
    const { store } = comandanteWorld(on, { comandante: true }, {});
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const sources = () => (store.featurePreferences as { comandanteSources?: Record<string, boolean> } | undefined)?.comandanteSources;
    const ui = await comandanteTab($);

    await ui.press({ key: "comandante-sources-all" });
    await settle(() => sources()?.farol === false);
    expect(sources()).toEqual(comandanteSourcesAll(false));
    expect((await ui.find({ key: "comandante-sources-all" }))?.props.label).toBe(`${GLYPH.off} All`);
    expect((await ui.find({ key: "comandante-source-vigia" }))?.props.label).toBe(`${GLYPH.off} Vigia`);
    expect(await ui.find({ type: "Text", text: "0 of 5 on" })).toBeDefined();

    // one back on: "All" stays unticked until every one is; pressed then, it switches every one on
    await ui.press({ key: "comandante-source-vigia" });
    await settle(() => sources()?.vigia === true);
    expect(await ui.find({ type: "Text", text: "1 of 5 on" })).toBeDefined();
    expect((await ui.find({ key: "comandante-sources-all" }))?.props.label).toBe(`${GLYPH.off} All`);
    await ui.press({ key: "comandante-sources-all" });
    await settle(() => sources()?.farol === true);
    expect(sources()).toEqual(comandanteSourcesAll(true));
    expect((await ui.find({ key: "comandante-sources-all" }))?.props.label).toBe(`${GLYPH.check} All`);
    await ui.unmount();
  });

  test("a saved idea without a ruling is judged when Semente is switched on, and the person's own the moment it is saved", LOCALE, async ($, on) => {
    const { jev, store, files } = comandanteWorld(on, { comandante: true }, { verdict: pick("reject_noise", 0.7) }, {}, { comandanteSources: { semente: false } });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    // shelved while Semente was off in the Comandante's list: as always, without a ruling
    expect(await semente($, "Cache the parsed config")).toEqual({ result: text("feature.semente.shelved", "en", { idea: "Cache the parsed config" }) });
    expect(shelf(store)[0]?.comandante).toBeUndefined();
    expect(jev.asked).toHaveLength(0);

    const tab = await comandanteTab($);
    await tab.press({ key: "comandante-source-semente" });
    await settle(() => shelf(store)[0]?.comandante !== undefined);
    await tab.unmount();
    expect(alerts(jev)).toEqual(["Cache the parsed config"]);
    // judged as itself, not as a repeat of its own place on the shelf
    expect(jev.asked[0]!.state).toMatchObject({ known: [] });
    // rejected, it stays on the shelf with the ruling beside it: only the person removes a saved idea
    expect(shelf(store)).toMatchObject([{ text: "Cache the parsed config", comandante: { decision: "rejected", reason: "reject_noise" } }]);
    expect(ownRecords(files)).toMatchObject([{ source: "semente", decision: "rejected", reason: "reject_noise" }]);

    await $.command.run({ command: "semente", ...ASK, args: "Profile the loader" });
    await settle(() => shelf(store).some((idea) => idea.text === "Profile the loader" && idea.comandante));
    expect(alerts(jev)).toEqual(["Cache the parsed config", "Profile the loader"]);
    expect(shelf(store).map((idea) => idea.text)).toEqual(["Cache the parsed config", "Profile the loader"]);

    const pane = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "semente", props: { ...PANE_PROPS, title: "Semente" } } as never) as { find: (query: never) => Promise<unknown>; unmount: () => Promise<unknown> };
    const ruling = `${GLYPH.fail} ${text("feature.farol.comandante", "en", { decision: text("feature.comandante.decision.rejected", "en"), reason: text("feature.comandante.reason.reject_noise", "en") })}`;
    expect(await pane.find({ type: "Text", text: ruling } as never)).toBeDefined();
    await pane.unmount();
  });

  test("before the nudge offers saved ideas, each is judged: approved is offered, questioned is offered with its question, rejected is not", LOCALE, async ($, on) => {
    const verdicts: Record<string, string> = { "Cache the parsed config": "approve_fits", "Cache warmup on boot": "question_vague", "Cache eviction policy": "reject_noise" };
    const nudging = (request: SystemOneRequest) => String(request.state?.kind ?? "").includes("offered to the user");
    const { jev } = comandanteWorld(on, { comandante: true, clareza: false, contexto: false, codeQuality: false, vigia: false }, (request) => ({
      verdict: pick(nudging(request) ? verdicts[String(request.state?.alert)] ?? "approve_sound" : "approve_sound", 0.8),
    }));
    on("turn.start", async (_$, e) => ({ turnId: e.turnId }));
    on("turn.complete", async () => ({ text: "" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    for (const idea of Object.keys(verdicts)) await semente($, idea);
    expect(jev.asked).toHaveLength(3);

    await $.turn.start({ turnId: "t1", text: "speed up the cache" } as never);
    await $.turn.complete({ turnId: "t1", answer: "Done.", durationMs: 5, isAborted: false, reason: "answer", usage: undefined } as never);
    await settle(() => jev.asked.filter(nudging).length === 3);
    expect(jev.asked.filter(nudging).map((request) => request.state?.alert)).toEqual(Object.keys(verdicts));

    const pane = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "semente", props: { ...PANE_PROPS, title: "Semente" } } as never) as { find: (query: never) => Promise<unknown>; unmount: () => Promise<unknown> };
    for (let i = 0; i < 60 && !(await pane.find({ type: "Text", text: /2 saved ideas fit recent work/ } as never)); i++) await wait();
    expect(await pane.find({ type: "Text", text: /2 saved ideas fit recent work/ } as never)).toBeDefined();
    const question = `${GLYPH.ask} ${text("feature.farol.comandante", "en", { decision: text("feature.comandante.decision.questioned", "en"), reason: text("feature.comandante.reason.question_vague", "en") })} ${text("feature.comandante.question.question_vague", "en")}`;
    expect(await pane.find({ type: "Text", text: question } as never)).toBeDefined();
    await pane.unmount();
  });

  test("the open tab shows this session's new decision at once, and another session's within one beat", LOCALE, async ($, on) => {
    const { clock, peer } = comandanteWorld(on, { comandante: true }, { verdict: pick("reject_noise", 0.7) });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    const ui = await comandanteTab($);
    expect(await ui.find({ type: "Text", text: `${GLYPH.off} ${text("feature.comandante.empty", "en")}` })).toBeDefined();

    await farol($, "Rename every variable");
    expect(await ui.find({ type: "Text", text: "rejected · Farol" })).toBeDefined();

    peer(PEER, [peerRecord()]);
    expect(await ui.find({ type: "Text", text: "approved · Semente" })).toBeUndefined();
    await clock.advance(1000);
    for (let i = 0; i < 60 && !(await ui.find({ type: "Text", text: "approved · Semente" })); i++) await wait();
    expect(await ui.find({ type: "Text", text: "approved · Semente" })).toBeDefined();
    await ui.unmount();
  });

  test("the tab shows every session's decisions with the session they came from, filtered by session and by decision", LOCALE, async ($, on) => {
    comandanteWorld(on, { comandante: true }, { verdict: pick("reject_noise", 0.7) }, { [PEER]: [peerRecord()] });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await farol($, "Rename every variable");

    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-comandante" });
    // this session's own decision, and the other session's, each naming where it came from
    expect(await ui.find({ type: "Text", text: "rejected · Farol" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /this session · workspace$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "approved · Semente" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /Parser fix · peer-aaa · workspace$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^1 approved · 1 rejected · 0 questioned/ })).toBeDefined();

    await ui.select({ key: "comandante-session", value: PEER });
    expect(await ui.find({ type: "Text", text: "approved · Semente" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "rejected · Farol" })).toBeUndefined();

    await ui.select({ key: "comandante-decision", value: "rejected" });
    expect(await ui.find({ type: "Text", text: /No decision matches these filters\./ })).toBeDefined();

    await ui.select({ key: "comandante-session", value: "all" });
    expect(await ui.find({ type: "Text", text: "rejected · Farol" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "approved · Semente" })).toBeUndefined();
    await ui.unmount();
  });
});
