import type { Server } from "bun";

export const SERVER_SHUTDOWN_GRACE_PERIOD_MS = 10_000;

type ShutdownSignal = "SIGINT" | "SIGTERM";
type ShutdownTimer = ReturnType<typeof setTimeout>;

interface ShutdownLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

interface ServerShutdownOptions {
  server: Pick<Server<unknown>, "stop">;
  worker: { stop(): void | Promise<void> } | null;
  stopAcceptingRequests(): void;
  exit(code: number): void;
  gracePeriodMs?: number;
  logger?: ShutdownLogger;
  scheduleForce?: (callback: () => void, delayMs: number) => ShutdownTimer;
  cancelForce?: (timer: ShutdownTimer) => void;
}

export interface ServerShutdownController {
  requestShutdown(signal: ShutdownSignal): Promise<void>;
}

interface ShutdownSignalSource {
  on(signal: ShutdownSignal, listener: () => void): unknown;
}

export function installServerShutdownSignalHandlers(
  source: ShutdownSignalSource,
  controller: ServerShutdownController,
): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    source.on(signal, () => {
      void controller.requestShutdown(signal);
    });
  }
}

/**
 * Coordinate process shutdown without coupling the lifecycle to module import.
 * A second signal skips the remaining grace period, matching conventional
 * process-manager behavior while keeping every cleanup operation idempotent.
 */
export function createServerShutdownController(
  options: ServerShutdownOptions,
): ServerShutdownController {
  const logger = options.logger ?? console;
  const gracePeriodMs = options.gracePeriodMs ?? SERVER_SHUTDOWN_GRACE_PERIOD_MS;
  const scheduleForce = options.scheduleForce ?? setTimeout;
  const cancelForce = options.cancelForce ?? clearTimeout;

  let shutdownPromise: Promise<void> | null = null;
  let resolveShutdown: (() => void) | null = null;
  let forceTimer: ShutdownTimer | null = null;
  let forced = false;
  let exited = false;
  let exitCode = 0;

  const exitOnce = (code: number) => {
    if (exited) return;
    exited = true;
    if (forceTimer) {
      cancelForce(forceTimer);
      forceTimer = null;
    }
    options.exit(code);
    resolveShutdown?.();
  };

  const forceShutdown = (reason: string) => {
    if (forced || exited) return;
    forced = true;
    logger.warn(`[shutdown] ${reason}; closing active connections`);
    try {
      void options.server.stop(true).catch((error) => {
        logger.error("[shutdown] Forced server stop failed", error);
      });
    } catch (error) {
      logger.error("[shutdown] Forced server stop failed", error);
    }
    exitOnce(exitCode);
  };

  return {
    requestShutdown(signal) {
      if (shutdownPromise) {
        forceShutdown(`Received ${signal} while shutdown was already in progress`);
        return shutdownPromise;
      }

      shutdownPromise = new Promise<void>((resolve) => {
        resolveShutdown = resolve;
      });
      logger.info(`[shutdown] Received ${signal}; stopping API`);

      try {
        options.stopAcceptingRequests();
      } catch (error) {
        exitCode = 1;
        logger.error("[shutdown] Failed to mark the API unavailable", error);
      }

      try {
        const workerStopped = Promise.resolve(options.worker?.stop());
        const serverStopped = options.server.stop(false);
        void Promise.all([serverStopped, workerStopped]).then(
          () => exitOnce(exitCode),
          (error) => {
            exitCode = 1;
            logger.error("[shutdown] Graceful shutdown failed", error);
            forceShutdown("Graceful shutdown failed");
          },
        );
      } catch (error) {
        exitCode = 1;
        logger.error("[shutdown] Failed to begin graceful shutdown", error);
        forceShutdown("Failed to begin graceful shutdown");
      }

      if (!exited) {
        forceTimer = scheduleForce(
          () => forceShutdown(`Grace period of ${gracePeriodMs}ms expired`),
          gracePeriodMs,
        );
      }

      return shutdownPromise;
    },
  };
}
