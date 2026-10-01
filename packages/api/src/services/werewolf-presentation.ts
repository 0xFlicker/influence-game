import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { projectWerewolfPresentation, type WerewolfPresentation } from "@influence/engine/werewolf/presentation";
import type { WerewolfAudience } from "@influence/engine/werewolf/observation";
import type { StoredVisualShot, VisualShot } from "@influence/engine/visual-mode";
import { schema, type DrizzleDB } from "../db/index.js";
import { readWerewolfEvents, WerewolfGameError } from "./werewolf-games.js";
import { werewolfReferences } from "./werewolf-production.js";
import { readVisualProfileImage } from "./visual-game-assets.js";

/** One audience-safe prefix, plus an exact public version; no producer DTO escapes. */
export async function readWerewolfPresentation(db: DrizzleDB, id: string, audience: WerewolfAudience, cursor?: number, publicationCutoff = new Date().toISOString()) {
  const [game] = await db.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
  if (!game) throw new WerewolfGameError("Game not found", 404);
  const frame = projectWerewolfPresentation(await readWerewolfEvents(db, game.id), audience, cursor);
  const root = `/api/werewolf/${encodeURIComponent(game.id)}`;
  const query = `audience=${audience}&cursor=${frame.view.cursor}&publishedBefore=${encodeURIComponent(publicationCutoff)}`;
  const mediaUrl = (asset: string) => `${root}/media/${encodeURIComponent(asset)}?${query}`;
  const rows = await db.select({ scene: schema.visualScenes, publication: schema.visualMediaPublications, version: schema.visualMediaVersions })
    .from(schema.visualScenes)
    .innerJoin(schema.visualMediaPublications, and(eq(schema.visualMediaPublications.sceneId, schema.visualScenes.id), eq(schema.visualMediaPublications.audience, "public"), lte(schema.visualMediaPublications.createdAt, publicationCutoff)))
    .innerJoin(schema.visualMediaVersions, eq(schema.visualMediaVersions.id, schema.visualMediaPublications.versionId))
    .where(and(eq(schema.visualScenes.gameId, game.id), eq(schema.visualScenes.roomId, frame.roomId), lte(schema.visualScenes.boundarySequence, frame.boundary)))
    .orderBy(desc(schema.visualScenes.boundarySequence), desc(schema.visualMediaPublications.revision));
  // Membership must match exactly: never substitute a future or pre-death cast.
  const latest = rows.filter((row, index) => rows.findIndex(other => other.scene.id === row.scene.id) === index);
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
  const view = { ...frame.view, players: frame.view.players.map(player => ({ ...player, avatarUrl: `${root}/characters/${encodeURIComponent(player.id)}?${query}` })) };
  const presentation: WerewolfPresentation = { slug: game.slug, status: game.status, latestCursor: frame.latestCursor, publicationCutoff, view, scene };
  return { presentation, permitted };
}
export async function readWerewolfCharacter(db: DrizzleDB, gameId: string, playerId: string) {
  const ref = (await werewolfReferences(db, gameId)).find(ref => ref.profile.id === playerId);
  if (!ref) return null;
  return ref.bytes ?? (ref.bundled ? await readVisualProfileImage(null, ref.profile) : null);
}
