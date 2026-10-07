// The router's shapes, and the slice of Jev's SystemOne request/result format it uses,
// declared here so the mod has no dependency.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  enum?: Json[];
  const?: Json;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  [key: string]: unknown;
}

export type Turn = { [key: string]: Json };

export interface RouterTool {
  name: string;
  description?: string;
  parameters?: JsonSchema;
  kind: "function" | "custom" | "hosted";
}

export interface RouterInput {
  system: string;
  turns: Turn[];
  tools: RouterTool[];
}

// --- Jev wire format (SystemOne) ---

export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string | null> };
export type NoulQuestion = { type: "noul"; instructions: string };
export type Questions = Record<string, ChoiceQuestion | NoulQuestion>;

export interface SystemOneRequest {
  state: { [key: string]: Json };
  questions: Questions;
  model: string;
}

export type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
export type NoulAnswer = { type: "noul"; noul: number };
export type Answer = ChoiceAnswer | NoulAnswer;

export interface SystemOneResult {
  model?: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}
