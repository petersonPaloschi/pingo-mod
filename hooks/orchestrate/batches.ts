import { askTimed } from "../core/request.ts";
import { truncate } from "../core/state.ts";
import { BATCH_INSTRUCTION, ORCHESTRATION_PROMPT_VERSION } from "../core/prompts.ts";
import { concurrencyQuestion, MODEL_LABEL, readConcurrency, type OrchestrationPolicy } from "../core/orchestration.ts";
import { text } from "../i18n.ts";
import { runReview, type Evidence } from "../core/review.ts";
import { admit, assignProfiles, batchVerified, createBatch, holdUnit, integrationDigest, integrationDone, integrationStarted, launched, launchFailed, reviewable, reviewDone, reviewStarted, unitOfAgent, unitPrompt, unitsDone, validatePlan, workerDone, type Batch } from "../core/queue.ts";
import type { Settings } from "../config.ts";
import { type Io } from "./types.ts";
import { exclusive, readPolicy, readObjective } from "./state.ts";
import { chooseProfiles } from "./policy.ts";
import { spawns, spawnOfAgent, editedBy, managedPrompts, diffEvidence, startReview } from "./agents.ts";

export const BATCH_STORE = "orchestration.batches";

const KEPT_BATCHES = 5;

export async function onAgentDone(io: Io, agentId: string, answer: string, ok: boolean): Promise<void> {
  if (await advanceBatchUnit(io, agentId, answer, ok)) return;
  const toolUseId = spawnOfAgent.get(agentId);
  const plan = toolUseId ? spawns.get(toolUseId) : undefined;
  if (plan) startReview(io, plan, answer);
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

export async function updateBatches(io: Io, change: (list: Batch[]) => Batch[]): Promise<Batch[]> {
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
  await io.log(outcome.approved ? "good" : "warn", `Orchestration: ${batchId} ${unitId} review ${outcome.verdict} -> ${state}`, outcome.problems.join(", ") || undefined);
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
    await io.log("warn", `Orchestration: ${batchId} is UNVERIFIED - not every unit was approved`);
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
  await io.log(batchVerified(next) ? "good" : "warn", `Orchestration: ${batchId} integration ${next.integration.state}${batchVerified(next) ? " - verified" : " - UNVERIFIED"}`);
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
