import { createDB, closeDB, schema } from "/Users/user/Development/influence-game/packages/api/src/db/index.ts";
import { runMigrations } from "/Users/user/Development/influence-game/packages/api/src/db/migrate.ts";
import { EXAMPLE_MODEL_AGENTS } from "/Users/user/Development/influence-game/packages/api/src/services/character-cutout-backfill.ts";
import { readPayload } from "/Users/user/Development/influence-game/packages/api/src/services/payload-storage.ts";
const proofUrl = "postgresql://influence:influence@127.0.0.1:54320/influence_cutout_proof_20261025";
await runMigrations(proofUrl);
const src = createDB(), dst = createDB(proofUrl);
const profiles = (await src.select().from(schema.agentProfiles)).filter(p => EXAMPLE_MODEL_AGENTS.includes(p.id));
const revisions = await src.select().from(schema.agentContentRevisions);
const assets = await src.select().from(schema.agentContentAssets);
for (const p of profiles) {
  await dst.insert(schema.users).values({id:p.userId}).onConflictDoNothing();
  await dst.insert(schema.agentProfiles).values({id:p.id,userId:p.userId,name:p.name,personality:p.personality,fullBodyReferenceUrl:p.fullBodyReferenceUrl}).onConflictDoNothing();
  const rev = revisions.find(r=>r.id===p.contentRevisionId)!;
  await dst.insert(schema.agentContentRevisions).values({id:rev.id,agentProfileId:p.id,userId:p.userId,fingerprint:rev.fingerprint,snapshot:rev.snapshot}).onConflictDoNothing();
  const snapshot = JSON.parse((await readPayload(rev.snapshot)).toString());
  const hashes = Object.values(snapshot.assets as Record<string,string>);
  for (const asset of assets.filter(a=>hashes.includes(a.hash))) await dst.insert(schema.agentContentAssets).values(asset).onConflictDoNothing();
}
// The IDs and immutable revision bytes are copied; only the isolated test rows are linked.
for (const p of profiles) await dst.execute((await import("/Users/user/Development/influence-game/packages/api/node_modules/drizzle-orm/index.js")).sql`UPDATE agent_profiles SET content_revision_id=${p.contentRevisionId} WHERE id=${p.id}`);
console.log(JSON.stringify({database:"influence_cutout_proof_20261025",copiedProfiles:profiles.map(p=>({id:p.id,name:p.name})),sourceDatabaseUnchanged:true}));
await closeDB(); await closeDB(proofUrl);
