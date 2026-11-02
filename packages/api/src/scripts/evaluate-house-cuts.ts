/** Opt-in, retained localhost API evaluation. Three audience journals cap total spend at $2.25. */
import { mkdir, open, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { cutInfluenceFixture, cutWerewolfFixture } from "@influence/engine/house-cuts/fixtures";
import { cutTrialSpend, newCutTrialJournal } from "@influence/engine/house-cuts/trial";
import { schema, closeDB } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { createSessionToken } from "../middleware/auth.js";
import { createGameResultsRoutes } from "../routes/game-results.js";
import { insertCanonicalEventRows, insertOwner } from "../__tests__/durable-run-test-utils.js";
import { loadHouseCutSource } from "../services/house-cut-source.js";
import { loadPayloads, storeFields } from "../services/payload-storage.js";
import { runHouseCutJob } from "../services/house-cut-worker.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== "127.0.0.1" || !new URL(databaseUrl).pathname.startsWith("/influence_cuts_eval_")) throw new Error("Use a dedicated localhost influence_cuts_eval_* database");
if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI credentials required");
if (!process.env.LINODE_PRIVATE_CONTENT_ENDPOINT?.startsWith("http://127.0.0.1:")) throw new Error("Evaluation requires local private storage");
const directory = resolve(process.env.CUTS_EVALUATION_OUTPUT ?? ".renders/house-cuts-v3");
await mkdir(directory, { recursive: true, mode: 0o700 });
const lock = await open(resolve(directory, "run.lock"), "wx", 0o600);
await lock.writeFile(JSON.stringify({ budgetUsd: 2.25, database: new URL(databaseUrl).pathname, startedAt: new Date().toISOString() }));
await lock.close(); // Intentionally retained: rerunning needs a fresh database/output and a new spending decision.
const db = await runMigrations(databaseUrl);
if ((await db.select({ id: schema.games.id }).from(schema.games).limit(1)).length) throw new Error("Evaluation database must be empty");
process.env.JWT_SECRET = crypto.randomUUID();
const operator = "cuts-evaluation-operator";
await db.insert(schema.users).values({ id: operator });
await db.insert(schema.roles).values({ id: "cuts-evaluation-admin", name: "admin" }).onConflictDoNothing();
const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "admin"));
await db.insert(schema.userRoles).values({ userId: operator, roleId: role!.id });
const influence = cutInfluenceFixture(), werewolf = cutWerewolfFixture();
const ids = [influence.events[0]!.gameId, werewolf[0]!.gameId];
await db.insert(schema.games).values(ids.map((id, i) => ({ id, slug: id, gameKind: i ? "werewolf" as const : "influence" as const, status: "completed" as const, config: '{"visibility":"public"}' })));
const owner = await insertOwner(db, ids[0]!);
await insertCanonicalEventRows(db, ids[0]!, owner, influence.events);
await db.insert(schema.transcripts).values(influence.dialogue.map(e => ({ gameId: ids[0]!, round: e.round, phase: e.phase, text: e.text, timestamp: e.timestamp, scope: e.scope, speakerPlayerId: e.speakerPlayerId, entrySequence: e.entrySequence, dialogueKind: e.dialogueKind })));
await db.insert(schema.werewolfEvents).values(werewolf.map(event => ({ gameId: ids[1]!, sequence: event.sequence, event })));
for (const [gameId, audience] of [[ids[0]!, "public"], [ids[1]!, "mystery"], [ids[1]!, "omniscient"]] as const) {
  const source = await loadHouseCutSource(db, gameId, audience);
  await db.insert(schema.houseCutJobs).values(await storeFields({ gameId, audience, status: "failed" as const, failure: "Evaluation fixture awaiting API recovery", source, journal: newCutTrialJournal(source, 0.75) }, { source: "json-gzip", journal: "json-gzip" }));
}
const app = createGameResultsRoutes(db);
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
const origin = `http://127.0.0.1:${server.port}`;
const headers = { authorization: `Bearer ${await createSessionToken(operator)}`, "content-type": "application/json" };
const request = async (path: string, init?: RequestInit) => {
  const response = await fetch(`${origin}${path}`, { ...init, headers });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
};
await writeFile(resolve(directory, "games.json"), JSON.stringify({ origin, ids, budgetUsd: 2.25 }, null, 2), { mode: 0o600 });
try {
  for (const gameId of ids) {
    const jobs = await loadPayloads(db.select().from(schema.houseCutJobs).where(eq(schema.houseCutJobs.gameId, gameId)));
    for (const job of jobs) {
      await request(`/api/games/${gameId}/cuts/recover`, { method: "POST", body: JSON.stringify({ audience: job.audience, expectedUpdatedAt: job.updatedAt.toISOString(), idempotencyKey: `evaluation-${job.audience}` }) });
      await runHouseCutJob(db);
      const publication = await request(`/api/games/${gameId}/cuts?audience=${job.audience}`);
      await writeFile(resolve(directory, `${gameId}-${job.audience}.json`), JSON.stringify(publication, null, 2), { mode: 0o600 });
      const [saved] = await loadPayloads(db.select().from(schema.houseCutJobs).where(eq(schema.houseCutJobs.id, job.id)));
      if (saved!.status !== "ready") throw new Error(`Evaluation job failed: ${saved!.failure}`);
      console.log(JSON.stringify({ gameId, audience: job.audience, cards: saved!.publication!.cuts.length, estimatedUsd: cutTrialSpend(saved!.journal!) }));
    }
  }
} finally {
  const jobs = await loadPayloads(db.select().from(schema.houseCutJobs));
  const evidence = jobs.map(j => ({ gameId: j.gameId, audience: j.audience, status: j.status, failure: j.failure, estimatedUsd: j.journal ? cutTrialSpend(j.journal) : 0, journal: j.journal }));
  await writeFile(resolve(directory, "private-evidence.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ totalEstimatedUsd: evidence.reduce((n, j) => n + j.estimatedUsd, 0), directory }));
  server.stop(true);
  await closeDB(databaseUrl);
}
