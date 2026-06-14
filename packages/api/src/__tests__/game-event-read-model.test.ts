import { beforeEach, describe, expect, test } from "bun:test";
import type { CanonicalGameEvent } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { appendGameEvents, hashCanonicalEvent } from "../services/game-events.js";
import {
  getPersistedGameEvents,
  type PersistedGameEventRow,
  validatePersistedGameEventRows,
} from "../services/game-event-read-model.js";
import { setupTestDB } from "./test-utils.js";
import {
  createCanonicalEventFixture,
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";

function persistedRowFor(
  gameId: string,
  event: CanonicalGameEvent,
  overrides: Partial<PersistedGameEventRow> = {},
): PersistedGameEventRow {
  return {
    gameId,
    sequence: event.sequence,
    eventType: event.type,
    eventHash: hashCanonicalEvent(event),
    ownerEpoch: "owner-1",
    visibility: event.visibility,
    payloadVersion: event.payloadVersion,
    envelope: event,
    createdAt: "2026-06-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("persisted game event read model", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("loads a complete valid prefix from events written through appendGameEvents", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);

    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const read = await getPersistedGameEvents(db, gameId);

    expect(read.status).toBe("complete");
    expect(read.eventCount).toBe(events.length);
    expect(read.validPrefixLength).toBe(events.length);
    expect(read.lastTrustedSequence).toBe(events.length);
    expect(read.diagnostics).toEqual([]);
    expect(read.events.map((event) => event.envelope.type)).toEqual(
      events.map((event) => event.type),
    );
  });

  test("reports an empty pre-kernel game without diagnostics", async () => {
    const gameId = await insertGame(db);

    const read = await getPersistedGameEvents(db, gameId);

    expect(read.status).toBe("empty");
    expect(read.eventCount).toBe(0);
    expect(read.validPrefixLength).toBe(0);
    expect(read.lastTrustedSequence).toBe(0);
    expect(read.diagnostics).toEqual([]);
  });

  test("stops trusting events at the first hash mismatch", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId, { lastPersistedEventSequence: 3 });
    const events = createCanonicalEventFixture(gameId).slice(0, 3);

    await insertCanonicalEventRows(db, gameId, ownerEpoch, events, {
      eventHash: (event) => event.sequence === 2
        ? "sha256:not-the-real-event-hash"
        : hashCanonicalEvent(event),
    });

    const read = await getPersistedGameEvents(db, gameId);

    expect(read.status).toBe("invalid");
    expect(read.validPrefixLength).toBe(1);
    expect(read.lastTrustedSequence).toBe(1);
    expect(read.firstInvalidSequence).toBe(2);
    expect(read.diagnostics[0]?.code).toBe("hash_mismatch");
  });

  test("detects non-contiguous persisted sequences", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId, { lastPersistedEventSequence: 3 });
    const events = createCanonicalEventFixture(gameId);
    const skipped = { ...events[1]!, sequence: 3 } as CanonicalGameEvent;

    await insertCanonicalEventRows(db, gameId, ownerEpoch, [events[0]!, skipped]);

    const read = await getPersistedGameEvents(db, gameId);

    expect(read.status).toBe("invalid");
    expect(read.validPrefixLength).toBe(1);
    expect(read.firstInvalidSequence).toBe(3);
    expect(read.diagnostics[0]).toMatchObject({
      code: "sequence_gap",
      expectedSequence: 2,
      actualSequence: 3,
    });
  });

  test("validates stored row metadata against the canonical envelope", () => {
    const gameId = "metadata-game";
    const event = createCanonicalEventFixture(gameId)[0]!;

    const read = validatePersistedGameEventRows(gameId, [
      persistedRowFor(gameId, event, { eventType: "round.started" }),
    ]);

    expect(read.status).toBe("invalid");
    expect(read.validPrefixLength).toBe(0);
    expect(read.diagnostics[0]?.code).toBe("metadata_mismatch");
  });

  test("detects duplicate sequences in read-model validation", () => {
    const gameId = "duplicate-game";
    const event = createCanonicalEventFixture(gameId)[0]!;
    const row = persistedRowFor(gameId, event);

    const read = validatePersistedGameEventRows(gameId, [row, row]);

    expect(read.status).toBe("invalid");
    expect(read.validPrefixLength).toBe(1);
    expect(read.diagnostics[0]).toMatchObject({
      code: "duplicate_sequence",
      expectedSequence: 2,
      actualSequence: 1,
    });
  });

  test("detects unsupported persisted payload versions", () => {
    const gameId = "payload-version-game";
    const event = createCanonicalEventFixture(gameId)[0]!;

    const read = validatePersistedGameEventRows(gameId, [
      persistedRowFor(gameId, event, { payloadVersion: 2 }),
    ]);

    expect(read.status).toBe("invalid");
    expect(read.validPrefixLength).toBe(0);
    expect(read.diagnostics[0]?.code).toBe("unsupported_payload_version");
  });

  test("detects malformed canonical envelopes", () => {
    const gameId = "invalid-envelope-game";
    const event = createCanonicalEventFixture(gameId)[0]!;

    const read = validatePersistedGameEventRows(gameId, [
      persistedRowFor(gameId, event, {
        eventHash: "sha256:invalid-envelope",
        envelope: {},
      }),
    ]);

    expect(read.status).toBe("invalid");
    expect(read.validPrefixLength).toBe(0);
    expect(read.diagnostics[0]?.code).toBe("invalid_envelope");
  });

  test("detects envelopes that belong to a different game", () => {
    const gameId = "expected-game";
    const otherEvent = createCanonicalEventFixture("other-game")[0]!;

    const read = validatePersistedGameEventRows(gameId, [
      persistedRowFor(gameId, otherEvent),
    ]);

    expect(read.status).toBe("invalid");
    expect(read.validPrefixLength).toBe(0);
    expect(read.diagnostics[0]?.code).toBe("wrong_game");
  });
});
