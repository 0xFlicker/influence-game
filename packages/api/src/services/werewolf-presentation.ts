import { werewolfVisualPause } from "./werewolf-visual-policy.js";
import { isViewerGame } from "./game-visibility.js";
import { inArray, and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { projectWerewolfPresentation, type WerewolfPresentation } from "@influence/engine/werewolf/presentation";
import type { WerewolfAudience } from "@influence/engine/werewolf/observation";
import type { StoredVisualShot, VisualShot } from "@influence/engine/visual-mode";
import type {WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
import { projectWerewolfWatch, type WerewolfWatchStaging } from "@influence/engine/werewolf/watch";
import { schema, type DrizzleDB } from "../db/index.js";
import { readWerewolfEvents, WerewolfGameError } from "./werewolf-games.js";
import { werewolfReferenceMetadata, WEREWOLF_AUTO_PUBLISHER } from "./werewolf-production.js";
import { readVisualProfileImage } from "./visual-game-assets.js";

/** One audience-safe prefix, plus an exact public version; no producer DTO escapes. */
export async function readWerewolfPresentation(db: DrizzleDB, id: string, audience: WerewolfAudience, cursor?: number, publicationCutoff = new Date().toISOString()) {
  const [game] = await db.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
  if (!game || !isViewerGame(game)) throw new WerewolfGameError("Game not found", 404);
  if (!game.startedAt) throw new WerewolfGameError("This game has not started. Open its casting lobby.");
  const events = await readWerewolfEvents(db, game.id);
  const frame = projectWerewolfPresentation(events, audience, cursor);
  const rows = await publishedWerewolfScenes(db, game.id, publicationCutoff);
  const references = await werewolfReferenceMetadata(db, game.id, events.find(event => event.type === "werewolf.started")?.payload.players);
  const { scene, permitted } = bindWerewolfScene(rows, game.id, audience, frame.view.cursor, publicationCutoff, frame);
  const root = `/api/werewolf/${encodeURIComponent(game.id)}`;
  const query = `audience=${audience}&cursor=${frame.view.cursor}&publishedBefore=${encodeURIComponent(publicationCutoff)}`;
  const view = { ...frame.view, players: frame.view.players.map(player => ({ ...player, avatarUrl: `${root}/characters/${encodeURIComponent(player.id)}?${query}`, fullBodyReferenceUrl: references.find(ref => ref.profile.id === player.id)?.kind === "full_body" ? `${root}/characters/${encodeURIComponent(player.id)}?${query}&image=body` : null })) };
  const presentation: WerewolfPresentation = { slug: game.slug, status: game.status, latestCursor: frame.latestCursor, publicationCutoff, view, scene };
  return { presentation, permitted };
}
export async function readWerewolfCharacter(db: DrizzleDB, gameId: string, playerId: string, image: "portrait" | "body" = "portrait") {
  const players = (await readWerewolfEvents(db, gameId)).find(event => event.type === "werewolf.started")?.payload.players.filter(player => player.id === playerId) ?? [];
  const [ref] = await werewolfReferenceMetadata(db, gameId, players);
  if (!ref) return null;
  const hash = image === "body" ? (ref.kind === "full_body" ? ref.bodyHash : null) : ref.portraitHash;
  if (hash) {
    const [asset] = await db.select({ bytes: schema.agentContentAssets.bytes }).from(schema.agentContentAssets).where(eq(schema.agentContentAssets.hash, hash));
    return asset?.bytes ?? null;
  }
  return image === "portrait" && ref.bundled ? readVisualProfileImage(null, ref.profile) : null;
}

async function publishedWerewolfScenes(db: DrizzleDB, gameId: string, publicationCutoff: string) {
  const [game] = await db.select({config:schema.games.config}).from(schema.games).where(eq(schema.games.id,gameId));
  const recoveryIds: string[] = game ? JSON.parse(game.config).visualRecoveryPublications ?? [] : [];

  return await db.select({ scene: schema.visualScenes, publication: schema.visualMediaPublications, version: schema.visualMediaVersions })
    .from(schema.visualScenes)
    .innerJoin(schema.visualMediaPublications, and(eq(schema.visualMediaPublications.sceneId, schema.visualScenes.id), eq(schema.visualMediaPublications.audience, "public"), or(inArray(schema.visualMediaPublications.id,recoveryIds), lte(schema.visualMediaPublications.createdAt, publicationCutoff), and(eq(schema.visualMediaPublications.operatorId, WEREWOLF_AUTO_PUBLISHER), eq(schema.visualMediaPublications.revision, 1)))))
    .innerJoin(schema.visualMediaVersions, eq(schema.visualMediaVersions.id, schema.visualMediaPublications.versionId))
    .where(and(eq(schema.visualScenes.gameId, gameId)))
    .orderBy(desc(schema.visualScenes.boundarySequence), desc(schema.visualMediaPublications.revision));

}
function bindWerewolfScene(rows: Awaited<ReturnType<typeof publishedWerewolfScenes>>, gameId: string, audience: WerewolfAudience, cursor: number, publicationCutoff: string, frame: WerewolfWatchStaging) {
  // Introductions use frozen individual art, including games with old lobby renders.
  if (frame.roomId === null && frame.purpose !== "hunt" || audience === "mystery" && frame.purpose !== "village") return { scene: null, permitted: new Set<string>(), wolfForms: {} as Record<string, string> };
  const root = `/api/werewolf/${encodeURIComponent(gameId)}`;
  const query = `audience=${audience}&cursor=${cursor}&publishedBefore=${encodeURIComponent(publicationCutoff)}`;
  const mediaUrl = (asset: string) => `${root}/media/${encodeURIComponent(asset)}?${query}`;
  // Membership must match exactly: never substitute a future or pre-death cast.
  const eligible = rows.filter(row => row.scene.roomId === frame.roomId && row.scene.boundarySequence <= frame.boundary
    && (frame.purpose === "hunt" ? row.version.plan.direction?.purpose === "werewolf-hunt"
      : !row.version.plan.direction || row.version.plan.direction.purpose === `werewolf-${frame.purpose}`));
  const latest = eligible.filter((row, index) => eligible.findIndex(other => other.scene.id === row.scene.id) === index);
  const selected = latest.find(row => row.version.plan.cast.length === frame.participantIds.length && row.version.plan.cast.every(p => frame.participantIds.includes(p.id)));
  const permitted = new Set<string>();
  const wolfForms: Record<string, string> = {};
  if (audience === "omniscient" && (frame.purpose === "pack" || frame.purpose === "hunt")) {
    // A missing hunt composite can still reuse forms from an earlier published pack.
    // Prefer the selected composition's forms, then the latest permitted version per scene.
    const earlier = rows.filter(row => row.scene.boundarySequence <= frame.boundary);
    const published = earlier.filter((row, index) => earlier.findIndex(other => other.scene.id === row.scene.id) === index);
    for (const row of [...(selected ? [selected] : []), ...published]) {
      if (!["werewolf-pack", "werewolf-hunt"].includes(row.version.plan.direction?.purpose ?? "")) continue;
      for (const member of row.version.plan.cast) if (frame.participantIds.includes(member.id) && !wolfForms[member.id] && member.variant?.kind === "werewolf" && member.variant.resolved) {
        permitted.add(member.referenceArtifactId);
        wolfForms[member.id] = mediaUrl(member.referenceArtifactId);
      }
    }
  }
  const convert = (shot: StoredVisualShot): VisualShot => {
    permitted.add(shot.imageArtifactId);
    return { imageUrl: mediaUrl(shot.imageArtifactId), annotatedImageUrl: "", participantIds: shot.participantIds, visibleParticipantIds: shot.visibleParticipantIds, anchors: shot.anchors, pointers: shot.pointers };
  };
  let scene: WerewolfPresentation["scene"] = null;
  if (selected && frame.roomId) {
    const { version } = selected;
    permitted.add(version.imageArtifactId);
    scene = { id: selected.scene.id, roomId: frame.roomId, version: version.version,
      imageUrl: mediaUrl(version.imageArtifactId), annotatedImageUrl: "", participantIds: frame.participantIds,
      anchors: version.localization.anchors,
      ...(version.shots ? { shots: { mode: version.shots.mode, groups: version.shots.groups.map(convert), overview: version.shots.overview ? convert(version.shots.overview) : null } } : {}) };
  }
  return { scene, permitted, wolfForms };
}

/** Bounded browser projection. No history prefixes, raw journals or private staging coordinates escape. */
export async function readWerewolfWatch(db: DrizzleDB, id: string, audience: WerewolfAudience, fromCursor: number, limit: number, publicationCutoff = new Date().toISOString()): Promise<WerewolfWatchWindow> {
  const [game] = await db.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
  if (!game || !isViewerGame(game)) throw new WerewolfGameError("Game not found", 404);
  if (!game.startedAt) throw new WerewolfGameError("This game has not started. Open its casting lobby.");
  const events = await readWerewolfEvents(db, game.id);
  const projection = projectWerewolfWatch(events, audience, fromCursor, limit);
  const rows = await publishedWerewolfScenes(db, game.id, publicationCutoff);
  const references = await werewolfReferenceMetadata(db, game.id, events.find(event => event.type === "werewolf.started")?.payload.players);
  const media: WerewolfWatchWindow["media"] = {};
  const bindings = new Map<string, {mediaKey: string | null; wolfForms: Record<string, string>}>();
  const portrait = (playerId: string) => `/api/werewolf/${encodeURIComponent(game.id)}/characters/${encodeURIComponent(playerId)}?audience=${audience}&cursor=1&publishedBefore=${encodeURIComponent(publicationCutoff)}`;
  const body = (id: string) => references.find(ref => ref.profile.id === id)?.kind === "full_body" ? `${portrait(id)}&image=body` : null;
  const moments = projection.moments.map(({staging, ...moment}) => {
    const binding = JSON.stringify(staging);
    let bound = bindings.get(binding);
    if (!bound) {
      const {scene, wolfForms} = bindWerewolfScene(rows, game.id, audience, moment.cursor, publicationCutoff, staging);
      const mediaKey = scene ? `${scene.id}:${scene.version}` : null;
      if (scene && mediaKey && !media[mediaKey]) media[mediaKey] = scene;
      bound = {mediaKey, wolfForms};
      bindings.set(binding, bound);
    }
    const {mediaKey, wolfForms} = bound;
    return { ...moment, ...(Object.keys(wolfForms).length ? {wolfForms} : {}), ...(moment.night ? { night: { ...moment.night, before: { ...moment.night.before, players: moment.night.before.players.map(player => ({...player, avatarUrl: portrait(player.id), fullBodyReferenceUrl: body(player.id)})) } } } : {}), mediaKey, snapshot: { ...moment.snapshot, players: moment.snapshot.players.map(player => ({...player, avatarUrl: portrait(player.id), fullBodyReferenceUrl: body(player.id)})) } };
  });
  return { ...projection, slug: game.slug, status: game.status, visualPaused: game.status === "suspended" && Boolean(werewolfVisualPause(JSON.parse(game.config))), audience, publicationCutoff, moments, media,
    players: projection.players.map(player => ({...player, avatarUrl: portrait(player.id), fullBodyReferenceUrl: body(player.id)})) };
}
