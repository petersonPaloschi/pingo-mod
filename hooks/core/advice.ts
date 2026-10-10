// The local decision for the controlled advisor: whether one prompt gets bounded planning guidance,
// and which advisor profile gives it. Used when Jev is not asked the guidance question (orchestration
// off, Jev unavailable or failed); the profile always comes from the advisor role's offer, so a
// trusted override, a fixed model or effort and the AUTO allowlist win over the tier's preference.
// Pure and cheap: a few regular expressions over the prompt, no model call.
import { CLAUDE_MODEL, CLAUDE_MODELS, EFFORT, EFFORTS, type ClaudeModelId, type Effort } from "./contracts.ts";
import { offeredProfiles, type Capabilities, type OrchestrationPolicy, type Profile } from "./orchestration.ts";

/** The score from which a prompt gets guidance in AUTO. */
export const ADVICE_ON_SCORE = 4;

export type AdviceTier = "simple" | "complex" | "hard" | "exceptional";
export type AdviceWhy = "simple" | "chitchat" | "complex" | "forced_on" | "forced_off" | "no_allowance" | "no_profile";
export type AdviceSignal =
  | "long" | "very_long" | "steps" | "code" | "files" | "many_files" | "design" | "diagnosis" | "risk" | "build" | "attachments"
  | "short" | "question";

/** Each tier's starting advisor profile (plan §3), from the strongest down; below them, no guidance. */
const TIERS: readonly { tier: AdviceTier; min: number; target: Profile }[] = [
  { tier: "exceptional", min: 9, target: { model: CLAUDE_MODEL.FABLE.id, effort: EFFORT.HIGH } },
  { tier: "hard", min: 6, target: { model: CLAUDE_MODEL.OPUS.id, effort: EFFORT.HIGH } },
  { tier: "complex", min: ADVICE_ON_SCORE, target: { model: CLAUDE_MODEL.SONNET.id, effort: EFFORT.HIGH } },
];

const WEIGHT: Readonly<Record<AdviceSignal, number>> = {
  long: 1, very_long: 1, steps: 1, code: 1, files: 1, many_files: 1,
  design: 2, diagnosis: 2, risk: 1, build: 1, attachments: 1,
  short: -3, question: -2,
};

