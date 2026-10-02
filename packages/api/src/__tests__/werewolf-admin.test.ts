import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { runWerewolf, projectWerewolfView, replayWerewolf, type WerewolfAgent } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { createSessionToken } from "../middleware/auth.js";
import { createWerewolfAdminRoutes } from "../routes/werewolf-admin.js";
import { createWerewolfRoutes } from "../routes/werewolf.js";
import { createVisualRoutes } from "../routes/visual.js";
import { createVisualReplayProductionRoutes } from "../routes/visual-replay-production.js";
import { createWerewolfGame, claimWerewolfGame, createWerewolfStore, readWerewolfEvents } from "../services/werewolf-games.js";
import { readReplayVisualProduction, renderMissingReplayScene } from "../services/visual-replay-production.js";
import { readWerewolfScenePreview, werewolfReferences } from "../services/werewolf-production.js";
import { claimVisualMediaJob, executeVisualMediaJob } from "../services/visual-media-worker.js";
import { controlVisualMedia, readVisualMedia } from "../services/visual-media-repair.js";
import { readViewerMedia } from "../services/visual-media-viewer.js";
import { readWerewolfCharacter, readWerewolfWatch, readWerewolfPresentation } from "../services/werewolf-presentation.js";
import { contentSnapshot } from "../services/agent-content-submissions.js";
import { storeVisualArtifact } from "../services/visual-scene-store.js";
let db: DrizzleDB;
const oldSecret = process.env.JWT_SECRET;
beforeEach(async () => { db = await setupTestDB(); process.env.JWT_SECRET = "werewolf-admin-test-secret"; await db.insert(schema.users).values({ id: "owner" }); });
afterEach(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
async function operator(role: string, permissions: string[] = []) {
  const id = `user-${role}`, address = `0x${role}`;
  await db.insert(schema.users).values({ id, walletAddress: address });
  await db.insert(schema.roles).values({ id: role, name: role });
  await db.insert(schema.userRoles).values({ userId: id, roleId: role });
  for (const permission of permissions) {
    await db.insert(schema.permissions).values({ id: permission, name: permission, description: permission }).onConflictDoNothing();
    await db.insert(schema.rolePermissions).values({ roleId: role, permissionId: permission });
  }
  return { Authorization: `Bearer ${await createSessionToken(id, { roles: [role], permissions })}`, "Content-Type": "application/json" };
}
async function game(completed = true, agentProfileIds: string[] = []) {
  const g = await createWerewolfGame(db, "owner", { preset: "two_wolves", agentProfileIds, maxDays: 1 });
  if (completed) {
    const owner = await claimWerewolfGame(db, g.id); if (!owner.ok) throw Error(owner.error);
    const agent: WerewolfAgent = { async decide({ request }) {
      if (request.action === "open_thread") return { kind: "opening", text: null, cue: "Leans back", recipientIds: [] };
      if (request.legalTargetIds.length) return { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "PRIVATE_REASON" };
      return { kind: "speech", text: request.action === "pack_talk" ? "PRIVATE_PACK" : "Hello village", cue: "Nods" };
    } };
    await runWerewolf(createWerewolfStore(db, g.id, owner.claim.ownerEpoch), agent);
  }
  return g;
}
test("admin discovery is Werewolf-only, includes hidden games, enforces current permissions and exposes canonical activity", async () => {
  const g = await game(), headers = await operator("admin", ["view_admin", "hide_game"]), app = createWerewolfAdminRoutes(db);
  await db.insert(schema.games).values({ id: "influence", slug: "influence", config: "{}" });
  expect((await app.request("/api/admin/werewolf")).status).toBe(401);
  const read = await app.request(`/api/admin/werewolf/${g.id}`, { headers });
  expect(read.status).toBe(200); expect(read.headers.get("cache-control")).toBe("private, no-store");
  const detail = await read.json() as { snapshot: { rulesVersion: number } };
  expect(detail.snapshot.rulesVersion).toBe(7);
  expect(JSON.stringify(detail)).not.toContain("PRIVATE_PACK");
  expect(JSON.stringify(detail)).not.toContain('"entries"');
  const activity = await app.request(`/api/admin/werewolf/${g.id}/activity`, { headers });
  expect(activity.status).toBe(200);
  const view = await activity.json();
  expect(view).toEqual(projectWerewolfView(replayWerewolf(await readWerewolfEvents(db, g.id)), "omniscient"));
  expect(JSON.stringify(view)).toContain("PRIVATE_PACK");
  expect(JSON.stringify(view)).not.toContain("PRIVATE_REASON");
  const visibility = `/api/admin/werewolf/${g.id}/visibility`;
  expect((await app.request(visibility, { method: "PATCH", headers, body: '{"hidden":true,"extra":1}' })).status).toBe(400);
  expect((await app.request(visibility, { method: "PATCH", headers, body: '{"hidden":true}' })).status).toBe(200);
  const rows = await (await app.request("/api/admin/werewolf", { headers })).json() as Array<{ hidden: boolean }>; expect(rows).toHaveLength(1); expect(rows[0]!.hidden).toBe(true);
  const publicApi = createWerewolfRoutes(db);
  expect(await (await publicApi.request("/api/werewolf")).json()).toEqual([]);
  expect((await publicApi.request(`/api/werewolf/${g.slug}`)).status).toBe(404);
  const costs = await (await app.request(`/api/admin/werewolf/${g.id}/costs`, { headers })).json() as { gameplay: { state: string }; production: { attempts: unknown[] } }; expect(costs.gameplay.state).toBe("no_calls"); expect(costs.production.attempts).toEqual([]);
  await app.request(visibility, { method: "PATCH", headers, body: '{"hidden":false}' });
  expect((await publicApi.request(`/api/werewolf/${g.slug}`)).status).toBe(200);
  expect((await app.request("/api/admin/werewolf/influence", { headers })).status).toBe(404);
  await db.delete(schema.userRoles).where(eq(schema.userRoles.roleId, "admin"));
  expect((await app.request(`/api/admin/werewolf/${g.id}`, { headers })).status).toBe(403);
});

test("pack and lobby production use canonical membership and publish privately through shared jobs", async () => {
  const g = await game(), before = await readWerewolfEvents(db, g.id);
  const inventory = await readReplayVisualProduction(db, g.id);
  const pack = inventory.scenes.find(s => s.roomId === "mingle-1")!;
  expect(pack.participants).toHaveLength(2); expect(inventory.scenes.find(s => s.roomId === "lobby")!.participants).toHaveLength(8);
  const headers = await operator("producer"), app = createVisualReplayProductionRoutes(db);
  const receipt = await renderMissingReplayScene(db, g.id, "user-producer", { key: pack.key, previewHash: pack.previewHash, requestId: "pack-render" });
  expect(receipt.accepted).toBe(true);
  expect(await renderMissingReplayScene(db, g.id, "user-producer", { key: pack.key, previewHash: pack.previewHash, requestId: "pack-render" })).toEqual(receipt);
  const job = (await claimVisualMediaJob(db, "fixture-worker"))!;
  const bytes = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#292d22" } }).png().toBuffer();
  const artifact = await storeVisualArtifact(db, g.id, bytes);
  const anchors = job.plan.cast.map((p, i) => ({ playerId: p.id, label: i + 1, head: { x: .2 + i * .3, y: .2, width: .1, height: .1 }, confidence: "clear" as const }));
  await executeVisualMediaJob(db, job, new AbortController().signal, async () => ({ imageArtifactId: artifact, localization: { count: 2, verifiedParticipantIds: job.plan.cast.map(p => p.id), anchors } }));
  const version = (await readVisualMedia(db, g.id)).versions[0]!;
  expect((await controlVisualMedia(db, g.id, "user-producer", { action: "publish", audience: "private", sceneId: job.sceneId, expectedVersion: version.version, versionId: version.id, expectedPublication: 0, requestId: "publish-pack" })).accepted).toBe(true);
  const events = await readWerewolfEvents(db, g.id);
  const omni = projectWerewolfView(replayWerewolf(events), "omniscient");
  const packCursor = omni.entries.findIndex(e => e.kind === "speech" && e.audience === "pack") + 1;
  expect(packCursor).toBeGreaterThan(0);
  expect((await readWerewolfPresentation(db, g.id, "omniscient", packCursor)).presentation.scene).toBeNull();
  const publicReplay = createWerewolfRoutes(db);
  const mediaPath = `/api/werewolf/${g.id}/media/${artifact}`;
  expect((await publicReplay.request(`${mediaPath}?audience=omniscient&cursor=${packCursor}`)).status).toBe(404);
  expect((await controlVisualMedia(db, g.id, "user-producer", { action: "publish", audience: "public", sceneId: job.sceneId, expectedVersion: version.version, versionId: version.id, expectedPublication: 1, requestId: "publish-public-pack" })).accepted).toBe(true);
  const frame = (await readWerewolfPresentation(db, g.id, "omniscient", packCursor)).presentation;
  expect(frame.scene?.version).toBe(version.version);
  expect((await readWerewolfPresentation(db, g.id, "omniscient", packCursor, "2000-01-01T00:00:00.000Z")).presentation.scene).toBeNull();
  expect((await readWerewolfPresentation(db, g.id, "omniscient", packCursor, frame.publicationCutoff)).presentation.scene?.version).toBe(version.version);
  expect(frame.scene?.imageUrl).toContain(`/media/${artifact}?`);
  expect(JSON.stringify(frame)).not.toContain("PRIVATE_REASON");
  expect(JSON.stringify(frame)).not.toContain("imageArtifactId");
  expect((await publicReplay.request(`${mediaPath}?audience=omniscient&cursor=${packCursor}`)).status).toBe(200);
  expect((await publicReplay.request(`${mediaPath}?audience=omniscient&cursor=1`)).status).toBe(404);
  expect((await publicReplay.request(`${mediaPath}?audience=mystery&cursor=${packCursor}`)).status).toBe(404);
  expect((await publicReplay.request(`/api/werewolf/${g.id}/presentation?audience=mystery&cursor=1`)).status).toBe(200);
  const candidateImage = await storeVisualArtifact(db, g.id, await sharp({ create: { width: 640, height: 360, channels: 3, background: "#552255" } }).png().toBuffer());
  const [candidate] = await db.insert(schema.visualMediaVersions).values({ ...version, id: `${version.id}-candidate`, version: version.version + 1, imageArtifactId: candidateImage, createdAt: new Date().toISOString() }).returning();
  expect((await readWerewolfPresentation(db, g.id, "omniscient", packCursor)).presentation.scene?.version).toBe(version.version);
  expect((await publicReplay.request(`/api/werewolf/${g.id}/media/${candidateImage}?audience=omniscient&cursor=${packCursor}`)).status).toBe(404);
  expect((await controlVisualMedia(db, g.id, "user-producer", { action: "publish", audience: "public", sceneId: job.sceneId, expectedVersion: job.version, versionId: candidate!.id, expectedPublication: 2, requestId: "publish-new-public-pack" })).accepted).toBe(true);
  expect((await readWerewolfPresentation(db, g.id, "omniscient", packCursor)).presentation.scene?.version).toBe(candidate!.version);
  expect((await readWerewolfPresentation(db, g.id, "omniscient", packCursor, frame.publicationCutoff)).presentation.scene?.version).toBe(version.version);
  expect((await publicReplay.request(frame.scene!.imageUrl)).status).toBe(200);
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, g.id));
  expect((await publicReplay.request(`${mediaPath}?audience=omniscient&cursor=${packCursor}`)).status).toBe(404);
  expect((await publicReplay.request(`/api/werewolf/${g.id}/presentation`)).status).toBe(404);
  await db.update(schema.games).set({ hiddenAt: null }).where(eq(schema.games.id, g.id));
  const preview = await readWerewolfScenePreview(db, g.id, job.sceneId); expect(preview?.players).toHaveLength(2); expect(preview?.scene.imageUrl).toStartWith("data:image/png;base64,");
  const publicApi = createVisualRoutes(db);
  expect((await publicApi.request(`/api/games/${g.id}/visual`)).status).toBe(404);
  expect((await publicApi.request(`/api/games/${g.id}/visual/artifacts/${artifact}`)).status).toBe(404);
  expect(await readViewerMedia(db, g.id)).toEqual({ publicationSnapshot: {}, bindings: {}, scenes: [] });
  expect((await publicApi.request(`/api/admin/games/${g.id}/visual/media`, { method: "POST", headers, body: "{}" })).status).toBe(409);
  const path = `/api/admin/production/games/${g.id}/visual/scenes/${job.sceneId}/preview`;
  expect((await app.request(path)).status).toBe(401); expect((await app.request(path, { headers })).status).toBe(200);
  await db.delete(schema.userRoles).where(eq(schema.userRoles.roleId, "producer"));
  expect((await app.request(path, { headers })).status).toBe(403);
  expect(await readWerewolfEvents(db, g.id)).toEqual(before);
});

