import { describe, expect, test } from "claude-code/testing";

import { ADVICE_ON_SCORE, adviceSignals, decideAdvice, nearestProfile } from "../hooks/core/advice.ts";
import { applyCommand, defaultPolicy, editPolicy, normalizePolicy, type OrchestrationPolicy } from "../hooks/core/orchestration.ts";

const COMPLEX = "Refatore a arquitetura do fluxo de orquestração em hooks/orchestrate.ts e hooks/core/objective.ts, e investigue a causa raiz do teste flaky que ainda falha.";
const HARD = `${COMPLEX} Isso roda em produção.`;
const policy = (change: (p: OrchestrationPolicy) => void = () => undefined) => editPolicy(defaultPolicy(), change);

describe("the advisor decides per prompt, locally", () => {
  test("a simple prompt leaves the advisor off", () => {
    for (const text of ["qual é a versão do node?", "hello", "ok, pode seguir", "rename foo to bar"]) {
      const decision = decideAdvice({ text }, policy());
      expect(decision.on).toBe(false);
      expect(decision.profile).toBeUndefined();
      expect(decision.score).toBeLessThan(ADVICE_ON_SCORE);
    }
    expect(decideAdvice({ text: "qual é a versão do node?" }, policy()).why).toBe("simple");
    expect(decideAdvice({ text: "ok, pode seguir" }, policy()).why).toBe("chitchat");
  });

  test("a complex prompt turns the advisor on and picks its model and effort by tier", () => {
    const complex = decideAdvice({ text: COMPLEX }, policy());
    expect(complex).toMatchObject({ on: true, why: "complex", tier: "complex", source: "auto", profile: { model: "claude-sonnet-5-5", effort: "high" } });
    expect(complex.signals).toEqual(expect.arrayContaining(["design", "diagnosis", "files"]));
    const hard = decideAdvice({ text: HARD }, policy());
    expect(hard).toMatchObject({ on: true, tier: "hard", profile: { model: "claude-opus-5-5", effort: "high" } });
    expect(adviceSignals(HARD)).toContain("risk");
  });

  test("the user's fixed choices win over the score", () => {
    // Fixed off: a complex prompt gets no advisor.
    expect(decideAdvice({ text: COMPLEX }, policy((p) => { p.advice = "off"; }))).toMatchObject({ on: false, why: "forced_off" });
    // Fixed on: a simple prompt gets one, with the lowest tier's profile.
    expect(decideAdvice({ text: "hello" }, policy((p) => { p.advice = "on"; }))).toMatchObject({ on: true, why: "forced_on", profile: { model: "claude-sonnet-5-5", effort: "high" } });
    // A fixed advisor model is kept even when the tier would prefer a stronger one.
    const fixed = applyCommand(policy(), "role advisor model fixed haiku").policy;
    expect(decideAdvice({ text: HARD }, fixed)).toMatchObject({ on: true, source: "fixed", profile: { model: "claude-haiku-5-5", effort: "high" } });
    // A trusted override pins both model and effort.
    const override = applyCommand(policy(), "override advisor fable xhigh").policy;
    expect(decideAdvice({ text: COMPLEX }, override)).toMatchObject({ on: true, source: "override", profile: { model: "claude-fable-5-1", effort: "xhigh" } });
  });

  test("the AUTO allowlist, catalogue and allowance still bound the choice", () => {
    const noSonnet = applyCommand(policy(), "role advisor model allow sonnet").policy;
    expect(decideAdvice({ text: COMPLEX }, noSonnet).profile).toEqual({ model: "claude-opus-5-5", effort: "high" });
    expect(decideAdvice({ text: HARD }, policy(), { available: ["claude-haiku-5-5", "claude-sonnet-5-5"] }).profile).toEqual({ model: "claude-sonnet-5-5", effort: "high" });
    expect(decideAdvice({ text: COMPLEX, used: 3 }, policy())).toMatchObject({ on: false, why: "no_allowance" });
    expect(nearestProfile([{ model: "claude-haiku-5-5", effort: "low" }, { model: "claude-haiku-5-5", effort: "max" }], { model: "claude-opus-5-5", effort: "high" }))
      .toEqual({ model: "claude-haiku-5-5", effort: "max" });
  });

  test("advice on|off|auto is a stored, normalized policy value", () => {
    expect(applyCommand(policy(), "advice on").policy.advice).toBe("on");
    expect(applyCommand(policy(), "advice maybe").error).toBe("advice auto|on|off");
    expect(normalizePolicy({ advice: "on" }).advice).toBe("on");
    expect(normalizePolicy({ advice: "sometimes" }).advice).toBe("auto");
  });
});
