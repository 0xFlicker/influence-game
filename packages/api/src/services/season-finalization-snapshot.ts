import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import type { Qualification } from "@influence/engine/championship";
import { readJson } from "./payload-storage.js";
export interface SeasonFinalizationSnapshot {
  version: 1;
  seasonId: string;
  finalizedAt: string;
  ratingPolicyVersion: string;
  completedGameIds: string[];
  qualification: Qualification[];
  agents: Array<Record<string, unknown>>;
  architects: Array<Record<string, unknown>>;
  receipts: Array<typeof schema.competitionReceipts.$inferSelect>;
}
export async function readSeasonFinalizationSnapshot(db: Pick<DrizzleDB, "select">, seasonId: string) {
  const [row] = await db.select().from(schema.seasonFinalizations).where(eq(schema.seasonFinalizations.seasonId, seasonId));
  if (!row) return null;
  const snapshot = await readJson(row.snapshot);
  if (snapshot.version !== 1 || snapshot.seasonId !== seasonId) throw new Error("Invalid season finalization snapshot");
  return snapshot;
}
