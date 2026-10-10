// Live orchestration: the policy in the store, the active objective, subagent profiles, mandatory
// reviews and the managed batch queue. register.tsx calls in from its hooks; the decisions
// themselves are the pure modules under core/ (orchestration, objective, review, queue).
import type { Effort } from "./core/contracts.ts";
import type { AskJev } from "./core/request.ts";
import { askTimed } from "./core/request.ts";
import type { Questions } from "./core/types.ts";
import { truncate } from "./core/state.ts";
import { BATCH_INSTRUCTION, ORCHESTRATION_PROMPT_VERSION } from "./core/prompts.ts";
import {
  applyCommand,
  concurrencyQuestion,
  MODEL_LABEL,
  migratePolicy,
  normalizePolicy,
  OBJECTIVE_STORE,
  offeredProfiles,
  ORCHESTRATION_STORE,
  readConcurrency,
  readProfile,
  roleQuestion,
  type Capabilities,
  type OrchestrationPolicy,
  type Profile,
  type Role,
} from "./core/orchestration.ts";
import { decideObjective, restoreObjective, type Objective } from "./core/objective.ts";
import { digestOf, runGuidance, runReview, type Complete, type Evidence, type ReviewOutcome, type ReviewRequest } from "./core/review.ts";
import {
  admit,
  assignProfiles,
  batchVerified,
  cancel,
  createBatch,
  holdUnit,
  integrationDigest,
  integrationDone,
  integrationStarted,
  launched,
  launchFailed,
  reconcile,
  reviewable,
  reviewDone,
  reviewStarted,
  unitOfAgent,
  unitPrompt,
  unitsDone,
  validatePlan,
  workerDone,
  type Batch,
} from "./core/queue.ts";
import type { Settings } from "./config.ts";

export const BATCH_STORE = "orchestration.batches";
const NOTES_STORE = "orchestration.notes";
const KEPT_BATCHES = 5;
const HUMAN = new Set(["composer", "bridge", "sdk"]);

export type Tone = "info" | "good" | "warn" | "bad" | "muted";

/**
 * What register.tsx lends: the engine calls this module needs, as plain functions (only the hooks
 * module may hold `$`), plus its settings, Jev gate and client, live log and run bookkeeping.
 */
export interface Io {
  storeGet: (key: string) => Promise<unknown>;
  storeSet: (key: string, value: unknown) => Promise<unknown>;
  storeDelete: (key: string) => Promise<unknown>;
  now: () => Promise<number>;
  complete: Complete;
  spawn: (args: { prompt: string; description?: string; subagentType?: string; model?: string }) => Promise<{ agentId?: string; model?: string } | { deny: string }>;
  agents: () => Promise<readonly { id: string; status: string; description: string }[]>;
  run: (argv: readonly string[], init?: { timeoutMs?: number }) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
  settings: () => Promise<Settings>;
  /** Why Jev cannot be asked now (routing off, no key), or undefined. */
  gate: (config: Settings) => Promise<string | undefined>;
  askJev: (config: Settings, where: { origin: "prompt" | "unit"; trigger?: string; agentId?: string }) => AskJev;
  log: (tone: Tone, line: string, detail?: string) => Promise<void>;
  /** The effort turn.step should size a subagent's requests with. */
  setAgentEffort: (agentId: string, effort: Effort) => void;
}

/** One writer at a time for the batch and objective records (the store has no compare-and-set). */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.catch(() => undefined);
  return run;
}

// --- Policy and objective records ---

/** The stored policy; created on first read. Older installs start off and keep their own agent choice. */
export async function readPolicy(io: Io): Promise<OrchestrationPolicy> {
  const stored = await io.storeGet(ORCHESTRATION_STORE).catch(() => undefined);
  const policy = migratePolicy(stored);
  if (stored === undefined) await io.storeSet(ORCHESTRATION_STORE, policy).catch(() => undefined);
  return policy;
}

export async function readObjective(io: Io): Promise<Objective | undefined> {
  return restoreObjective(await io.storeGet(OBJECTIVE_STORE).catch(() => undefined), normalizePolicy);
}

