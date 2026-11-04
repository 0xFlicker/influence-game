import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { championshipSchedule, createBalancedRoleSchedule, qualifyAgents, unresolvedChampionshipPolicies } from "@influence/engine/championship";
import { sealGameModelRouting } from "@influence/engine";
import { resolveWerewolfStrategy } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { ChampionshipError, type FrozenCompetitionBuild } from "./championships.js";
import { readJson, readPayload, storeBinary, storeJson, type StoredPayload } from "./payload-storage.js";
import { readVisualProfileImage } from "./visual-game-assets.js";
import { publishCharacterArt } from "./character-art-save.js";
import { renderChampionshipVisualReference, reconcileVisualAttempt, VisualRenderRecoveryRequired } from "./visual-render-journal.js";
import { hasEligibleAgentContent } from "./agent-content-eligibility.js";
import { ensureActiveAgentRevisionInTransaction, resolveFreeTrackEffectiveRuntimeSnapshot } from "./agent-revisions.js";
import { authorizedModelPreference, creationModelRouting } from "./game-model-routing.js";
import { readSeasonFinalizationSnapshot } from "./season-finalization-snapshot.js";
import { readChampionshipQualification } from "./season-read-model.js";
import { freezeChampionshipExecutionConfig } from "./championship-execution-config.js";

type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export interface ChampionshipArtDependencies {
  read(url: string, build: FrozenCompetitionBuild, db: DrizzleDB): Promise<Buffer>;
  publish(image: StoredPayload<Buffer>): Promise<string>;
  generate: typeof renderChampionshipVisualReference;
}
const production: ChampionshipArtDependencies = {
  read: async (url, build, db) => {
    if (build.character.contentRevisionId) {
      const [revision] = await db.select().from(schema.agentContentRevisions).where(eq(schema.agentContentRevisions.id, build.character.contentRevisionId));
      const snapshot = revision ? await readJson(revision.snapshot) : null;
      const hash = (snapshot?.assets as Record<string, string> | undefined)?.[url];
      if (hash) {
        const [asset] = await db.select().from(schema.agentContentAssets).where(eq(schema.agentContentAssets.hash, hash));
        if (!asset || asset.bytes.sha256 !== hash) throw new Error("Saved source artwork evidence is unavailable");
        return readPayload(asset.bytes);
      }
    }
    return readVisualProfileImage(url, { name: build.character.name, personaKey: build.character.personaKey ?? "" });
  },
  publish: publishCharacterArt, generate: renderChampionshipVisualReference,
};
let testDependencies: ChampionshipArtDependencies | null = null;
export function setChampionshipArtDependenciesForTests(value: ChampionshipArtDependencies | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("Artwork test adapters are test-only");
  testDependencies = value;
}

