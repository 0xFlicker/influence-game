export class CardImageRenderOverloadedError extends Error {
  constructor() {
    super("House Highlights card image renderer is at capacity.");
    this.name = "CardImageRenderOverloadedError";
  }
}

export function createCardImageRenderQueue<T>({ maxQueued = 10 }: { maxQueued?: number } = {}) {
  if (!Number.isSafeInteger(maxQueued) || maxQueued < 0) {
    throw new Error("maxQueued must be a non-negative integer.");
  }

  let active = false;
  const waiting: Array<() => void> = [];
  const inFlight = new Map<string, Promise<T>>();

  const acquire = (): Promise<void> => {
    if (!active) {
      active = true;
      return Promise.resolve();
    }
    if (waiting.length >= maxQueued) {
      return Promise.reject(new CardImageRenderOverloadedError());
    }
    return new Promise((resolve) => waiting.push(resolve));
  };

  const release = () => {
    const next = waiting.shift();
    if (next) {
      next();
      return;
    }
    active = false;
  };

  return {
    run(key: string, render: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const result = (async () => {
        await acquire();
        try {
          return await render();
        } finally {
          release();
        }
      })();
      inFlight.set(key, result);
      void result.then(
        () => inFlight.delete(key),
        () => inFlight.delete(key),
      );
      return result;
    },
  };
}
