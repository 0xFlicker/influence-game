import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { storeBinary, readPayload } from "./payload-storage.js";
export class AgentDraftImageUnavailable extends Error {}
type Reader = Pick<DrizzleDB, "select">;
export const draftImageHash = (url: string | null) =>
  url?.match(/^\/api\/agent-profiles\/images\/([a-f0-9]{64})$/)?.[1] ?? null;
export async function storeAgentDraftImage(
  db: DrizzleDB,
  userId: string,
  bytes: Uint8Array,
) {
  const hash = createHash("sha256").update(bytes).digest("hex"),
    reference = await storeBinary(bytes);
  await readPayload(reference);
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.agentContentAssets)
      .values({ hash, bytes: reference, isPublic: false })
      .onConflictDoNothing();
    await tx
      .insert(schema.agentImageOwners)
      .values({ userId, hash })
      .onConflictDoNothing();
  });
  return "/api/agent-profiles/images/" + hash;
}
export async function readAgentDraftImage(
  db: Reader,
  hash: string,
  userId?: string,
) {
  const [asset] = await db
    .select()
    .from(schema.agentContentAssets)
    .where(eq(schema.agentContentAssets.hash, hash));
  if (!asset) throw new AgentDraftImageUnavailable("Character image not found");
  if (!asset.isPublic) {
    const [owner] = userId
      ? await db
          .select()
          .from(schema.agentImageOwners)
          .where(
            and(
              eq(schema.agentImageOwners.hash, hash),
              eq(schema.agentImageOwners.userId, userId),
            ),
          )
      : [];
    if (!owner)
      throw new AgentDraftImageUnavailable("Character image is private");
  }
  return readPayload(asset.bytes);
}
export async function publishContentImages(
  db: Pick<DrizzleDB, "update">,
  snapshot: Record<string, unknown>,
) {
  const assets = snapshot.assets;
  if (!assets || typeof assets !== "object" || Array.isArray(assets))
    throw new Error("Accepted image evidence is missing");
  const hashes = Object.values(assets).filter(
    (hash): hash is string => typeof hash === "string",
  );
  if (hashes.length)
    await db
      .update(schema.agentContentAssets)
      .set({ isPublic: true })
      .where(inArray(schema.agentContentAssets.hash, hashes));
}
