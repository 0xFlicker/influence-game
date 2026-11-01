import { eq, inArray } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { validHeadRectangle, type CharacterHeadPosition } from "@influence/engine/character-portrait";
import { loadPayloads } from "./payload-storage.js";

/** Select the game's frozen picture, then its derivative. Never read today's profile. */
export async function readCharacterArtwork(db: Pick<DrizzleDB, "select">, gameId: string, artifactUrl = (id: string) => `/api/games/${gameId}/visual/artifacts/${id}`) {
  const players = await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId));
  const [prepared] = await db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId));
  const personas = players.map(player => ({ player, persona: JSON.parse(player.persona) as {
    fullBodyReferenceUrl?: string; contentRevisionId?: string; headPosition?: CharacterHeadPosition;
  } }));
  const revisionIds = personas.flatMap(({ persona }) => persona.contentRevisionId ? [persona.contentRevisionId] : []);
  const revisions = revisionIds.length ? await loadPayloads(db.select({ id: schema.agentContentRevisions.id, snapshot: schema.agentContentRevisions.snapshot })
    .from(schema.agentContentRevisions).where(inArray(schema.agentContentRevisions.id, revisionIds))) : [];
  const artifactIds = prepared?.cast.map(member => member.referenceArtifactId) ?? [];
  const artifacts = artifactIds.length ? await db.select({ id: schema.visualArtifacts.id, image: schema.visualArtifacts.image }).from(schema.visualArtifacts)
    .where(inArray(schema.visualArtifacts.id, artifactIds)) : [];
  const originals = personas.map(({ player, persona }) => {
    const member = prepared?.cast.find(member => member.id === player.id && !member.portraitFallback);
    const snapshot = revisions.find(revision => revision.id === persona.contentRevisionId)?.snapshot;
    const hashes = snapshot?.assets as Record<string, string> | undefined;
    const url = member ? artifactUrl(member.referenceArtifactId) : persona.fullBodyReferenceUrl ?? null;
    const hash = member ? artifacts.find(artifact => artifact.id === member.referenceArtifactId)?.image.sha256
      : (persona.fullBodyReferenceUrl ? hashes?.[persona.fullBodyReferenceUrl] : undefined);
    const headPosition = !member ? persona.headPosition ?? null : null;
    const headRectangle = member?.headRectangle ?? (headPosition?.confirmation && headPosition.sourceUrl === url && validHeadRectangle(headPosition.rect) ? headPosition.rect : undefined);
    return { id: player.id, fullBodyReferenceUrl: url, headPosition, headRectangle, hash, sourceArtifactId: member?.referenceArtifactId };
  });
  const hashes = originals.flatMap(art => art.hash ? [art.hash] : []);
  const assets = hashes.length ? await db.select({ hash: schema.agentContentAssets.hash, transparentUrl: schema.agentContentAssets.transparentUrl })
    .from(schema.agentContentAssets).where(inArray(schema.agentContentAssets.hash, hashes)) : [];
  return originals.map(({ hash, ...art }) => {
    const transparent = assets.find(asset => asset.hash === hash)?.transparentUrl;
    return transparent ? { ...art, sourceArtifactId: undefined, fullBodyReferenceUrl: transparent,
      headPosition: art.headPosition ? { ...art.headPosition, sourceUrl: transparent } : null } : art;
  });
}
