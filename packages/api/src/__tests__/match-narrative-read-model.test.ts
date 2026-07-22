import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { readMatchNarrativePage } from "../services/match-narrative-read-model.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { insertGame } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

const CURSOR_SECRET = "test-jwt-secret-match-narrative-u3u4-aaaa";

describe("match-narrative-read-model dual surface", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
    process.env.JWT_SECRET = CURSOR_SECRET;
  });

  test("producer multi-seat strategy is visible without ownership", async () => {
    const fixture = await seedNarrativeGame(db);
    const decisionA = randomUUID();
    const decisionB = randomUUID();

    await insertDialogue(db, {
      gameId: fixture.gameId,
      sequence: 1,
      speakerPlayerId: fixture.playerA,
      text: "Alice speaks",
      timestamp: 1000,
      decisionId: decisionA,
    });
    await insertDialogue(db, {
      gameId: fixture.gameId,
      sequence: 2,
      speakerPlayerId: fixture.playerB,
      text: "Bob speaks",
      timestamp: 2000,
      decisionId: decisionB,
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      artifactType: "strategy",
      decisionId: decisionA,
      payload: { decisionLog: "alice plan" },
      createdAt: "2026-07-21T10:00:01.000Z",
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerB,
      artifactType: "strategy",
      decisionId: decisionB,
      payload: { decisionLog: "bob plan" },
      createdAt: "2026-07-21T10:00:02.000Z",
    });
    // Peer thinking should appear only under full_cognition, not strategic.
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerB,
      artifactType: "thinking",
      payload: { thinking: "bob secret thought" },
      createdAt: "2026-07-21T10:00:03.000Z",
    });

    const page = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, preset: "strategic", limit: 50, schemaVersion: 2 },
      {
        subjectUserId: fixture.producerUserId,
        surface: "producer",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;

    expect(page.surface).toBe("producer");
    expect(page.notBoardAuthority).toBe(true);
    expect(page.preset).toBe("strategic");
    expect(page.schemaVersion).toBe(2);

    const strategyLogs = page.groups
      .map((g) => ("strategy" in g ? g.strategy : undefined))
      .filter((s): s is string => typeof s === "string");
    expect(strategyLogs.sort()).toEqual(["alice plan", "bob plan"]);
    expect(JSON.stringify(page)).not.toContain("bob secret thought");
    expect(JSON.stringify(page)).not.toContain("\"members\"");
  });

  test("strategic omits thinking; full_cognition includes it", async () => {
    const fixture = await seedNarrativeGame(db);
    await insertDialogue(db, {
      gameId: fixture.gameId,
      sequence: 1,
      speakerPlayerId: fixture.playerA,
      text: "hello",
      timestamp: 1000,
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      artifactType: "thinking",
      payload: { thinking: "raw thought" },
      createdAt: "2026-07-21T10:00:01.000Z",
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      artifactType: "strategy",
      payload: { decisionLog: "plan" },
      createdAt: "2026-07-21T10:00:02.000Z",
    });

    // Pair dialogue+strategy via shared decisionId so strategic selection keeps them.
    const decisionId = randomUUID();
    await insertDialogue(db, {
      gameId: fixture.gameId,
      sequence: 2,
      speakerPlayerId: fixture.playerA,
      text: "paired line",
      timestamp: 2000,
      decisionId,
    });
    // Re-stamp strategy with decisionId for pairing — insert another strategy.
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      artifactType: "strategy",
      decisionId,
      payload: { decisionLog: "paired plan" },
      createdAt: "2026-07-21T10:00:04.000Z",
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      artifactType: "thinking",
      decisionId,
      payload: { thinking: "paired thought" },
      createdAt: "2026-07-21T10:00:05.000Z",
    });

    const strategic = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, preset: "strategic", schemaVersion: 2 },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(strategic.ok).toBe(true);
    if (!strategic.ok) return;
    expect(strategic.groups.some((g) => "thinking" in g && g.thinking)).toBe(false);
    expect(strategic.groups.some((g) => "strategy" in g && g.strategy)).toBe(true);

    const full = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, preset: "full_cognition", schemaVersion: 2 },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.groups.some((g) => "thinking" in g && typeof g.thinking === "string")).toBe(true);
  });

  test("owner only sees owned cognition; non-owned player filter is empty success", async () => {
    const fixture = await seedNarrativeGame(db);
    const decisionId = randomUUID();
    await insertDialogue(db, {
      gameId: fixture.gameId,
      sequence: 1,
      speakerPlayerId: fixture.playerA,
      text: "public from owner",
      timestamp: 1000,
      decisionId,
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      actorUserId: fixture.ownerUserId,
      artifactType: "strategy",
      decisionId,
      payload: { decisionLog: "owned strategy" },
      createdAt: "2026-07-21T10:00:01.000Z",
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerB,
      artifactType: "strategy",
      payload: { decisionLog: "peer strategy secret" },
      createdAt: "2026-07-21T10:00:02.000Z",
    });

    const page = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, preset: "strategic", limit: 50 },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(JSON.stringify(page)).toContain("owned strategy");
    expect(JSON.stringify(page)).not.toContain("peer strategy secret");

    const empty = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, player: fixture.playerB },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.groups).toEqual([]);
    expect(empty.pageSize).toBe(0);
  });

  test("creator-only is denied on owner surface", async () => {
    const creatorId = randomUUID();
    await db.insert(schema.users).values({
      id: creatorId,
      walletAddress: `0x${creatorId.replace(/-/g, "").slice(0, 40)}`,
    });
    const gameId = await insertGame(db, {
      slug: `creator-only-${randomUUID().slice(0, 8)}`,
      status: "in_progress",
    });
    await db.update(schema.games).set({
      createdById: creatorId,
      transcriptCaptureVersion: 1,
      cognitiveArtifactCaptureVersion: 1,
    }).where(eq(schema.games.id, gameId));
    await db.insert(schema.gameTranscriptStates).values({
      ...initialGameTranscriptStateValues(gameId, 1),
      durableSequence: 0,
      durableCount: 0,
    });
    // Peer seat, not owned by creator
    await insertGamePlayer(db, { gameId, name: "Peer" });

    const denied = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: gameId },
      {
        subjectUserId: creatorId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(denied).toMatchObject({ ok: false, status: "denied" });
  });

  test("cross-surface cursor is rejected", async () => {
    const fixture = await seedNarrativeGame(db);
    await insertDialogue(db, {
      gameId: fixture.gameId,
      sequence: 1,
      speakerPlayerId: fixture.playerA,
      text: "one",
      timestamp: 1000,
    });
    await insertDialogue(db, {
      gameId: fixture.gameId,
      sequence: 2,
      speakerPlayerId: fixture.playerA,
      text: "two",
      timestamp: 2000,
    });

    const ownerPage = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, limit: 1 },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(ownerPage.ok).toBe(true);
    if (!ownerPage.ok) return;
    expect(ownerPage.nextCursor).toBeTruthy();

    const rejectedOnProducer = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, cursor: ownerPage.nextCursor ?? undefined },
      {
        subjectUserId: fixture.producerUserId,
        surface: "producer",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(rejectedOnProducer).toMatchObject({
      ok: false,
      status: "cursor_invalid_or_stale",
    });

    const producerPage = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, limit: 1 },
      {
        subjectUserId: fixture.producerUserId,
        surface: "producer",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(producerPage.ok).toBe(true);
    if (!producerPage.ok) return;
    expect(producerPage.nextCursor).toBeTruthy();

    const rejectedOnOwner = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, cursor: producerPage.nextCursor ?? undefined },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(rejectedOnOwner).toMatchObject({
      ok: false,
      status: "cursor_invalid_or_stale",
    });
  });

  test("decisionId exact group when stamped on dialogue and cognition", async () => {
    const fixture = await seedNarrativeGame(db);
    const decisionId = randomUUID();

    await insertDialogue(db, {
      gameId: fixture.gameId,
      sequence: 1,
      speakerPlayerId: fixture.playerA,
      text: "I vote for Bob",
      timestamp: 5_000,
      decisionId,
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      actorUserId: fixture.ownerUserId,
      artifactType: "strategy",
      decisionId,
      payload: { decisionLog: "vote Bob for cover" },
      createdAt: "2026-07-21T10:00:05.000Z",
    });

    const page = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, preset: "strategic", schemaVersion: 2 },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;

    expect(page.schemaVersion).toBe(2);
    const group = page.groups.find((g) => g.decisionId === decisionId);
    expect(group).toBeTruthy();
    expect(group?.text).toContain("I vote for Bob");
    expect(group?.strategy).toContain("vote Bob");
    expect(group?.corr).toBe("exact");
    expect(page.correlationSummary.exactCrossLane).toBeGreaterThanOrEqual(1);
  });

  test("compact-v2 is smaller than v1 members shape on paired fixture", async () => {
    const fixture = await seedNarrativeGame(db);
    const decisionId = randomUUID();
    await insertDialogue(db, {
      gameId: fixture.gameId,
      sequence: 1,
      speakerPlayerId: fixture.playerA,
      text: "One signal I’d broadcast this round to prove Lantern Pact alignment is a public post-Round-2 check-in.",
      timestamp: 5_000,
      decisionId,
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      actorUserId: fixture.ownerUserId,
      artifactType: "thinking",
      decisionId,
      payload: {
        thinking:
          "I’ll private-message Atlas and Sage with a concise plan: propose a single public signal after Round 2.",
      },
      createdAt: "2026-07-21T10:00:05.000Z",
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      actorUserId: fixture.ownerUserId,
      artifactType: "strategy",
      decisionId,
      payload: {
        decisionLog:
          "Mingle turn to Atlas and Sage. Propose a lean Lantern Pact signal after Round 2, request candor and quick check-in.",
      },
      createdAt: "2026-07-21T10:00:06.000Z",
    });
    // Unpaired noise strategy that v1 would ship and v2 strategic should omit.
    for (let i = 0; i < 10; i++) {
      await insertCognition(db, {
        id: randomUUID(),
        gameId: fixture.gameId,
        actorPlayerId: fixture.playerA,
        actorUserId: fixture.ownerUserId,
        artifactType: "strategy",
        decisionId: randomUUID(),
        payload: { decisionLog: `unpaired reflection ${i} with extra filler text for size` },
        createdAt: `2026-07-21T10:01:0${i}.000Z`,
      });
    }

    const v1 = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        preset: "strategic",
        schemaVersion: 1,
        includeUnpaired: true,
        limit: 50,
      },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    const v2 = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        preset: "strategic",
        schemaVersion: 2,
        limit: 50,
      },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(v1.ok && v2.ok).toBe(true);
    if (!v1.ok || !v2.ok) return;
    const v1Chars = Buffer.byteLength(JSON.stringify(v1), "utf8");
    const v2Chars = Buffer.byteLength(JSON.stringify(v2), "utf8");
    // Structural + unpaired omission should beat 50% of bloated v1+unpaired.
    expect(v2Chars).toBeLessThanOrEqual(Math.floor(v1Chars * 0.5));
    expect(v2.correlationSummary.unpairedOmitted).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedNarrativeGame(db: DrizzleDB): Promise<{
  gameId: string;
  ownerUserId: string;
  producerUserId: string;
  playerA: string;
  playerB: string;
}> {
  const ownerUserId = randomUUID();
  const producerUserId = randomUUID();
  await db.insert(schema.users).values([
    {
      id: ownerUserId,
      walletAddress: `0x${ownerUserId.replace(/-/g, "").slice(0, 40)}`,
    },
    {
      id: producerUserId,
      walletAddress: `0x${producerUserId.replace(/-/g, "").slice(0, 40)}`,
    },
  ]);
  const gameId = await insertGame(db, {
    slug: `narr-${randomUUID().slice(0, 8)}`,
    status: "in_progress",
  });
  await db.update(schema.games).set({
    transcriptCaptureVersion: 1,
    formalSpeechCaptureVersion: 1,
    cognitiveArtifactCaptureVersion: 1,
  }).where(eq(schema.games.id, gameId));
  await db.insert(schema.gameTranscriptStates).values({
    ...initialGameTranscriptStateValues(gameId, 1),
    durableSequence: 10,
    durableCount: 10,
  });
  const playerA = await insertGamePlayer(db, {
    gameId,
    userId: ownerUserId,
    name: "Alice",
  });
  const playerB = await insertGamePlayer(db, { gameId, name: "Bob" });
  return { gameId, ownerUserId, producerUserId, playerA, playerB };
}

