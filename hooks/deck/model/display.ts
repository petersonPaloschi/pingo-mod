import { text, type Locale, type LocaleKey } from "../../i18n.ts";
import { type DeckSettings } from "../settings.ts";
import { type DeckState, type DeckRow, type PetMood, type DeckSound, type ReactCues } from "./types.ts";
import { SLEEPY_MS, CELEBRATE_MS, STYLE_GLYPH } from "./constants.ts";
import { barState } from "./bars.ts";
import { stripTool, sectionsOn } from "./rows.ts";
import { plain } from "../theme.ts";
import { GLYPH } from "../../theme.ts";

// collapsed: what needs you first, then limits, context, bars, the route
export function collapsedOrder(rows: readonly DeckRow[]): DeckRow[] {
  const rank = (r: DeckRow) => (r.state === "needs_input" ? 0 : r.limit ? 1 : r.id === "context" ? 2 : r.kind === "bar" ? 3 : 4);
  return [...rows].sort((a, b) => rank(a) - rank(b));
}



export function petMood(s: DeckState, rows: readonly DeckRow[], now: number): PetMood {
  if (rows.some((r) => r.state === "needs_input")) return "alert";
  if (now < s.celebrateUntil) return "celebrate";
  if (s.turnActive) return "working";
  if (now - s.lastActivity > SLEEPY_MS) return "sleepy";
  return "calm";
}



// compares the rows with the last tick: which sounds to play, the done times, the celebration;
// wantOpen says a row needs the person (the caller expands when settings.auto allows)
export function react(s: DeckState, rows: readonly DeckRow[], now: number): ReactCues {
  for (const bar of s.bars.values()) {
    const st = barState(s, bar);
    if (st === "done" && !bar.doneAt) bar.doneAt = now;
    if (st !== "done") bar.doneAt = null;
  }
  const live = rows.filter((r) => r.kind === "bar" && r.animating).length;
  const sounds: DeckSound[] = [];
  let anyAsk = false;
  for (const row of rows) {
    if (row.kind !== "bar" || !row.state) continue;
    const prev = s.lastSeen.get(row.id);
    const stage = row.stage ?? 0;
    if (row.state === "needs_input") anyAsk = true;
    if (prev) {
      if (row.state === "needs_input" && prev.state !== "needs_input") sounds.push("alert");
      else if (row.state === "error" && prev.state !== "error") sounds.push("error");
      else if (row.state === "done" && prev.state !== "done") {
        sounds.push(live === 0 ? "fanfare" : "chime");
        s.celebrateUntil = now + CELEBRATE_MS;
      } else if (stage > prev.stage && row.state !== "done") sounds.push("tick");
    }
    s.lastSeen.set(row.id, { state: row.state, stage });
  }
  return { sounds, wantOpen: anyAsk };
}

// the words the terminal's status prints: each row, its strips, and the preferences in force
export function statusText(
  rows: readonly DeckRow[],
  settings: DeckSettings,
  petAct: string,
  version: string,
  locale: Locale,
  expanded: boolean,
): string {
  const lines: string[] = [];
  for (const r of rows) {
    if (r.kind === "route" && r.route?.noAnswer) {
      const hint = r.route.hint ? " - " + r.route.hint : "";
      lines.push(text("deck.route.statusNoAnswer", locale, { reason: r.route.reason, to: r.route.to, hint }));
      continue;
    }
    if (r.kind === "route" && r.route) {
      const v = r.route;
      const effort = v.effort ? text("deck.route.effortNote", locale, { effort: v.effort }) : "";
      const conf = v.conf != null ? " " + v.conf.toFixed(2) : "";
      const suggested = v.unapplied ? text("deck.route.statusSuggested", locale, { want: v.want }) : "";
      lines.push(
        text("deck.route.statusLine", locale, {
          from: v.from,
          arrow: v.dir === "=" ? "=" : GLYPH.route,
          to: v.to,
          effort,
          tier: v.tier,
          conf,
          suggested,
          right: r.right,
        }),
      );
      continue;
    }
    lines.push(
      plain(STYLE_GLYPH[r.style] + " " + r.title + " - " + (r.name ?? "") + (r.count ? " " + r.count : "") + (r.right ? " (" + r.right + ")" : "")),
    );
    for (const a of r.strips?.shown ?? []) {
      lines.push("   " + GLYPH.branch + " " + a.title + ": " + stripTool(a, locale) + " [" + a.state + "]" + (a.model ? " {" + a.model + "}" : ""));
    }
  }
  const on = sectionsOn(settings.show).map((x) => text(("deck.section." + x) as LocaleKey, locale)).join(", ") || text("deck.nothing", locale);
  const head = lines.length ? lines.join("\n") : text("deck.noRows", locale);
  const city = settings.city ? text("deck.status.city", locale, { city: settings.city.name }) : "";
  return (
    head +
    "\n" +
    text("deck.status.showing", locale, {
      sections: on,
      state: text(expanded ? "deck.expanded" : "deck.collapsed", locale),
      terminal: settings.style.terminal,
      desktop: settings.style.desktop,
      pet: petAct,
      auto: text(settings.auto ? "deck.on" : "deck.off", locale),
      sound: text(settings.sound ? "deck.on" : "deck.off", locale),
      city,
      version,
    })
  );
}