test("incomplete games cannot start production and unavailable references never borrow editable profiles", async () => {
  const g = await game(false);
  await expect(readReplayVisualProduction(db, g.id)).rejects.toThrow("completed");
  const refs = await werewolfReferences(db, g.id); expect(refs).toHaveLength(8); expect(refs.every(r => r.kind === "portrait")).toBe(true);
});

test("production reads captured revision bytes, never a later character edit", async () => {
  const bytes = await sharp({ create: { width: 32, height: 48, channels: 3, background: "#113355" } }).png().toBuffer();
  const hash = "sha256:frozen-reference";
  const portraitBytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#556677" } }).png().toBuffer();
  await db.insert(schema.agentContentAssets).values({ hash: "portrait-hash", bytes: portraitBytes });
  const [profile] = await db.insert(schema.agentProfiles).values({ id: "custom", userId: "owner", name: "Arden Vale", personality: "Quiet", avatarUrl: "/old.png", fullBodyReferenceUrl: "/old-full.png" }).returning();
  await db.insert(schema.agentContentAssets).values({ hash, bytes });
  await db.insert(schema.agentContentRevisions).values({ id: "original-content", agentProfileId: "custom", userId: "owner", ancestryKnown: true, fingerprint: "original-content", snapshot: { ...contentSnapshot(profile!), assets: { "/old-full.png": hash, "/old.png": "portrait-hash" } } });
  await db.update(schema.agentProfiles).set({ contentRevisionId: "original-content" }).where(eq(schema.agentProfiles.id, "custom"));
  const g = await createWerewolfGame(db, "owner", { preset: "one_wolf", agentProfileIds: ["custom"], maxDays: 1 });
  await db.update(schema.agentProfiles).set({ name: "Edited Arden Vale", fullBodyReferenceUrl: "/new-full.png" }).where(eq(schema.agentProfiles.id, "custom"));
  const refs = await werewolfReferences(db, g.id);
  const saved = refs.find(r => r.profile.name === "Arden Vale")!;
  expect(saved.portraitBytes).toEqual(portraitBytes);
  expect(await readWerewolfCharacter(db,g.id,saved.profile.id)).toEqual(portraitBytes);
  expect(await readWerewolfCharacter(db,g.id,saved.profile.id,"body")).toEqual(bytes);
  const identity=(await readWerewolfWatch(db,g.id,"mystery",1,10)).players.find(p=>p.id===saved.profile.id)!;
  expect(identity.fullBodyReferenceUrl).toContain("image=body");
  expect(identity.avatarUrl).not.toContain("image=body");
  expect(saved.kind).toBe("full_body"); expect(saved.bytes).toEqual(bytes); expect(JSON.stringify(refs)).not.toContain("new-full");
  const [portraitProfile] = await db.insert(schema.agentProfiles).values({ id: "portrait-only", userId: "owner", name: "Rowan Finch", personality: "Quiet", avatarUrl: "/old.png", fullBodyReferenceUrl: "/uncaptured-full.png" }).returning();
  await db.insert(schema.agentContentRevisions).values({ id: "portrait-content", agentProfileId: "portrait-only", userId: "owner", ancestryKnown: true, fingerprint: "portrait-content", snapshot: { ...contentSnapshot(portraitProfile!), assets: { "/old.png": "portrait-hash" } } });
  await db.update(schema.agentProfiles).set({ contentRevisionId: "portrait-content" }).where(eq(schema.agentProfiles.id, "portrait-only"));
  const portraitGame = await createWerewolfGame(db, "owner", { preset: "one_wolf", agentProfileIds: ["portrait-only"], maxDays: 1 });
  const portrait = (await werewolfReferences(db, portraitGame.id)).find(r => r.profile.name === "Rowan Finch")!;
  expect(portrait.kind).toBe("portrait"); expect(portrait.bytes).toEqual(portraitBytes);
});

