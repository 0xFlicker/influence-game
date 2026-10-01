import { and, asc, eq } from "drizzle-orm";
import { applyWerewolfEvent, replayWerewolf } from "@influence/engine/werewolf";
import type { FrozenVisualProfile } from "@influence/engine/visual-mode";
import type { VisualCastMember } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { readWerewolfEvents } from "./werewolf-games.js";
import { readVisualMedia } from "./visual-media-repair.js";
import { readVisualRenderAccounting } from "./visual-render-journal.js";
import { readVisualProfileImage } from "./visual-game-assets.js";
import { storeVisualArtifact } from "./visual-scene-store.js";
import { sha256StableJson } from "./stable-hash.js";

export class WerewolfReferenceError extends Error {}

/** Uses immutable submitted content, never the current editable character profile. */
export async function werewolfReferences(db: DrizzleDB, gameId: string) {
  const state = replayWerewolf(await readWerewolfEvents(db, gameId));
  return Promise.all(state.players.map(async player => {
    const [revision] = player.contentRevisionId ? await db.select().from(schema.agentContentRevisions)
      .where(and(eq(schema.agentContentRevisions.id, player.contentRevisionId), eq(schema.agentContentRevisions.agentProfileId, player.agentProfileId ?? ""))) : [];
    const snapshot = revision?.snapshot;
    const assets = snapshot?.assets;
    let url: string | null = null;
    let bytes: Buffer | null = null;
    let kind = "missing";
    for (const [field, candidateKind] of [["fullBodyReferenceUrl", "full_body"], ["avatarUrl", "portrait"]] as const) {
      const candidate = snapshot?.[field];
      const hash = typeof candidate === "string" && assets && typeof assets === "object" && !Array.isArray(assets)
        ? (assets as Record<string, unknown>)[candidate] : null;
      const [asset] = typeof hash === "string" ? await db.select().from(schema.agentContentAssets).where(eq(schema.agentContentAssets.hash, hash)) : [];
      if (asset) { url = candidate as string; bytes = asset.bytes; kind = candidateKind; break; }
    }
    const bundled = !player.agentProfileId;
    if (bundled) kind = "portrait";
    const profile: FrozenVisualProfile = { id: player.id, name: player.name, personaKey: player.personaKey ?? "", avatarUrl: null,
      fullBodyReferenceUrl: kind === "full_body" ? url : null,
      performanceInstructions: typeof snapshot?.performanceInstructions === "string" ? snapshot.performanceInstructions : "" };
    return { profile, kind, bytes, bundled };
  }));
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

/** Production-only projection. Public and pack membership comes from the exact canonical prefix. */
export async function readWerewolfProduction(db: DrizzleDB, gameId: string, slug: string) {
  const [events, stored, media, accounting, refs] = await Promise.all([
    readWerewolfEvents(db, gameId),
    db.select().from(schema.visualScenes).where(eq(schema.visualScenes.gameId, gameId)).orderBy(asc(schema.visualScenes.boundarySequence)),
    readVisualMedia(db, gameId), readVisualRenderAccounting(db, gameId), werewolfReferences(db, gameId),
  ]);
  let state = replayWerewolf([events[0]!]);
  const prior = new Map<string, string>();
  const scenes = [];
  for (const event of events.slice(1)) {
    if (event.type === "werewolf.action_accepted" && ["introduce", "pack_talk", "open_thread", "discuss"].includes(event.payload.action)) {
      const decision = event.payload.decision;
      const roomId = event.payload.action === "pack_talk" ? "mingle-1" as const : "lobby" as const;
      const ids = state.aliveIds.filter(id => roomId === "lobby" || state.roles[id] === "werewolf");
      const signature = JSON.stringify(ids);
      if (decision.kind !== "target" && prior.get(roomId) !== signature) {
        prior.set(roomId, signature);
        const boundarySequence = event.sequence - 1;
        const scene = stored.find(row => row.roomId === roomId && row.boundarySequence === boundarySequence);
        const participants = ids.map(id => ({ id, name: state.players.find(player => player.id === id)!.name }));
        const data = { sceneId: scene?.id ?? null, roomId, round: state.day, boundarySequence, afterDialogueSequence: boundarySequence,
          participants, roles: {}, allianceGroups: [], cues: decision.cue ? [{ playerId: event.payload.actorId, cue: decision.cue }] : [] };
        const published = media.publications.find(p => p.sceneId === scene?.id && p.audience === "public");
        const version = media.versions.find(v => v.sceneId === scene?.id);
        const shots = version?.shots ?? scene?.shots;
        const covered = new Set(shots ? [...shots.groups, ...(shots.overview ? [shots.overview] : [])].flatMap(s => s.visibleParticipantIds) : (version?.localization.anchors ?? scene?.anchors ?? []).filter(a => a.confidence === "clear").map(a => a.playerId));
        scenes.push({ ...data, key: sha256StableJson({ gameId, roomId, boundarySequence }),
          previewHash: sha256StableJson({ ...data, sceneId: undefined }), roomName: roomId === "lobby" ? "Village lobby" : "Private pack room",
          audience: roomId === "lobby" ? "public" : "pack", available: Boolean(published), originalFailed: scene?.status === "failed",
          coverage: participants.map(p => ({ ...p, verified: covered.has(p.id), fallback: refs.find(ref => ref.profile.id === p.id)?.kind ?? "missing" })),
          panelCount: shots?.groups.length ?? 0 });
      }
    }
    state = applyWerewolfEvent(state, event);
  }
  return { gameId, slug, scenes, media, attempts: accounting.attempts,
    warnings: refs.filter(ref => ref.kind === "missing").map(ref => `No frozen reference for ${ref.profile.name}. Production cannot substitute their current profile.`) };
}

/** Authorized admin preview only; embedded bytes cannot become public artifact links. */
export async function readWerewolfScenePreview(db: DrizzleDB, gameId: string, sceneId: string) {
  const [scene] = await db.select().from(schema.visualScenes).where(and(eq(schema.visualScenes.gameId, gameId), eq(schema.visualScenes.id, sceneId)));
  if (!scene) return null;
  const media = await readVisualMedia(db, gameId);
  const latest = media.versions.find(v => v.sceneId === scene.id);
  const shots = latest?.shots ?? scene.shots;
  const image = async (id: string | null) => {
    if (!id) return "";
    const [a] = await db.select().from(schema.visualArtifacts).where(and(eq(schema.visualArtifacts.gameId, gameId), eq(schema.visualArtifacts.id, id)));
    return a ? `data:image/png;base64,${a.image.toString("base64")}` : "";
  };
  const convert = async (shot: import("@influence/engine/visual-mode").StoredVisualShot) => ({ ...shot,
    imageUrl: await image(shot.imageArtifactId), annotatedImageUrl: "" });
  const refs = await werewolfReferences(db, gameId);
  const players = await Promise.all(scene.plan.cast.map(async member => {
    const ref = refs.find(r => r.profile.id === member.id);
    const bytes = ref?.bytes ?? (ref?.bundled ? await readVisualProfileImage(null, ref.profile) : null);
    return { id: member.id, name: member.name, fallback: ref?.kind ?? "missing", imageUrl: bytes ? `data:image/png;base64,${bytes.toString("base64")}` : null };
  }));
  const accepted: import("@influence/engine/visual-mode").AcceptedVisualScene = {
    id: scene.id, roomId: scene.roomId, version: latest?.version ?? scene.renderRevision,
    imageUrl: await image(latest?.imageArtifactId ?? scene.imageArtifactId), annotatedImageUrl: "",
    participantIds: scene.plan.cast.map(m => m.id), anchors: latest?.localization.anchors ?? scene.anchors ?? [],
    ...(shots ? { shots: { mode: shots.mode, groups: await Promise.all(shots.groups.map(convert)), overview: shots.overview ? await convert(shots.overview) : null } } : {}),
  };
  return { scene: accepted, players };
}
