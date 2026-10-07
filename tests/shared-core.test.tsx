// The rules every feature reads from one place: a reason's code, the gate before any Jev call, how a
// choice answer is read, which models accept effort and the effort each request goes out with.
import { describe, expect, test } from "claude-code/testing";

import { readChoice, supportsEffort } from "../hooks/core/plan.ts";
import { errorMessage, gateReason, isJevError, isJevFailure, jevErrorReason, reasonCause, reasonCode } from "../hooks/core/reasons.ts";
import { withHint } from "../hooks/core/decide.ts";
import { sizeEffort } from "../hooks/sizing.ts";
import { engine, fakeJev, ORIGIN, pick, requests, step } from "./helpers.ts";

describe("reasons", () => {
  test("a thrown call's reason carries its cause after its code", () => {
    const reason = jevErrorReason(new Error("401 from TypeSafe"));
    expect(reason).toBe("jev_error: 401 from TypeSafe");
    expect(reasonCode(reason)).toBe("jev_error");
    expect(reasonCause(reason)).toBe("401 from TypeSafe");
    expect(reasonCode("router_error: boom")).toBe("router_error");
    expect(reasonCause("low_confidence")).toBeUndefined();
    expect(errorMessage("plain")).toBe("plain");
  });

  test("a failure is a thrown call or an unusable reply, nothing else", () => {
    expect(isJevError("jev_error: timeout")).toBe(true);
    expect(isJevFailure("jev_error: timeout")).toBe(true);
    expect(isJevFailure("jev_unexpected_answer")).toBe(true);
    expect(isJevError("jev_unexpected_answer")).toBe(false);
    expect(isJevFailure("low_confidence")).toBe(false);
  });

  test("the gate names routing before the key", () => {
    expect(gateReason(false, false)).toBe("routing_disabled");
    expect(gateReason(true, false)).toBe("no_api_key");
    expect(gateReason(true, true)).toBeUndefined();
  });
});

describe("one reading of a choice answer", () => {
  test("an offered option clears the minimum or is held with its confidence", () => {
    expect(readChoice(pick("high", 0.9), ["low", "high"], 0.7)).toEqual({ chosen: { value: "high", confidence: 0.9 } });
    expect(readChoice(pick("high", 0.4), ["low", "high"], 0.7)).toEqual({ held: { value: "high", confidence: 0.4 } });
    expect(readChoice(pick("max", 0.9), ["low", "high"], 0.7)).toEqual({});
    expect(readChoice(undefined, ["low"], 0.7)).toEqual({});
  });

  test("an option that changes nothing counts at any confidence", () => {
    const binding = (value: string) => value === "consult";
    expect(readChoice(pick("none", 0.2), ["none", "consult"], 0.7, binding)).toEqual({ chosen: { value: "none", confidence: 0.2 } });
    expect(readChoice(pick("consult", 0.2), ["none", "consult"], 0.7, binding)).toEqual({ held: { value: "consult", confidence: 0.2 } });
  });
});

describe("effort", () => {
  test("Haiku refuses effort in every form its id takes", () => {
    for (const id of ["haiku", "claude-haiku-4-5-20251001", "us.anthropic.claude-haiku-4-5-v1:0"]) expect(supportsEffort(id)).toBe(false);
    for (const id of ["opus", "claude-sonnet-5-5", "claude-opus-5-5[1m]", undefined]) expect(supportsEffort(id)).toBe(true);
  });

  test("a request Jev did not touch goes out as sent, even on Haiku", () => {
    const haiku = "claude-haiku-4-5-20251001";
    expect(sizeEffort({ model: haiku, original: { model: haiku, effort: "low" } }, "en")).toEqual({ effort: "low", changes: [] });
    expect(sizeEffort({ model: "claude-opus-5-5", original: { model: "claude-opus-5-5", effort: "high" } }, "en")).toEqual({ effort: "high", changes: [] });
  });

  test("Jev's effort replaces the request's, and a switch to Haiku drops the one it carried", () => {
    const opus = { model: "claude-opus-5-5", effort: "medium" };
    expect(sizeEffort({ model: opus.model, original: opus, planned: "max" }, "en")).toMatchObject({ effort: "max", changes: ["effort medium→max"] });
    expect(sizeEffort({ model: opus.model, original: opus, planned: "medium" }, "en")).toEqual({ effort: "medium", changes: [] });
    expect(sizeEffort({ model: "claude-haiku-4-5-20251001", original: opus }, "en")).toMatchObject({ effort: undefined, changes: [expect.stringContaining("ignored medium")] });
    expect(sizeEffort({ model: opus.model, original: { model: opus.model, effort: undefined }, planned: "high" }, "en"))
      .toMatchObject({ effort: undefined, changes: [expect.stringContaining("not applied")] });
  });
});

test("a hint reaches Claude framed the same way wherever it is attached", () => {
  expect(withHint({ context: ["a"] }, "use Read")).toEqual({ context: ["a", "<system-reminder>use Read</system-reminder>"] });
  const untouched: { text: string; context?: readonly string[] } = { text: "x" };
  expect(withHint(untouched, undefined)).toBe(untouched);
});

describe("the request decides the effort on the model it really runs on", () => {
  test("Jev's Haiku pick held back on a [1m] session still applies its effort to the kept model", async ($, on) => {
    engine(on, { features: { model: true, effort: true } });
    fakeJev(on, { tool: pick("Read", 0.9), needs_tool: { type: "noul", noul: 0.9 }, model: pick("haiku", 0.99), effort: pick("high", 0.9) });
    on("prompt.submit", async (_$, e) => ({ text: e.text }));
    const sent = requests(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5[1m]", effort: "medium", messageCount: 1 });
    expect(sent).toEqual([{ model: "claude-opus-5-5[1m]", effort: "high" }]);
  });

  test("with every feature off, a Haiku request keeps the effort Claude Code sent", async ($, on) => {
    engine(on, { features: { tools: false } });
    fakeJev(on, {});
    on("prompt.submit", async (_$, e) => ({ text: e.text }));
    const sent = requests(on);
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "hello", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-haiku-4-5-20251001", effort: "low", messageCount: 1 });
    expect(sent).toEqual([{ model: "claude-haiku-4-5-20251001", effort: "low" }]);
  });
});
