import { describe, expect, test } from "claude-code/testing";

import { decideObjective, restoreObjective, type Objective } from "../hooks/core/objective.ts";
import { defaultPolicy, editPolicy, normalizePolicy, type OrchestrationPolicy } from "../hooks/core/orchestration.ts";
import type { Answer, SystemOneRequest } from "../hooks/core/types.ts";
import { pick } from "./helpers.ts";

const CONFIG = { jevModel: "jev-latest", minConfidence: 0.7, maxMessageChars: 4000 };
const policy = (change: (p: OrchestrationPolicy) => void = () => undefined) => editPolicy({ ...defaultPolicy(), enabled: true }, change);

function jev(answers: Record<string, Answer>) {
  const asked: SystemOneRequest[] = [];
  return {
    asked,
    ask: async (request: SystemOneRequest) => {
      asked.push(request);
      return { answers, usage: { input_tokens: 10, output_tokens: 0 } };
    },
  };
}

const input = (extra: Partial<Parameters<typeof decideObjective>[0]> = {}) => ({
  text: "Add a cache to the loader",
  attachments: 0,
  policy: policy(),
  now: 1000,
  newId: () => "O1",
  ...extra,
});

describe("objective decisions", () => {
  test("a new input asks work mode and the executor profile in one typed SystemOne request", async () => {
    const j = jev({ work_mode: pick("managed", 0.9), objective_executor: pick("sonnet_high", 0.9), guidance: pick("none", 0.9) });
    const decision = await decideObjective(input({ attachments: 2 }), CONFIG, j.ask);
    expect(j.asked).toHaveLength(1);
    const request = j.asked[0]!;
    expect(Object.keys(request).sort()).toEqual(["model", "questions", "state"]);
    expect(Object.keys(request.questions).sort()).toEqual(["guidance", "objective_executor", "work_mode"]);
    expect(Object.values(request.questions).every((q) => q.type === "choice")).toBe(true);
    expect(request.state).toMatchObject({ prompt_version: "orchestration-v1", uninspected_attachments: 2, active_objective: null });
    expect((request.state.decisions as Record<string, { offered: string[] }>).objective_executor!.offered).toHaveLength(20);
    expect(decision.objective).toMatchObject({ id: "O1", workMode: "managed", workModeConfident: true, executor: { model: "claude-sonnet-5-5", effort: "high" } });
    expect(decision.continuity).toBe("new");
  });

  test("Haiku max fixed: no executor question, the profile applies locally", async () => {
    const j = jev({ work_mode: pick("direct", 0.9) });
    const fixed = policy((p) => {
      p.roles.executor.model = { ...p.roles.executor.model, mode: "fixed", fixed: "claude-haiku-5-5" };
      p.roles.executor.effort = { ...p.roles.executor.effort, mode: "fixed", fixed: "max" };
    });
    const decision = await decideObjective(input({ policy: fixed }), CONFIG, j.ask);
    expect(Object.keys(j.asked[0]!.questions)).not.toContain("objective_executor");
    expect(decision.objective?.executor).toEqual({ model: "claude-haiku-5-5", effort: "max" });
  });

  test("continue keeps the active snapshot and ignores a replacement proposal", async () => {
    const active: Objective = { id: "O0", startedAt: 1, policy: policy(), workMode: "managed", workModeConfident: true, executor: { model: "claude-opus-5-5", effort: "high" }, adviceUsed: 1 };
    const j = jev({ continuity: pick("continue", 0.95), work_mode: pick("direct", 0.9), objective_executor: pick("haiku_low", 0.95) });
    const decision = await decideObjective(input({ active }), CONFIG, j.ask);
    expect(Object.keys(j.asked[0]!.questions)).toContain("continuity");
    expect(decision.objective).toBe(active);
  });

  test("unsure continuity keeps the active plan; a dashboard edit waits for the next objective", async () => {
    const active: Objective = { id: "O0", startedAt: 1, policy: policy(), workMode: "managed", workModeConfident: true, executor: { model: "claude-opus-5-5", effort: "high" }, adviceUsed: 0 };
    const edited = policy((p) => { p.roles.executor.model = { ...p.roles.executor.model, mode: "fixed", fixed: "claude-haiku-5-5" }; });
    const decision = await decideObjective(input({ active, policy: edited }), CONFIG, jev({ continuity: pick("new", 0.3) }).ask);
    expect(decision.continuity).toBe("continue");
    expect(decision.held).toContain("continuity");
    expect(decision.objective?.executor).toEqual({ model: "claude-opus-5-5", effort: "high" });
  });

  test("apply-to-current takes the new policy at the next input, keeping a still-offered profile", async () => {
    const active: Objective = { id: "O0", startedAt: 1, policy: policy(), workMode: "managed", workModeConfident: true, executor: { model: "claude-opus-5-5", effort: "high" }, adviceUsed: 0, applyPending: true };
    const narrowed = policy((p) => { p.roles.executor.model.allowed = ["claude-haiku-5-5"]; });
    const decision = await decideObjective(input({ active, policy: narrowed }), CONFIG, jev({ continuity: pick("continue", 0.9), objective_executor: pick("haiku_medium", 0.9) }).ask);
    expect(decision.objective?.executor).toEqual({ model: "claude-haiku-5-5", effort: "medium" });
    expect(decision.objective?.policy).toBe(narrowed);
    expect(decision.objective?.applyPending).toBeUndefined();
  });

  test("a low-confidence executor stays native for a new objective and keeps the valid profile on revise", async () => {
    const fresh = await decideObjective(input(), CONFIG, jev({ work_mode: pick("managed", 0.9), objective_executor: pick("fable_max", 0.2) }).ask);
    expect(fresh.objective?.executor).toBeUndefined();
    expect(fresh.objective?.executorWhy).toBe("low_confidence");
    const active: Objective = { id: "O0", startedAt: 1, policy: policy(), workMode: "managed", workModeConfident: true, executor: { model: "claude-sonnet-5-5", effort: "medium" }, adviceUsed: 2 };
    const revised = await decideObjective(input({ active }), CONFIG, jev({ continuity: pick("revise", 0.9), work_mode: pick("managed", 0.9), objective_executor: pick("fable_max", 0.2) }).ask);
    expect(revised.objective).toMatchObject({ id: "O0", executor: { model: "claude-sonnet-5-5", effort: "medium" }, adviceUsed: 2 });
  });

  test("an unsure work mode falls back to managed, so changes still meet review", async () => {
    const decision = await decideObjective(input(), CONFIG, jev({ work_mode: pick("direct", 0.4), objective_executor: pick("haiku_low", 0.9) }).ask);
    expect(decision.objective).toMatchObject({ workMode: "managed", workModeConfident: false });
  });

  test("a failed Jev call fails open: no new objective, an active one continues", async () => {
    const failing = async () => { throw new Error("timeout"); };
    const none = await decideObjective(input(), CONFIG, failing);
    expect(none.objective).toBeUndefined();
    expect(none.failure).toMatch(/jev_error/);
    const active: Objective = { id: "O0", startedAt: 1, policy: policy(), workMode: "direct", workModeConfident: true, adviceUsed: 0 };
    expect((await decideObjective(input({ active }), CONFIG, failing)).objective).toBe(active);
  });

  test("no guidance question once the advice allowance is spent", async () => {
    const active: Objective = { id: "O0", startedAt: 1, policy: policy(), workMode: "managed", workModeConfident: true, adviceUsed: 3 };
    const j = jev({ continuity: pick("continue", 0.9) });
    await decideObjective(input({ active }), CONFIG, j.ask);
    expect(Object.keys(j.asked[0]!.questions)).not.toContain("guidance");
  });

  test("a restored objective drops a profile no longer offered by its own policy", () => {
    const narrow = policy((p) => { p.roles.executor.model.allowed = ["claude-haiku-5-5"]; });
    const restored = restoreObjective({ id: "O0", startedAt: 1, policy: narrow, workMode: "managed", executor: { model: "claude-fable-5-1", effort: "max" }, adviceUsed: 0 }, normalizePolicy);
    expect(restored?.executor).toBeUndefined();
    expect(restoreObjective({ id: 3 }, normalizePolicy)).toBeUndefined();
  });
});
