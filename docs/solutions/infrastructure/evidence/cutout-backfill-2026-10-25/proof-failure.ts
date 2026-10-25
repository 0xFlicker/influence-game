import { createDB, closeDB } from "/Users/user/Development/influence-game/packages/api/src/db/index.ts";
import { expireCutoutLeases, reserveCutout } from "/Users/user/Development/influence-game/packages/api/src/services/character-cutouts.ts";
import { discoverCutoutSources, inspectCutoutSources, enqueueCutoutSelection, cutoutProgress } from "/Users/user/Development/influence-game/packages/api/src/services/character-cutout-backfill.ts";
const url="postgresql://influence:influence@127.0.0.1:54320/influence_cutout_proof_20261025";
const db=createDB(url);
const {sources}=await discoverCutoutSources(db,{agent:"98b07560-c4fe-4517-b1bd-916de9f4269e"});
const ids=await enqueueCutoutSelection(db,await inspectCutoutSources(db,sources));
const job=(await cutoutProgress(db,ids)).jobs[0]!;
// Simulated dead dispatches in the isolated proof DB. No live container/lease is stolen.
for(let i=0;i<3;i++){await reserveCutout(db,job.id);await expireCutoutLeases(db,new Date(Date.now()+3600_001),[job.id]);}
console.log(JSON.stringify({database:"influence_cutout_proof_20261025",simulation:"three abandoned dispatch deadlines",...await cutoutProgress(db,ids)}));
await closeDB(url);
