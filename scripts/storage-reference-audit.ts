/** Read-only audit of supplied historical documents; never a whole-estate retirement proof. */
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {resolvePublicMediaUrl, type PublicMediaDelivery} from "../packages/web/src/lib/public-media-delivery";

export type ReferenceFinding = {path: string[]; category: string; referenceSha256: string};
export const referenceSha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function auditStorageReferences(document: unknown, delivery: PublicMediaDelivery,
  readPayload: (key: string) => Promise<Uint8Array | undefined>) {
  resolvePublicMediaUrl("https://reference-audit.invalid/",delivery); // Validate even a document with no URLs.
  const legacyHosts=new Set(delivery.legacyBases.map(value=>new URL(value).hostname));
  const findings: ReferenceFinding[]=[];
  const verified=new Map<string,string>();
  let payloadBodiesComplete=true;
  const finding=(path:string[],category:string,reference:string)=>findings.push({path,category,referenceSha256:referenceSha(reference)});
  function inspectText(text:string,path:string[],mapKey=false) {
    if (/^influence-(assets|transcript-events)-(stg|prd)$/.test(text)) finding(path,"legacy-bucket-identifier",text);
    if (text==="linode_object_storage") finding(path,"legacy-provider-identifier",text);
    if (/s3:\/\/influence-(assets|transcript-events)-(stg|prd)(?:\/|$)/.test(text)) finding(path,"legacy-s3-uri",text);
    let providerUrls=0;
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      const raw=match[0];let url:URL;
      try {url=new URL(raw);} catch {continue;}
      if (!url.hostname.toLowerCase().endsWith(".linodeobjects.com") && !legacyHosts.has(url.hostname)) continue;
      providerUrls++;
      if (mapKey || raw!==text) {finding(path,mapKey?"canonical-map-key":"embedded-provider-reference",raw);continue;}
      try {
        const resolved=resolvePublicMediaUrl(raw,delivery);
        finding(path,resolved!==raw?"public-alias-supported":"unmapped-provider-url",raw);
      } catch {finding(path,"source-version-or-invalid-delivery",raw);}
    }
    if (!providerUrls && (text.includes("linodeobjects.com") || [...legacyHosts].some(host=>text.includes(host)))) finding(path,"unparsed-provider-reference",text);
  }
  async function walk(value:unknown,path:string[]):Promise<void> {
    if(typeof value==="string"){inspectText(value,path);return;}
    if(Array.isArray(value)){for(let index=0;index<value.length;index++)await walk(value[index],[...path,String(index)]);return;}
    if(!value || typeof value!=="object")return;
    const object=value as Record<string,unknown>;
    if(object.storage==="private-payload-v1") {
      const {key,codec,sha256,byteLength,storedSha256,storedByteLength}=object;
      if(Object.keys(object).sort().join(",")!=="byteLength,codec,key,sha256,storage,storedByteLength,storedSha256" || typeof key!=="string" || typeof codec!=="string" || !["binary","json-gzip","text-gzip"].includes(codec)
        || typeof sha256!=="string" || !/^[a-f0-9]{64}$/.test(sha256) || key!==`payloads/v1/${codec}/${sha256}`
        || typeof storedSha256!=="string" || !/^[a-f0-9]{64}$/.test(storedSha256)
        || !Number.isSafeInteger(byteLength) || Number(byteLength)<0 || !Number.isSafeInteger(storedByteLength) || Number(storedByteLength)<0) {
        payloadBodiesComplete=false;finding(path,"invalid-payload-reference",JSON.stringify(object));return;
      }
      const identity=JSON.stringify({key,codec,sha256,byteLength,storedSha256,storedByteLength});
      if(verified.has(key)) {
        if(verified.get(key)!==identity){payloadBodiesComplete=false;finding(path,"conflicting-payload-reference",key);}
        return;
      }
      const stored=await readPayload(key);
      if(!stored){payloadBodiesComplete=false;finding(path,"uninspected-payload",key);return;}
      try {
        if(stored.byteLength!==storedByteLength || referenceSha(stored)!==storedSha256)throw new Error("Stored integrity differs");
        const decoded=codec==="binary"?stored:gunzipSync(stored);
        if(decoded.byteLength!==byteLength || referenceSha(decoded)!==sha256)throw new Error("Decoded integrity differs");
        verified.set(key,identity);
        if(codec!=="binary") {
          const text=new TextDecoder("utf-8",{fatal:true}).decode(decoded);
          await walk(codec==="json-gzip"?JSON.parse(text):text,[...path,"@payload"]);
        }
      } catch {
        verified.delete(key);payloadBodiesComplete=false;finding(path,"unverified-payload-bytes",key);
      }
      return;
    }
    for(const [key,item] of Object.entries(object)) {
      inspectText(key,[...path,"@key"],true);
      if (/^(objectKey|key)$/.test(key) && typeof item==="string" && /^(postgame-media|content|game-assets|renders)\//.test(item)) finding([...path,key],"separate-object-census-required",item);
      await walk(item,[...path,key]);
    }
  }
  await walk(document,[]);
  const categories:Record<string,number>={};
  for(const row of findings)categories[row.category]=(categories[row.category]??0)+1;
  return {schema:"house-storage-reference-audit/v1",inputSha256:referenceSha(JSON.stringify(document)),findings,categories,
    verifiedPayloads:verified.size,payloadBodiesComplete,retirementReady:false,scope:"supplied-documents-only"};
}