const saveObjective = (io: Io, objective: Objective | undefined) =>
  objective ? io.storeSet(OBJECTIVE_STORE, objective) : io.storeDelete(OBJECTIVE_STORE);

/** Catalogue models the user limited Claude to; unknown (all four possible) without that option. */
const capsOf = (config: Settings): Capabilities => (config.catalogue ? { available: config.catalogue } : {});

/** A dashboard or `/jev orchestration` command. `apply` marks the active objective for the next safe boundary. */
export async function runCommand(io: Io, line: string): Promise<{ ok: boolean; message: string }> {
  const words = line.trim().split(/\s+/);
  if (words[0] === "apply") {
    return exclusive(async () => {
      const objective = await readObjective(io);
      if (!objective) return { ok: false, message: "no active objective" };
      await saveObjective(io, { ...objective, applyPending: true });
      return { ok: true, message: "applies at the next request" };
    });
  }
  if (words[0] === "cancel") {
    const id = words[1];
    let found = false;
    await updateBatches(io, (list) => list.map((b) => (!id || b.id === id) && !b.cancelled ? (found = true, cancel(b)) : b));
    return { ok: found, message: found ? "cancelled; running units finish and are still reviewed" : "no batch to cancel" };
  }
  if (words[0] === "end") {
    await exclusive(() => saveObjective(io, undefined));
    return { ok: true, message: "objective ended" };
  }
  const policy = await readPolicy(io);
  const edited = applyCommand(policy, line);
  if (edited.error) return { ok: false, message: edited.error };
  await io.storeSet(ORCHESTRATION_STORE, edited.policy);
  return { ok: true, message: `saved (revision ${edited.policy.revision}); applies to the next objective` };
}

// --- New human input: one Jev request for continuity, work mode and executor ---

