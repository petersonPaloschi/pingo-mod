import { describe, expect, test } from "claude-code/testing";

import {
  applyCommand,
  catalogueModel,
  CLAUDE_MODELS,
  defaultPolicy,
  editPolicy,
  migratePolicy,
  nativeAdvisorOptions,
  normalizePolicy,
  offeredProfiles,
  readConcurrency,
  readProfile,
  reviewCap,
  roleQuestion,
  workModeQuestion,
  continuityQuestion,
  guidanceQuestion,
  concurrencyQuestion,
  nativeAdvisorQuestion,
  type OrchestrationPolicy,
} from "../hooks/core/orchestration.ts";
import { supportsEffort } from "../hooks/core/plan.ts";
import { resolveSettings } from "../hooks/config.ts";
import { text } from "../hooks/i18n.ts";
import { pick } from "./helpers.ts";

const on = (change: (p: OrchestrationPolicy) => void = () => undefined) => editPolicy({ ...defaultPolicy(), enabled: true }, change);

describe("orchestration catalogue", () => {
  test("only the four exact Claude IDs are offered, Fable included", () => {
    expect([...CLAUDE_MODELS]).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]);
    expect(catalogueModel("claude-fable-5-1")).toBe("claude-fable-5-1");
    expect(catalogueModel("us.anthropic.claude-opus-5-5-v1:0")).toBe("claude-opus-5-5");
    expect(catalogueModel("claude-sonnet-5-5[1m]")).toBe("claude-sonnet-5-5");
    expect(catalogueModel("sonnet")).toBeUndefined();
    expect(catalogueModel("claude-opus-4-6")).toBeUndefined();
    expect(catalogueModel("claude-fable-5-1-bogus")).toBeUndefined();
  });

  test("Fable keeps its effort; bare Haiku alias still does not", () => {
    expect(supportsEffort("claude-fable-5-1")).toBe(true);
    expect(supportsEffort("claude-haiku-5-5")).toBe(true);
    expect(supportsEffort("haiku")).toBe(false);
  });

  test("claude_models limits availability only when set; Fable survives the filter", () => {
    expect(resolveSettings({}, {}).catalogue).toBeUndefined();
    expect(resolveSettings({ claude_models: "claude-fable-5-1, claude-haiku-5-5, gpt-5" }, {}).catalogue).toEqual(["claude-fable-5-1", "claude-haiku-5-5"]);
  });
});

describe("orchestration policy record", () => {
  test("new installs: all roles AUTO over four models and five efforts, review on, off until enabled", () => {
    const policy = migratePolicy(undefined);
    expect(policy.version).toBe(1);
    expect(policy.enabled).toBe(false);
    for (const role of ["executor", "subagent", "advisor"] as const) {
      expect(policy.roles[role].model.mode).toBe("auto");
      expect(policy.roles[role].model.allowed).toEqual([...CLAUDE_MODELS]);
      expect(policy.roles[role].effort.allowed).toEqual(["low", "medium", "high", "xhigh", "max"]);
      expect(policy.roles[role].model.fallback).toEqual([]);
    }
    expect(policy.review).toBe(true);
    expect(policy.limits).toMatchObject({ workers: 3, reviewers: 1, activeCalls: 4, units: 30, adviceCalls: 3, repairRounds: 2, reviewPasses: 3 });
    expect(JSON.stringify(policy)).not.toMatch(/key/i);
  });

  test("normalizing drops invented models, efforts and out-of-range limits", () => {
    const policy = normalizePolicy({
      version: 1,
      revision: 4,
      enabled: true,
      roles: { executor: { model: { mode: "fixed", fixed: "gpt-5", allowed: ["claude-x", "claude-opus-5-5"] }, effort: { mode: "fixed", fixed: "ultra" } } },
      limits: { workers: 999, reviewers: -3, units: "many" },
      apiKey: "secret",
    });
    expect(policy.revision).toBe(4);
    expect(policy.roles.executor.model.fixed).toBe("claude-sonnet-5-5");
    expect(policy.roles.executor.model.allowed).toEqual(["claude-opus-5-5"]);
    expect(policy.roles.executor.effort.fixed).toBe("medium");
    expect(policy.limits.workers).toBe(16);
    expect(policy.limits.reviewers).toBe(1);
    expect(policy.limits.units).toBe(30);
    expect("apiKey" in policy).toBe(false);
    expect(normalizePolicy({ version: 2, enabled: true }).enabled).toBe(false);
  });

  test("commands edit a copy, bump the revision and never empty an allowlist", () => {
    const base = on();
    const fixed = applyCommand(base, "role executor model fixed haiku");
    expect(fixed.error).toBeUndefined();
    expect(fixed.policy.revision).toBe(base.revision + 1);
    expect(fixed.policy.roles.executor.model).toMatchObject({ mode: "fixed", fixed: "claude-haiku-5-5" });
    expect(base.roles.executor.model.mode).toBe("auto");
    let p = base;
    for (const id of ["haiku", "sonnet", "opus"]) p = applyCommand(p, `role advisor model allow ${id}`).policy;
    expect(p.roles.advisor.model.allowed).toEqual(["claude-fable-5-1"]);
    expect(applyCommand(p, "role advisor model allow fable").error).toMatch(/at least one/);
    expect(applyCommand(base, "role executor model fixed gpt-5").error).toBeTruthy();
    expect(applyCommand(base, "role executor effort fixed ultra").error).toBeTruthy();
    expect(applyCommand(base, "limit workers 2").policy.limits.workers).toBe(2);
    expect(applyCommand(base, "override executor opus high").policy.override.executor).toEqual({ model: "claude-opus-5-5", effort: "high" });
    expect(applyCommand(base, "agent Explore haiku low").policy.agentTypes.Explore).toEqual({ model: "claude-haiku-5-5", effort: "low" });
    expect(applyCommand(base, "native fixed fable").policy.nativeAdvisor).toEqual({ mode: "fixed", model: "claude-fable-5-1" });
  });
});

