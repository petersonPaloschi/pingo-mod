import type { RenderNode } from "claude-code";
import type { AgentProposal, ChaveiroRule, OficinaCheck, EnsaioRun, PortaoCheck, PortaoRun, RumoGoal } from "../../../types";
import { features } from "../../feed.ts";
import { formatClock, formatNumber, text, type LocaleKey } from "../../i18n.ts";
import { GLYPH, UI_DESIGN, UI_INK as INK } from "../../theme.ts";
import { portaoWaiting } from "../../core/portao.ts";
import { ensaioWaiting } from "../../core/ensaio.ts";
import type { Els, View, Actions, AutonomosPanel, AutonomoId } from "../types.ts";
import { toggleButton, card, stack, section, emptyLine } from "../shared.tsx";
import { DECISION_MARK, mascotColor } from "./shared.ts";

/** What the Autonomous tab shows: each autonomous agent's records, newest first. */


/** A Portão run that waits on nobody: checked, and its proposal sent, rejected or let through. Limpar feitos hides it. */
export const portaoSettled = (run: PortaoRun) => run.state !== "checking" && !(portaoWaiting(run) && (run.proposal?.state === "waiting" || run.proposal?.state === "blocked"));
/** A Rumo goal that waits on nobody and no longer works: met, impossible, out of turns, stopped or rejected. Limpar feitos removes it. */
export const rumoSettled = (goal: RumoGoal) => goal.state !== "proposed" && goal.state !== "blocked" && goal.state !== "active";

/** A feature's own color: its mascot's, or Jev's for one Jev speaks for (Rumo). */

/** How many records each agent's part of the tab lists, newest first. */
const AUTONOMO_SHOWN = 6;
/** How many findings or problems one record lists, and how many characters of the request a Rumo goal quotes. */
const AUTONOMO_LINES = 8;
const AUTONOMO_QUOTE_CHARS = 200;

/** A Portão run's state, as its card marks it: the glyph says it without color too. */
const PORTAO_MARK: Record<PortaoRun["state"], [glyph: string, color: string]> = {
  checking: [GLYPH.run, INK.brand],
  passed: [GLYPH.ok, INK.route],
  failed: [GLYPH.no, INK.fail],
  released: [GLYPH.released, INK.pass],
};
/** One check's state, as its line marks it. */
const CHECK_MARK: Record<PortaoCheck["state"], [glyph: string, color: string]> = {
  waiting: [GLYPH.off, INK.dim],
  running: [GLYPH.run, INK.brand],
  passed: [GLYPH.ok, INK.route],
  failed: [GLYPH.no, INK.fail],
  skipped: [GLYPH.idle, INK.dim],
};

/** A line with a colored mark before it: the mark carries the state, the words the rest. */
function markLine(els: Els, [glyph, color]: readonly [string, string], words: string, key?: string) {
  const { Text } = els;
  return <Text key={key} wrap="wrap"><Text bold color={color}>{`${glyph} `}</Text>{words}</Text>;
}

/**
 * The head of one agent's part of the tab: its name in its color, what it is doing now, and its switch. Every agent
 * keeps the hotkey its switch has on the AI screen.
 */
function autonomoHead(els: Els, view: View, act: Actions, id: AutonomoId, status: string, extra: RenderNode[] = []) {
  const { Box, Text } = els;
  const on = view.features[id];
  const name = text(`feature.${id}.name`, view.locale);
  const hotkey = features(view.locale).find((feature) => feature.id === id)?.hotkey;
  return card(els, name, [
    <Text color={INK.dim} wrap="wrap">{status}</Text>,
    <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
      {toggleButton(els, `feature-${id}`, on, name, () => act.feature(id, !on), hotkey)}
      {extra}
    </Box>,
  ], { width: view.width, rule: mascotColor(id) });
}

/**
 * What an agent proposes, under its record: the words (or `summary`, when they are long) tagged pending, the
 * Comandante's ruling when it gave one, and while it waits the person's Enviar and Rejeitar, then the agent's own
 * buttons. A proposal the Comandante blocked keeps Rejeitar only. Sent, one line tags it done, and says the
 * Comandante's approval sent it when `ruled` (a text taking its reason) is given; turned down, one dim line says so.
 */
