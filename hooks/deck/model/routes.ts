import type { RouteEvent } from "../../../types";
import { EFFORTS } from "../../core/contracts.ts";
import { text, type Locale } from "../../i18n.ts";
import { type Show } from "../settings.ts";
import { trunc } from "../theme.ts";
import { type RouteRoute, type DeckRoute, type DeckState, type RouteView, type DeckRow } from "./types.ts";
import { ROUTE_HISTORY, ROUTE_CARRY_MS, TIER_MODEL, MODEL_RANK } from "./constants.ts";
import { shortModel } from "./state.ts";

export function emptyRoute(now: number): RouteRoute {
  return { noAnswer: false, tier: "", conf: null, model: "", effort: "", unchanged: true, effortScore: null, risky: null, ms: null, at: now };
}

export function dropDemoRoute(s: DeckState): void {
  if (!s.demoRoute) return;
  s.demoRoute = false;
  s.route = null;
  s.routeHist.splice(0);
}

function pushHist(s: DeckState, entry: string): void {
  s.routeHist.push(entry);
  if (s.routeHist.length > ROUTE_HISTORY) s.routeHist.shift();
}

// the history token for a route: an applied model, a suggested one ("~"), or a failure
function histToken(tier: string, model: string): string {
  return model ? model : "~" + (TIER_MODEL[tier] ?? tier);
}

// "jev · fast 0.87 → haiku/low", "jev · fast 0.41 · unchanged", "jev · no answer"
export function readRouteStatus(s: DeckState, text: string, now: number): boolean {
  const t = String(text);
  if (/^jev · no answer/.test(t)) {
    dropDemoRoute(s);
    const prev = s.route ? (s.route.noAnswer ? s.route.last : s.route) : null;
    s.route = { noAnswer: true, reason: s.routeFail, fails: s.routeFails, last: prev, at: now };
    pushHist(s, "none");
    return true;
  }
  const m = t.match(/^jev · (\w+) ([\d.]+|n\/d)(?: → (\S+)| · unchanged)?/);
  if (!m) return false;
  dropDemoRoute(s);
  let model = "";
  let effort = "";
  for (const part of String(m[3] ?? "").split("/").filter(Boolean)) {
    if ((EFFORTS as readonly string[]).includes(part)) effort = part;
    else model = shortModel(part);
  }
  const tier = m[1] ?? "";
  const prev = s.route && !s.route.noAnswer && now - s.route.at < ROUTE_CARRY_MS ? s.route : emptyRoute(now);
  s.route = {
    ...prev,
    noAnswer: false,
    tier,
    conf: m[2] === "n/d" ? null : Number(m[2]),
    model,
    effort,
    unchanged: !m[3],
    at: now,
  };
  // filled when the router changed the model, outlined when Jev only suggested it
  pushHist(s, histToken(tier, model));
  return true;
}

// "[jev-model-router] jev: tier fast (0.87) · effort 0.4 → low (0.71) · risky 0.02 · 249ms"
export function readRouteLog(s: DeckState, text: string, now: number): boolean {
  const t = String(text);
  const fail =
    t.match(/\] (\w+) responded (\d+)/)?.slice(1).join(" ") ??
    (t.match(/classification passed (\d+)ms/)?.[1] ? "timeout " + t.match(/classification passed (\d+)ms/)![1] + "ms" : null) ??
    (/classification failed|built-in classifier failed/.test(t) ? "request failed" : null);
  if (fail) {
    s.routeFail = fail;
    s.routeFails++;
    return true;
  }
  const m = t.match(/jev: tier (\w+) \(([\d.]+|n\/d)\)(?: · effort ([\d.]+) → (\w+) \([^)]*\))?(?: · risky ([\d.]+|n\/d))?(?: · (\d+)ms)?/);
  if (!m) return false;
  dropDemoRoute(s);
  s.routeFail = null;
  s.routeFails = 0;
  const prev = s.route && !s.route.noAnswer ? s.route : emptyRoute(now);
  s.route = {
    ...prev,
    noAnswer: false,
    tier: m[1] ?? "",
    conf: m[2] === "n/d" ? null : Number(m[2]),
    effortScore: m[3] ? Number(m[3]) : null,
    risky: m[5] && m[5] !== "n/d" ? Number(m[5]) : null,
    ms: m[6] ? Number(m[6]) : null,
    at: now,
  };
  return true;
}

