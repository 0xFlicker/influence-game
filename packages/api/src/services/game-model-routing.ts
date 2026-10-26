import { and, eq, or, inArray, sql } from "drizzle-orm";
import { summarizeModelRouting, actorProviderManifest, assertModelEntitlement, contestantManifest, gameModelPolicy, normalizeGameModelRouting, normalizeModelPreference, sealGameModelRouting, type ModelPreference } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { userHasAnyRole } from "../db/rbac.js";

export class GameModelRoutingError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) { super(message); }
}
function modelInput<T>(read: () => T): T {
  try { return read(); } catch (error) { throw new GameModelRoutingError(error instanceof Error ? error.message : "Invalid model settings"); }
}

type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

export async function authorizedModelPreference(db: Pick<DrizzleDB, "select">, userId: string, value: unknown): Promise<ModelPreference> {
  const preference = modelInput(() => normalizeModelPreference(value));
  const privileged = await userHasAnyRole(db, userId, ["admin", "sysop"]);
  try { assertModelEntitlement(preference, privileged); } catch (error) { throw new GameModelRoutingError(error instanceof Error ? error.message : "Model access denied", 403); }
  return preference;
}

export async function creationModelRouting(db: Pick<DrizzleDB, "select">, userId: string, config: Record<string, unknown>) {
  if (["modelRouting", "providerManifest", "modelSelection", "serviceTier"].some(key => config[key] !== undefined)
    && !await userHasAnyRole(db, userId, ["admin", "sysop"])) throw new GameModelRoutingError("Game model settings require admin or sysop access", 403);
  if (config.serviceTier !== undefined && config.serviceTier !== "flex" && config.serviceTier !== "auto") throw new GameModelRoutingError("Invalid service tier");
  if (config.modelRouting && typeof config.modelRouting === "object" && ("contestants" in config.modelRouting || "frozenRoutes" in config.modelRouting)) throw new GameModelRoutingError("Clients cannot supply sealed model assignments");
  const policy = modelInput(() => gameModelPolicy(config));
  return policy;
}

/** Operational preference is separate from character content/moderation revisions. */
export async function saveModelPreference(db: DrizzleDB, userId: string, profileId: string, value: unknown) {
  return db.transaction(async tx => {
    const [profile] = await tx.select().from(schema.agentProfiles).where(and(eq(schema.agentProfiles.id, profileId), eq(schema.agentProfiles.userId, userId))).for("update");
    if (!profile) throw new GameModelRoutingError("Choose a character you own", 403);
    const modelPreference = await authorizedModelPreference(tx, userId, value);
    await tx.update(schema.agentProfiles).set({ modelPreference, updatedAt: new Date().toISOString() }).where(eq(schema.agentProfiles.id, profileId));
    return { modelPreference };
  });
}

/** Caller holds the game row lock; ownership and entitlement are checked at start. */
export async function sealRosterModelRouting(tx: Tx, config: Record<string, unknown>, seats: Array<{ id: string; agentProfileId?: string | null; modelPreference?: ModelPreference }>, needsImages = config.visualMode === true) {
  const policy = modelInput(() => gameModelPolicy(config));
  for (const seat of seats) {
    if (Object.hasOwn(policy.overrides, seat.id) || !seat.agentProfileId) continue;
    const [profile] = await tx.select({ userId: schema.agentProfiles.userId }).from(schema.agentProfiles).where(eq(schema.agentProfiles.id, seat.agentProfileId));
    if (!profile) throw new GameModelRoutingError("A contestant profile is no longer available");
    await authorizedModelPreference(tx, profile.userId, seat.modelPreference);
  }
  const modelRouting = modelInput(() => sealGameModelRouting(policy, seats.map(seat => ({ id: seat.id, preference: seat.modelPreference })), needsImages));
  // The new routing document is the sole execution authority. Old running games
  // retain their existing manifest; only a waiting game crosses this boundary.
  const { providerManifest: _manifest, modelSelection: _selection, ...rest } = config;
  return { ...rest, serviceTier: config.serviceTier ?? "flex", modelRouting };
}

