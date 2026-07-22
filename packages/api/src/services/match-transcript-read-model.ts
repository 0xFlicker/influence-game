/**
 * Owner-authorized match transcript pagination (U4).
 *
 * Bounded, filterable, stable pages over the U3 authorized dialogue relation.
 * Pins a first-page read-through watermark (modern) or terminal legacy boundary,
 * keyset-paginates without offsets, and issues AES-GCM cursors bound to
 * subject/game/ownership/filters. Hidden rows never contribute to page shape,
 * totals, or diagnostics.
 *
 * Protocol-neutral: MCP tool registration is U8.
 */

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lt, lte, or, type SQL } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { TranscriptSafeContext } from "../db/schema.js";
import {
  bindMatchTranscriptCursor,
  decodeMatchTranscriptCursor,
  fingerprintMatchTranscriptFilters,
  issueMatchTranscriptCursor,
  type MatchReadKeyset,
  type MatchReadThroughBoundary,
  type MatchTranscriptCursorClaims,
  type MatchTranscriptCursorMode,
} from "./match-read-cursor.js";
import {
  withMatchAccessSnapshot,
  type MatchAccessContext,
} from "./match-access-context.js";
import { readGameTranscriptState } from "./game-transcript-persistence.js";
import {
  buildMatchTranscriptEntryDto,
  type MatchTranscriptEntryDto,
  type TranscriptOrderingQuality,
  UNTRUSTED_GAME_AUTHORED,
} from "./transcript-serialization.js";
import {
  classifyAuthorizedTranscriptRow,
  evaluateTranscriptLaneAccess,
  loadTrustedHuddleSessions,
  type TranscriptAuthorizationEvidence,
  type TranscriptVisibilityClass,
  type TrustedHuddleSessionLoad,
} from "./transcript-visibility-policy.js";
import { isCurrentTranscriptCapture } from "./transcript-capture.js";

/** Default authorized page size (planning resolution). */
export const MATCH_TRANSCRIPT_DEFAULT_LIMIT = 100;
/** Server-enforced maximum page size. */
export const MATCH_TRANSCRIPT_MAX_LIMIT = 250;
/** Maximum accepted game id/slug / player token length. */
export const MATCH_TRANSCRIPT_MAX_ID_CHARS = 128;
/** Maximum accepted cursor token length (codec also enforces). */
export const MATCH_TRANSCRIPT_MAX_CURSOR_CHARS = 4096;

const DIALOGUE_SCOPES = ["public", "system", "mingle", "whisper", "huddle"] as const;

/** SQL candidate batch size when scanning for authorized rows. */
const CANDIDATE_BATCH = 500;

export type MatchTranscriptScopeFilter = (typeof DIALOGUE_SCOPES)[number];

export interface MatchTranscriptNormalizedFilters {
  phase: string | null;
  round: number | null;
  scope: MatchTranscriptScopeFilter | null;
  playerId: string | null;
  /** Original player filter token for echo (never ownership list). */
  player: string | null;
  fromTimestampMs: number | null;
  toTimestampMs: number | null;
}

export interface MatchTranscriptLimitation {
  code: "legacy_system_dialogue_unclassified";
  message: string;
  /** Version-wide; never includes counts. */
  scope: "capture_version";
}

export interface MatchTranscriptReadThroughDto {
  mode: "live_watermark" | "completed_terminal" | "legacy_terminal";
  throughEntrySequence: number | null;
  throughLegacyTimestamp: number | null;
  throughLegacyId: number | null;
  durableSequence: number | null;
  terminalState: string | null;
}

export interface MatchTranscriptPageOk {
  ok: true;
  schemaVersion: 1;
  game: {
    id: string;
    slug: string;
    status: string;
    transcriptCaptureVersion: number;
  };
  orderingQuality: TranscriptOrderingQuality;
  readThrough: MatchTranscriptReadThroughDto;
  filters: MatchTranscriptNormalizedFilters;
  entries: MatchTranscriptEntryDto[];
  pageSize: number;
  /** Opaque cursor for the next page or catch-up; null when no further walk is issued. */
  nextCursor: string | null;
  nextCursorKind: "page" | "catchup" | null;
  limitations: MatchTranscriptLimitation[];
  contentTrust: typeof UNTRUSTED_GAME_AUTHORED;
}

export type MatchTranscriptPageError =
  | {
      ok: false;
      status: "not_accessible";
      error: string;
    }
  | {
      ok: false;
      status: "denied";
      error: string;
    }
  | {
      ok: false;
      status: "cursor_invalid_or_stale";
      error: string;
    }
  | {
      ok: false;
      status: "invalid_input";
      error: string;
      field?: string;
    }
  | {
      ok: false;
      status: "unavailable";
      error: string;
    };

