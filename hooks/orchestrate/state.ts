import { migratePolicy, normalizePolicy, OBJECTIVE_KEEP_MS, OBJECTIVE_STORE, objectiveStoreKey, ORCHESTRATION_STORE, type OrchestrationPolicy } from "../core/orchestration.ts";
import { restoreObjective, type Objective } from "../core/objective.ts";
import { type Io } from "./types.ts";

const NOTES_STORE = "orchestration.notes";


/** One writer at a time for the batch and objective records (the store has no compare-and-set). */
let chain: Promise<unknown> = Promise.resolve();
export function exclusive<T>(work: () => Promise<T>): Promise<T> {
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

/** Where this session's objective is kept. */
async function objectiveKey(io: Io): Promise<string> {
  return objectiveStoreKey(await io.sessionId?.().catch(() => undefined));
}

export async function readObjective(io: Io): Promise<Objective | undefined> {
  return restoreObjective(await io.storeGet(await objectiveKey(io)).catch(() => undefined), normalizePolicy);
}

export async function saveObjective(io: Io, objective: Objective | undefined) {
  const key = await objectiveKey(io);
  return objective ? io.storeSet(key, objective) : io.storeDelete(key);
}


export async function pushNote(io: Io, note: string): Promise<void> {
  await exclusive(async () => {
    const list = ((await io.storeGet(NOTES_STORE).catch(() => undefined)) as string[] | undefined) ?? [];
    await io.storeSet(NOTES_STORE, [...list, note].slice(-10));
  });
}

export async function takeNotes(io: Io): Promise<string[]> {
  const list = ((await io.storeGet(NOTES_STORE).catch(() => undefined)) as string[] | undefined) ?? [];
  if (list.length) await io.storeDelete(NOTES_STORE).catch(() => undefined);
  return list;
}


/**
 * Drops the objectives no session will read again: the old one every session shared, and other sessions' that
 * started more than OBJECTIVE_KEEP_MS ago. This session's own is never touched; without a session id nothing is.
 */
export async function pruneObjectives(io: Io): Promise<void> {
  const sessionId = await io.sessionId?.().catch(() => undefined);
  if (!sessionId || !io.storeKeys) return;
  const own = objectiveStoreKey(sessionId);
  const now = await io.now();
  for (const key of await io.storeKeys()) {
    if (key === own || (key !== OBJECTIVE_STORE && !key.startsWith(`${OBJECTIVE_STORE}:`))) continue;
    const started = key === OBJECTIVE_STORE ? undefined : ((await io.storeGet(key).catch(() => undefined)) as { startedAt?: unknown } | undefined)?.startedAt;
    if (typeof started !== "number" || now - started > OBJECTIVE_KEEP_MS) await io.storeDelete(key);
  }
}