test("producer discovery cannot grant itself game visibility controls", async () => {
  const g = await game(); const headers = await operator("producer"); const app = createWerewolfAdminRoutes(db);
  expect((await app.request("/api/admin/werewolf", { headers })).status).toBe(200);
  expect((await app.request(`/api/admin/werewolf/${g.id}/visibility`, { method: "PATCH", headers, body: '{"hidden":true}' })).status).toBe(403);
});

test("missing frozen references reject production without reading a current profile URL", async () => {
  await db.insert(schema.agentProfiles).values({ id: "unfrozen", userId: "owner", name: "Rowan Finch", personality: "Direct", fullBodyReferenceUrl: "https://example.invalid/current.png" });
  const g = await game(true, ["unfrozen"]);
  const inventory = await readReplayVisualProduction(db, g.id);
  expect(inventory.warnings.join(" ")).toContain("Rowan Finch");
  const lobby = inventory.scenes.find(scene => scene.roomId === "lobby")!;
  const app = createVisualReplayProductionRoutes(db), headers = await operator("producer");
  const response = await app.request(`/api/admin/production/games/${g.id}/visual/missing`, { method: "POST", headers, body: JSON.stringify({ key: lobby.key, previewHash: lobby.previewHash, requestId: "missing-reference" }) });
  expect(response.status).toBe(409); expect(await response.text()).toContain("Frozen reference unavailable");
  expect((await readVisualMedia(db, g.id)).jobs).toHaveLength(0);
});

