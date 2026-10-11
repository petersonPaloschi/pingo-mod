import { CLAUDE_MODEL, EFFORT } from "../../core/contracts.ts";
import { text, type Locale, type LocaleKey } from "../../i18n.ts";
import { type StepStatus, type Step, type Stage, type DeckState, type DeckRow } from "./types.ts";
import { finishAgent } from "./state.ts";
import { isFinished, allSteps, newBar, placeBar, stepOn } from "./bars.ts";


// ---------- demo and sample fixtures ----------

export const DEMO_ROUTE_HIST = [CLAUDE_MODEL.HAIKU.name, CLAUDE_MODEL.OPUS.name, CLAUDE_MODEL.SONNET.name, CLAUDE_MODEL.HAIKU.name, CLAUDE_MODEL.HAIKU.name, CLAUDE_MODEL.OPUS.name];

export function demoStages(locale: Locale): Stage[] {
  const st = (key: LocaleKey, status: StepStatus = "pending"): Step => ({ title: text(key, locale), status });
  return [
    { name: text("deck.demo.stage.analysis", locale), steps: [st("deck.demo.step.readModules", "done"), st("deck.demo.step.findDeps", "done"), st("deck.demo.step.listChanges", "active")] },
    { name: text("deck.demo.stage.migration", locale), steps: [st("deck.demo.step.tableSchema"), st("deck.demo.step.createMigration"), st("deck.demo.step.moveData"), st("deck.demo.step.indexes")] },
    { name: text("deck.demo.stage.api", locale), steps: [st("deck.demo.step.endpoints"), st("deck.demo.step.validation"), st("deck.demo.step.accessRules")] },
    { name: text("deck.demo.stage.verify", locale), steps: [st("deck.demo.step.tests"), st("deck.demo.step.build")] },
  ];
}

// /deck demo: the plan, two agents, and sample route and limits until real ones arrive
export function startDemo(s: DeckState, now: number, locale: Locale): void {
  for (const a of [...s.agents.values()]) if (a.home === "demo") s.agents.delete(a.id);
  placeBar(s, newBar("demo", text("deck.demo.plan", locale), "demo", demoStages(locale), now));
  if (!s.route) {
    s.route = { noAnswer: false, tier: "fast", conf: 0.89, model: "", effort: EFFORT.MEDIUM, unchanged: true, effortScore: null, risky: 0.02, ms: 249, at: now };
    s.routeHist.splice(0, s.routeHist.length, ...DEMO_ROUTE_HIST);
    s.demoRoute = true;
  }
  if (!s.usage.rateLimits.length) {
    s.usage = {
      context: s.usage.context ?? { tokens: 124_000, window: 1_000_000, percent: 12 },
      rateLimits: [
        { kind: "five_hour", percentUsed: 31, resetsAt: new Date(now + (2 * 60 + 14) * 60_000).toISOString() },
        { kind: "seven_day", percentUsed: 64, resetsAt: new Date(now + (3 * 24 + 5) * 3_600_000).toISOString() },
      ],
    };
    s.demoUsage = true;
  }
  const base = { startedAt: now, endedAt: null, depth: 0, home: "demo", todo: null };
  s.agents.set("demo-a1", { ...base, id: "demo-a1", title: text("deck.demo.agent.mapTables", locale), state: "running", tool: "Grep", model: CLAUDE_MODEL.HAIKU.name });
  s.agents.set("demo-a2", { ...base, id: "demo-a2", title: text("deck.demo.agent.draftMigration", locale), state: "running", tool: "Read", model: CLAUDE_MODEL.SONNET.name });
  s.turnActive = true;
}

// one tick of the demo; false when the demo has finished or its bar is gone
export function demoTick(s: DeckState, n: number, now: number, locale: Locale): boolean {
  const d = s.bars.get("demo");
  if (!d) return false;
  const a1 = s.agents.get("demo-a1");
  const a2 = s.agents.get("demo-a2");
  if (n === 2 && a1) a1.tool = "Read";
  if (n === 3) finishAgent(s, "demo-a1", "done", now, locale);
  if (n === 5 && a2) {
    a2.state = "waiting";
    d.explicit = "needs_input";
  }
  if (n === 8 && a2) {
    a2.state = "running";
    a2.tool = "Write";
    d.explicit = null;
  }
  if (n === 10) finishAgent(s, "demo-a2", "done", now, locale);
  if (d.explicit !== "needs_input") d.stages = stepOn(d.stages);
  if (allSteps(d).every((st) => isFinished(st.status))) {
    s.turnActive = false;
    return false;
  }
  return true;
}

export function sampleRow(locale: Locale): DeckRow {
  return {
    id: "sample",
    kind: "bar",
    style: "run",
    state: "running",
    title: text("deck.sample.title", locale),
    pct: 52,
    marks: [0.2, 0.4, 0.6, 0.8].map((f, i) => ({ f, stage: i === 1 })),
    steps: 5,
    finished: 2,
    name: text("deck.sample.name", locale),
    count: "3/5",
    right: "52%",
    short: text("deck.sample.name", locale) + " 3/5",
    strips: null,
    animating: true,
  };
}
