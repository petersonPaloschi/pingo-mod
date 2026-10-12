import { askTimed } from "../core/request.ts";
import type { Questions } from "../core/types.ts";
import { truncate } from "../core/state.ts";
import { ORCHESTRATION_PROMPT_VERSION } from "../core/prompts.ts";
import { MODEL_LABEL, offeredProfiles, readProfile, roleQuestion, type Capabilities, type OrchestrationPolicy, type Profile, type Role } from "../core/orchestration.ts";
import { decideObjective, type Objective } from "../core/objective.ts";
import { ADVICE_ON_SCORE, decideAdvice, type AdviceDecision, type AdviceSignal } from "../core/advice.ts";
import { formatDuration, text } from "../i18n.ts";
import { runGuidance } from "../core/review.ts";
import type { Settings } from "../config.ts";
import { type Io } from "./types.ts";
import { exclusive, readPolicy, readObjective, saveObjective, takeNotes } from "./state.ts";

const HUMAN = new Set(["composer", "bridge", "sdk"]);

/** Catalogue models the user limited Claude to; unknown (all four possible) without that option. */
const capsOf = (config: Settings): Capabilities => (config.catalogue ? { available: config.catalogue } : {});



// --- New human input: one Jev request for continuity, work mode and executor ---

export async function onPromptSubmit(io: Io, e: { text: string; attachments?: readonly unknown[]; origin: { kind: string }; turnId?: string }): Promise<string[]> {
  if (e.turnId || !HUMAN.has(e.origin.kind)) return [];
  const policy = await readPolicy(io);
  const notes = await takeNotes(io);
  const config = await io.settings();
  const closed = await io.gate(config);
  // Off: executor and subagents stay native; the advisor still decides locally, per prompt,
  // unless Jev itself is off (no key is fine: the local decision and the advisor need none).
  if (!policy.enabled || closed) {
    if (closed && policy.enabled) await io.log("muted", `Orchestration: AUTO did not apply (${closed}); the request stays native.`);
    if (closed === "routing_disabled") {
      await io.log("muted", text("feed.advice.off", config.locale, { why: text("feed.advice.why.jev_off", config.locale) }));
      await io.noteAdvice?.({ at: await io.now(), on: false, why: "jev_off", decider: "local" });
      return notes;
    }
    // Orchestration off decides locally whatever Jev's state; "gate" is only an on policy Jev cannot serve.
    // With no objective to count on, limits.adviceCalls caps the guidance given this session.
    const used = await io.localAdviceUsed?.() ?? 0;
    const local = await localAdvice(io, config, policy, e, policy.enabled ? "gate" : "local", used);
    if (local.length) await io.countLocalAdvice?.();
    return [...notes, ...local];
  }
  return exclusive(async () => {
    const active = await readObjective(io);
    const now = await io.now();
    const decision = await decideObjective({
      text: e.text,
      attachments: e.attachments?.length ?? 0,
      ...(active ? { active } : {}),
      policy,
      caps: capsOf(config),
      now,
      newId: () => `O${now.toString(36)}`,
    }, { ...config, promptLocale: config.promptLocale }, io.askJev(config, { origin: "prompt" }), () => Date.now());
    let objective = decision.objective;
    if (decision.failure) await io.log("warn", "Orchestration: Jev failed, AUTO did not apply; the request stays native.", decision.failure);
    const lines = [...notes];
    const executor = objective?.executor ? `${MODEL_LABEL[objective.executor.model]} ${objective.executor.effort}` : `native (${objective?.executorWhy ?? "unset"})`;
    if (objective) await io.log(decision.held.length ? "warn" : "good", `Orchestration: ${decision.continuity} objective ${objective.id} - ${objective.workMode}${objective.workModeConfident ? "" : " (default)"} - executor ${executor}`, decision.held.length ? `held: ${decision.held.join(", ")}` : undefined);
    if (decision.failure) {
      // Jev gave no guidance answer: the local decision stands in, counted on the objective it keeps.
      const local = await localAdvice(io, config, policy, e, "jev_failed", objective?.adviceUsed ?? 0);
      if (local.length && objective) objective = { ...objective, adviceUsed: objective.adviceUsed + 1 };
      lines.push(...local);
    } else if (objective) {
      // A fixed "on" wins over Jev's none; with "off" Jev was not asked, so its answer is none.
      const purpose = decision.guidance === "none" && policy.advice === "on" ? "plan" : decision.guidance;
      const allowance = objective.adviceUsed < objective.policy.limits.adviceCalls;
      await logAdvice(io, config, {
        on: purpose !== "none" && allowance,
        why: policy.advice === "off" ? "forced_off" : !allowance ? "no_allowance" : purpose !== decision.guidance ? "forced_on" : "jev",
        decider: "jev",
        purpose,
        executor,
      });
      if (purpose !== "none" && allowance) {
        const advice = await guidance(io, config, objective, e.text, purpose);
        if (advice) {
          objective = { ...objective, adviceUsed: objective.adviceUsed + 1 };
          lines.push(`Pingo advisor guidance (${purpose}; optional, not approval):\n${advice}`);
        }
      }
    }
    if (objective) lines.unshift(objectiveNote(objective));
    await saveObjective(io, objective);
    return lines;
  });
}