const CHITCHAT = /^(?:(?:oi|ol[aá]|hi|hello|hey|ok(?:ay)?|valeu|obrigad[oa]|thanks|thank you|sim|yes|n[aã]o|no|continu[ea]|go on|segue|seguir|pode|beleza|blz|perfeito|great|nice)(?![\p{L}\d])[\s!.?,]*){1,4}$/iu;
const QUESTION = /^(?:o que|o qu[eê]|what|como|how|qual|quais|which|onde|where|quando|when|quem|who)\b/i;
const DESIGN = /arquitetur|architect|refator|refactor|migr[ae]|redesenh|redesign|trade-?off|abordagem|approach|estrat[eé]gi|strateg|decid|decision|desenho d|design (?:the|a|do|da|de)/i;
const DIAGNOSIS = /flaky|intermitent|race condition|condi[cç][aã]o de corrida|deadlock|vazamento|memory leak|causa raiz|root cause|ainda falha|still fail|regress|n[aã]o reproduz|can'?t reproduce|por que .{0,40}(?:falha|quebra|trava)|why .{0,40}(?:fail|break|hang)/i;
const RISK = /produ[cç][aã]o|production|seguran[cç]a|security|migra[cç][aã]o de dados|data migration|concorr[eê]ncia|concurren|desempenho|performance|breaking change|retrocompat|backward compat/i;
const BUILD = /\b(?:implement|implemente|crie|criar|construa|build|adicione|add|integr[ae]|integrate|substitua|replace|reescrev|rewrite)/i;
const CODE = /```|\bTraceback\b|\bat [\w.$<>]+ \(?[\w./\\-]+:\d+|\b\w*(?:Error|Exception):/;
const FILE = /(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:tsx?|jsx?|mjs|py|go|rs|java|kt|rb|cs|cpp|c|h|md|json|ya?ml|toml|css|html|sql|sh)\b/g;

/** What a prompt shows, as signal codes; the sum of their weights is its score. */
export function adviceSignals(text: string, attachments = 0): AdviceSignal[] {
  const body = text.trim();
  const words = body ? body.split(/\s+/).length : 0;
  const signals: AdviceSignal[] = [];
  const code = CODE.test(body);
  if (words >= 40) signals.push("long");
  if (words >= 120) signals.push("very_long");
  if (body.split("\n").filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)).length >= 3) signals.push("steps");
  if (code) signals.push("code");
  const files = new Set(body.match(FILE) ?? []);
  if (files.size >= 2) signals.push("files");
  if (files.size >= 5) signals.push("many_files");
  if (DESIGN.test(body)) signals.push("design");
  if (DIAGNOSIS.test(body)) signals.push("diagnosis");
  if (RISK.test(body)) signals.push("risk");
  if (BUILD.test(body)) signals.push("build");
  if (attachments > 0) signals.push("attachments");
  if (words <= 6 && !code) signals.push("short");
  if (QUESTION.test(body) && body.endsWith("?") && words < 25) signals.push("question");
  return signals;
}

export interface AdviceDecision {
  on: boolean;
  why: AdviceWhy;
  score: number;
  tier: AdviceTier;
  signals: readonly AdviceSignal[];
  /** The advisor profile guidance is given with, when on. */
  profile?: Profile;
  /** Where that profile came from: the advisor role's override, its fixed values, or its AUTO allowlist. */
  source?: "override" | "fixed" | "auto";
}

const rank = (model: ClaudeModelId) => CLAUDE_MODELS.indexOf(model);
const level = (effort: Effort) => EFFORTS.indexOf(effort);

/**
 * The offered profile nearest the tier's target: the least costly one at least as strong as the
 * target model, its effort closest to the target's (the lower on a tie); with none that strong, the
 * strongest offered, its effort closest to the target's (the higher on a tie).
 */
export function nearestProfile(offered: readonly Profile[], target: Profile): Profile | undefined {
  const strong = offered.filter((p) => rank(p.model) >= rank(target.model));
  const pool = strong.length ? strong : offered;
  const way = strong.length ? 1 : -1;
  return [...pool].sort((a, b) =>
    way * (rank(a.model) - rank(b.model))
    || Math.abs(level(a.effort) - level(target.effort)) - Math.abs(level(b.effort) - level(target.effort))
    || way * (level(a.effort) - level(b.effort)))[0];
}

/**
 * Whether this prompt gets guidance, and from which profile. `advice` "off" never and "on" always
 * (the user's fixed choice wins over the score); AUTO from ADVICE_ON_SCORE. `used` counts the
 * guidance already given under `limits.adviceCalls`.
 */
export function decideAdvice(
  input: { text: string; attachments?: number; used?: number },
  policy: OrchestrationPolicy,
  caps: Capabilities = {},
): AdviceDecision {
  const signals = adviceSignals(input.text, input.attachments ?? 0);
  const score = signals.reduce((sum, signal) => sum + WEIGHT[signal], 0);
  const tiered = TIERS.find((tier) => score >= tier.min);
  const tier: AdviceTier = tiered?.tier ?? "simple";
  const base = { score, tier, signals };
  if (policy.advice === "off") return { ...base, on: false, why: "forced_off" };
  const forced = policy.advice === "on";
  if (!forced && CHITCHAT.test(input.text.trim())) return { ...base, on: false, why: "chitchat" };
  if (!forced && !tiered) return { ...base, on: false, why: "simple" };
  if ((input.used ?? 0) >= policy.limits.adviceCalls) return { ...base, on: false, why: "no_allowance" };
  const offer = offeredProfiles(policy, "advisor", caps);
  const profile = nearestProfile(Object.values(offer.profiles), (tiered ?? TIERS[TIERS.length - 1]!).target);
  if (!profile) return { ...base, on: false, why: "no_profile" };
  return { ...base, on: true, why: forced ? "forced_on" : "complex", profile, source: offer.source };
}
