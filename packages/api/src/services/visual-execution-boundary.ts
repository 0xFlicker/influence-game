import type { GameExecutionCursorV1, GameTurnHeadsV1 } from "@influence/engine";
import { and, eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { gameExecutionStateFromRow } from "./game-execution-state.js";
export type VisualTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export type VisualBoundaryGuard = (tx?: VisualTransaction) => Promise<void>;
import { assertOwnerActive } from "./game-ownership.js";
import { readGameExecutionState } from "./game-turn-commit.js";
import { stableJson } from "./stable-hash.js";

/** Recheck before each paid dispatch and before handing accepted imagery to gameplay. */
export function visualExecutionBoundaryGuard(db: DrizzleDB, input: {
  gameId: string;
  ownerEpoch: string;
  heads: GameTurnHeadsV1;
  cursor: GameExecutionCursorV1;
}): VisualBoundaryGuard {
  const expected = structuredClone(input);
  return async (tx) => {
    let execution;
    if (tx) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('influence.game-turn'), hashtext(${expected.gameId}))`);
      await tx.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.id, expected.gameId)).for("update");
      const [owner] = await tx.select().from(schema.gameRunOwners).where(and(eq(schema.gameRunOwners.gameId, expected.gameId), eq(schema.gameRunOwners.ownerEpoch, expected.ownerEpoch))).for("update");
      if (!owner || owner.status !== "active" || owner.expiresAt && Date.parse(owner.expiresAt) <= Date.now()) throw new Error("Visual owner is no longer active");
      const [row] = await tx.select().from(schema.gameExecutionStates).where(eq(schema.gameExecutionStates.gameId, expected.gameId));
      execution = row ? gameExecutionStateFromRow(row) : null;
    } else {
      await assertOwnerActive(db, expected.gameId, expected.ownerEpoch);
      execution = await readGameExecutionState(db, expected.gameId);
    }
    if (!execution || execution.ownerEpoch !== expected.ownerEpoch
      || stableJson(execution.heads) !== stableJson(expected.heads)
      || stableJson(execution.cursor) !== stableJson(expected.cursor)) {
      throw new Error("Visual context durable boundary changed");
    }
  };
}
