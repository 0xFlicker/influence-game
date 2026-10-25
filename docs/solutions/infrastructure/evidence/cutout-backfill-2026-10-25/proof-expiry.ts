import { createDB, closeDB } from "/Users/user/Development/influence-game/packages/api/src/db/index.ts";
import { expireCutoutLeases } from "/Users/user/Development/influence-game/packages/api/src/services/character-cutouts.ts";
const url = "postgresql://influence:influence@127.0.0.1:54320/influence_cutout_proof_20261025";
const db=createDB(url);
// The Docker container has stopped. Simulate deadline passage only in the isolated
// proof database; no development or production lease is changed.
await expireCutoutLeases(db,new Date(Date.now()+3600_001),["0c4cfd09-c961-415c-9ac9-0f435437b023"]);
console.log(JSON.stringify({database:"influence_cutout_proof_20261025",simulation:"lease deadline passed after stopped Docker container",jobId:"0c4cfd09-c961-415c-9ac9-0f435437b023"}));
await closeDB(url);
