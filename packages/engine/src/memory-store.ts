/**
 * Memory store interface for agent memories during a game.
 *
 * Memories are operational — they exist only for the duration of a game
 * and are cleared when the game ends.
 */

export type MemoryType = "ally" | "threat" | "note" | "vote_history" | "reflection";

export interface MemoryRecord {
  gameId: string;
  agentId: string;
  round: number;
  memoryType: MemoryType;
  subject: string | null;
  content: string;
}

export interface MemoryStore {
  /** Save a memory record */
  save(record: MemoryRecord): void | Promise<void>;
  /** Recall all memories for a specific agent in a game */
  recall(gameId: string, agentId: string): MemoryRecord[] | Promise<MemoryRecord[]>;
  /** Clear all memories for a game (called when game ends) */
  clear(gameId: string): void | Promise<void>;
}

/**
 * In-memory implementation of MemoryStore.
 * Used for tests and simulations where persistence is not needed.
 */
export class InMemoryMemoryStore implements MemoryStore {
  private records: MemoryRecord[] = [];

  save(record: MemoryRecord): void {
    this.records.push(record);
  }

  recall(gameId: string, agentId: string): MemoryRecord[] {
    return this.records.filter((r) => r.gameId === gameId && r.agentId === agentId);
  }

  clear(gameId: string): void {
    this.records = this.records.filter((r) => r.gameId !== gameId);
  }
}