/** Guidance given while the executor stays native waits less: the prompt holds until it returns. */
const LOCAL_ADVICE_TIMEOUT_MS = 30_000;

type Decider = "local" | "gate" | "jev_failed" | "jev";

/**
 * The advisor decided here, without Jev: the local score picks on or off and the advisor profile
 * (override, fixed values and AUTO allowlist first). Returns the guidance line for the prompt's
 * context, or nothing. A failed consult is logged as a failure, not as "off", and is not counted.
 */
async function localAdvice(io: Io, config: Settings, policy: OrchestrationPolicy, e: { text: string; attachments?: readonly unknown[] }, decider: Exclude<Decider, "jev">, used = 0): Promise<string[]> {
  const decision = decideAdvice({ text: e.text, attachments: e.attachments?.length ?? 0, used }, policy, capsOf(config));
  await logAdvice(io, config, { ...decision, decider, purpose: "plan", executor: text("feed.advice.executorNative", config.locale) });
  if (!decision.on || !decision.profile) return [];
  const profile = decision.profile;
  const started = await io.now();
  const result = await runGuidance(io.complete, {
    goal: truncate(e.text, 8000, config.locale),
    constraints: ["Executor: native (orchestration does not choose it)", "Work mode: not managed"],
    evidence: "",
    purpose: "plan",
  }, profile, Math.min(policy.limits.callTimeoutMs, LOCAL_ADVICE_TIMEOUT_MS));
  const duration = formatDuration((await io.now()) - started, config.locale);
  const model = `${MODEL_LABEL[profile.model]} ${profile.effort}`;
  const endedAt = await io.now();
  if (!result.text) {
    await io.log("bad", text("feed.advice.failed", config.locale, { model, why: result.problem ?? "empty", duration }));
    await io.noteAdvice?.({ outcome: "failed", endedAt, problem: result.problem ?? "empty" });
    return [];
  }
  await io.log("good", text("feed.advice.given", config.locale, { model, duration }));
  await io.noteAdvice?.({ outcome: "given", endedAt, guidance: result.text });
  return [`Pingo advisor guidance (plan; optional, not approval):\n${result.text}`];
}

