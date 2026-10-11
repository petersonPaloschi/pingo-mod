import { text, type Locale } from "../../i18n.ts";
import { trunc } from "../theme.ts";
import { type Agent, type Task, type DeckState, type ToolUse } from "./types.ts";

export function agentsOf(s: DeckState, home: string): Agent[] {
  return [...s.agents.values()].filter((a) => a.home === home);
}

// the tool's name as a strip shows it: an MCP tool's server prefix dropped
export const toolName = (tool: string): string => String(tool).replace(/^mcp__[^_]+__/, "");

// the verbs an action line uses, from the tool a call ran

export function actionOf(e: ToolUse, locale: Locale): string {
  const base = (p: string | null | undefined) => String(p ?? "").split("/").pop() ?? "";
  switch (e.tool) {
    case "Read":
      return text("deck.action.reading", locale, { file: base(e.file_path) });
    case "Grep":
    case "Glob":
      return text("deck.action.searching", locale);
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return text("deck.action.editing", locale, { file: base(e.file_path ?? e.notebook_path) });
    case "Bash":
      return text("deck.action.running", locale, { command: trunc(String(e.command ?? "").trim().split(/\s+/).slice(0, 2).join(" "), 22) });
    case "WebFetch":
    case "WebSearch":
      return text("deck.action.browsing", locale);
    case "Agent":
    case "Task":
      return text("deck.action.delegating", locale);
    case "TodoWrite":
      return text("deck.action.planning", locale);
    default:
      return toolName(e.tool);
  }
}
