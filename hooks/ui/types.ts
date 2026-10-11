import type { ElementTable, RenderNode } from "claude-code";
import type { AgentRun, ChaveiroRule, OficinaCheck, FeatureFlags, FeatureId, FeaturePreferences, FeedEntry, JevTab, LiveNow, EnsaioRun, PortaoRun, QualityCycle, RumoGoal, RouteEvent, SetupDraft, TraceState, ComandanteFilter, ComandanteRecord } from "../../types";
import type { Locale, LocaleOption } from "../i18n.ts";
import type { DeckSettings } from "../deck/settings.ts";
import type { OrchestrationPolicy, Profile, WorkMode } from "../core/orchestration.ts";

export type Els = ElementTable<"terminal" | "desktop">;
/** What a card and a line need, which every site draws: a feature's pane and the band above the prompt too. */
export type Frame = Pick<ElementTable, "Box" | "Text">;

export interface DeckPanel {
  settings: DeckSettings;
  /** The band is expanded, or opening. */
  open: boolean;
  /** The words `/deck status` prints, and the version `/deck version` names. */
  status: string;
  version: string;
  /** The last reply to a control, with the command word that earned it. */
  note: { verb: string; text: string } | null;
  /** The city being typed. */
  draft: string;
}

export interface View {
  locale: Locale;
  localeOption: LocaleOption;
  events: readonly RouteEvent[];
  routing: boolean;
  tab: JevTab;
  range: number;
  setup: SetupDraft;
  features: FeatureFlags;
  preferences: FeaturePreferences;
  feed: readonly FeedEntry[];
  live: LiveNow;
  now: number;
  width: number;
  rows: number;
  surface: string;
  meta: string;
  agents: readonly AgentRun[];
  /** The observed record of each run, shown with Live and used by Models. */
  trace: TraceState;
  /**
   * The body's own scroll position: rows from the top on most tabs, log lines back from the newest
   * on a live log. Only read when `fixed`: the pane is drawn exactly as tall as its room, the header
   * stays put, and the mod scrolls the body itself (ui.scroll).
   */
  scroll: number;
  fixed: boolean;
  /** Where the key in use comes from, its last four characters, and the provider in use. */
  key: { source: string; tail: string; provider: string };
  /** The Deck tab's data, made only when that tab is open: the other tabs and the band never read Deck's state. */
  deck: DeckPanel | null;
  /** The orchestration policy and what it is doing; made only on the AI tab. */
  orchestration?: OrchestrationView;
  /** Code Quality's cycles and what it is doing; made only on its own tab. */
  quality?: QualityPanel;
  /** The Comandante's log of every session of the project and its filters; made only on its own tab. */
  comandante?: ComandantePanel;
  /** The autonomous agents' records; made only on their own tab. */
  autonomos?: AutonomosPanel;
}

/** What the Comandante tab shows: the decisions of every session, newest first, the filters, and who this session is. */
export interface ComandantePanel {
  log: readonly ComandanteRecord[];
  filter: ComandanteFilter;
  /** This session's id, so its own decisions read "this session". */
  me: string;
  /** Waiting for Jev's verdict now. */
  busy: boolean;
}

/** What the Quality tab shows: whether a cycle runs now, the files changed since the last one began, the cycles. */
export interface QualityPanel {
  running: boolean;
  /** Edited since the last cycle began: the next one reviews them first. */
  queued: readonly string[];
  /** Newest first. */
  cycles: readonly QualityCycle[];
}

/** Requested, applied and observed are kept apart: what the runtime did not report stays unknown. */
export interface OrchestrationView {
  policy: OrchestrationPolicy;
  /** The command being typed. */
  draft: string;
  objective?: {
    id: string;
    workMode: WorkMode;
    revision: number;
    requested?: Profile;
    why?: string;
    applied?: { model?: string; effort?: string };
    observed?: { model?: string; effort?: string };
    applyPending?: boolean;
  };
  batches: { id: string; approved: number; total: number; integration: string; verified: boolean; cancelled: boolean }[];
  /** The last command's reply. */
  message?: { ok: boolean; text: string };
}

export interface Actions {
  tab: (tab: JevTab) => void;
  range: (range: number) => void;
  routing: (on: boolean) => void;
  feature: (id: FeatureId, on: boolean) => void;
  preference: (key: keyof FeaturePreferences, value: FeaturePreferences[keyof FeaturePreferences]) => void;
  provider: (id: string) => void;
  locale: (value: LocaleOption) => void;
  validate: () => void;
  clear: () => void;
  /** Opens subagent #n's own live pane. */
  openAgent: (n: number) => void;
  closeAgent: (n: number) => void;
  /** Back to the Jev pane, on its Live tab. */
  jevLive: () => void;
  /** Takes a finished subagent off the Agents tab, or every finished one. */
  removeAgent: (n: number) => void;
  clearAgents: () => void;
  /** The key field: each change (drawn masked), Enter, and removing the saved key. */
  typeKey: (value: string) => void;
  submitKey: (value: string) => void;
  forgetKey: () => void;
  /** How far the body can scroll as drawn, and whether it counts from the newest line up. */
  layout: (max: number, fromEnd: boolean) => void;
  /** Runs one `/deck` command line, as it is typed after `/deck`; the reply shows in the Deck tab. */
  deck: (args: string) => void;
  /** Sets one surface's bar style, as the style picker does. */
  deckStyle: (surface: "terminal" | "desktop", name: string) => void;
  /** The city field: each change, and Enter. */
  deckType: (value: string) => void;
  deckCity: (value: string) => void;
  /** One orchestration settings command (core/orchestration.ts applyCommand, plus apply/end/cancel). */
  orchestration: (line: string) => void;
  /** The orchestration command field: each change, then Enter. */
  orchestrationType: (value: string) => void;
  orchestrationSubmit: (line: string) => void;
  /** Starts a Code Quality cycle now, over everything pending. */
  qualityRun: () => void;
  /** Changes the Comandante tab's filters: a session's id or "all", a decision or "all". */
  comandanteFilter: (change: Partial<ComandanteFilter>) => void;
  /** A button on the Autonomous tab: Enviar, Rejeitar, Liberar or Parar on one agent's record (a run's number, a rule's id). */
  autonomo: (agent: AutonomoId, verb: AutonomoVerb, key: number | string) => void;
}

export interface AutonomosPanel {
  portao: { runs: readonly PortaoRun[] };
  rumo: { goals: readonly RumoGoal[] };
  ensaio: { runs: readonly EnsaioRun[] };
  chaveiro: { rules: readonly ChaveiroRule[] };
  /** Oficina's checkups, and whether `claude doctor` runs now. */
  oficina: { checks: readonly OficinaCheck[]; running: boolean };
}

/** The autonomous agents, as the tab and its buttons name them. */
export type AutonomoId = "portao" | "rumo" | "ensaio" | "chaveiro" | "oficina";
/** What a button on the tab asks of one record: Enviar, Rejeitar, Portão's Liberar, Rumo's Parar; or of an agent's whole part, Limpar feitos (its key unused). */
export type AutonomoVerb = "send" | "reject" | "release" | "stop" | "clear";

export type AboveBlock = {
  id: string;
  name: string;
  /** Its mascot's color, for its name on the "+N" line. */
  color: number;
  /** Which block keeps its rows first when they are short: 0 first. */
  rank: number;
  lines: readonly RenderNode[];
  /** Opens its pane, where the whole of it is. */
  open: () => void;
};
