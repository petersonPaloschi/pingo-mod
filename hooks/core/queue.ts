// The managed batch queue as a pure state machine: plan validation, admission within worker,
// reviewer and total-call slots, review reservations, repairs, and the final integration review.
// register.tsx launches what `admit` returns and feeds completions back in; nothing here spawns.
import type { Limits, Profile } from "./orchestration.ts";
import type { Criterion, ReviewOutcome } from "./review.ts";
import { digestOf } from "./review.ts";

export type UnitState =
  | "queued" | "running" | "checking" | "awaiting_review" | "reviewing"
  | "needs_changes" | "approved" | "blocked" | "failed" | "cancelled";

export const TERMINAL: readonly UnitState[] = ["approved", "blocked", "failed", "cancelled"];

export interface UnitPlan {
  id: string;
  description: string;
  prompt: string;
  dependencies: string[];
  areas: string[];
  criteria: Criterion[];
  verification: string[];
}

export interface Unit extends UnitPlan {
  state: UnitState;
  worker?: Profile;
  reviewer?: Profile;
  /** Why the unit cannot proceed (a held profile, a lost agent, an exhausted allowance). */
  why?: string;
  /** The runtime agent of the current attempt; completion is matched on it. */
  agentId?: string;
  launches: number;
  reviews: number;
  repairs: number;
  answer?: string;
  files?: string[];
  digest?: string;
  /** Blocking findings to fix in the next repair. */
  findings?: string[];
  verdict?: ReviewOutcome["verdict"];
  approvedDigest?: string;
}

export interface Integration {
  state: "pending" | "reviewing" | "approved" | "needs_changes" | "blocked";
  digest?: string;
  findings?: string[];
  why?: string;
}

export interface Batch {
  id: string;
  createdAt: number;
  objectiveId?: string;
  policyRevision: number;
  limits: Limits;
  /** Desired simultaneous workers (Jev's or fixed), never above the limit. */
  workers: number;
  sharedContracts: string;
  units: Unit[];
  integration: Integration;
  integrator?: Profile;
  cancelled?: boolean;
}

const SAFE_ID = /^[A-Za-z0-9_.-]{1,40}$/;

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown, max: number, each: number) => (Array.isArray(value) ? value.map((v) => clean(v, each)).filter(Boolean).slice(0, max) : []);

/** Parse and check a proposed unit plan. Errors name every problem; no partial plan is accepted. */
export function validatePlan(input: unknown, limits: Limits): { units?: UnitPlan[]; sharedContracts: string; errors: string[] } {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const sharedContracts = clean(raw.shared_contracts, 8000);
  if (!Array.isArray(raw.units) || raw.units.length === 0) return { sharedContracts, errors: ["units_missing"] };
  if (raw.units.length > limits.units) errors.push(`too_many_units:${raw.units.length}>${limits.units}`);
  const units: UnitPlan[] = raw.units.slice(0, limits.units).map((entry, i) => {
    const u = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const id = clean(u.id, 40) || `U${String(i + 1).padStart(2, "0")}`;
    const criteria = Array.isArray(u.acceptance_criteria) ? u.acceptance_criteria.map((c, j) => {
      const item = (c && typeof c === "object" ? c : { text: c }) as Record<string, unknown>;
      return { id: clean(item.id, 40) || `${id}-C${j + 1}`, text: clean(item.text ?? item.description, 1000) };
    }).filter((c) => c.text) : [];
    return {
      id,
      description: clean(u.description, 400),
      prompt: clean(u.prompt ?? u.instructions ?? u.description, 20_000),
      dependencies: list(u.dependencies, 30, 40),
      areas: list(u.affected_areas ?? u.areas, 40, 300),
      criteria,
      verification: list(u.verification ?? u.verification_commands, 20, 500),
    };
  });
  const ids = new Set<string>();
  for (const unit of units) {
    if (!SAFE_ID.test(unit.id)) errors.push(`unsafe_id:${unit.id}`);
    if (ids.has(unit.id)) errors.push(`duplicate_id:${unit.id}`);
    ids.add(unit.id);
    if (!unit.prompt) errors.push(`empty_prompt:${unit.id}`);
    if (!unit.criteria.length) errors.push(`no_criteria:${unit.id}`);
    const criterionIds = new Set<string>();
    for (const c of unit.criteria) {
      if (criterionIds.has(c.id)) errors.push(`duplicate_criterion:${unit.id}/${c.id}`);
      criterionIds.add(c.id);
    }
  }
  for (const unit of units) for (const dep of unit.dependencies) if (!ids.has(dep) || dep === unit.id) errors.push(`bad_dependency:${unit.id}->${dep}`);
  if (!errors.length && hasCycle(units)) errors.push("dependency_cycle");
  return errors.length ? { sharedContracts, errors } : { units, sharedContracts, errors };
}

