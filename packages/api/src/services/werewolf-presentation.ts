import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { projectWerewolfPresentation, type WerewolfPresentation } from "@influence/engine/werewolf/presentation";
import type { WerewolfAudience } from "@influence/engine/werewolf/observation";
import type { StoredVisualShot, VisualShot } from "@influence/engine/visual-mode";
import type {WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
import { projectWerewolfWatch, type WerewolfWatchStaging } from "@influence/engine/werewolf/watch";
import { schema, type DrizzleDB } from "../db/index.js";
import { readWerewolfEvents, WerewolfGameError } from "./werewolf-games.js";
import { werewolfReferences, WEREWOLF_AUTO_PUBLISHER } from "./werewolf-production.js";
import { readVisualProfileImage } from "./visual-game-assets.js";

/** One audience-safe prefix, plus an exact public version; no producer DTO escapes. */
export async function readWerewolfPresentation(db: DrizzleDB, id: string, audience: WerewolfAudience, cursor?: number, publicationCutoff = new Date().toISOString()) {
  const [game] = await db.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
  if (!game) throw new WerewolfGameError("Game not found", 404);
  if (!game.startedAt) throw new WerewolfGameError("This game has not started. Open its casting lobby.");
  const frame = projectWerewolfPresentation(await readWerewolfEvents(db, game.id), audience, cursor);
  const rows = await publishedWerewolfScenes(db, game.id, publicationCutoff);
  const references = await werewolfReferences(db, game.id);
  const { scene, permitted } = bindWerewolfScene(rows, game.id, audience, frame.view.cursor, publicationCutoff, frame);
  const root = `/api/werewolf/${encodeURIComponent(game.id)}`;
  const query = `audience=${audience}&cursor=${frame.view.cursor}&publishedBefore=${encodeURIComponent(publicationCutoff)}`;
  const view = { ...frame.view, players: frame.view.players.map(player => ({ ...player, avatarUrl: `${root}/characters/${encodeURIComponent(player.id)}?${query}`, fullBodyReferenceUrl: references.find(ref => ref.profile.id === player.id)?.kind === "full_body" ? `${root}/characters/${encodeURIComponent(player.id)}?${query}&image=body` : null })) };
  const presentation: WerewolfPresentation = { slug: game.slug, status: game.status, latestCursor: frame.latestCursor, publicationCutoff, view, scene };
  return { presentation, permitted };
}
export async function readWerewolfCharacter(db: DrizzleDB, gameId: string, playerId: string, image: "portrait" | "body" = "portrait") {
  const ref = (await werewolfReferences(db, gameId)).find(ref => ref.profile.id === playerId);
  if (!ref) return null;
  return image === "body" ? (ref.kind === "full_body" ? ref.bytes : null) : ref.portraitBytes ?? (ref.bundled ? await readVisualProfileImage(null, ref.profile) : null);
}

async function publishedWerewolfScenes(db: DrizzleDB, gameId: string, publicationCutoff: string) {
  return await db.select({ scene: schema.visualScenes, publication: schema.visualMediaPublications, version: schema.visualMediaVersions })
    .from(schema.visualScenes)
    .innerJoin(schema.visualMediaPublications, and(eq(schema.visualMediaPublications.sceneId, schema.visualScenes.id), eq(schema.visualMediaPublications.audience, "public"), or(lte(schema.visualMediaPublications.createdAt, publicationCutoff), and(eq(schema.visualMediaPublications.operatorId, WEREWOLF_AUTO_PUBLISHER), eq(schema.visualMediaPublications.revision, 1)))))
    .innerJoin(schema.visualMediaVersions, eq(schema.visualMediaVersions.id, schema.visualMediaPublications.versionId))
    .where(and(eq(schema.visualScenes.gameId, gameId)))
    .orderBy(desc(schema.visualScenes.boundarySequence), desc(schema.visualMediaPublications.revision));

}
function bindWerewolfScene(rows: Awaited<ReturnType<typeof publishedWerewolfScenes>>, gameId: string, audience: WerewolfAudience, cursor: number, publicationCutoff: string, frame: WerewolfWatchStaging) {
  // Introductions use frozen individual art, including games with old lobby renders.
  if (frame.roomId === null) return { scene: null, permitted: new Set<string>() };
  const root = `/api/werewolf/${encodeURIComponent(gameId)}`;
  const query = `audience=${audience}&cursor=${cursor}&publishedBefore=${encodeURIComponent(publicationCutoff)}`;
  const mediaUrl = (asset: string) => `${root}/media/${encodeURIComponent(asset)}?${query}`;
  // Membership must match exactly: never substitute a future or pre-death cast.
  const eligible = rows.filter(row => row.scene.roomId === frame.roomId && row.scene.boundarySequence <= frame.boundary);
  const latest = eligible.filter((row, index) => eligible.findIndex(other => other.scene.id === row.scene.id) === index);
  const selected = latest.find(row => row.version.plan.cast.length === frame.participantIds.length && row.version.plan.cast.every(p => frame.participantIds.includes(p.id)));
  const permitted = new Set<string>();
  const convert = (shot: StoredVisualShot): VisualShot => {
    permitted.add(shot.imageArtifactId);
    return { imageUrl: mediaUrl(shot.imageArtifactId), annotatedImageUrl: "", participantIds: shot.participantIds, visibleParticipantIds: shot.visibleParticipantIds, anchors: shot.anchors, pointers: shot.pointers };
  };
  let scene: WerewolfPresentation["scene"] = null;
  if (selected) {
    const { version } = selected;
    permitted.add(version.imageArtifactId);
    scene = { id: selected.scene.id, roomId: frame.roomId, version: version.version,
      imageUrl: mediaUrl(version.imageArtifactId), annotatedImageUrl: "", participantIds: frame.participantIds,
      anchors: version.localization.anchors,
      ...(version.shots ? { shots: { mode: version.shots.mode, groups: version.shots.groups.map(convert), overview: version.shots.overview ? convert(version.shots.overview) : null } } : {}) };
  }
  return { scene, permitted };
}

/** Bounded browser projection. No history prefixes, raw journals or private staging coordinates escape. */
export async function readWerewolfWatch(db: DrizzleDB, id: string, audience: WerewolfAudience, fromCursor: number, limit: number, publicationCutoff = new Date().toISOString()): Promise<WerewolfWatchWindow> {
  const [game] = await db.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
  if (!game) throw new WerewolfGameError("Game not found", 404);
  if (!game.startedAt) throw new WerewolfGameError("This game has not started. Open its casting lobby.");
  const projection = projectWerewolfWatch(await readWerewolfEvents(db, game.id), audience, fromCursor, limit);
  const rows = await publishedWerewolfScenes(db, game.id, publicationCutoff);
  const references = await werewolfReferences(db, game.id);
  const media: WerewolfWatchWindow["media"] = {};
  const bindings = new Map<string, string | null>();
  const portrait = (playerId: string) => `/api/werewolf/${encodeURIComponent(game.id)}/characters/${encodeURIComponent(playerId)}?audience=${audience}&cursor=1&publishedBefore=${encodeURIComponent(publicationCutoff)}`;
  const body = (id: string) => references.find(ref => ref.profile.id === id)?.kind === "full_body" ? `${portrait(id)}&image=body` : null;
  const moments = projection.moments.map(({staging, ...moment}) => {
    const binding = JSON.stringify(staging);
    let mediaKey = bindings.get(binding);
    if (mediaKey === undefined) {
      const {scene} = bindWerewolfScene(rows, game.id, audience, moment.cursor, publicationCutoff, staging);
      mediaKey = scene ? `${scene.id}:${scene.version}` : null;
      if (scene && mediaKey && !media[mediaKey]) media[mediaKey] = scene;
      bindings.set(binding, mediaKey);
    }
    return { ...moment, mediaKey, snapshot: { ...moment.snapshot, players: moment.snapshot.players.map(player => ({...player, avatarUrl: portrait(player.id), fullBodyReferenceUrl: body(player.id)})) } };
  });
  return { ...projection, slug: game.slug, status: game.status, audience, publicationCutoff, moments, media,
    players: projection.players.map(player => ({...player, avatarUrl: portrait(player.id), fullBodyReferenceUrl: body(player.id)})) };
}
