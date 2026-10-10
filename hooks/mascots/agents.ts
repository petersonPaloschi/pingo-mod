import { AGENT_MASCOT_PALETTE } from "../theme.ts";

export type MascotId = "tetra" | "gem" | "can" | "coil" | "cone";

export interface AgentMascot {
  id: MascotId;
  name: string;
  color: number;
}

export const AGENT_MASCOTS: Record<MascotId, AgentMascot> = {
  tetra: { id: "tetra", name: "Tetra", color: AGENT_MASCOT_PALETTE.tetra },
  gem: { id: "gem", name: "Gem", color: AGENT_MASCOT_PALETTE.gem },
  can: { id: "can", name: "Can", color: AGENT_MASCOT_PALETTE.can },
  coil: { id: "coil", name: "Coil", color: AGENT_MASCOT_PALETTE.coil },
  cone: { id: "cone", name: "Top", color: AGENT_MASCOT_PALETTE.cone },
};

export const MASCOT_ORDER: readonly MascotId[] = ["tetra", "gem", "can", "coil", "cone"];

export const isMascot = (id: unknown): id is MascotId => typeof id === "string" && Object.hasOwn(AGENT_MASCOTS, id);

/** Give each concurrent subagent a distinct, readable identifier; reuse one after the set is full. */
export function pickMascot(running: readonly (string | undefined)[], n: number): MascotId {
  return MASCOT_ORDER.find((id) => !running.includes(id)) ?? MASCOT_ORDER[(n - 1) % MASCOT_ORDER.length]!;
}