export type MatchTranscriptPageResult = MatchTranscriptPageOk | MatchTranscriptPageError;

/**
 * Closed input object. Unknown keys are rejected by the parser.
 */
export interface ReadMatchTranscriptInput {
  gameIdOrSlug: string;
  phase?: string;
  round?: number;
  scope?: string;
  player?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  cursor?: string;
  limit?: number;
}

const KNOWN_INPUT_KEYS = new Set([
  "gameIdOrSlug",
  "phase",
  "round",
  "scope",
  "player",
  "fromTimestamp",
  "toTimestamp",
  "cursor",
  "limit",
]);

export interface ReadMatchTranscriptOptions {
  subjectUserId: string;
  /** Optional secret override for tests. */
  cursorSecret?: string;
  nowMs?: number;
}

type TranscriptCandidateRow = {
  id: number;
  entrySequence: number | null;
  scope: string;
  round: number;
  phase: string;
  timestamp: number;
  fromPlayerId: string | null;
  toPlayerIds: string | null;
  speakerPlayerId: string | null;
  audiencePlayerIds: string[] | null;
  captureVersion: number | null;
  dialogueKind: string | null;
  safeContext: TranscriptSafeContext | null;
  text: string;
};

/**
 * Read one authorized transcript page for a participating owner.
 * Rebuilds MatchAccessContext and reauthorizes every page inside one snapshot.
 */
