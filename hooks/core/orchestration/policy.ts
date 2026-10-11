import { CLAUDE_MODEL, CLAUDE_MODELS, EFFORT, EFFORTS as PROFILE_EFFORTS, ROLES, type ClaudeModelId, type Effort, type Role } from "../contracts.ts";
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