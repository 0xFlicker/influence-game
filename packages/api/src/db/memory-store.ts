/**
 * PostgreSQL-backed MemoryStore using Drizzle ORM.
 *
 * Persists agent memories to the agent_memories table for durability during games.
 * Memories are operational — cleared when a game ends.
 */

import { eq, and } from "drizzle-orm";
import { agentMemories } from "./schema.js";
import type { DrizzleDB } from "./index.js";
import type { MemoryStore, MemoryRecord } from "@influence/engine";

export class PgMemoryStore implements MemoryStore {
  constructor(private readonly db: DrizzleDB) {}

  async save(record: MemoryRecord): Promise<void> {
    const id = crypto.randomUUID();
    try {
      await this.db.insert(agentMemories).values({
        id,
        gameId: record.gameId,
        agentId: record.agentId,
        round: record.round,
        memoryType: record.memoryType,
        subject: record.subject,
        content: record.content,
      });
    } catch (err: unknown) {
      // Gracefully handle FK violations — the game row may have been deleted
      // (e.g. test truncation or game cancellation) while an agent was mid-phase.
      // Drizzle wraps postgres errors — check both the error and its cause.
      const pgCode =
        (err as { code?: string }).code ??
        ((err as { cause?: { code?: string } }).cause?.code);
      if (pgCode === "23503") return;
      throw err;
    }
  }

  async recall(gameId: string, agentId: string): Promise<MemoryRecord[]> {
    const rows = await this.db
      .select()
      .from(agentMemories)
      .where(and(eq(agentMemories.gameId, gameId), eq(agentMemories.agentId, agentId)));

    return rows.map((row) => ({
      gameId: row.gameId,
      agentId: row.agentId,
      round: row.round,
      memoryType: row.memoryType as MemoryRecord["memoryType"],
      subject: row.subject,
      content: row.content,
    }));
  }

  async clear(gameId: string): Promise<void> {
    await this.db.delete(agentMemories).where(eq(agentMemories.gameId, gameId));
  }
}
