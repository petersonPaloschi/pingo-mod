// The one place a decision's reason is read: its code, whether it is a failure, and the message a
// thrown call carried. Every reason is a string so it can travel through the event log; a thrown
// call's carries its cause after a prefix (`jev_error: …`), which every reader strips the same way.
// Pure and dependency-free, so any layer can import it.

/** Reasons that carry a cause after their code. */
const PREFIXED = ["jev_error", "router_error"] as const;

/** Why Jev was not asked at all, before any feature is considered. */
export type GateReason = "routing_disabled" | "no_api_key";

/** A reason's code: a prefixed reason without its cause, any other reason as is. */
export const reasonCode = (reason: string): string => PREFIXED.find((prefix) => reason.startsWith(prefix)) ?? reason;

/** The Jev call threw: an outage, a timeout, a refused key. */
export const isJevError = (reason: string) => reasonCode(reason) === "jev_error";

/** The Jev call failed: it threw, or its reply could not be used. */
export const isJevFailure = (reason: string) => isJevError(reason) || reason === "jev_unexpected_answer";

/** What a thrown error says, whatever was thrown. */
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The reason a thrown Jev call is recorded with. */
export const jevErrorReason = (error: unknown) => `jev_error: ${errorMessage(error)}`;

/** The cause a prefixed reason carries, or undefined when it carries none. */
export function reasonCause(reason: string): string | undefined {
  const code = reasonCode(reason);
  if (code === reason) return undefined;
  return reason.slice(code.length).replace(/^:\s*/, "").trim() || undefined;
}

/** Why Jev cannot be asked, or undefined when it can: routing must be on and a key set. */
export const gateReason = (routing: boolean, hasKey: boolean): GateReason | undefined =>
  !routing ? "routing_disabled" : !hasKey ? "no_api_key" : undefined;
