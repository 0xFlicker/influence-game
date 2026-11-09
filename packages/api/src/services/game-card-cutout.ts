import { and, desc, eq } from "drizzle-orm";
import sharp from "sharp";
import { validHeadRectangle, type HeadRectangle } from "@influence/engine/character-portrait";
import { schema, type DrizzleDB } from "../db/index.js";
import { readCharacterArtwork } from "./character-art.js";
import { readVisualArtifact } from "./visual-scene-store.js";
import { readVisualProfileImage } from "./visual-game-assets.js";
import { readWerewolfCharacter } from "./werewolf-presentation.js";
import { werewolfReferenceMetadata } from "./werewolf-production.js";
import { readPayload } from "./payload-storage.js";

/** Crop around the confirmed head, retaining the subject's shoulders and alpha. */
export async function gameCardCutoutPng(bytes: Buffer, head: HeadRectangle): Promise<Buffer | null> {
  if (!validHeadRectangle(head)) return null;
  // Normalization makes the crop use the same coordinate space as the saved box.
  const normalized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer();
  const source = sharp(normalized, { limitInputPixels: 40_000_000 });
  const [{ width, height }, stats] = await Promise.all([source.metadata(), source.stats()]);
  if (!width || !height || stats.isOpaque) return null;
  const headWidth = head.width * width, headHeight = head.height * height;
  const centerX = (head.x + head.width / 2) * width;
  const top = Math.max(0, Math.floor((head.y * height) - headHeight * 0.55));
  const bottom = Math.min(height, Math.ceil((head.y * height) + headHeight * 2.3));
  const cropWidth = Math.min(width, Math.max(headWidth * 3.2, (bottom - top) * 0.8));
  const left = Math.max(0, Math.min(width - cropWidth, centerX - cropWidth / 2));
  const area = { left: Math.floor(left), top, width: Math.max(1, Math.floor(cropWidth)), height: Math.max(1, bottom - top) };
  return sharp(normalized).extract(area).resize(480, 600, { fit: "contain", position: "bottom", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

async function readyPublicCutout(db: DrizzleDB, sourceHash: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) return null;
  const [cutout] = await db.select({ source: schema.characterCutouts.source, image: schema.characterCutouts.image }).from(schema.characterCutouts)
    .where(and(eq(schema.characterCutouts.sourceHash, sourceHash), eq(schema.characterCutouts.privateSource, false), eq(schema.characterCutouts.status, "ready")))
    .orderBy(desc(schema.characterCutouts.createdAt)).limit(1);
  return cutout?.image && cutout.source.sha256 === sourceHash ? readPayload(cutout.image) : null;
}

/** Only frozen opening artwork may be composed into a game preview. */
export async function readGameCardCutout(db: DrizzleDB, game: { id: string; gameKind: "influence" | "werewolf"; status: string }, playerId: string): Promise<Buffer | null> {
  if (game.gameKind === "influence") {
    const art = (await readCharacterArtwork(db, game.id)).find(item => item.id === playerId);
    if (!art || !validHeadRectangle(art.headRectangle)) return null;
    let bytes: Buffer | null = null;
    // Some historical derivatives exist as durable ready jobs but have not been
    // published as profile art. Their exact source hash is frozen with the head box.
    if (art.headPosition?.confirmation) bytes = await readyPublicCutout(db, art.headPosition.sourceHash);
    if (!bytes && art.sourceArtifactId) {
      const [cutout] = await db.select({ artifactId: schema.visualCharacterCutouts.artifactId }).from(schema.visualCharacterCutouts)
        .where(eq(schema.visualCharacterCutouts.sourceArtifactId, art.sourceArtifactId));
      bytes = await readVisualArtifact(db, game.id, cutout?.artifactId ?? art.sourceArtifactId);
    }
    if (!bytes && art.fullBodyReferenceUrl) bytes = await readVisualProfileImage(art.fullBodyReferenceUrl, { name: "", personaKey: "" }, { db });
    return bytes ? gameCardCutoutPng(bytes, art.headRectangle) : null;
  }
  // Waiting seats have no frozen opening snapshot; use their public portraits.
  if (game.status === "waiting") return null;
  const [opening] = await db.select({ event: schema.werewolfEvents.event }).from(schema.werewolfEvents)
    .where(and(eq(schema.werewolfEvents.gameId, game.id), eq(schema.werewolfEvents.sequence, 1)));
  if (!opening || opening.event.type !== "werewolf.started" || opening.event.gameId !== game.id || opening.event.sequence !== 1) return null;
  const player = opening.event.payload.players.find(item => item.id === playerId);
  if (!player) return null;
  const ref = (await werewolfReferenceMetadata(db, game.id, [player]))[0];
  if (!ref) return null;
  const head = ref.profile.headPosition?.rect;
  if (!validHeadRectangle(head)) return null;
  const bytes = (ref.bodyHash ? await readyPublicCutout(db, ref.bodyHash) : null) ?? await readWerewolfCharacter(db, game.id, playerId, "body");
  return bytes ? gameCardCutoutPng(bytes, head) : null;
}