export async function readMatchTranscriptPage(
  db: DrizzleDB,
  rawInput: unknown,
  options: ReadMatchTranscriptOptions,
): Promise<MatchTranscriptPageResult> {
  const parsed = parseReadMatchTranscriptInput(rawInput);
  if (!parsed.ok) return parsed;

  const input = parsed.value;
  const nowMs = options.nowMs ?? Date.now();

  // Reject oversized/malformed cursors before DB when structurally invalid.
  let decodedCursor: MatchTranscriptCursorClaims | null = null;
  if (input.cursor != null) {
    const decoded = decodeMatchTranscriptCursor(input.cursor, {
      secretMaterial: options.cursorSecret,
      nowMs,
    });
    if (decoded.status !== "ok") {
      return {
        ok: false,
        status: "cursor_invalid_or_stale",
        error: "Cursor is invalid or stale",
      };
    }
    decodedCursor = decoded.claims;
  }

  return withMatchAccessSnapshot(
    db,
    {
      subjectUserId: options.subjectUserId,
      gameIdOrSlug: input.gameIdOrSlug,
    },
    async ({ tx, resolution }) => {
      if (resolution.status !== "resolved") {
        return {
          ok: false as const,
          status: "not_accessible" as const,
          error: "Game is not accessible",
        };
      }

      const context = resolution.context;
      const lane = evaluateTranscriptLaneAccess(context);
      if (lane.status === "denied") {
        // Non-enumerating: creator-only / no seats looks like access denial for private lane.
        return {
          ok: false as const,
          status: "denied" as const,
          error: "Match transcript is not available for this subject",
        };
      }

      // Resolve player filter against roster (ambiguous → invalid_input, not silent coerce).
      let playerId: string | null = null;
      if (input.player != null) {
        playerId = context.resolvePlayerId(input.player);
        if (!playerId) {
          return {
            ok: false as const,
            status: "invalid_input" as const,
            error: "player filter did not resolve to a unique roster player",
            field: "player",
          };
        }
      }

      const filters: MatchTranscriptNormalizedFilters = {
        phase: input.phase,
        round: input.round,
        scope: input.scope,
        playerId,
        player: input.player,
        fromTimestampMs: input.fromTimestampMs,
        toTimestampMs: input.toTimestampMs,
      };
      const filterFingerprint = fingerprintMatchTranscriptFilters({
        phase: filters.phase,
        round: filters.round,
        scope: filters.scope,
        playerId: filters.playerId,
        fromTimestampMs: filters.fromTimestampMs,
        toTimestampMs: filters.toTimestampMs,
      });

      let appliedFilters: MatchTranscriptNormalizedFilters;
      let boundFilterFingerprint: string;

      if (decodedCursor) {
        // Cursor + conflicting request filters rejected via fingerprint mismatch.
        if (input.hasExplicitFilters && decodedCursor.filterFingerprint !== filterFingerprint) {
          return {
            ok: false as const,
            status: "cursor_invalid_or_stale" as const,
            error: "Cursor is invalid or stale",
          };
        }
        boundFilterFingerprint = decodedCursor.filterFingerprint;
        if (!bindMatchTranscriptCursor({
          claims: decodedCursor,
          subjectUserId: options.subjectUserId,
          gameId: context.gameId,
          ownershipFingerprint: context.ownershipFingerprint,
          filterFingerprint: boundFilterFingerprint,
          captureVersion: context.transcriptCaptureVersion,
        })) {
          return {
            ok: false as const,
            status: "cursor_invalid_or_stale" as const,
            error: "Cursor is invalid or stale",
          };
        }
        // Resume uses sealed filter values (re-apply same dimensional predicates).
        const sealedScope = parseScopeFilter(decodedCursor.filters.scope);
        if (decodedCursor.filters.scope != null && sealedScope == null) {
          return {
            ok: false as const,
            status: "cursor_invalid_or_stale" as const,
            error: "Cursor is invalid or stale",
          };
        }
        appliedFilters = {
          phase: decodedCursor.filters.phase,
          round: decodedCursor.filters.round,
          scope: sealedScope,
          playerId: decodedCursor.filters.playerId,
          player: decodedCursor.filters.player,
          fromTimestampMs: decodedCursor.filters.fromTimestampMs,
          toTimestampMs: decodedCursor.filters.toTimestampMs,
        };
      } else {
        appliedFilters = filters;
        boundFilterFingerprint = filterFingerprint;
      }

      const isModern = isCurrentTranscriptCapture(context.transcriptCaptureVersion);
      const gameStatus = context.gameStatus;

      // Legacy live without modern watermark is not walkable.
      if (!isModern && gameStatus !== "completed") {
        return {
          ok: false as const,
          status: "unavailable" as const,
          error: "Legacy live transcript walk requires modern capture watermark",
        };
      }

      const transcriptState = isModern
        ? await readGameTranscriptState(tx, context.gameId)
        : null;

      let mode: MatchTranscriptCursorMode = "snapshot";
      let readThrough: MatchReadThroughBoundary;
      let keyset: MatchReadKeyset;
      let orderingQuality: TranscriptOrderingQuality;
      let readThroughMode: MatchTranscriptReadThroughDto["mode"];

      if (decodedCursor) {
        mode = decodedCursor.mode;
        readThrough = { ...decodedCursor.readThrough };
        keyset = { ...decodedCursor.keyset };
        orderingQuality = isModern ? "sequence" : "deterministic_approximate";
        readThroughMode = isModern
          ? (gameStatus === "completed" ? "completed_terminal" : "live_watermark")
          : "legacy_terminal";

        if (mode === "catchup") {
          // Catch-up: pin a newer watermark if available; walk after previous boundary.
          if (!isModern || !transcriptState) {
            return {
              ok: false as const,
              status: "unavailable" as const,
              error: "Catch-up requires modern transcript watermark",
            };
          }
          const prevThrough = decodedCursor.readThrough.throughEntrySequence ?? 0;
          const currentWatermark = transcriptState.durableSequence;
          if (currentWatermark <= prevThrough) {
            // Nothing new — empty page, optional catch-up cursor still after same boundary.
            return buildEmptyCatchupResult({
              context,
              appliedFilters,
              readThrough: {
                mode: gameStatus === "completed" ? "completed_terminal" : "live_watermark",
                throughEntrySequence: currentWatermark,
                throughLegacyTimestamp: null,
                throughLegacyId: null,
                durableSequence: currentWatermark,
                terminalState: transcriptState.terminalState,
              },
              orderingQuality: "sequence",
              limitations: limitationsForCapture(context.transcriptCaptureVersion),
              subjectUserId: options.subjectUserId,
              filterFingerprint: boundFilterFingerprint,
              cursorSecret: options.cursorSecret,
              nowMs,
              prevThrough,
            });
          }
          readThrough = {
            throughEntrySequence: currentWatermark,
            throughLegacyTimestamp: null,
            throughLegacyId: null,
          };
          keyset = {
            afterEntrySequence: prevThrough,
            afterLegacyTimestamp: null,
            afterLegacyId: null,
          };
          mode = "snapshot"; // walk the new slice as a snapshot
        }
      } else if (isModern) {
        const watermark = transcriptState?.durableSequence ?? 0;
        readThrough = {
          throughEntrySequence: watermark,
          throughLegacyTimestamp: null,
          throughLegacyId: null,
        };
        keyset = {
          afterEntrySequence: null,
          afterLegacyTimestamp: null,
          afterLegacyId: null,
        };
        orderingQuality = "sequence";
        readThroughMode = gameStatus === "completed" ? "completed_terminal" : "live_watermark";
      } else {
        // Legacy completed: pin immutable terminal (max timestamp, id).
        const terminal = await loadLegacyTerminalBoundary(tx, context.gameId);
        readThrough = {
          throughEntrySequence: null,
          throughLegacyTimestamp: terminal.timestamp,
          throughLegacyId: terminal.id,
        };
        keyset = {
          afterEntrySequence: null,
          afterLegacyTimestamp: null,
          afterLegacyId: null,
        };
        orderingQuality = "deterministic_approximate";
        readThroughMode = "legacy_terminal";
      }

      const trustedHuddleLoad = await loadTrustedHuddleSessions(tx, context.gameId);
      const evidence: TranscriptAuthorizationEvidence = {
        ownedPlayerIds: context.ownedPlayerIds,
        resolvePlayerId: (nameOrId) => context.resolvePlayerId(nameOrId),
        trustedHuddleSessions: trustedHuddleLoad.sessions,
        trustedPrefixHealthy: trustedHuddleLoad.trustedPrefixHealthy,
      };

      const { pageRows, exhausted, lastKeyset } = await collectAuthorizedPage({
        db: tx,
        gameId: context.gameId,
        isModern,
        readThrough,
        keyset,
        filters: appliedFilters,
        evidence,
        limit: input.limit,
        captureVersion: context.transcriptCaptureVersion,
      });

      const entries = pageRows.map((row) => buildMatchTranscriptEntryDto({
        id: row.id,
        entrySequence: row.entrySequence,
        scope: row.scope,
        visibilityClass: row.visibilityClass,
        round: row.round,
        phase: row.phase,
        timestamp: row.timestamp,
        text: row.text,
        speakerPlayerId: row.speakerPlayerId,
        fromPlayerId: row.fromPlayerId,
        audiencePlayerIds: row.audiencePlayerIds,
        dialogueKind: row.dialogueKind,
        safeContext: row.safeContext,
        captureVersion: row.captureVersion,
        resolvePlayerName: (id) => context.resolvePlayerName(id),
        legacyOrdering: !isModern,
      }));

      let nextCursor: string | null = null;
      let nextCursorKind: "page" | "catchup" | null = null;

      const sealedFilters = {
        phase: appliedFilters.phase,
        round: appliedFilters.round,
        scope: appliedFilters.scope,
        playerId: appliedFilters.playerId,
        player: appliedFilters.player,
        fromTimestampMs: appliedFilters.fromTimestampMs,
        toTimestampMs: appliedFilters.toTimestampMs,
      };

      if (!exhausted) {
        nextCursor = issueMatchTranscriptCursor({
          subjectUserId: options.subjectUserId,
          gameId: context.gameId,
          filterFingerprint: boundFilterFingerprint,
          ownershipFingerprint: context.ownershipFingerprint,
          captureVersion: context.transcriptCaptureVersion,
          mode: "snapshot",
          readThrough,
          keyset: lastKeyset,
          filters: sealedFilters,
          nowMs,
        }, options.cursorSecret);
        nextCursorKind = "page";
      } else if (isModern) {
        // Snapshot exhausted — issue catch-up cursor after pinned watermark.
        const through = readThrough.throughEntrySequence ?? 0;
        nextCursor = issueMatchTranscriptCursor({
          subjectUserId: options.subjectUserId,
          gameId: context.gameId,
          filterFingerprint: boundFilterFingerprint,
          ownershipFingerprint: context.ownershipFingerprint,
          captureVersion: context.transcriptCaptureVersion,
          mode: "catchup",
          readThrough,
          keyset: {
            afterEntrySequence: through,
            afterLegacyTimestamp: null,
            afterLegacyId: null,
          },
          filters: sealedFilters,
          nowMs,
        }, options.cursorSecret);
        nextCursorKind = "catchup";
      } else {
        // Legacy terminal is immutable — no catch-up.
        nextCursor = null;
        nextCursorKind = null;
      }

      const readThroughDto: MatchTranscriptReadThroughDto = {
        mode: readThroughMode,
        throughEntrySequence: readThrough.throughEntrySequence,
        throughLegacyTimestamp: readThrough.throughLegacyTimestamp,
        throughLegacyId: readThrough.throughLegacyId,
        durableSequence: transcriptState?.durableSequence ?? null,
        terminalState: transcriptState?.terminalState ?? null,
      };

      return {
        ok: true as const,
        schemaVersion: 1 as const,
        game: {
          id: context.gameId,
          slug: context.gameSlug,
          status: context.gameStatus,
          transcriptCaptureVersion: context.transcriptCaptureVersion,
        },
        orderingQuality,
        readThrough: readThroughDto,
        filters: appliedFilters,
        entries,
        pageSize: entries.length,
        nextCursor,
        nextCursorKind,
        limitations: limitationsForCapture(context.transcriptCaptureVersion),
        contentTrust: UNTRUSTED_GAME_AUTHORED,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Closed input parser
// ---------------------------------------------------------------------------

type ParsedInput = {
  gameIdOrSlug: string;
  phase: string | null;
  round: number | null;
  scope: MatchTranscriptScopeFilter | null;
  player: string | null;
  fromTimestampMs: number | null;
  toTimestampMs: number | null;
  cursor: string | null;
  limit: number;
  hasExplicitFilters: boolean;
};

function parseReadMatchTranscriptInput(
  raw: unknown,
): { ok: true; value: ParsedInput } | MatchTranscriptPageError {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      status: "invalid_input",
      error: "Input must be a closed object",
    };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KNOWN_INPUT_KEYS.has(key)) {
      return {
        ok: false,
        status: "invalid_input",
        error: `Unknown input field: ${key}`,
        field: key,
      };
    }
  }

  if (typeof record.gameIdOrSlug !== "string" || record.gameIdOrSlug.trim().length === 0) {
    return {
      ok: false,
      status: "invalid_input",
      error: "gameIdOrSlug is required",
      field: "gameIdOrSlug",
    };
  }
  if (record.gameIdOrSlug.length > MATCH_TRANSCRIPT_MAX_ID_CHARS) {
    return {
      ok: false,
      status: "invalid_input",
      error: "gameIdOrSlug exceeds maximum length",
      field: "gameIdOrSlug",
    };
  }

  let phase: string | null = null;
  if (record.phase !== undefined) {
    if (typeof record.phase !== "string" || record.phase.length === 0 || record.phase.length > 64) {
      return {
        ok: false,
        status: "invalid_input",
        error: "phase must be a non-empty string",
        field: "phase",
      };
    }
    phase = record.phase;
  }

  let round: number | null = null;
  if (record.round !== undefined) {
    if (typeof record.round !== "number" || !Number.isInteger(record.round) || record.round < 0) {
      return {
        ok: false,
        status: "invalid_input",
        error: "round must be a non-negative integer",
        field: "round",
      };
    }
    round = record.round;
  }

  let scope: MatchTranscriptScopeFilter | null = null;
  if (record.scope !== undefined) {
    if (typeof record.scope !== "string") {
      return {
        ok: false,
        status: "invalid_input",
        error: "scope must be one of public|system|mingle|whisper|huddle",
        field: "scope",
      };
    }
    scope = parseScopeFilter(record.scope);
    if (scope == null) {
      return {
        ok: false,
        status: "invalid_input",
        error: "scope must be one of public|system|mingle|whisper|huddle",
        field: "scope",
      };
    }
  }

  let player: string | null = null;
  if (record.player !== undefined) {
    if (typeof record.player !== "string" || record.player.trim().length === 0) {
      return {
        ok: false,
        status: "invalid_input",
        error: "player must be a non-empty string",
        field: "player",
      };
    }
    if (record.player.length > MATCH_TRANSCRIPT_MAX_ID_CHARS) {
      return {
        ok: false,
        status: "invalid_input",
        error: "player exceeds maximum length",
        field: "player",
      };
    }
    player = record.player;
  }

  let fromTimestampMs: number | null = null;
  if (record.fromTimestamp !== undefined) {
    const parsed = parseRfc3339(record.fromTimestamp, "fromTimestamp");
    if (!parsed.ok) return parsed;
    fromTimestampMs = parsed.ms;
  }

  let toTimestampMs: number | null = null;
  if (record.toTimestamp !== undefined) {
    const parsed = parseRfc3339(record.toTimestamp, "toTimestamp");
    if (!parsed.ok) return parsed;
    toTimestampMs = parsed.ms;
  }

  if (
    fromTimestampMs != null
    && toTimestampMs != null
    && fromTimestampMs > toTimestampMs
  ) {
    return {
      ok: false,
      status: "invalid_input",
      error: "fromTimestamp must be <= toTimestamp",
      field: "fromTimestamp",
    };
  }

  let cursor: string | null = null;
  if (record.cursor !== undefined) {
    if (typeof record.cursor !== "string" || record.cursor.length === 0) {
      return {
        ok: false,
        status: "invalid_input",
        error: "cursor must be a non-empty string",
        field: "cursor",
      };
    }
    if (record.cursor.length > MATCH_TRANSCRIPT_MAX_CURSOR_CHARS) {
      return {
        ok: false,
        status: "invalid_input",
        error: "cursor exceeds maximum length",
        field: "cursor",
      };
    }
    cursor = record.cursor;
  }

  let limit = MATCH_TRANSCRIPT_DEFAULT_LIMIT;
  if (record.limit !== undefined) {
    if (
      typeof record.limit !== "number"
      || !Number.isInteger(record.limit)
      || record.limit < 1
      || record.limit > MATCH_TRANSCRIPT_MAX_LIMIT
    ) {
      return {
        ok: false,
        status: "invalid_input",
        error: `limit must be an integer from 1 to ${MATCH_TRANSCRIPT_MAX_LIMIT}`,
        field: "limit",
      };
    }
    limit = record.limit;
  }

  const hasExplicitFilters = phase != null
    || round != null
    || scope != null
    || player != null
    || fromTimestampMs != null
    || toTimestampMs != null;

  return {
    ok: true,
    value: {
      gameIdOrSlug: record.gameIdOrSlug.trim(),
      phase,
      round,
      scope,
      player,
      fromTimestampMs,
      toTimestampMs,
      cursor,
      limit,
      hasExplicitFilters,
    },
  };
}

function parseRfc3339(
  value: unknown,
  field: string,
): { ok: true; ms: number } | MatchTranscriptPageError {
  if (typeof value !== "string" || value.length === 0 || value.length > 40) {
    return {
      ok: false,
      status: "invalid_input",
      error: `${field} must be an RFC3339 timestamp`,
      field,
    };
  }
  // Strict-ish RFC3339: require timezone designator Z or offset.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return {
      ok: false,
      status: "invalid_input",
      error: `${field} must be an RFC3339 timestamp`,
      field,
    };
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return {
      ok: false,
      status: "invalid_input",
      error: `${field} must be an RFC3339 timestamp`,
      field,
    };
  }
  return { ok: true, ms };
}

