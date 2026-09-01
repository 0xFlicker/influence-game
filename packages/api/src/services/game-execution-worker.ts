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
};

export type GameWorkerDrainLease = {
  id: string;
  fencingToken: number;
  phase: "draining" | "validating";
};

export type GameWorkerDrainStatus = {
  state: "claiming" | "draining" | "drained";
  observedLease: Pick<GameWorkerDrainLease, "id" | "fencingToken"> | null;
  claimsStoppedAt: string | null;
  ownedGameCount: number | null;
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
    state: "claiming",
    observedLease: null,
    claimsStoppedAt: null,
    ownedGameCount: null,
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
        state: "claiming",
        observedLease: null,
        claimsStoppedAt: null,
        ownedGameCount: null,
      };
    },
    acknowledgeDrain: async (lease, drainOwnedGames) => {
      if (state.state === "claiming") {
        const now = new Date().toISOString();
        state = {
          state: "draining",
          observedLease: { id: lease.id, fencingToken: lease.fencingToken },
          claimsStoppedAt: now,
          ownedGameCount: null,
        };
      } else if (
        state.observedLease?.id === lease.id
        && state.observedLease.fencingToken === lease.fencingToken
      ) {
        // Keep the same acknowledgement while this fence advances phases.
      } else {
        state = {
          state: "draining",
          observedLease: { id: lease.id, fencingToken: lease.fencingToken },
          claimsStoppedAt: new Date().toISOString(),
          ownedGameCount: null,
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
            };
            return snapshot();
          } catch (error) {
            state = { ...state, state: "draining", ownedGameCount: null };
            throw error;
          } finally {
            draining = null;
          }
        })();
      }
      return draining;
    },
    getDrainStatus: snapshot,
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
