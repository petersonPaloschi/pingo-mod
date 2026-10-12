import { CLAUDE_MODELS, MODEL_HANDLE, ROLES, type ClaudeModelId, type Effort } from "../contracts.ts";
import { defaultPolicy, editPolicy, isEffort, type Limits, type OrchestrationPolicy, type TaskOverride } from "./policy.ts";

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
      if (!role) return fail("role <executor|subagent|advisor> model|effort ...");
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
          return list.every(Boolean) ? edit((p) => { p.roles[role].model.fallback = list as ClaudeModelId[]; }) : fail("fallback <models,...|none>");
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
          return list.every(isEffort) ? edit((p) => { p.roles[role].effort.fallback = list as Effort[]; }) : fail("fallback <efforts,...|none>");
        }
        return fail("effort auto|fixed <level>|allow <level>|fallback <levels|none>");
      }
      return fail("role <role> model|effort ...");
    }
    default:
      return fail("unknown orchestration command");
  }
}
