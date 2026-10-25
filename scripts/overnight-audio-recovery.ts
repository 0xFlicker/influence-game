import { resolveCliApiSession } from "../packages/engine/src/cli-api-session";
const [mode,kind]=process.argv.slice(2);
if (!['status','retry','resume'].includes(mode!) || !['werewolf','influence'].includes(kind!)) throw new Error('Usage: status|retry|resume werewolf|influence');
const root=new URL('../../evidence/voice-recovery/',import.meta.url);
const request=await Bun.file(new URL(`${kind}-request.json`,root)).json();
const prepared=await Bun.file(new URL(`${kind}-prepared.json`,root)).json();
const token=await resolveCliApiSession({apiOrigin:'http://127.0.0.1:3000',webOrigin:'http://localhost:3001',requiredRoles:['producer','sysop'],openBrowser:async()=>{throw new Error('Existing CLI authentication required');}});
const path=`/api/admin/production/games/${request.gameId}/audio`;
const get=await fetch(`http://127.0.0.1:3000${path}`,{headers:{Authorization:`Bearer ${token}`}});
if(!get.ok) throw new Error(`Preview failed ${get.status}: ${await get.text()}`);
const preview=await get.json();
for(const [id,voice] of Object.entries(preview.voices) as [string,any][]) {
  if(id==='house' ? voice.voiceId!=='helios' : voice.voiceId!==request.selections[voice.seedIdentity] || voice.origin!=='selected') throw new Error(`Wrong voice ${id}`);
}
if(mode==='status') {console.log(JSON.stringify(preview,null,2));process.exit(0);}
const receipt=new URL(`${kind}-${mode}-receipt.json`,root);
if(await Bun.file(receipt).exists()) throw new Error('Prior receipt exists: inspect outcome before repeating');
const active=preview.tracks.find((t:any)=>t.active);
if(active?.id!==prepared.trackId) throw new Error('Unexpected active track');
if(mode==='retry' && active.status!=='failed') throw new Error('Track is not failed');
if(mode==='resume' && (!preview.resumeOwnerEpoch || preview.resumeOwnerEpoch!==prepared.ownerEpoch)) throw new Error('Not ready to resume');
const endpoint=mode==='retry'?`${path}/${prepared.trackId}/retry`:`${path}/resume`;
const body=mode==='resume'?{ownerEpoch:preview.resumeOwnerEpoch}:{};
await Bun.write(receipt,JSON.stringify({status:'pending',endpoint,body,at:new Date().toISOString()},null,2));
const response=await fetch(`http://127.0.0.1:3000${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60_000)});
const result=await response.text();
await Bun.write(receipt,JSON.stringify({status:response.status,result,endpoint,at:new Date().toISOString()},null,2));
if(!response.ok) throw new Error(result);
console.log(result);
