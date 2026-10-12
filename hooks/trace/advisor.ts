import type { AdvisorInfo, TraceState } from "../../types";
import { PRESENCE_FLAGS, BOOLEAN_FLAGS, PROVIDER_FLAGS } from "./constants.ts";
import { isDone } from "./state.ts";

const isOn = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "");

/**
 * What keeps the advisor off in this environment, as the documentation words each variable: the
 * advisor needs feature-flag fetching and the Anthropic API. Informative only: nothing here is
 * proof that it is available when no variable is set.
 */
export function advisorBlocker(env: Readonly<Record<string, string | undefined>>): AdvisorInfo["blocked"] {
  for (const variable of PRESENCE_FLAGS) if (env[variable]) return { kind: "flags", variable };
  for (const variable of BOOLEAN_FLAGS) if (isOn(env[variable])) return { kind: "flags", variable };
  for (const variable of PROVIDER_FLAGS) if (isOn(env[variable])) return { kind: "provider", variable };
  return undefined;
}

export const setAdvisorInfo = (s: TraceState, info: AdvisorInfo): TraceState => ({ ...s, advisor: info });

/** `/jev clear`: finished runs and refused messages go; what still runs stays. */
export function clearTrace(s: TraceState): TraceState {
  return { ...s, runs: s.runs.filter((run) => !isDone(run)), inbox: s.inbox.filter((message) => message.state === "waiting") };
}
