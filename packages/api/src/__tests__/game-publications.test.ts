import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  Phase,
  type CanonicalGameEvent,
  type GamePublicationPayloadV1,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  GamePublicationIntegrityError,
  readDueGamePublicationSuffix,
  startDueGamePublicationRuntime,
} from "../services/game-publications.js";
import { appendGameEvents } from "../services/game-events.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";

const NOW = "2026-08-27T12:00:00.000Z";
const DUE = "2026-08-27T11:59:59.000Z";
const SHA = `sha256:${"1".repeat(64)}`;

describe("durable game publications", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("materializes a contiguous viewer-safe suffix from committed references", async () => {
    const fixture = await createPublicationFixture(db);
    const phaseEvent = canonicalPhaseEvent(fixture.gameId, 1);
    const voteEvent = canonicalVoteEvent(fixture.gameId, 2);
    await appendGameEvents(db, {
      gameId: fixture.gameId,
      ownerEpoch: fixture.ownerEpoch,
      events: [phaseEvent, voteEvent],
    });
    await insertTranscript(db, fixture.gameId, fixture.turnId, 1, "A durable hello");

    await insertPublication(db, fixture, 1, {
      version: 1,
      kind: "canonical_event",
      eventSequence: 1,
    });
    await insertPublication(db, fixture, 2, {
      version: 1,
      kind: "transcript_entry",
      turnId: fixture.turnId,
      transcriptOrdinal: 1,
    });
    await insertPublication(db, fixture, 3, {
      version: 1,
      kind: "canonical_event",
      eventSequence: 2,
    });

    const publications = await readDueGamePublicationSuffix(db, fixture.gameId, {
      now: new Date(NOW),
    });

    expect(publications.map((publication) => publication.publicationSequence)).toEqual([1, 2, 3]);
    expect(publications[0]?.payload).toEqual({
      type: "phase_change",
      phase: "LOBBY",
      round: 1,
      alivePlayers: ["player-a", "player-b"],
    });
    expect(publications[1]?.payload).toMatchObject({
      type: "message",
      entry: {
        entrySequence: 1,
        from: "player-a",
        text: "A durable hello",
      },
    });
    expect(publications[2]?.payload).toMatchObject({
      type: "viewer_decision_event",
      gameId: fixture.gameId,
      event: { sequence: 2, type: "vote.cast" },
    });
  });

  test("does not release held rows or jump a publication gap", async () => {
    const fixture = await createPublicationFixture(db);
    await insertViewerEvent(db, fixture, 1, "one");
    await insertViewerEvent(db, fixture, 2, "held", null);

    const publications = await readDueGamePublicationSuffix(db, fixture.gameId, {
      now: new Date(NOW),
    });
    expect(publications).toHaveLength(1);
    expect(publications[0]?.publicationSequence).toBe(1);
  });

  test("fails closed when a canonical publication has no viewer-safe projection", async () => {
    const fixture = await createPublicationFixture(db);
    const roundStarted: CanonicalGameEvent = {
      sequence: 1,
      gameId: fixture.gameId,
      round: 1,
      phase: null,
      type: "round.started",
      timestamp: NOW,
      source: "engine",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: { round: 1 },
    };
    await appendGameEvents(db, {
      gameId: fixture.gameId,
      ownerEpoch: fixture.ownerEpoch,
      events: [roundStarted],
    });
    await insertPublication(db, fixture, 1, {
      version: 1,
      kind: "canonical_event",
      eventSequence: 1,
    });

    await expect(readDueGamePublicationSuffix(db, fixture.gameId, {
      now: new Date(NOW),
    })).rejects.toBeInstanceOf(GamePublicationIntegrityError);
  });

  test("fails closed when a stored publication payload is not exact", async () => {
    const fixture = await createPublicationFixture(db);
    await insertViewerEvent(db, fixture, 1, "one");
    await db.execute(sql`
      UPDATE game_publications
      SET payload = payload || '{"unexpected":true}'::jsonb
      WHERE game_id = ${fixture.gameId}
    `);

    await expect(readDueGamePublicationSuffix(db, fixture.gameId, {
      now: new Date(NOW),
    })).rejects.toBeInstanceOf(GamePublicationIntegrityError);
  });

  test("polling release is at-least-once without mutating durable rows", async () => {
    const fixture = await createPublicationFixture(db);
    await insertViewerEvent(db, fixture, 1, "one");
    const released: number[] = [];
    const runtime = await startDueGamePublicationRuntime(db, {
      broadcast(publication) {
        released.push(publication.publicationSequence);
      },
      now: () => new Date(NOW),
      pollIntervalMs: 60_000,
      skipExistingAtStartup: false,
    });

    expect(await runtime.flushDue()).toBe(1);
    expect(await runtime.flushDue()).toBe(0);
    expect(released).toEqual([1]);
    expect((await db.select({ availableAt: schema.gamePublications.availableAt })
      .from(schema.gamePublications)
      .where(eq(schema.gamePublications.gameId, fixture.gameId)))[0]?.availableAt).toBe(DUE);
    await runtime.stop();
  });

  test("retries a publication whose live broadcast failed", async () => {
    const fixture = await createPublicationFixture(db);
    await insertViewerEvent(db, fixture, 1, "one");
    const released: number[] = [];
    let fail = true;
    const runtime = await startDueGamePublicationRuntime(db, {
      broadcast(publication) {
        released.push(publication.publicationSequence);
        if (fail) {
          fail = false;
          throw new Error("live lane unavailable");
        }
      },
      now: () => new Date(NOW),
      pollIntervalMs: 60_000,
      skipExistingAtStartup: false,
    });

    await expect(runtime.flushDue()).rejects.toThrow("live lane unavailable");
    expect(await runtime.flushDue()).toBe(1);
    expect(released).toEqual([1, 1]);
    await runtime.stop();
  });

  test("starts after rows that were already due and releases later commits", async () => {
    const fixture = await createPublicationFixture(db);
    await insertViewerEvent(db, fixture, 1, "existing");
    const released: number[] = [];
    const runtime = await startDueGamePublicationRuntime(db, {
      broadcast(publication) {
        released.push(publication.publicationSequence);
      },
      now: () => new Date(NOW),
      pollIntervalMs: 60_000,
    });

    expect(await runtime.flushDue()).toBe(0);
    await insertViewerEvent(db, fixture, 2, "new");
    expect(await runtime.flushDue()).toBe(1);
    expect(released).toEqual([2]);
    await runtime.stop();
  });

  test("publishes a committed diary entry but fails closed for huddle and thinking scopes", async () => {
    const diary = await createPublicationFixture(db);
    await insertTurnTranscript(db, diary, 1, "diary", "A private answer shown to viewers.");
    await insertPublication(db, diary, 1, {
      version: 1,
      kind: "transcript_entry",
      turnId: diary.turnId,
      transcriptOrdinal: 1,
    });
    expect((await readDueGamePublicationSuffix(db, diary.gameId, {
      now: new Date(NOW),
    }))[0]?.payload).toMatchObject({
      type: "message",
      entry: {
        scope: "diary",
        text: "A private answer shown to viewers.",
      },
    });

    for (const scope of ["huddle", "thinking"] as const) {
      const fixture = await createPublicationFixture(db);
      await insertTurnTranscript(db, fixture, 1, scope, `${scope} stays private`);
      await insertPublication(db, fixture, 1, {
        version: 1,
        kind: "transcript_entry",
        turnId: fixture.turnId,
        transcriptOrdinal: 1,
      });
      await expect(readDueGamePublicationSuffix(db, fixture.gameId, {
        now: new Date(NOW),
      })).rejects.toBeInstanceOf(GamePublicationIntegrityError);
    }
  });

  test("bounds reconnect catch-up instead of accumulating an unlimited publication history", async () => {
    const fixture = await createPublicationFixture(db);
    await insertViewerEvent(db, fixture, 1, "one");
    await insertViewerEvent(db, fixture, 2, "two");
    await expect(readDueGamePublicationSuffix(db, fixture.gameId, {
      now: new Date(NOW),
      maxTotal: 1,
    })).rejects.toThrow("exceeds the 1-frame catch-up limit");
  });
});