function hasCycle(units: readonly UnitPlan[]): boolean {
  const deps = new Map(units.map((u) => [u.id, u.dependencies]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    for (const dep of deps.get(id) ?? []) if (visit(dep)) return true;
    state.set(id, 2);
    return false;
  };
  return units.some((u) => visit(u.id));
}

export function createBatch(id: string, plan: UnitPlan[], sharedContracts: string, limits: Limits, at: number, policyRevision: number, objectiveId?: string): Batch {
  return {
    id,
    createdAt: at,
    ...(objectiveId ? { objectiveId } : {}),
    policyRevision,
    limits: { ...limits },
    workers: 1,
    sharedContracts,
    units: plan.map((unit) => ({ ...unit, state: "queued", launches: 0, reviews: 0, repairs: 0 })),
    integration: { state: "pending" },
  };
}

const running = (b: Batch) => b.units.filter((u) => u.state === "running" || u.state === "checking").length;
const reviewing = (b: Batch) => b.units.filter((u) => u.state === "reviewing").length + (b.integration.state === "reviewing" ? 1 : 0);

/** Units ready to run: queued, every dependency approved, a worker profile chosen. */
export function readyUnits(batch: Batch): Unit[] {
  const approved = new Set(batch.units.filter((u) => u.state === "approved").map((u) => u.id));
  return batch.units.filter((u) => u.state === "queued" && u.worker && u.dependencies.every((d) => approved.has(d)));
}

/**
 * Units to launch now. Reviews share the total-call ceiling, and a unit is admitted only while one
 * review stays reserved for it; `liveAgents` counts agents the runtime already runs elsewhere.
 */
export function admit(batch: Batch, liveAgents = 0): Unit[] {
  if (batch.cancelled) return [];
  const { limits } = batch;
  const workers = Math.min(batch.workers, limits.workers) - running(batch);
  // Reviews owed to units already past their worker hold a reservation of the shared slots.
  const owed = batch.units.filter((u) => u.state === "awaiting_review").length;
  const calls = limits.activeCalls - running(batch) - reviewing(batch) - Math.min(owed, limits.reviewers) - liveAgents;
  const slots = Math.max(0, Math.min(workers, calls));
  return readyUnits(batch).slice(0, slots);
}

/** Units whose review can start now, within the reviewer and total-call limits. */
export function reviewable(batch: Batch): Unit[] {
  const slots = Math.min(batch.limits.reviewers - reviewing(batch), batch.limits.activeCalls - running(batch) - reviewing(batch));
  return batch.units.filter((u) => u.state === "awaiting_review").slice(0, Math.max(0, slots));
}

const updateUnit = (batch: Batch, id: string, change: (unit: Unit) => Unit): Batch =>
  ({ ...batch, units: batch.units.map((u) => (u.id === id ? change(u) : u)) });

export function launched(batch: Batch, id: string, agentId: string): Batch {
  return updateUnit(batch, id, (u) => ({ ...u, state: "running", agentId, launches: u.launches + 1, why: undefined }));
}

export function launchFailed(batch: Batch, id: string, why: string): Batch {
  return updateUnit(batch, id, (u) => ({ ...u, state: "failed", why }));
}

export const unitOfAgent = (batch: Batch, agentId: string) => batch.units.find((u) => u.agentId === agentId && (u.state === "running" || u.state === "checking"));

/** A worker finished: its answer and touched files become the artifact a review binds to. */
export function workerDone(batch: Batch, id: string, answer: string, files: readonly string[], ok: boolean): Batch {
  return updateUnit(batch, id, (u) => {
    if (!ok) return { ...u, state: "failed", why: "worker_failed", answer };
    const digest = digestOf(batch.policyRevision.toString(), u.id, u.prompt, ...u.criteria.map((c) => c.id + c.text), answer, ...[...files].sort());
    // A repair changed the artifact: an earlier approval no longer applies.
    return { ...u, state: "awaiting_review", answer, files: [...files], digest, approvedDigest: undefined };
  });
}

export function reviewStarted(batch: Batch, id: string): Batch {
  return updateUnit(batch, id, (u) => ({ ...u, state: "reviewing", reviews: u.reviews + 1 }));
}

/**
 * A review came back. Approval binds to the reviewed digest; needs_changes goes back for repair
 * while repairs and review passes remain; everything else, or an exhausted allowance, blocks.
 */
export function reviewDone(batch: Batch, id: string, outcome: Pick<ReviewOutcome, "verdict" | "approved" | "problems" | "reply">, reviewedDigest: string): Batch {
  return updateUnit(batch, id, (u) => {
    if (u.digest !== reviewedDigest) return { ...u, state: "awaiting_review", why: "stale_review" };
    const findings = outcome.reply?.findings.filter((f) => f.severity === "blocking").map((f) => `${f.reference}: ${f.correction}`) ?? [];
    if (outcome.approved) return { ...u, state: "approved", verdict: "approved", approvedDigest: reviewedDigest, findings: [], why: undefined };
    const canRepair = u.repairs < batch.limits.repairRounds && u.reviews < batch.limits.reviewPasses;
    if (outcome.verdict === "needs_changes" && canRepair) {
      return { ...u, state: "queued", verdict: "needs_changes", repairs: u.repairs + 1, findings, agentId: undefined };
    }
    const why = outcome.verdict === "needs_changes" ? "repair_allowance_exhausted" : outcome.problems.join(",") || "review_blocked";
    return { ...u, state: "blocked", verdict: outcome.verdict, findings, why };
  });
}

export function holdUnit(batch: Batch, id: string, why: string): Batch {
  return updateUnit(batch, id, (u) => ({ ...u, state: "blocked", why }));
}

export function assignProfiles(batch: Batch, id: string, worker: Profile, reviewer: Profile): Batch {
  return updateUnit(batch, id, (u) => ({ ...u, worker, reviewer }));
}

/** Stop new launches; queued work is cancelled, running work finishes and is still reviewed. */
export function cancel(batch: Batch): Batch {
  return { ...batch, cancelled: true, units: batch.units.map((u) => (u.state === "queued" ? { ...u, state: "cancelled" as const } : u)) };
}

/** After a restart: a unit whose agent is no longer live is blocked, never relaunched twice. */
export function reconcile(batch: Batch, liveAgentIds: ReadonlySet<string>): Batch {
  return {
    ...batch,
    units: batch.units.map((u) => {
      if ((u.state === "running" || u.state === "checking") && (!u.agentId || !liveAgentIds.has(u.agentId))) return { ...u, state: "blocked", why: "lost_on_restart" };
      // A review in flight died with the session: it is owed again.
      if (u.state === "reviewing") return { ...u, state: "awaiting_review" };
      return u;
    }),
    integration: batch.integration.state === "reviewing" ? { state: "pending" } : batch.integration,
  };
}

export const unitsDone = (batch: Batch) => batch.units.every((u) => TERMINAL.includes(u.state));

/** What integration reviews: every unit approved, bound to the exact approved digests. */
export function integrationDigest(batch: Batch): string | undefined {
  if (!unitsDone(batch) || batch.units.some((u) => u.state !== "approved" || u.approvedDigest !== u.digest)) return undefined;
  return digestOf(batch.id, batch.policyRevision.toString(), batch.sharedContracts, ...batch.units.map((u) => `${u.id}:${u.approvedDigest}`));
}

export function integrationStarted(batch: Batch, digest: string): Batch {
  return { ...batch, integration: { state: "reviewing", digest } };
}

export function integrationDone(batch: Batch, outcome: Pick<ReviewOutcome, "verdict" | "approved" | "problems" | "reply">, digest: string): Batch {
  if (batch.integration.digest !== digest || integrationDigest(batch) !== digest) return { ...batch, integration: { state: "pending", why: "stale_review" } };
  const findings = outcome.reply?.findings.map((f) => `${f.severity}: ${f.reference}: ${f.correction}`) ?? [];
  return {
    ...batch,
    integration: outcome.approved
      ? { state: "approved", digest }
      : { state: outcome.verdict === "needs_changes" ? "needs_changes" : "blocked", digest, findings, why: outcome.problems.join(",") || undefined },
  };
}

/** Units not approved keep the whole batch unverified; it can never be reported as verified. */
export function batchVerified(batch: Batch): boolean {
  return batch.integration.state === "approved" && integrationDigest(batch) === batch.integration.digest;
}

/** The worker prompt for a unit's attempt, repairs carrying the blocking findings. */
export function unitPrompt(batch: Batch, unit: Unit): string {
  return [
    `Pingo managed batch ${batch.id}, unit ${unit.id}${unit.repairs ? ` (repair ${unit.repairs})` : ""}.`,
    unit.description ? `Unit: ${unit.description}` : "",
    batch.sharedContracts ? `Shared contracts and ordering:\n${batch.sharedContracts}` : "",
    `Task:\n${unit.prompt}`,
    unit.areas.length ? `Affected areas:\n${unit.areas.map((a) => `- ${a}`).join("\n")}` : "",
    `Acceptance criteria:\n${unit.criteria.map((c) => `- ${c.id}: ${c.text}`).join("\n")}`,
    unit.verification.length ? `Run these checks and quote their output:\n${unit.verification.map((v) => `- ${v}`).join("\n")}` : "",
    unit.findings?.length ? `Fix these review findings:\n${unit.findings.map((f) => `- ${f}`).join("\n")}` : "",
    "Stay within this unit. Do not launch other agents or publish changes. End with a summary of what changed, the files touched, and each check's actual output.",
  ].filter(Boolean).join("\n\n");
}