describe("offered profiles", () => {
  test("AUTO offers every allowed model/effort pair, at most 20", () => {
    const offer = offeredProfiles(on(), "executor");
    expect(Object.keys(offer.profiles)).toHaveLength(20);
    expect(offer.profiles.fable_xhigh).toEqual({ model: "claude-fable-5-1", effort: "xhigh" });
    expect(offer.source).toBe("auto");
  });

  test("fixed values and AUTO subsets constrain every offered profile", () => {
    const policy = on((p) => {
      p.roles.subagent.model = { ...p.roles.subagent.model, mode: "fixed", fixed: "claude-haiku-5-5" };
      p.roles.subagent.effort = { ...p.roles.subagent.effort, mode: "fixed", fixed: "max" };
      p.roles.advisor.model.allowed = ["claude-sonnet-5-5", "claude-opus-5-5"];
      p.roles.advisor.effort.allowed = ["high"];
    });
    expect(offeredProfiles(policy, "subagent").profiles).toEqual({ haiku_max: { model: "claude-haiku-5-5", effort: "max" } });
    expect(Object.keys(offeredProfiles(policy, "advisor").profiles)).toEqual(["sonnet_high", "opus_high"]);
  });

  test("a trusted override wins, an agent-type refinement applies to subagents only", () => {
    const policy = on((p) => {
      p.override.executor = { model: "claude-opus-5-5" };
      p.agentTypes.Explore = { model: "claude-haiku-5-5", effort: "low" };
    });
    expect(Object.keys(offeredProfiles(policy, "executor").profiles)).toEqual(["opus_low", "opus_medium", "opus_high", "opus_xhigh", "opus_max"]);
    expect(offeredProfiles(policy, "subagent", {}, "Explore").profiles).toEqual({ haiku_low: { model: "claude-haiku-5-5", effort: "low" } });
    expect(Object.keys(offeredProfiles(policy, "subagent", {}, "general-purpose").profiles)).toHaveLength(20);
  });

  test("an unavailable model is never a fifth fallback; a fixed one holds unless a fallback is enabled", () => {
    const caps = { available: ["claude-haiku-5-5", "claude-sonnet-5-5"] as const };
    expect(Object.keys(offeredProfiles(on(), "executor", { available: [...caps.available] }).profiles).every((k) => /^(haiku|sonnet)_/.test(k))).toBe(true);
    const fixed = on((p) => { p.roles.executor.model = { ...p.roles.executor.model, mode: "fixed", fixed: "claude-fable-5-1" }; });
    expect(offeredProfiles(fixed, "executor", { available: [...caps.available] })).toMatchObject({ profiles: {}, held: "fixed_model_unavailable" });
    const withFallback = editPolicy(fixed, (p) => { p.roles.executor.model.fallback = ["claude-opus-5-5", "claude-sonnet-5-5"]; });
    expect(Object.keys(offeredProfiles(withFallback, "executor", { available: [...caps.available] }).profiles)[0]).toMatch(/^sonnet_/);
  });

  test("a single profile applies locally; Jev's choice must be offered and confident", () => {
    const single = offeredProfiles(on((p) => { p.roles.executor.model.mode = "fixed"; p.roles.executor.effort.mode = "fixed"; }), "executor");
    expect(readProfile(single, undefined, 0.7)).toMatchObject({ local: true, profile: { model: "claude-sonnet-5-5", effort: "medium" } });
    const offer = offeredProfiles(on(), "executor");
    expect(readProfile(offer, pick("opus_high", 0.9, ), 0.7)).toMatchObject({ profile: { model: "claude-opus-5-5", effort: "high" } });
    expect(readProfile(offer, pick("opus_ultra", 0.99), 0.7)).toEqual({ none: "unavailable" });
    expect(readProfile(offer, pick("claude-opus-5-5", 0.99), 0.7)).toEqual({ none: "unavailable" });
    expect(readProfile(offer, { type: "choice", choice: "opus_high", confidence: 1.4, probabilities: {} }, 0.7)).toEqual({ none: "unavailable" });
    expect(readProfile(offer, pick("opus_high", 0.4), 0.7)).toMatchObject({ held: { model: "claude-opus-5-5" }, needed: 0.7 });
  });

  test("native advisor options follow the compatibility matrix and never carry an effort", () => {
    const auto = on((p) => { p.nativeAdvisor.mode = "auto"; });
    expect(nativeAdvisorOptions(auto, "claude-opus-5-5")).toEqual(["claude-opus-5-5", "claude-fable-5-1"]);
    expect(nativeAdvisorOptions(auto, "claude-fable-5-1")).toEqual(["claude-fable-5-1"]);
    const incompatible = on((p) => { p.nativeAdvisor = { mode: "fixed", model: "claude-haiku-5-5" }; });
    expect(nativeAdvisorOptions(incompatible, "claude-sonnet-5-5")).toEqual([]);
    expect(nativeAdvisorOptions(on(), "claude-haiku-5-5")).toEqual([]);
    expect(Object.values(nativeAdvisorQuestion(["claude-opus-5-5"]).criteria)).toEqual([{ model: "claude-opus-5-5" }]);
  });

  test("review output caps by effort", () => {
    expect([reviewCap("low"), reviewCap("medium"), reviewCap("high"), reviewCap("xhigh"), reviewCap("max")]).toEqual([8192, 8192, 16384, 32768, 64000]);
  });
});

