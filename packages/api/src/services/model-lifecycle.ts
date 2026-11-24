import { isHouseModelCutoffActive, isModelRetired } from "@influence/engine/model-route-metadata";
import { modelCatalogEntryById, normalizeProviderManifest, type GameProviderManifest, type GameProviderManifestEntry } from "@influence/engine/model-catalog";
import { assertCurrentGameModelRouting, assertModelEntitlement, gameModelPolicy, normalizeGameModelRouting, type GameModelRouting, type ModelPreference } from "@influence/engine/game-model-routing";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { userHasAnyRole } from "../db/rbac.js";
import { lifecycleDefaultManifest, MODEL_LIFECYCLE_KEY, readModelLifecycle, type ModelLifecycleSettings } from "./model-lifecycle-settings.js";
import { sha256StableJson } from "./stable-hash.js";

export class ModelLifecycleError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 409 = 400) { super(message); }
}

export interface ModelLifecycleChange {
  sourceCatalogId: string;
  cutoffDate: string;
  replacementCatalogId: string;
}

type Reader = Pick<DrizzleDB, "select">;

async function requireLifecycleAdmin(db: Reader, userId: string) {
  if (!await userHasAnyRole(db, userId, ["admin", "sysop"])) throw new ModelLifecycleError("Model lifecycle requires admin access.", 403);
}

export async function listModelLifecycle(db: Reader, userId: string) {
  await requireLifecycleAdmin(db, userId);
  const settings = await readModelLifecycle(db);
  return { cutoffs: settings.cutoffs, defaultManifest: lifecycleDefaultManifest(settings) };
}

function readChange(value: unknown, settings: ModelLifecycleSettings) {
  const { sourceCatalogId, cutoffDate, replacementCatalogId } = value as Partial<ModelLifecycleChange> ?? {};
  if (typeof sourceCatalogId !== "string" || typeof replacementCatalogId !== "string" || sourceCatalogId === replacementCatalogId) {
    throw new ModelLifecycleError("Choose two distinct provider-qualified models.");
  }
  if (typeof cutoffDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)
    || new Date(cutoffDate).toJSON()?.slice(0, 10) !== cutoffDate) throw new ModelLifecycleError("Enter a valid UTC cutoff date.");
  const source = modelCatalogEntryById(sourceCatalogId);
  const replacement = modelCatalogEntryById(replacementCatalogId);
  if (!source?.metadata.documented) throw new ModelLifecycleError("Choose a documented source model.");
  if (!replacement?.metadata.documented || !replacement.capabilities.supportsStructuredOutput) {
    throw new ModelLifecycleError("Choose a documented replacement that supports game decisions.");
  }
  const providerRetirementDate = source.metadata.documented.deprecation?.retirementDate ?? null;
  if (providerRetirementDate && cutoffDate > providerRetirementDate) throw new ModelLifecycleError("The House cutoff must be on or before the provider retirement date.");
  try {
    assertModelEntitlement({ catalogId: replacementCatalogId }, true, settings.cutoffs);
  } catch (error) {
    throw new ModelLifecycleError(error instanceof Error ? error.message : "The replacement is ineligible.");
  }
  const cutoff = new Date(cutoffDate);
  if (isModelRetired(replacement.metadata.documented, cutoff) || isHouseModelCutoffActive(settings.cutoffs[replacementCatalogId], cutoff)) {
    throw new ModelLifecycleError("The replacement must still be eligible on The House cutoff date.");
  }
  return { change: { sourceCatalogId, cutoffDate, replacementCatalogId }, source, replacement, providerRetirementDate };
}

