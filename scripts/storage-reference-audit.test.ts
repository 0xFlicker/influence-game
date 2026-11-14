import {expect,test} from "bun:test";
import {gzipSync} from "node:zlib";
import {mkdtemp,mkdir,readFile,writeFile,stat,rm,unlink,symlink} from "node:fs/promises";
import {join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {auditStorageReferences,referenceSha} from "./storage-reference-audit";
import {pointerFixture} from "./public-playback-pointer-fixture";

function payload(document:unknown) {
  const decoded=Buffer.from(JSON.stringify(document)),stored=gzipSync(decoded),sha256=referenceSha(decoded);
  return {stored,ref:{storage:"private-payload-v1",codec:"json-gzip",key:`payloads/v1/json-gzip/${sha256}`,sha256,byteLength:decoded.byteLength,storedSha256:referenceSha(stored),storedByteLength:stored.byteLength}};
}
test("synthetic historical census follows verified bodies and preserves canonical keys, prose and identities",async()=>{
  const {delivery}=pointerFixture(),old=delivery.legacyBases[0],nested=payload({ownerRevision:{imageUrl:`${old}/characters/old.png`},copiedEpisode:{bucket:"influence-transcript-events-stg",provider:"linode_object_storage"}});
  const document={frozenAssetMap:{[`${old}/pfp/portrait.png`]:"sha256:unchanged"},source:nested.ref,
    published:{videoUrl:`${old}/postgame-media/old.mp4?versionId=retained`},external:{url:"https://unknown.us-iad-10.linodeobjects.com/old"},
    encoded:encodeURIComponent(`${old}/pfp/encoded.png`),uri:"s3://influence-transcript-events-stg/content/old.json",otherDocument:{objectKey:"postgame-media/old/metadata.json"},
    prose:`Keep the canonical note ${old}/pfp/portrait.png`,rawApi:{url:`${old}/pfp/raw.png`}};
  const before=JSON.stringify(document),result=await auditStorageReferences(document,delivery,async key=>key===nested.ref.key?nested.stored:undefined);
  expect(JSON.stringify(document)).toBe(before);
  expect(result.categories).toMatchObject({"canonical-map-key":1,"public-alias-supported":2,"legacy-bucket-identifier":1,"legacy-provider-identifier":1,"source-version-or-invalid-delivery":1,"unmapped-provider-url":1,"embedded-provider-reference":1,"legacy-s3-uri":1,"unparsed-provider-reference":1,"separate-object-census-required":1});
  const custom=await auditStorageReferences({url:"https://legacy.example.test/media/portrait.png",unmapped:"https://legacy.example.test/other/portrait.png"},
    {...delivery,legacyBases:[...delivery.legacyBases,"https://legacy.example.test/media"]},async()=>undefined);
  expect(custom.categories).toMatchObject({"public-alias-supported":1,"unmapped-provider-url":1});
  expect(result.verifiedPayloads).toBe(1);expect(result.payloadBodiesComplete).toBe(true);expect(result.retirementReady).toBe(false);
});
test("missing, corrupt and inconsistent body references cannot count as complete coverage",async()=>{
  const {delivery}=pointerFixture(),item=payload({url:`${delivery.legacyBases[0]}/pfp/test.png`});
  for(const bytes of [undefined,new Uint8Array([0])]) {
    const result=await auditStorageReferences({source:item.ref},delivery,async()=>bytes);
    expect(result.payloadBodiesComplete).toBe(false);expect(result.verifiedPayloads).toBe(0);
  }
  const result=await auditStorageReferences([item.ref,{...item.ref,storedByteLength:1}],delivery,async()=>item.stored);
  expect(result.payloadBodiesComplete).toBe(false);expect(result.categories["conflicting-payload-reference"]).toBe(1);
});
test("file-only audit pins inputs, writes private evidence and refuses overwrite",async()=>{
  const root=await mkdtemp(join(tmpdir(),"house-reference-audit-"));
  try {
    const {delivery}=pointerFixture(),item=payload({url:`${delivery.legacyBases[0]}/characters/test.png`});
    const input=Buffer.from(JSON.stringify({source:item.ref})),config=Buffer.from(JSON.stringify(delivery));
    const objects=join(root,"objects"),body=join(objects,item.ref.key),report=join(root,"report.json");
    await mkdir(dirname(body),{recursive:true});await writeFile(body,item.stored);
    await writeFile(join(root,"input.json"),input);await writeFile(join(root,"delivery.json"),config);
    const args=[process.execPath,join(import.meta.dir,"audit-storage-reference-file.ts"),"--input",join(root,"input.json"),"--input-sha256",referenceSha(input),"--delivery",join(root,"delivery.json"),"--delivery-sha256",referenceSha(config),"--payload-directory",objects,"--output",report];
    const first=Bun.spawn(args,{stdout:"pipe",stderr:"pipe"});expect(await first.exited).toBe(0);
    const summary=JSON.parse(await new Response(first.stdout).text());expect(summary).toMatchObject({localOnly:true,verifiedPayloads:1,retirementReady:false});
    expect(JSON.stringify(summary)).not.toContain("characters/test");expect((await stat(report)).mode & 0o777).toBe(0o600);
    const before=await readFile(report);const again=Bun.spawn(args,{stdout:"pipe",stderr:"pipe"});expect(await again.exited).not.toBe(0);expect(await readFile(report)).toEqual(before);
    const outside=join(root,"outside.bin");await writeFile(outside,item.stored);await unlink(body);await symlink(outside,body);
    const escapedReport=join(root,"escaped.json"),escaped=Bun.spawn([...args.slice(0,-1),escapedReport],{stdout:"pipe",stderr:"pipe"});
    expect(await escaped.exited).not.toBe(0);expect(await Bun.file(escapedReport).exists()).toBe(false);
  } finally {await rm(root,{recursive:true,force:true});}
});