/** Recheck only genuine availability before lock. Missing art is preparation work, never exclusion. */
async function refreshField(tx: Tx, event: typeof schema.championshipEvents.$inferSelect) {
  const standings = await readJson(event.qualification!);
  qualifyAgents(standings); // Validate the immutable ranking before selecting alternates.
  const available = [];
  for (const candidate of [...standings].sort((a, b) => a.rank - b.rank)) {
    const [profile] = await tx.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, candidate.agentId));
    if (!profile || !hasEligibleAgentContent(profile)) {
      const reason = !profile ? "Profile unavailable" : profile.archivedAt ? "Profile archived" : "No approved playable content";
      await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId: event.id, actorId: event.lockRequestedById!,
        requestId: `qualification-skip:${event.id}:${candidate.agentId}`, action: "qualifier_unavailable",
        reason: `Rank ${candidate.rank}: ${candidate.agentId}; ${reason}. Use the next available agent in frozen Season 0 standings.` }).onConflictDoNothing();
      continue;
    }
    available.push({ candidate, profile });
    if (available.length === 8) break;
  }
  if (available.length < 8) throw new ChampionshipError("Eight available ranked agents are needed; the immutable standings contain no further alternate", 409);
  await tx.update(schema.championshipArtwork).set({ selected: false }).where(eq(schema.championshipArtwork.eventId, event.id));
  let routing: Awaited<ReturnType<typeof creationModelRouting>> | undefined;
  for (const { candidate, profile: selected } of available.sort((a, b) => a.profile.id.localeCompare(b.profile.id))) {
    const [profile] = await tx.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, selected.id)).for("update");
    if (!profile || !hasEligibleAgentContent(profile)) throw new ChampionshipError("Qualifier availability changed; retry preparation", 409);
    const [prior] = await tx.select().from(schema.championshipArtwork).where(and(eq(schema.championshipArtwork.eventId, event.id), eq(schema.championshipArtwork.agentId, profile.id)));
    if (prior) { await tx.update(schema.championshipArtwork).set({ selected: true }).where(eq(schema.championshipArtwork.id, prior.id)); continue; }
    const sourceRevisionId = profile.currentRevisionId ?? (await ensureActiveAgentRevisionInTransaction(tx, { profile, effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(profile), trigger: "profile_create" })).revision.id;
    const preference = await authorizedModelPreference(tx, profile.userId, profile.modelPreference);
    const id = randomUUID(), sealed = sealGameModelRouting(routing ??= await creationModelRouting(tx, event.lockRequestedById!, {}), [{ id, preference }], false);
    const { name, personality, backstory, strategyStyle, werewolfStrategyStyle, personaKey, gender, contentRevisionId, avatarUrl, fullBodyReferenceUrl, headPosition, portraitCrop, performanceInstructions, visualDesign } = profile;
    const build: FrozenCompetitionBuild = { version: 1, competitionRevisionId: id, agentId: profile.id, ownerId: profile.userId, sourceRevisionId, frozenAt: new Date().toISOString(),
      character: { name, personality, backstory, strategyStyle, werewolfStrategyStyle: resolveWerewolfStrategy(werewolfStrategyStyle, personaKey), personaKey, gender, contentRevisionId, avatarUrl, fullBodyReferenceUrl, headPosition, portraitCrop, performanceInstructions, visualDesign },
      modelRouting: sealed, contestantManifest: sealed.contestants![id]!, crossGameMemory: "disabled" };
    const input = await storeJson(build); await readJson(input);
    await tx.insert(schema.championshipArtwork).values({ id, eventId: event.id, agentId: profile.id, ownerId: profile.userId, qualificationRank: candidate.rank, seasonPoints: candidate.seasonPoints, input });
  }
}

export async function requestChampionshipRosterLock(db: DrizzleDB, eventId: string, actorId: string, requestId: string) {
  if (!requestId.trim()) throw new ChampionshipError("Request ID is required");
  await db.transaction(async tx => {
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId)).for("update");
    if (!event) throw new ChampionshipError("Event not found", 404);
    if (event.status !== "draft") {
      if (event.lockRequestedById === actorId && event.lockRequestId === requestId) return;
      const [prior] = await tx.select().from(schema.competitionAudit).where(and(eq(schema.competitionAudit.eventId, eventId), eq(schema.competitionAudit.actorId, actorId), eq(schema.competitionAudit.requestId, requestId), eq(schema.competitionAudit.action, "roster_locked")));
      if (prior) return; // Compatibility with previously locked events.
      throw new ChampionshipError("This event roster is already preparing or locked", 409);
    }
    const [season] = await tx.select().from(schema.seasons).where(eq(schema.seasons.id, event.sourceSeasonId)).for("update");
    if (season?.status !== "final") throw new ChampionshipError("Finalize the source season before locking its qualifying field", 409);
    const pending = unresolvedChampionshipPolicies(event.policies);
    if (pending.length || !event.startDate) throw new ChampionshipError(`Decisions still needed: ${[...pending, ...(!event.startDate ? ["startDate"] : [])].join(", ")}`, 409);
    const snapshot = await readSeasonFinalizationSnapshot(tx, season.id);
    const standings = snapshot?.qualification ?? await readChampionshipQualification(tx, season.id);
    const qualification = await storeJson(standings); await readJson(qualification);
    const [preparing] = await tx.update(schema.championshipEvents).set({ status: "preparing", qualification, lockRequestedById: actorId, lockRequestId: requestId }).where(eq(schema.championshipEvents.id, event.id)).returning();
    await refreshField(tx, preparing!);
    await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId, actorId, requestId: `prepare:${requestId}`, action: "roster_preparation_requested", reason: "Freeze competition revisions and automatically prepare required headshot/full-body artwork; no owner action" });
  });
  // Preserve fast lock for complete existing artwork. Never generate paid images in this request.
  await processChampionshipArtwork(db, { eventId, existingOnly: true, limit: 8 });
  return finishChampionshipRosterLock(db, eventId);
}

