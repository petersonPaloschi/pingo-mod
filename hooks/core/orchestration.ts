// The versioned orchestration policy (`orchestration.v1`): the four exact Claude models, per-role
// AUTO/fixed model and effort settings, the profiles Jev may be offered, and the SystemOne questions
// that choose among them. Pure: register.tsx reads the store and talks to Jev and Claude.
import { CLAUDE_MODEL, CLAUDE_MODELS, EFFORT, EFFORTS as PROFILE_EFFORTS, EFFORT_TEXT_VALUES, MODEL_HANDLE, MODEL_TEXT_VALUES, ROLES, type ClaudeModelId, type Effort, type Role } from "./contracts.ts";
import { readChoice } from "./selection.ts";
import type { Answer, ChoiceQuestion, Json, Questions } from "./types.ts";
import { text, type Locale, type LocaleKey } from "../i18n.ts";

export { CLAUDE_MODELS, EFFORTS as PROFILE_EFFORTS, MODEL_HANDLE, MODEL_LABEL, ROLES, type ClaudeModelId, type Role } from "./contracts.ts";

export const ORCHESTRATION_STORE = "orchestration.v1";
export const OBJECTIVE_STORE = "orchestration.objective";
/**
 * Each session keeps its objective under a key of its own, so two sessions (in this project or another) never share
 * one objective or its advice count. With no session id the old shared key stands in.
 */
export const objectiveStoreKey = (sessionId?: string) => (sessionId ? `${OBJECTIVE_STORE}:${sessionId}` : OBJECTIVE_STORE);
/** Another session's objective that started longer ago than this is dropped when a session starts: an objective has no later clock than its start. */
export const OBJECTIVE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** Which native advisors each executor accepts (validate against the account before use). */
export const NATIVE_ADVISORS: Readonly<Record<ClaudeModelId, readonly ClaudeModelId[]>> = Object.freeze({
  [CLAUDE_MODEL.HAIKU.id]: CLAUDE_MODELS,
  [CLAUDE_MODEL.SONNET.id]: [CLAUDE_MODEL.SONNET.id, CLAUDE_MODEL.OPUS.id, CLAUDE_MODEL.FABLE.id],
  [CLAUDE_MODEL.OPUS.id]: [CLAUDE_MODEL.OPUS.id, CLAUDE_MODEL.FABLE.id],
  [CLAUDE_MODEL.FABLE.id]: [CLAUDE_MODEL.FABLE.id],
});

export const isClaudeModel = (value: unknown): value is ClaudeModelId => CLAUDE_MODELS.includes(value as ClaudeModelId);
export const isEffort = (value: unknown): value is Effort => PROFILE_EFFORTS.includes(value as Effort);

/**
 * The catalogue model a runtime ID names, provider prefixes and the 1M suffix aside; undefined for
 * anything else (an alias, another generation). Used to recheck what the runtime actually resolved.
 */
export function catalogueModel(id: string | undefined): ClaudeModelId | undefined {
  if (!id) return undefined;
  const tail = id.toLowerCase().slice(id.lastIndexOf("/") + 1)
    .replace(/^(?:[a-z0-9-]+\.)?anthropic\./, "")
    .replace(/\[1m\]$/, "")
    .replace(/(?:-v\d+(?::\d+)?|@\d{8})$/, "");
  return CLAUDE_MODELS.find((model) => model === tail);
}

export type Mode = "auto" | "fixed";

export interface ModelSetting {
  mode: Mode;
  /** AUTO's allowlist; never empty. */
  allowed: ClaudeModelId[];
  /** Fixed mode's one model. */
  fixed: ClaudeModelId;
  /** Ordered models tried when the fixed one is unavailable; empty = no fallback (the default). */
  fallback: ClaudeModelId[];
}

export interface EffortSetting {
  mode: Mode;
  allowed: Effort[];
  fixed: Effort;
  fallback: Effort[];
}

export interface RolePolicy {
  model: ModelSetting;
  effort: EffortSetting;
}

export interface Profile {
  model: ClaudeModelId;
  effort: Effort;
}

