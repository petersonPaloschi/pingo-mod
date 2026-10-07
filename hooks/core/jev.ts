// The Jev client: where Jev runs, which key reaches it, and the one call the mod makes. The
// network, the timeout and the retry pause come in as functions, since a hooks module has no
// fetch or setTimeout of its own: the mod passes $.http.fetch and $.clock.
import type { AskJev } from "./decide.ts";
import type { Answer, SystemOneRequest, SystemOneResult, SystemOneWireResult } from "./types.ts";
import { text, type Locale, type LocaleKey } from "../i18n.ts";

export interface Provider {
  label: string;
  noteKey: LocaleKey;
  keyEnv: string;
  keyUrl: string;
  url: string;
  model: string;
  models?: string[];
  paidModel?: string;
}

export const PROVIDERS = {
  typesafe: {
    label: "TypeSafe",
    noteKey: "provider.typesafe.note",
    keyEnv: "TYPESAFE_API_KEY",
    keyUrl: "https://typesafe.ai",
    url: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
  },
  openrouter: {
    label: "OpenRouter",
    noteKey: "provider.openrouter.note",
    keyEnv: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/settings/keys",
    url: "https://openrouter.ai/api/alpha/decisions",
    model: "typesafe/jev-1.13",
  },
  vercel: {
    label: "Vercel AI Gateway",
    noteKey: "provider.vercel.note",
    keyEnv: "AI_GATEWAY_API_KEY",
    keyUrl: "https://vercel.com/dashboard/ai-gateway/api-keys",
    url: "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
    model: "typesafe-ai/jev",
  },
  opencode: {
    label: "OpenCode",
    noteKey: "provider.opencode.note",
    keyEnv: "OPENCODE_API_KEY",
    keyUrl: "https://opencode.ai/auth",
    url: "https://opencode.ai/zen/v1/systemone",
    model: "jev-1.13-free",
    models: ["jev-1.13-free", "jev-1.13"],
    paidModel: "jev-1.13",
  },
} satisfies Record<string, Provider>;

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
export const isProvider = (value: string): value is ProviderId => value in PROVIDERS;
const provider = (id: ProviderId): Provider => PROVIDERS[id];

type Env = Record<string, string | undefined>;
const present = (env: Env, name: string) => Boolean(env[name]?.trim());

/** An explicit choice wins; otherwise whichever key is there, TypeSafe's own first. */
export function resolveProvider(env: Env, chosen?: string): ProviderId {
  const wanted = (chosen && chosen !== "auto" ? chosen : env.JEV_PROVIDER)?.trim().toLowerCase();
  if (wanted && isProvider(wanted)) return wanted;
  return PROVIDER_IDS.find((id) => present(env, provider(id).keyEnv)) ?? "typesafe";
}

/** Reject known mismatched model namespaces; OpenCode also allowlists its two Jev IDs. */
export function resolveModel(id: ProviderId, requested: string | undefined): string {
  const { model, models } = provider(id);
  if (!requested) return model;
  if (models) return models.includes(requested) ? requested : model;
  if (id === "typesafe") return requested.includes("/") ? model : requested;
  if (id === "openrouter") {
    const fits = /^typesafe\/jev-\d+(?:\.\d+)*$/.test(requested) || requested === "~typesafe/jev-latest";
    return fits ? requested : model;
  }
  if (id === "vercel") return requested === model ? requested : model;
  return model;
}

export function resolveUrl(id: ProviderId): string {
  return provider(id).url;
}

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

/** Some gateways return choice answers without a confidence; the winning probability stands in. */
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** A share in [0, 1]; a provider answering in percentages fails it, and the answer is dropped. */
const share = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export function normalize(value: unknown, locale?: Locale): SystemOneResult {
  const result = record(value) as SystemOneWireResult | undefined;
  if (!result) throw new Error(text("provider.invalidResponse", locale));
  const answers: Record<string, Answer> = {};
  for (const [name, raw] of Object.entries(record(result.answers) ?? {})) {
    const answer = record(raw);
    if (answer?.type === "choice" && typeof answer.choice === "string") {
      const probabilities = Object.fromEntries(
        Object.entries(record(answer.probabilities) ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
      );
      if (!Object.values(probabilities).every(share)) continue;
      const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
        ? answer.confidence
        : Math.max(0, ...Object.values(probabilities));
      if (!share(confidence)) continue;
      answers[name] = { type: "choice", choice: answer.choice, confidence, probabilities };
    } else if (answer?.type === "noul" && share(answer.noul)) {
      answers[name] = { type: "noul", noul: answer.noul };
    }
  }
  const usage = record(result.usage);
  const tokens = (key: string) => (typeof usage?.[key] === "number" && Number.isFinite(usage[key]) && (usage[key] as number) >= 0 ? (usage[key] as number) : 0);
  return {
    ...(typeof result.model === "string" ? { model: result.model } : {}),
    answers,
    usage: { input_tokens: tokens("input_tokens"), output_tokens: tokens("output_tokens") },
  };
}

function headersFor(apiKey: string): Record<string, string> {
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
const printable = (body: string) =>
  body.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|[\x00-\x1f\x7f-\x9f]/g, " ");

class JevHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(reply.text);
    } catch {
      throw new JevReplyError(text("provider.invalidJson", settings.locale));
    }
    try {
      return normalize(parsed, settings.locale);
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

/** The setup check: one real call with a trivial question. */
export async function validateKey(
  id: ProviderId,
  apiKey: string,
  transport: Transport,
  model: string = provider(id).model,
  locale?: Locale,
): Promise<{ ok: true; ms: number } | { ok: false; refused: boolean; message: string }> {
  const info = provider(id);
  const startedAt = Date.now();
  try {
    const reply = await transport.within(
      15_000,
      transport.post(
        info.url,
        headersFor(apiKey),
        JSON.stringify({
          model,
          state: text("provider.setupState", locale),
          questions: { ok: { type: "noul", instructions: text("provider.setupQuestion", locale) } },
        }),
      ),
    );
    if (reply.ok) return { ok: true, ms: Date.now() - startedAt };
    const refused = reply.status === 401 || reply.status === 403;
    const paidHint = paidModelHint(id, model, reply.status, locale, true);
    return {
      ok: false,
      refused,
      message: text("provider.requestError", locale, {
        status: reply.status,
        provider: info.label,
        hint: paidHint,
        message: printable(redact(reply.text, apiKey).slice(0, 160)),
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, refused: false, message: text("provider.networkError", locale, { message: redact(message, apiKey) }) };
  }
}

function paidModelHint(id: ProviderId, model: string, status: number, locale: Locale | undefined, setup: boolean): string {
  const info = provider(id);
  if (id !== "opencode" || model !== info.model || !MODEL_GONE.has(status) || !info.paidModel) return "";
  return text(setup ? "provider.setupModelUnavailable" : "provider.modelUnavailable", locale, { model: info.paidModel });
}
