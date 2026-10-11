import { text, type Locale } from "../../i18n.ts";
import { type Section, type Show, SECTIONS } from "../settings.ts";
import { trunc } from "../theme.ts";
import { type RowStyle, type Bar, type Agent, type DeckState, type Mark, type Strips, type DeckRow } from "./types.ts";
import { BAR_LINGER_MS, AGENTS_LINGER_MS, ACTIVITY_LINGER_MS, FOLD_MS, MAX_STRIPS, STYLE_GLYPH, STATE_STYLE } from "./constants.ts";
import { fmtK, countdown, humanReset, elapsed, limitName } from "./state.ts";
import { agentsOf } from "./agents.ts";
import { series, burnRate } from "./usage.ts";
import { allSteps, where, barState } from "./bars.ts";
import { routeRow } from "./routes.ts";


// ---------- rows ----------


export function visibleStrips(s: DeckState, home: string, agentsDoneAt: number | null, show: Show, now: number): Strips | null {
  if (!show.agents) return null;
  const list = agentsOf(s, home);
  if (!list.length) return null;
  const hasError = list.some((a) => a.state === "error");
  if (agentsDoneAt && now - agentsDoneAt > FOLD_MS && !hasError) return null;
  if (list.length <= MAX_STRIPS) return { shown: list, hidden: [] };
  const keep = new Set(list.filter((a) => a.state !== "done").slice(0, MAX_STRIPS - 1).map((a) => a.id));
  for (const a of [...list].reverse()) {
    if (keep.size >= MAX_STRIPS - 1) break;
    keep.add(a.id);
  }
  return { shown: list.filter((a) => keep.has(a.id)), hidden: list.filter((a) => !keep.has(a.id)) };
}

export function stripTool(a: Agent, locale: Locale): string {
  if (a.state === "waiting") return text("deck.tool.needsApproval", locale);
  if (a.todo && a.todo.total && a.state === "running") {
    return trunc(a.todo.active || text("deck.title.tasks", locale), 24) + " " + Math.min(a.todo.total, a.todo.done + 1) + "/" + a.todo.total;
  }
  return a.tool;
}

export function barRow(s: DeckState, bar: Bar, show: Show, now: number, locale: Locale): DeckRow {
  const state = barState(s, bar);
  const w = where(bar);
  const done = state === "done";
  const single = bar.stages.length === 1;
  const list = agentsOf(s, bar.id);
  const agentNote =
    list.length && bar.id !== "agents"
      ? text("deck.agentNote", locale, { done: list.filter((a) => a.state === "done").length, total: list.length })
      : "";
  let name: string;
  let count: string;
  if (bar.id === "agents") {
    name = done ? text("deck.name.done", locale) : text("deck.name.agents", locale);
    count = w.finished + "/" + w.total;
  } else if (done) {
    name = text("deck.name.done", locale);
    count = w.total + "/" + w.total;
  } else if (single) {
    name = w.active ? w.active.active || w.active.title : (bar.stages[0]?.name ?? "");
    count = Math.min(w.total, w.pos + 1) + "/" + w.total;
  } else {
    name = bar.stages[w.stage]?.name ?? "";
    count = w.step + "/" + w.stageSize;
  }
  const marks: Mark[] = [];
  let k = 0;
  for (const st of bar.stages) {
    st.steps.forEach((_, j) => {
      if (k > 0) marks.push({ f: k / w.total, stage: !single && j === 0 });
      k++;
    });
  }
  const pct = done ? 100 : ((w.finished + (w.active ? 0.4 : 0)) / Math.max(1, w.total)) * 100;
  const shortName = trunc(name, 30);
  return {
    id: "bar:" + bar.id,
    kind: "bar",
    bar,
    style: STATE_STYLE[state],
    state,
    title: bar.title || text("deck.stage.plan", locale),
    pct,
    marks,
    steps: w.total,
    finished: w.finished,
    name: shortName,
    count: count + agentNote,
    right: Math.round(pct) + "%",
    short: done ? STYLE_GLYPH.done + " " + trunc(bar.title, 14) : trunc(name, 16) + " " + count,
    stage: w.finished,
    animating: !done,
    strips: visibleStrips(s, bar.id, bar.agentsDoneAt, show, now),
  };
}

