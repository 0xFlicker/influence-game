import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

/**
 * Gateways serve commands, reads, and websocket delivery. Only the game-worker
 * role starts durable-game adoption and execution loops. The per-game lease in
 * game_run_owners, rather than a global worker lease, arbitrates workers.
 */
export type ApiRuntimeRole = "gateway" | "game-worker";

export type GameExecutionWorkerRuntime = {
  workerId: string;
  canClaimGames(): boolean;
  canAttemptGameStart(gameId: string): boolean;
  recordGameStartSucceeded(gameId: string): void;
  recordGameStartFailed(gameId: string): void;
  resumeClaimingAfterAdmissionReopens(): void;
  acknowledgeDrain(
    lease: GameWorkerDrainLease,
    drainOwnedGames: () => Promise<number>,
  ): Promise<GameWorkerDrainStatus>;
  getDrainStatus(): GameWorkerDrainStatus;
  stop(): Promise<void>;
};

export type GameWorkerDrainLease = {
  id: string;
  fencingToken: number;
  phase: "draining" | "validating";
};

export type GameWorkerDrainStatus = {
  protocolVersion: 1;
  workerId: string;
  state: "claiming" | "draining" | "drained";
  observedLease: GameWorkerDrainLease | null;
  observedAt: string | null;
  claimsStoppedAt: string | null;
  ownedGameCount: number | null;
  releasedAt: string | null;
  lastError: string | null;
};

export function readApiRuntimeRole(
  env: Record<string, string | undefined> = process.env,
): ApiRuntimeRole {
  const value = env.INFLUENCE_API_ROLE?.trim().toLowerCase() ?? "gateway";
  if (value === "gateway" || value === "game-worker") return value;
  throw new Error("INFLUENCE_API_ROLE must be gateway or game-worker");
}

export function startGameExecutionWorkerRuntime(): GameExecutionWorkerRuntime {
  const workerId = randomUUID();
  let state: GameWorkerDrainStatus = {
    protocolVersion: 1,
    workerId,
    state: "claiming",
    observedLease: null,
    observedAt: null,
    claimsStoppedAt: null,
    ownedGameCount: null,
    releasedAt: null,
    lastError: null,
  };
  let draining: Promise<GameWorkerDrainStatus> | null = null;
  const failedStarts = new Map<string, { attempts: number; retryAt: number }>();

  const snapshot = (): GameWorkerDrainStatus => structuredClone(state);

  return {
    workerId,
    canClaimGames: () => state.state === "claiming",
    canAttemptGameStart: (gameId) => (failedStarts.get(gameId)?.retryAt ?? 0) <= Date.now(),
    recordGameStartSucceeded: (gameId) => {
      failedStarts.delete(gameId);
    },
    recordGameStartFailed: (gameId) => {
      const attempts = (failedStarts.get(gameId)?.attempts ?? 0) + 1;
      const delayMs = Math.min(5 * 60_000, 5_000 * (2 ** (attempts - 1)));
      failedStarts.set(gameId, { attempts, retryAt: Date.now() + delayMs });
    },
    resumeClaimingAfterAdmissionReopens: () => {
      if (state.state === "claiming") return;
      state = {
        protocolVersion: 1,
        workerId,
        state: "claiming",
        observedLease: null,
        observedAt: null,
        claimsStoppedAt: null,
        ownedGameCount: null,
        releasedAt: null,
        lastError: null,
      };
    },
    acknowledgeDrain: async (lease, drainOwnedGames) => {
      if (state.state === "claiming") {
        const now = new Date().toISOString();
        state = {
          ...state,
          state: "draining",
          observedLease: { ...lease },
          observedAt: now,
          claimsStoppedAt: now,
          lastError: null,
        };
      } else if (
        state.observedLease?.id === lease.id
        && state.observedLease.fencingToken === lease.fencingToken
      ) {
        // A deployment can advance from draining to validating while this
        // worker is finishing its last durable boundary. The acknowledgement
        // remains tied to the same fence, but reports the current phase.
        state = { ...state, observedLease: { ...lease } };
      } else {
        // A worker may remain alive after acknowledging a prior deployment.
        // A later controller fence needs a fresh acknowledgement, never a
        // stale proof for the previous release.
        state = {
          ...state,
          state: "draining",
          observedLease: { ...lease },
          observedAt: new Date().toISOString(),
          claimsStoppedAt: state.claimsStoppedAt ?? new Date().toISOString(),
          ownedGameCount: null,
          releasedAt: null,
          lastError: null,
        };
      }
      if (state.state === "drained") return snapshot();
      if (!draining) {
        draining = (async () => {
          try {
            const ownedGameCount = await drainOwnedGames();
            state = {
              ...state,
              state: ownedGameCount === 0 ? "drained" : "draining",
              ownedGameCount,
              releasedAt: ownedGameCount === 0 ? new Date().toISOString() : null,
              lastError: null,
            };
            return snapshot();
          } catch (error) {
            state = {
              ...state,
              state: "draining",
              lastError: error instanceof Error ? error.message : String(error),
            };
            throw error;
          } finally {
            draining = null;
          }
        })();
      }
      return draining;
    },
    getDrainStatus: snapshot,
    async stop() {},
  };
}

/**
 * Acknowledges one observed global drain only after this worker has stopped
 * local execution and the durable lease table confirms it owns no game.
 */
export async function acknowledgeGameWorkerDrain(
  db: DrizzleDB,
  runtime: GameExecutionWorkerRuntime,
  lease: GameWorkerDrainLease,
  releaseOwnedGames: () => Promise<void>,
): Promise<GameWorkerDrainStatus> {
  return runtime.acknowledgeDrain(lease, async () => {
    await releaseOwnedGames();
    const activeOwners = await db.select({ id: schema.gameRunOwners.id })
      .from(schema.gameRunOwners)
      .where(and(
        eq(schema.gameRunOwners.processId, runtime.workerId),
        eq(schema.gameRunOwners.status, "active"),
      ));
    return activeOwners.length;
  });
}
