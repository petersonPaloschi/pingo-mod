// The Comandante: with its switch on, Jev judges each Farol assumption and Semente idea where it arises. Rejected is
// denied with its reason, questioned goes back to the agent with a question and is not recorded, approved goes through.
// A Farol assumption it could not judge when it was made (switched off then, or Jev without an answer) is judged once
// later, on the pane's clock, and the Farol pane names the Comandante's ruling.
// Each decision lands in this session's file of the project's shared folder, which the tab of every session reads,
// naming the session it came from. With the switch off, Jev is not asked and both tools answer as they always did.
import type { On } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";
import { COMANDANTE_VERDICTS, comandanteRecords, comandanteRequest, comandanteVerdict, filterComandante, mergeComandante } from "../hooks/core/comandante.ts";
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

/**
 * A session of the project at /workspace with Jev answering from `table` (live: a test may change it), and its files
 * in memory: the Comandante's folder holds the other sessions' files of `seed`, then whatever this session writes.
 */
function comandanteWorld(on: On, flags: Partial<Features>, table: Record<string, Answer>, seed: Record<string, ComandanteRecord[]> = {}) {
  const clock = mock.clock(on, { now: NOW });
  const store: Record<string, unknown> = { provider: "typesafe", features: { ...DEFAULT_FEATURES, ...flags } };
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
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: answerJev(request, table), usage: { input_tokens: 200, output_tokens: 0 } }) } };
  });
  const files = new Map<string, string>(Object.entries(seed).map(([id, records]) => [`${DIR}/${id}.json`, JSON.stringify(records)]));
  on("fs.exists", async (_$, e) => ({ value: plain(e.path) === DIR ? [...files.keys()].some((file) => file.startsWith(DIR)) : files.has(plain(e.path)) }));
  on("fs.write", async (_$, e) => {
    files.set(plain(e.path), e.text);
    return { value: undefined };
  });
  on("fs.list", async (_$, e) => ({ value: [...files.keys()].filter((file) => file.startsWith(`${plain(e.path)}/`)).map((file) => ({ name: file.slice(plain(e.path).length + 1), kind: "file" as const, size: 1, mtimeMs: NOW })) }) as never);
  on("fs.read", async (_$, e) => {
    const found = files.get(plain(e.path));
    if (found === undefined) throw new Error(`no such file: ${e.path}`);
    return { value: found } as never;
  });
  return { jev, store, toasts, files, clock };
}

/** This session's records, as its file holds them. */
const ownRecords = (files: Map<string, string>) => comandanteRecords(JSON.parse(files.get(`${DIR}/${OWN}.json`) ?? "[]"));
/** Whether this session wrote any Comandante file. */
const wroteLog = (files: Map<string, string>) => [...files.keys()].some((file) => file.startsWith(DIR));

/** Lets the one-second clock run, a beat at a time, until `done` (at most 20 beats). */
async function beats(clock: { advance: (ms: number) => Promise<unknown> }, done: () => boolean) {
  for (let i = 0; i < 20 && !done(); i++) {
    await clock.advance(1000);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
  }
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

  test("an assumption Jev could not judge when it was made is judged once later: approved, it is marked right for Claude", LOCALE, async ($, on) => {
    const table: Record<string, Answer> = {};
    const { jev, files, clock } = comandanteWorld(on, { comandante: true }, table);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    expect((await farol($, "The loader stays synchronous")).result).toBe(text("feature.farol.recorded", "en", { id: 1 }));
    expect(jev.asked).toHaveLength(1);

    table.verdict = pick("approve_sound", 0.8);
    await beats(clock, () => ownRecords(files).length > 0);
    expect(jev.asked).toHaveLength(2);
    // judged as itself, not as a repeat of its own record
    expect(jev.asked[1]!.state).toMatchObject({ alert: "The loader stays synchronous", context: "src/config.ts", known: [] });
    expect(ownRecords(files)).toMatchObject([{ session: OWN, source: "farol", decision: "approved", reason: "approve_sound" }]);
    // right, and pending: Claude hears it with its next step, as with the person's ✓
    await beats(clock, () => false);
    const ui = await farolPane($ as never);
    expect(await ui.find({ type: "Text", text: `${GLYPH.ok} #1 The loader stays synchronous` } as never)).toBeDefined();
    expect(await ui.find({ type: "Text", text: text("feature.farol.pending", "en") } as never)).toBeDefined();
    await ui.unmount();
    // asked once: the later beats left it alone
    expect(jev.asked).toHaveLength(2);
  });

  test("questioned later: the assumption stays open for the person, with the Comandante's ruling and question beside it", LOCALE, async ($, on) => {
    const table: Record<string, Answer> = {};
    const { jev, files, clock } = comandanteWorld(on, { comandante: true }, table);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await farol($, "The config is YAML");

    table.verdict = pick("question_context", 0.6);
    await beats(clock, () => ownRecords(files).length > 0);
    expect(ownRecords(files)).toMatchObject([{ source: "farol", decision: "questioned", reason: "question_context" }]);
    const ruling = `${text("feature.farol.comandante", "en", { decision: text("feature.comandante.decision.questioned", "en"), reason: text("feature.comandante.reason.question_context", "en") })} ${text("feature.comandante.question.question_context", "en")}`;
    const ui = await farolPane($ as never);
    expect(await ui.find({ type: "Text", text: `${GLYPH.ask} #1 The config is YAML` } as never)).toBeDefined();
    expect(await ui.find({ type: "Text", text: ruling } as never)).toBeDefined();
    await ui.unmount();
    expect(jev.asked).toHaveLength(2);
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
