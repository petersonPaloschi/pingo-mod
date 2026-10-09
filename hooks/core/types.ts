// Jev's SystemOne request/result shapes, declared here so the mod has no dependency.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Model IDs available to a native agent spawn. */
export interface ModelContext {
  availableModels?: readonly string[];
}

// --- Jev wire format (SystemOne) ---

export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, Json> };
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
  usage: { input_tokens?: number; output_tokens?: number };
  /** Answers the reply carried that could not be used, and why. */
  dropped?: { name: string; why: string }[];
  /** The provider's reply body as it came (control characters blanked, clipped): for debugging an unusable answer. */
  raw?: string;
}

/** Untrusted provider fields are narrowed before normalize() builds SystemOneResult. */
export interface SystemOneWireAnswer {
  type?: unknown;
  choice?: unknown;
  confidence?: unknown;
  probabilities?: unknown;
  noul?: unknown;
}

export interface SystemOneWireResult {
  model?: unknown;
  answers?: Record<string, SystemOneWireAnswer>;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}
