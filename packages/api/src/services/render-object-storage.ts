import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { objectStorageBucket, objectStorageClient } from "../lib/object-storage-config.js";
type ObjectAdapter={upload:(key:string,byteLength:number,sha256:string)=>Promise<{url:string;headers:Record<string,string>}>;
  download:(key:string)=>Promise<string>;verify:(key:string,expected:{byteLength:number;sha256:string})=>Promise<void>};
let testAdapter:ObjectAdapter|undefined;
export class RenderObjectIntegrityError extends Error {}
/** Explicit injection for deterministic PostgreSQL tests; never selected by environment. */
export function setRenderObjectStorageForTests(adapter:ObjectAdapter|undefined) {testAdapter=adapter;}

export async function renderUpload(key: string, byteLength: number, sha256: string) {
  if(testAdapter)return testAdapter.upload(key,byteLength,sha256);
  const checksum = Buffer.from(sha256,"hex").toString("base64");
  const url = await getSignedUrl(objectStorageClient("data"), new PutObjectCommand({
    Bucket:objectStorageBucket("data"), Key:key, ContentType:"application/octet-stream",
    ContentLength:byteLength, ChecksumSHA256:checksum, IfNoneMatch:"*",
  }), {expiresIn:900, unhoistableHeaders:new Set(["x-amz-checksum-sha256"])});
  return {url,headers:{"Content-Type":"application/octet-stream","Content-Length":String(byteLength),
    "x-amz-checksum-sha256":checksum,"If-None-Match":"*"}};
}

export async function renderDownload(key: string) {
  if(testAdapter)return testAdapter.download(key);
  return getSignedUrl(objectStorageClient("data"),new GetObjectCommand({Bucket:objectStorageBucket("data"),Key:key}),{expiresIn:900});
}

/** Streaming verification: multipart ETags and caller metadata are not content hashes. */
export async function verifyRenderObject(key: string, expected: {byteLength:number;sha256:string}) {
  if(testAdapter)return testAdapter.verify(key,expected);
  const client=objectStorageClient("data"), Bucket=objectStorageBucket("data");
  const head=await client.send(new HeadObjectCommand({Bucket,Key:key}));
  if(head.ContentLength!==expected.byteLength) throw new RenderObjectIntegrityError("Render object length mismatch");
  const object=await client.send(new GetObjectCommand({Bucket,Key:key}));
  if(!object.Body) throw new Error("Render object missing");
  const hash=createHash("sha256"); let size=0;
  for await(const chunk of object.Body as AsyncIterable<Uint8Array>) {hash.update(chunk);size+=chunk.length;}
  if(size!==expected.byteLength || hash.digest("hex")!==expected.sha256) throw new RenderObjectIntegrityError("Render object checksum mismatch");
}