function proposalBlock(els: Els, view: View, proposal: AgentProposal, key: string, act: { send: () => void; reject: () => void }, opts: { summary?: string; extra?: RenderNode[]; sent?: string; ruled?: LocaleKey } = {}) {
  const { Box, Text, Button } = els;
  const locale = view.locale;
  if (proposal.state === "sent") {
    const ruled = proposal.comandante?.decision === "approved" && opts.ruled
      ? text(opts.ruled, locale, { reason: text(`feature.comandante.reason.${proposal.comandante.reason}` as LocaleKey, locale) }) : undefined;
    return markLine(els, [GLYPH.ok, INK.route], `${text("feature.comandante.tag.done", locale)} · ${ruled ?? opts.sent ?? text("ui.autonomos.proposal.sent", locale)}`, `${key}-done`);
  }
  if (proposal.state === "rejected") return markLine(els, [GLYPH.no, INK.dim], text("ui.autonomos.proposal.rejected", locale), `${key}-done`);
  const ruling = proposal.comandante;
  return (
    <Box key={key} flexDirection="column">
      {markLine(els, [GLYPH.ask, INK.pass], `${text("feature.comandante.tag.pending", locale)} · ${opts.summary ?? proposal.text}`, `${key}-pending`)}
      {ruling ? markLine(els, DECISION_MARK[ruling.decision], `${text("feature.comandante.name", locale)}: ${text(`feature.comandante.decision.${ruling.decision}`, locale)} · ${text(`feature.comandante.reason.${ruling.reason}` as LocaleKey, locale)}`, `${key}-ruling`) : null}
      {proposal.state === "blocked" ? <Text color={INK.fail} wrap="wrap">{text("ui.autonomos.proposal.blocked", locale)}</Text> : null}
      <Box flexDirection="row" flexWrap="wrap" columnGap={UI_DESIGN.space.sm}>
        {proposal.state === "waiting" ? <Button key={`${key}-send`} label={text("ui.autonomos.send", locale)} variant="primary" onPress={act.send} /> : null}
        <Button key={`${key}-reject`} label={text("ui.autonomos.reject", locale)} role="dismiss" onPress={act.reject} />
        {opts.extra ?? []}
      </Box>
    </Box>
  );
}

/** Portão's part: its switch, then its runs, each with its checks, what failed, and the person's buttons. */
function portaoPart(els: Els, view: View, act: Actions, runs: readonly PortaoRun[]) {
  const { Button, Text } = els;
  const locale = view.locale;
  const latest = runs[0];
  const status = !view.features.portao ? "feature.portao.off"
    : latest?.state === "checking" ? "feature.portao.checking"
    : portaoWaiting(latest) && latest!.proposal?.state === "waiting" ? "feature.portao.waiting" : "feature.portao.idle";
  const release = (run: PortaoRun) => <Button key={`portao-${run.n}-release`} label={text("feature.portao.release", locale)} onPress={() => act.autonomo("portao", "release", run.n)} />;
  const runNode = (run: PortaoRun) => {
    const mark = PORTAO_MARK[run.state];
    const open = run.state !== "released" && run.proposal?.state !== "sent" && run.proposal?.state !== "rejected";
    return card(els, text("feature.portao.run", locale, { verb: `git ${run.verb}`, time: formatClock(run.at, locale) }), [
      ...run.checks.map((check) => markLine(els, CHECK_MARK[check.state], `${text(`feature.portao.check.${check.kind}`, locale)}${check.note ? ` ${GLYPH.leader} ${check.note}` : ""}`, `portao-${run.n}-${check.kind}`)),
      run.summary ? <Text wrap="wrap">{run.summary}</Text> : null,
      ...run.findings.slice(0, AUTONOMO_LINES).map((line, i) => markLine(els, [GLYPH.leader, INK.fail], line, `portao-${run.n}-finding-${i}`)),
      run.verified === undefined ? null : markLine(els, run.verified ? [GLYPH.ok, INK.route] : [GLYPH.ask, INK.pass], text(run.verified ? "ui.autonomos.verified" : "ui.autonomos.unverified", locale)),
      run.proposal && run.state !== "checking"
        ? proposalBlock(els, view, run.proposal, `portao-${run.n}`, { send: () => act.autonomo("portao", "send", run.n), reject: () => act.autonomo("portao", "reject", run.n) }, {
          summary: text(run.state === "passed" ? "feature.portao.proposal.passed" : "feature.portao.proposal.failed", locale, { command: run.command }),
          extra: open && run.state === "failed" ? [release(run)] : [],
          ruled: "feature.comandante.done.portao",
        })
        : null,
      run.state === "checking" ? release(run) : null,
    ], { width: view.width, rule: mark[1], glyph: mark[0], note: text(`feature.portao.state.${run.state}`, locale) });
  };
  // the runs Limpar feitos hid stay in the record, out of sight
  const shown = runs.filter((run) => !run.cleared);
  const clear = shown.some(portaoSettled) ? [<Button key="portao-clear" label={text("feature.comandante.clearDone", locale)} dimColor onPress={() => act.autonomo("portao", "clear", 0)} />] : [];
  return [
    autonomoHead(els, view, act, "portao", text(status, locale), clear),
    section(els, text("feature.portao.runs", locale)),
    shown.length ? stack(els, shown.slice(0, AUTONOMO_SHOWN).map(runNode)) : emptyLine(els, text("feature.portao.none", locale)),
  ];
}

