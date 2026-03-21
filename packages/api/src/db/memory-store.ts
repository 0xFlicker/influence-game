/**
 * SQLite-backed MemoryStore using Drizzle ORM.
 *
 * Persists agent memories to the agent_memories table for durability during games.
 * Memories are operational — cleared when a game ends.
 */

import { eq, and } from "drizzle-orm";
import { agentMemories } from "./schema";
import type { DrizzleDB } from "./index";
import type { MemoryStore, MemoryRecord } from "@influence/engine";

export class SqliteMemoryStore implements MemoryStore {
  constructor(private readonly db: DrizzleDB) {}

  save(record: MemoryRecord): void {
    const id = crypto.randomUUID();
    this.db.insert(agentMemories).values({
      id,
      gameId: record.gameId,
      agentId: record.agentId,
      round: record.round,
      memoryType: record.memoryType,
      subject: record.subject,
      content: record.content,
    }).run();
  }

  recall(gameId: string, agentId: string): MemoryRecord[] {
    const rows = this.db
      .select()
      .from(agentMemories)
      .where(and(eq(agentMemories.gameId, gameId), eq(agentMemories.agentId, agentId)))
      .all();

    return rows.map((row) => ({
      gameId: row.gameId,
      agentId: row.agentId,
      round: row.round,
      memoryType: row.memoryType as MemoryRecord["memoryType"],
      subject: row.subject,
      content: row.content,
    }));
  }

  clear(gameId: string): void {
    this.db.delete(agentMemories).where(eq(agentMemories.gameId, gameId)).run();
  }
}
