import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { championshipFixture, policies } from "./championship-fixtures.js";
import { configureChampionshipDraft, lockChampionshipRoster, readFrozenCompetitionBuild, readChampionship } from "../services/championships.js";
import { processChampionshipArtwork, setChampionshipArtDependenciesForTests, readChampionshipArtAttempts, reconcileChampionshipArtAttempt } from "../services/championship-artwork.js";
import { activateChampionship, dispatchChampionshipMatch } from "../services/championship-dispatch.js";
import { readJson, readPayload } from "../services/payload-storage.js";
import { readWerewolfEvents } from "../services/werewolf-games.js";
import { renderChampionshipVisualReference } from "../services/visual-render-journal.js";
import { ensureActiveAgentRevision, resolveFreeTrackEffectiveRuntimeSnapshot } from "../services/agent-revisions.js";

const existing = await sharp({ create: { width: 40, height: 60, channels: 3, background: "#123456" } }).png().toBuffer();
const generated = await sharp({ create: { width: 40, height: 60, channels: 3, background: "#987654" } }).png().toBuffer();
const publish = async (image: Parameters<import("../services/championship-artwork.js").ChampionshipArtDependencies["publish"]>[0]) => { await readPayload(image); return `/api/uploads/local?key=characters/${image.sha256}.png`; };
async function draft() {
  const f = await championshipFixture();
  await configureChampionshipDraft(f.db, f.event.id, { policies, startDate: "2020-01-01" });
  return f;
}

test("missing art creates account-linked competition revisions automatically and leaves live profiles intact", async () => {
  const { db, event, actorId, agents } = await draft();
  await db.update(schema.agentProfiles).set({ avatarUrl: null, fullBodyReferenceUrl: null }).where(eq(schema.agentProfiles.id, agents[0]!));
  await db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: null }).where(eq(schema.agentProfiles.id, agents[1]!));
  await db.update(schema.agentProfiles).set({ avatarUrl: null }).where(eq(schema.agentProfiles.id, agents[2]!));
  const calls: Array<{ kind: string; references: number; prompt: string }> = [];
  setChampionshipArtDependenciesForTests({ read: async () => existing, publish, generate: async (_db, input) => {
    await input.beforeDispatch(); calls.push({ kind: input.kind, references: input.request.references.length, prompt: input.request.prompt }); return generated;
  } });
  const before = await db.select().from(schema.agentProfiles);
  const requested = await lockChampionshipRoster(db, event.id, actorId, randomUUID());
  expect(requested.status).toBe("preparing");
  expect(calls).toHaveLength(0);
  expect(await db.select().from(schema.championshipEntries)).toHaveLength(0);
  await expect(activateChampionship(db, event.id, actorId, randomUUID())).rejects.toThrow("Lock the complete event");
  await db.update(schema.agentProfiles).set({ personality: "Later live owner edit", avatarUrl: "/api/uploads/local?key=later.png" }).where(eq(schema.agentProfiles.id, agents[0]!));
  await Promise.all([processChampionshipArtwork(db, { eventId: event.id, limit: 8 }), processChampionshipArtwork(db, { eventId: event.id, limit: 8 })]);
  expect((await db.select().from(schema.championshipEvents))[0]!.status).toBe("locked");
  expect(calls).toHaveLength(4);
  expect(calls.filter(row => row.kind === "body")).toHaveLength(2);
  expect(calls.filter(row => row.references === 0)).toHaveLength(1);
  expect(calls.every(row => row.prompt.includes("Frozen personality"))).toBe(true);
  const frozen = await readFrozenCompetitionBuild(db, event.id, agents[0]!);
  expect(frozen.ownerId).toBe(actorId); expect(frozen.agentId).toBe(agents[0]!);
  expect(frozen.character.personality).toBe("Frozen personality");
  expect(frozen.character.avatarUrl).not.toBeNull(); expect(frozen.character.fullBodyReferenceUrl).not.toBeNull();
  expect(frozen.artwork?.revisionId).toBe(frozen.competitionRevisionId);
  const live = (await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, agents[0]!)))[0]!;
  expect(live.avatarUrl).toBe("/api/uploads/local?key=later.png"); expect(live.fullBodyReferenceUrl).toBeNull();
  expect((await db.select().from(schema.agentProfiles)).filter(row => row.id !== live.id)).toEqual(before.filter(row => row.id !== live.id));
  await activateChampionship(db, event.id, actorId, randomUUID());
  for (const ordinal of [1, 2]) {
    const game = await dispatchChampionshipMatch(db, event.id, ordinal);
    const start = (await readWerewolfEvents(db, game.gameId!))[0]!;
    if (start.type !== "werewolf.started") throw new Error("Missing start");
    expect(start.payload.players.find(row => row.agentProfileId === agents[0])!.fullBodyReferenceUrl).toBe(frozen.character.fullBodyReferenceUrl);
  }
  const finale = await dispatchChampionshipMatch(db, event.id, 17);
  const seat = (await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, finale.gameId!))).find(row => row.agentProfileId === agents[0])!;
  expect(JSON.parse(seat.persona).fullBodyReferenceUrl).toBe(frozen.character.fullBodyReferenceUrl);
  expect(JSON.stringify(await readChampionship(db, event.id))).not.toContain("Frozen personality");
});

