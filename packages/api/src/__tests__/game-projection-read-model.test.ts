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

  test("projects a public format menu so MCP can answer which formats were offered", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const baseEvents = createCanonicalEventFixture(gameId);
    const formatMenuEvent: CanonicalGameEvent = {
      sequence: baseEvents.length + 1,
      gameId,
      round: 1,
      phase: "format_menu" as CanonicalGameEvent["phase"],
      type: "format.menu_offered",
      timestamp: "2026-07-24T00:00:00.000Z",
      source: "phase",
      visibility: "public",
      payloadVersion: 1,
      sourcePointers: [],
      payload: {
        empoweredId: "atlas",
        offeredFormatIds: ["safety_bounce", "vote_bomb"],
      },
    };

    await appendGameEvents(db, { gameId, ownerEpoch, events: [...baseEvents, formatMenuEvent] });

    const projectionRead = getPersistedGameProjection(await getPersistedGameEvents(db, gameId));

    expect(projectionRead.summary?.formatMenu).toEqual({
      empoweredId: "atlas",
      offeredFormatIds: ["safety_bounce", "vote_bomb"],
      selectedFormatId: null,
    });
  });

  test("projects selectedFormatId after format.selected", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const baseEvents = createCanonicalEventFixture(gameId);
    const formatMenuEvent: CanonicalGameEvent = {
      sequence: baseEvents.length + 1,
      gameId,
      round: 1,
      phase: "format_menu" as CanonicalGameEvent["phase"],
      type: "format.menu_offered",
      timestamp: "2026-07-24T00:00:00.000Z",
      source: "phase",
      visibility: "public",
      payloadVersion: 1,
      sourcePointers: [],
      payload: {
        empoweredId: "atlas",
        offeredFormatIds: ["safety_bounce", "vote_bomb"],
      },
    };
    const formatSelectedEvent: CanonicalGameEvent = {
      sequence: baseEvents.length + 2,
      gameId,
      round: 1,
      phase: "format_pick" as CanonicalGameEvent["phase"],
      type: "format.selected",
      timestamp: "2026-07-24T00:00:01.000Z",
      source: "phase",
      visibility: "public",
      payloadVersion: 1,
      sourcePointers: [],
      payload: {
        empoweredId: "atlas",
        formatId: "safety_bounce",
      },
    };

    await appendGameEvents(db, {
      gameId,
      ownerEpoch,
      events: [...baseEvents, formatMenuEvent, formatSelectedEvent],
    });

    const projectionRead = getPersistedGameProjection(await getPersistedGameEvents(db, gameId));

    expect(projectionRead.summary?.formatMenu).toEqual({
      empoweredId: "atlas",
      offeredFormatIds: ["safety_bounce", "vote_bomb"],
      selectedFormatId: "safety_bounce",
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
