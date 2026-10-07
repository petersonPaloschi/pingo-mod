// The Jev client: where Jev runs, which key reaches it, and the one call the mod makes. The
// network, the timeout and the retry pause come in as functions, since a hooks module has no
// fetch or setTimeout of its own: the mod passes $.http.fetch and $.clock.
import type { AskJev } from "./decide.ts";
import type { Answer, SystemOneRequest, SystemOneResult } from "./types.ts";

export interface Provider {
  label: string;
  note: string;
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
    note: "the official API, direct from the makers of Jev",
    keyEnv: "TYPESAFE_API_KEY",
    keyUrl: "https://typesafe.ai",
    url: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
  },
  openrouter: {
    label: "OpenRouter",
    note: "Jev through your OpenRouter account and credits",
    keyEnv: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/settings/keys",
    url: "https://openrouter.ai/api/alpha/decisions",
    model: "typesafe/jev-1.13",
  },
  vercel: {
    label: "Vercel AI Gateway",
    note: "Jev through your Vercel AI Gateway key and billing",
    keyEnv: "AI_GATEWAY_API_KEY",
    keyUrl: "https://vercel.com/dashboard/ai-gateway/api-keys",
    url: "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
    model: "typesafe-ai/jev",
  },
  opencode: {
    label: "OpenCode",
    note: "Jev through your OpenCode Zen key; Jev 1.13 Free is currently time-limited",
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
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const MODEL_GONE = new Set([404, 410]);

/** Some gateways return choice answers without a confidence; the winning probability stands in. */
export function normalize(result: SystemOneResult): SystemOneResult {
  const answers: Record<string, Answer> = {};
  for (const [name, answer] of Object.entries(result.answers ?? {})) {
    const probabilities = answer.type === "choice" ? Object.values(answer.probabilities ?? {}) : [];
    answers[name] =
      answer.type === "choice" && typeof answer.confidence !== "number" && probabilities.length
        ? { ...answer, confidence: Math.max(...probabilities) }
        : answer;
  }
  return {
    model: result.model,
    answers,
    usage: { input_tokens: result.usage?.input_tokens ?? 0, output_tokens: result.usage?.output_tokens ?? 0 },
  };
}

function headersFor(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "x-title": "jev-claude-code",
  };
}

function redact(message: string, apiKey: string): string {
  return apiKey ? message.replaceAll(apiKey, "[redacted]") : message;
}

class JevHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** The one call the mod makes to Jev: a timeout and one fast retry; past that, Claude decides alone. */
export function createAskJev(settings: JevSettings, transport: Transport): AskJev {
  const info = provider(settings.provider);
  const once = async (request: SystemOneRequest): Promise<SystemOneResult> => {
    const reply = await transport.within(
      settings.timeoutMs,
      transport.post(settings.url, headersFor(settings.apiKey), JSON.stringify(request)),
    );
    if (!reply.ok) {
      const paidHint =
        settings.provider === "opencode" && request.model === info.model && MODEL_GONE.has(reply.status)
          ? `free model unavailable; set the model to ${info.paidModel} for paid Jev. `
          : "";
      throw new JevHttpError(
        `${reply.status} from ${info.label}: ${paidHint}${redact(reply.text, settings.apiKey).slice(0, 200)}`,
        reply.status,
      );
    }
    return normalize(JSON.parse(reply.text) as SystemOneResult);
  };
  return async (request) => {
    try {
      return await once(request);
    } catch (error) {
      const status = error instanceof JevHttpError ? error.status : undefined;
      const message = error instanceof Error ? error.message : String(error);
      if (status !== undefined && !RETRYABLE.has(status)) {
        throw new JevHttpError(redact(message, settings.apiKey), status);
      }
      await transport.sleep(100);
      try {
        return await once(request);
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        if (retryError instanceof JevHttpError) throw retryError;
        throw new Error(redact(retryMessage, settings.apiKey));
      }
    }
  };
}

/** The setup check: one real call with a trivial question. */
export async function validateKey(
  id: ProviderId,
  apiKey: string,
  transport: Transport,
  model: string = provider(id).model,
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
          state: "Jev setup check",
          questions: { ok: { type: "noul", instructions: "Is this a setup check?" } },
        }),
      ),
    );
    if (reply.ok) return { ok: true, ms: Date.now() - startedAt };
    const refused = reply.status === 401 || reply.status === 403;
    const paidHint = id === "opencode" && model === info.model && MODEL_GONE.has(reply.status)
      ? `free model unavailable; set the plugin model to ${info.paidModel} and retry. `
      : "";
    return { ok: false, refused, message: `${reply.status} from ${info.label}: ${paidHint}${redact(reply.text, apiKey).slice(0, 160)}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, refused: false, message: redact(message, apiKey) };
  }
}