// ---------------------------------------------------------------------------
// Page collection
// ---------------------------------------------------------------------------

type AuthorizedPageRow = TranscriptCandidateRow & {
  visibilityClass: TranscriptVisibilityClass;
};

async function collectAuthorizedPage(params: {
  db: Pick<DrizzleDB, "select">;
  gameId: string;
  isModern: boolean;
  readThrough: MatchReadThroughBoundary;
  keyset: MatchReadKeyset;
  filters: MatchTranscriptNormalizedFilters;
  evidence: TranscriptAuthorizationEvidence;
  limit: number;
  captureVersion: number;
}): Promise<{
  pageRows: AuthorizedPageRow[];
  exhausted: boolean;
  lastKeyset: MatchReadKeyset;
}> {
  const pageRows: AuthorizedPageRow[] = [];
  let keyset = { ...params.keyset };
  let exhausted = false;

  // Fetch until we have limit+1 authorized filtered rows or the snapshot is exhausted.
  while (pageRows.length < params.limit + 1) {
    const batch = params.isModern
      ? await fetchModernBatch({
          db: params.db,
          gameId: params.gameId,
          readThrough: params.readThrough,
          keyset,
          filters: params.filters,
          batchSize: CANDIDATE_BATCH,
        })
      : await fetchLegacyBatch({
          db: params.db,
          gameId: params.gameId,
          readThrough: params.readThrough,
          keyset,
          filters: params.filters,
          batchSize: CANDIDATE_BATCH,
        });

    if (batch.length === 0) {
      exhausted = true;
      break;
    }

    for (const candidate of batch) {
      keyset = keysetAfter(candidate, params.isModern);

      // Capture v0: omit every system row (no trustworthy safe-kind discriminator).
      if (params.captureVersion < 1 && candidate.scope === "system") {
        continue;
      }

      const visibilityClass = classifyAuthorizedTranscriptRow(candidate, params.evidence);
      if (!visibilityClass) continue;

      if (!matchesPlayerFilter(candidate, params.filters.playerId)) continue;

      // Dimensional filters already applied in SQL where possible; double-check scope/phase/round/time.
      if (params.filters.scope && candidate.scope !== params.filters.scope) continue;
      if (params.filters.phase && candidate.phase !== params.filters.phase) continue;
      if (params.filters.round != null && candidate.round !== params.filters.round) continue;
      if (params.filters.fromTimestampMs != null && candidate.timestamp < params.filters.fromTimestampMs) {
        continue;
      }
      if (params.filters.toTimestampMs != null && candidate.timestamp > params.filters.toTimestampMs) {
        continue;
      }

      pageRows.push({ ...candidate, visibilityClass });
      if (pageRows.length >= params.limit + 1) break;
    }

    if (batch.length < CANDIDATE_BATCH) {
      // No more candidates in snapshot.
      if (pageRows.length <= params.limit) exhausted = true;
      break;
    }
  }

  const hasMore = pageRows.length > params.limit;
  if (hasMore) {
    pageRows.pop();
    exhausted = false;
  } else {
    exhausted = true;
  }

  const last = pageRows[pageRows.length - 1];
  const lastKeyset: MatchReadKeyset = last
    ? keysetAfter(last, params.isModern)
    : keyset;

  return { pageRows, exhausted, lastKeyset };
}