async function createPublicationFixture(db: DrizzleDB): Promise<{
  gameId: string;
  ownerEpoch: string;
  turnId: string;
}> {
  const gameId = await insertGame(db, { status: "in_progress" });
  const ownerEpoch = await insertOwner(db, gameId);
  const turnId = randomUUID();
  await db.execute(sql`
    INSERT INTO game_turns (
      id, game_id, turn_sequence, status, planned_owner_epoch,
      committed_owner_epoch, base_event_sequence, base_dialogue_sequence,
      base_publication_sequence, intent, intent_hash, effect_hash,
      commit_result, committed_at
    ) VALUES (
      ${turnId}, ${gameId}, 1, 'committed', ${ownerEpoch},
      ${ownerEpoch}, 0, 0, 0, '{}'::jsonb, ${SHA}, ${SHA},
      '{}'::jsonb, ${NOW}
    )
  `);
  return { gameId, ownerEpoch, turnId };
}

async function insertPublication(
  db: DrizzleDB,
  fixture: { gameId: string; turnId: string },
  sequence: number,
  payload: GamePublicationPayloadV1,
  availableAt: string | null = DUE,
): Promise<void> {
  await db.insert(schema.gamePublications).values({
    gameId: fixture.gameId,
    publicationSequence: sequence,
    turnId: fixture.turnId,
    turnSequence: 1,
    turnPublicationOrdinal: sequence,
    kind: payload.kind,
    payload,
    availableAt,
  });
}

