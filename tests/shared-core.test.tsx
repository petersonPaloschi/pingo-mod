// The rules every feature reads from one place: a reason's code, the gate before any Jev call, how a
// choice answer is read, which models accept effort and the effort each request goes out with.
import { describe, expect, test } from "claude-code/testing";

import { readChoice, supportsEffort } from "../hooks/core/plan.ts";
import { errorMessage, gateReason, isJevError, isJevFailure, jevErrorReason, reasonCause, reasonCode } from "../hooks/core/reasons.ts";
import { sizeRequest, withHint } from "../hooks/core/runtime.ts";
import { noul, pick, step, world } from "./helpers.ts";

const ORIGIN = { kind: "composer" } as const;

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
    expect(readChoice(pick("high", 0.4), ["low", "high"], 0.7)).toEqual({
      held: { value: "high", confidence: 0.4, needed: 0.7 }, reason: "low_confidence",
    });
    expect(readChoice(pick("max", 0.9), ["low", "high"], 0.7)).toEqual({ reason: "unavailable" });
    expect(readChoice(undefined, ["low"], 0.7)).toEqual({ reason: "unavailable" });
  });

  test("a no-op choice still follows the shared confidence minimum", () => {
    expect(readChoice(pick("none", 0.01), ["none", "consult"], 0.7)).toEqual({
      held: { value: "none", confidence: 0.01, needed: 0.7 }, reason: "low_confidence",
    });
  });
});

describe("effort", () => {
  test("Haiku needs an explicit 5.5 or newer model id for effort", () => {
    for (const id of ["haiku", "claude-haiku-4-5-20251001", "us.anthropic.claude-haiku-4-5-v1:0", "claude-haiku-5-4"])
      expect(supportsEffort(id)).toBe(false);
    for (const id of ["claude-haiku-5-5", "claude-haiku-5-6[1m]", "claude-haiku-6-0"])
      expect(supportsEffort(id)).toBe(true);
    for (const id of ["opus", "claude-sonnet-5-5", "claude-opus-5-5[1m]"]) expect(supportsEffort(id)).toBe(true);
    expect(supportsEffort(undefined)).toBe(false);
  });

  test("a request Jev did not touch goes out as sent, even on Haiku", () => {
    const haiku = { model: "claude-haiku-4-5-20251001", effort: "low" as const };
    const opus = { model: "claude-opus-5-5", effort: "high" as const };
    const disabled = { model: false, effort: false };
    expect(sizeRequest(haiku, {}, disabled).request).toBe(haiku);
    expect(sizeRequest(opus, {}, disabled).request).toBe(opus);
  });

  test("Jev's effort replaces the request's, and a switch to Haiku drops the one it carried", () => {
    const opus = { model: "claude-opus-5-5", effort: "medium" as const };
    const effortOnly = { model: false, effort: true };
    expect(sizeRequest(opus, { effort: "max" }, effortOnly)).toMatchObject({
      request: { model: opus.model, effort: "max" },
      effortOutcome: { kind: "applied", value: "max", from: "medium" },
    });
    expect(sizeRequest(opus, { effort: "medium" }, effortOnly)).toMatchObject({
      request: opus, effortOutcome: { kind: "applied", value: "medium", from: "medium" },
    });
    expect(sizeRequest(opus, { model: "claude-haiku-4-5-20251001" }, { model: true, effort: false }))
      .toMatchObject({ request: { model: "claude-haiku-4-5-20251001" }, ignoredEffort: "medium" });
    expect(sizeRequest({ model: opus.model }, { effort: "high" }, effortOnly))
      .toMatchObject({ request: { model: opus.model, effort: "high" }, effortOutcome: { kind: "applied", value: "high" } });
  });

  test("Jev applies effort to Haiku 5.5 and drops it for Haiku 4.5", () => {
    const effortOnly = { model: false, effort: true };
    expect(sizeRequest({ model: "claude-haiku-5-5", effort: "low" as const }, { effort: "max" }, effortOnly))
      .toMatchObject({
        request: { model: "claude-haiku-5-5", effort: "max" },
        effortOutcome: { kind: "applied", value: "max", from: "low" },
      });
    expect(sizeRequest({ model: "claude-haiku-4-5-20251001", effort: "medium" as const }, { effort: "high" }, effortOnly))
      .toMatchObject({
        request: { model: "claude-haiku-4-5-20251001" },
        effortOutcome: { kind: "ignored", value: "high", why: "haiku_no_effort" },
        ignoredEffort: "high",
      });
  });
});

test("a hint reaches Claude framed the same way wherever it is attached", () => {
  expect(withHint(["a"], "use Read")).toEqual(["a", "<system-reminder>use Read</system-reminder>"]);
  expect(withHint(undefined, "use Read")).toEqual(["<system-reminder>use Read</system-reminder>"]);
});

describe("the request decides the effort on the model it really runs on", () => {
  test("Jev's Haiku pick held back on a [1m] session still applies its effort to the kept model", async ($, on) => {
    const { sent } = world(on, { model: true, effort: true }, {
      tool: pick("Read", 0.9), needs_tool: noul(0.9), model: pick("haiku", 0.99), effort: pick("high", 0.9),
    });
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "rename a variable", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-opus-5-5[1m]", effort: "medium", messageCount: 1 });
    expect(sent).toEqual([{ model: "claude-opus-5-5[1m]", effort: "high" }]);
  });

  test("with every feature off, a Haiku request keeps the effort Claude Code sent", async ($, on) => {
    const { sent } = world(on, {
      tools: false, participation: false, model: false, effort: false,
      delegation: false, agents: false, advisor: false,
    }, {});
    await $.session.start({ cwd: "/workspace" } as never).catch(() => undefined);
    await $.prompt.submit({ text: "hello", wait: false, origin: ORIGIN });
    await step($ as never, { turnId: "t1", index: 0, model: "claude-haiku-4-5-20251001", effort: "low", messageCount: 1 });
    expect(sent).toEqual([{ model: "claude-haiku-4-5-20251001", effort: "low" }]);
  });
});
