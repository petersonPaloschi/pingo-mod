// The Jev client: where Jev runs, which key reaches it, and the one call the mod makes. The
// network, the timeout and the retry pause come in as functions, since a hooks module has no
// fetch or setTimeout of its own: the mod passes $.http.fetch and $.clock.
import type { AskJev } from "../request.ts";
import type { Answer, SystemOneRequest, SystemOneResult, SystemOneWireResult } from "../types.ts";
import { text, type Locale } from "../../i18n.ts";
import { provider, type ProviderId } from "./providers.ts";

export interface HttpReply {
  status: number;
  ok: boolean;
  text: string;
}

export interface Transport {
  /** POST and read the body; rejects on a network error. */
  post: (url: string, headers: Record<string, string>, body: string) => Promise<HttpReply>;
  /** Resolves after `ms`; the retry pause. */
  sleep: (ms: number) => Promise<void>;
  /** Rejects with a timeout error unless `work` settles within `ms`. */
  within: <T>(ms: number, work: Promise<T>) => Promise<T>;
}

export interface JevSettings {
  provider: ProviderId;
  apiKey: string;
  url: string;
  timeoutMs: number;
  locale?: Locale;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const MODEL_GONE = new Set([404, 410]);
/** How much of a reply body is kept for debugging. */
const RAW_CLIP = 16_000;

/** Provider data stays untrusted until its fields have been checked. */
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** A share in [0, 1]; a provider answering in percentages fails it, and the answer is dropped. */
const share = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export function normalize(value: unknown, locale?: Locale): SystemOneResult {
  const result = record(value) as SystemOneWireResult | undefined;
  if (!result) throw new Error(text("provider.invalidResponse", locale));
  const answers: Record<string, Answer> = Object.create(null);
  const dropped: { name: string; why: string }[] = [];
  for (const [name, raw] of Object.entries(record(result.answers) ?? {})) {
    const answer = record(raw);
    const malformed = (why = "malformed") => void dropped.push({ name, why });
    if (answer?.type === "choice") {
      if (typeof answer.choice !== "string") { malformed(answer.choice === undefined ? "missing choice" : "invalid choice"); continue; }
      // Confidence measures the distribution's concentration; a winning probability cannot replace it.
      const confidence = answer.confidence;
      const rawProbabilities = record(answer.probabilities);
      if (confidence === undefined) { malformed("missing confidence"); continue; }
      if (!share(confidence)) { malformed("invalid confidence"); continue; }
      if (answer.probabilities === undefined || answer.probabilities === null) { malformed("missing probabilities"); continue; }
      if (!rawProbabilities) { malformed("invalid probabilities"); continue; }
      const values = Object.values(rawProbabilities);
      if (!values.length || !values.every(share)) { malformed("invalid probabilities"); continue; }
      const probabilities = rawProbabilities as Record<string, number>;
      // Jev rounds large distributions to hundredths; each share can lose/gain up to 0.005.
      // Only count shares that can explain the drift (zero shares cannot explain an excess).
      const sum = values.reduce((total, probability) => total + probability, 0);
      const rounded = values.every((probability) => Math.abs(probability * 100 - Math.round(probability * 100)) <= 1e-10);
      const roundingError = rounded ? values.filter((probability) => sum > 1 ? probability > 0 : probability < 1).length * 0.005 : 0;
      if (sum === 0 || Math.abs(sum - 1) > Math.max(0.01, roundingError) + 1e-12) { malformed("probabilities do not sum to one"); continue; }
      if (!Object.hasOwn(probabilities, answer.choice)) { malformed("choice missing from probabilities"); continue; }
      if (probabilities[answer.choice]! < Math.max(...values)) { malformed("choice is not highest-probability option"); continue; }
      answers[name] = { type: "choice", choice: answer.choice, confidence, probabilities };
    } else if (answer?.type === "noul" && share(answer.noul)) {
      answers[name] = { type: "noul", noul: answer.noul };
    } else {
      malformed();
    }
  }
  const usage = record(result.usage);
  const tokens = (key: string) => typeof usage?.[key] === "number" && Number.isFinite(usage[key]) && (usage[key] as number) >= 0
    ? usage[key] as number
    : undefined;
  const inputTokens = tokens("input_tokens");
  const outputTokens = tokens("output_tokens");
  return {
    ...(typeof result.model === "string" ? { model: result.model } : {}),
    answers,
    usage: {
      ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
      ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
    },
    ...(dropped.length ? { dropped } : {}),
  };
}

export function headersFor(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "x-title": "jev-claude-code",
  };
}

