import { describe, expect, test } from "claude-code/testing";

import {
  ADVISOR_KEY,
  DEFAULT_FEATURES,
  DELEGATE_KEY,
  EFFORT_KEY,
  MODEL_KEY,
  PARTICIPATE_KEY,
  readTurnPlan,
  type Features,
  type TurnPlan,
} from "../hooks/core/plan.ts";
import { settleEffort, settleModel, turnFunctions, type TurnContext } from "../hooks/watch.ts";
import type { FnResult, TurnDecision } from "../types";
import { noul, pick } from "./helpers.ts";

const ON: Features = { ...DEFAULT_FEATURES, tools: true, participation: true, model: true, effort: true, delegation: true, agents: true, advisor: true };
const CTX: TurnContext = {
  routing: true,
  hasKey: true,
  features: ON,
  userModel: false,
  minConfidence: 0.7,
  session: { currentModel: "claude-opus-5-5", availableModels: ["claude-haiku-4-5-20251001", "claude-sonnet-5-5", "claude-opus-5-5"] },
};
const AGENTS = [{ name: "Explore", description: "Explore the code" }];
const result = (fns: FnResult[], id: FnResult["id"]) => fns.find((one) => one.id === id)!;
const turn = (fns: FnResult[]): TurnDecision => ({ seq: 1, time: 0, turn: 1, consulted: true, fns, settled: false });
const withoutAnswers = (plan: TurnPlan): TurnPlan => {
  const decision = { ...plan.decision };
  delete decision.answers;
  return { ...plan, decision };
};