export interface Limits {
  /** Simultaneous executing workers. */
  workers: number;
  /** Simultaneous controlled reviews. */
  reviewers: number;
  /** Active delegated calls of any kind (workers + reviews). */
  activeCalls: number;
  /** Units one batch may hold. */
  units: number;
  /** Independent units (depending on no other) a batch must hold unless the user asked for /batch. */
  batchMinUnits: number;
  /** Optional controlled advice calls per objective. */
  adviceCalls: number;
  /** Repair rounds per unit. */
  repairRounds: number;
  /** Review passes per unit, the initial review included. */
  reviewPasses: number;
  /** Turns a worker may take. */
  workerTurns: number;
  /** One controlled call's time limit. */
  callTimeoutMs: number;
}

export interface TaskOverride {
  model?: ClaudeModelId;
  effort?: Effort;
}

export type NativeAdvisorMode = "off" | "fixed" | "auto";

export interface OrchestrationPolicy {
  version: 1;
  /** Bumped on every dashboard edit; objectives remember the revision they started under. */
  revision: number;
  /** The whole managed policy: off leaves every request native. */
  enabled: boolean;
  roles: Record<Role, RolePolicy>;
  limits: Limits;
  /** Independent review of delegated results. */
  review: boolean;
  /** The controlled advisor's optional guidance: decided per prompt (auto), always on, or off. */
  advice: "auto" | "on" | "off";
  batch: "auto" | "off";
  nativeAdvisor: { mode: NativeAdvisorMode; model: ClaudeModelId };
  /** A trusted override for the next objective, per role; kept until cleared. */
  override: Partial<Record<Role, TaskOverride>>;
  /** Optional refinements for one agent type's subagent profile. */
  agentTypes: Record<string, TaskOverride>;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  workers: 3,
  reviewers: 1,
  activeCalls: 4,
  units: 30,
  batchMinUnits: 5,
  adviceCalls: 3,
  repairRounds: 2,
  reviewPasses: 3,
  workerTurns: 25,
  callTimeoutMs: 120_000,
});

const LIMIT_RANGE: Record<keyof Limits, readonly [number, number]> = {
  workers: [1, 16],
  reviewers: [1, 8],
  activeCalls: [1, 24],
  units: [1, 200],
  batchMinUnits: [1, 200],
  adviceCalls: [0, 20],
  repairRounds: [0, 10],
  reviewPasses: [1, 10],
  workerTurns: [1, 200],
  callTimeoutMs: [10_000, 600_000],
};

const autoRole = (): RolePolicy => ({
  model: { mode: "auto", allowed: [...CLAUDE_MODELS], fixed: CLAUDE_MODEL.SONNET.id, fallback: [] },
  effort: { mode: "auto", allowed: [...PROFILE_EFFORTS], fixed: EFFORT.MEDIUM, fallback: [] },
});

/**
 * A fresh policy: every role AUTO over all four models and five efforts, review on, advice and
 * batch AUTO. `enabled` starts off until the user turns orchestration on.
 */