async function insertViewerEvent(
  db: DrizzleDB,
  fixture: { gameId: string; ownerEpoch: string; turnId: string },
  publicationSequence: number,
  label: string,
  availableAt: string | null = DUE,
): Promise<void> {
  const eventSequence = publicationSequence;
  await appendGameEvents(db, {
    gameId: fixture.gameId,
    ownerEpoch: fixture.ownerEpoch,
    events: [canonicalEliminationEvent(fixture.gameId, eventSequence, label)],
  });
  await insertPublication(db, fixture, publicationSequence, {
    version: 1,
    kind: "canonical_event",
    eventSequence,
  }, availableAt);
}

async function insertTranscript(
  db: DrizzleDB,
  gameId: string,
  turnId: string,
  entrySequence: number,
  text: string,
): Promise<void> {
  await db.insert(schema.transcripts).values({
    gameId,
    round: 1,
    phase: "LOBBY",
    fromPlayerId: "Atlas",
    scope: "public",
    text,
    timestamp: Date.parse(NOW),
    entrySequence,
    speakerPlayerId: "player-a",
    audiencePlayerIds: [],
    captureVersion: 1,
    dialogueKind: "public_speech",
    safeContext: { version: 1 },
    gameTurnId: turnId,
    gameTurnTranscriptOrdinal: 1,
  });
}

async function insertTurnTranscript(
  db: DrizzleDB,
  fixture: { gameId: string; turnId: string },
  ordinal: number,
  scope: "diary" | "huddle" | "thinking",
  text: string,
): Promise<void> {
  await db.insert(schema.transcripts).values({
    gameId: fixture.gameId,
    round: 1,
    phase: Phase.LOBBY,
    fromPlayerId: scope === "diary" ? "House" : "Atlas",
    scope,
    ...(scope === "diary" && { toPlayerIds: JSON.stringify(["player-a"]) }),
    text,
    timestamp: Date.parse(NOW) + ordinal,
    captureVersion: 1,
    gameTurnId: fixture.turnId,
    gameTurnTranscriptOrdinal: ordinal,
    ...(scope === "huddle" && {
      entrySequence: ordinal,
      speakerPlayerId: "player-a",
      audiencePlayerIds: ["player-a", "player-b"],
      dialogueKind: "huddle_speech" as const,
      safeContext: { version: 1 as const },
    }),
  });
}

function canonicalPhaseEvent(gameId: string, sequence: number): CanonicalGameEvent {
  return {
    sequence,
    gameId,
    round: 1,
    phase: Phase.LOBBY,
    type: "game.phase_entered",
    timestamp: NOW,
    source: "engine",
    visibility: "public",
    payloadVersion: 1,
    sourcePointers: [],
    payload: {
      phase: Phase.LOBBY,
      remainingPlayers: [
        { id: "player-a", name: "Atlas" },
        { id: "player-b", name: "Mira" },
      ],
    },
  };
}

function canonicalEliminationEvent(
  gameId: string,
  sequence: number,
  label: string,
): CanonicalGameEvent {
  return {
    sequence,
    gameId,
    round: 1,
    phase: Phase.END,
    type: "player.eliminated",
    timestamp: NOW,
    source: "engine",
    visibility: "public",
    payloadVersion: 1,
    sourcePointers: [],
    payload: {
      playerId: `player-${label}`,
      playerName: label,
      eliminatedRound: 1,
      juryMember: {
        playerId: `player-${label}`,
        playerName: label,
        eliminatedRound: 1,
      },
    },
  };
}

function canonicalVoteEvent(gameId: string, sequence: number): CanonicalGameEvent {
  return {
    sequence,
    gameId,
    round: 1,
    phase: Phase.VOTE,
    type: "vote.cast",
    timestamp: NOW,
    source: "engine",
    visibility: "producer",
    payloadVersion: 1,
    sourcePointers: [],
    payload: {
      voterId: "player-a",
      empowerTarget: "player-b",
      exposeTarget: "player-c",
    },
  };
}
