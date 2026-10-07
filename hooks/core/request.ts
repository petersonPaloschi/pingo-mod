import type { SystemOneRequest, SystemOneResult } from "./types.ts";

export type AskJev = (request: SystemOneRequest) => Promise<SystemOneResult>;

export type TimedAsk =
  | { result: SystemOneResult; latencyMs: number }
  | { failure: string };

/** Run one Jev request and turn provider errors into the router's fail-open reason. */
export async function askTimed(
  request: SystemOneRequest,
  askJev: AskJev,
  now: () => number = () => Date.now(),
): Promise<TimedAsk> {
  const startedAt = now();
  let result: SystemOneResult;
  try {
    result = await askJev(request);
  } catch (error) {
    return { failure: `jev_error: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { result, latencyMs: Math.round(now() - startedAt) };
}