export function defaultPolicy(): OrchestrationPolicy {
  return {
    version: 1,
    revision: 0,
    enabled: false,
    roles: { executor: autoRole(), subagent: autoRole(), advisor: autoRole() },
    limits: { ...DEFAULT_LIMITS },
    review: true,
    advice: "auto",
    batch: "auto",
    nativeAdvisor: { mode: "off", model: CLAUDE_MODEL.OPUS.id },
    override: {},
    agentTypes: {},
  };
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const listOf = <T>(value: unknown, keep: (item: unknown) => item is T): T[] => (Array.isArray(value) ? [...new Set(value.filter(keep))] : []);
const modeOf = (value: unknown, fallback: Mode): Mode => (value === "auto" || value === "fixed" ? value : fallback);

function normalizeOverride(value: unknown): TaskOverride {
  const raw = record(value);
  return {
    ...(isClaudeModel(raw.model) ? { model: raw.model } : {}),
    ...(isEffort(raw.effort) ? { effort: raw.effort } : {}),
  };
}

function normalizeRole(value: unknown, base: RolePolicy): RolePolicy {
  const raw = record(value);
  const model = record(raw.model);
  const effort = record(raw.effort);
  const allowedModels = listOf(model.allowed, isClaudeModel);
  const allowedEfforts = listOf(effort.allowed, isEffort);
  return {
    model: {
      mode: modeOf(model.mode, base.model.mode),
      allowed: allowedModels.length ? CLAUDE_MODELS.filter((id) => allowedModels.includes(id)) : [...base.model.allowed],
      fixed: isClaudeModel(model.fixed) ? model.fixed : base.model.fixed,
      fallback: listOf(model.fallback, isClaudeModel),
    },
    effort: {
      mode: modeOf(effort.mode, base.effort.mode),
      allowed: allowedEfforts.length ? PROFILE_EFFORTS.filter((level) => allowedEfforts.includes(level)) : [...base.effort.allowed],
      fixed: isEffort(effort.fixed) ? effort.fixed : base.effort.fixed,
      fallback: listOf(effort.fallback, isEffort),
    },
  };
}

/** Read a stored record into a valid policy: unknown fields dropped, invalid values replaced by defaults. */
export function normalizePolicy(value: unknown): OrchestrationPolicy {
  const base = defaultPolicy();
  const raw = record(value);
  if (raw.version !== undefined && raw.version !== 1) return base;
  const limits = record(raw.limits);
  const native = record(raw.nativeAdvisor);
  const override = record(raw.override);
  const agentTypes = record(raw.agentTypes);
  return {
    version: 1,
    revision: typeof raw.revision === "number" && Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
    enabled: raw.enabled === true,
    roles: {
      executor: normalizeRole(record(raw.roles).executor, base.roles.executor),
      subagent: normalizeRole(record(raw.roles).subagent, base.roles.subagent),
      advisor: normalizeRole(record(raw.roles).advisor, base.roles.advisor),
    },
    limits: Object.fromEntries((Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]).map((key) => {
      const value = limits[key];
      const [min, max] = LIMIT_RANGE[key];
      return [key, typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : DEFAULT_LIMITS[key]];
    })) as unknown as Limits,
    review: raw.review !== false,
    advice: raw.advice === "off" || raw.advice === "on" ? raw.advice : "auto",
    batch: raw.batch === "off" ? "off" : "auto",
    nativeAdvisor: {
      mode: native.mode === "fixed" || native.mode === "auto" ? native.mode : "off",
      model: isClaudeModel(native.model) ? native.model : base.nativeAdvisor.model,
    },
    override: Object.fromEntries(ROLES.map((role) => [role, normalizeOverride(override[role])]).filter(([, value]) => Object.keys(value as object).length)),
    agentTypes: Object.fromEntries(Object.entries(agentTypes).slice(0, 40)
      .filter(([name]) => /^[\w:.-]{1,64}$/.test(name))
      .map(([name, value]) => [name, normalizeOverride(value)] as const)
      .filter(([, value]) => Object.keys(value).length)),
  };
}

/**
 * The policy on first read: a stored record as is, else a fresh one, off. Routing and the older
 * per-subagent planner (`features.agents`) are stored apart and keep working unchanged.
 */
export function migratePolicy(stored: unknown): OrchestrationPolicy {
  return stored === undefined ? defaultPolicy() : normalizePolicy(stored);
}

/** A dashboard edit: the change applied to a copy, normalized, its revision bumped. */
export function editPolicy(policy: OrchestrationPolicy, change: (draft: OrchestrationPolicy) => void): OrchestrationPolicy {
  const draft = JSON.parse(JSON.stringify(policy)) as OrchestrationPolicy;
  change(draft);
  const next = normalizePolicy(draft);
  return { ...next, revision: policy.revision + 1 };
}

// --- Profiles offered to Jev ---

export interface Capabilities {
  /** Catalogue models the runtime offers; undefined = not known, so all four stay possible. */
  available?: readonly ClaudeModelId[];
}

export type HoldReason = "fixed_model_unavailable" | "no_allowed_model" | "no_allowed_effort";

export interface Offer {
  /** Profile keys (`sonnet_high`) to the exact profile each stands for. */
  profiles: Record<string, Profile>;
  /** Why nothing could be offered. */
  held?: HoldReason;
  /** Where the offer came from, most binding first. */
  source: "override" | "fixed" | "auto";
}

export const profileKey = (profile: Profile) => `${MODEL_HANDLE[profile.model]}_${profile.effort}`;

function pickModels(setting: ModelSetting, available: (id: ClaudeModelId) => boolean, forced?: ClaudeModelId): { models: ClaudeModelId[]; held?: HoldReason } {
  if (forced) return available(forced) ? { models: [forced] } : { models: [], held: "fixed_model_unavailable" };
  if (setting.mode === "fixed") {
    if (available(setting.fixed)) return { models: [setting.fixed] };
    const fallback = setting.fallback.find(available);
    return fallback ? { models: [fallback] } : { models: [], held: "fixed_model_unavailable" };
  }
  const models = setting.allowed.filter(available);
  return models.length ? { models } : { models: [], held: "no_allowed_model" };
}

