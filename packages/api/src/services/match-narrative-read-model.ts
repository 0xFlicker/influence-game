/**
 * Dual-surface match narrative read model (U3).
 *
 * Composes authorized dialogue + thinking/strategy into grouped decision records
 * for two surfaces that share one pipeline:
 * - `producer` — full product dialogue + all player/juror thinking/strategy
 * - `subject_owner` — transcript visibility policy + owned cognition only
 *
 * Domain order is producer-first: ownership is a restriction on the same spine,
 * not the default. Protocol-neutral: no MCP tool names.
 */

import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { TranscriptSafeContext } from "../db/schema.js";
import { COGNITIVE_ARTIFACT_CAPTURE_VERSION } from "./cognitive-artifact-writer.js";
import {
  hasPrivateMatchLaneAccess,
  withMatchAccessSnapshot,
  type MatchAccessContext,
} from "./match-access-context.js";
import {
  groupNarrativeMembers,
  type NarrativeCognitionMemberInput,
  type NarrativeCorrelationSummary,
  type NarrativeDetail,
  type NarrativeDialogueMemberInput,
  type NarrativeGroup,
  type NarrativeGroupingLimitation,
  type NarrativeMemberInput,
  type NarrativePreset,
  NARRATIVE_CONTENT_TRUST,
} from "./match-narrative-grouping.js";
import {
  bindMatchNarrativeCursor,
  decodeMatchNarrativeCursor,
  fingerprintMatchNarrativeFilters,
  issueMatchNarrativeCursor,
  MATCH_NARRATIVE_PRODUCER_OWNERSHIP_FINGERPRINT,
  type MatchCognitionReadThroughBoundary,
  type MatchNarrativeCursorClaims,
  type MatchNarrativeCursorFilters,
  type MatchNarrativeDualReadThrough,
  type MatchNarrativeKeyset,
  type MatchNarrativeSurface,
  type MatchReadThroughBoundary,
} from "./match-read-cursor.js";
import { readGameTranscriptState } from "./game-transcript-persistence.js";
import { isCurrentTranscriptCapture } from "./transcript-capture.js";
import {
  classifyAuthorizedTranscriptRow,
  loadTrustedHuddleSessions,
  type TranscriptAuthorizationEvidence,
  type TranscriptVisibilityClass,
} from "./transcript-visibility-policy.js";
import { UNTRUSTED_GAME_AUTHORED } from "./transcript-serialization.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MATCH_NARRATIVE_DEFAULT_LIMIT = 25;
export const MATCH_NARRATIVE_MAX_LIMIT = 50;
export const MATCH_NARRATIVE_MAX_ID_CHARS = 128;
export const MATCH_NARRATIVE_MAX_CURSOR_CHARS = 4096;

const DIALOGUE_SCOPES = ["public", "system", "mingle", "whisper", "huddle"] as const;
const COGNITION_TYPES_STRATEGIC = ["strategy"] as const;
const COGNITION_TYPES_FULL = ["thinking", "strategy"] as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MatchNarrativeSurfaceCapability = MatchNarrativeSurface;

export interface MatchNarrativeNormalizedFilters {
  preset: NarrativePreset;
  detail: NarrativeDetail;
  playerId: string | null;
  player: string | null;
  phase: string | null;
  round: number | null;
  action: string | null;
  fromTimestampMs: number | null;
  toTimestampMs: number | null;
}

export interface MatchNarrativeAccessSummary {
  surface: MatchNarrativeSurface;
  /** Participating ownership when surface is subject_owner; always true for producer. */
  privateLaneAuthorized: boolean;
  ownedSeatCount: number | null;
}

export interface MatchNarrativeLimitation {
  code:
    | "includes_non_owned_public_dialogue"
    | "cognition_not_captured"
    | "legacy_system_dialogue_unclassified"
    | "inference_window_limited"
    | "correlation_actor_mismatch"
    | "oversized_member_truncated";
  message: string;
}

export interface MatchNarrativeReadThroughDto {
  transcript: {
    mode: "live_watermark" | "completed_terminal" | "legacy_terminal";
    throughEntrySequence: number | null;
    throughLegacyTimestamp: number | null;
    throughLegacyId: number | null;
  };
  cognition: {
    mode: "live_snapshot" | "completed_snapshot" | "empty";
    throughCreatedAt: string | null;
    throughId: string | null;
  };
}

export interface MatchNarrativePageOk {
  ok: true;
  schemaVersion: 1;
  game: {
    id: string;
    slug: string;
    status: string;
    transcriptCaptureVersion: number;
    cognitiveArtifactCaptureVersion: number;
  };
  surface: MatchNarrativeSurface;
  access: MatchNarrativeAccessSummary;
  preset: NarrativePreset;
  detail: NarrativeDetail;
  filters: MatchNarrativeNormalizedFilters;
  readThrough: MatchNarrativeReadThroughDto;
  correlationSummary: NarrativeCorrelationSummary;
  limitations: MatchNarrativeLimitation[];
  contentTrust: typeof NARRATIVE_CONTENT_TRUST;
  notBoardAuthority: true;
  groups: NarrativeGroup[];
  pageSize: number;
  nextCursor: string | null;
  nextCursorKind: "page" | null;
}

export type MatchNarrativePageError =
  | { ok: false; status: "not_accessible"; error: string }
  | { ok: false; status: "denied"; error: string }
  | { ok: false; status: "cursor_invalid_or_stale"; error: string }
  | { ok: false; status: "invalid_input"; error: string; field?: string }
  | { ok: false; status: "unavailable"; error: string };

export type MatchNarrativePageResult = MatchNarrativePageOk | MatchNarrativePageError;

/**
 * Closed input object. Unknown keys are rejected by the parser.
 * Surface is supplied by the caller (tool adapter), never by free-form client enum.
 */
export interface ReadMatchNarrativeInput {
  gameIdOrSlug: string;
  preset?: string;
  detail?: string;
  player?: string;
  phase?: string;
  round?: number;
  action?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  cursor?: string;
  limit?: number;
}

const KNOWN_INPUT_KEYS = new Set([
  "gameIdOrSlug",
  "preset",
  "detail",
  "player",
  "phase",
  "round",
  "action",
  "fromTimestamp",
  "toTimestamp",
  "cursor",
  "limit",
]);