export async function onPromptSubmit(io: Io, e: { text: string; attachments?: readonly unknown[]; origin: { kind: string }; turnId?: string }): Promise<string[]> {
  if (e.turnId || !HUMAN.has(e.origin.kind)) return [];
  const policy = await readPolicy(io);
  const notes = await takeNotes(io);
  if (!policy.enabled) return notes;
    const config = await io.settings();
  const closed = await io.gate(config);
  if (closed) {
    await io.log("muted", `Orchestration: AUTO did not apply (${closed}); the request stays native.`);
    return notes;
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
    if (objective) {
      const executor = objective.executor ? `${MODEL_LABEL[objective.executor.model]} ${objective.executor.effort}` : `native (${objective.executorWhy ?? "unset"})`;
      await io.log(decision.held.length ? "warn" : "good", `Orchestration: ${decision.continuity} objective ${objective.id} · ${objective.workMode}${objective.workModeConfident ? "" : " (default)"} · executor ${executor}`, decision.held.length ? `held: ${decision.held.join(", ")}` : undefined);
      if (decision.guidance !== "none" && objective.adviceUsed < objective.policy.limits.adviceCalls) {
        const advice = await guidance(io, config, objective, e.text, decision.guidance);
        if (advice) {
          objective = { ...objective, adviceUsed: objective.adviceUsed + 1 };
          lines.push(`Pingo advisor guidance (${decision.guidance}; optional, not approval):\n${advice}`);
        }
      }
      lines.unshift(objectiveNote(objective));
    }
    await saveObjective(io, objective);
    return lines;
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
    return undefined;
  }
  const result = await runGuidance(io.complete, {
    goal: truncate(goal, 8000, config.locale),
    constraints: [`Executor: ${objective.executor ? `${objective.executor.model} ${objective.executor.effort}` : "native"}`, `Work mode: ${objective.workMode}`],
    evidence: "",
    purpose,
  }, advisor, Math.min(objective.policy.limits.callTimeoutMs, 60_000));
  await io.log(result.text ? "good" : "warn", result.text ? `Orchestration: ${MODEL_LABEL[advisor.model]} ${advisor.effort} gave ${purpose} guidance` : `Orchestration: guidance failed (${result.problem})`);
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

async function chooseProfiles(io: Io, config: Settings, policy: OrchestrationPolicy, decisions: readonly Decision[], state: Record<string, unknown> = {}): Promise<Record<string, Profile | undefined>> {
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

// --- Native subagents: profile at spawn, review at completion ---

interface SpawnPlan {
  toolUseId: string;
  type: string;
  description: string;
  prompt: string;
  worker?: Profile;
  reviewer?: Profile;
  policy: OrchestrationPolicy;
  agentId?: string;
  review?: Promise<ReviewOutcome | undefined>;
  background: boolean;
}

const spawns = new Map<string, SpawnPlan>();
const spawnOfAgent = new Map<string, string>();
const editedBy = new Map<string, Set<string>>();
/** Prompts of units the queue is launching: their spawn is planned already. */
const managedPrompts = new Map<string, { batch: string; unit: string }>();

/**
 * Plan a subagent the model asked for. Returns the rewrite, or undefined when orchestration does not
 * apply (off, gate closed, a fork or a workflow agent) and the older planner may run.
 */
export async function planSpawn(io: Io, e: { tool_use_id: string; prompt: string; description: string; subagentType: string; model?: string; fork?: boolean; workflow?: unknown; background?: boolean; parentAgentId?: string; isTeammate?: true }): Promise<{ model?: string; effort?: Effort; managed: true } | undefined> {
  // Forks inherit, workflows are pinned, and a teammate's loop outlives one turn: none is a reviewable unit.
  if (e.fork || e.workflow || e.isTeammate) return undefined;
  const managed = managedPrompts.get(e.prompt);
  if (managed) return { managed: true };
  const policy = await readPolicy(io);
  if (!policy.enabled) return undefined;
  const config = await io.settings();
  if (await io.gate(config)) return undefined;
  const objective = await readObjective(io);
  const active = objective?.policy ?? policy;
  const chosen = await chooseProfiles(io, config, active, [
    { key: "unit_0_executor", unit: e.tool_use_id, role: "subagent", agentType: e.subagentType },
    ...(active.review ? [{ key: "unit_0_reviewer", unit: e.tool_use_id, role: "advisor" as const }] : []),
  ], {
    task_brief: truncate(e.description, 400, config.locale),
    task: truncate(e.prompt, config.maxMessageChars, config.locale),
    agent_type: e.subagentType,
    ...(e.model ? { proposed_model: e.model } : {}),
    ...(objective ? { objective: { id: objective.id, work_mode: objective.workMode } } : {}),
  });
  const worker = chosen.unit_0_executor;
  const reviewer = chosen.unit_0_reviewer;
  spawns.set(e.tool_use_id, {
    toolUseId: e.tool_use_id, type: e.subagentType, description: e.description, prompt: e.prompt,
    ...(worker ? { worker } : {}), ...(reviewer ? { reviewer } : {}), policy: active, background: e.background === true,
  });
  if (!worker) await io.log("warn", `Orchestration: no confident subagent profile for ${e.subagentType}; it runs with its native model, unmanaged.`);
  if (active.review && !reviewer) await io.log("warn", `Orchestration: no reviewer profile for ${e.subagentType}; its result will stay unverified.`);
  return { ...(worker ? { model: worker.model, effort: worker.effort } : {}), managed: true };
}

/** The spawn started (or was refused): tie the runtime agent ID to its plan. */
export function spawned(toolUseId: string, agentId: string | undefined): void {
  const plan = spawns.get(toolUseId);
  if (!plan) return;
  if (!agentId) { spawns.delete(toolUseId); return; }
  plan.agentId = agentId;
  spawnOfAgent.set(agentId, toolUseId);
}

/** A file an agent edited, recorded by the runner (not the agent's claim). */
export function noteEdit(agentId: string | undefined, file: string): void {
  if (!agentId) return;
  const set = editedBy.get(agentId) ?? new Set<string>();
  set.add(file);
  editedBy.set(agentId, set);
}

/**
 * Runner-recorded diffs of the files an agent touched. Only a complete, non-empty diff can support a
 * pass: names alone, an empty diff (edits made elsewhere: a worktree, a commit) or a cut one count
 * as claims, so the review cannot approve on them.
 */
export async function diffEvidence(io: Pick<Io, "run">, files: readonly string[], budget = 60_000): Promise<Evidence[]> {
  if (!files.length) return [];
  const evidence: Evidence[] = [{ id: "E_files", kind: "claim", label: "Runner-recorded edited file names (not their content)", body: files.join("\n") }];
  const tracked = await io.run(["git", "diff", "--no-color", "--", ...files], { timeoutMs: 20_000 }).catch(() => undefined);
  const untracked = await io.run(["git", "ls-files", "--others", "--exclude-standard", "--", ...files], { timeoutMs: 20_000 }).catch(() => undefined);
  if (!tracked && !untracked) return [...evidence, { id: "E_diff", kind: "claim", label: "Diff unavailable (git could not run)", body: "(none)" }];
  let body = tracked?.stdout ?? "";
  for (const file of (untracked?.stdout ?? "").split(/\r?\n/).filter(Boolean)) {
    const added = await io.run(["git", "diff", "--no-color", "--no-index", "--", "/dev/null", file], { timeoutMs: 20_000 }).catch(() => undefined);
    body += added?.stdout ?? "";
  }
  if (!body.trim()) return [...evidence, { id: "E_diff", kind: "claim", label: "No diff found in this checkout for the edited files (coverage incomplete)", body: "(empty)" }];
  if (body.length > budget) return [...evidence, { id: "E_diff", kind: "claim", label: "Runner-recorded diff, TRUNCATED (coverage incomplete)", body: body.slice(0, budget) }];
  return [...evidence, { id: "E_diff", kind: "diff", label: "Runner-recorded diff", body }];
}

/** A subagent's turn ended: start its mandatory review, or advance its batch unit. */
export async function onAgentDone(io: Io, agentId: string, answer: string, ok: boolean): Promise<void> {
  if (await advanceBatchUnit(io, agentId, answer, ok)) return;
  const toolUseId = spawnOfAgent.get(agentId);
  const plan = toolUseId ? spawns.get(toolUseId) : undefined;
  if (plan) startReview(io, plan, answer);
}

/** Start a native subagent's review once, from its turn's end or, failing that, its tool result. */
function startReview(io: Io, plan: SpawnPlan, answer: string): void {
  if (plan.review || !plan.policy.review) return;
  const agentId = plan.agentId ?? plan.toolUseId;
  spawnOfAgent.delete(agentId);
  plan.review = (async () => {
        if (!plan.reviewer) {
      if (plan.background) { await pushNote(io, reviewNote(plan, undefined)); spawns.delete(plan.toolUseId); }
      return undefined;
    }
    const files = [...(editedBy.get(agentId) ?? [])].sort();
    editedBy.delete(agentId);
    const evidence: Evidence[] = [
      { id: "E_task", kind: "task", label: "Delegated task", body: plan.prompt },
      // Without edits the answer is the deliverable; with edits it is the worker's own account.
      { id: "E_answer", kind: files.length ? "claim" : "artifact", label: files.length ? "Worker summary (a claim, not proof)" : "Worker answer (the deliverable)", body: answer || "(empty)" },
      ...(await diffEvidence(io, files)),
    ];
    const request: ReviewRequest = {
      artifactId: `agent:${agentId}`,
      digest: digestOf(plan.policy.revision.toString(), plan.prompt, answer, ...evidence.map((item) => item.body)),
      criteria: [{ id: "C1", text: `The delegated task (${plan.description || plan.type}) is completed exactly as asked, with no defect in the supplied result.` }],
      evidence,
    };
    const outcome = await runReview(io.complete, request, plan.reviewer, plan.policy.limits.callTimeoutMs);
    await io.log(outcome.approved ? "good" : "warn", `Orchestration: review of ${plan.type} by ${MODEL_LABEL[plan.reviewer.model]} ${plan.reviewer.effort}: ${outcome.verdict}${outcome.approved ? "" : " (unverified)"}`, outcome.problems.join(", ") || undefined);
    if (plan.background) { await pushNote(io, reviewNote(plan, outcome)); spawns.delete(plan.toolUseId); }
    return outcome;
  })().catch(() => undefined);
}

function reviewNote(plan: SpawnPlan, outcome: ReviewOutcome | undefined): string {
  if (!outcome) return `Pingo review of subagent "${plan.description}": none ran (no reviewer profile); its result is UNVERIFIED.`;
  const findings = outcome.reply?.findings.map((f) => `- ${f.severity}: ${f.reference}: ${f.correction}`) ?? [];
  const missing = outcome.reply?.missing_evidence.map((m) => `- missing: ${m}`) ?? [];
  return [
    `Pingo independent review of subagent "${plan.description}": ${outcome.approved ? "APPROVED" : `${outcome.verdict.toUpperCase()} — result is UNVERIFIED`}.`,
    outcome.problems.length ? `Validation: ${outcome.problems.join(", ")}` : "",
    ...findings,
    ...missing,
  ].filter(Boolean).join("\n");
}

/** After the Agent tool returned: the review verdict for the parent, or undefined when none applies. */
export async function agentToolNote(io: Io, toolUseId: string, answer: string): Promise<string | undefined> {
  const plan = spawns.get(toolUseId);
  if (!plan || plan.background) return undefined;
  spawns.delete(toolUseId);
  if (!plan.policy.review) return undefined;
  startReview(io, plan, answer);
  return reviewNote(plan, await plan.review);
}

async function pushNote(io: Io, note: string): Promise<void> {
  await exclusive(async () => {
    const list = ((await io.storeGet(NOTES_STORE).catch(() => undefined)) as string[] | undefined) ?? [];
    await io.storeSet(NOTES_STORE, [...list, note].slice(-10));
  });
}

async function takeNotes(io: Io): Promise<string[]> {
  const list = ((await io.storeGet(NOTES_STORE).catch(() => undefined)) as string[] | undefined) ?? [];
  if (list.length) await io.storeDelete(NOTES_STORE).catch(() => undefined);
  return list;
}

// --- /batch: the planning phase hands units to the managed queue ---

/** The native batch skill's prompt, with Pingo's managed-execution instruction when the queue applies. */
export async function batchSkillPrompt(io: Io, text: string): Promise<string> {
  const policy = await readPolicy(io);
  if (!policy.enabled || policy.batch === "off") return text;
  return `${text}\n\n${BATCH_INSTRUCTION}`;
}

export async function readBatches(io: Io): Promise<Batch[]> {
  const value = await io.storeGet(BATCH_STORE).catch(() => undefined);
  return Array.isArray(value) ? value as Batch[] : [];
}

async function updateBatches(io: Io, change: (list: Batch[]) => Batch[]): Promise<Batch[]> {
  return exclusive(async () => {
    const next = change(await readBatches(io)).slice(-KEPT_BATCHES);
    await io.storeSet(BATCH_STORE, next);
    return next;
  });
}

const batchOf = async (io: Io, id: string) => (await readBatches(io)).find((b) => b.id === id);

/**
 * One step applied to the batch as stored now, under the store lock: a step worked out from an earlier read (a
 * launch, a worker's end, a review) never overwrites what another step wrote meanwhile. `change` answers undefined
 * to leave the batch as it is; the changed batch comes back, else undefined.
 */
async function changeBatch(io: Io, id: string, change: (batch: Batch) => Batch | undefined): Promise<Batch | undefined> {
  let changed: Batch | undefined;
  await updateBatches(io, (list) => list.map((b) => (b.id === id ? (changed = change(b)) ?? b : b)));
  return changed;
}

/** The managed-batch entry point (`mcp__jev__managed_batch`): validate, choose profiles, start the queue. */
export async function submitBatch(io: Io, input: unknown): Promise<{ result?: string; deny?: string }> {
  const policy = await readPolicy(io);
  if (!policy.enabled) return { deny: "Pingo orchestration is off; the managed batch cannot start. Ordinary native fan-out does not provide its review guarantees." };
  if (policy.batch === "off") return { deny: "The managed batch is off in the Jev dashboard; it cannot start." };
  const config = await io.settings();
  const closed = await io.gate(config);
  if (closed) return { deny: `Jev cannot be asked (${closed}); the managed batch cannot start.` };
  const objective = await readObjective(io);
  const active = objective?.policy ?? policy;
  const checked = validatePlan(input, active.limits);
  if (!checked.units) return { deny: `The unit plan was refused: ${checked.errors.join("; ")}` };
  const now = await io.now();
  let batch = createBatch(`B${now.toString(36)}`, checked.units, checked.sharedContracts, active.limits, now, active.revision, objective?.id);
  const decisions = batch.units.flatMap((u, i) => [
    { key: `unit_${i}_executor`, unit: u.id, role: "subagent" as const },
    { key: `unit_${i}_reviewer`, unit: u.id, role: "advisor" as const },
  ]);
  const chosen = await chooseProfiles(io, config, active, [...decisions, { key: "integration_reviewer", unit: "integration", role: "advisor" }], {
    shared_contracts: truncate(checked.sharedContracts, 2000, config.locale),
    units: batch.units.map((u) => ({ id: u.id, description: u.description, dependencies: u.dependencies, areas: u.areas, criteria: u.criteria.length })),
  });
  batch.units.forEach((u, i) => {
    const worker = chosen[`unit_${i}_executor`];
    const reviewer = chosen[`unit_${i}_reviewer`];
    batch = worker && reviewer ? assignProfiles(batch, u.id, worker, reviewer) : holdUnit(batch, u.id, worker ? "no_reviewer_profile" : "no_worker_profile");
  });
  const integrator = chosen.integration_reviewer;
  if (integrator) batch = { ...batch, integrator };
  batch = { ...batch, workers: await desiredWorkers(io, config, active, batch) };
  await updateBatches(io, (list) => [...list, batch]);
  await io.log("info", `Orchestration: batch ${batch.id} accepted, ${batch.units.length} units, up to ${batch.workers} at once`);
  await pump(io, batch.id);
  return { result: `${batchText(await batchOf(io, batch.id) ?? batch)}\nThe Pingo queue launches, reviews and repairs units itself; check progress with mcp__jev__managed_batch_status. Do not launch these units yourself.` };
}

async function desiredWorkers(io: Io, config: Settings, policy: OrchestrationPolicy, batch: Batch): Promise<number> {
  const ready = batch.units.filter((u) => u.state === "queued" && !u.dependencies.length && u.worker).length;
  const ceiling = Math.max(1, Math.min(policy.limits.workers, policy.limits.activeCalls - 1, ready));
  if (ceiling <= 1) return 1;
  const asked = await askTimed({
    state: { prompt_version: ORCHESTRATION_PROMPT_VERSION, ready_units: ready, units: batch.units.length, limits: { ...policy.limits }, review_reservations: batch.units.length + 1 },
    questions: { concurrency: concurrencyQuestion(ceiling, config.promptLocale ?? config.locale) },
    model: config.jevModel,
  }, io.askJev(config, { origin: "unit", trigger: "concurrency" }));
  return "failure" in asked ? 1 : readConcurrency(asked.result.answers.concurrency, ceiling, config.minConfidence).workers;
}

/** The pump running now: one at a time, or two would admit the same queued unit and launch it twice. */
let pumping: Promise<unknown> = Promise.resolve();

/** Launch whatever the queue admits and start owed reviews. Safe to call any time. */
function pump(io: Io, batchId: string): Promise<void> {
  const run = pumping.then(() => pumpOnce(io, batchId));
  pumping = run.catch(() => undefined);
  return run;
}

async function pumpOnce(io: Io, batchId: string): Promise<void> {
  let batch = await batchOf(io, batchId);
  if (!batch) return;
  // Agents the runtime runs outside this batch share the same live-agent ceiling.
  const live = (await io.agents().catch(() => []))
    .filter((a) => (a.status === "running" || a.status === "pending") && !batch!.units.some((u) => u.agentId === a.id)).length;
  for (const unit of admit(batch, live)) {
    const prompt = unitPrompt(batch, unit);
    managedPrompts.set(prompt, { batch: batch.id, unit: unit.id });
    let step: (b: Batch) => Batch;
    try {
      const description = `${batch.id} ${unit.id}`;
      const started = await io.spawn({ prompt, description, subagentType: "general-purpose", model: unit.worker!.model });
      if ("deny" in started && typeof started.deny === "string") step = (b) => launchFailed(b, unit.id, `spawn_denied: ${started.deny}`);
      else {
        // Core answers the started agent's ID; failing that, the runtime's agent list names it by its unique description.
        const taken = new Set(batch.units.map((u) => u.agentId).filter(Boolean));
        const agentId = (started as { agentId?: string }).agentId
          ?? (await io.agents().catch(() => [])).find((a) => a.description === description && !taken.has(a.id))?.id;
        if (!agentId) step = (b) => launchFailed(b, unit.id, "spawn_without_agent_id");
        else {
          step = (b) => launched(b, unit.id, agentId);
          io.setAgentEffort(agentId, unit.worker!.effort);
        }
      }
    } catch (error) {
      step = (b) => launchFailed(b, unit.id, `spawn_failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      managedPrompts.delete(prompt);
    }
    batch = (await changeBatch(io, batch.id, step)) ?? batch;
  }
  // Owed reviews from the batch as stored now: a review or a worker may have finished during the launches.
  batch = (await batchOf(io, batchId)) ?? batch;
  for (const unit of reviewable(batch)) void reviewUnit(io, batch.id, unit.id);
  if (unitsDone(batch) && batch.integration.state === "pending") void reviewIntegration(io, batch.id);
}

async function advanceBatchUnit(io: Io, agentId: string, answer: string, ok: boolean): Promise<boolean> {
  const batch = (await readBatches(io)).find((b) => unitOfAgent(b, agentId));
  if (!batch) return false;
  const unit = unitOfAgent(batch, agentId)!;
  const files = [...(editedBy.get(agentId) ?? [])].sort();
  editedBy.delete(agentId);
  await changeBatch(io, batch.id, (b) => workerDone(b, unit.id, answer, files, ok));
  await io.log(ok ? "info" : "bad", `Orchestration: ${batch.id} ${unit.id} worker ${ok ? "finished; review owed" : "failed"}`);
  await pump(io, batch.id);
  return true;
}

async function reviewUnit(io: Io, batchId: string, unitId: string): Promise<void> {
  // Claimed under the lock, within the free review slots: two pumps never start the same review.
  const batch = await changeBatch(io, batchId, (b) => {
    const owed = reviewable(b).find((u) => u.id === unitId);
    return owed?.reviewer && owed.digest ? reviewStarted(b, unitId) : undefined;
  });
  const unit = batch?.units.find((u) => u.id === unitId);
  if (!batch || !unit?.reviewer || !unit.digest) return;
  const evidence: Evidence[] = [
    { id: "E_task", kind: "task", label: "Unit task", body: unitPrompt(batch, unit) },
    { id: "E_answer", kind: unit.files?.length ? "claim" : "artifact", label: unit.files?.length ? "Worker summary (a claim, not proof)" : "Worker answer (the deliverable)", body: unit.answer || "(empty)" },
    ...(await diffEvidence(io, unit.files ?? [])),
  ];
  const digest = unit.digest;
  const outcome = await runReview(io.complete, {
    artifactId: `${batchId}:${unitId}`, digest, criteria: unit.criteria, evidence,
    baseline: batch.sharedContracts || undefined,
  }, unit.reviewer, batch.limits.callTimeoutMs);
  const next = await changeBatch(io, batchId, (b) => reviewDone(b, unitId, outcome, digest));
  if (!next) return;
  const state = next.units.find((u) => u.id === unitId)?.state;
  await io.log(outcome.approved ? "good" : "warn", `Orchestration: ${batchId} ${unitId} review ${outcome.verdict} → ${state}`, outcome.problems.join(", ") || undefined);
  await pump(io, batchId);
}

async function reviewIntegration(io: Io, batchId: string): Promise<void> {
  // Claimed under the lock: two pumps never start the integration review twice.
  let claimed: string | undefined;
  const batch = await changeBatch(io, batchId, (b) => {
    if (b.integration.state !== "pending") return undefined;
    claimed = integrationDigest(b);
    if (!claimed) return { ...b, integration: { state: "blocked", why: "units_not_all_approved" } };
    if (!b.integrator) return { ...b, integration: { state: "blocked", why: "no_integration_reviewer" } };
    return integrationStarted(b, claimed);
  });
  if (!batch) return;
  const digest = claimed;
  if (!digest) {
    await io.log("warn", `Orchestration: ${batchId} is UNVERIFIED — not every unit was approved`);
    return;
  }
  const integrator = batch.integrator;
  if (!integrator) return;
  const files = [...new Set(batch.units.flatMap((u) => u.files ?? []))].sort();
  const evidence: Evidence[] = [
    // A unit that edited nothing delivered its answer; one that edited files only describes them (the diff is the evidence).
    ...batch.units.map((u): Evidence => ({ id: `E_${u.id}`, kind: u.files?.length ? "claim" : "artifact", label: u.files?.length ? `Approved unit ${u.id} summary (a claim)` : `Approved unit ${u.id} answer (the deliverable)`, body: u.answer ?? "" })),
    ...(await diffEvidence(io, files)),
  ];
  const outcome = await runReview(io.complete, {
    artifactId: `${batchId}:integration`, digest,
    criteria: [
      { id: "I1", text: "The approved units integrate without conflicting changes, broken shared contracts or ordering violations." },
      ...batch.units.flatMap((u) => u.criteria.map((c) => ({ id: `${u.id}/${c.id}`, text: c.text }))),
    ],
    evidence,
    baseline: batch.sharedContracts || undefined,
  }, integrator, batch.limits.callTimeoutMs);
  const next = await changeBatch(io, batchId, (b) => integrationDone(b, outcome, digest));
  if (!next) return;
  await io.log(batchVerified(next) ? "good" : "warn", `Orchestration: ${batchId} integration ${next.integration.state}${batchVerified(next) ? " — verified" : " — UNVERIFIED"}`);
}

export function batchText(batch: Batch): string {
  const lines = batch.units.map((u) => `- ${u.id} ${u.state}${u.worker ? ` [${MODEL_LABEL[u.worker.model]} ${u.worker.effort}]` : ""}${u.why ? ` (${u.why})` : ""}${u.findings?.length ? `\n  findings: ${u.findings.join("; ")}` : ""}`);
  return [
    `Batch ${batch.id}: ${batch.units.filter((u) => u.state === "approved").length}/${batch.units.length} approved; integration ${batch.integration.state}${batch.integration.why ? ` (${batch.integration.why})` : ""}; ${batchVerified(batch) ? "VERIFIED" : "not verified"}${batch.cancelled ? "; cancelled" : ""}.`,
    ...lines,
  ].join("\n");
}

export async function batchStatus(io: Io, input: { batch?: unknown }): Promise<string> {
  const list = await readBatches(io);
  const wanted = typeof input.batch === "string" ? list.filter((b) => b.id === input.batch) : list.slice(-1);
  return wanted.length ? wanted.map(batchText).join("\n\n") : "No managed batch.";
}

/** Session start: restored queues are reconciled against live agents, so nothing launches twice. */
export async function restore(io: Io): Promise<void> {
  const list = await readBatches(io);
  if (!list.length) return;
  const live = new Set((await io.agents().catch(() => [])).filter((a) => a.status === "running" || a.status === "pending").map((a) => a.id));
  await updateBatches(io, (batches) => batches.map((b) => reconcile(b, live)));
}
