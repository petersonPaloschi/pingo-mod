// Fixes in the pane and the band: locale keys that reach the screen, widths in
// terminal columns, a scrolled-back log that stays put, the turn's token detail, and the model names.
import type { On, RenderPropsOf } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

import type { FeedEntry, RouteEvent } from "../types";
import { prettyModel } from "../hooks/flow.ts";
import { emptyTrace } from "../hooks/trace.ts";
import { formatClock, type Locale } from "../hooks/i18n.ts";
import { displayWidth, rowsOf } from "../hooks/layout.ts";
import { clip, clockWidth, oneLine, renderPane, shares, type Actions, type Els, type View } from "../hooks/ui.tsx";
import { normalizeTab } from "../hooks/register.tsx";
import { en } from "../hooks/strings/en.ts";
import { PANE_PROPS } from "./helpers.ts";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ASK = { origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 160 } } as const;
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120 } as unknown as RenderPropsOf["AbovePrompt"];

/** A session with no key: Jev is never asked, so every prompt passes it by. */
function noKey(on: On) {
  mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(on, {});
  on("command.register", async () => ({ value: { command: "jev" } }));
  on("tool.list", async () => ({ value: [{ name: "Read", description: "Read a file", mcp: false }] }));
  on("session.messages", async () => ({ value: [] }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.id", async () => ({ value: "session-fix-ui" }));
  on("prompt.compose", async () => ({ sections: [] }));
  on("prompt.submit", async (_$, e) => ({ text: e.text }));
  on("turn.complete", async (_$, e) => ({ text: e.answer }));
}

/** Every piece of text in a drawn tree: strings, and the labels and alt texts of elements. */
function texts(node: unknown): string[] {
  if (node === null || node === undefined || node === false) return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  const el = node as { props?: Record<string, unknown>; children?: unknown[] };
  const own = ["label", "alt", "placeholder"].map((name) => el.props?.[name]).filter((value): value is string => typeof value === "string");
  return [...own, ...texts(el.children ?? [])];
}

const PREFIXES = [...new Set(Object.keys(en).map((key) => key.split(".")[0]!))];
const RAW_KEY = new RegExp(`(?<![\\w/.-])(?:${PREFIXES.join("|")})\\.[A-Za-z]\\w*(?:\\.\\w+)*`);

for (const locale of ["en", "pt"] as const) {
  test(`the band shows observed state without a retired routing decision (${locale})`, { options: { locale } }, async ($, on) => {
    noKey(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ASK.origin });
    for (const surface of ["terminal", "desktop"] as const) {
      const band = await $.ui.mount({ plugin: "jev", surface, component: "AbovePrompt", props: BAND_PROPS });
      const shown = texts(await band.drawn()).join("\n");
      expect(shown).not.toContain("ui.band.skipped");
      expect(shown).not.toMatch(/Jev skipped|Jev não consultado/);
      expect(shown).not.toMatch(RAW_KEY);
      await band.unmount();
    }
  });

  test(`no tab, band or pane shows a raw locale key (${locale})`, { options: { locale } }, async ($, on) => {
    noKey(on);
    on("agent.spawn", async (_$, e) => ({ model: e.model ?? "claude-sonnet-5-5", agentId: "agent-k" }));
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "check the site", wait: false, origin: ASK.origin });
    await $.agent.spawn({ tool_use_id: "toolu-k", prompt: "Look around.", description: "look around", subagentType: "Explore", provider: { plugin: "engine", tier: "core" }, parentModel: "claude-opus-5-5", background: false, fork: false } as never);
    await $.turn.complete({ turnId: "t-k", agentId: "agent-k", answer: "Found it.", durationMs: 2000, isAborted: false, reason: "answer" });
    await $.turn.complete({ turnId: "t-main", answer: "Done.", durationMs: 3000, isAborted: false, reason: "answer", usage: { input_tokens: 900, output_tokens: 40 } } as never);
    for (const surface of ["terminal", "desktop"] as const) {
      const ui = await $.ui.mount({ plugin: "jev", surface, component: "Pane", requestId: "jev", props: PANE_PROPS });
      for (const tab of ["tab-overview", "tab-live", "tab-models", "tab-agents", "tab-logs", "tab-configuration"]) {
        await ui.press({ key: tab });
        expect(texts(await ui.drawn()).join("\n")).not.toMatch(RAW_KEY);
      }
      await ui.unmount();
      const own = await $.ui.mount({ plugin: "jev", surface, component: "Pane", requestId: "jev-agent-1", props: PANE_PROPS });
      expect(texts(await own.drawn()).join("\n")).not.toMatch(RAW_KEY);
      await own.unmount();
      const band = await $.ui.mount({ plugin: "jev", surface, component: "AbovePrompt", props: BAND_PROPS });
      expect(texts(await band.drawn()).join("\n")).not.toMatch(RAW_KEY);
      await band.unmount();
    }
  });

  test(`the turn's end shows its token counts whole (${locale})`, { options: { locale } }, async ($, on) => {
    noKey(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.turn.complete({ turnId: "t1", answer: "Done.", durationMs: 4000, isAborted: false, reason: "answer", usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 } } as never);
    const ui = await $.ui.mount({ plugin: "jev", surface: "terminal", component: "Pane", requestId: "jev", props: PANE_PROPS });
    await ui.press({ key: "tab-live" });
    const detail = locale === "en" ? /in 1\.2K · out 300/ : /entrada 1,2\smil · saída 300/;
    const rendered = (await ui.findAll({ type: "Text" })).map((line) => line.text ?? "").join("\n");
    expect(rendered).toMatch(detail);
    await ui.unmount();
  });
}