function pickEfforts(setting: EffortSetting, forced?: Effort): Effort[] {
  // All four catalogue models document the five levels; a runtime refusal is handled where it is sent.
  if (forced) return [forced];
  if (setting.mode === "fixed") return [setting.fixed];
  return setting.allowed;
}

/**
 * The complete model/effort profiles one role may use: a trusted override first, then fixed
 * dashboard values, then the AUTO allowlists, filtered by what the runtime offers. At most 20.
 */
export function offeredProfiles(policy: OrchestrationPolicy, role: Role, caps: Capabilities = {}, agentType?: string): Offer {
  const setting = policy.roles[role];
  const override: TaskOverride = { ...(role === "subagent" && agentType ? policy.agentTypes[agentType] : {}), ...policy.override[role] };
  const available = (id: ClaudeModelId) => !caps.available || caps.available.includes(id);
  const source: Offer["source"] = override.model || override.effort ? "override" : setting.model.mode === "fixed" || setting.effort.mode === "fixed" ? "fixed" : "auto";
  const { models, held } = pickModels(setting.model, available, override.model);
  if (held) return { profiles: {}, held, source };
  const efforts = pickEfforts(setting.effort, override.effort);
  if (!efforts.length) return { profiles: {}, held: "no_allowed_effort", source };
  const profiles: Record<string, Profile> = {};
  for (const model of models) for (const effort of efforts) profiles[profileKey({ model, effort })] = Object.freeze({ model, effort });
  return { profiles, source };
}

// --- SystemOne questions ---

export const CONTINUITY = ["continue", "revise", "new"] as const;
export const WORK_MODES = ["direct", "managed", "batch_candidate"] as const;
export const GUIDANCE = ["none", "plan", "recover"] as const;
export type Continuity = (typeof CONTINUITY)[number];
export type WorkMode = (typeof WORK_MODES)[number];
export type Guidance = (typeof GUIDANCE)[number];

const prompt = (key: LocaleKey, locale?: Locale) => text("orchestration.prompt.common", locale) + "\n\n" + text(key, locale, { ...MODEL_TEXT_VALUES, ...EFFORT_TEXT_VALUES });

const labelled = <T extends string>(keys: readonly T[]): Record<string, Json> => Object.fromEntries(keys.map((key) => [key, key]));

export const continuityQuestion = (locale?: Locale): ChoiceQuestion => ({
  type: "choice", instructions: prompt("orchestration.prompt.continuity", locale), criteria: labelled(CONTINUITY),
});

export const workModeQuestion = (locale?: Locale): ChoiceQuestion => ({
  type: "choice", instructions: prompt("orchestration.prompt.workMode", locale), criteria: labelled(WORK_MODES),
});

export const guidanceQuestion = (offered: readonly Guidance[], locale?: Locale): ChoiceQuestion => ({
  type: "choice", instructions: prompt("orchestration.prompt.guidance", locale), criteria: labelled(offered),
});

/** One role's profile question; `state.decisions[key]` must carry this decision's input. */
export function roleQuestion(key: string, unit: string, role: Role, profiles: Record<string, Profile>, locale?: Locale): ChoiceQuestion {
  return {
    type: "choice",
    instructions: prompt("orchestration.prompt.roleProfile", locale) + "\n\n" + text("orchestration.prompt.roleSuffix", locale, { key, unit, role }),
    criteria: Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, { model: profile.model, effort: profile.effort }])),
  };
}

/** Worker concurrency: decimal strings from 1 to the safe ceiling. */
export function concurrencyQuestion(ceiling: number, locale?: Locale): ChoiceQuestion {
  const options = Array.from({ length: Math.max(1, ceiling) }, (_, i) => String(i + 1));
  return { type: "choice", instructions: prompt("orchestration.prompt.concurrency", locale), criteria: labelled(options) };
}

/** Native advisor models for a resolved executor: the user's setting filtered by compatibility. */
export function nativeAdvisorOptions(policy: OrchestrationPolicy, executor: ClaudeModelId, caps: Capabilities = {}): ClaudeModelId[] {
  const compatible = NATIVE_ADVISORS[executor].filter((id) => !caps.available || caps.available.includes(id));
  if (policy.nativeAdvisor.mode === "off") return [];
  if (policy.nativeAdvisor.mode === "fixed") return compatible.includes(policy.nativeAdvisor.model) ? [policy.nativeAdvisor.model] : [];
  return compatible;
}

