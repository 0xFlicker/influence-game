import { loadPayloads } from "./payload-storage.js";
import { readWerewolfVisualPause } from "./werewolf-visual-policy.js";
import { visualFailurePolicy } from "./visual-policy.js";
import { werewolfSceneInventory } from "@influence/engine/werewolf/visual-scenes";
import { asc, eq, inArray } from "drizzle-orm";
import { replayWerewolf, type WerewolfEvent, type WerewolfPlayer } from "@influence/engine/werewolf";
import type { FrozenVisualProfile } from "@influence/engine/visual-mode";
import type { VisualCastMember } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { readWerewolfEvents } from "./werewolf-games.js";
import { readVisualMedia, readVisualSceneStaging } from "./visual-media-repair.js";
import { readVisualRenderAccounting } from "./visual-render-journal.js";
import { readVisualProfileImage } from "./visual-game-assets.js";
import { storeVisualArtifact } from "./visual-scene-store.js";
import { sha256StableJson } from "./stable-hash.js";

export const WEREWOLF_AUTO_PUBLISHER = "house:werewolf:auto";

export class WerewolfReferenceError extends Error {}

/** Frozen cast metadata only: viewer polls never load image bytes or mutable profiles. */
export async function werewolfReferenceMetadata(db: Pick<DrizzleDB, "select">, gameId: string, players?: readonly WerewolfPlayer[], options: { availableHashes?: readonly string[] } = {}) {
  const cast = players ?? (await readWerewolfEvents(db, gameId)).find(event => event.type === "werewolf.started")?.payload.players ?? [];
  const revisionIds = cast.flatMap(player => player.contentRevisionId ? [player.contentRevisionId] : []);
  const revisions = revisionIds.length ? await loadPayloads(db.select().from(schema.agentContentRevisions)
    .where(inArray(schema.agentContentRevisions.id, revisionIds))) : [];
  const members = cast.map(player => {
    const snapshot = revisions.find(revision => revision.id === player.contentRevisionId && revision.agentProfileId === player.agentProfileId)?.snapshot;
    const assets = snapshot?.assets;
    const hashFor = (field: string) => {
      const url = snapshot?.[field];
      const hash = typeof url === "string" && assets && typeof assets === "object" && !Array.isArray(assets)
        ? (assets as Record<string, unknown>)[url] : null;
      return typeof hash === "string" ? hash : null;
    };
    return { player, snapshot, bodyHash: hashFor("fullBodyReferenceUrl"), portraitHash: hashFor("avatarUrl") };
  });
  const hashes = members.flatMap(member => [member.bodyHash, member.portraitHash].filter((hash): hash is string => hash !== null));
  const available = new Set(hashes.length ? (await db.select({ hash: schema.agentContentAssets.hash }).from(schema.agentContentAssets)
    .where(inArray(schema.agentContentAssets.hash, hashes))).map(asset => asset.hash) : []);
  if (options.availableHashes) {
    if (options.availableHashes.some(hash => !hashes.includes(hash))) throw new WerewolfReferenceError("Pinned character asset is not an immutable game-start reference");
    const pinned = new Set(options.availableHashes);
    for (const hash of available) if (!pinned.has(hash)) available.delete(hash);
  }
  return members.map(({ player, snapshot, bodyHash, portraitHash }) => {
    const bundled = !player.agentProfileId;
    const body = bodyHash && available.has(bodyHash) ? bodyHash : null;
    const portrait = portraitHash && available.has(portraitHash) ? portraitHash : null;
    const kind = bundled ? "portrait" : body ? "full_body" : portrait ? "portrait" : "missing";
    const profile: FrozenVisualProfile = { id: player.id, name: player.name, personaKey: player.personaKey ?? "", avatarUrl: null,
      fullBodyReferenceUrl: kind === "full_body" ? String(snapshot!.fullBodyReferenceUrl) : null,
      performanceInstructions: typeof snapshot?.performanceInstructions === "string" ? snapshot.performanceInstructions : "" };
    return { profile, kind, bodyHash: body, portraitHash: portrait, bundled };
  });
}

/** Production loads immutable submitted bytes; viewer reads use metadata above. */
export async function werewolfReferences(db: DrizzleDB, gameId: string) {
  const refs = await werewolfReferenceMetadata(db, gameId);
  const hashes = refs.flatMap(ref => [ref.bodyHash, ref.portraitHash].filter((hash): hash is string => hash !== null));
  const assets = hashes.length ? await loadPayloads(db.select().from(schema.agentContentAssets).where(inArray(schema.agentContentAssets.hash, hashes))) : [];
  const bytes = (hash: string | null) => assets.find(asset => asset.hash === hash)?.bytes ?? null;
  return refs.map(ref => ({ ...ref, bytes: bytes(ref.bodyHash ?? ref.portraitHash), portraitBytes: bytes(ref.portraitHash) }));
}