describe("watch policy", () => {
  test("delegation row follows the normalized decline even when raw answer says otherwise", () => {
    const plan = readTurnPlan({
      mode: "hint",
      tool: "Read",
      confidence: 0.9,
      answers: { [PARTICIPATE_KEY]: noul(0.2), [DELEGATE_KEY]: pick("Explore", 0.4) },
    }, ON, AGENTS, 0.7, CTX.session);
    const delegation = result(turnFunctions(plan, CTX), "delegation");

    expect(delegation).toMatchObject({ result: "none", why: "jev_declined" });
  });

  test("missing participation suppresses tool, delegation, and advisor rows from raw answers", () => {
    const plan = readTurnPlan({
      mode: "hint",
      tool: "Read",
      confidence: 0.9,
      answers: { [DELEGATE_KEY]: pick("Explore", 0.9), [ADVISOR_KEY]: pick("consult", 0.9) },
    }, ON, AGENTS, 0.7, CTX.session);
    const fns = turnFunctions(withoutAnswers(plan), CTX);

    expect(plan.decision).toMatchObject({ mode: "passthrough", reason: "participation_unavailable" });
    expect(result(fns, "tools")).toMatchObject({ result: "none", why: "participation_unavailable" });
    expect(result(fns, "delegation")).toMatchObject({ result: "none", why: "participation_unavailable" });
    expect(result(fns, "advisor")).toMatchObject({ result: "none", why: "participation_unavailable" });
  });

  test("advisor availability and the offered-agent roster remain explicit in the plan", () => {
    const advisorPlan = readTurnPlan({
      mode: "hint",
      tool: "Read",
      confidence: 0.9,
      answers: { [PARTICIPATE_KEY]: noul(0.8), [ADVISOR_KEY]: pick("consult", 0.9) },
    }, ON, AGENTS, 0.7, { ...CTX.session, advisorAvailable: false });
    expect(result(turnFunctions(advisorPlan, CTX), "advisor")).toMatchObject({ result: "none", why: "advisor_unavailable" });

    const noAgents = readTurnPlan({
      mode: "hint",
      tool: "Read",
      confidence: 0.9,
      answers: { [PARTICIPATE_KEY]: noul(0.8) },
    }, ON, [], 0.7, CTX.session);
    expect(result(turnFunctions(noAgents, CTX), "delegation")).toMatchObject({ result: "none", why: "no_agents" });
  });

  test("held choices and thresholds come from the plan DTO", () => {
    const plan = readTurnPlan({
      mode: "hint",
      tool: "Read",
      confidence: 0.9,
      answers: {
        [PARTICIPATE_KEY]: noul(0.8),
        [MODEL_KEY]: pick("claude-haiku-4-5-20251001", 0.8),
        [EFFORT_KEY]: pick("high", 0.4),
        [DELEGATE_KEY]: pick("Explore", 0.4),
      },
    }, ON, AGENTS, 0.7, CTX.session);
    const fns = turnFunctions(withoutAnswers(plan), CTX);

    expect(result(fns, "model")).toMatchObject({ result: "kept", why: "downgrade_confidence", value: "claude-haiku-4-5-20251001", confidence: 0.8, needed: 0.85 });
    expect(result(fns, "effort")).toMatchObject({ result: "kept", why: "low_confidence", value: "high", confidence: 0.4, needed: 0.7 });
    expect(result(fns, "delegation")).toMatchObject({ result: "kept", why: "low_confidence", value: "Explore", confidence: 0.4, needed: 0.7 });
  });

  test("an unusable tool answer does not erase valid model and effort choices", () => {
    const plan = readTurnPlan({
      mode: "passthrough",
      reason: "jev_unexpected_answer",
      answers: {
        [PARTICIPATE_KEY]: noul(0.8),
        [MODEL_KEY]: pick("claude-sonnet-5-5", 0.9),
        [EFFORT_KEY]: pick("high", 0.9),
      },
    }, ON, AGENTS, 0.7, CTX.session);
    const fns = turnFunctions(plan, CTX);

    expect(result(fns, "tools")).toMatchObject({ result: "failed", why: "jev_unexpected_answer" });
    expect(result(fns, "model")).toMatchObject({ result: "applied", value: "claude-sonnet-5-5" });
    expect(result(fns, "effort")).toMatchObject({ result: "applied", value: "high" });
  });

  test("shared feature gates preserve routing, key, and per-feature precedence", () => {
    const noKey = turnFunctions({ decision: { mode: "passthrough", reason: "no_api_key" } }, { ...CTX, hasKey: false });
    expect(noKey.every((fn) => fn.result === "off" && fn.why === "no_api_key")).toBe(true);

    const routingOff = turnFunctions({ decision: { mode: "passthrough", reason: "routing_disabled" } }, { ...CTX, routing: false, hasKey: false });
    expect(routingOff.every((fn) => fn.result === "off" && fn.why === "routing_disabled")).toBe(true);

    const featureOff = turnFunctions({ decision: { mode: "hint", tool: "Read", confidence: 0.9 } }, { ...CTX, features: { ...ON, advisor: false } });
    expect(result(featureOff, "advisor")).toMatchObject({ result: "off", why: "feature_off" });

    const failedWithModelOff = turnFunctions(
      { decision: { mode: "passthrough", reason: "jev_error: provider unavailable" } },
      { ...CTX, userModel: true, features: { ...ON, model: false } },
    );
    expect(result(failedWithModelOff, "model")).toMatchObject({ result: "off", why: "feature_off" });
  });

  test("request settlement updates effective effort and applies a live feature gate", () => {
    const initial = turn([{ id: "effort", result: "applied", value: "high", confidence: 0.9 }]);
    expect(settleEffort(initial, { kind: "ignored", value: "high", why: "haiku_no_effort" }).fns[0]).toMatchObject({
      result: "kept", why: "haiku_no_effort", value: "high",
    });
    expect(settleEffort(initial, { kind: "held", value: "high", why: "default" }).fns[0]).toMatchObject({
      result: "kept", why: "default", value: "high",
    });
    expect(settleEffort(initial, { kind: "applied", value: "high" }, { ...CTX, features: { ...ON, effort: false } }).fns[0]).toMatchObject({
      result: "off", why: "feature_off",
    });
    expect(settleModel(turn([{ id: "model", result: "applied", value: "claude-sonnet-5-5" }]), undefined, { ...CTX, routing: false }).fns[0]).toMatchObject({
      result: "off", why: "routing_disabled",
    });
  });

  test("settlement reports Claude Code's actual model when a previous selection is not reapplied", () => {
    const baseline = "claude-opus-5-5";
    const previous = "claude-sonnet-5-5";
    const noSelection = turn([{ id: "model", result: "none", why: "unavailable", value: previous, from: previous }]);
    expect(settleModel(noSelection, { kind: "same", model: baseline }).fns[0]).toMatchObject({
      result: "none", why: "unavailable", value: baseline, from: baseline,
    });
    const held = turn([{ id: "model", result: "kept", why: "low_confidence", value: "claude-haiku-4-5-20251001", from: previous }]);
    expect(settleModel(held, { kind: "same", model: baseline }).fns[0]).toMatchObject({
      result: "kept", value: "claude-haiku-4-5-20251001", from: baseline,
    });
  });

  test("a blocked advisor is not marked as a failed answer when the tool response is unusable", () => {
    const plan = readTurnPlan({ mode: "passthrough", reason: "jev_unexpected_answer", answers: {
      [PARTICIPATE_KEY]: noul(0.8),
    } }, ON, AGENTS, 0.7, { ...CTX.session, advisorAvailable: false });
    expect(result(turnFunctions(plan, CTX), "advisor")).toMatchObject({ result: "none", why: "advisor_unavailable" });
  });
});