export async function finishChampionshipRosterLock(db: DrizzleDB, eventId: string) {
  return db.transaction(async tx => {
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId)).for("update");
    if (!event) throw new ChampionshipError("Event not found", 404);
    if (event.status !== "preparing") return event;
    await refreshField(tx, event);
    const art = await tx.select().from(schema.championshipArtwork).where(and(eq(schema.championshipArtwork.eventId, eventId), eq(schema.championshipArtwork.selected, true)));
    if (art.length !== 8 || art.some(row => row.status !== "ready" || !row.avatar || !row.body || !row.avatarUrl || !row.bodyUrl)) return event;
    for (const row of art) {
      const build = await readJson(row.input);
      await Promise.all([readPayload(row.avatar!), readPayload(row.body!)]);
      const originalBodyUrl = build.character.fullBodyReferenceUrl;
      build.character.avatarUrl = row.avatarUrl;
      build.character.fullBodyReferenceUrl = row.bodyUrl;
      if (build.character.headPosition?.sourceUrl === originalBodyUrl) {
        const dimensions = await sharp(await readPayload(row.body!)).metadata();
        build.character.headPosition = { ...build.character.headPosition, sourceUrl: row.bodyUrl!, sourceHash: row.body!.sha256, sourceWidth: dimensions.width!, sourceHeight: dimensions.height! };
      } else build.character.headPosition = null;
      if (build.character.portraitCrop?.sourceUrl === originalBodyUrl) build.character.portraitCrop = { ...build.character.portraitCrop, sourceUrl: row.bodyUrl! };
      build.artwork = { revisionId: row.id, avatarHash: row.avatar!.sha256, bodyHash: row.body!.sha256 };
      const stored = await storeJson(build); await readJson(stored);
      await tx.insert(schema.championshipEntries).values({ id: row.id, eventId, agentId: row.agentId, ownerId: row.ownerId, name: build.character.name, qualificationRank: row.qualificationRank, seasonPoints: row.seasonPoints, sourceRevisionId: build.sourceRevisionId, build: stored });
    }
    const execution = await storeJson(freezeChampionshipExecutionConfig(event.policies.roleComposition!));
    const roleSchedule = await storeJson(createBalancedRoleSchedule(art.map(row => row.agentId), event.policies.roleComposition!, randomUUID()));
    await Promise.all([readJson(execution), readJson(roleSchedule)]);
    await tx.insert(schema.championshipMatches).values(championshipSchedule(event.startDate!).map(match => ({ id: randomUUID(), eventId, ordinal: match.ordinal, gameKind: match.kind, scheduledAt: match.scheduledAt })));
    const [locked] = await tx.update(schema.championshipEvents).set({ status: "locked", lockedAt: new Date().toISOString(), execution, roleSchedule }).where(eq(schema.championshipEvents.id, eventId)).returning();
    await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId, actorId: event.lockRequestedById!, requestId: event.lockRequestId!, action: "roster_locked", reason: "Final season qualification and immutable competition builds with verified headshot and full-body artwork" });
    return locked!;
  });
}

