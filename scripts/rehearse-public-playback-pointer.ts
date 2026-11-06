/** Explicit disposable PostgreSQL rehearsal; synthetic data only, no host port or mounted data. */
import {randomUUID} from "node:crypto";
import {preparePlaybackPointer} from "./public-playback-pointer";
import {pointerFixture} from "./public-playback-pointer-fixture";

if (process.argv.slice(2).join(" ") !== "--run-disposable-postgres") throw new Error("Explicit disposable rehearsal argument required");
const name=`house-pointer-rehearsal-${randomUUID()}`;
function docker(args:string[],input?:string,expectSuccess=true) {
  const result=Bun.spawnSync(["docker",...args],{stdin:input===undefined?undefined:Buffer.from(input),stdout:"pipe",stderr:"pipe"});
  if ((result.exitCode===0)!==expectSuccess) throw new Error(`Synthetic Docker/PostgreSQL rehearsal failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
}
const psql=(sql:string,success=true)=>docker(["exec","-i",name,"psql","-X","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-At"],sql,success);
let created=false;
try {
  docker(["run","--detach","--name",name,"--network","none","--tmpfs","/var/lib/postgresql/data","-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:17-bookworm"]);created=true;
  let ready=false;
  for(let retry=0;retry<50;retry++) {
    const result=Bun.spawnSync(["docker","exec",name,"pg_isready","-U","postgres"],{stdout:"ignore",stderr:"ignore"});
    if(result.exitCode===0){ready=true;break;}await Bun.sleep(100);
  }
  if(!ready) throw new Error("Disposable PostgreSQL did not start");
  const fixture=pointerFixture(),plan=preparePlaybackPointer(fixture);
  psql(`CREATE TABLE games(id text PRIMARY KEY);
CREATE TABLE game_postgame_media(game_id text REFERENCES games(id),media_type text,status text,render_version integer,artifact_version text,attempt_number integer,
current_ready_render_version integer,current_ready_duration_ms integer,current_ready_published_at text,updated_at text,current_ready_artifact_metadata jsonb,artifact_metadata jsonb,PRIMARY KEY(game_id,media_type));
INSERT INTO games VALUES ('synthetic-pointer');
INSERT INTO game_postgame_media SELECT * FROM jsonb_populate_record(NULL::game_postgame_media,convert_from(decode('${Buffer.from(JSON.stringify(fixture.before)).toString("hex")}','hex'),'UTF8')::jsonb);`);
  const state=()=>JSON.parse(psql("SELECT to_jsonb(m) FROM game_postgame_media m;").trim());
  const same=(actual:unknown,expected:unknown)=>{
    // PostgreSQL JSON property ordering is independent of input serialization.
    const sort=(item:unknown):unknown=>Array.isArray(item)?item.map(sort):item&&typeof item==="object"?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sort(v)])):item;
    if(JSON.stringify(sort(actual))!==JSON.stringify(sort(expected))) throw new Error("Rehearsal row differs");
  };
  psql(plan.forwardSql);same(state(),plan.after);
  psql(plan.forwardSql);same(state(),plan.after); // acknowledged retry
  psql(plan.rollbackSql);same(state(),plan.before);
  psql(plan.rollbackSql);same(state(),plan.before);
  psql("UPDATE game_postgame_media SET render_version=8;");
  psql(plan.forwardSql,false);same(state(),{...plan.before,render_version:8});
  psql("UPDATE game_postgame_media SET render_version=7;");psql(plan.forwardSql);
  psql("UPDATE game_postgame_media SET updated_at='accepted-new-write';");
  psql(plan.rollbackSql,false);same(state(),{...plan.after,updated_at:"accepted-new-write"});
  psql("ALTER TABLE game_postgame_media ADD COLUMN future_schema_field text;");
  psql(plan.forwardSql,false);
  console.log(JSON.stringify({ok:true,syntheticOnly:true,cases:["forward","idempotent retry","rollback","stale publication rejected","accepted later write preserved","schema drift rejected"]}));
} finally {
  if(created) docker(["rm","--force","--volumes",name]);
}
