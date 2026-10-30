import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, primaryKey, text, unique } from "drizzle-orm/pg-core";
import type { WerewolfEvent, WerewolfRequest, WerewolfPlayer } from "@influence/engine/werewolf";
import type { RetrospectiveRequestV1 } from "@influence/engine";
import { games, agentProfiles } from "./schema.js";

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
  request: jsonb("request").notNull().$type<WerewolfRequest | RetrospectiveRequestV1>(),
  observationHash: text("observation_hash").notNull(),
}, (table) => [primaryKey({ columns: [table.gameId, table.sequence] }), check("werewolf_turns_sequence_check", sql`${table.sequence} > 0`)]);

export type WerewolfHouseCharacter = Pick<WerewolfPlayer, "name" | "gender" | "personality" | "backstory" | "strategy" | "avatarUrl" | "fullBodyReferenceUrl" | "personaKey">;

/** Saved admission only. Character revisions and roles freeze in werewolf.started. */
export const werewolfLobbySeats = pgTable("werewolf_lobby_seats", {
  id: text("id").primaryKey(),
  gameId: text("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  agentProfileId: text("agent_profile_id").references(() => agentProfiles.id, { onDelete: "cascade" }),
  modelPreference: jsonb("model_preference").$type<import("@influence/engine").ModelPreference>().notNull().default("default"),
  houseCharacter: jsonb("house_character").$type<WerewolfHouseCharacter>(),
  joinedAt: text("joined_at").notNull().default(sql`now()::text`),
}, table => [unique("werewolf_lobby_seat_unique").on(table.gameId, table.agentProfileId), check("werewolf_lobby_seat_identity", sql`(${table.agentProfileId} IS NOT NULL) <> (${table.houseCharacter} IS NOT NULL)`)]);