export async function processChampionshipArtwork(db: DrizzleDB, options: { eventId?: string; existingOnly?: boolean; limit?: number } = {}) {
  const dependencies = testDependencies ?? production;
  const events = await db.select().from(schema.championshipEvents).where(and(eq(schema.championshipEvents.status, "preparing"), options.eventId ? eq(schema.championshipEvents.id, options.eventId) : undefined));
  const outcomes: Array<{ id: string; status: string; error?: string }> = [];
  for (const event of events) {
    // Bound work per event, so a retrying event cannot starve another preparing field.
    let processed = 0;
    try {
    await db.transaction(async tx => { const [current] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, event.id)).for("update"); if (current?.status === "preparing") await refreshField(tx, current); });
    const jobs = await db.select().from(schema.championshipArtwork).where(and(eq(schema.championshipArtwork.eventId, event.id), eq(schema.championshipArtwork.selected, true), inArray(schema.championshipArtwork.status, ["queued", "retry", "processing"]))).orderBy(asc(schema.championshipArtwork.qualificationRank));
    // Unattempted work first, then the oldest retry: one failed finalist must not starve the rest.
    jobs.sort((a, b) => (a.nextAttemptAt ?? "").localeCompare(b.nextAttemptAt ?? "") || a.qualificationRank - b.qualificationRank);
    for (const candidate of jobs) {
      if (processed >= (options.limit ?? 1)) break;
      const input = await readJson(candidate.input);
      if (options.existingOnly && (!input.character.avatarUrl || !input.character.fullBodyReferenceUrl)) continue;
      const now = new Date().toISOString(), leaseId = randomUUID();
      const [job] = await db.update(schema.championshipArtwork).set({ status: "processing", leaseId, leaseUntil: new Date(Date.now() + 15 * 60_000).toISOString(), lastError: null })
        .where(and(eq(schema.championshipArtwork.id, candidate.id), eq(schema.championshipArtwork.selected, true), inArray(schema.championshipArtwork.status, ["queued", "retry", "processing"]),
          or(isNull(schema.championshipArtwork.leaseUntil), lte(schema.championshipArtwork.leaseUntil, now)), or(isNull(schema.championshipArtwork.nextAttemptAt), lte(schema.championshipArtwork.nextAttemptAt, now)))).returning();
      if (!job) continue;
      processed++;
      const guard = async (tx?: Parameters<NonNullable<Parameters<typeof renderChampionshipVisualReference>[1]["beforeDispatch"]>>[0]) => {
        const reader = tx ?? db;
        const [current] = await reader.select().from(schema.championshipArtwork).where(eq(schema.championshipArtwork.id, job.id));
        const [currentEvent] = await reader.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, job.eventId));
        if (!current || current.leaseId !== leaseId || !current.leaseUntil || Date.parse(current.leaseUntil) <= Date.now() || !current.selected || current.status !== "processing" || currentEvent?.status !== "preparing") throw new Error("Championship artwork lease changed");
      };
      try {
        const save = async (kind: "body" | "avatar", bytes: Buffer) => {
          const normalized = await sharp(bytes).rotate().png().toBuffer();
          const ref = await storeBinary(normalized); await readPayload(ref);
          await guard();
          await db.update(schema.championshipArtwork).set({ [kind]: ref }).where(and(eq(schema.championshipArtwork.id, job.id), eq(schema.championshipArtwork.leaseId, leaseId)));
          job[kind] = ref;
        };
        for (const kind of ["avatar", "body"] as const) {
          const url = kind === "avatar" ? input.character.avatarUrl : input.character.fullBodyReferenceUrl;
          if (!job[kind] && url) await save(kind, await dependencies.read(url, input, db));
        }
        for (const kind of ["body", "avatar"] as const) if (!job[kind]) {
          if (options.existingOnly) throw new Error("Missing required artwork awaits automatic preparation");
          const reference = kind === "body" ? job.avatar : job.body;
          const refs = reference ? [await readPayload(reference)] : [];
          const character = input.character;
          const prompt = `Create a photorealistic ${kind === "body" ? "full-body character reference, entire character and feet visible" : "headshot portrait, head and shoulders clearly visible"} for the adult House contestant ${character.name}. Exactly one character, plain warm grey background, no text or inset. ${refs.length ? "Preserve the reference character's exact face, species or object form, colors, clothing and distinguishing features; this is the same character, not a redesign." : "Honor the character description and any non-human or anthropomorphic identity; do not default it to a human."} Visual design: ${character.visualDesign?.trim() || character.personaKey || ""}. Recorded gender: ${character.gender ?? "unspecified"}. Identity: ${character.personality}. Backstory: ${character.backstory ?? ""}. Direction: ${character.performanceInstructions ?? ""}.`;
          await save(kind, await dependencies.generate(db, { preparationId: job.id, kind, request: { prompt, width: 1024, height: kind === "body" ? 1536 : 1024, references: refs }, beforeDispatch: guard }));
        }
        const avatarUrl = job.avatarUrl ?? await dependencies.publish(job.avatar!);
        const bodyUrl = job.bodyUrl ?? await dependencies.publish(job.body!);
        await guard();
        await db.update(schema.championshipArtwork).set({ avatarUrl, bodyUrl, status: "ready", leaseId: null, leaseUntil: null, nextAttemptAt: null, lastError: null }).where(and(eq(schema.championshipArtwork.id, job.id), eq(schema.championshipArtwork.leaseId, leaseId)));
        outcomes.push({ id: job.id, status: "ready" });
      } catch (error) {
        const message = error instanceof VisualRenderRecoveryRequired ? `${error.message} (operation ${error.operationId})` : error instanceof Error ? error.message : "Artwork preparation failed";
        await db.update(schema.championshipArtwork).set({ status: "retry", leaseId: null, leaseUntil: null, nextAttemptAt: new Date(Date.now() + 30_000).toISOString(), lastError: message.slice(0, 2000) }).where(and(eq(schema.championshipArtwork.id, job.id), eq(schema.championshipArtwork.leaseId, leaseId)));
        outcomes.push({ id: job.id, status: "retry", error: message });
      }
    }
    await finishChampionshipRosterLock(db, event.id);
    } catch (error) {
      outcomes.push({ id: event.id, status: "retry", error: error instanceof Error ? error.message : "Field preparation deferred" });
    }
  }
  return outcomes;
}

