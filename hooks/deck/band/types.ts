import type { FeatureId } from "../../../types";
import { text, type Locale } from "../../i18n.ts";
import { type DeckRow, type Spend } from "../model.ts";
import { type CastMember } from "../cast.ts";
import { type Pet } from "../pet.ts";
import type { DeckSettings } from "../settings.ts";
import { type DrawCaches, type FeatureSwitch } from "../rows.ts";

export type Surface = "terminal" | "desktop";

/**
 * One on the lane with something to say or at work (a feature, Jev, Pingo for Claude's turn, a subagent): the line
 * under the lane shows it, and pressing it opens the whole. `id` is the feature's, "jev", "pingo" or the run's.
 */
export interface Speech {
  id: string;
  name: string;
  color: number;
  /** What it says, in one line; its pane shows all of it, with the choices. */
  text: string;
  open: () => void;
}

export type DeckBand = {
  rows: readonly DeckRow[];
  settings: DeckSettings;
  expanded: boolean;
  locale: Locale;
  /** The band's width in columns. */
  cols: number;
  now: number;
  caches: DrawCaches;
  routeHist: readonly string[];
  spend: Spend;
  /** The clock and weather text, drawn at the end of the line. */
  extras: readonly string[];
  pet: Pet;
  /** Who stands with the pet on its lane, each named above it: Jev, then the subagents at work. Pingo alone when absent. */
  cast?: readonly CastMember[];
  /** The features with something to say, the one speaking first: one line under the lane. */
  speech?: readonly Speech[];
  toggle: () => void;
  /** Rows drawn so far while the band unfolds; every row when absent. */
  shown?: number;
  /** Ms since an opening fold began, or null: each desktop row fades in from its own age. Null while closing. */
  foldAge: number | null;
  /** Terminal lines the band may fill, the pet lane included; 14 when absent. */
  maxRows?: number;
  /** Dismisses one expanded row: the ✕ beside it calls this with the row. */
  dismiss: (row: DeckRow) => void;
  /** Every feature's switch, in the dashboard's order, drawn under the expanded band's header. */
  features: readonly FeatureSwitch[];
  /** Turns one feature on or off through the dashboard's own path, so both always show the same state. */
  feature: (id: FeatureId, on: boolean) => void;
  /** Drawn in the Deck pane: the expanded look even before any row, so the switches stay in reach. */
  pane?: boolean;
};