export function nativeAdvisorQuestion(options: readonly ClaudeModelId[], locale?: Locale): ChoiceQuestion {
  return {
    type: "choice",
    instructions: prompt("orchestration.prompt.nativeAdvisor", locale),
    criteria: Object.fromEntries(options.map((id) => [MODEL_HANDLE[id], { model: id }])),
  };
}

// --- Reading answers ---

export type ProfileRead =
  | { profile: Profile; key: string; confidence?: number; local?: true }
  | { held: Profile; key: string; confidence: number; needed: number }
  | { none: "unavailable" | HoldReason };

/**
 * A role's profile: the only offered one applied locally, else Jev's typed choice when it names an
 * offered key with enough confidence. Anything else (an invented key, a bad confidence) is refused.
 */
export function readProfile(offer: Offer, answer: Answer | undefined, minConfidence: number): ProfileRead {
  const keys = Object.keys(offer.profiles);
  if (offer.held || !keys.length) return { none: offer.held ?? "no_allowed_model" };
  if (keys.length === 1) return { profile: offer.profiles[keys[0]!]!, key: keys[0]!, local: true };
  const read = readChoice(answer, keys, minConfidence);
  if (read.chosen) return { profile: offer.profiles[read.chosen.value]!, key: read.chosen.value, confidence: read.chosen.confidence };
  if (read.held) return { held: offer.profiles[read.held.value]!, key: read.held.value, confidence: read.held.confidence, needed: read.held.needed };
  return { none: "unavailable" };
}

/** Whether a profile (an active one being retained, say) is still within the role's current offer. */
export const stillOffered = (offer: Offer, profile: Profile | undefined) =>
  Boolean(profile && Object.values(offer.profiles).some((p) => p.model === profile.model && p.effort === profile.effort));

/** Concurrency: Jev's offered integer, a single option locally, one when unsure. */
export function readConcurrency(answer: Answer | undefined, ceiling: number, minConfidence: number): { workers: number; confident: boolean } {
  if (ceiling <= 1) return { workers: 1, confident: true };
  const options = Array.from({ length: ceiling }, (_, i) => String(i + 1));
  const read = readChoice(answer, options, minConfidence);
  return read.chosen ? { workers: Number(read.chosen.value), confident: true } : { workers: 1, confident: false };
}

/** Output cap for a controlled review by effort, held to what one completion can return. */
export function reviewCap(effort: Effort): number {
  return effort === EFFORT.MAX ? 64_000 : effort === EFFORT.XHIGH ? 32_768 : effort === EFFORT.HIGH ? 16_384 : 8_192;
}

// --- Dashboard and /jev commands ---

const HANDLE_MODEL: Readonly<Record<string, ClaudeModelId>> = Object.freeze(Object.fromEntries(
  CLAUDE_MODELS.flatMap((id) => [[MODEL_HANDLE[id], id], [id, id]]),
));
const modelOf = (value: string | undefined) => (value ? HANDLE_MODEL[value.toLowerCase()] : undefined);
const roleOf = (value: string | undefined) => ROLES.find((role) => role === value);
const LIMIT_NAMES: Readonly<Record<string, keyof Limits>> = Object.freeze({
  workers: "workers", reviewers: "reviewers", calls: "activeCalls", units: "units", batchmin: "batchMinUnits", advice: "adviceCalls",
  repairs: "repairRounds", reviews: "reviewPasses", turns: "workerTurns", timeout: "callTimeoutMs",
});
export const LIMIT_KEYS = Object.keys(LIMIT_NAMES);

function overrideOf(model: string | undefined, effort: string | undefined): TaskOverride | string {
  const m = model === "-" || model === undefined ? undefined : modelOf(model);
  if (model !== "-" && model !== undefined && !m) return `unknown model ${model}`;
  if (effort !== undefined && effort !== "-" && !isEffort(effort)) return `unknown effort ${effort}`;
  return { ...(m ? { model: m } : {}), ...(effort && effort !== "-" ? { effort: effort as Effort } : {}) };
}

/**
 * One settings command, as the dashboard and `/jev orchestration` send it. Returns the edited
 * policy (revision bumped), or the error and the policy untouched. `apply` is not a policy edit.
 */