test("the live log's time gutter is as wide as the locale writes the time", () => {
  for (const locale of ["en", "pt"] as const) {
    for (const hour of [0, 9, 12, 23]) {
      const time = formatClock(Date.UTC(2026, 9, 7, hour, 4, 5), locale);
      expect(clockWidth(locale)).toBeGreaterThanOrEqual(displayWidth(time) + 1);
    }
  }
  // "12:04:05 PM " is twelve columns; the old gutter had nine.
  expect(clockWidth("en")).toBe(12);
  expect(clockWidth("pt")).toBe(9);
});

/** The parts a pure render needs: the terminal's element tags, a view and actions that record the layout. */
function harness() {
  const els = Object.fromEntries(["Box", "Text", "Button", "Select", "Input", "Raster", "Svg"].map((tag) => [tag, tag])) as unknown as Els;
  const layouts: number[] = [];
  const act = new Proxy({}, { get: (_target, name) => (name === "layout" ? (max: number) => void layouts.push(max) : () => undefined) }) as Actions;
  const feedLine = (seq: number): FeedEntry => ({ seq, time: NOW - (100 - seq) * 1000, who: seq % 2 ? "claude" : "you", kind: "turn", tone: "info", text: `line ${seq}` });
  const event = (seq: number): RouteEvent => ({ seq, time: new Date(NOW - (100 - seq) * 1000).toISOString(), session: "s", model: "claude-opus-5-5", tools: 3, mode: "hint", tool: "Read", durationMs: 1000 });
  const view = (over: Partial<View>): View => ({
    locale: "en" as Locale,
    localeOption: "auto",
    events: [],
    routing: true,
    tab: "live",
    range: 0,
    setup: { provider: "typesafe", message: "", isOk: true },
    features: { agents: true },
    flowDetails: false,
    feed: [],
    live: {},
    now: NOW,
    width: 80,
    rows: 40,
    surface: "terminal",
    meta: "",
    agents: [],
    trace: emptyTrace(),
    scroll: 0,
    fixed: true,
    key: { source: "none", tail: "", provider: "typesafe" },
    deck: null,
    ...over,
  });
  return { els, act, layouts, feedLine, event, view };
}

test("persisted legacy tabs resolve to valid screens on both surfaces", () => {
  const { els, act, view } = harness();
  const retired = [
    ["baseline", "logs", "Request log"],
    ["flow", "live", "Live"],
    ["features", "configuration", "Provider and language"],
    ["reasons", "logs", "Request log"],
    ["setup", "configuration", "Provider and language"],
    ["log", "logs", "Request log"],
    ["deck", "deck", "Every /deck command as a control"],
    ["unknown", "overview", "No Claude requests or Jev calls in this range"],
  ] as const;
  for (const surface of ["terminal", "desktop"] as const) {
    for (const [saved, expected, text] of retired) {
      const tab = normalizeTab(saved);
      expect(tab).toBe(expected);
      const screen = renderPane(els, view({ tab, surface, fixed: false }), act);
      expect(texts(screen).join("\n")).toContain(text);
    }
  }
});

/** Every element of a tree, outermost first. */
function elements(node: unknown): { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const el = node as { children?: unknown[] };
  return [el, ...elements(el.children ?? [])];
}

test("the live log has no time column: the time sits faint under the text and the speaker's name is not cut", () => {
  const { els, act, feedLine, view } = harness();
  const feed = [feedLine(1), feedLine(2)];
  const tree = renderPane(els, view({ feed, locale: "en" }), act);
  const time = formatClock(feed[0]!.time, "en");
  expect(elements(tree).find((el) => typeof el.props?.width === "number" && texts(el).join("").startsWith(time))).toBeUndefined();
  expect(texts(tree).some((one) => one.startsWith(time))).toBe(true);
  const gutter = elements(tree).find((el) => typeof el.props?.width === "number" && texts(el).join("").includes("You"));
  expect(gutter!.props!.width).toBeGreaterThanOrEqual(6 + 7);
});

