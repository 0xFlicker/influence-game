import {createHash} from "node:crypto";
import {resolvePublicMediaUrl, type PublicMediaDelivery} from "./public-media-delivery";
import type {HouseHighlightsTrailerPlaybackMetadata} from "./house-highlights-trailer-media-bundle";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const fields = ["schema","version","durationMs","dimensions","title","description","videoUrl","posterUrl","captionsUrl","renderVersion","contentHashes"].sort();
const hashPattern = /^sha256:[a-f0-9]{64}$/;

/** Prepare a new public delivery document. No upload, DB pointer update or mutation. */
export function preparePublicPlaybackDocument(sourceBytes: Uint8Array, expectedSha256: string, delivery: PublicMediaDelivery) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || sha(sourceBytes) !== expectedSha256) throw new Error("Playback source digest differs from reviewed input");
  const source = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(sourceBytes)) as HouseHighlightsTrailerPlaybackMetadata;
  if (!source || typeof source !== "object" || JSON.stringify(Object.keys(source).sort()) !== JSON.stringify(fields)
    || source.schema !== "influence.house-highlights.playback" || source.version !== 1
    || !Number.isSafeInteger(source.durationMs) || source.durationMs <= 0
    || !source.dimensions || JSON.stringify(Object.keys(source.dimensions).sort()) !== '["height","width"]'
    || ![source.dimensions.width,source.dimensions.height].every(value => Number.isSafeInteger(value) && value > 0)
    || ![source.title,source.description,source.renderVersion,source.videoUrl,source.posterUrl,source.captionsUrl].every(value => typeof value === "string")
    || !source.contentHashes || JSON.stringify(Object.keys(source.contentHashes).sort()) !== '["captions","poster","video"]'
    || !Object.values(source.contentHashes).every(value => typeof value === "string" && hashPattern.test(value))) throw new Error("Unsupported public playback metadata schema");
  const document = {...source};
  const changedFields: string[] = [];
  for (const key of ["videoUrl","posterUrl","captionsUrl"] as const) {
    document[key] = resolvePublicMediaUrl(source[key],delivery);
    const resolved = new URL(document[key]);
    if (resolved.origin !== new URL(delivery.publicBaseUrl).origin || !resolved.pathname.startsWith('/postgame-media/')) throw new Error("Playback artifact is outside the reviewed public delivery mapping");
    if (document[key] !== source[key]) changedFields.push(key);
  }
  // Media hashes, dimensions, timing, render version and editorial text stay exact.
  const bytes = new TextEncoder().encode(JSON.stringify(document)+"\n");
  const destinationSha256 = sha(bytes);
  return {bytes, receipt:{schema:"house-public-playback-delivery/v1", sourceSha256:expectedSha256,
    destinationSha256, sourceBytes:sourceBytes.byteLength, destinationBytes:bytes.byteLength,
    deliveryConfigSha256:sha(JSON.stringify(delivery)), changedFields,
    proposedObjectKey:`postgame-media/delivery-v1/${expectedSha256}/${destinationSha256}.json`,
    contentType:"application/json", contentHashes:source.contentHashes,
    pointerUpdateRequired:true, pointerUpdated:false, objectUploaded:false}};
}
