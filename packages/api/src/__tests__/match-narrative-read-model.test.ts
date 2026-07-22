import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Phase, type CanonicalGameEvent } from "@influence/engine";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  decodeMatchNarrativeCursor,
  issueMatchNarrativeCursor,
} from "../services/match-read-cursor.js";
import { readMatchNarrativePage } from "../services/match-narrative-read-model.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import {
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";
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

  test("V2 cursor paginates without gaps, restores sealed filters, and nulls terminal cursor", async () => {
    const fixture = await seedNarrativeGame(db);
    // Same timestamp → equal sortKey ties broken by group digest.
    for (let i = 0; i < 5; i++) {
      await insertDialogue(db, {
        gameId: fixture.gameId,
        sequence: i + 1,
        speakerPlayerId: fixture.playerA,
        text: `line-${i}`,
        timestamp: 10_000,
      });
    }

    const page1 = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        limit: 2,
        schemaVersion: 2,
        includeUnpaired: true,
        preset: "dialogue_only",
      },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.nextCursor).toBeTruthy();
    expect(page1.nextCursorKind).toBe("page");
    expect(page1.nextCursor?.startsWith("mr2.")).toBe(true);
    expect(page1.nextCursor!.length).toBeLessThanOrEqual(800);
    expect(page1.filters?.schemaVersion).toBe(2);
    expect(page1.filters?.includeUnpaired).toBe(true);
    expect(page1.filters?.preset).toBe("dialogue_only");
    const page1Texts = page1.groups
      .map((g) => ("text" in g ? g.text : undefined))
      .filter((t): t is string => typeof t === "string");
    expect(page1Texts.length).toBe(2);

    // Cursor-only continuation restores sealed filters (no explicit filters).
    const page2 = await readMatchNarrativePage(
      db,
      { gameIdOrSlug: fixture.gameId, cursor: page1.nextCursor ?? undefined, limit: 2 },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.filters?.schemaVersion).toBe(2);
    expect(page2.filters?.includeUnpaired).toBe(true);
    expect(page2.filters?.preset).toBe("dialogue_only");
    const page2Texts = page2.groups
      .map((g) => ("text" in g ? g.text : undefined))
      .filter((t): t is string => typeof t === "string");
    for (const text of page2Texts) {
      expect(page1Texts).not.toContain(text);
    }

    // Explicit filter mismatch fails closed.
    const mismatch = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        cursor: page1.nextCursor ?? undefined,
        preset: "strategic",
        limit: 2,
      },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(mismatch).toMatchObject({
      ok: false,
      status: "cursor_invalid_or_stale",
    });

    // Drain remaining pages; terminal page nulls both cursor fields.
    let cursor = page2.nextCursor ?? null;
    const seen = new Set([...page1Texts, ...page2Texts]);
    let guard = 0;
    while (cursor != null && guard < 10) {
      guard += 1;
      const page = await readMatchNarrativePage(
        db,
        { gameIdOrSlug: fixture.gameId, cursor, limit: 2 },
        {
          subjectUserId: fixture.ownerUserId,
          surface: "subject_owner",
          cursorSecret: CURSOR_SECRET,
        },
      );
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      for (const g of page.groups) {
        const text = "text" in g ? g.text : undefined;
        if (typeof text === "string") {
          expect(seen.has(text)).toBe(false);
          seen.add(text);
        }
      }
      if (page.nextCursor == null) {
        expect(page.nextCursor).toBeNull();
        expect(page.nextCursorKind).toBeNull();
        break;
      }
      cursor = page.nextCursor;
    }
    expect(seen.size).toBe(5);
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
    if (!group || !("text" in group) || !("strategy" in group) || !("corr" in group)) {
      throw new Error("expected compact-v2 group slots");
    }
    expect(group.text).toContain("I vote for Bob");
    expect(group.strategy).toContain("vote Bob");
    expect(group.corr).toBe("exact");
    expect(page.correlationSummary.exactCrossLane).toBeGreaterThanOrEqual(1);
  });

  test("trusted vote.cast decisionId linkage on owner and producer compact narratives", async () => {
    const fixture = await seedNarrativeGame(db);
    const decisionId = randomUUID();
    const ownerEpoch = await insertOwner(db, fixture.gameId);

    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      actorUserId: fixture.ownerUserId,
      artifactType: "strategy",
      decisionId,
      action: "vote",
      phase: "VOTE",
      round: 2,
      payload: { decisionLog: "empower Mira, expose Echo" },
      createdAt: "2026-07-21T10:00:10.000Z",
    });
    await insertCanonicalEventRows(db, fixture.gameId, ownerEpoch, [
      makeVoteCastEvent({
        gameId: fixture.gameId,
        sequence: 1,
        voterId: fixture.playerA,
        decisionId,
        round: 2,
      }),
    ]);

    const ownerPage = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        preset: "strategic",
        schemaVersion: 2,
        includeUnpaired: true,
      },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(ownerPage.ok).toBe(true);
    if (!ownerPage.ok) return;
    const ownerGroup = ownerPage.groups.find((g) => g.decisionId === decisionId);
    expect(ownerGroup).toBeTruthy();
    if (!ownerGroup || !("actions" in ownerGroup)) throw new Error("expected actions");
    expect(ownerGroup.actions).toEqual([{ seq: 1, type: "vote.cast" }]);
    // Public readThrough must not grow a canonical pin field.
    expect(JSON.stringify(ownerPage.readThrough)).not.toContain("lastTrustedSequence");
    expect(JSON.stringify(ownerPage)).not.toContain("empowerTarget");
    expect(JSON.stringify(ownerPage)).not.toContain("sourcePointers");

    const producerPage = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        preset: "strategic",
        schemaVersion: 2,
        includeUnpaired: true,
      },
      {
        subjectUserId: fixture.producerUserId,
        surface: "producer",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(producerPage.ok).toBe(true);
    if (!producerPage.ok) return;
    const producerGroup = producerPage.groups.find((g) => g.decisionId === decisionId);
    expect(producerGroup).toBeTruthy();
    if (!producerGroup || !("actions" in producerGroup)) throw new Error("expected actions");
    expect(producerGroup.actions).toEqual([{ seq: 1, type: "vote.cast" }]);
  });

  test("non-owned cognition does not emit vote.cast citation on owner surface", async () => {
    const fixture = await seedNarrativeGame(db);
    const decisionId = randomUUID();
    const ownerEpoch = await insertOwner(db, fixture.gameId);

    // Bob's vote cognition is not owned by Alice's owner user.
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerB,
      artifactType: "strategy",
      decisionId,
      action: "vote",
      phase: "VOTE",
      round: 2,
      payload: { decisionLog: "bob vote plan" },
      createdAt: "2026-07-21T10:00:10.000Z",
    });
    await insertCanonicalEventRows(db, fixture.gameId, ownerEpoch, [
      makeVoteCastEvent({
        gameId: fixture.gameId,
        sequence: 1,
        voterId: fixture.playerB,
        decisionId,
        round: 2,
      }),
    ]);

    const page = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        preset: "strategic",
        schemaVersion: 2,
        includeUnpaired: true,
      },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.groups.some((g) => g.decisionId === decisionId)).toBe(false);
    expect(JSON.stringify(page)).not.toContain("vote.cast");
    expect(JSON.stringify(page)).not.toContain("bob vote plan");
  });

  test("pinned walk ignores vote.cast events appended after page one", async () => {
    const fixture = await seedNarrativeGame(db);
    const decisionOld = randomUUID();
    const decisionNew = randomUUID();
    const ownerEpoch = await insertOwner(db, fixture.gameId);

    // Two strategy rows so limit=1 forces pagination.
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      actorUserId: fixture.ownerUserId,
      artifactType: "strategy",
      decisionId: decisionOld,
      action: "vote",
      phase: "VOTE",
      round: 2,
      payload: { decisionLog: "first vote plan" },
      createdAt: "2026-07-21T10:00:01.000Z",
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      actorUserId: fixture.ownerUserId,
      artifactType: "strategy",
      decisionId: decisionNew,
      action: "vote",
      phase: "VOTE",
      round: 2,
      payload: { decisionLog: "second vote plan" },
      createdAt: "2026-07-21T10:00:02.000Z",
    });
    await insertCanonicalEventRows(db, fixture.gameId, ownerEpoch, [
      makeVoteCastEvent({
        gameId: fixture.gameId,
        sequence: 1,
        voterId: fixture.playerA,
        decisionId: decisionOld,
        round: 2,
      }),
    ]);

    const page1 = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        preset: "strategic",
        schemaVersion: 2,
        includeUnpaired: true,
        limit: 1,
      },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(page1.ok).toBe(true);
    if (!page1.ok || !page1.nextCursor) throw new Error("expected page1 cursor");
    const decoded = decodeMatchNarrativeCursor(page1.nextCursor, {
      secretMaterial: CURSOR_SECRET,
      expectedSurface: "subject_owner",
    });
    expect(decoded.status).toBe("ok");
    if (decoded.status !== "ok") return;
    expect(decoded.claims.canonicalLastTrustedSequence).toBe(1);

    // Append a later trusted vote after page one was sealed.
    await insertCanonicalEventRows(db, fixture.gameId, ownerEpoch, [
      makeVoteCastEvent({
        gameId: fixture.gameId,
        sequence: 2,
        voterId: fixture.playerA,
        decisionId: decisionNew,
        round: 2,
      }),
    ]);
    await db
      .update(schema.gameRunOwners)
      .set({ lastPersistedEventSequence: 2 })
      .where(eq(schema.gameRunOwners.gameId, fixture.gameId));

    const page2 = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        cursor: page1.nextCursor,
        schemaVersion: 2,
        includeUnpaired: true,
        limit: 1,
      },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    // Continuation is pinned at seq 1 — the new vote.cast must not link.
    const page2Group = page2.groups.find((g) => g.decisionId === decisionNew);
    expect(page2Group).toBeTruthy();
    if (!page2Group) return;
    expect("actions" in page2Group ? page2Group.actions : undefined).toBeUndefined();

    // Fresh read sees the new event.
    const fresh = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        preset: "strategic",
        schemaVersion: 2,
        includeUnpaired: true,
        limit: 50,
      },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const freshNew = fresh.groups.find((g) => g.decisionId === decisionNew);
    expect(freshNew && "actions" in freshNew ? freshNew.actions : undefined).toEqual([
      { seq: 2, type: "vote.cast" },
    ]);
  });

  test("legacy unlinked cursor continues without vote.cast linkage", async () => {
    const fixture = await seedNarrativeGame(db);
    const decisionId = randomUUID();
    const ownerEpoch = await insertOwner(db, fixture.gameId);

    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      actorUserId: fixture.ownerUserId,
      artifactType: "strategy",
      decisionId,
      action: "vote",
      phase: "VOTE",
      round: 2,
      payload: { decisionLog: "vote plan" },
      createdAt: "2026-07-21T10:00:01.000Z",
    });
    await insertCognition(db, {
      id: randomUUID(),
      gameId: fixture.gameId,
      actorPlayerId: fixture.playerA,
      actorUserId: fixture.ownerUserId,
      artifactType: "strategy",
      decisionId: randomUUID(),
      action: "vote",
      phase: "VOTE",
      round: 2,
      payload: { decisionLog: "later plan" },
      createdAt: "2026-07-21T10:00:02.000Z",
    });
    await insertCanonicalEventRows(db, fixture.gameId, ownerEpoch, [
      makeVoteCastEvent({
        gameId: fixture.gameId,
        sequence: 1,
        voterId: fixture.playerA,
        decisionId,
        round: 2,
      }),
    ]);

    const page1 = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        limit: 1,
        includeUnpaired: true,
        schemaVersion: 2,
      },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(page1.ok).toBe(true);
    if (!page1.ok || !page1.nextCursor) throw new Error("expected cursor");
    const decoded = decodeMatchNarrativeCursor(page1.nextCursor, {
      secretMaterial: CURSOR_SECRET,
      expectedSurface: "subject_owner",
    });
    expect(decoded.status).toBe("ok");
    if (decoded.status !== "ok") return;
    // Fresh page1 sealed a pin; strip it to simulate a legacy unlinked walk.
    expect(decoded.claims.canonicalLastTrustedSequence).toBe(1);

    const unlinked = issueMatchNarrativeCursor({
      subjectUserId: decoded.claims.subjectUserId,
      gameId: decoded.claims.gameId,
      surface: decoded.claims.surface,
      ownershipFingerprint: decoded.claims.ownershipFingerprint,
      transcriptCaptureVersion: decoded.claims.transcriptCaptureVersion,
      cognitiveCaptureVersion: decoded.claims.cognitiveCaptureVersion,
      mode: "snapshot",
      readThrough: decoded.claims.readThrough,
      keyset: decoded.claims.keyset,
      filters: decoded.claims.filters,
      canonicalLastTrustedSequence: null,
    }, CURSOR_SECRET);

    const continued = await readMatchNarrativePage(
      db,
      {
        gameIdOrSlug: fixture.gameId,
        cursor: unlinked,
        includeUnpaired: true,
        schemaVersion: 2,
        limit: 10,
      },
      {
        subjectUserId: fixture.ownerUserId,
        surface: "subject_owner",
        cursorSecret: CURSOR_SECRET,
      },
    );
    expect(continued.ok).toBe(true);
    if (!continued.ok) return;
    for (const g of continued.groups) {
      expect("actions" in g ? g.actions : undefined).toBeUndefined();
    }
    if (continued.nextCursor) {
      const reissued = decodeMatchNarrativeCursor(continued.nextCursor, {
        secretMaterial: CURSOR_SECRET,
        expectedSurface: "subject_owner",
      });
      expect(reissued.status).toBe("ok");
      if (reissued.status === "ok") {
        expect(reissued.claims.canonicalLastTrustedSequence).toBeNull();
      }
    }
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
    phase?: string;
    round?: number;
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
    phase: params.phase ?? "LOBBY",
    round: params.round ?? 1,
    decisionId: params.decisionId,
    payloadByteLength: Buffer.byteLength(JSON.stringify(params.payload), "utf8"),
    payload: params.payload,
    visibilityStatus: "active",
    createdAt: params.createdAt,
  });
}

function makeVoteCastEvent(params: {
  gameId: string;
  sequence: number;
  voterId: string;
  decisionId: string;
  round: number;
  empowerTarget?: string;
  exposeTarget?: string;
}): CanonicalGameEvent {
  return {
    sequence: params.sequence,
    gameId: params.gameId,
    round: params.round,
    phase: Phase.VOTE,
    type: "vote.cast",
    timestamp: "2026-07-21T12:00:00.000Z",
    source: "engine",
    visibility: "producer",
    payloadVersion: 1,
    sourcePointers: [
      {
        kind: "agent_turn",
        actorId: params.voterId,
        action: "vote",
        round: params.round,
        phase: Phase.VOTE,
        decisionId: params.decisionId,
      },
    ],
    payload: {
      voterId: params.voterId,
      empowerTarget: params.empowerTarget ?? randomUUID(),
      exposeTarget: params.exposeTarget ?? randomUUID(),
    },
  };
}
