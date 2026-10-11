import { applyCommand, ORCHESTRATION_STORE } from "../core/orchestration.ts";
import { cancel } from "../core/queue.ts";
import { type Io } from "./types.ts";
import { exclusive, readPolicy, readObjective, saveObjective } from "./state.ts";
import { updateBatches } from "./batches.ts";

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
