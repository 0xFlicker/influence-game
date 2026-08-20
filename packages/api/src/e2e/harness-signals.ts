export interface HarnessSignalController {
  received: Promise<void>;
  signal: AbortSignal;
  requested(): boolean;
  onRequest(callback: () => void): void;
  dispose(): void;
}

/** Observe termination before acquiring resources so startup can unwind safely. */
export function observeHarnessSignals(): HarnessSignalController {
  let requested = false;
  const abortController = new AbortController();
  const callbacks = new Set<() => void>();
  let resolveReceived!: () => void;
  const received = new Promise<void>((resolve) => {
    resolveReceived = resolve;
  });
  const receive = () => {
    requested = true;
    abortController.abort();
    resolveReceived();
    for (const callback of callbacks) callback();
  };
  process.on("SIGINT", receive);
  process.on("SIGTERM", receive);

  return {
    received,
    signal: abortController.signal,
    requested: () => requested,
    onRequest: (callback) => {
      if (requested) callback();
      else callbacks.add(callback);
    },
    dispose: () => {
      process.off("SIGINT", receive);
      process.off("SIGTERM", receive);
      callbacks.clear();
    },
  };
}