export function applyCommand(policy: OrchestrationPolicy, line: string): { policy: OrchestrationPolicy; error?: string } {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const [verb, a, b, c, d] = words;
  const fail = (error: string) => ({ policy, error });
  const edit = (change: (draft: OrchestrationPolicy) => void) => ({ policy: editPolicy(policy, change) });
  switch (verb) {
    case "on":
    case "off":
      return edit((p) => { p.enabled = verb === "on"; });
    case "reset":
      return edit((p) => { Object.assign(p, defaultPolicy(), { enabled: p.enabled }); });
    case "review":
      return a === "on" || a === "off" ? edit((p) => { p.review = a === "on"; }) : fail("review on|off");
    case "advice":
      return a === "auto" || a === "on" || a === "off" ? edit((p) => { p.advice = a; }) : fail("advice auto|on|off");
    case "batch":
      return a === "auto" || a === "off" ? edit((p) => { p.batch = a; }) : fail("batch auto|off");
    case "native": {
      if (a === "off" || a === "auto") return edit((p) => { p.nativeAdvisor.mode = a; });
      const model = modelOf(b);
      return a === "fixed" && model ? edit((p) => { p.nativeAdvisor = { mode: "fixed", model }; }) : fail("native off|auto|fixed <model>");
    }
    case "limit": {
      const key = a ? LIMIT_NAMES[a] : undefined;
      const value = Number(b);
      return key && b !== undefined && Number.isFinite(value) ? edit((p) => { p.limits[key] = value; }) : fail(`limit ${LIMIT_KEYS.join("|")} <n>`);
    }
    case "override": {
      if (a === "clear") return edit((p) => { p.override = {}; });
      const role = roleOf(a);
      if (!role) return fail("override <role> <model|-> [effort|-]");
      const value = overrideOf(b, c);
      if (typeof value === "string") return fail(value);
      return edit((p) => { if (Object.keys(value).length) p.override[role] = value; else delete p.override[role]; });
    }
    case "agent": {
      if (!a || !/^[\w:.-]{1,64}$/.test(a)) return fail("agent <type> <model|-> [effort|-]");
      const value = overrideOf(b, c);
      if (typeof value === "string") return fail(value);
      return edit((p) => { if (Object.keys(value).length) p.agentTypes[a] = value; else delete p.agentTypes[a]; });
    }
    case "role": {
      const role = roleOf(a);
      if (!role) return fail("role <executor|subagent|advisor> model|effort …");
      if (b === "model") {
        if (c === "auto") return edit((p) => { p.roles[role].model.mode = "auto"; });
        const model = modelOf(d);
        if (c === "fixed" && model) return edit((p) => { p.roles[role].model.mode = "fixed"; p.roles[role].model.fixed = model; });
        if (c === "allow" && model) {
          const allowed = policy.roles[role].model.allowed;
          const next = allowed.includes(model) ? allowed.filter((id) => id !== model) : [...allowed, model];
          // The allowlist is never empty: removing the last model is refused.
          return next.length ? edit((p) => { p.roles[role].model.allowed = next; }) : fail("at least one model must stay allowed");
        }
        if (c === "fallback") {
          const list = d === "none" || d === undefined ? [] : d.split(",").map(modelOf);
          return list.every(Boolean) ? edit((p) => { p.roles[role].model.fallback = list as ClaudeModelId[]; }) : fail("fallback <models,…|none>");
        }
        return fail("model auto|fixed <model>|allow <model>|fallback <models|none>");
      }
      if (b === "effort") {
        if (c === "auto") return edit((p) => { p.roles[role].effort.mode = "auto"; });
        if (c === "fixed" && isEffort(d)) return edit((p) => { p.roles[role].effort.mode = "fixed"; p.roles[role].effort.fixed = d; });
        if (c === "allow" && isEffort(d)) {
          const allowed = policy.roles[role].effort.allowed;
          const next = allowed.includes(d) ? allowed.filter((level) => level !== d) : [...allowed, d];
          return next.length ? edit((p) => { p.roles[role].effort.allowed = next; }) : fail("at least one effort must stay allowed");
        }
        if (c === "fallback") {
          const list = d === "none" || d === undefined ? [] : d.split(",");
          return list.every(isEffort) ? edit((p) => { p.roles[role].effort.fallback = list as Effort[]; }) : fail("fallback <efforts,…|none>");
        }
        return fail("effort auto|fixed <level>|allow <level>|fallback <levels|none>");
      }
      return fail("role <role> model|effort …");
    }
    default:
      return fail("unknown orchestration command");
  }
}