test("failed publication retries saved artwork without regenerating or requiring owner action", async () => {
  const { db, event, actorId, agents } = await draft();
  await db.update(schema.agentProfiles).set({ avatarUrl: null, fullBodyReferenceUrl: null }).where(eq(schema.agentProfiles.id, agents[0]!));
  let calls = 0, fail = false;
  setChampionshipArtDependenciesForTests({ read: async () => existing, publish: async image => { if (fail) throw new Error("Fixture storage outage"); return publish(image); }, generate: async () => { calls++; return generated; } });
  await lockChampionshipRoster(db, event.id, actorId, randomUUID()); fail = true;
  const attempted = await processChampionshipArtwork(db, { eventId: event.id, limit: 8 });
  expect(attempted.some(row => row.error === "Fixture storage outage")).toBe(true); expect(calls).toBe(2);
  fail = false;
  await db.update(schema.championshipArtwork).set({ nextAttemptAt: null }).where(eq(schema.championshipArtwork.eventId, event.id));
  await processChampionshipArtwork(db, { eventId: event.id, limit: 8 });
  expect(calls).toBe(2);
  expect((await db.select().from(schema.championshipEvents))[0]!.status).toBe("locked");
});

async function addAlternate(f: Awaited<ReturnType<typeof draft>>) {
  const id = randomUUID();
  const [profile] = await f.db.insert(schema.agentProfiles).values({ id, userId: f.actorId, name: "Rank nine", personality: "Alternate", avatarUrl: "/api/uploads/local?key=alternate-head.png", fullBodyReferenceUrl: "/api/uploads/local?key=alternate-body.png" }).returning();
  const { revision } = await ensureActiveAgentRevision(f.db, { profile: profile!, effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(profile!), trigger: "profile_create" });
  const [receipt] = await f.db.select().from(schema.competitionReceipts);
  await f.db.insert(schema.competitionReceipts).values({ ...receipt!, id: randomUUID(), agentProfileId: id, agentRevisionId: revision.id, agentNameSnapshot: "Rank nine", totalPoints: 1, basePoints: 1 });
  return id;
}

test("pre-lock fallback uses the next frozen rank with audit evidence; locked field never silently changes", async () => {
  const f = await draft(); const alternate = await addAlternate(f);
  await f.db.update(schema.agentProfiles).set({ archivedAt: new Date().toISOString() }).where(eq(schema.agentProfiles.id, f.agents[0]!));
  const locked = await lockChampionshipRoster(f.db, f.event.id, f.actorId, randomUUID());
  expect(locked.status).toBe("locked");
  const entries = await f.db.select().from(schema.championshipEntries);
  expect(entries).toHaveLength(8); expect(entries.some(row => row.agentId === f.agents[0])).toBe(false);
  expect(entries.find(row => row.agentId === alternate)!.qualificationRank).toBe(9);
  expect((await f.db.select().from(schema.competitionAudit)).some(row => row.action === "qualifier_unavailable" && row.reason.includes(f.agents[0]!))).toBe(true);
  await f.db.update(schema.agentProfiles).set({ archivedAt: new Date().toISOString() }).where(eq(schema.agentProfiles.id, f.agents[1]!));
  await processChampionshipArtwork(f.db, { eventId: f.event.id, limit: 8 });
  expect(await f.db.select().from(schema.championshipEntries)).toEqual(entries);
});

test("production image journal reuses accepted output and never consumes an owner's image allowance", async () => {
  const { db, event, actorId, agents } = await draft();
  await db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: null }).where(eq(schema.agentProfiles.id, agents[0]!));
  const oldFetch = globalThis.fetch, oldKey = process.env.OPENAI_API_KEY;
  let calls = 0;
  process.env.OPENAI_API_KEY = "fixture-not-a-real-key";
  globalThis.fetch = (async () => { calls++; return Response.json({ data: [{ b64_json: generated.toString("base64") }], usage: {} }); }) as unknown as typeof fetch;
  setChampionshipArtDependenciesForTests({ read: async () => existing, publish, generate: renderChampionshipVisualReference });
  try {
    await lockChampionshipRoster(db, event.id, actorId, randomUUID());
    await processChampionshipArtwork(db, { eventId: event.id, limit: 8 });
    expect(calls).toBe(1);
    expect(await db.select().from(schema.inferenceReservations)).toHaveLength(0);
    const operations = await db.select().from(schema.visualRenderOperations);
    expect(operations.filter(row => row.operationKey.startsWith("championship-art:")).length).toBe(1);
    const attempts = await db.select().from(schema.visualRenderAttempts);
    expect(attempts).toHaveLength(1); expect(attempts[0]!.image).not.toBeNull();
    expect((await db.select().from(schema.championshipEvents))[0]!.status).toBe("locked");
    expect((await readJson((await db.select().from(schema.championshipEntries))[0]!.build)).artwork).toBeDefined();
  } finally { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; }
});