// Pingo's own route events, in the same shape as the deck's route. Mapping:
//   tier        the deck tier of the choice Jev made: a tier name, or its model (haiku/sonnet/opus); else ""
//   model       the model the request ran with, only when Jev changed it (mode "hint"); "" when kept
//   effort      the effort the request was sent with
//   conf        Jev's confidence (jev.confidence, else the event's confidence)
//   ms          the request's duration
//   risky       null (Pingo reports no risk score)
//   failure     an event with an error becomes a no-answer route, reason = the error
export function routeFromPingoEvent(e: RouteEvent, now: number): DeckRoute {
  const parsed = Date.parse(e.time);
  const at = Number.isFinite(parsed) ? parsed : now;
  if (e.error) return { noAnswer: true, reason: trunc(e.error, 40), fails: 1, last: null, at };
  const choice = e.jev?.choice ?? "";
  const tier = TIER_MODEL[choice] ? choice : Object.keys(TIER_MODEL).find((k) => TIER_MODEL[k] === choice) ?? "";
  const model = e.mode === "hint" && e.model ? shortModel(e.model) : "";
  return {
    noAnswer: false,
    tier,
    conf: e.jev?.confidence ?? e.confidence ?? null,
    model,
    effort: e.effort ?? "",
    unchanged: !model,
    effortScore: null,
    risky: null,
    ms: e.durationMs,
    at,
  };
}

// takes a Pingo route event into the state, the same way a deck route line would be taken
export function takePingoRoute(s: DeckState, e: RouteEvent, now: number): void {
  dropDemoRoute(s);
  const route = routeFromPingoEvent(e, now);
  s.route = route;
  if (route.noAnswer) {
    s.routeFail = route.reason;
    s.routeFails = 1;
    pushHist(s, "none");
    return;
  }
  s.routeFail = null;
  s.routeFails = 0;
  pushHist(s, histToken(route.tier, route.model));
}


export function routeRow(s: DeckState, show: Show, locale: Locale): DeckRow | null {
  if (!show.route || !s.route) return null;
  const from = shortModel(s.seen.model || s.sessionModel) || text("deck.route.session", locale);
  const title = text("deck.title.modelRoute", locale);
  const route = s.route;
  if (route.noAnswer) {
    const reason = route.reason ?? text("deck.route.noAnswer", locale);
    const view: RouteView = {
      noAnswer: true,
      reason,
      hint: route.fails >= 3 ? text("deck.route.checkKey", locale) : "",
      from,
      want: from,
      to: from,
      effort: s.seen.effort || "",
      dir: "=",
      conf: null,
      risky: null,
      ms: null,
      tier: "",
      unapplied: false,
    };
    return {
      id: "route",
      kind: "route",
      style: "warn",
      title,
      pct: 0,
      marks: [],
      right: "! " + text("deck.route.noAnswer", locale),
      short: "⇄ " + from + " · " + text("deck.route.noAnswer", locale),
      strips: null,
      route: view,
    };
  }
  if (!route.tier && !route.model) return null;
  const want = route.tier ? (TIER_MODEL[route.tier] ?? route.tier) : "";
  const to = route.model || from;
  const effort = route.effort || s.seen.effort || "";
  const toRank = MODEL_RANK[to];
  const fromRank = MODEL_RANK[from];
  // only a model the router actually switched to counts as cheaper or deeper
  const dir: "↓" | "↑" | "=" =
    !route.model ? "=" : toRank != null && fromRank != null ? (toRank < fromRank ? "↓" : toRank > fromRank ? "↑" : "=") : "=";
  const view: RouteView = {
    noAnswer: false,
    reason: "",
    hint: "",
    from,
    want,
    to,
    effort,
    dir,
    conf: route.conf,
    risky: route.risky,
    ms: route.ms,
    tier: route.tier,
    unapplied: !!want && want !== to,
  };
  return {
    id: "route",
    kind: "route",
    style: "run",
    title,
    pct: 0,
    marks: [],
    right: dir === "↓" ? text("deck.route.cheaper", locale) : dir === "↑" ? text("deck.route.deeper", locale) : text("deck.route.keptMark", locale),
    short: "⇄ " + to + (effort ? "·" + effort : ""),
    strips: null,
    route: view,
  };
}
