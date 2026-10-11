import type { Locale } from "../../i18n.ts";
import { shortModel, stripTool, type Agent, type DeckRow } from "../model.ts";
import type { DeckSize, DeckSurfaceStyle } from "../settings.ts";
import { MUTED, SVG_TEXT, TIER, textCells, type AgentRow, type Row, type TierName } from "../theme.ts";
import type { LastHead, LastStrip } from "../styles-desktop.ts";

export type Cell = ReturnType<typeof textCells>[number];

// a model's tier color, for a desktop SVG or a terminal cell; a model with no tier is muted
export function tierColor(model: string, desktop = true): string {
  const t = TIER[shortModel(model) as TierName];
  return t ? (desktop ? t.desk : t.term) : desktop ? SVG_TEXT.muted : MUTED;
}

// the history a row keeps between redraws, so a moving strip or track does not restart
export type DrawCaches = { head: LastHead; strip: Map<string, LastStrip> };

// a row as the track styles read it
export function toTrackRow(row: DeckRow): Row {
  return {
    id: row.id,
    name: row.name ?? "",
    count: row.count,
    rate: row.rate,
    style: row.style,
    pct: row.pct,
    marks: row.marks,
    animating: row.animating,
    steps: row.steps,
    finished: row.finished,
    hist: row.hist,
  };
}

// an agent as the strip styles read it
export function toAgentRow(a: Agent): AgentRow {
  return {
    id: a.id,
    title: a.title,
    state: a.state,
    depth: a.depth,
    model: a.model || undefined,
    startedAt: a.startedAt,
    endedAt: a.endedAt ?? undefined,
  };
}

// a row's strips in the shape the strip styles take, with each agent's label from its state
export function stripsView(row: DeckRow, locale: Locale): { view: { shown: AgentRow[]; hidden: AgentRow[] }; label: (a: AgentRow) => string } | null {
  if (!row.strips) return null;
  const agents = new Map<string, Agent>([...row.strips.shown, ...row.strips.hidden].map((a) => [a.id, a]));
  return {
    view: { shown: row.strips.shown.map(toAgentRow), hidden: row.strips.hidden.map(toAgentRow) },
    label: (ar) => {
      const a = agents.get(ar.id);
      return a ? stripTool(a, locale) : ar.state;
    },
  };
}

export type RowDrawOptions = {
  style: DeckSurfaceStyle["desktop"];
  size: DeckSize;
  routeHist: readonly string[];
  locale: Locale;
  caches: DrawCaches;
  now: number;
};