test("Werewolf costs reconcile actual, estimated, failed retry and unknown ledger entries", async () => {
  const g = await game(false), app = createWerewolfAdminRoutes(db), headers = await operator("admin", ["view_admin"]);
  await db.insert(schema.gameProviderSpendEntries).values([
    { id: "cost-actual", gameId: g.id, sourceKey: "cost-actual", captureSource: "live_trace", costSource: "provider_actual", actualCostMicrousd: 1200, callStatus: "succeeded", provider: "fixture", modelName: "fixture-model", totalTokens: 120 },
    { id: "cost-retry", gameId: g.id, sourceKey: "cost-retry", captureSource: "live_trace", costSource: "catalog_estimate", estimatedCostMicrousd: 300, callStatus: "failed", attemptOrdinal: 2, retryParentSourceKey: "cost-actual", provider: "fixture", modelName: "fixture-model", totalTokens: 30 },
    { id: "cost-unknown", gameId: g.id, sourceKey: "cost-unknown", captureSource: "live_trace", costSource: "unavailable", callStatus: "unknown", provider: "fixture", modelName: "unpriced-model" },
  ]);
  const response = await app.request(`/api/admin/werewolf/${g.id}/costs`, { headers });
  expect(response.status).toBe(200);
  const { gameplay } = await response.json() as { gameplay: { actualCostMicrousd: number; estimatedCostMicrousd: number; unpricedCallCount: number; callCount: number; failedCallCount: number; retryFailureSpend: { retryCallCount: number }; breakdowns: Record<string, Record<string, { callCount: number }>> } };
  expect(gameplay.actualCostMicrousd).toBe(1200); expect(gameplay.estimatedCostMicrousd).toBe(300);
  expect(gameplay.callCount).toBe(3); expect(gameplay.unpricedCallCount).toBe(1); expect(gameplay.failedCallCount).toBe(1);
  expect(gameplay.retryFailureSpend.retryCallCount).toBe(1); expect(gameplay.breakdowns.model!["fixture-model"]!.callCount).toBe(2);
});