function keysetAfter(
  row: { id: number; entrySequence: number | null; timestamp: number },
  isModern: boolean,
): MatchReadKeyset {
  if (isModern) {
    return {
      afterEntrySequence: row.entrySequence,
      afterLegacyTimestamp: null,
      afterLegacyId: null,
    };
  }
  return {
    afterEntrySequence: null,
    afterLegacyTimestamp: row.timestamp,
    afterLegacyId: row.id,
  };
}

function matchesPlayerFilter(
  row: TranscriptCandidateRow,
  playerId: string | null,
): boolean {
  if (!playerId) return true;
  if (row.speakerPlayerId === playerId) return true;
  if (row.fromPlayerId === playerId) return true;
  // Name-valued legacy fromPlayerId is not equal to UUID; still allow when speaker matches.
  return false;
}

async function fetchModernBatch(params: {
  db: Pick<DrizzleDB, "select">;
  gameId: string;
  readThrough: MatchReadThroughBoundary;
  keyset: MatchReadKeyset;
  filters: MatchTranscriptNormalizedFilters;
  batchSize: number;
}): Promise<TranscriptCandidateRow[]> {
  const through = params.readThrough.throughEntrySequence ?? 0;
  const conditions: SQL[] = [
    eq(schema.transcripts.gameId, params.gameId),
    inArray(schema.transcripts.scope, [...DIALOGUE_SCOPES]),
    isNotNull(schema.transcripts.entrySequence),
    lte(schema.transcripts.entrySequence, through),
  ];

  if (params.keyset.afterEntrySequence != null) {
    conditions.push(gt(schema.transcripts.entrySequence, params.keyset.afterEntrySequence));
  }

  appendDimensionalSqlFilters(conditions, params.filters);

  const rows = await params.db
    .select({
      id: schema.transcripts.id,
      entrySequence: schema.transcripts.entrySequence,
      scope: schema.transcripts.scope,
      round: schema.transcripts.round,
      phase: schema.transcripts.phase,
      timestamp: schema.transcripts.timestamp,
      fromPlayerId: schema.transcripts.fromPlayerId,
      toPlayerIds: schema.transcripts.toPlayerIds,
      speakerPlayerId: schema.transcripts.speakerPlayerId,
      audiencePlayerIds: schema.transcripts.audiencePlayerIds,
      captureVersion: schema.transcripts.captureVersion,
      dialogueKind: schema.transcripts.dialogueKind,
      safeContext: schema.transcripts.safeContext,
      text: schema.transcripts.text,
    })
    .from(schema.transcripts)
    .where(and(...conditions))
    .orderBy(asc(schema.transcripts.entrySequence))
    .limit(params.batchSize);

  return rows;
}

