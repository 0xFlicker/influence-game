import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { CUTOUT_RECIPE, prepareCutoutDemands, readCutoutSource } from "./character-cutouts.js";
import { loadPayloads, payloadHash } from "./payload-storage.js";
import { werewolfReferenceMetadata } from "./werewolf-production.js";

// Explicit identities, never name/model heuristics. Missing profiles are reported.
export const EXAMPLE_MODEL_AGENTS = [
  "525f84a1-e1d2-472a-ba4e-ad3f9a9d2a53", "98b07560-c4fe-4517-b1bd-916de9f4269e",
  "c2d3db5b-1409-4e69-8a0e-2ce84fbb54f1", "8590e89f-d12e-436f-8f0b-fa56df9f4e2b",
  "24523d91-8af4-4042-9450-371512a7e011", "e33f7c5d-2c80-49fa-bbb4-8c463d119f29",
  "3013945a-84d7-4519-866c-386d1888e2b4", "7968a255-6e2e-4367-bcd6-5f2570dfa2e7",
  "50578159-9666-4157-a6c7-7d3566ceafa1",
];
export type CutoutSelection = { agent: string } | { game: string } | { scope: "example-models" };
export type CutoutSource = { gameId: string | null; agentProfileId: string | null; playerId: string; sourceKey: string };
const demands = schema.characterCutoutDemands, jobs = schema.characterCutouts;
function binding(source: CutoutSource) {
  return and(eq(demands.recipe, CUTOUT_RECIPE), eq(demands.playerId, source.playerId), eq(demands.sourceKey, source.sourceKey),
    source.gameId ? eq(demands.gameId, source.gameId) : and(isNull(demands.gameId), eq(demands.agentProfileId, source.agentProfileId!)));
}

/** Inventory has no writes, generation, lease expiry or historical identity changes. */
export async function discoverCutoutSources(db: DrizzleDB, selection: CutoutSelection) {
  const sources: CutoutSource[] = [], warnings: string[] = [];
  const agentIds = "agent" in selection ? [selection.agent] : "scope" in selection ? EXAMPLE_MODEL_AGENTS : [];
  for (const id of agentIds) {
    const [agent] = await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, id));
    if (!agent) { if ("agent" in selection) throw new Error(`Agent not found: ${id}`); warnings.push(`Agent not found: ${id}`); continue; }
    if (!agent.fullBodyReferenceUrl) { warnings.push(`No full-body image: ${id}`); continue; }
    let sourceKey = agent.fullBodyReferenceUrl;
    const revisionId = agent.moderationRequired ? agent.latestContentRevisionId : agent.contentRevisionId;
    if (revisionId) {
      const [revision] = await loadPayloads(db.select().from(schema.agentContentRevisions).where(and(
        eq(schema.agentContentRevisions.id, revisionId), eq(schema.agentContentRevisions.agentProfileId, id))));
      const assets = revision?.snapshot.assets as Record<string, string> | undefined;
      if (assets?.[sourceKey]) sourceKey = `sha256:${assets[sourceKey]}`;
    }
    sources.push({ gameId: null, agentProfileId: id, playerId: id, sourceKey });
  }
  const gameIds = new Set<string>("game" in selection ? [selection.game] : []);
  if ("scope" in selection) {
    for (const row of await db.select({ gameId: schema.gamePlayers.gameId }).from(schema.gamePlayers)
      .where(inArray(schema.gamePlayers.agentProfileId, agentIds))) gameIds.add(row.gameId);
    // Werewolf does not use Influence game_players. Its canonical started roster
    // remains discoverable even if lobby seats or current profiles disappear.
    const starts = await db.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.sequence, 1));
    for (const row of starts) if (row.event.type === "werewolf.started" && row.event.payload.players.some(p => p.agentProfileId && agentIds.includes(p.agentProfileId))) gameIds.add(row.gameId);
  }
  for (const gameId of [...gameIds].sort()) {
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
    if (!game) throw new Error(`Game not found: ${gameId}`);
    const frozen: Record<string, string> = {};
    if (game.gameKind === "werewolf") {
      const [start] = await db.select().from(schema.werewolfEvents).where(and(eq(schema.werewolfEvents.gameId, gameId), eq(schema.werewolfEvents.sequence, 1)));
      const players = start?.event.type === "werewolf.started" ? start.event.payload.players : [];
      if (!players.length) warnings.push(`No frozen started roster: ${gameId}`);
      for (const ref of await werewolfReferenceMetadata(db, gameId, players)) {
        if (ref.bodyHash) frozen[ref.profile.id] = `sha256:${ref.bodyHash}`;
        else warnings.push(`No frozen full-body image: ${gameId}/${ref.profile.id}`);
      }
    } else {
      for (const player of await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId))) {
        const profile = JSON.parse(player.persona);
        if (typeof profile.fullBodyReferenceUrl === "string" && profile.fullBodyReferenceUrl) frozen[player.id] = profile.fullBodyReferenceUrl;
      }
      const [assets] = await db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId));
      for (const member of assets?.cast ?? []) if (!member.portraitFallback) frozen[member.id] = `/api/games/${gameId}/visual/artifacts/${member.referenceArtifactId}`;
    }
    for (const [playerId, sourceKey] of Object.entries(frozen)) sources.push({ gameId, agentProfileId: null, playerId, sourceKey });
  }
  return { sources, warnings };
}