/** One line per prompt in Live: advisor on or off, its model and effort, why, and who decided. */
async function logAdvice(io: Io, config: Settings, d: {
  on: boolean; why: AdviceDecision["why"] | "jev"; decider: Decider; purpose: string; executor: string;
  score?: number; tier?: AdviceDecision["tier"]; signals?: readonly AdviceSignal[]; profile?: Profile; source?: AdviceDecision["source"];
}): Promise<void> {
  const locale = config.locale;
  const why = text(`feed.advice.why.${d.why}`, locale, {
    score: String(d.score ?? 0),
    need: String(ADVICE_ON_SCORE),
    tier: d.tier ? text(`feed.advice.tier.${d.tier}`, locale) : "",
    purpose: d.purpose,
  });
  const head = d.on
    ? text("feed.advice.on", locale, { model: d.profile ? `${MODEL_LABEL[d.profile.model]} ${d.profile.effort}` : text("feed.advice.modelByJev", locale), why })
    : text("feed.advice.off", locale, { why });
  const detail = [
    d.signals ? text("feed.advice.signals", locale, { signals: d.signals.length ? d.signals.map((s) => text(`feed.advice.signal.${s}`, locale)).join(", ") : text("feed.advice.signal.none", locale) }) : "",
    text("feed.advice.decider", locale, { decider: text(`feed.advice.decider.${d.decider}`, locale) }),
    d.source ? text("feed.advice.source", locale, { source: text(`feed.advice.source.${d.source}`, locale) }) : "",
    text("feed.advice.executor", locale, { executor: d.executor }),
  ].filter(Boolean).join(" - ");
  await io.log(d.on ? "info" : "muted", head, detail);
  await io.noteAdvice?.({
    at: await io.now(),
    on: d.on,
    why: d.why,
    decider: d.decider,
    purpose: d.purpose,
    ...(d.score === undefined ? {} : { score: d.score, need: ADVICE_ON_SCORE }),
    ...(d.tier ? { tier: d.tier } : {}),
    ...(d.signals ? { signals: [...d.signals] } : {}),
    ...(d.profile ? { model: d.profile.model, effort: d.profile.effort } : {}),
    ...(d.source ? { source: d.source } : {}),
  });
}

function objectiveNote(objective: Objective): string {
  const parts = [
    `Pingo orchestration (${ORCHESTRATION_PROMPT_VERSION}): objective ${objective.id}, work mode ${objective.workMode}.`,
    objective.workMode === "direct" ? "Answer directly; no delegated workers are needed." : "",
    objective.policy.review ? "Every delegated subagent result is independently reviewed; a result without an approving review stays unverified." : "Independent review is off: delegated results stay unverified.",
    objective.workMode === "batch_candidate" && objective.policy.batch === "auto"
      ? "If the work splits into independent units, submit a unit plan with the mcp__jev__managed_batch tool instead of launching workers yourself."
      : "",
  ];
  return parts.filter(Boolean).join(" ");
}

async function guidance(io: Io, config: Settings, objective: Objective, goal: string, purpose: "plan" | "recover"): Promise<string | undefined> {
    const profile = await chooseProfiles(io, config, objective.policy, [{ key: "guidance_advisor", unit: objective.id, role: "advisor" }]);
  const advisor = profile.guidance_advisor;
  if (!advisor) {
    await io.log("warn", "Orchestration: guidance skipped, no advisor profile was confidently chosen.");
    await io.noteAdvice?.({ outcome: "failed", endedAt: await io.now(), problem: "no advisor profile was confidently chosen" });
    return undefined;
  }
  await io.noteAdvice?.({ model: advisor.model, effort: advisor.effort });
  const result = await runGuidance(io.complete, {
    goal: truncate(goal, 8000, config.locale),
    constraints: [`Executor: ${objective.executor ? `${objective.executor.model} ${objective.executor.effort}` : "native"}`, `Work mode: ${objective.workMode}`],
    evidence: "",
    purpose,
  }, advisor, Math.min(objective.policy.limits.callTimeoutMs, 60_000));
  await io.log(result.text ? "good" : "warn", result.text ? `Orchestration: ${MODEL_LABEL[advisor.model]} ${advisor.effort} gave ${purpose} guidance` : `Orchestration: guidance failed (${result.problem})`);
  await io.noteAdvice?.(result.text
    ? { outcome: "given", endedAt: await io.now(), guidance: result.text }
    : { outcome: "failed", endedAt: await io.now(), problem: result.problem ?? "empty" });
  return result.text;
}

