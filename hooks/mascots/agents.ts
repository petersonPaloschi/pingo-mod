export type MascotId = "tetra" | "gem" | "can" | "coil" | "cone";

export interface AgentMascot {
  id: MascotId;
  name: string;
  color: number;
}

export const AGENT_MASCOTS: Record<MascotId, AgentMascot> = {
  tetra: { id: "tetra", name: "Tetra", color: 0x67d4e6 },
  gem: { id: "gem", name: "Gem", color: 0xf78fc6 },
  can: { id: "can", name: "Can", color: 0xc3e88d },
  coil: { id: "coil", name: "Coil", color: 0xffb38a },
  cone: { id: "cone", name: "Top", color: 0xe9e09a },
};

export const MASCOT_ORDER: readonly MascotId[] = ["tetra", "gem", "can", "coil", "cone"];

export const isMascot = (id: unknown): id is MascotId => typeof id === "string" && Object.hasOwn(AGENT_MASCOTS, id);

/** Give each concurrent subagent a distinct, readable identifier; reuse one after the set is full. */
export function pickMascot(running: readonly (string | undefined)[], n: number): MascotId {
  return MASCOT_ORDER.find((id) => !running.includes(id)) ?? MASCOT_ORDER[(n - 1) % MASCOT_ORDER.length]!;
}
