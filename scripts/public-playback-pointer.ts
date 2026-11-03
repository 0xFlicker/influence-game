/** Offline reconciliation plan. This module opens no connection and executes no SQL. */
import {createHash} from "node:crypto";
import type {PostgameMediaArtifactMetadata} from "../packages/api/src/db/schema";
import {preparePublicPlaybackDocument} from "../packages/web/src/lib/public-playback-migration";
import {resolvePublicMediaUrl, type PublicMediaDelivery} from "../packages/web/src/lib/public-media-delivery";

type Row = Record<string, unknown>;
export interface VerifiedPublicObject {
  bucket: string; key: string; bytes: number; sha256: string; version: string | null;
  headers: {ContentType: string | null}; access: string;
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
};
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Full-row CAS, with the same game-before-media lock order as publication. */
export function pointerSql(before: Row, after: Row): string {
  // Hex literals prevent metadata/prose/identifiers from becoming SQL syntax.
  const literal = (row: Row) => `convert_from(decode('${Buffer.from(JSON.stringify(row)).toString("hex")}','hex'),'UTF8')::jsonb`;
  return `BEGIN;
SET LOCAL lock_timeout = '5s';
DO $house_storage_pointer$
DECLARE expected jsonb := ${literal(before)};
        desired jsonb := ${literal(after)};
        actual jsonb;
BEGIN
  PERFORM id FROM public.games WHERE id = expected->>'game_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Publication parent is missing'; END IF;
  SELECT to_jsonb(m) INTO actual FROM public.game_postgame_media m
    WHERE m.game_id = expected->>'game_id' AND m.media_type = expected->>'media_type' FOR UPDATE;
  IF actual IS NOT DISTINCT FROM desired THEN RETURN; END IF;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Publication changed; replan before reconciliation'; END IF;
  UPDATE public.game_postgame_media SET
    current_ready_artifact_metadata = desired->'current_ready_artifact_metadata',
    artifact_metadata = NULLIF(desired->'artifact_metadata','null'::jsonb)
    WHERE game_id = expected->>'game_id' AND media_type = expected->>'media_type';
END $house_storage_pointer$;
COMMIT;
`;
}