/** A Rumo goal's state, as its card marks it. */
const RUMO_MARK_OF: Record<RumoGoal["state"], [glyph: string, color: string]> = {
  proposed: [GLYPH.ask, INK.pass],
  blocked: [GLYPH.no, INK.fail],
  active: [GLYPH.run, INK.brand],
  met: [GLYPH.ok, INK.route],
  impossible: [GLYPH.no, INK.fail],
  limit: [GLYPH.warn, INK.pass],
  stopped: [GLYPH.off, INK.dim],
  rejected: [GLYPH.no, INK.dim],
};

/** Rumo's part: its switch, then its goals, the current one first, with Enviar and Rejeitar while one waits, Parar while one works. */
function rumoPart(els: Els, view: View, act: Actions, goals: readonly RumoGoal[]) {
  const { Button, Text } = els;
  const locale = view.locale;
  const current = goals[0];
  const status = !view.features.rumo ? text("feature.rumo.off", locale)
    : current?.state === "active" ? text("feature.rumo.active", locale, { condition: current.condition })
    : current?.state === "proposed" || current?.state === "blocked" ? text("feature.rumo.waiting", locale) : text("feature.rumo.idle", locale);
  const goalNode = (goal: RumoGoal) => {
    const mark = RUMO_MARK_OF[goal.state];
    const waiting = goal.state === "proposed" || goal.state === "blocked";
    return card(els, text("feature.rumo.goal", locale, { time: formatClock(goal.at, locale) }), [
      <Text wrap="wrap" bold>{goal.condition}</Text>,
      <Text color={INK.faint} wrap="wrap">{text("feature.rumo.request", locale, { request: goal.request.replace(/\s+/g, " ").slice(0, AUTONOMO_QUOTE_CHARS) })}</Text>,
      markLine(els, [GLYPH.leader, INK.dim], text("feature.rumo.turns", locale, { used: formatNumber(goal.turnsUsed, locale), max: formatNumber(goal.turnsMax, locale) }), `rumo-${goal.id}-turns`),
      goal.objective ? <Text color={INK.faint} wrap="wrap">{text("feature.rumo.objective", locale, { objective: goal.objective })}</Text> : null,
      goal.why ? <Text color={INK.dim} wrap="wrap">{goal.why}</Text> : null,
      waiting
        ? proposalBlock(els, view, { text: goal.condition, state: goal.state === "blocked" ? "blocked" : "waiting", ...(goal.comandante ? { comandante: goal.comandante } : {}) }, `rumo-${goal.id}`,
          { send: () => act.autonomo("rumo", "send", goal.id), reject: () => act.autonomo("rumo", "reject", goal.id) },
          { summary: text("feature.rumo.proposal", locale, { turns: formatNumber(goal.turnsMax, locale) }) })
        : null,
      // a goal the Comandante approved was started by it: no Enviar was waited for
      !waiting && goal.comandante?.decision === "approved"
        ? markLine(els, [GLYPH.ok, INK.route], `${text("feature.comandante.tag.done", locale)} · ${text("feature.comandante.done.rumo", locale, { reason: text(`feature.comandante.reason.${goal.comandante.reason}` as LocaleKey, locale) })}`, `rumo-${goal.id}-ruled`)
        : null,
      goal.state === "active" ? <Button key={`rumo-${goal.id}-stop`} label={text("feature.rumo.stop", locale)} role="dismiss" onPress={() => act.autonomo("rumo", "stop", goal.id)} /> : null,
    ], { width: view.width, rule: mark[1], glyph: mark[0], note: text(`feature.rumo.state.${goal.state}`, locale) });
  };
  const clear = goals.some(rumoSettled) ? [<Button key="rumo-clear" label={text("feature.comandante.clearDone", locale)} dimColor onPress={() => act.autonomo("rumo", "clear", "")} />] : [];
  return [
    autonomoHead(els, view, act, "rumo", status, clear),
    section(els, text("feature.rumo.goals", locale)),
    goals.length ? stack(els, goals.slice(0, AUTONOMO_SHOWN).map(goalNode)) : emptyLine(els, text("feature.rumo.none", locale)),
  ];
}

