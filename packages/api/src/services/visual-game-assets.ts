import type { VisualBoundaryGuard, VisualTransaction } from "./visual-execution-boundary.js";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { VISUAL_HOUSE_STYLE, VISUAL_ROOMS, type FrozenVisualProfile } from "@influence/engine/visual-mode";
import { schema, type DrizzleDB } from "../db/index.js";
import { readLocalUpload } from "../lib/storage.js";
import { renderVisualAssetBestEffort } from "./visual-render-journal.js";
import { readVisualArtifact, storeVisualArtifact } from "./visual-scene-store.js";

const PERSONAS = ["honest", "strategic", "deceptive", "paranoid", "social", "aggressive", "loyalist", "observer", "diplomat", "wildcard", "contrarian", "provocateur", "martyr"];
export class VisualRecoveryRequired extends Error {
  constructor(message: string) { super(message); this.name = "VisualRecoveryRequired"; }
}

/** Only application-owned uploads or bundled persona art enter provider requests. */
export async function readVisualProfileImage(url: string | null, profile: Pick<FrozenVisualProfile, "name" | "personaKey">): Promise<Buffer> {
  if (!url) {
    let hash = 0;
    for (const char of profile.name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const key = PERSONAS.includes(profile.personaKey) ? profile.personaKey : PERSONAS[hash % PERSONAS.length]!;
    return readFile(new URL(`../../../web/public/avatars/personas/${key}.png`, import.meta.url));
  }
  const parsed = new URL(url, "http://visual.invalid");
  if (parsed.pathname === "/api/uploads/local") {
    const key = parsed.searchParams.get("key");
    if (!key) throw new Error("Visual upload is missing its storage key");
    const image = await readLocalUpload(key);
    if (!image) throw new Error("Visual upload is unavailable");
    return image.body;
  }
  const endpoint = process.env.LINODE_OBJ_ENDPOINT;
  const bucket = process.env.LINODE_OBJ_BUCKET;
  const host = endpoint ? new URL(endpoint).host : null;
  if (parsed.protocol !== "https:" || !host || !bucket || ![host, `${bucket}.${host}`].includes(parsed.host)) throw new Error("Visual reference must use application image storage");
  const response = await fetch(parsed, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 16_000_000) throw new Error("Visual reference download failed");
  const image = Buffer.from(await response.arrayBuffer());
  if (image.length > 16_000_000) throw new Error("Visual reference exceeds 16 MB");
  return image;
}

export async function prepareVisualGameAssets(db: DrizzleDB, gameId: string, assertBoundary: VisualBoundaryGuard) {
  const write = async (mutation: (tx: VisualTransaction) => Promise<unknown>) => db.transaction(async (tx) => { await assertBoundary(tx); await mutation(tx); });
  await assertBoundary();
  let [assets] = await db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId));
  if (!assets) {
    const players = await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId));
    const profiles: FrozenVisualProfile[] = players.map((player) => {
      const persona = JSON.parse(player.persona) as Record<string, unknown>;
      const string = (key: string) => typeof persona[key] === "string" ? persona[key] : null;
      return { id: player.id, name: string("name") ?? player.id, personaKey: string("personaKey") ?? "",
        avatarUrl: string("avatarUrl"), fullBodyReferenceUrl: string("fullBodyReferenceUrl"), performanceInstructions: string("performanceInstructions") ?? "" };
    });
    await write((tx) => tx.insert(schema.visualGameAssets).values({ gameId, profiles }).onConflictDoNothing());
    [assets] = await db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId));
  }
  if (!assets) throw new Error("Visual profiles were not frozen");
  
  if (assets.status === "ready") return assets;
  const save = async () => {
    await assertBoundary();
    await write((tx) => tx.update(schema.visualGameAssets).set({ cast: assets!.cast, portraits: assets!.portraits, backgrounds: assets!.backgrounds }).where(eq(schema.visualGameAssets.gameId, gameId)));
  };
  try {
    for (const profile of assets.profiles) {
      if (assets.cast.some((member) => member.id === profile.id)) continue;
      const portraitId = assets.portraits[profile.id] ?? await storeVisualArtifact(db, gameId, await readVisualProfileImage(profile.avatarUrl, profile));
      assets.portraits[profile.id] = portraitId;
      await save();
      const preparedReference = profile.fullBodyReferenceUrl
        ? await readVisualProfileImage(profile.fullBodyReferenceUrl, profile)
        : (await renderVisualAssetBestEffort(db, { gameId, operationKey: `profile:${profile.id}:full-body:v1`, beforeDispatch: assertBoundary,
            request: { width: 1024, height: 1536, references: [await readVisualArtifact(db, gameId, portraitId)],
              prompt: `Create a photorealistic full-body character reference of this exact contestant, ${profile.name}. Preserve their face, hair and distinguishing features. Neutral standing pose, entire body and shoes visible, simple contemporary clothing with a distinct reproducible silhouette and color palette, plain warm grey background. No labels or text. Performance direction: ${profile.performanceInstructions}` } }))?.image;
      const reference = preparedReference ?? await readVisualArtifact(db, gameId, portraitId);
      assets.cast.push({ id: profile.id, name: profile.name, referenceArtifactId: await storeVisualArtifact(db, gameId, reference), portraitFallback: !preparedReference, performanceInstructions: profile.performanceInstructions });
      await save();
    }
    for (const room of Object.values(VISUAL_ROOMS)) {
      if (assets.backgrounds[room.id]) continue;
      const [saved] = await db.select().from(schema.visualRoomLibrary).where(and(eq(schema.visualRoomLibrary.roomId, room.id), eq(schema.visualRoomLibrary.version, room.version)));
      const image = saved?.image ?? (await renderVisualAssetBestEffort(db, { gameId, operationKey: `background:${room.id}:v${room.version}`, beforeDispatch: assertBoundary,
        request: { width: 1536, height: 864, references: [], prompt: `${VISUAL_HOUSE_STYLE}. Empty setting: ${room.name}. ${room.direction}. Wide room view, no people, no text. Preserve uncluttered conversational furniture sections with generous headroom: ${JSON.stringify(room.sections)}. This is a lived-in social strategy game house, not a clinical studio.` } }))?.image;
      if (!image) continue;
      await assertBoundary();
      await write((tx) => tx.insert(schema.visualRoomLibrary).values({ roomId: room.id, version: room.version, image: Buffer.from(image) }).onConflictDoNothing());
      const [accepted] = await db.select().from(schema.visualRoomLibrary).where(and(eq(schema.visualRoomLibrary.roomId, room.id), eq(schema.visualRoomLibrary.version, room.version)));
      assets.backgrounds[room.id] = await storeVisualArtifact(db, gameId, accepted!.image);
      await save();
    }
    await assertBoundary();
    await write((tx) => tx.update(schema.visualGameAssets).set({ status: "ready", failure: null }).where(eq(schema.visualGameAssets.gameId, gameId)));
    return { ...assets, status: "ready" as const };
  } catch (error) {
    await assertBoundary();
    const message = error instanceof Error ? error.message : "Visual asset preparation failed";
    await write((tx) => tx.update(schema.visualGameAssets).set({ status: "failed", failure: message }).where(eq(schema.visualGameAssets.gameId, gameId)));
    throw new VisualRecoveryRequired(message);
  }
}
