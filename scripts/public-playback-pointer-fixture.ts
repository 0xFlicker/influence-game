/** Synthetic-only data shared by unit tests and the disposable PostgreSQL rehearsal. */
import {createHash} from "node:crypto";
import {preparePublicPlaybackDocument} from "../packages/web/src/lib/public-playback-migration";
import type {PublicMediaDelivery} from "../packages/web/src/lib/public-media-delivery";

export function pointerFixture() {
  const origin="https://influence-assets-stg.us-iad-10.linodeobjects.com";
  const delivery: PublicMediaDelivery={version:1,publicBaseUrl:"https://assets-staging.thehouse.game",legacyBases:[origin,"https://us-iad-10.linodeobjects.com/influence-assets-stg"]};
  const artifact=(name:string,type:string,letter:string)=>({objectKey:`postgame-media/synthetic/${name}`,publicUrl:`${origin}/postgame-media/synthetic/${name}`,byteLength:100,contentType:type,sha256:`sha256:${letter.repeat(64)}`});
  const video={...artifact("video.mp4","video/mp4","a"),width:1920,height:1080};
  const poster={...artifact("poster.png","image/png","b"),altText:"Synthetic"};
  const captions={...artifact("captions.vtt","text/vtt","c"),language:"en",label:"English"};
  const sourceBytes=Buffer.from(JSON.stringify({schema:"influence.house-highlights.playback",version:1,durationMs:1000,dimensions:{width:1920,height:1080},
    title:"O'Brien $house_storage_pointer$",description:"Synthetic only",renderVersion:"rv_synthetic",videoUrl:video.publicUrl,posterUrl:poster.publicUrl,captionsUrl:captions.publicUrl,
    contentHashes:{video:video.sha256,poster:poster.sha256,captions:captions.sha256}}));
  const sourceSha256=createHash("sha256").update(sourceBytes).digest("hex");
  const prepared=preparePublicPlaybackDocument(sourceBytes,sourceSha256,delivery);
  const metadata={preview:{title:"O'Brien $house_storage_pointer$",description:"Synthetic only"},video,poster,captions,
    manifest:{...artifact("metadata.json","application/json","d"),sha256:`sha256:${sourceSha256}`,byteLength:sourceBytes.byteLength},storage:{provider:"s3",bucket:"influence-assets-stg"}};
  const before={game_id:"synthetic-pointer",media_type:"house_highlights_trailer",status:"ready",render_version:7,artifact_version:"rv_synthetic",attempt_number:1,
    current_ready_render_version:7,current_ready_duration_ms:1000,current_ready_published_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z",
    current_ready_artifact_metadata:metadata,artifact_metadata:structuredClone(metadata)};
  const verifiedTargets=[video,poster,captions,{objectKey:prepared.receipt.proposedObjectKey,byteLength:prepared.bytes.byteLength,sha256:`sha256:${prepared.receipt.destinationSha256}`,contentType:"application/json"}]
    .map(row=>({bucket:"falsefloor-house-staging-public-978355607658",key:row.objectKey,bytes:row.byteLength,sha256:row.sha256.slice(7),version:"synthetic-version",headers:{ContentType:row.contentType},access:"private"}));
  return {environment:"staging" as const,before,sourceBytes,sourceSha256,delivery,verifiedTargets,targetPlaybackBytes:prepared.bytes};
}