export async function freezeWerewolfReferences(db: DrizzleDB, gameId: string, participants: Array<{ id: string; name: string }>) {
  const refs = await werewolfReferences(db, gameId);
  await db.insert(schema.visualGameAssets).values({ gameId, profiles: refs.map(ref => ref.profile) }).onConflictDoNothing();
  const [assets] = await db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId));
  const cast: VisualCastMember[] = [];
  for (const participant of participants) {
    const saved = assets?.cast.find(member => member.id === participant.id);
    if (saved) { cast.push(saved); continue; }
    const ref = refs.find(ref => ref.profile.id === participant.id && ref.profile.name === participant.name);
    if (!ref || ref.kind === "missing") throw new WerewolfReferenceError(`Frozen reference unavailable for ${participant.name}. No current profile was substituted.`);
    const bytes = ref.bytes ?? await readVisualProfileImage(null, ref.profile);
    cast.push({ id: participant.id, name: participant.name, referenceArtifactId: await storeVisualArtifact(db, gameId, bytes),
      performanceInstructions: ref.profile.performanceInstructions, portraitFallback: ref.kind !== "full_body" });
  }
  await db.transaction(async tx => {
    const [current] = await tx.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId)).for("update");
    if (!current) throw new Error("Frozen references missing");
    await tx.update(schema.visualGameAssets).set({ cast: [...current.cast, ...cast.filter(member => !current.cast.some(saved => saved.id === member.id))] }).where(eq(schema.visualGameAssets.gameId, gameId));
  });
  return { cast };
}

function canonicalWerewolfScenes(gameId:string,events:readonly WerewolfEvent[],stored:Awaited<ReturnType<typeof readVisualSceneStaging>>,pause:Awaited<ReturnType<typeof readWerewolfVisualPause>>) {
  const state = replayWerewolf(events);
  const descriptors = pause ? [] : werewolfSceneInventory(events);
  if (pause?.work.kind === "scene") {
    const pending = pause.work.descriptor;
    if (!descriptors.some(d => d.roomId === pending.roomId && d.boundarySequence === pending.boundarySequence)) descriptors.push(pending);
  }
  return descriptors.map(descriptor => {
    const { roomId, boundarySequence, purpose } = descriptor;
    const scene = stored.filter(row => row.roomId === roomId && row.boundarySequence <= boundarySequence
      && (purpose !== "hunt" || row.plan.direction?.purpose === "werewolf-hunt")
      && row.plan.cast.length === descriptor.participantIds.length && row.plan.cast.every(p => descriptor.participantIds.includes(p.id))).at(-1);
    const participants = descriptor.participantIds.map(id => ({ id, name: state.players.find(player => player.id === id)!.name }));
    const data = { sceneId: scene?.id ?? null, roomId, round: descriptor.day, boundarySequence, afterDialogueSequence: boundarySequence,
      participants, roles: {}, allianceGroups: [], cues: [] };
    return { ...data, purpose, wolfIds: descriptor.wolfIds, key: sha256StableJson({ gameId, roomId, boundarySequence }),
      previewHash: sha256StableJson({ ...data, sceneId: undefined, descriptor }),
      roomName: purpose === "village" ? "Village round table" : purpose === "pack" ? "Private pack cellar" : "Moonlit hunt",
      audience: purpose === "village" ? "public" : "pack", available: false, originalFailed: scene?.status === "failed" };
  });
}

/** Canonical discovery omits media history, cast reference payloads and provider evidence. */
export async function readWerewolfProductionSceneCatalog(db:DrizzleDB,gameId:string,slug:string) {
  const [events,stored,pause] = await Promise.all([readWerewolfEvents(db,gameId),readVisualSceneStaging(db,gameId),readWerewolfVisualPause(db,gameId)]);
  return {gameId,slug,scenes:canonicalWerewolfScenes(gameId,events,stored,pause)};
}

/** Production-only projection. Public and pack membership comes from the exact canonical prefix. */
export async function readWerewolfProduction(db: DrizzleDB, gameId: string, slug: string) {
  const [events, stored, media, accounting, refs] = await loadPayloads(Promise.all([
    readWerewolfEvents(db, gameId),
    db.select().from(schema.visualScenes).where(eq(schema.visualScenes.gameId, gameId)).orderBy(asc(schema.visualScenes.boundarySequence)),
    readVisualMedia(db, gameId), readVisualRenderAccounting(db, gameId), werewolfReferenceMetadata(db, gameId),
  ]));
  const state = replayWerewolf(events),pause = await readWerewolfVisualPause(db,gameId);
  const [game] = await db.select({config:schema.games.config}).from(schema.games).where(eq(schema.games.id,gameId));
  const scenes = canonicalWerewolfScenes(gameId,events,stored,pause).map(data => {
    const scene = stored.find(scene => scene.id === data.sceneId);
    const published = media.publications.find(p => p.sceneId === scene?.id && p.audience === "public");
    const version = media.versions.find(v => v.sceneId === scene?.id);
    const shots = version?.shots ?? scene?.shots;
    const covered = new Set(shots ? [...shots.groups, ...(shots.overview ? [shots.overview] : [])].flatMap(s => s.visibleParticipantIds)
      : (version?.localization.anchors ?? scene?.anchors ?? []).filter(a => a.confidence === "clear").map(a => a.playerId));
    return {...data,available:Boolean(published),coverage:data.participants.map(p => ({...p,verified:covered.has(p.id),fallback:refs.find(ref => ref.profile.id === p.id)?.kind ?? "missing"})),panelCount:shots?.groups.length ?? 0};
  });
  return { gameId, slug, scenes, media, attempts: accounting.attempts,
    recovery: pause ? { pauseId: pause.id, reason: pause.reason, kind: pause.work.kind,
      playerName: pause.work.kind === "form" ? state.players.find(p => pause.work.kind === "form" && p.id === pause.work.playerId)?.name : undefined,
      policy: visualFailurePolicy(JSON.parse(game!.config)) } : null,
    warnings: refs.filter(ref => ref.kind === "missing").map(ref => `No frozen reference for ${ref.profile.name}. Production cannot substitute their current profile.`) };
}