test.each([false, true])("provider failures retain evidence and recover safely (uncertain=%s)", async uncertain => {
  const { db, event, actorId, agents } = await draft();
  await db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: null }).where(eq(schema.agentProfiles.id, agents[0]!));
  const oldFetch = globalThis.fetch, oldKey = process.env.OPENAI_API_KEY;
  let calls = 0;
  process.env.OPENAI_API_KEY = "fixture-not-a-real-key";
  globalThis.fetch = (async () => {
    if (++calls === 1) {
      if (uncertain) throw new Error("Fixture disconnected after dispatch");
      return Response.json({ error: { message: "Fixture rejected request" } }, { status: 400 });
    }
    return Response.json({ data: [{ b64_json: generated.toString("base64") }], usage: {} });
  }) as unknown as typeof fetch;
  setChampionshipArtDependenciesForTests({ read: async () => existing, publish, generate: renderChampionshipVisualReference });
  try {
    await lockChampionshipRoster(db, event.id, actorId, randomUUID());
    await processChampionshipArtwork(db, { eventId: event.id, limit: 8 });
    const [job] = await db.select().from(schema.championshipArtwork).where(eq(schema.championshipArtwork.agentId, agents[0]!));
    expect(job!.status).toBe("retry"); expect(calls).toBe(1);
    await db.update(schema.championshipArtwork).set({ nextAttemptAt: null }).where(eq(schema.championshipArtwork.id, job!.id));
    if (uncertain) {
      await processChampionshipArtwork(db, { eventId: event.id, limit: 8 });
      expect(calls).toBe(1); // No duplicate request when provider acceptance is unknown.
      const attempts = await readChampionshipArtAttempts(db, event.id, job!.id);
      expect(attempts).toHaveLength(1);
      const evidence = { eventId: event.id, preparationId: job!.id, attemptId: attempts[0]!.id, actorId, note: "Stub provider confirms fixture had no charge", costMicrousd: 0 };
      await reconcileChampionshipArtAttempt(db, evidence);
      await reconcileChampionshipArtAttempt(db, evidence); // Lost response is safe to retry.
    }
    await processChampionshipArtwork(db, { eventId: event.id, limit: 8 });
    expect(calls).toBe(2);
    expect((await db.select().from(schema.championshipEvents))[0]!.status).toBe("locked");
    expect(await db.select().from(schema.visualRenderAttempts)).toHaveLength(2);
    expect(await db.select().from(schema.inferenceReservations)).toHaveLength(0);
  } finally { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; }
});

test("a qualifier becoming unavailable during artwork preparation uses the next frozen alternate", async () => {
  const f = await draft(); const alternate = await addAlternate(f);
  await f.db.update(schema.agentProfiles).set({ avatarUrl: null }).where(eq(schema.agentProfiles.id, f.agents[0]!));
  expect((await lockChampionshipRoster(f.db, f.event.id, f.actorId, randomUUID())).status).toBe("preparing");
  await f.db.update(schema.agentProfiles).set({ archivedAt: new Date().toISOString() }).where(eq(schema.agentProfiles.id, f.agents[0]!));
  await processChampionshipArtwork(f.db, { eventId: f.event.id, limit: 8 });
  expect((await f.db.select().from(schema.championshipEvents))[0]!.status).toBe("locked");
  expect((await f.db.select().from(schema.championshipEntries)).some(row => row.agentId === alternate)).toBe(true);
  expect((await f.db.select().from(schema.championshipArtwork).where(eq(schema.championshipArtwork.agentId, f.agents[0]!)))[0]!.selected).toBe(false);
});

test("a retrying finalist does not starve other missing artwork", async () => {
  const { db, event, actorId, agents } = await draft();
  for (const id of agents.slice(0, 2)) await db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: null }).where(eq(schema.agentProfiles.id, id));
  setChampionshipArtDependenciesForTests({ read: async () => existing, publish, generate: async () => { throw new Error("Temporary provider failure"); } });
  await lockChampionshipRoster(db, event.id, actorId, randomUUID());
  await processChampionshipArtwork(db, { eventId: event.id });
  const [failed] = (await db.select().from(schema.championshipArtwork)).filter(row => row.status === "retry");
  expect(failed).toBeDefined();
  await db.update(schema.championshipArtwork).set({ nextAttemptAt: "2020-01-01T00:00:00.000Z" }).where(eq(schema.championshipArtwork.id, failed!.id));
  setChampionshipArtDependenciesForTests({ read: async () => existing, publish, generate: async () => generated });
  const outcomes = await processChampionshipArtwork(db, { eventId: event.id });
  expect(outcomes[0]!.id).not.toBe(failed!.id);
  expect(outcomes[0]!.status).toBe("ready");
});
