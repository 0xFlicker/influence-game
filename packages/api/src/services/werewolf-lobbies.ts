import { enabledGameKinds } from "@influence/engine/game-availability";
import type { WerewolfSetup } from "@influence/engine/werewolf/types";
import { normalizeWerewolfCasting } from "./werewolf-games.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { startWerewolf, werewolfConfig, WEREWOLF_PRESETS, type WerewolfPreset } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { userHasAnyRole } from "../db/rbac.js";
import { generateUniqueSlug } from "../lib/slug.js";
import { modelLabelFromConfig } from "../lib/model-label.js";
import { checkGameStartAdmissionInTransaction } from "./deployment-admission.js";
import { decodeContentSnapshot } from "./agent-content-submissions.js";
import { hasEligibleAgentContent } from "./agent-content-eligibility.js";
import { freezeWerewolfRoster, validateWerewolfModels, WerewolfGameError } from "./werewolf-games.js";

type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export async function createWerewolfLobby(db: DrizzleDB, userId: string, input: { preset: WerewolfPreset; providerManifest?: unknown; maxDays?: number; setup?: WerewolfSetup; personaPool?: unknown; fillStrategy?: unknown; visualMode?: boolean }) {
  if (!enabledGameKinds().includes("werewolf")) throw new WerewolfGameError("Werewolf creation is unavailable.", 403);
  let rules;
  try { rules = werewolfConfig(input.preset, input.maxDays ?? 10, input.setup); }
  catch (error) { throw new WerewolfGameError(error instanceof Error ? error.message : "Invalid village configuration", 400); }
  const casting = normalizeWerewolfCasting(input);
  if (input.visualMode !== undefined && typeof input.visualMode !== "boolean") throw new WerewolfGameError("Visual Mode must be on or off", 400);
  const providerManifest = validateWerewolfModels(input.providerManifest);
  const id = randomUUID();
  const slug = await generateUniqueSlug(async candidate => (await db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.slug, candidate))).length > 0);
  const count = rules.setup?.playerCount ?? WEREWOLF_PRESETS[input.preset].players;
  await db.insert(schema.games).values({ id, slug, gameKind: "werewolf", gameKernel: null, createdById: userId, status: "waiting", trackType: "custom", minPlayers: count, maxPlayers: count,
    config: JSON.stringify({ preset: input.preset, setup: rules.setup, ...casting, visualMode: input.visualMode ?? false, maxDays: rules.maxDays, rulesVersion: rules.rulesVersion, providerManifest, serviceTier: "flex", visibility: "public" }) });
  return { id, slug };
}

async function lockLobby(tx: Tx, id: string) {
  const [game] = await tx.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id)))).for("update");
  if (!game) throw new WerewolfGameError("Game not found", 404);
  if (game.status !== "waiting") throw new WerewolfGameError("This game is no longer accepting cast changes.");
  return game;
}

async function publishedCharacter(db: DrizzleDB | Tx, profile: typeof schema.agentProfiles.$inferSelect) {
  if (!hasEligibleAgentContent(profile)) throw new WerewolfGameError("This agent is archived or awaiting review. Remove them from the cast before starting.");
  const [revision] = profile.contentRevisionId ? await db.select().from(schema.agentContentRevisions).where(eq(schema.agentContentRevisions.id, profile.contentRevisionId)) : [];
  if (profile.contentRevisionId && !revision) throw new Error("Missing approved character revision");
  return revision ? decodeContentSnapshot(revision.snapshot, profile) : profile;
}

export async function joinWerewolfLobby(db: DrizzleDB, id: string, userId: string, agentProfileId: string) {
  return db.transaction(async tx => {
    const game = await lockLobby(tx, id);
    const [profile] = await tx.select().from(schema.agentProfiles).where(and(eq(schema.agentProfiles.id, agentProfileId), eq(schema.agentProfiles.userId, userId))).for("update");
    if (!profile) throw new WerewolfGameError("Choose an agent you own.", 403);
    const character = await publishedCharacter(tx, profile);
    const seats = await tx.select({ seat: schema.werewolfLobbySeats, profile: schema.agentProfiles }).from(schema.werewolfLobbySeats)
      .innerJoin(schema.agentProfiles, eq(schema.agentProfiles.id, schema.werewolfLobbySeats.agentProfileId)).where(eq(schema.werewolfLobbySeats.gameId, game.id));
    const existing = seats.find(row => row.seat.agentProfileId === agentProfileId);
    if (existing) return { playerId: existing.seat.id };
    if (seats.length >= game.maxPlayers) throw new WerewolfGameError("The village is full.");
    if (seats.some(row => row.profile.userId === userId) && !await userHasAnyRole(tx, userId, ["admin", "sysop", "producer"])) throw new WerewolfGameError("You already have an agent in this game.", 403);
    for (const row of seats) {
      if (!hasEligibleAgentContent(row.profile)) continue;
      const other = await publishedCharacter(tx, row.profile);
      if (other.name.trim().toLowerCase() === character.name.trim().toLowerCase()) throw new WerewolfGameError("An agent with that name is already in this village.");
    }
    const playerId = randomUUID();
    await tx.insert(schema.werewolfLobbySeats).values({ id: playerId, gameId: game.id, agentProfileId });
    return { playerId };
  });
}

