import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from '../../../packages/api/node_modules/sharp';
const root=import.meta.dir,api='http://127.0.0.1:3000';
const prior=JSON.parse(await readFile('/Users/user/Documents/Codex/2026-10-24/task/evidence/clean-verification/assets/manifest.json','utf8'));
const assets=JSON.parse(await readFile(`${root}/published-assets/manifest.json`,'utf8'));
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function bytes(path:string){ const url=new URL(path,api);if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Unexpected remote origin');const r=await fetch(url,{redirect:'error'});if(!r.ok)throw Error(`HTTP${r.status} ${url.pathname}`);return Buffer.from(await r.arrayBuffer());}
async function json(path:string){return JSON.parse((await bytes(path)).toString('utf8'));}
const results=[];
for(const [kind,id] of [['werewolf','f1fe7318-72c6-46f4-bb98-e4a4bb54692e'],['influence','7362d8ec-52e7-4f93-81e1-3b08c745d4ca']]){
 const data=kind==='werewolf'?await json(`/api/werewolf/${id}/watch?audience=omniscient&fromCursor=1&limit=64`):await json(`/api/games/${id}`);
 const visual=kind==='influence'?await json(`/api/games/${id}/visual`):null;
 for(const player of data.players){
  const old=prior.find((x:any)=>x.gameKind===kind&&x.playerId===player.id);if(!old)throw Error('Unexpected player');
  const bodyUrl=visual?.fullBodies[player.id]??player.fullBodyReferenceUrl,portraitUrl=visual?.portraits[player.id]??player.avatarUrl;
  const body=await bytes(bodyUrl),portrait=await bytes(portraitUrl),meta=await sharp(body).metadata();
  const gemini=player.name==='Gemini Pro';const expectedBody=gemini?assets.assets['cutout.png'].sha256:old.sha256;const expectedPortrait=gemini?assets.assets['portrait.webp'].sha256:old.portraitSha256;
  const alpha=await sharp(body).extractChannel('alpha').stats();
  results.push({kind,name:player.name,bodyUrl,portraitUrl,bodyHash:hash(body),portraitHash:hash(portrait),expectedBody,expectedPortrait,matches:hash(body)===expectedBody&&hash(portrait)===expectedPortrait,rgba:meta.hasAlpha&&meta.channels===4,transparent:alpha.channels[0].min===0,opaque:alpha.channels[0].max===255});
 }
}
const result={at:new Date().toISOString(),passed:results.every(x=>x.matches&&(x.name!=='Gemini Pro'||(x.rgba&&x.transparent&&x.opaque))),otherAssetsUnchanged:results.filter(x=>x.name!=='Gemini Pro').every(x=>x.matches),newGeminiValid:results.filter(x=>x.name==='Gemini Pro').every(x=>x.matches&&x.rgba&&x.transparent&&x.opaque),results};await writeFile(`${root}/verification.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,assets:results.length,gemini:results.filter(x=>x.name==='Gemini Pro')}));if(!result.passed)process.exitCode=1;
