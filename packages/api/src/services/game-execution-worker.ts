import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { DeploymentAdmissionPhase } from "../db/schema.js";

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
    countOwnedGames: () => Promise<number>,
  ): Promise<GameWorkerDrainStatus>;
  getDrainStatus(): GameWorkerDrainStatus;
};

export type GameWorkerDrainLease = {
  id: string;
  fencingToken: number;
  phase: DeploymentAdmissionPhase;
};

export type GameWorkerDrainStatus = {
  version: 1;
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
    version: 1,
    state: "claiming",
    observedLease: null,
    claimsStoppedAt: null,
    ownedGameCount: null,
  };
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
        version: 1,
        state: "claiming",
        observedLease: null,
        claimsStoppedAt: null,
        ownedGameCount: null,
      };
    },
    acknowledgeDrain: async (lease, countOwnedGames) => {
      if (state.state === "claiming") {
        const now = new Date().toISOString();
        state = {
          version: 1,
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
          version: 1,
          state: "draining",
          observedLease: { id: lease.id, fencingToken: lease.fencingToken },
          claimsStoppedAt: new Date().toISOString(),
          ownedGameCount: null,
        };
      }
      if (state.state === "drained") return snapshot();
      const observedState = state;
      try {
        const ownedGameCount = await countOwnedGames();
        // Admission can reopen or advance to a new fence while the DB read
        // is pending. An old read must never acknowledge that newer state.
        if (state === observedState) {
          state = {
            ...state,
            state: ownedGameCount === 0 ? "drained" : "draining",
            ownedGameCount,
          };
        }
      } catch (error) {
        if (state === observedState) {
          state = { ...state, state: "draining", ownedGameCount: null };
        }
        throw error;
      }
      return snapshot();
    },
    getDrainStatus: snapshot,
  };
}

/**
 * Stop claims while owned games continue to completion. A drain only observes
 * ownership; it must never abort execution or relinquish an active game's lease.
 */
export async function acknowledgeGameWorkerDrain(
  db: DrizzleDB,
  runtime: GameExecutionWorkerRuntime,
  lease: GameWorkerDrainLease,
): Promise<GameWorkerDrainStatus> {
  return runtime.acknowledgeDrain(lease, async () => {
    const activeOwners = await db.select({ id: schema.gameRunOwners.id })
      .from(schema.gameRunOwners)
      .where(and(
        eq(schema.gameRunOwners.processId, runtime.workerId),
        eq(schema.gameRunOwners.status, "active"),
      ));
    return activeOwners.length;
  });
}