test("summary and activity share live access while operations retain narrower grants", async () => {
  const g = await game(), app = createWerewolfAdminRoutes(db);
  const adminRoleOnly = await operator("admin");
  const ordinary = await operator("member");
  const viewer = await operator("viewer", ["view_admin"]);
  const producer = await operator("producer");
  const sysop = await operator("sysop");
  for (const headers of [adminRoleOnly, ordinary]) {
    expect((await app.request(`/api/admin/werewolf/${g.id}`, {headers})).status).toBe(403);
    expect((await app.request(`/api/admin/werewolf/${g.id}/activity`, {headers})).status).toBe(403);
  }
  for (const headers of [viewer, producer, sysop]) {
    const summary = await app.request(`/api/admin/werewolf/${g.slug}`, {headers});
    expect(summary.status).toBe(200);
    const detail = await summary.json() as {id:string; capabilities:{visibility:boolean;stop:boolean;production:boolean};snapshot:Record<string,unknown>};
    expect(detail.id).toBe(g.id); expect(detail.capabilities.visibility).toBe(false); expect(detail.capabilities.stop).toBe(false);
    expect(detail.capabilities.production).toBe(headers !== viewer);
    expect(Object.keys(detail.snapshot).sort()).toEqual(["cursor","day","outcome","phase","players","rulesVersion"]);
    const activity = await app.request(`/api/admin/werewolf/${g.id}/activity`, {headers});
    expect(activity.status).toBe(200); expect(activity.headers.get("cache-control")).toBe("private, no-store");
    expect((await app.request(`/api/admin/werewolf/${g.id}/visibility`,{method:"PATCH",headers,body:'{"hidden":true}'})).status).toBe(403);
  }
  await db.delete(schema.userRoles).where(eq(schema.userRoles.roleId, "viewer"));
  expect((await app.request(`/api/admin/werewolf/${g.id}/activity`,{headers:viewer})).status).toBe(403);
});

