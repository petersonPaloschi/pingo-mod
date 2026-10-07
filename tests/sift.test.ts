// Sift's pure half: the questions it asks Jev for many items, and the shortlist it prints for Claude.
import { expect, test } from "claude-code/testing";

import {
  addRun, batches, classifyQuestion, filterQuestion, findHits, findRequest, footer, groupRequest, parseArgs, parseLabels,
  ranges, relevance, renderClassify, renderFilter, renderTally, template, toTally, type Item, type RunStats,
} from "../hooks/core/sift.ts";

const item = (id: string, text = id): Item => ({ id, text });

test("flags take a value unless they are switches, and -- ends them", () => {
  expect(parseArgs(["Is it auth?", "--lines", "src", "--top", "5", "--ext=ts,tsx", "--json", "--", "--odd"])).toEqual({
    pos: ["Is it auth?", "src", "--odd"],
    flags: { lines: true, top: "5", ext: "ts,tsx", json: true },
  });
});

test("labels keep their descriptions, including ones with a colon", () => {
  expect(parseLabels("bug:Something broken, feature ,time:Starts at 10:30")).toEqual({ bug: "Something broken", feature: null, time: "Starts at 10:30" });
});

test("items go one per request unless --fast packs them within the token budget", () => {
  const items = [item("a", "x".repeat(400)), item("b"), item("c")];
  expect(batches(items, {}).map((group) => group.map((it) => it.id))).toEqual([["a"], ["b"], ["c"]]);
  expect(batches(items, { fast: true }).map((group) => group.length)).toEqual([3]);
  expect(batches(items, { fast: true, "pack-tokens": "130" }).map((group) => group.map((it) => it.id))).toEqual([["a"], ["b", "c"]]);
});

test("a single item is the content; packed items are addressed one by one", () => {
  const single = groupRequest([item("src/a.ts", "code")], filterQuestion("Is it auth?"));
  expect(single.state).toEqual({ source: "src/a.ts", content: "code" });
  expect(single.questions).toEqual({ q0: { type: "noul", instructions: "Is it auth?" } });

  const packed = groupRequest([item("a"), item("b")], classifyQuestion("Which?", { x: null, y: null }), { query: "q" });
  expect(packed.state).toEqual({ query: "q", items: { i0: { source: "a", content: "a" }, i1: { source: "b", content: "b" } } });
  expect(packed.questions.q1).toEqual({ type: "choice", instructions: "Which? Answer only about `items.i1`; ignore the other items.", criteria: { x: null, y: null } });
});

test("relevance is the expected level over Jev's probabilities", () => {
  const answer = (probabilities: Record<string, number>) => ({ type: "choice" as const, choice: "exact", confidence: 1, probabilities });
  expect(relevance(answer({ exact: 1 }))).toBe(1);
  expect(relevance(answer({ unrelated: 1 }))).toBe(0);
  expect(relevance(answer({ relevant: 0.5, exact: 0.5 }))).toBe(0.875);
});

test("find offers every line plus none, and scores lines by both answers", () => {
  const lines: [string, string][] = [["3", "retry()"], ["9", "sleep(100)"]];
  const request = findRequest("the retry pause", lines);
  expect(Object.keys((request.questions.where as { criteria: object }).criteria)).toEqual(["3", "9", "none"]);
  const hits = findHits("a.ts", lines, {
    where: { type: "choice", choice: "9", confidence: 0.8, probabilities: { "3": 0.2, "9": 0.7, none: 0.1 } },
    exists: { type: "noul", noul: 0.5 },
  });
  expect(hits).toEqual([{ file: "a.ts", line: "3", text: "retry()", score: 0.1 }, { file: "a.ts", line: "9", text: "sleep(100)", score: 0.35 }]);
  expect(findHits("a.ts", lines, {})).toEqual([]);
});

test("filter lists sure matches, then the borderline band, and folds repeated log lines", () => {
  const rows = [
    { item: item("app.log:2", "ERROR disk 0x1f full on node 12"), score: 0.99 },
    { item: item("app.log:5", "ERROR disk 0x3b full on node 99"), score: 0.97 },
    { item: item("app.log:4", "ERROR disk 0x2a full on node 13"), score: 0.98 },
    { item: item("app.log:7", "WARN maybe"), score: 0.55 },
    { item: item("app.log:1", "INFO ok"), score: 0.01 },
  ];
  const { lines, matched, borderline } = renderFilter(rows, { lines: true });
  expect(lines).toEqual([
    "0.99  ×3  app.log:2  ERROR disk 0x1f full on node 12\n        also lines 4-5",
    "? borderline (0.35–0.65) — check these yourself:",
    "0.55  app.log:7  WARN maybe",
  ]);
  expect(matched.length).toBe(4);
  expect(borderline.length).toBe(1);
  expect(renderFilter([], {}).lines).toEqual(["(no matches)"]);
});

