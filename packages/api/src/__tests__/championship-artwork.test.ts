import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { championshipFixture, policies } from "./championship-fixtures.js";
import { createChampionshipDraft, configureChampionshipDraft, lockChampionshipRoster, readFrozenCompetitionBuild, readChampionship } from "../services/championships.js";
import { processChampionshipArtwork, setChampionshipArtDependenciesForTests, readChampionshipArtAttempts, reconcileChampionshipArtAttempt } from "../services/championship-artwork.js";
import { activateChampionship, dispatchChampionshipMatch } from "../services/championship-dispatch.js";
import { readJson, readPayload } from "../services/payload-storage.js";
import { readVisualProfileImage } from "../services/visual-game-assets.js";
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
  await db.update(schema.agentProfiles).set({ avatarUrl: null, fullBodyReferenceUrl: null, personaKey: "clockwork-owl", gender: "female", visualDesign: "" }).where(eq(schema.agentProfiles.id, agents[0]!));
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
  expect(calls.find(row => row.references === 0)!.prompt).toContain("Visual design: clockwork-owl");
  expect(calls.find(row => row.references === 0)!.prompt).toContain("Recorded gender: female");
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
  let interrupt = true;
  setChampionshipArtDependenciesForTests({ read: async () => existing, publish, generate: async (...args) => {
    const bytes = await renderChampionshipVisualReference(...args);
    if (interrupt) { interrupt = false; throw new Error("Fixture interrupted after durable provider receipt"); }
    return bytes;
  } });
  try {
    await lockChampionshipRoster(db, event.id, actorId, randomUUID());
    await processChampionshipArtwork(db, { eventId: event.id, limit: 8 });
    expect(calls).toBe(1);
    const [pending] = (await db.select().from(schema.championshipArtwork)).filter(row => row.status === "retry");
    expect(pending!.body).toBeNull();
    await db.update(schema.championshipArtwork).set({ nextAttemptAt: null }).where(eq(schema.championshipArtwork.id, pending!.id));
    await processChampionshipArtwork(db, { eventId: event.id, limit: 8 });
    expect(calls).toBe(1); // Saved provider output is reused after the preparation interruption.
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
  let changedTemplate = false;
  const prompts: string[] = [];
  process.env.OPENAI_API_KEY = "fixture-not-a-real-key";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    prompts.push(String((init?.body as FormData).get("prompt")));
    if (++calls === 1) {
      if (uncertain) throw new Error("Fixture disconnected after dispatch");
      return Response.json({ error: { message: "Fixture rejected request" } }, { status: 400 });
    }
    return Response.json({ data: [{ b64_json: generated.toString("base64") }], usage: {} });
  }) as unknown as typeof fetch;
  setChampionshipArtDependenciesForTests({ read: async () => existing, publish, generate: (db, input) => renderChampionshipVisualReference(db, { ...input, request: { ...input.request, prompt: changedTemplate ? "A newly deployed prompt must not replace accepted inputs" : input.request.prompt } }) });
  try {
    await lockChampionshipRoster(db, event.id, actorId, randomUUID());
    await processChampionshipArtwork(db, { eventId: event.id, limit: 8 });
    const [job] = await db.select().from(schema.championshipArtwork).where(eq(schema.championshipArtwork.agentId, agents[0]!));
    expect(job!.status).toBe("retry"); expect(calls).toBe(1);
    await db.update(schema.championshipArtwork).set({ nextAttemptAt: null }).where(eq(schema.championshipArtwork.id, job!.id));
    changedTemplate = true;
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
    expect(prompts[1]).toBe(prompts[0]);
    expect(prompts[1]).not.toContain("newly deployed");
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

test("a retrying event cannot starve artwork preparation for another event", async () => {
  const f = await draft();
  await f.db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: null }).where(eq(schema.agentProfiles.id, f.agents[0]!));
  await lockChampionshipRoster(f.db, f.event.id, f.actorId, randomUUID());
  const other = await createChampionshipDraft(f.db, { actorId: f.actorId, sourceSeasonId: f.event.sourceSeasonId, name: "Other event", slug: `other-${randomUUID()}` });
  await configureChampionshipDraft(f.db, other.id, { policies, startDate: "2020-01-01" });
  await lockChampionshipRoster(f.db, other.id, f.actorId, randomUUID());
  setChampionshipArtDependenciesForTests({ read: async () => existing, publish, generate: async (_db, input) => {
    const [job] = await f.db.select().from(schema.championshipArtwork).where(eq(schema.championshipArtwork.id, input.preparationId));
    if (job!.eventId === f.event.id) throw new Error("First event provider failure");
    return generated;
  } });
  await processChampionshipArtwork(f.db);
  const events = await f.db.select().from(schema.championshipEvents);
  expect(events.find(row => row.id === f.event.id)!.status).toBe("preparing");
  expect(events.find(row => row.id === other.id)!.status).toBe("locked");
});