test("watch windows are bounded, private by audience and pinned to public media", async () => {
  const g=await game(), app=createWerewolfRoutes(db);
  for(const audience of ["mystery","omniscient"] as const){
    const response=await app.request(`/api/werewolf/${g.slug}/watch?audience=${audience}&limit=8`);
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    const value=await response.json() as import("@influence/engine/werewolf/watch-contract").WerewolfWatchWindow;
    expect(value.moments.length).toBeLessThanOrEqual(8);
    expect(value.moments.every(moment=>!("entries" in moment.snapshot))).toBe(true);
    expect(JSON.stringify(value)).not.toContain("PRIVATE_REASON");expect(JSON.stringify(value)).not.toContain('"boundary"');expect(JSON.stringify(value)).not.toContain('"strategy"');
    if(audience==="mystery")expect(value.moments.every(moment=>moment.snapshot.players.every(player=>!player.role))).toBe(true);
    const later=await app.request(`/api/werewolf/${g.id}/watch?audience=${audience}&fromCursor=${value.latestCursor+1}&publishedBefore=${encodeURIComponent(value.publicationCutoff)}`);
    const empty=await later.json() as typeof value;expect(empty.moments).toEqual([]);expect(empty.latestCursor).toBe(value.latestCursor);expect(empty.publicationCutoff).toBe(value.publicationCutoff);
  }
  for(const query of ["limit=65","limit=0","fromCursor=-1","fromCursor=1.5","audience=wolf","publishedBefore=bad"]){expect((await app.request(`/api/werewolf/${g.id}/watch?${query}`)).status).toBe(400);}
  await db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,g.id));
  expect((await app.request(`/api/werewolf/${g.id}/watch`)).status).toBe(404);
});
