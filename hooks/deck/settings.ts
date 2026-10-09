// Deck preferences: what the band shows, how it folds, and the surface styles. Pure: the caller
// reads and writes the store; this module only validates and shapes the saved value.

export const SECTIONS = ["plans", "agents", "context", "limits", "route", "pet", "clock", "weather"] as const;
export type Section = (typeof SECTIONS)[number];
export type Show = Record<Section, boolean>;

export type DeckSize = "compact" | "roomy";
export type DeckCollapsed = "chips" | "text" | "rings";
export type DeckSurfaceStyle = { terminal: string; desktop: string };

export type DeckCity = { name: string; lat: number; lon: number };

export type DeckSettings = {
  show: Show;
  style: DeckSurfaceStyle;
  /** Expanded (true) or collapsed (false) when the band opens. */
  open: boolean;
  /** Expand by itself when something needs the person. */
  auto: boolean;
  sound: boolean;
  /** Hide the router's own status and log lines while Deck shows the route. */
  quiet: boolean;
  /** "compact" packs rows tighter on desktop; "roomy" keeps the wider spacing. */
  size: DeckSize;
  /** The collapsed look: mini-bar chips, one plain line, or limit rings. */
  collapsed: DeckCollapsed;
  /** Track spend today and this month (pay-per-use API keys). */
  cost: boolean;
  city: DeckCity | null;
};

export const DEFAULT_SETTINGS: DeckSettings = {
  show: { plans: true, agents: true, context: true, limits: true, route: true, pet: true, clock: true, weather: false },
  style: { terminal: "solid", desktop: "pixel" },
  open: false,
  auto: true,
  sound: true,
  quiet: true,
  size: "compact",
  collapsed: "chips",
  cost: false,
  city: null,
};

export const SIZES: readonly DeckSize[] = ["compact", "roomy"];
export const COLLAPSED: readonly DeckCollapsed[] = ["chips", "text", "rings"];
const STYLE_NAME_MAX = 32;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}

function styleName(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 && v.length <= STYLE_NAME_MAX ? v : fallback;
}

function city(v: unknown): DeckCity | null {
  if (!isRecord(v)) return null;
  const { name, lat, lon } = v;
  if (typeof name !== "string" || !name.trim() || !isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: name.trim().slice(0, 60), lat, lon };
}

/** Accepts any saved value: unknown keys are dropped and bad ones fall back to the defaults. */
export function parseSettings(raw: unknown): DeckSettings {
  const d = DEFAULT_SETTINGS;
  if (!isRecord(raw)) return { ...d, show: { ...d.show }, style: { ...d.style } };
  const show = isRecord(raw.show) ? raw.show : {};
  const style = isRecord(raw.style) ? raw.style : {};
  return {
    show: Object.fromEntries(SECTIONS.map((s) => [s, bool(show[s], d.show[s])])) as Show,
    style: {
      terminal: styleName(style.terminal, d.style.terminal),
      desktop: styleName(style.desktop, d.style.desktop),
    },
    open: bool(raw.open, d.open),
    auto: bool(raw.auto, d.auto),
    sound: bool(raw.sound, d.sound),
    quiet: bool(raw.quiet, d.quiet),
    size: oneOf(raw.size, SIZES, d.size),
    collapsed: oneOf(raw.collapsed, COLLAPSED, d.collapsed),
    cost: bool(raw.cost, d.cost),
    city: city(raw.city),
  };
}

/** The value to store: a plain JSON-safe object, so parseSettings(serializeSettings(s)) equals s. */
export function serializeSettings(settings: DeckSettings): DeckSettings {
  return {
    show: { ...settings.show },
    style: { ...settings.style },
    open: settings.open,
    auto: settings.auto,
    sound: settings.sound,
    quiet: settings.quiet,
    size: settings.size,
    collapsed: settings.collapsed,
    cost: settings.cost,
    city: settings.city ? { ...settings.city } : null,
  };
}

/** A settings copy with one section switched on or off. */
export function withSection(settings: DeckSettings, section: Section, on: boolean): DeckSettings {
  return { ...settings, show: { ...settings.show, [section]: on } };
}
