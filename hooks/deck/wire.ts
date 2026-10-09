// The /deck command's settings rules and reply texts: pure. register.tsx reads the command, stores
// what comes back, and handles the verbs that touch the live rows, the band's fold, the network or a
// pane itself (the toggle, the style picker, panel, city, demo, clear, status, version).
import { DESKTOP_STYLES } from "./styles-desktop.ts";
import { TERMINAL_STYLES } from "./styles-terminal.ts";
import { COLLAPSED, SECTIONS, SIZES, withSection, type DeckCollapsed, type DeckSettings, type DeckSize, type Section } from "./settings.ts";
import { text, type Locale, type LocaleKey } from "../i18n.ts";

const SWITCHES = ["cost", "auto", "sound", "quiet"] as const;
type Switch = (typeof SWITCHES)[number];

/** The help lines in the order the command lists them; style names and section names are filled in. */
export const USAGE_KEYS: readonly LocaleKey[] = [
  "deck.help.toggle",
  "deck.help.expand",
  "deck.help.style",
  "deck.help.section",
  "deck.help.city",
  "deck.help.quiet",
  "deck.help.panel",
  "deck.help.version",
  "deck.help.size",
  "deck.help.collapsed",
  "deck.help.cost",
  "deck.help.auto",
  "deck.help.sound",
  "deck.help.demo",
  "deck.help.clear",
  "deck.help.status",
];

export type DeckReply = { settings: DeckSettings; text: string };

const onOff = (value: string): boolean | undefined => (value === "on" ? true : value === "off" ? false : undefined);

/** The argument words: the verb lower-cased (command words name settings in every locale), the rest as typed. */
export function deckWords(args: string): { verb: string; rest: string[] } {
  const [verb = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
  return { verb: verb.toLowerCase(), rest };
}

/** The reply to a toggle, the band's state after it. */
export function openReply(open: boolean, locale: Locale): string {
  return text(open ? "deck.reply.expanded" : "deck.reply.collapsed", locale);
}

/** One command's help line: the style names and the section names are filled in. */
export function deckHelp(key: LocaleKey, settings: DeckSettings, locale: Locale): string {
  if (key === "deck.help.styleName") return text(key, locale, { terminal: settings.style.terminal, desktop: settings.style.desktop });
  if (key === "deck.help.section") return text(key, locale, { sections: SECTIONS.join(", ") });
  return text(key, locale);
}

/** The usage block: each command's help line, with the current style and section names filled in. */
export function deckUsage(settings: DeckSettings, locale: Locale): string {
  const lines = USAGE_KEYS.map((key) => {
    if (key === "deck.help.style") return deckHelp(key, settings, locale) + "\n" + deckHelp("deck.help.styleName", settings, locale);
    return deckHelp(key, settings, locale);
  });
  return lines.join("\n");
}

/**
 * Applies one `/deck` argument string to the settings. An unknown or incomplete argument returns
 * the settings unchanged with the usage block as its text. Command words name the setting, as
 * they do in every locale; only the values and the replies are translated.
 */
export function applyDeckCommand(settings: DeckSettings, args: string, locale: Locale): DeckReply {
  const { verb, rest } = deckWords(args);
  const arg = (rest[0] ?? "").toLowerCase();
  const usage: DeckReply = { settings, text: deckUsage(settings, locale) };
  const set = (next: DeckSettings, name: string, shown: string): DeckReply => ({
    settings: next,
    text: text("deck.reply.set", locale, { name, value: shown }),
  });
  const flag = (on: boolean) => text(on ? "deck.on" : "deck.off", locale);

  if (verb === "expand" || verb === "collapse") {
    const open = verb === "expand";
    return { settings: { ...settings, open }, text: openReply(open, locale) };
  }

  if (verb === "style") {
    // a bare style opens the picker, which the caller handles; here it has no name to set
    if (!arg) return usage;
    const terminal = (TERMINAL_STYLES as readonly string[]).includes(arg);
    const desktop = (DESKTOP_STYLES as readonly string[]).includes(arg);
    if (!terminal && !desktop) {
      return {
        settings,
        text: text("deck.reply.noStyle", locale, { name: arg, terminal: TERMINAL_STYLES.join(", "), desktop: DESKTOP_STYLES.join(", ") }),
      };
    }
    const style = { terminal: terminal ? arg : settings.style.terminal, desktop: desktop ? arg : settings.style.desktop };
    const surfaces =
      terminal && desktop
        ? text("deck.surface.both", locale)
        : terminal
          ? text("deck.surface.cli", locale)
          : text("deck.surface.desktop", locale);
    return { settings: { ...settings, style }, text: text("deck.reply.style", locale, { name: arg, surfaces }) };
  }

  if (verb === "all" || (SECTIONS as readonly string[]).includes(verb)) {
    const on = onOff(arg);
    if (on === undefined) return usage;
    const keys: readonly Section[] = verb === "all" ? SECTIONS : [verb as Section];
    return set(keys.reduce((s, key) => withSection(s, key, on), settings), verb, flag(on));
  }

  // a collapsed look is what a folded band shows, so choosing one folds the band
  if (verb === "collapsed" && (COLLAPSED as readonly string[]).includes(arg)) {
    return set({ ...settings, collapsed: arg as DeckCollapsed, open: false }, verb, arg);
  }

  if (verb === "size" && (SIZES as readonly string[]).includes(arg)) {
    return { settings: { ...settings, size: arg as DeckSize }, text: text(arg === "compact" ? "deck.reply.compact" : "deck.reply.roomy", locale) };
  }

  if ((SWITCHES as readonly string[]).includes(verb)) {
    const on = onOff(arg);
    if (on === undefined) return usage;
    const field = verb as Switch;
    const next = { ...settings, [field]: on };
    if (field === "cost") return { settings: next, text: text(on ? "deck.reply.costOn" : "deck.reply.costOff", locale) };
    return set(next, verb, flag(on));
  }

  return usage;
}