/** The executor profile for the main loop's requests, while orchestration is on. */
export async function mainProfile(io: Io): Promise<Profile | undefined> {
  const policy = await readPolicy(io);
  if (!policy.enabled) return undefined;
  return (await readObjective(io))?.executor;
}

/**
 * The user picked a model themselves (/model, the picker): a trusted override. The active objective
 * stops rewriting the main loop's model and effort until a new objective starts.
 */
export async function userSwitchedModel(io: Io): Promise<void> {
  await exclusive(async () => {
    const objective = await readObjective(io);
    if (!objective?.executor) return;
    const { executor: _executor, ...rest } = objective;
    await saveObjective(io, { ...rest, executorWhy: "user_model_switch" });
    await io.log("info", "Orchestration: you switched the model; this objective's executor stays native until the next objective.");
  });
}

/**
 * What a main-loop request was sent with, and the model its reply named. The runtime reports no
 * effort back, so observed effort stays unknown; a fallback model is shown, never adopted.
 */
export async function noteApplied(io: Io, applied: { model: string; effort?: string }, observedModel: string | undefined): Promise<void> {
  await exclusive(async () => {
    const objective = await readObjective(io);
    if (!objective) return;
    await saveObjective(io, {
      ...objective,
      applied: { model: applied.model, ...(applied.effort ? { effort: applied.effort } : {}) },
      ...(observedModel ? { observed: { model: observedModel } } : {}),
    });
  });
}

// --- Profiles for subagents and reviewers, up to six decisions per Jev request ---

interface Decision { key: string; unit: string; role: Role; agentType?: string }

export async function chooseProfiles(io: Io, config: Settings, policy: OrchestrationPolicy, decisions: readonly Decision[], state: Record<string, unknown> = {}): Promise<Record<string, Profile | undefined>> {
    const chosen: Record<string, Profile | undefined> = {};
  const asking: { decision: Decision; offer: ReturnType<typeof offeredProfiles> }[] = [];
  for (const decision of decisions) {
    const offer = offeredProfiles(policy, decision.role, capsOf(config), decision.agentType);
    const read = readProfile(offer, undefined, config.minConfidence);
    if ("profile" in read) chosen[decision.key] = read.profile;
    else if (Object.keys(offer.profiles).length > 1) asking.push({ decision, offer });
    else chosen[decision.key] = undefined;
  }
  const locale = config.promptLocale ?? config.locale;
  for (let i = 0; i < asking.length; i += 6) {
    const group = asking.slice(i, i + 6);
    const questions: Questions = Object.fromEntries(group.map(({ decision, offer }) => [decision.key, roleQuestion(decision.key, decision.unit, decision.role, offer.profiles, locale)]));
    const asked = await askTimed({
      state: JSON.parse(JSON.stringify({
        prompt_version: ORCHESTRATION_PROMPT_VERSION,
        ...state,
        decisions: Object.fromEntries(group.map(({ decision, offer }) => [decision.key, { role: decision.role, unit: decision.unit, ...(decision.agentType ? { agent_type: decision.agentType } : {}), offered: Object.keys(offer.profiles), source: offer.source }])),
        limits: { ...policy.limits },
      })),
      questions,
      model: config.jevModel,
    }, io.askJev(config, { origin: "unit", trigger: group.map((g) => g.decision.unit).join(",") }));
    for (const { decision, offer } of group) {
      const read = "failure" in asked ? undefined : readProfile(offer, asked.result.answers[decision.key], config.minConfidence);
      // Low confidence or a failed call: no invented choice; the caller holds or stays native.
      chosen[decision.key] = read && "profile" in read ? read.profile : undefined;
    }
  }
  return chosen;
}
