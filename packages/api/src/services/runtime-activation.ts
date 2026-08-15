export const RELEASE_CONTROL_PROTOCOL_VERSION = 1 as const;

export type RuntimeStartupMode = "active" | "validation";
export type RuntimeState = "starting" | "validation" | "activating" | "active";

export type RuntimeActivationFence = {
  leaseId: string;
  fencingToken: number;
};

export type RuntimeFenceValidationResult =
  | { ok: true }
  | {
    ok: false;
    code: string;
    error: string;
    retryable: boolean;
  };

export type RuntimeActivationFailure = {
  ok: false;
  code: string;
  error: string;
  retryable: boolean;
};

export type RuntimeActivationResult =
  | {
    ok: true;
    outcome: "activated" | "already_active";
    releaseControl: RuntimeActivationStatus;
  }
  | RuntimeActivationFailure;

export type RuntimeActivationStatus = {
  protocolVersion: typeof RELEASE_CONTROL_PROTOCOL_VERSION;
  startupMode: RuntimeStartupMode;
  runtimeState: RuntimeState;
  activatedLeaseId: string | null;
};

export interface RuntimeStopHandle {
  stop(): void | Promise<void>;
}

export interface RuntimeActivationController {
  initialize(): Promise<void>;
  activate(fence: RuntimeActivationFence): Promise<RuntimeActivationResult>;
  getStatus(): RuntimeActivationStatus;
  canClaimWork(): boolean;
  stop(): Promise<void>;
}

interface RuntimeActivationLogger {
  error(message: string, error?: unknown): void;
}

export function readRuntimeStartupMode(
  env: Record<string, string | undefined> = process.env,
): RuntimeStartupMode {
  const value = env.INFLUENCE_API_STARTUP_MODE?.trim().toLowerCase() ?? "active";
  if (value === "active" || value === "validation") return value;
  throw new Error("INFLUENCE_API_STARTUP_MODE must be active or validation");
}

export function createRuntimeActivationController(options: {
  mode: RuntimeStartupMode;
  validateFence(fence: RuntimeActivationFence): Promise<RuntimeFenceValidationResult>;
  startRuntime(fence?: RuntimeActivationFence): void | RuntimeStopHandle | Promise<void | RuntimeStopHandle>;
  logger?: RuntimeActivationLogger;
}): RuntimeActivationController {
  const logger = options.logger ?? console;
  let state: RuntimeState = options.mode === "active" ? "starting" : "validation";
  let initialized: Promise<void> | null = null;
  let activeFenceKey: string | null = null;
  let activatedLeaseId: string | null = null;
  let stopHandle: RuntimeStopHandle | null = null;
  let pendingActivation: {
    fenceKey: string;
    promise: Promise<RuntimeActivationResult>;
  } | null = null;

  const getStatus = (): RuntimeActivationStatus => ({
    protocolVersion: RELEASE_CONTROL_PROTOCOL_VERSION,
    startupMode: options.mode,
    runtimeState: state,
    activatedLeaseId,
  });

  const start = async (fence?: RuntimeActivationFence): Promise<void> => {
    const started = await options.startRuntime(fence);
    stopHandle = started ?? null;
  };

  const controller: RuntimeActivationController = {
    initialize() {
      if (options.mode === "validation" || state === "active") return Promise.resolve();
      if (initialized) return initialized;
      initialized = start().then(() => {
        state = "active";
      });
      return initialized;
    },

    activate(fence) {
      if (options.mode !== "validation") {
        return Promise.resolve(failure(
          "runtime_not_in_validation",
          "This runtime did not start in validation mode",
          false,
        ));
      }
      if (!validFence(fence)) {
        return Promise.resolve(failure(
          "invalid_activation_fence",
          "A valid deployment admission fence is required",
          false,
        ));
      }

      const fenceKey = `${fence.leaseId}:${fence.fencingToken}`;
      if (state === "active") {
        return Promise.resolve(activeFenceKey === fenceKey
          ? {
            ok: true,
            outcome: "already_active",
            releaseControl: getStatus(),
          }
          : failure(
            "runtime_activation_fence_conflict",
            "The runtime was activated by a different deployment fence",
            false,
          ));
      }
      if (pendingActivation) {
        return pendingActivation.fenceKey === fenceKey
          ? pendingActivation.promise
          : Promise.resolve(failure(
            "runtime_activation_fence_conflict",
            "A different deployment fence is already activating the runtime",
            true,
          ));
      }

      state = "activating";
      const promise = (async (): Promise<RuntimeActivationResult> => {
        try {
          const validation = await options.validateFence(fence);
          if (!validation.ok) {
            state = "validation";
            return validation;
          }
          await start(fence);
          activeFenceKey = fenceKey;
          activatedLeaseId = fence.leaseId;
          state = "active";
          return {
            ok: true,
            outcome: "activated",
            releaseControl: getStatus(),
          };
        } catch (error) {
          state = "validation";
          logger.error("[runtime-activation] Candidate runtime activation failed", error);
          return failure(
            "runtime_activation_failed",
            "Candidate background runtime failed to activate",
            true,
          );
        } finally {
          pendingActivation = null;
        }
      })();
      pendingActivation = { fenceKey, promise };
      return promise;
    },

    getStatus,

    canClaimWork() {
      return state === "active";
    },

    async stop() {
      await pendingActivation?.promise;
      await stopHandle?.stop();
    },
  };

  return controller;
}

function validFence(fence: RuntimeActivationFence): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(fence.leaseId)
    && Number.isSafeInteger(fence.fencingToken)
    && fence.fencingToken > 0;
}

function failure(
  code: string,
  error: string,
  retryable: boolean,
): RuntimeActivationFailure {
  return { ok: false, code, error, retryable };
}