export async function inspectCutoutSources(db: DrizzleDB, sources: CutoutSource[]) {
  const rows = [];
  for (const source of sources) {
    const [demand] = await db.select().from(demands).where(binding(source));
    let job, sourceHash: string | null = null, error = demand?.error ?? null;
    if (demand?.cutoutId) [job] = await db.select().from(jobs).where(eq(jobs.id, demand.cutoutId));
    else if (!error) {
      try {
        sourceHash = source.sourceKey.startsWith("sha256:") ? source.sourceKey.slice(7) : payloadHash(await readCutoutSource(db, source));
        [job] = await db.select().from(jobs).where(and(eq(jobs.sourceHash, sourceHash), eq(jobs.recipe, CUTOUT_RECIPE)));
      } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    }
    rows.push({ ...source, demandId: demand?.id ?? null, jobId: job?.id ?? null, sourceHash: job?.sourceHash ?? sourceHash,
      status: error ? "source-failed" as const : job?.status ?? "missing" as const,
      error: error ?? job?.error ?? null, attempts: job?.attempts ?? 0, leaseUntil: job?.leaseUntil ?? null, batchJobId: job?.batchJobId ?? null,
      // Linking a preexisting derivative is necessary for Influence playback. It
      // consumes a selection slot but never creates another inference job.
      needsAssociation: !demand?.cutoutId && !demand?.error,
    });
  }
  return rows;
}
export type CutoutInventoryRow = Awaited<ReturnType<typeof inspectCutoutSources>>[number];
export function cutoutNeedsWork(row: CutoutInventoryRow) {
  return row.needsAssociation || row.status === "pending" || (["submitted", "running"].includes(row.status) && row.leaseUntil !== null && row.leaseUntil.getTime() < Date.now());
}
export function selectCutoutBatch(rows: CutoutInventoryRow[], limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Limit must be 1..100 source references");
  return rows.filter(cutoutNeedsWork).slice(0, limit);
}
export async function enqueueCutoutSelection(db: DrizzleDB, rows: CutoutInventoryRow[]) {
  const ids: string[] = [];
  for (const row of rows) {
    await db.insert(demands).values({ id: crypto.randomUUID(), gameId: row.gameId, agentProfileId: row.agentProfileId,
      playerId: row.playerId, sourceKey: row.sourceKey, recipe: CUTOUT_RECIPE }).onConflictDoNothing();
    const [demand] = await db.select().from(demands).where(binding(row));
    if (!demand) throw new Error("Demand was not persisted");
    ids.push(demand.id);
  }
  await prepareCutoutDemands(db, ids);
  return ids;
}

/** Retry is a compare-and-set on explicitly selected failures, never a lease reset. */
export async function retryCutoutFailures(db: DrizzleDB, kind: "job" | "demand", ids: string[]) {
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error("Select 1..100 distinct IDs");
  return db.transaction(async tx => {
    if (kind === "job") {
      const selected = await tx.select().from(jobs).where(and(inArray(jobs.id, ids), eq(jobs.recipe, CUTOUT_RECIPE))).for("update");
      if (selected.length !== ids.length || selected.some(job => job.status !== "failed" || job.leaseUntil || job.tokenHash)) throw new Error("Every selected job must be failed and unleased");
      await tx.update(jobs).set({ status: "pending", attempts: 0, error: null, batchJobId: null }).where(inArray(jobs.id, ids));
    } else {
      const selected = await tx.select().from(demands).where(and(inArray(demands.id, ids), eq(demands.recipe, CUTOUT_RECIPE))).for("update");
      if (selected.length !== ids.length || selected.some(demand => !demand.error || demand.cutoutId)) throw new Error("Every selected demand must have a source preparation failure");
      await tx.update(demands).set({ error: null }).where(inArray(demands.id, ids));
    }
  });
}

export async function cutoutProgress(db: DrizzleDB, demandIds: string[], jobIds: string[] = []) {
  const selectedDemands = demandIds.length ? await db.select().from(demands).where(inArray(demands.id, demandIds)).orderBy(asc(demands.id)) : [];
  const ids = [...new Set([...jobIds, ...selectedDemands.flatMap(d => d.cutoutId ? [d.cutoutId] : [])])];
  const selectedJobs = ids.length ? await db.select({ id: jobs.id, sourceHash: jobs.sourceHash, status: jobs.status, attempts: jobs.attempts,
    error: jobs.error, leaseUntil: jobs.leaseUntil, batchJobId: jobs.batchJobId, readyAt: jobs.readyAt }).from(jobs).where(inArray(jobs.id, ids)).orderBy(asc(jobs.id)) : [];
  if (selectedDemands.length !== demandIds.length || selectedJobs.length !== ids.length) throw new Error("Selected demand/job not found");
  return { demands: selectedDemands.map(({ id, cutoutId, error }) => ({ id, jobId: cutoutId, error })), jobs: selectedJobs,
    complete: selectedDemands.every(d => d.cutoutId && !d.error) && selectedJobs.every(j => j.status === "ready"),
    failed: selectedDemands.some(d => d.error) || selectedJobs.some(j => j.status === "failed") };
}
