import { beforeEach, describe, expect, test } from "bun:test";
import type { CanonicalGameEvent } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { appendGameEvents, hashCanonicalEvent } from "../services/game-events.js";
import { getPersistedGameEvents } from "../services/game-event-read-model.js";
import { getPersistedGameProjection } from "../services/game-projection-read-model.js";
import { setupTestDB } from "./test-utils.js";
import {
  createCanonicalEventFixture,
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";

describe("persisted game projection read model", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("replays a complete persisted API event log into an operator summary", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);

    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const eventRead = await getPersistedGameEvents(db, gameId);
    const projectionRead = getPersistedGameProjection(eventRead);

    expect(projectionRead.status).toBe("complete");
    expect(projectionRead.replayedEventCount).toBe(events.length);
    expect(projectionRead.summary?.gameId).toBe(gameId);
    expect(projectionRead.summary?.lastSequence).toBe(events.length);
    expect(projectionRead.summary?.players.totalCount).toBe(4);
    expect(projectionRead.summary?.players.aliveNames.sort()).toEqual([
      "Atlas",
      "Echo",
      "Mira",
      "Nyx",
    ]);
    expect(projectionRead.summary?.voteState.empowerVotes).toMatchObject({
      atlas: "mira",
      echo: "mira",
      mira: "echo",
      nyx: "mira",
    });
  });

  test("replays the trusted prefix of an invalid persisted log as incomplete", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId, { lastPersistedEventSequence: 3 });
    const events = createCanonicalEventFixture(gameId).slice(0, 3);

    await insertCanonicalEventRows(db, gameId, ownerEpoch, events, {
      eventHash: (event) => event.sequence === 2
        ? "sha256:not-the-real-event-hash"
        : hashCanonicalEvent(event),
    });

    const eventRead = await getPersistedGameEvents(db, gameId);
    const projectionRead = getPersistedGameProjection(eventRead);

    expect(projectionRead.status).toBe("incomplete");
    expect(projectionRead.replayedEventCount).toBe(1);
    expect(projectionRead.summary?.lastSequence).toBe(1);
    expect(projectionRead.diagnostics[0]?.code).toBe("hash_mismatch");
  });

  test("returns empty projection state for games without persisted durable events", async () => {
    const gameId = await insertGame(db);

    const eventRead = await getPersistedGameEvents(db, gameId);
    const projectionRead = getPersistedGameProjection(eventRead);

    expect(projectionRead.status).toBe("empty");
    expect(projectionRead.summary).toBeNull();
    expect(projectionRead.replayedEventCount).toBe(0);
  });

  test("reports the exact sequence and trusted prefix length when projection replay fails", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId, { lastPersistedEventSequence: 1 });
    const malformedRoster = {
      ...createCanonicalEventFixture(gameId)[0]!,
      payload: {},
    } as CanonicalGameEvent;

    await insertCanonicalEventRows(db, gameId, ownerEpoch, [malformedRoster]);

    const eventRead = await getPersistedGameEvents(db, gameId);
    const projectionRead = getPersistedGameProjection(eventRead);

    expect(eventRead.status).toBe("complete");
    expect(projectionRead.status).toBe("failed");
    expect(projectionRead.replayedEventCount).toBe(0);
    expect(projectionRead.diagnostics.at(-1)).toMatchObject({
      code: "projection_replay_failed",
      sequence: 1,
    });
  });
});