async function fetchLegacyBatch(params: {
  db: Pick<DrizzleDB, "select">;
  gameId: string;
  readThrough: MatchReadThroughBoundary;
  keyset: MatchReadKeyset;
  filters: MatchTranscriptNormalizedFilters;
  batchSize: number;
}): Promise<TranscriptCandidateRow[]> {
  const throughTs = params.readThrough.throughLegacyTimestamp;
  const throughId = params.readThrough.throughLegacyId;
  if (throughTs == null || throughId == null) {
    return [];
  }

  const terminalBound = or(
    lt(schema.transcripts.timestamp, throughTs),
    and(
      eq(schema.transcripts.timestamp, throughTs),
      lte(schema.transcripts.id, throughId),
    ),
  );
  const conditions: SQL[] = [
    eq(schema.transcripts.gameId, params.gameId),
    inArray(schema.transcripts.scope, [...DIALOGUE_SCOPES]),
  ];
  if (terminalBound) {
    conditions.push(terminalBound);
  }

  if (params.keyset.afterLegacyTimestamp != null && params.keyset.afterLegacyId != null) {
    const afterKeyset = or(
      gt(schema.transcripts.timestamp, params.keyset.afterLegacyTimestamp),
      and(
        eq(schema.transcripts.timestamp, params.keyset.afterLegacyTimestamp),
        gt(schema.transcripts.id, params.keyset.afterLegacyId),
      ),
    );
    if (afterKeyset) {
      conditions.push(afterKeyset);
    }
  }

  appendDimensionalSqlFilters(conditions, params.filters);

  const rows = await params.db
    .select({
      id: schema.transcripts.id,
      entrySequence: schema.transcripts.entrySequence,
      scope: schema.transcripts.scope,
      round: schema.transcripts.round,
      phase: schema.transcripts.phase,
      timestamp: schema.transcripts.timestamp,
      fromPlayerId: schema.transcripts.fromPlayerId,
      toPlayerIds: schema.transcripts.toPlayerIds,
      speakerPlayerId: schema.transcripts.speakerPlayerId,
      audiencePlayerIds: schema.transcripts.audiencePlayerIds,
      captureVersion: schema.transcripts.captureVersion,
      dialogueKind: schema.transcripts.dialogueKind,
      safeContext: schema.transcripts.safeContext,
      text: schema.transcripts.text,
    })
    .from(schema.transcripts)
    .where(and(...conditions))
    .orderBy(asc(schema.transcripts.timestamp), asc(schema.transcripts.id))
    .limit(params.batchSize);

  return rows;
}