test("templates ignore numbers and ids, and line ranges stop at the limit", () => {
  expect(template("req 42 from 0xdeadbeef  failed")).toBe(template("req 7 from 0x1 failed"));
  expect(ranges([3, 4, 5, 9], 10)).toBe("3-5,9");
  expect(ranges([1, 2, 3, 7, 8], 3)).toBe("1-3,… (+2; use --save for all)");
});

test("repeated log lines from different files keep their own source", () => {
  const rows = [
    { item: item("first.log:2", "ERROR request 12 failed"), score: 0.99 },
    { item: item("second.log:7", "ERROR request 34 failed"), score: 0.98 },
  ];
  expect(renderFilter(rows, { lines: true }).lines).toEqual([
    "0.99  first.log:2  ERROR request 12 failed",
    "0.98  second.log:7  ERROR request 34 failed",
  ]);
});

test("classify counts every label and names the runner-up of an unsure item", () => {
  const choice = (label: string, confidence: number, probabilities: Record<string, number>) => ({ type: "choice" as const, choice: label, confidence, probabilities });
  const rows = [
    { item: item("T1", "crash on save"), answer: choice("bug", 0.95, { bug: 0.97, question: 0.03 }) },
    { item: item("T2", "how to export?"), answer: choice("question", 0.9, { question: 0.95, bug: 0.05 }) },
    { item: item("T3", "button does nothing?"), answer: choice("bug", 0.49, { bug: 0.55, question: 0.45 }) },
  ];
  const { lines, low } = renderClassify(rows, ["bug", "feature", "question"], {});
  expect(lines).toEqual([
    "bug 2 · feature 0 · question 1",
    "[bug] T1",
    "[question] T2",
    "? low confidence — check these yourself:",
    "?0.49  bug (or question)  T3  button does nothing?",
  ]);
  expect(low.map((row) => row.item.id)).toEqual(["T3"]);
});

test("the footer prices TypeSafe only and names what was not judged", () => {
  const stats: RunStats = { scanned: 10, contentTokens: 5000, jevTokens: 2500, seconds: 1.23, provider: "typesafe", failed: [], skipped: [".env (secret-like, never sent)"] };
  expect(footer(stats, ["2 matched"], "")).toBe(
    "— 10 scanned · 2 matched · 1.2s · jev 2.5k tok ($0.0001) · ~5.0k Claude tokens not read\n— skipped 1: .env (secret-like, never sent)",
  );
  const failed = footer({ ...stats, provider: "openrouter", skipped: [], failed: [{ id: "a.ts", error: "503 from OpenRouter" }] }, [], "");
  expect(failed).toContain("jev 2.5k tok ·");
  expect(failed).toContain("! 1 not judged (503 from OpenRouter): a.ts");
});

test("the lifetime tally adds each run, counts only judged items, and survives a damaged file", () => {
  const run: RunStats = { scanned: 10, contentTokens: 5000, jevTokens: 2500, seconds: 1, provider: "typesafe", failed: [{ id: "a.ts", error: "503" }], skipped: [] };
  const first = addRun(undefined, run, "x".repeat(400), "2026-10-07T12:00:00.000Z");
  expect(first).toEqual({ since: "2026-10-07T12:00:00.000Z", runs: 1, items: 9, jevTokens: 2500, typesafeTokens: 2500, saved: 4900 });
  const second = addRun(JSON.parse(JSON.stringify(first)), { ...run, provider: "openrouter", failed: [] }, "", "2026-10-08T00:00:00.000Z");
  expect(second).toEqual({ since: "2026-10-07T12:00:00.000Z", runs: 2, items: 19, jevTokens: 5000, typesafeTokens: 2500, saved: 9900 });
  expect(toTally({ runs: 3 })).toBeUndefined();
  expect(toTally({ since: "2026-10-07", runs: -1, items: "9" })).toEqual({ since: "2026-10-07", runs: 0, items: 0, jevTokens: 0, typesafeTokens: 0, saved: 0 });
  expect(addRun("garbage", run, "", "2026-10-09T00:00:00.000Z").since).toBe("2026-10-09T00:00:00.000Z");
});

test("the tally line prices TypeSafe's share and says so when other providers ran too", () => {
  const tally = { since: "2026-10-07T12:00:00.000Z", runs: 1, items: 1200, jevTokens: 2_000_000, typesafeTokens: 2_000_000, saved: 340_000 };
  expect(renderTally(tally)).toBe("since 2026-10-07: 1 run · 1.2k items judged · jev 2.0M tok ($0.0840) · ~340.0k Claude tokens not read");
  expect(renderTally({ ...tally, runs: 4, typesafeTokens: 1_000_000 })).toContain("4 runs · 1.2k items judged · jev 2.0M tok ($0.0420 on TypeSafe) ·");
  expect(renderTally({ ...tally, typesafeTokens: 0 })).toContain("jev 2.0M tok · ~340.0k");
});
