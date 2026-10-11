# Pingo documentation

Start with the [project README](../README.md) for what Pingo does, installation and commands. Each page below covers
one agent, feature or core subsystem: what it does, when it acts, how it works step by step, its configuration and
commands, and a diagram.

## Core

| Page | Covers |
| --- | --- |
| [Architecture](core/architecture.md) | `register.tsx` and the pure core, session lifecycle, the three ways Pingo reaches a model, state, what the numbers mean |
| [Orchestration](core/orchestration.md) | Objectives, executor profiles, advisor guidance, independent review, managed batches and their limits |
| [Context compaction](core/context-compaction.md) | Jev-guided removal of old tool output instead of a summary |
| [Agent planning](core/agent-planning.md) | Jev-picked model and effort for subagents |

## Agents

| Page | Default | Runs on |
| --- | --- | --- |
| [Jev](agents/jev.md) | Needs a key | SystemOne API |
| [Comandante](agents/comandante.md) | Off | Jev |
| [Code Quality](agents/code-quality.md) | On | Claude subagent |
| [Vigia](agents/vigia.md) | On | No model; Haiku turn summary |
| [Portão](agents/portao.md) | Off | Jev + Claude subagent |
| [Rumo](agents/rumo.md) | Off | Jev |
| [Ensaio](agents/ensaio.md) | Off | Jev + Claude subagent |
| [Chaveiro](agents/chaveiro.md) | Off | Jev |
| [Oficina](agents/oficina.md) | Off | `claude doctor` + Jev |
| [Lapida](agents/lapida.md) | On | Claude subagent |
| [Resumo](agents/resumo.md) | On with the Deck pet | Claude subagent |

## Features

| Page | Default | Runs on |
| --- | --- | --- |
| [Farol](features/farol.md) | On | No model |
| [Clareza](features/clareza.md) | On | Claude Haiku |
| [Semente](features/semente.md) | On | No model |
| [Prisma](features/prisma.md) | On | No model (local browser gallery) |
| [Sentinela](features/sentinela.md) | On | No model |
| [Deck and Pingo Vivo](features/deck.md) | On | No model |
| [Sift](features/sift.md) | Available | Jev (CLI and skill) |

## Design and history

- [jev-orchestration-plan.md](jev-orchestration-plan.md): the orchestration design, with the exact Jev and advisor
  prompts that `hooks/core/prompts.ts` uses.
- [DESIGN.md](../DESIGN.md) and [style-system.md](style-system.md): the visual identity and where its tokens live.
- [tasks-execution.md](tasks-execution.md): the record of an earlier simplification and its evaluation.
- [evaluation/](evaluation/): frozen evaluation cases, fixtures and results; see also [bench/](../bench/).
- [media/](media/): the README illustration and archived animations from an earlier design (see
  [media/README.md](media/README.md); they do not describe current features).
