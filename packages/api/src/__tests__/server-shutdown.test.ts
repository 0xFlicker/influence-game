import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { listenBeforeRuntimeInitialization } from "../services/listening-runtime.js";
import {
  createServerShutdownController,
  installServerShutdownSignalHandlers,
} from "../server-shutdown.js";

type StopCall = boolean | undefined;

function createDeferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(options: { workerStop?: Promise<void> } = {}) {
  const gracefulStop = createDeferred();
  const stopCalls: StopCall[] = [];
  const exits: number[] = [];
  const events: string[] = [];
  let scheduledForce: (() => void) | null = null;
  let cancelledTimer = false;

  const controller = createServerShutdownController({
    server: {
      stop(closeActiveConnections) {
        stopCalls.push(closeActiveConnections);
        events.push(`server.stop:${String(closeActiveConnections)}`);
        return closeActiveConnections ? Promise.resolve() : gracefulStop.promise;
      },
    },
    worker: {
      stop() {
        events.push("worker.stop");
        return options.workerStop;
      },
    },
    stopAcceptingRequests() {
      events.push("requests.stop");
    },
    exit(code) {
      exits.push(code);
      events.push(`exit:${code}`);
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    scheduleForce(callback) {
      scheduledForce = callback;
      return { fake: "timer" } as unknown as ReturnType<typeof setTimeout>;
    },
    cancelForce() {
      cancelledTimer = true;
    },
  });

  return {
    controller,
    gracefulStop,
    stopCalls,
    exits,
    events,
    force: () => scheduledForce?.(),
    wasTimerCancelled: () => cancelledTimer,
  };
}

describe("server shutdown", () => {
  test("installed process signals enter the same idempotent controller", async () => {
    const harness = createHarness();
    const signals = new EventEmitter();
    installServerShutdownSignalHandlers(signals, harness.controller);

    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    await Promise.resolve();

    expect(harness.stopCalls).toEqual([false, true]);
    expect(harness.events.filter((event) => event === "requests.stop")).toHaveLength(1);
    expect(harness.events.filter((event) => event === "worker.stop")).toHaveLength(1);
    expect(harness.exits).toEqual([0]);
  });

  test("SIGTERM starts shutdown before a worker can be polled for drain proof", async () => {
    const harness = createHarness();

    const shutdown = harness.controller.requestShutdown("SIGTERM");

    expect(harness.events).toEqual([
      "requests.stop",
      "worker.stop",
      "server.stop:false",
    ]);
    expect(harness.exits).toEqual([]);

    harness.gracefulStop.resolve();
    await shutdown;

    expect(harness.stopCalls).toEqual([false]);
    expect(harness.exits).toEqual([0]);
    expect(harness.wasTimerCancelled()).toBe(true);
  });

  test("first-signal exit waits for both server drain and worker quiescence", async () => {
    const workerStop = createDeferred();
    const harness = createHarness({ workerStop: workerStop.promise });

    const shutdown = harness.controller.requestShutdown("SIGTERM");
    harness.gracefulStop.resolve();
    await Promise.resolve();

    expect(harness.exits).toEqual([]);

    workerStop.resolve();
    await shutdown;

    expect(harness.stopCalls).toEqual([false]);
    expect(harness.exits).toEqual([0]);
  });

  test("a repeated signal force-closes active HTTP and WebSocket connections exactly once", async () => {
    const harness = createHarness();

    const first = harness.controller.requestShutdown("SIGTERM");
    const second = harness.controller.requestShutdown("SIGINT");
    const third = harness.controller.requestShutdown("SIGTERM");

    expect(second).toBe(first);
    expect(third).toBe(first);
    await first;

    expect(harness.stopCalls).toEqual([false, true]);
    expect(harness.events.filter((event) => event === "requests.stop")).toHaveLength(1);
    expect(harness.events.filter((event) => event === "worker.stop")).toHaveLength(1);
    expect(harness.exits).toEqual([0]);
  });

  test("the grace deadline force-closes active connections and cannot hang shutdown", async () => {
    const workerStop = createDeferred();
    const harness = createHarness({ workerStop: workerStop.promise });

    const shutdown = harness.controller.requestShutdown("SIGTERM");
    harness.gracefulStop.resolve();
    await Promise.resolve();

    expect(harness.exits).toEqual([]);

    harness.force();
    await shutdown;

    expect(harness.stopCalls).toEqual([false, true]);
    expect(harness.exits).toEqual([0]);
  });

  test("a graceful-shutdown failure still force-closes and exits unsuccessfully", async () => {
    const harness = createHarness();

    const shutdown = harness.controller.requestShutdown("SIGTERM");
    harness.gracefulStop.reject(new Error("stop failed"));
    await shutdown;

    expect(harness.stopCalls).toEqual([false, true]);
    expect(harness.exits).toEqual([1]);
  });
});

describe("server startup", () => {
  test("claims the listener before initializing ownership-changing runtime work", async () => {
    const events: string[] = [];
    const server = {
      stop() {
        events.push("server.stop");
      },
    };

    const listeningServer = await listenBeforeRuntimeInitialization({
      listen: () => {
        events.push("server.listen");
        return server;
      },
      onListening: () => {
        events.push("server.register");
      },
      initializeRuntime: async () => {
        events.push("runtime.initialize");
      },
      onReady: () => {
        events.push("server.ready");
      },
    });

    expect(listeningServer).toBe(server);
    expect(events).toEqual([
      "server.listen",
      "server.register",
      "runtime.initialize",
      "server.ready",
    ]);
  });

  test("does not initialize runtime work when listener binding fails", async () => {
    let runtimeInitialized = false;

    await expect(listenBeforeRuntimeInitialization({
      listen: (): { stop(force?: boolean): void } => {
        throw new Error("EADDRINUSE: address already in use");
      },
      initializeRuntime: async () => {
        runtimeInitialized = true;
      },
    })).rejects.toThrow("EADDRINUSE");

    expect(runtimeInitialized).toBeFalse();
  });

  test("force-closes the claimed listener when runtime initialization fails", async () => {
    const stopCalls: Array<boolean | undefined> = [];

    await expect(listenBeforeRuntimeInitialization({
      listen: () => ({
        stop(force?: boolean) {
          stopCalls.push(force);
        },
      }),
      initializeRuntime: async () => {
        throw new Error("runtime initialization failed");
      },
    })).rejects.toThrow("runtime initialization failed");

    expect(stopCalls).toEqual([true]);
  });

  test("preserves both runtime and listener-cleanup failures", async () => {
    const startupError = new Error("runtime initialization failed");
    const cleanupError = new Error("listener cleanup failed");

    try {
      await listenBeforeRuntimeInitialization({
        listen: () => ({
          stop() {
            throw cleanupError;
          },
        }),
        initializeRuntime: async () => {
          throw startupError;
        },
      });
      throw new Error("Expected startup to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([startupError, cleanupError]);
    }
  });
});
