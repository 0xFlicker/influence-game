import { authorizedModelPreference, sealRosterModelRouting, creationModelRouting } from "./game-model-routing.js";
import { queueEpisodeCopy, readEpisodePresentations } from "./episode-presentation.js";
import { parseGameVisibility } from "@influence/engine/game-visibility";
import { isViewerGame, storedGameVisibility } from "./game-visibility.js";
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
import { readPublishedWerewolfCharacters, readWerewolfCastingPlayers } from "./werewolf-cast.js";
import { hasEligibleAgentContent } from "./agent-content-eligibility.js";
import { createWerewolfHousePlayers, freezeWerewolfRoster, WerewolfGameError } from "./werewolf-games.js";

type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export async function createWerewolfLobby(db: DrizzleDB, userId: string, input: { visibility?: unknown; preset: WerewolfPreset; providerManifest?: unknown; modelRouting?: unknown; maxDays?: number; setup?: WerewolfSetup; personaPool?: unknown; fillStrategy?: unknown; visualMode?: boolean; visualFailurePolicy?: unknown }) {
  let visibility;
  try { visibility = parseGameVisibility(input.visibility); } catch { throw new WerewolfGameError("Game visibility must be public or unlisted", 400); }
  if (!enabledGameKinds().includes("werewolf")) throw new WerewolfGameError("Werewolf creation is unavailable.", 403);
  let rules;
  try { rules = werewolfConfig(input.preset, input.maxDays ?? 10, input.setup); }
  catch (error) { throw new WerewolfGameError(error instanceof Error ? error.message : "Invalid village configuration", 400); }
  const casting = normalizeWerewolfCasting(input);
  if (input.visualFailurePolicy !== undefined && input.visualFailurePolicy !== "best_effort" && input.visualFailurePolicy !== "require_visuals") throw new WerewolfGameError("Invalid visual failure policy", 400);
  if (input.visualMode !== undefined && typeof input.visualMode !== "boolean") throw new WerewolfGameError("Visual Mode must be on or off", 400);
  const modelRouting = await creationModelRouting(db, userId, { modelRouting: input.modelRouting, providerManifest: input.providerManifest });
  const id = randomUUID();
  const slug = await generateUniqueSlug(async candidate => (await db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.slug, candidate))).length > 0);
  const count = rules.setup?.playerCount ?? WEREWOLF_PRESETS[input.preset].players;
  await db.insert(schema.games).values({ id, slug, gameKind: "werewolf", gameKernel: null, createdById: userId, status: "waiting", trackType: "custom", minPlayers: count, maxPlayers: count,
    config: JSON.stringify({ preset: input.preset, setup: rules.setup, ...casting, visualMode: input.visualMode ?? false, visualFailurePolicy: input.visualFailurePolicy ?? "best_effort", maxDays: rules.maxDays, rulesVersion: rules.rulesVersion, discussionPolicy: rules.discussionPolicy, modelRouting, serviceTier: "flex", visibility }) });
  return { id, slug };
}

async function lockLobby(tx: Tx, id: string) {
  const [game] = await tx.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id)))).for("update");
  if (!game || !isViewerGame(game)) throw new WerewolfGameError("Game not found", 404);
  if (game.status !== "waiting") throw new WerewolfGameError("This game is no longer accepting cast changes.");
  return game;
}

export async function joinWerewolfLobby(db: DrizzleDB, id: string, userId: string, agentProfileId: string) {
  return db.transaction(async tx => {
    const game = await lockLobby(tx, id);
    const [profile] = await tx.select().from(schema.agentProfiles).where(and(eq(schema.agentProfiles.id, agentProfileId), eq(schema.agentProfiles.userId, userId))).for("update");
    if (!profile) throw new WerewolfGameError("Choose an agent you own.", 403);
    if (!hasEligibleAgentContent(profile)) throw new WerewolfGameError("This agent is archived or awaiting review. Remove them from the cast before starting.");
    const [character] = await readPublishedWerewolfCharacters(tx, [profile]);
    const seats = (await readWerewolfCastingPlayers(tx, [game.id])).get(game.id) ?? [];
    const existing = seats.find(seat => seat.agentProfileId === agentProfileId);
    if (existing) return { playerId: existing.id };
    if (seats.length >= game.maxPlayers) throw new WerewolfGameError("The village is full.");
    const [owner] = await tx.select({ publicId: schema.users.publicId }).from(schema.users).where(eq(schema.users.id, userId));
    if (seats.some(seat => seat.ownerPublicId === owner!.publicId) && !await userHasAnyRole(tx, userId, ["admin", "sysop", "producer"])) throw new WerewolfGameError("You already have an agent in this game.", 403);
    if (seats.some(seat => seat.available && seat.name.trim().toLowerCase() === character!.name.trim().toLowerCase())) throw new WerewolfGameError("An agent with that name is already in this village.");
    const playerId = randomUUID();
    await tx.insert(schema.werewolfLobbySeats).values({ id: playerId, gameId: game.id, agentProfileId, modelPreference: await authorizedModelPreference(tx, userId, profile.modelPreference) });
    return { playerId };
  });
}

