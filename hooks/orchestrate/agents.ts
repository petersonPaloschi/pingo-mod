import type { Effort } from "../core/contracts.ts";
import { truncate } from "../core/state.ts";
import { MODEL_LABEL, type OrchestrationPolicy, type Profile } from "../core/orchestration.ts";
import { text } from "../i18n.ts";
import { digestOf, runReview, type Evidence, type ReviewOutcome, type ReviewRequest } from "../core/review.ts";
import { type Io } from "./types.ts";
import { readPolicy, readObjective, pushNote } from "./state.ts";
import { chooseProfiles } from "./policy.ts";

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

export const spawns = new Map<string, SpawnPlan>();
export const spawnOfAgent = new Map<string, string>();
export const editedBy = new Map<string, Set<string>>();
/** Prompts of units the queue is launching: their spawn is planned already. */
export const managedPrompts = new Map<string, { batch: string; unit: string }>();

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


/** What one finished subagent's review reads: its task, its answer, and the diff of the files it edited. */
async function agentReviewRequest(io: Pick<Io, "run">, x: { agentId: string; type: string; description: string; prompt: string; answer: string; files: readonly string[]; revision: number }): Promise<ReviewRequest> {
  const evidence: Evidence[] = [
    { id: "E_task", kind: "task", label: "Delegated task", body: x.prompt },
    // Without edits the answer is the deliverable; with edits it is the worker's own account.
    { id: "E_answer", kind: x.files.length ? "claim" : "artifact", label: x.files.length ? "Worker summary (a claim, not proof)" : "Worker answer (the deliverable)", body: x.answer || "(empty)" },
    ...(await diffEvidence(io, x.files)),
  ];
  return {
    artifactId: `agent:${x.agentId}`,
    digest: digestOf(x.revision.toString(), x.prompt, x.answer, ...evidence.map((item) => item.body)),
    criteria: [{ id: "C1", text: `The delegated task (${x.description || x.type}) is completed exactly as asked, with no defect in the supplied result.` }],
    evidence,
  };
}

/**
 * The independent review of a subagent Pingo starts itself (Portão's security reviewer, Ensaio), which no Agent call
 * planned: the review a delegated subagent gets, by a reviewer profile chosen under the policy's advisor role. It runs
 * whenever the policy's review is on, orchestration on or off. Undefined when review is off, Jev cannot be asked, or no
 * reviewer profile was chosen: the result then stays unverified.
 */
export async function reviewPingoAgent(io: Io, x: { agentId: string; type: string; description: string; prompt: string; answer: string; files?: readonly string[] }): Promise<ReviewOutcome | undefined> {
  const policy = await readPolicy(io);
  if (!policy.review) return undefined;
  const config = await io.settings();
  if (await io.gate(config)) return undefined;
  const reviewer = (await chooseProfiles(io, config, policy, [{ key: "unit_0_reviewer", unit: x.agentId, role: "advisor" }], {
    task_brief: truncate(x.description, 400, config.locale),
    agent_type: x.type,
  })).unit_0_reviewer;
  if (!reviewer) {
    await io.log("warn", `Pingo review of ${x.type}: no reviewer profile; its result stays unverified.`);
    return undefined;
  }
  const request = await agentReviewRequest(io, { ...x, files: [...(x.files ?? [])].sort(), revision: policy.revision });
  const outcome = await runReview(io.complete, request, reviewer, policy.limits.callTimeoutMs);
  await io.log(outcome.approved ? "good" : "warn", `Pingo review of ${x.type} by ${MODEL_LABEL[reviewer.model]} ${reviewer.effort}: ${outcome.verdict}${outcome.approved ? "" : " (unverified)"}`, outcome.problems.join(", ") || undefined);
  return outcome;
}

/** Start a native subagent's review once, from its turn's end or, failing that, its tool result. */
export function startReview(io: Io, plan: SpawnPlan, answer: string): void {
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
    const request = await agentReviewRequest(io, { agentId, type: plan.type, description: plan.description, prompt: plan.prompt, answer, files, revision: plan.policy.revision });
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