test("production artwork storage preserves source pixels, account linkage and frozen public bytes", async () => {
  const { db, event, actorId, agents } = await draft();
  await db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: null }).where(eq(schema.agentProfiles.id, agents[0]!));
  const profiles = await db.select().from(schema.agentProfiles);
  const oldFetch = globalThis.fetch, oldKey = process.env.OPENAI_API_KEY, oldBackend = process.env.INFLUENCE_STORAGE_BACKEND;
  let calls = 0;
  let suppliedReference: Buffer | null = null;
  process.env.OPENAI_API_KEY = "fixture-not-a-real-key";
  process.env.INFLUENCE_STORAGE_BACKEND = "local";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).endsWith("/images/edits")) throw new Error(`Unexpected external request: ${url}`);
    const reference = (init?.body as FormData).get("image[]") as Blob;
    suppliedReference = Buffer.from(await reference.arrayBuffer());
    calls++;
    return Response.json({ data: [{ b64_json: generated.toString("base64") }], usage: {} });
  }) as unknown as typeof fetch;
  setChampionshipArtDependenciesForTests(null); // Real read, journal, private storage and public publication.
  try {
    const source = await readVisualProfileImage(profiles[0]!.avatarUrl!, { name: "", personaKey: "" });
    await lockChampionshipRoster(db, event.id, actorId, randomUUID());
    expect(calls).toBe(0);
    await processChampionshipArtwork(db, { eventId: event.id, limit: 8 });
    expect(calls).toBe(1);
    expect((await db.select().from(schema.championshipEvents))[0]!.status).toBe("locked");
    const build = await readFrozenCompetitionBuild(db, event.id, agents[0]!);
    expect(build.agentId).toBe(agents[0]!); expect(build.ownerId).toBe(actorId);
    const avatar = await readVisualProfileImage(build.character.avatarUrl!, { name: "", personaKey: "" });
    const body = await readVisualProfileImage(build.character.fullBodyReferenceUrl!, { name: "", personaKey: "" });
    expect((await sharp(avatar).raw().toBuffer()).equals(await sharp(source).raw().toBuffer())).toBe(true);
    expect((await sharp(suppliedReference!).raw().toBuffer()).equals(await sharp(source).raw().toBuffer())).toBe(true);
    const [attempt] = await db.select().from(schema.visualRenderAttempts);
    expect((await sharp(body).raw().toBuffer()).equals(await sharp(await readPayload(attempt!.image!)).raw().toBuffer())).toBe(true);
    expect(build.character.avatarUrl).toContain(build.artwork!.avatarHash);
    expect(build.character.fullBodyReferenceUrl).toContain(build.artwork!.bodyHash);
    expect(await db.select().from(schema.agentProfiles)).toEqual(profiles);
    expect(await db.select().from(schema.inferenceReservations)).toHaveLength(0);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldBackend === undefined) delete process.env.INFLUENCE_STORAGE_BACKEND; else process.env.INFLUENCE_STORAGE_BACKEND = oldBackend;
  }
});

test("explicit bundled portrait references preserve the selected identity and reject lookalike paths", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const bytes = await readVisualProfileImage("/avatars/personas/observer.png", { name: "Different fallback", personaKey: "honest" });
  const original = await readFile(new URL("../../../web/public/avatars/personas/observer.png", import.meta.url));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(createHash("sha256").update(original).digest("hex"));
  for (const url of ["/avatars/personas/../observer.png", "/avatars/personas/unknown.png", "https://evil.test/avatars/personas/observer.png", "/avatars/personas/observer.png?other=1"]) {
    await expect(readVisualProfileImage(url, { name: "", personaKey: "observer" })).rejects.toThrow("application image storage");
  }
});