export async function readGameModelRouting(db: DrizzleDB, userId: string, gameId: string, update?: unknown) {
  if (!await userHasAnyRole(db, userId, ["admin", "sysop"])) throw new GameModelRoutingError("Game model settings require admin or sysop access", 403);
  return db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(or(eq(schema.games.id, gameId), eq(schema.games.slug, gameId))).for("update");
    if (!game) throw new GameModelRoutingError("Game not found");
    const config = JSON.parse(game.config) as Record<string, unknown>;
    const seats = game.gameKind === "werewolf"
      ? await tx.select().from(schema.werewolfLobbySeats).where(eq(schema.werewolfLobbySeats.gameId, game.id))
      : await tx.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, game.id));
    const profileIds = seats.flatMap(seat => seat.agentProfileId ? [seat.agentProfileId] : []);
    const profiles = profileIds.length ? await tx.select({ id: schema.agentProfiles.id, name: schema.agentProfiles.name }).from(schema.agentProfiles).where(inArray(schema.agentProfiles.id, profileIds)) : [];
    const policy = modelInput(() => update === undefined ? gameModelPolicy(config) : normalizeGameModelRouting(update));
    if (update !== undefined) {
      if (game.status !== "waiting") throw new GameModelRoutingError("Model settings are frozen once the game starts");
      if (policy.contestants || (update && typeof update === "object" && "frozenRoutes" in update)) throw new GameModelRoutingError("Clients cannot supply sealed model assignments");
      // Validate all occupied seats before saving; empty rosters remain editable.
      modelInput(() => sealGameModelRouting(policy, seats.map(seat => ({ id: seat.id, preference: seat.modelPreference })), game.gameKind !== "werewolf" && config.visualMode === true));
      const { providerManifest: _manifest, modelSelection: _selection, ...rest } = config;
      await tx.update(schema.games).set({ config: JSON.stringify({ ...rest, serviceTier: "flex", modelRouting: policy }) }).where(eq(schema.games.id, game.id));
    }
    const attempts = await tx.select({ preferredCatalogId: schema.providerLogicalCalls.preferredCatalogId, actorId: schema.providerLogicalCalls.actorId, actorRole: schema.providerLogicalCalls.actorRole,
      semantic: schema.providerLogicalCalls.semanticCoordinate, id: schema.providerCallAttempts.id, accepted: schema.providerLogicalCalls.acceptedAttemptId, catalogId: schema.providerCallAttempts.catalogId,
      failure: schema.providerCallAttempts.outcomeKind, estimated: schema.gameProviderSpendEntries.estimatedCostMicrousd, actual: schema.gameProviderSpendEntries.actualCostMicrousd })
      .from(schema.providerCallAttempts).innerJoin(schema.providerLogicalCalls, eq(schema.providerLogicalCalls.id, schema.providerCallAttempts.logicalCallId))
      .leftJoin(schema.gameProviderSpendEntries, eq(schema.gameProviderSpendEntries.sourceKey, sql`'provider-attempt:' || ${schema.providerCallAttempts.id}`))
      .where(eq(schema.providerCallAttempts.gameId, game.id));
    const report = summarizeModelRouting(attempts.map(attempt => ({ actorId: ["house", "system", "producer"].includes(attempt.actorRole) ? "house" : attempt.actorId ?? "unknown",
      preferredCatalogId: attempt.preferredCatalogId ?? actorProviderManifest(config, { id: attempt.actorId, role: attempt.actorRole })[0]!.catalogId,
      decision: (attempt.semantic as { kind?: string } | null)?.kind !== "context_compaction", actualCatalogId: attempt.catalogId ?? "unknown", accepted: attempt.accepted === attempt.id, failure: attempt.failure ?? "unresolved",
      estimatedCostMicrousd: attempt.estimated, actualCostMicrousd: attempt.actual })));
    // Rules-legal engine outcomes come from canonical typed fields, never prose
    // or the absence of an accepted provider result.
    const unavailableOutcomes: Array<{ actorId: string; action: string; reason: string; sequence: number }> = [];
    let seed: string | null = null;
    if (game.gameKind === "werewolf") {
      const events = await tx.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId, game.id));
      for (const { event, sequence } of events) {
        if (event.type === "werewolf.started") seed = event.payload.seed;
        if (event.type === "werewolf.action_accepted" && event.payload.fallback) unavailableOutcomes.push({ actorId: event.payload.actorId, action: event.payload.action, reason: event.payload.fallback, sequence });
      }
    } else {
      const events = await tx.select({ pointers: schema.gameEvents.sourcePointers, sequence: schema.gameEvents.sequence }).from(schema.gameEvents).where(eq(schema.gameEvents.gameId, game.id));
      for (const event of events) for (const pointer of event.pointers ?? []) {
        const fallback = pointer.engineFallback as { source?: string; reason?: string } | undefined;
        if (fallback?.source === "engine" && typeof fallback.reason === "string" && typeof pointer.actorId === "string" && typeof pointer.action === "string") unavailableOutcomes.push({ actorId: pointer.actorId, action: pointer.action, reason: fallback.reason, sequence: event.sequence });
      }
    }
    return { policy, report, unavailableOutcomes, reproducibility: { gameId: game.id, gameKind: game.gameKind, seed, seedAuthority: game.gameKind === "werewolf" ? "werewolf.started" : "immutable game-turn intents in the API journal" }, frozen: game.status !== "waiting", seats: seats.map(seat => ({ id: seat.id, name: profiles.find(profile => profile.id === seat.agentProfileId)?.name ?? ("persona" in seat ? JSON.parse(seat.persona).name : seat.houseCharacter?.name) ?? seat.id, agentProfileId: seat.agentProfileId,
      preference: seat.modelPreference, source: Object.hasOwn(policy.overrides, seat.id) ? "override" : seat.modelPreference === "default" ? "game_default" : "enrollment",
      manifest: policy.contestants?.[seat.id] ?? contestantManifest(policy, policy.overrides[seat.id] ?? seat.modelPreference, game.gameKind !== "werewolf" && config.visualMode === true) })) };
  });
}
