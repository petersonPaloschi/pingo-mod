export type FailureState = Map<string, { signature: string; count: number }>;

const MAX_FAILURE_TARGETS = 40;

export function repeatedFailure(
  state: FailureState,
  input: { tool: string; target: string; error?: string; denied?: boolean },
): number | undefined {
  if (input.denied) return undefined;

  const key = JSON.stringify([input.tool, input.target]);
  if (input.error === undefined) {
    state.delete(key);
    return undefined;
  }

  const signature = input.error.trim().replace(/\s+/g, " ");
  if (!signature) {
    state.delete(key);
    return undefined;
  }

  const previous = state.get(key);
  const previousCount = previous?.signature === signature ? previous.count : 0;
  const count = Math.min(previousCount + 1, 2);
  state.delete(key);
  state.set(key, { signature, count });
  while (state.size > MAX_FAILURE_TARGETS) state.delete(state.keys().next().value!);

  return previousCount === 1 ? 2 : undefined;
}