export async function leaveWerewolfLobby(db: DrizzleDB, id: string, userId: string, playerId: string) {
  return db.transaction(async tx => {
    const game = await lockLobby(tx, id);
    const [seat] = await tx.select({ id: schema.werewolfLobbySeats.id, ownerId: schema.agentProfiles.userId }).from(schema.werewolfLobbySeats)
      .leftJoin(schema.agentProfiles, eq(schema.agentProfiles.id, schema.werewolfLobbySeats.agentProfileId))
      .where(and(eq(schema.werewolfLobbySeats.id, playerId), eq(schema.werewolfLobbySeats.gameId, game.id)));
    if (!seat) throw new WerewolfGameError("Cast member not found", 404);
    if (seat.ownerId !== userId && !await userHasAnyRole(tx, userId, ["admin", "sysop", "producer"])) throw new WerewolfGameError("You can only remove your own agent.", 403);
    await tx.delete(schema.werewolfLobbySeats).where(eq(schema.werewolfLobbySeats.id, seat.id));
  });
}

/** Fill seats durably without assigning roles, creating events, or starting a worker. */
export async function fillWerewolfLobby(db: DrizzleDB, id: string) {
  return db.transaction(async tx => {
    const game = await lockLobby(tx, id);
    const cast = (await readWerewolfCastingPlayers(tx, [game.id])).get(game.id) ?? [];
    if (cast.some(player => !player.available)) throw new WerewolfGameError("Remove unavailable agents before filling the village.");
    const config = JSON.parse(game.config);
    const players = createWerewolfHousePlayers(cast, game.maxPlayers - cast.length, normalizeWerewolfCasting(config));
    if (players.length) await tx.insert(schema.werewolfLobbySeats).values(players.map(({ id, ...houseCharacter }) => ({ id, gameId: game.id, houseCharacter })));
    return { filled: players.length, totalPlayers: cast.length + players.length };
  });
}

export async function startWerewolfLobby(db: DrizzleDB, id: string) {
  return db.transaction(async tx => {
    const game = await lockLobby(tx, id);
    const admission = await checkGameStartAdmissionInTransaction(tx);
    if (!admission.ok) throw new WerewolfGameError(admission.error, 503);
    const config = JSON.parse(game.config);

    const rules = werewolfConfig(config.preset, config.maxDays, config.setup);
    if (![7, 8, 9, 10].includes(config.rulesVersion)) throw new WerewolfGameError("Unsupported frozen Werewolf rules version");
    rules.rulesVersion = config.rulesVersion;
    if (config.rulesVersion < 9) delete rules.discussionPolicy;
    else if (config.discussionPolicy) rules.discussionPolicy = config.discussionPolicy;
    const seats = await tx.select().from(schema.werewolfLobbySeats).where(eq(schema.werewolfLobbySeats.gameId, game.id)).orderBy(asc(schema.werewolfLobbySeats.joinedAt), asc(schema.werewolfLobbySeats.id));
    if (seats.length !== game.maxPlayers) throw new WerewolfGameError("Fill all seats before starting the game.");
    const players = await freezeWerewolfRoster(tx, seats, game.maxPlayers, normalizeWerewolfCasting(config));
    const sealedConfig = await sealRosterModelRouting(tx, config, seats, false);
    const event = startWerewolf(game.id, players, rules, randomUUID());
    await tx.insert(schema.werewolfEvents).values({ gameId: game.id, sequence: event.sequence, event });
    await tx.update(schema.games).set({ status: "in_progress", startedAt: new Date().toISOString(), config: JSON.stringify({ ...sealedConfig, rulesVersion: rules.rulesVersion }) }).where(eq(schema.games.id, game.id));
    await queueEpisodeCopy(tx, game.id);
    return { id: game.id, slug: game.slug };
  });
}

/** Public casting metadata only: no strategy, personality, private IDs or assigned roles. */
export async function readWerewolfLobby(db: DrizzleDB, id: string, includeHidden = false) {
  return db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), includeHidden ? undefined : isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id)))).for("share");
    if (!game || (!includeHidden && !isViewerGame(game))) throw new WerewolfGameError("Game not found", 404);
    const config = JSON.parse(game.config);
    const players = game.status === "waiting" ? (await readWerewolfCastingPlayers(tx, [game.id])).get(game.id) ?? [] : [];
    const episode = (await readEpisodePresentations(tx, [game])).get(game.id)!;
    return { episode, id: game.id, slug: game.slug, visibility: storedGameVisibility(game.config), status: game.status, started: game.startedAt !== null, playerCount: game.maxPlayers, modelLabel: modelLabelFromConfig(config), preset: config.preset as WerewolfPreset, players };
  });
}