export interface ReadMatchNarrativeOptions {
  /** Principal user id (owner subject or producer principal). */
  subjectUserId: string;
  surface: MatchNarrativeSurfaceCapability;
  cursorSecret?: string;
  nowMs?: number;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * Read one dual-surface narrative page. Producer path resolves any game;
 * owner path requires participating private-lane access.
 */
export async function readMatchNarrativePage(
  db: DrizzleDB,
  rawInput: unknown,
  options: ReadMatchNarrativeOptions,
): Promise<MatchNarrativePageResult> {
  const parsed = parseReadMatchNarrativeInput(rawInput);
  if (!parsed.ok) return parsed;

  const input = parsed.value;
  const nowMs = options.nowMs ?? Date.now();
  const surface = options.surface;

  let decodedCursor: MatchNarrativeCursorClaims | null = null;
  if (input.cursor != null) {
    const decoded = decodeMatchNarrativeCursor(input.cursor, {
      secretMaterial: options.cursorSecret,
      expectedSurface: surface,
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

  if (surface === "producer") {
    return readProducerNarrativePage(db, input, options, decodedCursor, nowMs);
  }
  return readOwnerNarrativePage(db, input, options, decodedCursor, nowMs);
}

// ---------------------------------------------------------------------------
// Producer surface (broad path first)
// ---------------------------------------------------------------------------

async function readProducerNarrativePage(
  db: DrizzleDB,
  input: ParsedNarrativeInput,
  options: ReadMatchNarrativeOptions,
  decodedCursor: MatchNarrativeCursorClaims | null,
  nowMs: number,
): Promise<MatchNarrativePageResult> {
  const game = await loadGameForProducer(db, input.gameIdOrSlug);
  if (!game) {
    return {
      ok: false,
      status: "not_accessible",
      error: "Game is not accessible",
    };
  }

  const roster = await loadRoster(db, game.id);
  const resolvePlayerId = makeResolvePlayerId(roster);
  const resolvePlayerName = makeResolvePlayerName(roster);

  let playerId: string | null = null;
  if (input.player != null) {
    playerId = resolvePlayerId(input.player);
    if (!playerId) {
      return {
        ok: false,
        status: "invalid_input",
        error: "player filter did not resolve to a unique roster player",
        field: "player",
      };
    }
  }

  const filters = buildFilters(input, playerId);
  const filterFingerprint = fingerprintMatchNarrativeFilters({
    preset: filters.preset,
    detail: filters.detail,
    playerId: filters.playerId,
    phase: filters.phase,
    round: filters.round,
    action: filters.action,
    fromTimestampMs: filters.fromTimestampMs,
    toTimestampMs: filters.toTimestampMs,
  });

  let appliedFilters: MatchNarrativeNormalizedFilters;
  let boundFilterFingerprint: string;
  let keyset: MatchNarrativeKeyset;
  let dualReadThrough: MatchNarrativeDualReadThrough;

  if (decodedCursor) {
    if (input.hasExplicitFilters && decodedCursor.filterFingerprint !== filterFingerprint) {
      return {
        ok: false,
        status: "cursor_invalid_or_stale",
        error: "Cursor is invalid or stale",
      };
    }
    boundFilterFingerprint = decodedCursor.filterFingerprint;
    if (!bindMatchNarrativeCursor({
      claims: decodedCursor,
      subjectUserId: options.subjectUserId,
      gameId: game.id,
      surface: "producer",
      ownershipFingerprint: MATCH_NARRATIVE_PRODUCER_OWNERSHIP_FINGERPRINT,
      filterFingerprint: boundFilterFingerprint,
      transcriptCaptureVersion: game.transcriptCaptureVersion,
      cognitiveCaptureVersion: game.cognitiveArtifactCaptureVersion,
    })) {
      return {
        ok: false,
        status: "cursor_invalid_or_stale",
        error: "Cursor is invalid or stale",
      };
    }
    appliedFilters = filtersFromSealed(decodedCursor.filters);
    dualReadThrough = decodedCursor.readThrough;
    keyset = { ...decodedCursor.keyset };
  } else {
    appliedFilters = filters;
    boundFilterFingerprint = filterFingerprint;
    const pins = await pinDualReadThrough(db, {
      gameId: game.id,
      gameStatus: game.status,
      transcriptCaptureVersion: game.transcriptCaptureVersion,
      cognitiveCaptureVersion: game.cognitiveArtifactCaptureVersion,
      surface: "producer",
      ownedPlayerIds: null,
      ownedAgentProfileIds: null,
      subjectUserId: options.subjectUserId,
      filters: appliedFilters,
    });
    if (!pins.ok) return pins;
    dualReadThrough = pins.readThrough;
    keyset = { afterSortKey: null, afterGroupId: null };
  }

  const isModern = isCurrentTranscriptCapture(game.transcriptCaptureVersion);
  if (!isModern && game.status !== "completed") {
    return {
      ok: false,
      status: "unavailable",
      error: "Legacy live transcript walk requires modern capture watermark",
    };
  }

  const dialogueRows = await loadProductDialogueRows(db, {
    gameId: game.id,
    isModern,
    readThrough: dualReadThrough.transcript,
    filters: appliedFilters,
    surface: "producer",
    ownedPlayerIds: new Set(),
    resolvePlayerId,
    captureVersion: game.transcriptCaptureVersion,
  });

  const cognitionRows = await loadCognitionRows(db, {
    gameId: game.id,
    surface: "producer",
    cognitiveCaptureVersion: game.cognitiveArtifactCaptureVersion,
    readThrough: dualReadThrough.cognition,
    filters: appliedFilters,
    ownedPlayerIds: null,
    ownedAgentProfileIds: null,
    subjectUserId: options.subjectUserId,
  });

  const members = mapMembers({
    dialogueRows,
    cognitionRows,
    resolvePlayerName,
  });

  return assembleNarrativePage({
    game,
    surface: "producer",
    access: {
      surface: "producer",
      privateLaneAuthorized: true,
      ownedSeatCount: null,
    },
    appliedFilters,
    boundFilterFingerprint,
    dualReadThrough,
    keyset,
    members,
    ownershipFingerprint: MATCH_NARRATIVE_PRODUCER_OWNERSHIP_FINGERPRINT,
    subjectUserId: options.subjectUserId,
    cursorSecret: options.cursorSecret,
    nowMs,
    limit: input.limit,
    transcriptCaptureVersion: game.transcriptCaptureVersion,
    cognitiveCaptureVersion: game.cognitiveArtifactCaptureVersion,
    ownedPlayerIds: null,
  });
}

// ---------------------------------------------------------------------------
// Owner surface (restricted predicates on same pipeline)
// ---------------------------------------------------------------------------

async function readOwnerNarrativePage(
  db: DrizzleDB,
  input: ParsedNarrativeInput,
  options: ReadMatchNarrativeOptions,
  decodedCursor: MatchNarrativeCursorClaims | null,
  nowMs: number,
): Promise<MatchNarrativePageResult> {
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
      if (!hasPrivateMatchLaneAccess(context)) {
        return {
          ok: false as const,
          status: "denied" as const,
          error: "Match narrative is not available for this subject",
        };
      }

      const cognitiveCaptureVersion = await loadCognitiveCaptureVersion(tx, context.gameId);
      if (cognitiveCaptureVersion === null) {
        return {
          ok: false as const,
          status: "not_accessible" as const,
          error: "Game is not accessible",
        };
      }

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
        // Non-owned player filter: non-enumerating empty success.
        if (!context.ownedPlayerIds.has(playerId)) {
          return emptyOwnerSuccess({
            context,
            cognitiveCaptureVersion,
            filters: buildFilters(input, null),
            playerEcho: input.player,
          });
        }
      }

      const filters = buildFilters(input, playerId);
      const filterFingerprint = fingerprintMatchNarrativeFilters({
        preset: filters.preset,
        detail: filters.detail,
        playerId: filters.playerId,
        phase: filters.phase,
        round: filters.round,
        action: filters.action,
        fromTimestampMs: filters.fromTimestampMs,
        toTimestampMs: filters.toTimestampMs,
      });

      let appliedFilters: MatchNarrativeNormalizedFilters;
      let boundFilterFingerprint: string;
      let keyset: MatchNarrativeKeyset;
      let dualReadThrough: MatchNarrativeDualReadThrough;

      if (decodedCursor) {
        if (input.hasExplicitFilters && decodedCursor.filterFingerprint !== filterFingerprint) {
          return {
            ok: false as const,
            status: "cursor_invalid_or_stale" as const,
            error: "Cursor is invalid or stale",
          };
        }
        boundFilterFingerprint = decodedCursor.filterFingerprint;
        if (!bindMatchNarrativeCursor({
          claims: decodedCursor,
          subjectUserId: options.subjectUserId,
          gameId: context.gameId,
          surface: "subject_owner",
          ownershipFingerprint: context.ownershipFingerprint,
          filterFingerprint: boundFilterFingerprint,
          transcriptCaptureVersion: context.transcriptCaptureVersion,
          cognitiveCaptureVersion,
        })) {
          return {
            ok: false as const,
            status: "cursor_invalid_or_stale" as const,
            error: "Cursor is invalid or stale",
          };
        }
        appliedFilters = filtersFromSealed(decodedCursor.filters);
        dualReadThrough = decodedCursor.readThrough;
        keyset = { ...decodedCursor.keyset };
      } else {
        appliedFilters = filters;
        boundFilterFingerprint = filterFingerprint;
        const pins = await pinDualReadThrough(tx, {
          gameId: context.gameId,
          gameStatus: context.gameStatus,
          transcriptCaptureVersion: context.transcriptCaptureVersion,
          cognitiveCaptureVersion,
          surface: "subject_owner",
          ownedPlayerIds: context.ownedPlayerIds,
          ownedAgentProfileIds: context.ownedAgentProfileIds,
          subjectUserId: options.subjectUserId,
          filters: appliedFilters,
        });
        if (!pins.ok) return pins;
        dualReadThrough = pins.readThrough;
        keyset = { afterSortKey: null, afterGroupId: null };
      }

      const isModern = isCurrentTranscriptCapture(context.transcriptCaptureVersion);
      if (!isModern && context.gameStatus !== "completed") {
        return {
          ok: false as const,
          status: "unavailable" as const,
          error: "Legacy live transcript walk requires modern capture watermark",
        };
      }

      const dialogueRows = await loadProductDialogueRows(tx, {
        gameId: context.gameId,
        isModern,
        readThrough: dualReadThrough.transcript,
        filters: appliedFilters,
        surface: "subject_owner",
        ownedPlayerIds: context.ownedPlayerIds,
        resolvePlayerId: (nameOrId) => context.resolvePlayerId(nameOrId),
        captureVersion: context.transcriptCaptureVersion,
      });

      const cognitionRows = await loadCognitionRows(tx, {
        gameId: context.gameId,
        surface: "subject_owner",
        cognitiveCaptureVersion,
        readThrough: dualReadThrough.cognition,
        filters: appliedFilters,
        ownedPlayerIds: context.ownedPlayerIds,
        ownedAgentProfileIds: context.ownedAgentProfileIds,
        subjectUserId: options.subjectUserId,
      });

      const members = mapMembers({
        dialogueRows,
        cognitionRows,
        resolvePlayerName: (id) => context.resolvePlayerName(id),
      });

      return assembleNarrativePage({
        game: {
          id: context.gameId,
          slug: context.gameSlug,
          status: context.gameStatus,
          transcriptCaptureVersion: context.transcriptCaptureVersion,
          cognitiveArtifactCaptureVersion: cognitiveCaptureVersion,
        },
        surface: "subject_owner",
        access: {
          surface: "subject_owner",
          privateLaneAuthorized: true,
          ownedSeatCount: context.ownedPlayerIds.size,
        },
        appliedFilters,
        boundFilterFingerprint,
        dualReadThrough,
        keyset,
        members,
        ownershipFingerprint: context.ownershipFingerprint,
        subjectUserId: options.subjectUserId,
        cursorSecret: options.cursorSecret,
        nowMs,
        limit: input.limit,
        transcriptCaptureVersion: context.transcriptCaptureVersion,
        cognitiveCaptureVersion,
        ownedPlayerIds: context.ownedPlayerIds,
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

function assembleNarrativePage(params: {
  game: {
    id: string;
    slug: string;
    status: string;
    transcriptCaptureVersion: number;
    cognitiveArtifactCaptureVersion: number;
  };
  surface: MatchNarrativeSurface;
  access: MatchNarrativeAccessSummary;
  appliedFilters: MatchNarrativeNormalizedFilters;
  boundFilterFingerprint: string;
  dualReadThrough: MatchNarrativeDualReadThrough;
  keyset: MatchNarrativeKeyset;
  members: NarrativeMemberInput[];
  ownershipFingerprint: string;
  subjectUserId: string;
  cursorSecret?: string;
  nowMs: number;
  limit: number;
  transcriptCaptureVersion: number;
  cognitiveCaptureVersion: number;
  ownedPlayerIds: ReadonlySet<string> | null;
}): MatchNarrativePageOk {
  const grouped = groupNarrativeMembers({
    members: params.members,
    preset: params.appliedFilters.preset,
    detail: params.appliedFilters.detail,
  });

  // Page by groups using exclusive (sortKey, stableMemberKey) keyset.
  // stableMemberKey is a join of member ids so tie-breaks stay lexicographically safe.
  let groups = grouped.groups;
  if (params.keyset.afterSortKey != null && params.keyset.afterGroupId != null) {
    const afterKey = params.keyset.afterSortKey;
    const afterStable = params.keyset.afterGroupId;
    groups = groups.filter((g) => {
      if (g.sortKey > afterKey) return true;
      if (g.sortKey < afterKey) return false;
      return groupStableKey(g) > afterStable;
    });
  }

  const hasMore = groups.length > params.limit;
  const pageGroups = groups.slice(0, params.limit);

  // Recompute page-local correlation summary from emitted groups only.
  const correlationSummary: NarrativeCorrelationSummary = {
    exact: pageGroups.filter((g) => g.correlation.kind === "decision_id").length,
    inferred: pageGroups.filter((g) => g.correlation.kind === "inferred").length,
    uncorrelated: pageGroups.filter((g) => g.correlation.kind === "uncorrelated").length,
  };

  const limitations = buildPageLimitations({
    surface: params.surface,
    ownedPlayerIds: params.ownedPlayerIds,
    members: params.members,
    cognitiveCaptureVersion: params.cognitiveCaptureVersion,
    transcriptCaptureVersion: params.transcriptCaptureVersion,
    groupingLimitations: grouped.limitations,
  });

  let nextCursor: string | null = null;
  let nextCursorKind: "page" | null = null;
  if (hasMore && pageGroups.length > 0) {
    const last = pageGroups[pageGroups.length - 1];
    if (last) {
      nextCursor = issueMatchNarrativeCursor({
        subjectUserId: params.subjectUserId,
        gameId: params.game.id,
        surface: params.surface,
        filterFingerprint: params.boundFilterFingerprint,
        ownershipFingerprint: params.ownershipFingerprint,
        transcriptCaptureVersion: params.transcriptCaptureVersion,
        cognitiveCaptureVersion: params.cognitiveCaptureVersion,
        mode: "snapshot",
        readThrough: params.dualReadThrough,
        keyset: {
          afterSortKey: last.sortKey,
          afterGroupId: groupStableKey(last),
        },
        filters: sealedFiltersFrom(params.appliedFilters),
        nowMs: params.nowMs,
      }, params.cursorSecret);
      nextCursorKind = "page";
    }
  }

  const isModern = isCurrentTranscriptCapture(params.transcriptCaptureVersion);
  const transcriptMode: MatchNarrativeReadThroughDto["transcript"]["mode"] = isModern
    ? (params.game.status === "completed" ? "completed_terminal" : "live_watermark")
    : "legacy_terminal";
  const cognitionMode: MatchNarrativeReadThroughDto["cognition"]["mode"] =
    params.dualReadThrough.cognition.throughCreatedAt == null
      ? "empty"
      : params.game.status === "completed"
        ? "completed_snapshot"
        : "live_snapshot";

  return {
    ok: true,
    schemaVersion: 1,
    game: params.game,
    surface: params.surface,
    access: params.access,
    preset: params.appliedFilters.preset,
    detail: params.appliedFilters.detail,
    filters: params.appliedFilters,
    readThrough: {
      transcript: {
        mode: transcriptMode,
        throughEntrySequence: params.dualReadThrough.transcript.throughEntrySequence,
        throughLegacyTimestamp: params.dualReadThrough.transcript.throughLegacyTimestamp,
        throughLegacyId: params.dualReadThrough.transcript.throughLegacyId,
      },
      cognition: {
        mode: cognitionMode,
        throughCreatedAt: params.dualReadThrough.cognition.throughCreatedAt,
        throughId: params.dualReadThrough.cognition.throughId,
      },
    },
    correlationSummary,
    limitations,
    contentTrust: UNTRUSTED_GAME_AUTHORED,
    notBoardAuthority: true,
    groups: pageGroups,
    pageSize: pageGroups.length,
    nextCursor,
    nextCursorKind,
  };
}

function emptyOwnerSuccess(params: {
  context: MatchAccessContext;
  cognitiveCaptureVersion: number;
  filters: MatchNarrativeNormalizedFilters;
  playerEcho: string;
}): MatchNarrativePageOk {
  return {
    ok: true,
    schemaVersion: 1,
    game: {
      id: params.context.gameId,
      slug: params.context.gameSlug,
      status: params.context.gameStatus,
      transcriptCaptureVersion: params.context.transcriptCaptureVersion,
      cognitiveArtifactCaptureVersion: params.cognitiveCaptureVersion,
    },
    surface: "subject_owner",
    access: {
      surface: "subject_owner",
      privateLaneAuthorized: true,
      ownedSeatCount: params.context.ownedPlayerIds.size,
    },
    preset: params.filters.preset,
    detail: params.filters.detail,
    filters: {
      ...params.filters,
      playerId: null,
      player: params.playerEcho,
    },
    readThrough: {
      transcript: {
        mode: params.context.gameStatus === "completed"
          ? "completed_terminal"
          : "live_watermark",
        throughEntrySequence: null,
        throughLegacyTimestamp: null,
        throughLegacyId: null,
      },
      cognition: {
        mode: "empty",
        throughCreatedAt: null,
        throughId: null,
      },
    },
    correlationSummary: { exact: 0, inferred: 0, uncorrelated: 0 },
    limitations: [],
    contentTrust: UNTRUSTED_GAME_AUTHORED,
    notBoardAuthority: true,
    groups: [],
    pageSize: 0,
    nextCursor: null,
    nextCursorKind: null,
  };
}

// ---------------------------------------------------------------------------
// Dual pin
// ---------------------------------------------------------------------------

async function pinDualReadThrough(
  db: Pick<DrizzleDB, "select">,
  params: {
    gameId: string;
    gameStatus: string;
    transcriptCaptureVersion: number;
    cognitiveCaptureVersion: number;
    surface: MatchNarrativeSurface;
    ownedPlayerIds: ReadonlySet<string> | null;
    ownedAgentProfileIds: ReadonlySet<string> | null;
    subjectUserId: string;
    filters: MatchNarrativeNormalizedFilters;
  },
): Promise<
  | { ok: true; readThrough: MatchNarrativeDualReadThrough }
  | MatchNarrativePageError
> {
  const isModern = isCurrentTranscriptCapture(params.transcriptCaptureVersion);
  let transcript: MatchReadThroughBoundary;

  if (isModern) {
    const state = await readGameTranscriptState(db, params.gameId);
    const watermark = state?.durableSequence ?? 0;
    transcript = {
      throughEntrySequence: watermark,
      throughLegacyTimestamp: null,
      throughLegacyId: null,
    };
  } else {
    const terminal = await loadLegacyTerminalBoundary(db, params.gameId);
    transcript = {
      throughEntrySequence: null,
      throughLegacyTimestamp: terminal.timestamp,
      throughLegacyId: terminal.id,
    };
  }

  let cognition: MatchCognitionReadThroughBoundary = {
    throughCreatedAt: null,
    throughId: null,
  };

  if (params.cognitiveCaptureVersion === COGNITIVE_ARTIFACT_CAPTURE_VERSION) {
    const newest = await loadNewestCognitionBoundary(db, {
      gameId: params.gameId,
      surface: params.surface,
      ownedPlayerIds: params.ownedPlayerIds,
      ownedAgentProfileIds: params.ownedAgentProfileIds,
      subjectUserId: params.subjectUserId,
      filters: params.filters,
    });
    if (newest) {
      cognition = {
        throughCreatedAt: newest.createdAt,
        throughId: newest.id,
      };
    }
  }

  return { ok: true, readThrough: { transcript, cognition } };
}

// ---------------------------------------------------------------------------
// Dialogue loaders
// ---------------------------------------------------------------------------

type DialogueCandidateRow = {
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
  visibilityClass: TranscriptVisibilityClass;
};

async function loadProductDialogueRows(
  db: Pick<DrizzleDB, "select">,
  params: {
    gameId: string;
    isModern: boolean;
    readThrough: MatchReadThroughBoundary;
    filters: MatchNarrativeNormalizedFilters;
    surface: MatchNarrativeSurface;
    ownedPlayerIds: ReadonlySet<string>;
    resolvePlayerId: (nameOrId: string) => string | null;
    captureVersion: number;
  },
): Promise<DialogueCandidateRow[]> {
  const conditions: SQL[] = [
    eq(schema.transcripts.gameId, params.gameId),
    inArray(schema.transcripts.scope, [...DIALOGUE_SCOPES]),
  ];

  if (params.isModern) {
    const through = params.readThrough.throughEntrySequence;
    if (through == null) return [];
    conditions.push(sql`${schema.transcripts.entrySequence} IS NOT NULL`);
    conditions.push(sql`${schema.transcripts.entrySequence} <= ${through}`);
  } else {
    const throughTs = params.readThrough.throughLegacyTimestamp;
    const throughId = params.readThrough.throughLegacyId;
    if (throughTs == null || throughId == null) return [];
    conditions.push(sql`(
      ${schema.transcripts.timestamp} < ${throughTs}
      OR (
        ${schema.transcripts.timestamp} = ${throughTs}
        AND ${schema.transcripts.id} <= ${throughId}
      )
    )`);
  }

  if (params.filters.phase != null) {
    conditions.push(eq(schema.transcripts.phase, params.filters.phase));
  }
  if (params.filters.round != null) {
    conditions.push(eq(schema.transcripts.round, params.filters.round));
  }
  if (params.filters.fromTimestampMs != null) {
    conditions.push(sql`${schema.transcripts.timestamp} >= ${params.filters.fromTimestampMs}`);
  }
  if (params.filters.toTimestampMs != null) {
    conditions.push(sql`${schema.transcripts.timestamp} <= ${params.filters.toTimestampMs}`);
  }

  const rawRows = await db
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
    .orderBy(
      asc(schema.transcripts.entrySequence),
      asc(schema.transcripts.timestamp),
      asc(schema.transcripts.id),
    );

  let evidence: TranscriptAuthorizationEvidence | null = null;
  if (params.surface === "subject_owner") {
    const trustedHuddleLoad = await loadTrustedHuddleSessions(db, params.gameId);
    evidence = {
      ownedPlayerIds: params.ownedPlayerIds,
      resolvePlayerId: params.resolvePlayerId,
      trustedHuddleSessions: trustedHuddleLoad.sessions,
      trustedPrefixHealthy: trustedHuddleLoad.trustedPrefixHealthy,
    };
  }

  const authorized: DialogueCandidateRow[] = [];
  for (const row of rawRows) {
    // Capture v0: omit every system row (no trustworthy safe-kind discriminator).
    if (params.captureVersion < 1 && row.scope === "system") {
      continue;
    }

    let visibilityClass: TranscriptVisibilityClass | null;
    if (params.surface === "producer") {
      visibilityClass = classifyProducerProductDialogueRow(row);
    } else {
      if (!evidence) continue;
      visibilityClass = classifyAuthorizedTranscriptRow(row, evidence);
    }
    if (!visibilityClass) continue;

    if (params.filters.playerId != null) {
      if (
        row.speakerPlayerId !== params.filters.playerId
        && row.fromPlayerId !== params.filters.playerId
      ) {
        continue;
      }
    }

    authorized.push({ ...row, visibilityClass });
  }

  return authorized;
}

/**
 * Producer product dialogue: all product scopes under capture-safe system rules,
 * without ownership membership filtering on mingle/whisper/huddle.
 */
function classifyProducerProductDialogueRow(row: {
  scope: string;
  captureVersion: number | null;
  dialogueKind: string | null;
}): TranscriptVisibilityClass | null {
  if (!(DIALOGUE_SCOPES as readonly string[]).includes(row.scope)) {
    return null;
  }
  if (row.scope === "public") return "public";
  if (row.scope === "system") {
    if (row.captureVersion == null || row.captureVersion < 1) return null;
    // Reuse viewer-safe kind check via classifyAuthorized with empty ownership —
    // system classification does not use ownership.
    return classifyAuthorizedTranscriptRow(
      {
        id: 0,
        entrySequence: null,
        scope: "system",
        round: 0,
        phase: "",
        timestamp: 0,
        fromPlayerId: null,
        toPlayerIds: null,
        speakerPlayerId: null,
        audiencePlayerIds: null,
        captureVersion: row.captureVersion,
        dialogueKind: row.dialogueKind,
        safeContext: null,
      },
      {
        ownedPlayerIds: new Set(),
        resolvePlayerId: () => null,
        trustedHuddleSessions: [],
        trustedPrefixHealthy: true,
      },
    );
  }
  if (row.scope === "mingle") return "mingle";
  if (row.scope === "whisper") return "whisper";
  if (row.scope === "huddle") return "huddle";
  return null;
}

// ---------------------------------------------------------------------------
// Cognition loaders
// ---------------------------------------------------------------------------

type CognitionCandidateRow = {
  id: string;
  artifactType: "thinking" | "strategy";
  actorPlayerId: string | null;
  actorName: string | null;
  action: string;
  phase: string | null;
  round: number | null;
  eventSequence: number | null;
  decisionId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

async function loadCognitionRows(
  db: Pick<DrizzleDB, "select">,
  params: {
    gameId: string;
    surface: MatchNarrativeSurface;
    cognitiveCaptureVersion: number;
    readThrough: MatchCognitionReadThroughBoundary;
    filters: MatchNarrativeNormalizedFilters;
    ownedPlayerIds: ReadonlySet<string> | null;
    ownedAgentProfileIds: ReadonlySet<string> | null;
    subjectUserId: string;
  },
): Promise<CognitionCandidateRow[]> {
  if (params.filters.preset === "dialogue_only") {
    return [];
  }
  if (params.cognitiveCaptureVersion !== COGNITIVE_ARTIFACT_CAPTURE_VERSION) {
    return [];
  }
  if (params.readThrough.throughCreatedAt == null || params.readThrough.throughId == null) {
    return [];
  }

  const types = params.filters.preset === "strategic"
    ? [...COGNITION_TYPES_STRATEGIC]
    : [...COGNITION_TYPES_FULL];

  const conditions: SQL[] = [
    eq(schema.gameCognitiveArtifacts.gameId, params.gameId),
    eq(schema.gameCognitiveArtifacts.redactionStatus, "active"),
    eq(schema.gameCognitiveArtifacts.visibilityStatus, "active"),
    inArray(schema.gameCognitiveArtifacts.artifactType, types),
    inArray(schema.gameCognitiveArtifacts.actorRole, ["player", "juror"]),
  ];

  // Ownership-before-limit for subject_owner.
  if (params.surface === "subject_owner") {
    const ownedPlayerIds = [...(params.ownedPlayerIds ?? [])];
    const ownedAgentProfileIds = [...(params.ownedAgentProfileIds ?? [])];
    const ownershipClauses: SQL[] = [
      eq(schema.gameCognitiveArtifacts.actorUserId, params.subjectUserId),
    ];
    if (ownedPlayerIds.length > 0) {
      ownershipClauses.push(
        inArray(schema.gameCognitiveArtifacts.actorPlayerId, ownedPlayerIds),
      );
    }
    if (ownedAgentProfileIds.length > 0) {
      ownershipClauses.push(
        inArray(schema.gameCognitiveArtifacts.actorAgentProfileId, ownedAgentProfileIds),
      );
    }
    const ownershipOr = or(...ownershipClauses);
    if (ownershipOr) conditions.push(ownershipOr);
  }

  // Upper pin
  const throughAt = params.readThrough.throughCreatedAt;
  const throughId = params.readThrough.throughId;
  conditions.push(sql`(
    ${schema.gameCognitiveArtifacts.createdAt} < ${throughAt}
    OR (
      ${schema.gameCognitiveArtifacts.createdAt} = ${throughAt}
      AND ${schema.gameCognitiveArtifacts.id} <= ${throughId}
    )
  )`);

  if (params.filters.phase != null) {
    conditions.push(eq(schema.gameCognitiveArtifacts.phase, params.filters.phase));
  }
  if (params.filters.round != null) {
    conditions.push(eq(schema.gameCognitiveArtifacts.round, params.filters.round));
  }
  if (params.filters.action != null) {
    conditions.push(eq(schema.gameCognitiveArtifacts.action, params.filters.action));
  }
  if (params.filters.playerId != null) {
    conditions.push(
      eq(schema.gameCognitiveArtifacts.actorPlayerId, params.filters.playerId),
    );
  }

  // Action filter applies to cognition; for dialogue_only we already returned.
  // Time range on cognition uses createdAt ms comparison loosely via ISO strings
  // when provided (optional — group sort uses createdAtMs).
  if (params.filters.fromTimestampMs != null) {
    const fromIso = new Date(params.filters.fromTimestampMs).toISOString();
    conditions.push(sql`${schema.gameCognitiveArtifacts.createdAt} >= ${fromIso}`);
  }
  if (params.filters.toTimestampMs != null) {
    const toIso = new Date(params.filters.toTimestampMs).toISOString();
    conditions.push(sql`${schema.gameCognitiveArtifacts.createdAt} <= ${toIso}`);
  }

  const rawRows = await db
    .select({
      id: schema.gameCognitiveArtifacts.id,
      artifactType: schema.gameCognitiveArtifacts.artifactType,
      actorPlayerId: schema.gameCognitiveArtifacts.actorPlayerId,
      action: schema.gameCognitiveArtifacts.action,
      phase: schema.gameCognitiveArtifacts.phase,
      round: schema.gameCognitiveArtifacts.round,
      eventSequence: schema.gameCognitiveArtifacts.eventSequence,
      decisionId: schema.gameCognitiveArtifacts.decisionId,
      payload: schema.gameCognitiveArtifacts.payload,
      createdAt: schema.gameCognitiveArtifacts.createdAt,
    })
    .from(schema.gameCognitiveArtifacts)
    .where(and(...conditions))
    .orderBy(
      asc(schema.gameCognitiveArtifacts.createdAt),
      asc(schema.gameCognitiveArtifacts.id),
    );

  return rawRows
    .filter((row) => row.artifactType === "thinking" || row.artifactType === "strategy")
    .map((row) => ({
      id: row.id,
      artifactType: row.artifactType === "strategy" ? "strategy" as const : "thinking" as const,
      actorPlayerId: row.actorPlayerId,
      actorName: null,
      action: row.action,
      phase: row.phase,
      round: row.round,
      eventSequence: row.eventSequence,
      decisionId: row.decisionId,
      payload: row.payload,
      createdAt: row.createdAt,
    }));
}

async function loadNewestCognitionBoundary(
  db: Pick<DrizzleDB, "select">,
  params: {
    gameId: string;
    surface: MatchNarrativeSurface;
    ownedPlayerIds: ReadonlySet<string> | null;
    ownedAgentProfileIds: ReadonlySet<string> | null;
    subjectUserId: string;
    filters: MatchNarrativeNormalizedFilters;
  },
): Promise<{ createdAt: string; id: string } | null> {
  if (params.filters.preset === "dialogue_only") {
    return null;
  }

  const types = params.filters.preset === "strategic"
    ? [...COGNITION_TYPES_STRATEGIC]
    : [...COGNITION_TYPES_FULL];

  const conditions: SQL[] = [
    eq(schema.gameCognitiveArtifacts.gameId, params.gameId),
    eq(schema.gameCognitiveArtifacts.redactionStatus, "active"),
    eq(schema.gameCognitiveArtifacts.visibilityStatus, "active"),
    inArray(schema.gameCognitiveArtifacts.artifactType, types),
    inArray(schema.gameCognitiveArtifacts.actorRole, ["player", "juror"]),
  ];

  if (params.surface === "subject_owner") {
    const ownedPlayerIds = [...(params.ownedPlayerIds ?? [])];
    const ownedAgentProfileIds = [...(params.ownedAgentProfileIds ?? [])];
    const ownershipClauses: SQL[] = [
      eq(schema.gameCognitiveArtifacts.actorUserId, params.subjectUserId),
    ];
    if (ownedPlayerIds.length > 0) {
      ownershipClauses.push(
        inArray(schema.gameCognitiveArtifacts.actorPlayerId, ownedPlayerIds),
      );
    }
    if (ownedAgentProfileIds.length > 0) {
      ownershipClauses.push(
        inArray(schema.gameCognitiveArtifacts.actorAgentProfileId, ownedAgentProfileIds),
      );
    }
    const ownershipOr = or(...ownershipClauses);
    if (ownershipOr) conditions.push(ownershipOr);
  }

  if (params.filters.phase != null) {
    conditions.push(eq(schema.gameCognitiveArtifacts.phase, params.filters.phase));
  }
  if (params.filters.round != null) {
    conditions.push(eq(schema.gameCognitiveArtifacts.round, params.filters.round));
  }
  if (params.filters.action != null) {
    conditions.push(eq(schema.gameCognitiveArtifacts.action, params.filters.action));
  }
  if (params.filters.playerId != null) {
    conditions.push(
      eq(schema.gameCognitiveArtifacts.actorPlayerId, params.filters.playerId),
    );
  }

  const row = (await db
    .select({
      id: schema.gameCognitiveArtifacts.id,
      createdAt: schema.gameCognitiveArtifacts.createdAt,
    })
    .from(schema.gameCognitiveArtifacts)
    .where(and(...conditions))
    .orderBy(
      desc(schema.gameCognitiveArtifacts.createdAt),
      desc(schema.gameCognitiveArtifacts.id),
    )
    .limit(1))[0];

  return row ?? null;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapMembers(params: {
  dialogueRows: DialogueCandidateRow[];
  cognitionRows: CognitionCandidateRow[];
  resolvePlayerName: (playerId: string) => string | null;
}): NarrativeMemberInput[] {
  const dialogue: NarrativeDialogueMemberInput[] = params.dialogueRows.map((row) => {
    const actorPlayerId = row.speakerPlayerId
      ?? (row.fromPlayerId
        && row.fromPlayerId !== "SYSTEM"
        && row.fromPlayerId !== "House"
        ? row.fromPlayerId
        : null);
    const decisionId = extractDialogueDecisionId(row.safeContext);
    return {
      kind: "dialogue" as const,
      rowId: row.id,
      entrySequence: row.entrySequence,
      timestampMs: row.timestamp,
      actorPlayerId: actorPlayerId && looksLikeUuid(actorPlayerId) ? actorPlayerId : actorPlayerId,
      actorName: actorPlayerId
        ? (params.resolvePlayerName(actorPlayerId)
          ?? (looksLikeUuid(actorPlayerId) ? null : actorPlayerId))
        : null,
      phase: row.phase,
      round: row.round,
      scope: row.scope,
      dialogueKind: row.dialogueKind,
      text: row.text,
      decisionId,
      eventSequence: null,
      visibility: row.visibilityClass,
    };
  });

  const cognition: NarrativeCognitionMemberInput[] = params.cognitionRows.map((row) => {
    const createdAtMs = Date.parse(row.createdAt);
    return {
      kind: row.artifactType,
      artifactId: row.id,
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
      actorPlayerId: row.actorPlayerId,
      actorName: row.actorPlayerId
        ? params.resolvePlayerName(row.actorPlayerId)
        : null,
      phase: row.phase,
      round: row.round,
      action: row.action,
      decisionId: row.decisionId,
      eventSequence: row.eventSequence,
      prose: extractCognitionProse(row.artifactType, row.payload),
    };
  });

  return [...dialogue, ...cognition];
}

function extractDialogueDecisionId(safeContext: TranscriptSafeContext | null): string | null {
  if (!safeContext || safeContext.version !== 1) return null;
  if (typeof safeContext.decisionId === "string" && safeContext.decisionId.length > 0) {
    return safeContext.decisionId;
  }
  return null;
}

function extractCognitionProse(
  artifactType: "thinking" | "strategy",
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (artifactType === "thinking") {
    return {
      thinking: typeof payload.thinking === "string" ? payload.thinking : "",
    };
  }
  const prose: Record<string, unknown> = {};
  for (const key of [
    "decisionLog",
    "strategicLens",
    "strategicLensRationale",
    "strategyPacketRevision",
    "strategyPacketUpdate",
    "strategyPacketSummary",
    "strategicReflectionSummary",
  ] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      prose[key] = value;
    }
  }
  return prose;
}

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

function buildPageLimitations(params: {
  surface: MatchNarrativeSurface;
  ownedPlayerIds: ReadonlySet<string> | null;
  members: NarrativeMemberInput[];
  cognitiveCaptureVersion: number;
  transcriptCaptureVersion: number;
  groupingLimitations: readonly NarrativeGroupingLimitation[];
}): MatchNarrativeLimitation[] {
  const limitations: MatchNarrativeLimitation[] = [];

  if (params.transcriptCaptureVersion < 1) {
    limitations.push({
      code: "legacy_system_dialogue_unclassified",
      message:
        "Capture version 0 omits unclassifiable system dialogue; no trustworthy kind discriminator.",
    });
  }

  if (params.cognitiveCaptureVersion !== COGNITIVE_ARTIFACT_CAPTURE_VERSION) {
    limitations.push({
      code: "cognition_not_captured",
      message:
        "Cognitive artifacts were not captured for this game. Narrative continues with dialogue only.",
    });
  }

  const ownedPlayerIds = params.ownedPlayerIds;
  if (params.surface === "subject_owner" && ownedPlayerIds) {
    const hasNonOwnedPublic = params.members.some((m) => {
      if (m.kind !== "dialogue") return false;
      if (m.scope !== "public") return false;
      if (!m.actorPlayerId) return false;
      return !ownedPlayerIds.has(m.actorPlayerId);
    });
    if (hasNonOwnedPublic) {
      limitations.push({
        code: "includes_non_owned_public_dialogue",
        message:
          "Authorized public dialogue may include non-owned seats; cognition members remain owned-only.",
      });
    }
  }

  for (const gl of params.groupingLimitations) {
    limitations.push({
      code: gl.code,
      message: gl.message,
    });
  }

  return limitations;
}

// ---------------------------------------------------------------------------
// Game / roster helpers
// ---------------------------------------------------------------------------

async function loadGameForProducer(
  db: Pick<DrizzleDB, "select">,
  gameIdOrSlug: string,
): Promise<{
  id: string;
  slug: string;
  status: string;
  transcriptCaptureVersion: number;
  cognitiveArtifactCaptureVersion: number;
} | null> {
  const row = (await db
    .select({
      id: schema.games.id,
      slug: schema.games.slug,
      status: schema.games.status,
      transcriptCaptureVersion: schema.games.transcriptCaptureVersion,
      cognitiveArtifactCaptureVersion: schema.games.cognitiveArtifactCaptureVersion,
    })
    .from(schema.games)
    .where(or(eq(schema.games.id, gameIdOrSlug), eq(schema.games.slug, gameIdOrSlug)))
    .limit(1))[0];
  return row ?? null;
}

type RosterPlayer = { id: string; name: string };

async function loadRoster(
  db: Pick<DrizzleDB, "select">,
  gameId: string,
): Promise<RosterPlayer[]> {
  const rows = await db
    .select({
      id: schema.gamePlayers.id,
      persona: schema.gamePlayers.persona,
    })
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, gameId));

  return rows.map((row) => ({
    id: row.id,
    name: personaDisplayName(row.persona, row.id),
  }));
}

function personaDisplayName(persona: string | null, fallbackId: string): string {
  if (!persona) return fallbackId;
  try {
    const parsed: unknown = JSON.parse(persona);
    if (
      parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && typeof (parsed as { name?: unknown }).name === "string"
    ) {
      const name = (parsed as { name: string }).name.trim();
      if (name.length > 0) return name;
    }
  } catch {
    // fall through
  }
  return fallbackId;
}

function makeResolvePlayerId(roster: readonly RosterPlayer[]): (token: string) => string | null {
  const idSet = new Set(roster.map((p) => p.id));
  const nameToIds = new Map<string, string[]>();
  for (const p of roster) {
    const key = p.name.trim().toLowerCase();
    const list = nameToIds.get(key) ?? [];
    list.push(p.id);
    nameToIds.set(key, list);
  }
  return (token: string): string | null => {
    if (!token) return null;
    if (idSet.has(token)) return token;
    const matches = nameToIds.get(token.trim().toLowerCase());
    if (!matches || matches.length !== 1) return null;
    return matches[0] ?? null;
  };
}

function makeResolvePlayerName(
  roster: readonly RosterPlayer[],
): (playerId: string) => string | null {
  const map = new Map(roster.map((p) => [p.id, p.name]));
  return (playerId: string) => map.get(playerId) ?? null;
}

async function loadCognitiveCaptureVersion(
  db: Pick<DrizzleDB, "select">,
  gameId: string,
): Promise<number | null> {
  const row = (await db
    .select({
      cognitiveArtifactCaptureVersion: schema.games.cognitiveArtifactCaptureVersion,
    })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1))[0];
  return row?.cognitiveArtifactCaptureVersion ?? null;
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
  return row ?? { timestamp: 0, id: 0 };
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

type ParsedNarrativeInput = {
  gameIdOrSlug: string;
  preset: NarrativePreset;
  detail: NarrativeDetail;
  player: string | null;
  phase: string | null;
  round: number | null;
  action: string | null;
  fromTimestampMs: number | null;
  toTimestampMs: number | null;
  cursor: string | null;
  limit: number;
  hasExplicitFilters: boolean;
};

function parseReadMatchNarrativeInput(
  raw: unknown,
): { ok: true; value: ParsedNarrativeInput } | MatchNarrativePageError {
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
  if (record.gameIdOrSlug.length > MATCH_NARRATIVE_MAX_ID_CHARS) {
    return {
      ok: false,
      status: "invalid_input",
      error: "gameIdOrSlug exceeds maximum length",
      field: "gameIdOrSlug",
    };
  }

  let preset: NarrativePreset = "strategic";
  if (record.preset !== undefined) {
    if (
      record.preset !== "strategic"
      && record.preset !== "dialogue_only"
      && record.preset !== "full_cognition"
    ) {
      return {
        ok: false,
        status: "invalid_input",
        error: "preset must be strategic|dialogue_only|full_cognition",
        field: "preset",
      };
    }
    preset = record.preset;
  }

  let detail: NarrativeDetail = "compact";
  if (record.detail !== undefined) {
    if (record.detail !== "compact" && record.detail !== "full") {
      return {
        ok: false,
        status: "invalid_input",
        error: "detail must be compact|full",
        field: "detail",
      };
    }
    detail = record.detail;
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
    if (record.player.length > MATCH_NARRATIVE_MAX_ID_CHARS) {
      return {
        ok: false,
        status: "invalid_input",
        error: "player exceeds maximum length",
        field: "player",
      };
    }
    player = record.player;
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

  let action: string | null = null;
  if (record.action !== undefined) {
    if (typeof record.action !== "string" || record.action.length === 0) {
      return {
        ok: false,
        status: "invalid_input",
        error: "action must be a non-empty string",
        field: "action",
      };
    }
    if (record.action.length > MATCH_NARRATIVE_MAX_ID_CHARS) {
      return {
        ok: false,
        status: "invalid_input",
        error: "action exceeds maximum length",
        field: "action",
      };
    }
    action = record.action;
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
    if (record.cursor.length > MATCH_NARRATIVE_MAX_CURSOR_CHARS) {
      return {
        ok: false,
        status: "invalid_input",
        error: "cursor exceeds maximum length",
        field: "cursor",
      };
    }
    cursor = record.cursor;
  }

  let limit = MATCH_NARRATIVE_DEFAULT_LIMIT;
  if (record.limit !== undefined) {
    if (
      typeof record.limit !== "number"
      || !Number.isInteger(record.limit)
      || record.limit < 1
      || record.limit > MATCH_NARRATIVE_MAX_LIMIT
    ) {
      return {
        ok: false,
        status: "invalid_input",
        error: `limit must be an integer from 1 to ${MATCH_NARRATIVE_MAX_LIMIT}`,
        field: "limit",
      };
    }
    limit = record.limit;
  }

  const hasExplicitFilters = player != null
    || phase != null
    || round != null
    || action != null
    || fromTimestampMs != null
    || toTimestampMs != null
    || record.preset !== undefined
    || record.detail !== undefined;

  return {
    ok: true,
    value: {
      gameIdOrSlug: record.gameIdOrSlug.trim(),
      preset,
      detail,
      player,
      phase,
      round,
      action,
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
): { ok: true; ms: number } | MatchNarrativePageError {
  if (typeof value !== "string" || value.length === 0 || value.length > 40) {
    return {
      ok: false,
      status: "invalid_input",
      error: `${field} must be an RFC3339 timestamp`,
      field,
    };
  }
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

function buildFilters(
  input: ParsedNarrativeInput,
  playerId: string | null,
): MatchNarrativeNormalizedFilters {
  return {
    preset: input.preset,
    detail: input.detail,
    playerId,
    player: input.player,
    phase: input.phase,
    round: input.round,
    action: input.action,
    fromTimestampMs: input.fromTimestampMs,
    toTimestampMs: input.toTimestampMs,
  };
}

function filtersFromSealed(
  sealed: MatchNarrativeCursorFilters,
): MatchNarrativeNormalizedFilters {
  return {
    preset: sealed.preset,
    detail: sealed.detail,
    playerId: sealed.playerId,
    player: sealed.player,
    phase: sealed.phase,
    round: sealed.round,
    action: sealed.action,
    fromTimestampMs: sealed.fromTimestampMs,
    toTimestampMs: sealed.toTimestampMs,
  };
}

function sealedFiltersFrom(
  filters: MatchNarrativeNormalizedFilters,
): MatchNarrativeCursorFilters {
  return {
    preset: filters.preset,
    detail: filters.detail,
    playerId: filters.playerId,
    player: filters.player,
    phase: filters.phase,
    round: filters.round,
    action: filters.action,
    fromTimestampMs: filters.fromTimestampMs,
    toTimestampMs: filters.toTimestampMs,
  };
}

/** Stable secondary key for group keyset (member ids, not renumbered groupId). */
function groupStableKey(group: NarrativeGroup): string {
  const ids = group.members.map((m) => m.id).sort();
  if (ids.length === 0) return group.groupId;
  return ids.join("|");
}