test("a scrolled-back live log stays on the lines it showed as new ones arrive", () => {
  const { els, act, layouts, feedLine, view } = harness();
  const lastShown = (feed: FeedEntry[], scroll: number) => {
    const shown = texts(renderPane(els, view({ feed, scroll }), act)).filter((one) => /^line \d+$/.test(one));
    return shown.at(-1);
  };
  const feed = Array.from({ length: 40 }, (_, i) => feedLine(i + 1));
  expect(lastShown(feed, 0)).toBe("line 40");
  expect(lastShown(feed, 5)).toBe("line 35");
  const grown = [...feed, feedLine(41), feedLine(42), feedLine(43)];
  // Three new lines: the view keeps to line 35 rather than slide to line 38.
  expect(lastShown(grown, 5)).toBe("line 35");
  // Scrolling further back goes on from there, and the stored offset may go as far as line 1.
  expect(lastShown(grown, 6)).toBe("line 34");
  expect(layouts.at(-1)).toBe(6 + 42 - 9);
  // Back at the live edge, it follows the newest line again.
  expect(lastShown(grown, 0)).toBe("line 43");
  expect(lastShown([...grown, feedLine(44)], 0)).toBe("line 44");
});

test("a scrolled-down request log stays on the requests it showed as new ones come in on top", () => {
  const { els, act, event, view } = harness();
  const offset = (events: RouteEvent[], scroll: number) => {
    const moved = elements(renderPane(els, view({ tab: "logs", events, scroll, rows: 20 }), act)).find((el) => typeof el.props?.marginTop === "number" && (el.props.marginTop as number) < 0);
    return moved ? -(moved.props!.marginTop as number) : 0;
  };
  const events = Array.from({ length: 40 }, (_, i) => event(i + 1));
  expect(offset(events, 0)).toBe(0);
  expect(offset(events, 6)).toBe(6);
  // Two requests on top, a row each: the body moves down by two to keep the same ones in view.
  expect(offset([...events, event(41), event(42)], 6)).toBe(8);
  expect(offset([...events, event(41), event(42)], 0)).toBe(0);
});

test("display width counts wide characters twice and marks not at all", () => {
  expect(displayWidth("abc")).toBe(3);
  expect(displayWidth("中文")).toBe(4);
  expect(displayWidth("ｈｉ")).toBe(4);
  expect(displayWidth("😀")).toBe(2);
  expect(displayWidth("e" + String.fromCodePoint(0x301))).toBe(1);
  expect(displayWidth(String.fromCodePoint(0x1f44d, 0x1f3fd))).toBe(2);
  expect(displayWidth(String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467))).toBe(2);
  // The dashboard's own symbols stay one column.
  expect(displayWidth("✓✗●◉⊘✻◆⠿⣿…·")).toBe(11);
  // Fifty CJK characters are a hundred columns: three rows at forty.
  expect(rowsOf({ type: "Text", props: {}, children: ["中".repeat(50)] }, 40)).toBe(3);
});


test("a picture's columns are a fixed width in a row, so the text beside it has the rest", () => {
  const text = { type: "Text", props: {}, children: ["x".repeat(40)] };
  const column = { type: "Box", props: { flexDirection: "column" }, children: Array.from({ length: 8 }, () => text) };
  const row = { type: "Box", props: { flexDirection: "row", columnGap: 2 }, children: [{ type: "Raster", props: { columns: 14, rows: 6 } }, column] };
  // 60 - 14 - 2 leaves 44 columns: each line of 40 takes one row.
  expect(rowsOf(row, 60)).toBe(8);
});

test("text is cut between code points, and only a long one after its spaces are collapsed", () => {
  const cut = clip("a".repeat(117) + "😀😀😀", 119);
  const lone = [...cut].some((ch) => ch.length === 1 && ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdfff);
  expect(lone).toBe(false);
  expect(cut.endsWith("😀…")).toBe(true);
  expect(clip("short", 120)).toBe("short");
  const spaced = "ab    ".repeat(30);
  expect(spaced.length).toBeGreaterThan(121);
  expect(oneLine(spaced, 121)).toBe("ab ".repeat(30));
  expect(oneLine("x ".repeat(100), 121).endsWith("…")).toBe(true);
});

test("the outcome bar's dots add up to its room", () => {
  const dots = shares([1, 1, 98], 28);
  expect(dots.reduce((s, n) => s + n, 0)).toBe(28);
  for (const n of dots) expect(n).toBeGreaterThanOrEqual(1);
  expect(shares([1, 2, 3], 12)).toEqual([2, 4, 6]);
  expect(shares([5, 0, 5], 11).reduce((s, n) => s + n, 0)).toBe(11);
  expect(shares([0, 0], 10)).toEqual([0, 0]);
});

test("model names: old ids and date suffixes", () => {
  expect(prettyModel("claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
  expect(prettyModel("claude-3-7-sonnet-20250219")).toBe("Sonnet 3.7");
  expect(prettyModel("claude-3-opus-20240229")).toBe("Opus 3");
  expect(prettyModel("claude-sonnet-4-20250514")).toBe("Sonnet 4");
  expect(prettyModel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  expect(prettyModel("claude-opus-5-5")).toBe("Opus 5.5");
  expect(prettyModel("claude-instant-20230101")).toBe("instant");
});
