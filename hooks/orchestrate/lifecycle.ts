import { reconcile } from "../core/queue.ts";
import { type Io } from "./types.ts";
import { pruneObjectives } from "./state.ts";
import { readBatches, updateBatches } from "./batches.ts";

/** Session start: restored queues are reconciled against live agents, so nothing launches twice. */
export async function restore(io: Io): Promise<void> {
  await pruneObjectives(io).catch(() => undefined);
  const list = await readBatches(io);
  if (!list.length) return;
  const live = new Set((await io.agents().catch(() => [])).filter((a) => a.status === "running" || a.status === "pending").map((a) => a.id));
  await updateBatches(io, (batches) => batches.map((b) => reconcile(b, live)));
}
