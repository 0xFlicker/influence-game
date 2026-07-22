import { asc, eq } from "drizzle-orm";
import {
  validateCanonicalGameEvent,
  type CanonicalGameEvent,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { hashCanonicalEvent } from "./game-events.js";

type GameEventReadDB = Pick<DrizzleDB, "select">;

export type PersistedEventDiagnosticCode =
  | "duplicate_sequence"
  | "hash_mismatch"
  | "invalid_envelope"
  | "metadata_mismatch"
  | "sequence_gap"
  | "unsupported_payload_version"
  | "wrong_game";

export interface PersistedEventDiagnostic {
  code: PersistedEventDiagnosticCode;
  severity: "error";
  message: string;
  sequence?: number;
  expectedSequence?: number;
  actualSequence?: number;
  eventType?: string;
}

export interface PersistedGameEventRow {
  gameId: string;
  sequence: number;
  eventType: string;
  eventHash: string;
  ownerEpoch: string;
  visibility: string;
  payloadVersion: number;
  envelope: unknown;
  createdAt: string;
}

export interface TrustedPersistedGameEvent {
  gameId: string;
  sequence: number;
  eventType: string;
  eventHash: string;
  ownerEpoch: string;
  visibility: string;
  payloadVersion: 1;
  envelope: CanonicalGameEvent;
  createdAt: string;
}

export interface PersistedEventHead {
  sequence: number;
  eventType: string;
  eventHash: string;
  createdAt: string;
}

export interface PersistedGameEventsRead {
  gameId: string;
  status: "empty" | "complete" | "invalid";
  events: TrustedPersistedGameEvent[];
  diagnostics: PersistedEventDiagnostic[];
  eventCount: number;
  validPrefixLength: number;
  lastTrustedSequence: number;
  firstInvalidSequence?: number;
  persistedHead?: PersistedEventHead;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildDiagnostic(
  row: PersistedGameEventRow,
  diagnostic: Omit<PersistedEventDiagnostic, "severity" | "sequence" | "eventType">,
): PersistedEventDiagnostic {
  return {
    ...diagnostic,
    severity: "error",
    sequence: row.sequence,
    eventType: row.eventType,
  };
}

function finishRead(
  gameId: string,
  rows: readonly PersistedGameEventRow[],
  events: TrustedPersistedGameEvent[],
  diagnostics: PersistedEventDiagnostic[],
): PersistedGameEventsRead {
  const headRow = rows.at(-1);
  const firstInvalid = diagnostics[0];
  return {
    gameId,
    status: rows.length === 0 ? "empty" : diagnostics.length === 0 ? "complete" : "invalid",
    events,
    diagnostics,
    eventCount: rows.length,
    validPrefixLength: events.length,
    lastTrustedSequence: events.at(-1)?.sequence ?? 0,
    ...(firstInvalid?.sequence !== undefined && { firstInvalidSequence: firstInvalid.sequence }),
    ...(headRow && {
      persistedHead: {
        sequence: headRow.sequence,
        eventType: headRow.eventType,
        eventHash: headRow.eventHash,
        createdAt: headRow.createdAt,
      },
    }),
  };
}

export function validatePersistedGameEventRows(
  gameId: string,
  rows: readonly PersistedGameEventRow[],
): PersistedGameEventsRead {
  const events: TrustedPersistedGameEvent[] = [];
  const diagnostics: PersistedEventDiagnostic[] = [];
  let expectedSequence = 1;

  for (const row of rows) {
    if (row.sequence < expectedSequence) {
      diagnostics.push(buildDiagnostic(row, {
        code: "duplicate_sequence",
        message: `Duplicate persisted canonical event sequence ${row.sequence}`,
        expectedSequence,
        actualSequence: row.sequence,
      }));
      break;
    }

    if (row.sequence !== expectedSequence) {
      diagnostics.push(buildDiagnostic(row, {
        code: "sequence_gap",
        message: `Non-contiguous persisted canonical event sequence: expected ${expectedSequence}, got ${row.sequence}`,
        expectedSequence,
        actualSequence: row.sequence,
      }));
      break;
    }

    if (row.payloadVersion !== 1) {
      diagnostics.push(buildDiagnostic(row, {
        code: "unsupported_payload_version",
        message: `Unsupported persisted canonical event payload version ${row.payloadVersion}`,
      }));
      break;
    }

    const envelopeRecord = isRecord(row.envelope) ? row.envelope : null;
    if (envelopeRecord?.payloadVersion !== undefined && envelopeRecord.payloadVersion !== 1) {
      diagnostics.push(buildDiagnostic(row, {
        code: "unsupported_payload_version",
        message: `Unsupported canonical event payload version ${String(envelopeRecord.payloadVersion)}`,
      }));
      break;
    }

    const validation = validateCanonicalGameEvent(row.envelope);
    if (!validation.ok) {
      diagnostics.push(buildDiagnostic(row, {
        code: "invalid_envelope",
        message: `Invalid canonical event envelope: ${validation.errors.join("; ")}`,
      }));
      break;
    }

    const event = row.envelope as CanonicalGameEvent;
    if (event.gameId !== gameId) {
      diagnostics.push(buildDiagnostic(row, {
        code: "wrong_game",
        message: `Persisted canonical event belongs to game ${event.gameId}, expected ${gameId}`,
      }));
      break;
    }

    if (
      row.gameId !== gameId ||
      row.sequence !== event.sequence ||
      row.eventType !== event.type ||
      row.visibility !== event.visibility ||
      row.payloadVersion !== event.payloadVersion
    ) {
      diagnostics.push(buildDiagnostic(row, {
        code: "metadata_mismatch",
        message: "Persisted event row metadata does not match canonical envelope metadata",
      }));
      break;
    }

    const eventHash = hashCanonicalEvent(event);
    if (row.eventHash !== eventHash) {
      diagnostics.push(buildDiagnostic(row, {
        code: "hash_mismatch",
        message: `Persisted event hash mismatch at sequence ${row.sequence}`,
      }));
      break;
    }

    events.push({
      gameId: row.gameId,
      sequence: row.sequence,
      eventType: row.eventType,
      eventHash: row.eventHash,
      ownerEpoch: row.ownerEpoch,
      visibility: row.visibility,
      payloadVersion: 1,
      envelope: event,
      createdAt: row.createdAt,
    });
    expectedSequence += 1;
  }

  return finishRead(gameId, rows, events, diagnostics);
}

export async function getPersistedGameEvents(
  db: GameEventReadDB,
  gameId: string,
): Promise<PersistedGameEventsRead> {
  const rows = await db
    .select({
      gameId: schema.gameEvents.gameId,
      sequence: schema.gameEvents.sequence,
      eventType: schema.gameEvents.eventType,
      eventHash: schema.gameEvents.eventHash,
      ownerEpoch: schema.gameEvents.ownerEpoch,
      visibility: schema.gameEvents.visibility,
      payloadVersion: schema.gameEvents.payloadVersion,
      envelope: schema.gameEvents.envelope,
      createdAt: schema.gameEvents.createdAt,
    })
    .from(schema.gameEvents)
    .where(eq(schema.gameEvents.gameId, gameId))
    .orderBy(asc(schema.gameEvents.sequence), asc(schema.gameEvents.id));

  return validatePersistedGameEventRows(gameId, rows);
}

/**
 * Trusted contiguous canonical prefix for authorization consumers (U3 huddle
 * session-time membership). Identical to getPersistedGameEvents: stops at the
 * first integrity break so untrusted tail events never authorize private rows.
 */
export async function getTrustedCanonicalEventPrefix(
  db: GameEventReadDB,
  gameId: string,
): Promise<PersistedGameEventsRead> {
  return getPersistedGameEvents(db, gameId);
}