async function planMigration(db: Reader, userId: string, value: unknown, settings: ModelLifecycleSettings, lock: boolean) {
  const { change, source, replacement, providerRetirementDate } = readChange(value, settings);
  const { sourceCatalogId, replacementCatalogId } = change;
  const replace = (entry: GameProviderManifestEntry): GameProviderManifestEntry => {
    if (entry.catalogId !== sourceCatalogId) return entry;
    const effort = entry.reasoningPolicy;
    return { ...entry, catalogId: replacementCatalogId, reasoningPolicy: !effort || effort === "action-policy" || replacement.allowedReasoningEfforts.includes(effort)
      ? effort ?? replacement.defaultReasoningPolicy : replacement.defaultReasoningPolicy };
  };
  const preference = (entry: ModelPreference): ModelPreference => entry === "default" ? entry : replace(entry);
  const manifest = (entries: GameProviderManifest) => {
    const seen = new Set<string>();
    return normalizeProviderManifest(entries.map(replace).filter(entry => !seen.has(entry.catalogId) && seen.add(entry.catalogId)));
  };
  const patchPolicy = (policy: GameModelRouting) => normalizeGameModelRouting({
    ...policy,
    defaultManifest: manifest(policy.defaultManifest),
    houseManifest: manifest(policy.houseManifest),
    overrides: Object.fromEntries(Object.entries(policy.overrides).map(([id, entry]) => [id, preference(entry)])),
    // An exclusion applies to the exact old model. Existing replacement exclusions
    // are respected by normalizeGameModelRouting and by the seat check below.
    excludedCatalogIds: policy.excludedCatalogIds,
  });

  // Serialize with game start before acquiring character locks. Championship
  // assignments can already be frozen outside games.config while still waiting.
  const games = schema.games;
  const players = schema.gamePlayers;
  const wolves = schema.werewolfLobbySeats;
  const matches = schema.championshipMatches;
  const attempts = schema.championshipMatchAttempts;
  const gamesQuery = db.select({ id: games.id, slug: games.slug, kind: games.gameKind, config: games.config }).from(games).where(and(
    eq(games.status, "waiting"),
    sql`not exists (select 1 from ${matches} where ${matches.gameId} = ${games.id})`,
    sql`not exists (select 1 from ${attempts} where ${attempts.gameId} = ${games.id})`,
    sql`(strpos(${games.config}, ${sourceCatalogId}) > 0
      or exists (select 1 from ${players} where ${players.gameId} = ${games.id} and ${players.modelPreference}->>'catalogId' = ${sourceCatalogId})
      or exists (select 1 from ${wolves} where ${wolves.gameId} = ${games.id} and ${wolves.modelPreference}->>'catalogId' = ${sourceCatalogId}))`,
  )).orderBy(asc(games.id));
  const waiting = (lock ? await gamesQuery.for("update") : await gamesQuery).flatMap(game => {
    const config = JSON.parse(game.config) as Record<string, unknown>;
    const policy = config.modelRouting;
    if (policy && typeof policy === "object" && (Object.hasOwn(policy, "contestants") || Object.hasOwn(policy, "frozenRoutes"))) return [];
    return [{ ...game, config }];
  });

  const profilesTable = schema.agentProfiles;
  const profilesQuery = db.select({ id: profilesTable.id, userId: profilesTable.userId, name: profilesTable.name, before: profilesTable.modelPreference })
    .from(profilesTable).where(and(isNull(profilesTable.archivedAt), sql`${profilesTable.modelPreference}->>'catalogId' = ${sourceCatalogId}`)).orderBy(asc(profilesTable.id));
  const profiles = (lock ? await profilesQuery.for("update") : await profilesQuery)
    .map(profile => ({ ...profile, after: preference(profile.before) }));
  const gameIds = waiting.map(game => game.id);
  const seatRows = gameIds.length === 0 ? [] : (await Promise.all([players, wolves].map(table =>
    db.select({ id: table.id, gameId: table.gameId, userId: profilesTable.userId, before: table.modelPreference })
      .from(table).leftJoin(profilesTable, eq(profilesTable.id, table.agentProfileId))
      .where(and(inArray(table.gameId, gameIds), sql`${table.modelPreference}->>'catalogId' = ${sourceCatalogId}`))
      .orderBy(asc(table.id)),
  ))).flat();
  const blocked: string[] = [];
  const lobbies = waiting.flatMap(game => {
    const before = gameModelPolicy(game.config);
    const referencesSource = [...before.defaultManifest, ...before.houseManifest, ...Object.values(before.overrides)]
      .some(entry => entry !== "default" && entry.catalogId === sourceCatalogId);
    const seats = seatRows.filter(seat => seat.gameId === game.id).map(seat => ({ ...seat, after: preference(seat.before) }));
    let after = before;
    try {
      const candidate = patchPolicy(before);
      if (seats.some(seat => !Object.hasOwn(candidate.overrides, seat.id)) && candidate.excludedCatalogIds.includes(replacementCatalogId)) {
        throw new Error("The lobby excludes the replacement.");
      }
      after = candidate;
    } catch (error) {
      blocked.push(`${game.slug} — ${error instanceof Error ? error.message : "Invalid route."}`);
    }
    const routeChanged = sha256StableJson(before) !== sha256StableJson(after);
    return seats.length || referencesSource ? [{ id: game.id, slug: game.slug, kind: game.kind, before, after, seats, routeChanged, config: game.config }] : [];
  });
  const owners = [...new Set([...profiles.map(profile => profile.userId),
    ...lobbies.flatMap(lobby => lobby.seats.flatMap(seat => seat.userId && !Object.hasOwn(lobby.after.overrides, seat.id) ? [seat.userId] : []))])];
  if (owners.length) {
    const privileged = new Set((await db.select({ userId: schema.userRoles.userId }).from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(and(inArray(schema.userRoles.userId, owners), inArray(schema.roles.name, ["admin", "sysop"])))).map(row => row.userId));
    const restricted = owners.filter(id => !privileged.has(id)).length;
    try { if (restricted) assertModelEntitlement({ catalogId: replacementCatalogId }, false, settings.cutoffs); }
    catch { blocked.push(`${restricted} affected account(s) cannot select this replacement. Choose an eligible model.`); }
  }

  const defaultsBefore = lifecycleDefaultManifest(settings);
  const defaultsAfter = manifest(defaultsBefore);
  const defaultsChanged = sha256StableJson(defaultsBefore) !== sha256StableJson(defaultsAfter);
  const cutoff = { cutoffDate: change.cutoffDate, replacementCatalogId };
  if (defaultsChanged) {
    const cutoffs = { ...settings.cutoffs, [sourceCatalogId]: cutoff };
    assertCurrentGameModelRouting(gameModelPolicy({ providerManifest: defaultsAfter }), cutoffs);
  }
  const summary = {
    change, providerRetirementDate,
    sourceRateCard: source.metadata.rateCard, replacementRateCard: replacement.metadata.rateCard,
    accountCount: new Set(profiles.map(profile => profile.userId)).size,
    profiles,
    lobbies: lobbies.map(({ config: _config, ...lobby }) => lobby),
    defaults: { before: defaultsBefore, after: defaultsAfter, changed: defaultsChanged },
    blocked,
  };
  return { ...summary, lobbies, previewId: sha256StableJson({ userId, settings, summary }) };
}