export async function leaveWerewolfLobby(db: DrizzleDB, id: string, userId: string, playerId: string) {
  return db.transaction(async tx => {
    const game = await lockLobby(tx, id);
    const [seat] = await tx.select({ id: schema.werewolfLobbySeats.id, ownerId: schema.agentProfiles.userId }).from(schema.werewolfLobbySeats)
      .innerJoin(schema.agentProfiles, eq(schema.agentProfiles.id, schema.werewolfLobbySeats.agentProfileId))
      .where(and(eq(schema.werewolfLobbySeats.id, playerId), eq(schema.werewolfLobbySeats.gameId, game.id)));
    if (!seat) throw new WerewolfGameError("Cast member not found", 404);
    if (seat.ownerId !== userId && !await userHasAnyRole(tx, userId, ["admin", "sysop", "producer"])) throw new WerewolfGameError("You can only remove your own agent.", 403);
    await tx.delete(schema.werewolfLobbySeats).where(eq(schema.werewolfLobbySeats.id, seat.id));
  });
}

export async function startWerewolfLobby(db: DrizzleDB, id: string) {
  return db.transaction(async tx => {
    const game = await lockLobby(tx, id);
    const admission = await checkGameStartAdmissionInTransaction(tx);
    if (!admission.ok) throw new WerewolfGameError(admission.error, 503);
    const config = JSON.parse(game.config);
    validateWerewolfModels(config.providerManifest);
    const rules = werewolfConfig(config.preset, config.maxDays, config.setup);
    const seats = await tx.select().from(schema.werewolfLobbySeats).where(eq(schema.werewolfLobbySeats.gameId, game.id)).orderBy(asc(schema.werewolfLobbySeats.joinedAt), asc(schema.werewolfLobbySeats.id));
    const players = await freezeWerewolfRoster(tx, seats, game.maxPlayers, normalizeWerewolfCasting(config));
    const event = startWerewolf(game.id, players, rules, randomUUID());
    await tx.insert(schema.werewolfEvents).values({ gameId: game.id, sequence: event.sequence, event });
    await tx.update(schema.games).set({ status: "in_progress", startedAt: new Date().toISOString() }).where(eq(schema.games.id, game.id));
    return { id: game.id, slug: game.slug };
  });
}

/** Public casting metadata only: no strategy, personality, private IDs or assigned roles. */
export async function readWerewolfLobby(db: DrizzleDB, id: string, includeHidden = false) {
  return db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), includeHidden ? undefined : isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id)))).for("share");
    if (!game) throw new WerewolfGameError("Game not found", 404);
    const config = JSON.parse(game.config);
    const rows = game.status === "waiting" ? await tx.select({ seat: schema.werewolfLobbySeats, profile: schema.agentProfiles, ownerPublicId: schema.users.publicId })
      .from(schema.werewolfLobbySeats).innerJoin(schema.agentProfiles, eq(schema.agentProfiles.id, schema.werewolfLobbySeats.agentProfileId))
      .innerJoin(schema.users, eq(schema.users.id, schema.agentProfiles.userId)).where(eq(schema.werewolfLobbySeats.gameId, game.id))
      .orderBy(asc(schema.werewolfLobbySeats.joinedAt), asc(schema.werewolfLobbySeats.id)) : [];
    const players = await Promise.all(rows.map(async row => {
      const identity = { id: row.seat.id, agentProfileId: row.seat.agentProfileId, ownerPublicId: row.ownerPublicId };
      if (!hasEligibleAgentContent(row.profile)) return { ...identity, name: "Unavailable agent", avatarUrl: null, personaKey: null, available: false };
      const character = await publishedCharacter(tx, row.profile);
      return { ...identity, name: character.name, avatarUrl: character.avatarUrl, personaKey: character.personaKey, available: true };
    }));
    return { id: game.id, slug: game.slug, status: game.status, started: game.startedAt !== null, playerCount: game.maxPlayers, modelLabel: modelLabelFromConfig(config), preset: config.preset as WerewolfPreset, players };
  });
}
