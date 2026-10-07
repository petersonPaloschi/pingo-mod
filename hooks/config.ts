// Resolve settings without persisting credentials in the plugin's store.
import type { DecideConfig } from "./core/decide.ts";
import { isProvider, PROVIDERS, resolveModel, resolveProvider, resolveUrl, type JevSettings, type ProviderId } from "./core/jev.ts";
import { localeFor, localeOption, type Locale, type LocaleOption } from "./i18n.ts";

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
  /** Setup's provider, kept here only when Claude Code refused to save it as the plugin option. */
  provider?: string;
  /** The provider option and JEV_PROVIDER it was saved against (providerBasis); a change drops it. */
  basis?: string;
}

export interface Settings extends DecideConfig, JevSettings {
  provider: ProviderId;
  /** Where the key came from, for /jev status; never the key itself. */
  keySource: "plugin" | "environment" | "none";
  locale: Locale;
  localeOption: LocaleOption;
}

type Env = Record<string, string>;

/** Under `auto` with no provider key in the environment, Jev is reached here. */
const DEFAULT_PROVIDER: ProviderId = "typesafe";
const DEFAULT_MIN_CONFIDENCE = 0.7;
const DEFAULT_TIMEOUT_MS = 4000;
const TIMEOUT_RANGE = [500, 30_000] as const;

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
/** An environment variable's number; empty or not a number counts as unset. */
const envNum = (value: string | undefined) => (value?.trim() ? num(Number(value.trim())) : undefined);

/** A confidence is a share: 70 or -1 would switch routing off or on for everything. */
function minConfidence(options: ModOptions, env: Env): number {
  const share = (value: number | undefined) => (value !== undefined && value >= 0 && value <= 1 ? value : undefined);
  return share(num(options.min_confidence)) ?? share(envNum(env.JEV_MIN_CONFIDENCE)) ?? DEFAULT_MIN_CONFIDENCE;
}

/** The plugin option, else JEV_TIMEOUT_MS, held to a range that neither fails every call nor stalls a turn. */
function timeoutMs(options: ModOptions, env: Env): number {
  const value = num(options.timeout_ms) ?? envNum(env.JEV_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
  return Math.round(Math.min(TIMEOUT_RANGE[1], Math.max(TIMEOUT_RANGE[0], value)));
}

/** What an explicit provider choice was made against: the provider option and JEV_PROVIDER. */
export const providerBasis = (options: ModOptions, env: Env): string =>
  `${options.provider?.trim().toLowerCase() || "auto"}|${env.JEV_PROVIDER?.trim().toLowerCase() ?? ""}`;

/** The provider picked on purpose: Setup's stored fallback while its basis holds, the option, or JEV_PROVIDER. */
export function chosenProvider(options: ModOptions, env: Env, stored: StoredSettings = {}): ProviderId | undefined {
  if (storedApplies(options, env, stored)) return stored.provider as ProviderId;
  for (const value of [options.provider, env.JEV_PROVIDER]) {
    const wanted = value?.trim().toLowerCase();
    if (wanted && isProvider(wanted)) return wanted;
  }
  return undefined;
}

/** A stored provider counts until the option or JEV_PROVIDER changes; an older copy has no basis and counts under auto. */
export function storedApplies(options: ModOptions, env: Env, stored: StoredSettings): boolean {
  return Boolean(stored.provider && isProvider(stored.provider)) && (stored.basis ?? providerBasis({}, {})) === providerBasis(options, env);
}

/** The provider the plugin's api_key was issued by: the one chosen, or under auto the default. */
export const keyOwner = (options: ModOptions, env: Env, stored: StoredSettings = {}): ProviderId =>
  chosenProvider(options, env, stored) ?? DEFAULT_PROVIDER;

/**
 * The key that may go to `id`: the plugin's api_key only when `id` is its owner, else `id`'s own
 * environment variable. A provider auto-detected from its environment key gets that key.
 */
export function keyFor(id: ProviderId, options: ModOptions, env: Env, stored: StoredSettings = {}): Pick<Settings, "apiKey" | "keySource"> {
  const fromOptions = options.api_key?.trim();
  if (fromOptions && keyOwner(options, env, stored) === id) return { apiKey: fromOptions, keySource: "plugin" };
  const fromEnv = env[PROVIDERS[id].keyEnv]?.trim();
  return fromEnv ? { apiKey: fromEnv, keySource: "environment" } : { apiKey: "", keySource: "none" };
}

/** Pure: register.tsx reads the store and the environment (only it may reach `$`). */
export function resolveSettings(options: ModOptions, env: Env, stored: StoredSettings = {}): Settings {
  const provider = resolveProvider(env, chosenProvider(options, env, stored));
  return {
    provider,
    ...keyFor(provider, options, env, stored),
    localeOption: localeOption(options.locale),
    locale: localeFor(options.locale === "auto" ? undefined : options.locale),
    url: resolveUrl(provider),
    jevModel: resolveModel(provider, options.model?.trim()),
    timeoutMs: timeoutMs(options, env),
    minConfidence: minConfidence(options, env),
    maxStateChars: 60_000,
    maxMessageChars: 4_000,
  };
}
