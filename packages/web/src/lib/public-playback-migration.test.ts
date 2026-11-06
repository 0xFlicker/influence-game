import {expect,test} from "bun:test";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,rm,stat,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {preparePublicPlaybackDocument} from "./public-playback-migration";
import {createHouseHighlightsTrailerPlaybackMetadata} from "./house-highlights-trailer-media-bundle";
import type {PublicMediaDelivery} from "./public-media-delivery";

const old="https://influence-assets-stg.us-iad-10.linodeobjects.com";
const delivery: PublicMediaDelivery={version:1,publicBaseUrl:"https://assets-staging.thehouse.game",legacyBases:[old]};
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
function fixture() {
  return createHouseHighlightsTrailerPlaybackMetadata({preview:{title:"Synthetic history",description:"Unchanged story"},durationMs:15000,
    dimensions:{width:1920,height:1080},renderVersion:"7",urls:{videoUrl:`${old}/postgame-media/fixture/video.mp4#t=1`,posterUrl:`${old}/postgame-media/fixture/poster.png`,captionsUrl:`${old}/postgame-media/fixture/captions.vtt`},
    contentHashes:{video:'sha256:'+'a'.repeat(64),poster:'sha256:'+'b'.repeat(64),captions:'sha256:'+'c'.repeat(64)}});
}

test('derived playback metadata retains source identity and media hashes under a new versioned key',()=>{
  const source=fixture(),bytes=Buffer.from(JSON.stringify(source)+'\n'),before=Buffer.from(bytes);
  const prepared=preparePublicPlaybackDocument(bytes,hash(bytes),delivery);
  const output=JSON.parse(new TextDecoder().decode(prepared.bytes));
  expect(bytes).toEqual(before);
  expect(output.contentHashes).toEqual(source.contentHashes);
  expect({...output,videoUrl:source.videoUrl,posterUrl:source.posterUrl,captionsUrl:source.captionsUrl}).toEqual(source);
  expect(output.videoUrl).toBe(`${delivery.publicBaseUrl}/postgame-media/fixture/video.mp4#t=1`);
  expect(prepared.receipt.sourceSha256).toBe(hash(before));
  expect(prepared.receipt.destinationSha256).toBe(hash(prepared.bytes));
  expect(prepared.receipt.destinationSha256).not.toBe(prepared.receipt.sourceSha256);
  expect(prepared.receipt.proposedObjectKey).toContain(prepared.receipt.destinationSha256);
  expect(prepared.receipt).toMatchObject({pointerUpdated:false,objectUploaded:false});
});

test('wrong source digest, unknown schemas, unrelated origins and pinned old versions stop preparation',()=>{
  for (const patch of [{version:2},{videoUrl:'https://external.example.test/video.mp4'},
    {videoUrl:`${old}/postgame-media/fixture/video.mp4?versionId=old`},{unrecognizedCanonicalField:true},
    {contentHashes:{video:'missing',poster:'missing',captions:'missing'}}]) {
    const bytes=Buffer.from(JSON.stringify({...fixture(),...patch}));
    expect(()=>preparePublicPlaybackDocument(bytes,hash(bytes),delivery)).toThrow();
  }
  const bytes=Buffer.from(JSON.stringify(fixture()));
  expect(()=>preparePublicPlaybackDocument(bytes,'0'.repeat(64),delivery)).toThrow('digest');
});

test('local CLI writes a separate private delivery/receipt pair and refuses overwrite',async()=>{
  const root=await mkdtemp(join(tmpdir(),'house-public-playback-'));
  try {
    const bytes=Buffer.from(JSON.stringify(fixture())),config=Buffer.from(JSON.stringify(delivery));
    const source=join(root,'original.json'),policy=join(root,'delivery-config.json'),output=join(root,'prepared');
    await writeFile(source,bytes);await writeFile(policy,config);
    const script=resolve(import.meta.dir,'../../../../scripts/prepare-public-playback-delivery.ts');
    const args=[process.execPath,script,'--source',source,'--source-sha256',hash(bytes),'--config',policy,'--config-sha256',hash(config),'--output',output];
    const first=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'});
    expect(await first.exited).toBe(0);
    expect(JSON.parse(await new Response(first.stdout).text())).toMatchObject({ok:true,localOnly:true,changedFields:3});
    expect(await readFile(source)).toEqual(bytes);
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    expect((await stat(join(output,'receipt.json'))).mode & 0o777).toBe(0o600);
    const receipt=await readFile(join(output,'receipt.json'));
    const second=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'});
    expect(await second.exited).not.toBe(0);
    expect(await readFile(join(output,'receipt.json'))).toEqual(receipt);
  } finally {await rm(root,{recursive:true,force:true});}
});