/** An Ensaio run's outcome, as its card marks it. */
function ensaioMark(run: EnsaioRun): [glyph: string, color: string] {
  if (run.state === "running") return [GLYPH.run, INK.brand];
  if (run.state === "skipped") return [GLYPH.idle, INK.dim];
  if (run.state === "failed" || run.verdict === "broken") return [GLYPH.no, INK.fail];
  if (run.verdict === "works") return [GLYPH.ok, INK.route];
  return [GLYPH.ask, INK.pass];
}

/** Ensaio's part: its switch, then its runs, each with what it ran, what it saw and its request while one waits. */
function ensaioPart(els: Els, view: View, act: Actions, runs: readonly EnsaioRun[]) {
  const { Text } = els;
  const locale = view.locale;
  const latest = runs[0];
  const status = !view.features.ensaio ? "feature.ensaio.off"
    : latest?.state === "running" ? "feature.ensaio.running"
    : latest && ensaioWaiting(latest) ? "feature.ensaio.waiting" : "feature.ensaio.idle";
  const runNode = (run: EnsaioRun) => {
    const mark = ensaioMark(run);
    const outcome = run.state === "running" || run.state === "skipped" || run.state === "failed" ? `feature.ensaio.state.${run.state}` as const : `feature.ensaio.verdict.${run.verdict ?? "not_run"}` as const;
    return card(els, text("feature.ensaio.run", locale, { time: formatClock(run.at, locale) }), [
      <Text color={INK.faint} wrap="wrap">{text("feature.ensaio.files", locale, { files: run.files.join(", ") })}</Text>,
      run.summary ? <Text wrap="wrap">{run.summary}</Text> : null,
      run.note ? <Text color={INK.dim} wrap="wrap">{run.note}</Text> : null,
      ...run.problems.slice(0, AUTONOMO_LINES).map((one, i) => markLine(els, [GLYPH.leader, INK.fail], one.where ? `${one.where} — ${one.text}` : one.text, `ensaio-${run.n}-problem-${i}`)),
      run.verified === undefined ? null : markLine(els, run.verified ? [GLYPH.ok, INK.route] : [GLYPH.ask, INK.pass], text(run.verified ? "ui.autonomos.verified" : "ui.autonomos.unverified", locale)),
      run.proposal
        ? proposalBlock(els, view, run.proposal, `ensaio-${run.n}`, { send: () => act.autonomo("ensaio", "send", run.n), reject: () => act.autonomo("ensaio", "reject", run.n) },
          { summary: text(run.proposal.kind === "runbook" ? "feature.ensaio.proposal.runbook" : "feature.ensaio.proposal.fix", locale), ruled: "feature.comandante.done.ensaio" })
        : null,
    ], { width: view.width, rule: mark[1], glyph: mark[0], note: text(outcome, locale) });
  };
  return [
    autonomoHead(els, view, act, "ensaio", text(status, locale)),
    section(els, text("feature.ensaio.runs", locale)),
    runs.length ? stack(els, runs.slice(0, AUTONOMO_SHOWN).map(runNode)) : emptyLine(els, text("feature.ensaio.none", locale)),
  ];
}

