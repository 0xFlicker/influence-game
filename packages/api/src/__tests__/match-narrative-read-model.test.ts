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
      { gameIdOrSlug: fixture.gameId, preset: "strategic", limit: 50 },
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

    const strategyLogs = page.groups.flatMap((g) =>
      g.members
        .filter((m) => m.kind === "strategy")
        .map((m) => m.fields.decisionLog)
    );
    expect(strategyLogs.sort()).toEqual(["alice plan", "bob plan"]);
    expect(JSON.stringify(page)).not.toContain("bob secret thought");
    expect(page.groups.every((g) =>
      g.members.every((m) => m.authority === "transcript" || m.authority === "cognition")
    )).toBe(true);
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

    const strategic = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, preset: "strategic" },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(strategic.ok).toBe(true);
    if (!strategic.ok) return;
    expect(strategic.groups.some((g) => g.members.some((m) => m.kind === "thinking"))).toBe(false);
    expect(strategic.groups.some((g) => g.members.some((m) => m.kind === "strategy"))).toBe(true);

    const full = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, preset: "full_cognition" },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.groups.some((g) => g.members.some((m) => m.kind === "thinking"))).toBe(true);
  });

  test("owner only sees owned cognition; non-owned player filter is empty success", async () => {
    const fixture = await seedNarrativeGame(db);
    await insertDialogue(db, {
      gameId: fixture.gameId,
      sequence: 1,
      speakerPlayerId: fixture.playerA,
      text: "public from owner",
      timestamp: 1000,
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      actorUserId: fixture.ownerUserId,
      artifactType: "strategy",
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
      { gameIdOrSlug: fixture.gameId, preset: "strategic" },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;

    const exact = page.groups.filter((g) => g.correlation.kind === "decision_id");
    expect(exact.length).toBeGreaterThanOrEqual(1);
    const group = exact.find((g) => g.decisionId === decisionId);
    expect(group).toBeTruthy();
    expect(group?.members.some((m) => m.kind === "dialogue")).toBe(true);
    expect(group?.members.some((m) => m.kind === "strategy")).toBe(true);
    expect(page.correlationSummary.exact).toBeGreaterThanOrEqual(1);
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
  },
): Promise<void> {
  await db.insert(schema.gameCognitiveArtifacts).values({
    id: params.id,
    gameId: params.gameId,
    artifactType: params.artifactType,
    actorRole: "player",
    actorPlayerId: params.actorPlayerId,
    actorUserId: params.actorUserId,
    action: "vote",
    phase: "LOBBY",
    round: 1,
    decisionId: params.decisionId,
    payloadByteLength: Buffer.byteLength(JSON.stringify(params.payload), "utf8"),
    payload: params.payload,
    visibilityStatus: "active",
    createdAt: params.createdAt,
  });
}