export function redact(message: string, apiKey: string): string {
  return apiKey ? message.replaceAll(apiKey, "[redacted]") : message;
}

/** A provider's error body made safe to show: escape sequences and other control characters become spaces. */
export const printable = (body: string) =>
  body.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|[\x00-\x1f\x7f-\x9f]/g, " ");

// A plain field, not a parameter property, so Node's type stripping can load this file for the sift script.
class JevHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** A reply that arrived but cannot be used: asking again would get the same, so it is never retried. */
class JevReplyError extends Error {}

/**
 * The one call the mod makes to Jev, bounded by one timeout for the whole call: a fast failure
 * (a retryable status or a network error) is retried once inside it, a timeout never is.
 */
export function createAskJev(settings: JevSettings, transport: Transport): AskJev {
  const info = provider(settings.provider);
  const once = async (request: SystemOneRequest): Promise<SystemOneResult> => {
    const reply = await transport.post(settings.url, headersFor(settings.apiKey), JSON.stringify(request));
    if (!reply.ok) {
      const paidHint = paidModelHint(settings.provider, request.model, reply.status, settings.locale, false);
      throw new JevHttpError(
        text("provider.requestError", settings.locale, {
          status: reply.status,
          provider: info.label,
          hint: paidHint,
          message: printable(redact(reply.text, settings.apiKey).slice(0, 200)),
        }),
        reply.status,
      );
    }
    const raw = printable(redact(reply.text, settings.apiKey)).slice(0, RAW_CLIP);
    let parsed: unknown;
    try {
      parsed = JSON.parse(reply.text);
    } catch {
      throw new JevReplyError(`${text("provider.invalidJson", settings.locale)} ${raw.slice(0, 300)}`.trim());
    }
    try {
      const result = normalize(parsed, settings.locale);
      const unusable: { name: string; why: string }[] = [];
      for (const [name, answer] of Object.entries(result.answers)) {
        const question = Object.hasOwn(request.questions, name) ? request.questions[name] : undefined;
        if (!question || question.type !== answer.type || (answer.type === "choice" && question.type === "choice" &&
          (!Object.hasOwn(question.criteria, answer.choice) || Object.keys(answer.probabilities).some((option) => !Object.hasOwn(question.criteria, option))))) {
          unusable.push({ name, why: !question ? "not asked" : question.type !== answer.type ? "wrong type" : answer.type === "choice" ? `unoffered choice "${printable(answer.choice).slice(0, 40)}"` : "unusable" });
          delete result.answers[name];
        }
      }
      if (unusable.length) result.dropped = [...(result.dropped ?? []), ...unusable];
      result.raw = raw;
      return result;
    } catch (error) {
      throw new JevReplyError(error instanceof Error ? error.message : String(error));
    }
  };
  return async (request) => {
    let over = false;
    const attempt = async () => {
      try {
        return await once(request);
      } catch (error) {
        if (error instanceof JevReplyError) throw error;
        if (error instanceof JevHttpError && !RETRYABLE.has(error.status)) throw error;
        await transport.sleep(100);
        // The budget ran out during the pause: no second request after the timeout.
        if (over) throw error;
        return await once(request);
      }
    };
    try {
      return await transport.within(settings.timeoutMs, attempt());
    } catch (error) {
      if (error instanceof JevHttpError || error instanceof JevReplyError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(text("provider.networkError", settings.locale, { message: redact(message, settings.apiKey) }));
    } finally {
      over = true;
    }
  };
}

/** What one Jev call was sent, cut to what the live log shows: the same record for every caller. */
export function paidModelHint(id: ProviderId, model: string, status: number, locale: Locale | undefined, setup: boolean): string {
  const info = provider(id);
  if (id !== "opencode" || model !== info.model || !MODEL_GONE.has(status) || !info.paidModel) return "";
  return text(setup ? "provider.setupModelUnavailable" : "provider.modelUnavailable", locale, { model: info.paidModel });
}