function appendDimensionalSqlFilters(
  conditions: SQL[],
  filters: MatchTranscriptNormalizedFilters,
): void {
  if (filters.phase) {
    conditions.push(eq(schema.transcripts.phase, filters.phase));
  }
  if (filters.round != null) {
    conditions.push(eq(schema.transcripts.round, filters.round));
  }
  if (filters.scope) {
    conditions.push(eq(schema.transcripts.scope, filters.scope));
  }
  if (filters.fromTimestampMs != null) {
    conditions.push(gte(schema.transcripts.timestamp, filters.fromTimestampMs));
  }
  if (filters.toTimestampMs != null) {
    conditions.push(lte(schema.transcripts.timestamp, filters.toTimestampMs));
  }
}

function parseScopeFilter(value: string | null): MatchTranscriptScopeFilter | null {
  if (value == null) return null;
  for (const scope of DIALOGUE_SCOPES) {
    if (scope === value) return scope;
  }
  return null;
}

async function loadLegacyTerminalBoundary(
  db: Pick<DrizzleDB, "select">,
  gameId: string,
): Promise<{ timestamp: number; id: number }> {
  const row = (await db
    .select({
      id: schema.transcripts.id,
      timestamp: schema.transcripts.timestamp,
    })
    .from(schema.transcripts)
    .where(and(
      eq(schema.transcripts.gameId, gameId),
      inArray(schema.transcripts.scope, [...DIALOGUE_SCOPES]),
    ))
    .orderBy(desc(schema.transcripts.timestamp), desc(schema.transcripts.id))
    .limit(1))[0];

  if (!row) {
    return { timestamp: 0, id: 0 };
  }
  return { timestamp: row.timestamp, id: row.id };
}

