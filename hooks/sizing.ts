// The effort one model request goes out with: the one rule turn.step applies to the main loop and
// to every subagent. Pure: register.tsx passes what Claude Code sent and what Jev planned.
import { supportsEffort, type Effort } from "./core/plan.ts";
import { modelName } from "./feed.ts";
import { text, type Locale } from "./i18n.ts";

/** `E`: the effort values Claude Code sends, kept as they are when Jev leaves a request alone. */
export interface EffortRequest<E> {
  /** The model the request goes out with, after any switch. */
  model: string;
  /** What Claude Code sent. */
  original: { model: string; effort: E | undefined };
  /** Jev's effort for this request, if it chose one. */
  planned?: Effort;
}

export interface EffortOutcome<E> {
  /** The effort to send; undefined sends none. */
  effort: E | Effort | undefined;
  /** What changed, for the request's log line; empty when the request goes out as sent. */
  changes: string[];
}

/**
 * Jev's effort where the model accepts it. Only a request Jev touched changes: one it planned an
 * effort for, or one whose model it replaced, which must not keep an effort the new model refuses.
 */
export function sizeEffort<E>({ model, original, planned }: EffortRequest<E>, locale: Locale): EffortOutcome<E> {
  const switched = model !== original.model;
  const own = typeof original.effort === "string" ? original.effort : undefined;
  const asSent: EffortOutcome<E> = { effort: original.effort, changes: [] };
  if (!supportsEffort(model)) {
    if (!planned && !switched) return asSent;
    const ignored = planned ?? own;
    return { effort: undefined, changes: ignored ? [text("feed.change.ignoredEffort", locale, { effort: ignored, model: modelName(model) })] : [] };
  }
  if (!planned) return asSent;
  // A request that carries no effort, on the model it was built for, is one the model sizes itself.
  if (own === undefined && !switched) return { ...asSent, changes: [text("feed.change.effortNotApplied", locale, { effort: planned })] };
  if (own === planned) return asSent;
  return {
    effort: planned,
    changes: [text("feed.change.effortSwitched", locale, { from: own ?? text("feed.change.effortDefault", locale), to: planned })],
  };
}
