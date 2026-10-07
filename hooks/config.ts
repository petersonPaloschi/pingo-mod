// Resolve settings without persisting credentials in the plugin's store.
import type { DecideConfig } from "./core/decide.ts";
import { isProvider, PROVIDERS, resolveModel, resolveProvider, resolveUrl, type JevSettings, type ProviderId } from "./core/jev.ts";
import { localeFor, type Locale } from "./i18n.ts";

export interface ModOptions {
  provider?: string;
  api_key?: string;
  model?: string;
  min_confidence?: number;
  timeout_ms?: number;
  locale?: string;
}

/** Non-sensitive settings retained by the plugin. */
export interface StoredSettings {
  provider?: string;
}

export interface Settings extends DecideConfig, JevSettings {
  provider: ProviderId;
  /** Where the key came from, for /jev status; never the key itself. */
  keySource: "plugin" | "environment" | "none";
  locale: Locale;
}

const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Pure: register.tsx reads the store and the environment (only it may reach `$`). */
export function resolveSettings(options: ModOptions, env: Record<string, string>, stored: StoredSettings = {}): Settings {
  const chosen = stored.provider && isProvider(stored.provider) ? stored.provider : options.provider;
  const provider = resolveProvider(env, chosen);
  const keyEnv = PROVIDERS[provider].keyEnv;
  const fromOptions = options.api_key?.trim();
  const fromEnv = env[keyEnv]?.trim();
  return {
    provider,
    apiKey: fromOptions || fromEnv || "",
    keySource: fromOptions ? "plugin" : fromEnv ? "environment" : "none",
    locale: localeFor(options.locale === "auto" ? undefined : options.locale),
    url: resolveUrl(provider),
    jevModel: resolveModel(provider, options.model?.trim()),
    timeoutMs: num(options.timeout_ms, 4000),
    minConfidence: num(options.min_confidence, 0.7),
    maxStateChars: 60_000,
    maxMessageChars: 4_000,
  };
}
