export type CleanupStep = readonly [label: string, cleanup: () => void | Promise<void>];

/** Run ordered teardown completely and report every cleanup failure together. */
export async function cleanupE2eResources(steps: readonly CleanupStep[]): Promise<void> {
  const errors: Error[] = [];
  for (const [label, cleanup] of steps) {
    try {
      await cleanup();
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      errors.push(new Error(`${label}: ${reason.message}`, { cause: reason }));
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "E2E resource cleanup failed");
}
