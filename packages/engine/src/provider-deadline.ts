const limits = new WeakMap<AbortSignal, number>();

/** Explicit application deadline, distinguishable from operator/owner cancellation. */
export function providerDeadlineSignal(timeoutMs: number): AbortSignal {
  const signal = AbortSignal.timeout(timeoutMs);
  limits.set(signal, timeoutMs);
  return signal;
}

export class ProviderDeadlineError extends Error {
  constructor(readonly timeoutMs: number | undefined, cause: unknown) {
    super("Application request deadline expired", { cause });
    this.name = "ProviderDeadlineError";
  }
}

export function requestDeadlineError(signal: AbortSignal | undefined, cause: unknown): ProviderDeadlineError | undefined {
  if (!signal?.aborted || !(signal.reason instanceof DOMException) || signal.reason.name !== "TimeoutError") return undefined;
  return new ProviderDeadlineError(limits.get(signal), cause);
}