async function insertGamePlayer(
  db: DrizzleDB,
  params: { gameId: string; userId?: string; name: string },
): Promise<string> {
  const playerId = randomUUID();
  await db.insert(schema.gamePlayers).values({
    id: playerId,
    gameId: params.gameId,
    userId: params.userId,
    persona: JSON.stringify({ name: params.name, personality: "careful" }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  });
  return playerId;
}

async function insertDialogue(
  db: DrizzleDB,
  params: {
    gameId: string;
    sequence: number;
    speakerPlayerId: string;
    text: string;
    timestamp: number;
    decisionId?: string;
  },
): Promise<void> {
  await db.insert(schema.transcripts).values({
    gameId: params.gameId,
    round: 1,
    phase: "LOBBY",
    fromPlayerId: params.speakerPlayerId,
    scope: "public",
    text: params.text,
    thinking: null,
    timestamp: params.timestamp,
    entrySequence: params.sequence,
    speakerPlayerId: params.speakerPlayerId,
    audiencePlayerIds: [],
    captureVersion: 1,
    dialogueKind: "public_speech",
    safeContext: {
      version: 1 as const,
      ...(params.decisionId ? { decisionId: params.decisionId } : {}),
    },
  });
}

async function insertCognition(
  db: DrizzleDB,
  params: {
    id: string;
    gameId: string;
    actorPlayerId: string;
    actorUserId?: string;
    artifactType: "thinking" | "strategy";
    payload: Record<string, unknown>;
    createdAt: string;
    decisionId?: string;
    action?: string;
  },
): Promise<void> {
  await db.insert(schema.gameCognitiveArtifacts).values({
    id: params.id,
    gameId: params.gameId,
    artifactType: params.artifactType,
    actorRole: "player",
    actorPlayerId: params.actorPlayerId,
    actorUserId: params.actorUserId,
    action: params.action ?? "mingle-turn",
    phase: "LOBBY",
    round: 1,
    decisionId: params.decisionId,
    payloadByteLength: Buffer.byteLength(JSON.stringify(params.payload), "utf8"),
    payload: params.payload,
    visibilityStatus: "active",
    createdAt: params.createdAt,
  });
}