export function activityRow(s: DeckState, show: Show, now: number, locale: Locale): DeckRow | null {
  const act = s.activity;
  if (!act || !show.plans) return null;
  if (act.done && act.doneAt && now - act.doneAt > ACTIVITY_LINGER_MS) return null;
  // a plain chat turn: worth a row while it thinks, not once it has answered
  if (act.done && act.tools === 0 && !agentsOf(s, "activity").length) return null;
  const planned = [...s.bars.values()].some((b) => b.id !== "agents" && !b.dismissed && b.startedAt >= act.start - 1000);
  if (planned) return null;
  const asking = !act.done && (s.waiting.has("main") || agentsOf(s, "activity").some((a) => a.state === "waiting"));
  const style: RowStyle = act.done ? "done" : asking ? "ask" : "run";
  const pct = act.done ? 100 : 95 * (1 - Math.exp(-act.tools / 18));
  const time = elapsed((act.done && act.doneAt ? act.doneAt : now) - act.start);
  const name = act.done ? text("deck.name.done", locale) : asking ? text("deck.name.needsYou", locale) : trunc(act.action, 28);
  const mine = agentsOf(s, "activity");
  const agentNote = mine.length ? text("deck.agentNote", locale, { done: mine.filter((a) => a.state === "done").length, total: mine.length }) : "";
  const tools = act.tools === 1 ? text("deck.unit.tool", locale) : text("deck.unit.tools", locale);
  return {
    id: "activity",
    kind: "activity",
    style,
    state: act.done ? "done" : asking ? "needs_input" : "running",
    title: act.title,
    pct,
    marks: [],
    steps: 0,
    finished: 0,
    name,
    count: act.tools + " " + tools + agentNote,
    strips: visibleStrips(s, "activity", act.agentsDoneAt, show, now),
    right: time,
    short: name + " · " + act.tools,
    stage: 0,
    animating: !act.done,
  };
}

// ---------- the rows the band shows ----------

export function sectionsOn(show: Show): Section[] {
  return SECTIONS.filter((x) => show[x]);
}

export function collectRows(s: DeckState, show: Show, now: number, locale: Locale): DeckRow[] {
  const rows: DeckRow[] = [];
  const rr = routeRow(s, show, locale);
  if (rr) rows.push(rr);
  for (const bar of s.bars.values()) {
    if (bar.dismissed) continue;
    if (bar.id === "agents" ? !show.agents : !show.plans) continue;
    if (bar.id === "agents" && !agentsOf(s, bar.id).length) continue;
    if (!allSteps(bar).length) continue;
    const linger = bar.id === "agents" ? AGENTS_LINGER_MS : BAR_LINGER_MS;
    if (barState(s, bar) === "done" && bar.doneAt && now - bar.doneAt > linger) continue;
    rows.push(barRow(s, bar, show, now, locale));
  }
  const act = activityRow(s, show, now, locale);
  if (act) rows.push(act);
  const ctx = s.usage.context;
  if (show.context && ctx && ctx.percent != null) {
    const p = ctx.percent;
    rows.push({
      id: "context",
      kind: "meter",
      style: p >= 80 ? "hot" : p >= 60 ? "warn" : "run",
      title: text("deck.title.context", locale),
      pct: p,
      marks: [{ f: 0.5 }, { f: 0.8 }],
      right: Math.round(p) + "%",
      short: text("deck.context.short", locale) + " " + Math.round(p) + "%",
      strips: null,
      name: fmtK(ctx.tokens) + " / " + fmtK(ctx.window),
      count: "",
      section: "context",
      hist: series(s, "context", 3600_000, now),
      rate: burnRate(s, "context", now, locale),
    });
  }
  if (show.limits) {
    for (const rl of s.usage.rateLimits) {
      const [title, tag] = limitName(rl.kind, locale);
      const p = rl.percentUsed;
      const resets = rl.resetsAt ? humanReset(rl.resetsAt, now) : "";
      rows.push({
        id: "limit:" + rl.kind,
        kind: "meter",
        style: p >= 80 ? "hot" : p >= 50 ? "warn" : "ok",
        title,
        pct: Math.min(100, p),
        marks: [{ f: 0.25 }, { f: 0.5 }, { f: 0.75 }],
        right: rl.resetsAt ? "↻ " + countdown(rl.resetsAt, now) : "",
        short: tag + " " + Math.round(p) + "%" + (rl.resetsAt ? " ↻" + resets : ""),
        strips: null,
        name: text("deck.limit.used", locale, { tag, percent: Math.round(p) }),
        count: "",
        limit: true,
        section: "limits",
        kindKey: rl.kind,
        resets,
        hist: series(s, rl.kind, rl.kind.startsWith("seven_day") ? 24 * 3600_000 : 3600_000, now),
        rate: burnRate(s, rl.kind, now, locale),
      });
    }
  }
  return rows;
}