export async function previewModelMigration(db: DrizzleDB, userId: string, value: unknown) {
  await requireLifecycleAdmin(db, userId);
  const plan = await planMigration(db, userId, value, await readModelLifecycle(db), false);
  return { ...plan, lobbies: plan.lobbies.map(({ config: _config, ...lobby }) => lobby) };
}

export async function applyModelMigration(db: DrizzleDB, userId: string, value: unknown, previewId: unknown) {
  await requireLifecycleAdmin(db, userId);
  if (typeof previewId !== "string") throw new ModelLifecycleError("Preview the migration before approving it.");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${MODEL_LIFECYCLE_KEY}))`);
    await requireLifecycleAdmin(tx, userId);
    const settings = await readModelLifecycle(tx);
    const { change } = readChange(value, settings);
    const prior = settings.cutoffs[change.sourceCatalogId];
    if (prior?.previewId === previewId && prior.approvedBy === userId && prior.cutoffDate === change.cutoffDate
      && prior.replacementCatalogId === change.replacementCatalogId) return { rule: prior };
    const plan = await planMigration(tx, userId, change, settings, true);
    if (plan.previewId !== previewId) throw new ModelLifecycleError("The affected routes or accounts changed. Preview again before approving.", 409);
    if (plan.blocked.length) throw new ModelLifecycleError("Resolve the issues in the preview before approving.", 409);
    const approvedAt = new Date().toISOString();
    for (const profile of plan.profiles) {
      await tx.update(schema.agentProfiles).set({ modelPreference: profile.after, updatedAt: approvedAt }).where(eq(schema.agentProfiles.id, profile.id));
    }
    for (const lobby of plan.lobbies) {
      if (lobby.routeChanged) {
        const { providerManifest: _manifest, modelSelection: _selection, ...remaining } = lobby.config;
        await tx.update(schema.games).set({ config: JSON.stringify({ ...remaining, modelRouting: lobby.after }) }).where(eq(schema.games.id, lobby.id));
      }
      const table = lobby.kind === "werewolf" ? schema.werewolfLobbySeats : schema.gamePlayers;
      for (const seat of lobby.seats) {
        await tx.update(table).set({ modelPreference: seat.after }).where(and(eq(table.id, seat.id), eq(table.gameId, lobby.id)));
      }
    }
    const rule = { cutoffDate: change.cutoffDate, replacementCatalogId: change.replacementCatalogId, approvedAt, approvedBy: userId, previewId };
    const next = { cutoffs: { ...settings.cutoffs, [change.sourceCatalogId]: rule }, defaultManifest: plan.defaults.changed ? plan.defaults.after : settings.defaultManifest };
    await tx.insert(schema.appSettings).values({ key: MODEL_LIFECYCLE_KEY, value: JSON.stringify(next), updatedAt: approvedAt }).onConflictDoUpdate({
      target: schema.appSettings.key, set: { value: JSON.stringify(next), updatedAt: approvedAt },
    });
    return { rule };
  });
}
