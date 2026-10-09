// Why a Jev call failed, in words: the cause that was observed, and what to do about it.
// Pure: the messages come from the provider layer and carry no key (jev.ts redacts them).
import { text, type Locale, type LocaleKey } from "./i18n.ts";
import { isJevError, reasonCause } from "./core/reasons.ts";
export { isJevFailure, reasonCode } from "./core/reasons.ts";

export type FailureKind = "auth" | "paid" | "model" | "rate" | "server" | "timeout" | "network" | "reply" | "answer" | "unknown";

/** The most any one cause shows in the log: enough to name it, never a whole response body. */
export const ERROR_CHARS = 240;

/** The observed cause of a failed or unusable Jev call: an error's message, or what the answer lacked. */
export function failureCause(reason: string, detail?: string): string | undefined {
  if (isJevError(reason)) return reasonCause(reason)?.slice(0, ERROR_CHARS);
  if (reason === "jev_unexpected_answer") return detail?.slice(0, ERROR_CHARS);
  return undefined;
}

/** What kind of failure a cause is, from the status and keywords the provider layer writes. */
export function failureKind(cause: string, reason = "jev_error"): FailureKind {
  if (reason === "jev_unexpected_answer") return "answer";
  const status = /\b([45]\d\d) (?:from|de)\b/.exec(cause)?.[1];
  if (status === "401" || status === "403") return "auth";
  if (status === "402") return "paid";
  if (status === "404" || status === "410") return "model";
  if (status === "429") return "rate";
  if (status) return "server";
  if (/tempo limite|timed? ?out|timeout/i.test(cause)) return "timeout";
  if (/erro de rede|network error|fetch failed|ECONN|ENOTFOUND/i.test(cause)) return "network";
  if (/json|formato inv|invalid response|resposta/i.test(cause)) return "reply";
  return "unknown";
}

/** The next step for a kind of failure, in the person's language. */
export const failureHint = (kind: FailureKind, locale: Locale) => text(`error.hint.${kind}` as LocaleKey, locale);

/** What a Jev answer lacked, for the cases the reply parsed but the router could not use. */
export function unusableAnswer(
  expected: readonly string[],
  answered: readonly string[],
  dropped: readonly { name: string; why: string }[] = [],
): string {
  const missing = expected.filter((name) => !answered.includes(name));
  const parts = [`missing ${missing.map((name) => `"${name}"`).join(", ") || "an answer"}`, `got ${answered.length ? answered.join(", ") : "nothing"}`];
  if (dropped.length) parts.push(`dropped ${dropped.map((one) => `${one.name} (${one.why})`).join(", ")}`);
  return parts.join("; ");
}