/** Chaveiro's part: its switch, then the rules it proposed, each with the call it saw approved and the file it goes to. */
function chaveiroPart(els: Els, view: View, act: Actions, rules: readonly ChaveiroRule[]) {
  const { Text } = els;
  const locale = view.locale;
  const latest = rules[0];
  const status = !view.features.chaveiro ? "feature.chaveiro.off"
    : latest && (latest.proposal.state === "waiting" || latest.proposal.state === "blocked") ? "feature.chaveiro.waiting" : "feature.chaveiro.idle";
  const ruleNode = (rule: ChaveiroRule) => {
    const mark: [string, string] = rule.proposal.state === "sent" ? [GLYPH.ok, INK.route] : rule.proposal.state === "waiting" ? [GLYPH.ask, INK.pass] : [GLYPH.no, rule.proposal.state === "blocked" ? INK.fail : INK.dim];
    return card(els, text("feature.chaveiro.rule", locale, { time: formatClock(rule.at, locale) }), [
      <Text wrap="wrap" bold>{rule.rule}</Text>,
      <Text color={INK.faint} wrap="wrap">{text("feature.chaveiro.sample", locale, { call: rule.sample, count: formatNumber(rule.count, locale) })}</Text>,
      <Text color={INK.dim} wrap="wrap">{text(`feature.chaveiro.scope.${rule.scope}`, locale)}</Text>,
      proposalBlock(els, view, rule.proposal, `chaveiro-${rule.id}`, { send: () => act.autonomo("chaveiro", "send", rule.id), reject: () => act.autonomo("chaveiro", "reject", rule.id) },
        { summary: text("feature.chaveiro.proposal", locale), sent: text("feature.chaveiro.state.sent", locale) }),
    ], { width: view.width, rule: mark[1], glyph: mark[0], note: text(`feature.chaveiro.state.${rule.proposal.state}`, locale) });
  };
  return [
    autonomoHead(els, view, act, "chaveiro", text(status, locale)),
    section(els, text("feature.chaveiro.rules", locale)),
    rules.length ? stack(els, rules.slice(0, AUTONOMO_SHOWN).map(ruleNode)) : emptyLine(els, text("feature.chaveiro.none", locale)),
  ];
}

/** Oficina's part: its switch, then its checkups, each with why it ran, what doctor found and its suggestion. */
function oficinaPart(els: Els, view: View, act: Actions, checks: readonly OficinaCheck[], running: boolean) {
  const { Text } = els;
  const locale = view.locale;
  const latest = checks[0];
  const status = !view.features.oficina ? "feature.oficina.off" : running ? "feature.oficina.running"
    : latest?.proposal?.state === "waiting" ? "feature.oficina.waiting" : "feature.oficina.idle";
  const checkNode = (check: OficinaCheck) => {
    const state = check.proposal?.state ?? "rejected";
    const mark: [string, string] = state === "sent" ? [GLYPH.ok, INK.route] : state === "waiting" ? [GLYPH.ask, INK.pass] : [GLYPH.no, INK.dim];
    return card(els, text("feature.oficina.check", locale, { time: formatClock(check.at, locale) }), [
      <Text color={INK.dim} wrap="wrap">{text(`feature.oficina.reason.${check.reason}`, locale, { version: check.version })}</Text>,
      ...check.findings.slice(0, AUTONOMO_LINES).map((line, i) => markLine(els, [GLYPH.leader, INK.pass], line, `oficina-${check.id}-finding-${i}`)),
      check.proposal
        ? proposalBlock(els, view, check.proposal, `oficina-${check.id}`, { send: () => act.autonomo("oficina", "send", check.id), reject: () => act.autonomo("oficina", "reject", check.id) },
          { summary: text("feature.oficina.proposal", locale), sent: text("feature.oficina.state.sent", locale) })
        : null,
    ], { width: view.width, rule: mark[1], glyph: mark[0], note: text(`feature.oficina.state.${state}`, locale) });
  };
  return [
    autonomoHead(els, view, act, "oficina", text(status, locale)),
    section(els, text("feature.oficina.checks", locale)),
    checks.length ? stack(els, checks.slice(0, AUTONOMO_SHOWN).map(checkNode)) : emptyLine(els, text("feature.oficina.none", locale)),
  ];
}

const EMPTY_AUTONOMOS: AutonomosPanel = { portao: { runs: [] }, rumo: { goals: [] }, ensaio: { runs: [] }, chaveiro: { rules: [] }, oficina: { checks: [], running: false } };

/** The Autonomous screen: one part per agent, its switch and its history, in the order they were added to Pingo. */
export function autonomosView(els: Els, view: View, act: Actions) {
  const { Box } = els;
  const panel = view.autonomos ?? EMPTY_AUTONOMOS;
  return (
    <Box flexDirection="column" rowGap={UI_DESIGN.space.xs} width={view.width}>
      {portaoPart(els, view, act, panel.portao.runs)}
      {rumoPart(els, view, act, panel.rumo.goals)}
      {ensaioPart(els, view, act, panel.ensaio.runs)}
      {chaveiroPart(els, view, act, panel.chaveiro.rules)}
      {oficinaPart(els, view, act, panel.oficina.checks, panel.oficina.running)}
    </Box>
  );
}

/** What the active tab draws under the header. */
