import { beforeEach, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { loadWerewolfTrailerSnapshot } from "../services/werewolf-trailer-snapshot.js";
let db: DrizzleDB;
beforeEach(async()=>{db=await setupTestDB();});
async function fixture() {
  const id="trailer-snapshot",slug="trailer-snapshot-slug";
  const events=await werewolfResultsFixture("saved",id);
  await db.insert(schema.games).values({id,slug,gameKind:"werewolf",status:"completed",config:'{"visibility":"public"}'});
  await db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
  await db.insert(schema.houseCutJobs).values({gameId:id,audience:"mystery",status:"ready",publication:{version:"v1",audience:"mystery",cuts:[]}});
  return {id,slug,events};
}
test("snapshot supports Public/Unlisted, freezes source, and cannot queue jobs or export private state",async()=>{
  const f=await fixture();
  for(const visibility of ["public","unlisted"]){
    await db.update(schema.games).set({config:JSON.stringify({visibility})}).where(eq(schema.games.id,f.id));
    const m=await loadWerewolfTrailerSnapshot(db,f.slug);
    expect(m.cast).toHaveLength(8);expect(m.story.audience).toBe("mystery");
    expect(JSON.stringify(m)).not.toMatch(/SECRET_|roles|protectedId|attackTargetId|winnerIds/);
  }
  expect(await db.select().from(schema.gamePostgameMedia)).toHaveLength(0);
  expect((await db.select().from(schema.werewolfEvents).orderBy(asc(schema.werewolfEvents.sequence))).map(r=>r.event)).toEqual(f.events);
  await db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,f.id));
  await expect(loadWerewolfTrailerSnapshot(db,f.slug)).rejects.toThrow("unavailable");
});
test("snapshot distinguishes pending/failed Cuts and refuses active games or corrupt history",async()=>{
  const f=await fixture();
  await db.update(schema.houseCutJobs).set({status:"running",publication:null}).where(eq(schema.houseCutJobs.gameId,f.id));
  await expect(loadWerewolfTrailerSnapshot(db,f.id)).rejects.toThrow("waiting");
  await db.update(schema.houseCutJobs).set({status:"failed"}).where(eq(schema.houseCutJobs.gameId,f.id));
  expect((await loadWerewolfTrailerSnapshot(db,f.id)).story.editorialStatus).toBe("failed");
  await db.update(schema.games).set({status:"in_progress"}).where(eq(schema.games.id,f.id));
  await expect(loadWerewolfTrailerSnapshot(db,f.id)).rejects.toThrow("completed");
  await db.update(schema.games).set({status:"completed"}).where(eq(schema.games.id,f.id));
  await db.delete(schema.werewolfEvents).where(eq(schema.werewolfEvents.sequence,f.events.length));
  await expect(loadWerewolfTrailerSnapshot(db,f.id)).rejects.toThrow();
});

// Exercise the shared queue and publication path with canonical Werewolf facts.
import { reconcilePostgameMediaForGame, requestPostgameMedia, reconcileCompletedPostgameMedia } from "../services/postgame-media-coordinator.js";
import { claimPostgameMedia, finalizePostgameMedia, failPostgameMediaAttempt } from "../services/postgame-media-worker.js";
import { getPublicPostgameMedia } from "../services/postgame-media.js";

async function repair(id: string) {
  return requestPostgameMedia(db, { gameId: id, actorUserId: "operator", action: "rerender", reason: "W5 test", source: "test" });
}
async function seedOperator() {
  await db.insert(schema.users).values({ id: "operator" });
}

test("settled Werewolf Cuts queue exactly once across simultaneous automatic and operator requests", async () => {
  const { id } = await fixture(); await seedOperator();
  const outcomes = await Promise.all([reconcilePostgameMediaForGame(db, id), reconcilePostgameMediaForGame(db, id), repair(id)]);
  expect(outcomes.filter(r => r.outcome === "queued")).toHaveLength(1);
  const claim = await claimPostgameMedia(db, "local-test");
  expect(claim?.manifest.kind).toBe("werewolf");
  expect(claim?.provenance.musicAssetId).toBe("werewolf-suno-trailer-v1");
  expect(claim?.provenance.rendererVersion).toBe("remotion-v2");
  expect(await claimPostgameMedia(db, "other-worker")).toBeNull();
});

test("completion recovery waits for Cuts and queues failed/empty editorial results without a quota", async () => {
  const { id } = await fixture();
  await db.update(schema.houseCutJobs).set({ status: "queued", publication: null }).where(eq(schema.houseCutJobs.gameId, id));
  expect((await reconcileCompletedPostgameMedia(db)).waitingInputs).toBe(1);
  expect(await claimPostgameMedia(db, "local-test")).toBeNull();
  await db.update(schema.houseCutJobs).set({ status: "failed" }).where(eq(schema.houseCutJobs.gameId, id));
  expect((await reconcileCompletedPostgameMedia(db)).queued).toBe(1);
  const claim = await claimPostgameMedia(db, "local-test");
  expect(claim?.manifest.cueSheet.totalDurationSeconds).toBe(9);
});