/** Producer recovery for an uncertain provider response; never an agent-owner approval. */
export async function readChampionshipArtAttempts(db: DrizzleDB, eventId: string, preparationId: string) {
  const [art] = await db.select().from(schema.championshipArtwork).where(and(eq(schema.championshipArtwork.id, preparationId), eq(schema.championshipArtwork.eventId, eventId)));
  if (!art) throw new ChampionshipError("Artwork preparation not found", 404);
  return db.select({ id: schema.visualRenderAttempts.id, operationId: schema.visualRenderOperations.id, kind: schema.visualRenderOperations.operationKey,
    generation: schema.visualRenderAttempts.generation, provider: schema.visualRenderAttempts.provider, receipt: schema.visualRenderAttempts.receipt,
    costMicrousd: schema.visualRenderAttempts.costMicrousd, reconciliation: schema.visualRenderAttempts.reconciliation })
    .from(schema.visualRenderAttempts).innerJoin(schema.visualRenderOperations, eq(schema.visualRenderOperations.id, schema.visualRenderAttempts.operationId))
    .where(and(eq(schema.visualRenderOperations.userId, art.ownerId), inArray(schema.visualRenderOperations.operationKey, [`championship-art:${art.id}:body`, `championship-art:${art.id}:avatar`])));
}
export async function reconcileChampionshipArtAttempt(db: DrizzleDB, input: { eventId: string; preparationId: string; attemptId: string; actorId: string; note: string; costMicrousd: number }) {
  const attempts = await readChampionshipArtAttempts(db, input.eventId, input.preparationId);
  const attempt = attempts.find(row => row.id === input.attemptId);
  if (!attempt) throw new ChampionshipError("Attempt is outside this championship preparation", 404);
  const [art] = await db.select().from(schema.championshipArtwork).where(eq(schema.championshipArtwork.id, input.preparationId));
  if (art?.status === "processing" && art.leaseUntil && Date.parse(art.leaseUntil) > Date.now()) throw new ChampionshipError("Artwork provider work is still in progress", 409);
  if (attempt.reconciliation) {
    if (attempt.reconciliation.operatorId !== input.actorId || attempt.reconciliation.note !== input.note || attempt.costMicrousd !== input.costMicrousd) throw new ChampionshipError("Attempt already reconciled with different evidence", 409);
  } else await reconcileVisualAttempt(db, { attemptId: input.attemptId, operatorId: input.actorId, note: input.note, costMicrousd: input.costMicrousd });
  await db.insert(schema.competitionAudit).values({ id: randomUUID(), eventId: input.eventId, actorId: input.actorId,
    requestId: `art-reconcile:${input.attemptId}`, action: "artwork_attempt_reconciled", reason: `${input.note}; recorded cost ${input.costMicrousd} micro-USD; attempt ${input.attemptId}` }).onConflictDoNothing();
  await db.update(schema.championshipArtwork).set({ nextAttemptAt: null }).where(eq(schema.championshipArtwork.id, input.preparationId));
  return { reconciled: true };
}