export function preparePlaybackPointer(input: {
  environment: "staging" | "prod";
  /** Exact SELECT to_jsonb(row), not a projection: reject schema or row drift. */
  before: Row;
  sourceBytes: Uint8Array;
  sourceSha256: string;
  delivery: PublicMediaDelivery;
  /** Current target manifest, collected under the writer fence and SHA-pinned by the execution packet. */
  verifiedTargets: VerifiedPublicObject[];
  targetPlaybackBytes: Uint8Array;
}) {
  const {before,delivery,environment}=input;
  const sourceBucket=`influence-assets-${environment === "staging" ? "stg" : "prd"}`;
  const targetBucket=`falsefloor-house-${environment}-public-978355607658`;
  const publicBase=environment === "staging" ? "https://assets-staging.thehouse.game" : "https://assets.thehouse.game";
  const aliases=[`https://${sourceBucket}.us-iad-10.linodeobjects.com`,`https://us-iad-10.linodeobjects.com/${sourceBucket}`];
  if (delivery.publicBaseUrl !== publicBase || canonical([...delivery.legacyBases].sort()) !== canonical(aliases.sort())) throw new Error("Exact environment delivery mapping required");
  if (typeof before.game_id !== "string" || !before.game_id || before.media_type !== "house_highlights_trailer"
    || !Number.isSafeInteger(before.current_ready_render_version) || Number(before.current_ready_render_version) < 1
    || !before.current_ready_published_at || !("artifact_metadata" in before)) throw new Error("Complete published row required");
  const prepared=preparePublicPlaybackDocument(input.sourceBytes,input.sourceSha256,delivery);
  if (hash(input.targetPlaybackBytes) !== prepared.receipt.destinationSha256) throw new Error("Derived playback readback differs");
  const source=JSON.parse(new TextDecoder().decode(input.sourceBytes));
  const metadata=before.current_ready_artifact_metadata as PostgameMediaArtifactMetadata;
  if (!metadata?.manifest || metadata.storage?.bucket !== sourceBucket || metadata.manifest.sha256 !== `sha256:${input.sourceSha256}`
    || metadata.manifest.byteLength !== input.sourceBytes.byteLength || metadata.manifest.contentType !== "application/json"
    || source.durationMs !== before.current_ready_duration_ms || metadata.preview.title !== source.title || metadata.preview.description !== source.description) throw new Error("Publication and source identity differ");
  const checkObject=(key: string, checksum: string, length: number, contentType: string) => {
    const rows=input.verifiedTargets.filter(row=>row.bucket===targetBucket && row.key===key);
    if (rows.length!==1 || rows[0].sha256!==checksum || rows[0].bytes!==length || rows[0].headers.ContentType!==contentType
      || rows[0].access!=="private" || !rows[0].version || rows[0].version==="null") throw new Error("Verified private target version is missing or differs");
  };
  if (canonical(before.artifact_metadata)===canonical(metadata) && before.render_version===before.current_ready_render_version
    && before.artifact_version!==source.renderVersion) throw new Error("Accepted render identity differs");
  const updated=structuredClone(metadata);
  for (const [kind,urlField] of [["video","videoUrl"],["poster","posterUrl"],["captions","captionsUrl"]] as const) {
    const artifact=metadata[kind];
    if (artifact.sha256 !== source.contentHashes[kind] || artifact.publicUrl !== source[urlField]
      || !artifact.objectKey.startsWith("postgame-media/") || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0) throw new Error("Publication media identity differs");
    const resolved=resolvePublicMediaUrl(artifact.publicUrl,delivery);
    if (new URL(resolved).pathname !== `/${artifact.objectKey.split("/").map(encodeURIComponent).join("/")}`) throw new Error("Object key and URL differ");
    checkObject(artifact.objectKey,artifact.sha256.slice(7),artifact.byteLength,artifact.contentType);
    updated[kind].publicUrl=resolved;
  }
  if (metadata.video.width!==source.dimensions.width || metadata.video.height!==source.dimensions.height) throw new Error("Publication dimensions differ");
  const mappedSource=resolvePublicMediaUrl(metadata.manifest.publicUrl,delivery);
  if (new URL(mappedSource).origin!==publicBase || new URL(mappedSource).pathname!==`/${metadata.manifest.objectKey.split("/").map(encodeURIComponent).join("/")}`) throw new Error("Source manifest locator differs");
  checkObject(prepared.receipt.proposedObjectKey,prepared.receipt.destinationSha256,prepared.bytes.byteLength,"application/json");
  updated.manifest={publicUrl:`${publicBase}/${prepared.receipt.proposedObjectKey}`,objectKey:prepared.receipt.proposedObjectKey,
    sha256:`sha256:${prepared.receipt.destinationSha256}`,byteLength:prepared.bytes.byteLength,contentType:"application/json"};
  updated.storage={provider:"aws_s3",bucket:targetBucket};
  const after: Row & {current_ready_artifact_metadata: PostgameMediaArtifactMetadata;artifact_metadata:unknown}={...structuredClone(before),current_ready_artifact_metadata:updated,
    artifact_metadata:canonical(before.artifact_metadata)===canonical(metadata) ? structuredClone(updated) : structuredClone(before.artifact_metadata)};
  return {before:structuredClone(before),after,forwardSql:pointerSql(before,after),rollbackSql:pointerSql(after,before),
    receipt:{schema:"house-publication-pointer/v1",environment,sourceSha256:input.sourceSha256,
      destinationSha256:prepared.receipt.destinationSha256,beforeRowSha256:hash(canonical(before)),afterRowSha256:hash(canonical(after)),
      verifiedTargetsSha256:hash(canonical(input.verifiedTargets)),pointerUpdated:false}};
}