test("Public and Unlisted share publication and repair, preserving the ready bundle on replacement failure", async () => {
  const { id } = await fixture(); await seedOperator();
  await db.update(schema.games).set({ config: '{"visibility":"unlisted"}' }).where(eq(schema.games.id, id));
  await reconcilePostgameMediaForGame(db, id);
  const claim = (await claimPostgameMedia(db, "local-test"))!;
  const request = { gameId: id, attemptNumber: claim.attemptNumber, leaseToken: claim.leaseToken, ...claim.provenance,
    renderDurationMs: 9000, artifacts: artifactFixture(id, claim.artifactVersion) };
  expect(await finalizePostgameMedia(db, request)).toEqual({ ok: true });
  const ready = await getPublicPostgameMedia(db, id); expect(ready.status).toBe("ready");
  expect((await repair(id)).outcome).toBe("queued");
  const replacement = (await claimPostgameMedia(db, "local-test"))!;
  expect(await finalizePostgameMedia(db, request)).toEqual({ ok: false, error: "stale_or_invalid_lease" });
  await failPostgameMediaAttempt(db, { gameId: id, attemptNumber: replacement.attemptNumber, leaseToken: replacement.leaseToken, category: "render", message: "Test failure" });
  expect(await getPublicPostgameMedia(db, id)).toEqual(ready);
});

test("hidden games cannot queue, claim or publish; stale manifests fail with an actionable repair state", async () => {
  const { id } = await fixture();
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, id));
  expect((await reconcilePostgameMediaForGame(db, id)).outcome).toBe("not_completed");
  await db.update(schema.games).set({ hiddenAt: null }).where(eq(schema.games.id, id));
  await reconcilePostgameMediaForGame(db, id);
  await db.update(schema.gamePostgameMedia).set({ renderInputSnapshot: { schemaVersion: 1 } }).where(eq(schema.gamePostgameMedia.gameId, id));
  expect(await claimPostgameMedia(db, "local-test")).toBeNull();
  const [failed] = await db.select().from(schema.gamePostgameMedia);
  expect(failed?.failureCategory).toBe("render_input");
  expect(failed?.failureMessage).toContain("fresh trailer render");
  await seedOperator(); await repair(id);
  const claim = (await claimPostgameMedia(db, "local-test"))!;
  const request = { gameId: id, attemptNumber: claim.attemptNumber, leaseToken: claim.leaseToken, ...claim.provenance,
    renderDurationMs: 9000, artifacts: artifactFixture(id, claim.artifactVersion) };
  expect(await finalizePostgameMedia(db, request, { artifactVerifier: async () => {
    await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, id));
  } })).toEqual({ ok: false, error: "game_unavailable" });
  expect((await getPublicPostgameMedia(db, id)).status).not.toBe("ready");
});

function artifactFixture(gameId: string, artifactVersion: string) {
  const root = `postgame-media/house-highlights-trailers/${gameId}/${artifactVersion}`;
  const url = `https://media.example.test/${root}`;
  const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  return {
    preview: { title: "House Highlights", description: "The game, cut by The House." },
    video: { publicUrl: `${url}/trailer.mp4`, objectKey: `${root}/trailer.mp4`, contentType: "video/mp4", byteLength: 10, sha256: digest, width: 1920, height: 1080 },
    poster: { publicUrl: `${url}/poster.png`, objectKey: `${root}/poster.png`, contentType: "image/png", byteLength: 10, sha256: digest, altText: "Trailer poster" },
    captions: { publicUrl: `${url}/captions.vtt`, objectKey: `${root}/captions.vtt`, contentType: "text/vtt", byteLength: 10, sha256: digest, language: "en", label: "English" },
    manifest: { publicUrl: `${url}/metadata.json`, objectKey: `${root}/metadata.json`, contentType: "application/json", byteLength: 10, sha256: digest },
    storage: { provider: "s3", bucket: "public-media" },
  };
}


import { createGameRoutes } from "../routes/games.js";
test("the shared media route accepts Werewolf slugs anonymously without the Influence 409 guard", async () => {
  const { id, slug } = await fixture();
  const app = createGameRoutes(db);
  for (const visibility of ["public", "unlisted"]) {
    await db.update(schema.games).set({ config: JSON.stringify({ visibility }) }).where(eq(schema.games.id, id));
    const response = await app.request(`/api/games/${slug}/postgame/media`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ status: "not_requested" });
  }
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, id));
  expect((await app.request(`/api/games/${slug}/postgame/media`)).status).toBe(404);
});