function limitationsForCapture(captureVersion: number): MatchTranscriptLimitation[] {
  if (captureVersion >= 1) return [];
  return [{
    code: "legacy_system_dialogue_unclassified",
    message:
      "Capture version 0 system dialogue has no trustworthy safe-kind discriminator and is omitted from the owner transcript.",
    scope: "capture_version",
  }];
}

function buildEmptyCatchupResult(params: {
  context: MatchAccessContext;
  appliedFilters: MatchTranscriptNormalizedFilters;
  readThrough: MatchTranscriptReadThroughDto;
  orderingQuality: TranscriptOrderingQuality;
  limitations: MatchTranscriptLimitation[];
  subjectUserId: string;
  filterFingerprint: string;
  cursorSecret?: string;
  nowMs: number;
  prevThrough: number;
}): MatchTranscriptPageOk {
  const nextCursor = issueMatchTranscriptCursor({
    subjectUserId: params.subjectUserId,
    gameId: params.context.gameId,
    filterFingerprint: params.filterFingerprint,
    ownershipFingerprint: params.context.ownershipFingerprint,
    captureVersion: params.context.transcriptCaptureVersion,
    mode: "catchup",
    readThrough: {
      throughEntrySequence: params.readThrough.throughEntrySequence,
      throughLegacyTimestamp: null,
      throughLegacyId: null,
    },
    keyset: {
      afterEntrySequence: params.prevThrough,
      afterLegacyTimestamp: null,
      afterLegacyId: null,
    },
    filters: {
      phase: params.appliedFilters.phase,
      round: params.appliedFilters.round,
      scope: params.appliedFilters.scope,
      playerId: params.appliedFilters.playerId,
      player: params.appliedFilters.player,
      fromTimestampMs: params.appliedFilters.fromTimestampMs,
      toTimestampMs: params.appliedFilters.toTimestampMs,
    },
    nowMs: params.nowMs,
  }, params.cursorSecret);

  return {
    ok: true,
    schemaVersion: 1,
    game: {
      id: params.context.gameId,
      slug: params.context.gameSlug,
      status: params.context.gameStatus,
      transcriptCaptureVersion: params.context.transcriptCaptureVersion,
    },
    orderingQuality: params.orderingQuality,
    readThrough: params.readThrough,
    filters: params.appliedFilters,
    entries: [],
    pageSize: 0,
    nextCursor,
    nextCursorKind: "catchup",
    limitations: params.limitations,
    contentTrust: UNTRUSTED_GAME_AUTHORED,
  };
}

// Silence unused import when TrustedHuddleSessionLoad is only used via inference.
export type { TrustedHuddleSessionLoad };
