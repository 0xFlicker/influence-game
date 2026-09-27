import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import type { WerewolfEvent, WerewolfRequest } from "@influence/engine/werewolf";
import { games } from "./schema.js";

/** Private canonical log. Public endpoints return only audience projections. */
export const werewolfEvents = pgTable("werewolf_events", {
  gameId: text("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  event: jsonb("event").notNull().$type<WerewolfEvent>(),
}, (table) => [primaryKey({ columns: [table.gameId, table.sequence] }), check("werewolf_events_sequence_check", sql`${table.sequence} > 0`)]);

/** A frozen observation hash and legal action before any provider dispatch. */
export const werewolfTurns = pgTable("werewolf_turns", {
  gameId: text("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  request: jsonb("request").notNull().$type<WerewolfRequest>(),
  observationHash: text("observation_hash").notNull(),
}, (table) => [primaryKey({ columns: [table.gameId, table.sequence] }), check("werewolf_turns_sequence_check", sql`${table.sequence} > 0`)]);