describe("decision prompts", () => {
  test("role questions carry the common prefix, the role prompt and the decision suffix, with only offered profiles", () => {
    const offer = offeredProfiles(on((p) => { p.roles.subagent.model.allowed = ["claude-haiku-5-5", "claude-sonnet-5-5"]; p.roles.subagent.effort.allowed = ["medium", "high"]; }), "subagent");
    const question = roleQuestion("unit_0_executor", "U01", "subagent", offer.profiles);
    expect(question.type).toBe("choice");
    expect(question.instructions.startsWith("You select execution policy for one Pingo objective.")).toBe(true);
    expect(question.instructions).toContain("Select the complete model-and-effort profile for the role and unit identified at the end of this question.");
    expect(question.instructions.endsWith("Decision key: unit_0_executor. Unit: U01. Role: subagent.")).toBe(true);
    expect(question.criteria).toEqual({
      haiku_medium: { model: "claude-haiku-5-5", effort: "medium" },
      haiku_high: { model: "claude-haiku-5-5", effort: "high" },
      sonnet_medium: { model: "claude-sonnet-5-5", effort: "medium" },
      sonnet_high: { model: "claude-sonnet-5-5", effort: "high" },
    });
    expect("system" in question).toBe(false);
  });

  test("Portuguese prompts are complete equivalents with the same choice keys", () => {
    const pt = roleQuestion("k", "U", "advisor", { sonnet_high: { model: "claude-sonnet-5-5", effort: "high" } }, "pt");
    expect(pt.instructions.startsWith("Você seleciona a política de execução de um objetivo do Pingo.")).toBe(true);
    expect(pt.instructions.endsWith("Chave da decisão: k. Unidade: U. Papel: advisor.")).toBe(true);
    expect(Object.keys(workModeQuestion("pt").criteria)).toEqual(["direct", "managed", "batch_candidate"]);
    expect(Object.keys(continuityQuestion("pt").criteria)).toEqual(["continue", "revise", "new"]);
    expect(Object.keys(guidanceQuestion(["none", "plan"], "pt").criteria)).toEqual(["none", "plan"]);
    expect(Object.keys(concurrencyQuestion(3, "pt").criteria)).toEqual(["1", "2", "3"]);
    for (const key of ["common", "continuity", "workMode", "roleProfile", "guidance", "concurrency", "nativeAdvisor"] as const) {
      expect(text(`orchestration.prompt.${key}`, "pt")).not.toBe(text(`orchestration.prompt.${key}`, "en"));
      expect(text(`orchestration.prompt.${key}`, "pt").length).toBeGreaterThan(100);
    }
  });

  test("concurrency is an offered integer; anything else or unsure means one", () => {
    expect(readConcurrency(pick("3", 0.9), 3, 0.7)).toEqual({ workers: 3, confident: true });
    expect(readConcurrency(pick("4", 0.9), 3, 0.7)).toEqual({ workers: 1, confident: false });
    expect(readConcurrency(pick("2", 0.3), 3, 0.7)).toEqual({ workers: 1, confident: false });
    expect(readConcurrency(undefined, 1, 0.7)).toEqual({ workers: 1, confident: true });
  });
});
