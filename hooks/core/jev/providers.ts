import type { LocaleKey } from "../../i18n.ts";

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
export const provider = (id: ProviderId): Provider => PROVIDERS[id];

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
