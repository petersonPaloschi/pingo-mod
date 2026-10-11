import type { AgentRun } from "../../../types";
import { AGENT_MASCOTS, isMascot } from "../../mascots/agents.ts";

/** A subagent's name and color, when its identifier is known. */
export const mascotOf = (run: AgentRun) => (isMascot(run.mascot) ? AGENT_MASCOTS[run.mascot] : undefined);
