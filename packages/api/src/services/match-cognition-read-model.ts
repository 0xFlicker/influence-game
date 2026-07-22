/**
 * Owner-authorized match cognition timeline (U5).
 *
 * Bounded, filterable pages over first-class thinking/strategy artifacts for
 * owned players only. Ownership is applied in SQL before sort/limit so non-owned
 * rows cannot exhaust a scan window. Cursors reuse the U4 AES-GCM codec with
 * purpose `match_cognition`.
 *
 * Reasoning remains on the dedicated cognitive-artifact path. No transcript
 * thinking, reasoningContext, or private-trace fallbacks.
 *
 * Protocol-neutral: MCP tool registration is U8.
 */

import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { CognitiveArtifactType } from "../db/schema.js";
import {
  isSubjectOwnerTimelineArtifactType,
  type SubjectOwnerTimelineArtifactType,
} from "./cognitive-artifact-policy.js";
import { COGNITIVE_ARTIFACT_CAPTURE_VERSION } from "./cognitive-artifact-writer.js";
import {
  withMatchAccessSnapshot,
  hasPrivateMatchLaneAccess,
  type MatchAccessContext,
} from "./match-access-context.js";
import {
  bindMatchCognitionCursor,
  decodeMatchCognitionCursor,
  fingerprintMatchCognitionFilters,
  issueMatchCognitionCursor,
  type MatchCognitionCursorClaims,
  type MatchCognitionCursorMode,
  type MatchCognitionKeyset,
  type MatchCognitionReadThroughBoundary,
} from "./match-read-cursor.js";
import { UNTRUSTED_GAME_AUTHORED } from "./transcript-serialization.js";

/** Default authorized page size. */
export const MATCH_COGNITION_DEFAULT_LIMIT = 50;
/** Server-enforced maximum page size. */
export const MATCH_COGNITION_MAX_LIMIT = 100;
/** Maximum accepted game id/slug / player / action token length. */
export const MATCH_COGNITION_MAX_ID_CHARS = 128;
/** Maximum accepted cursor token length (codec also enforces). */
export const MATCH_COGNITION_MAX_CURSOR_CHARS = 4096;

export const COGNITION_AUTHORITY_LANE = "cognition" as const;

export type MatchCognitionOrderingQuality = "created_at_id";

export interface MatchCognitionNormalizedFilters {
  artifactType: SubjectOwnerTimelineArtifactType | null;
  actorPlayerId: string | null;
  /** Original player filter token for echo (never ownership list). */
  player: string | null;
  phase: string | null;
  round: number | null;
  action: string | null;
}

export interface MatchCognitionActorDto {
  playerId: string | null;
  name: string | null;
  agentProfileId: string | null;
}

/** Allowlisted thinking prose — structurally separate from filters/cursors. */
export interface MatchCognitionThinkingProse {
  thinking: string;
  contentTrust: typeof UNTRUSTED_GAME_AUTHORED;
}

/** Allowlisted strategy prose fields — never raw payload dump. */
export interface MatchCognitionStrategyProse {
  contentTrust: typeof UNTRUSTED_GAME_AUTHORED;
  decisionLog?: string;
  strategicLens?: string;
  strategicLensRationale?: string;
  strategyPacketRevision?: string;
  strategyPacketUpdate?: string;
  strategyPacketSummary?: string;
  strategicReflectionSummary?: string;
}

/**
 * Allowlisted owned cognition timeline entry.
 * Built by construction; never by stripping a raw row.
 */
export interface MatchCognitionEntryDto {
  authority: typeof COGNITION_AUTHORITY_LANE;
  id: string;
  artifactType: SubjectOwnerTimelineArtifactType;
  actor: MatchCognitionActorDto;
  action: string;
  phase: string | null;
  round: number | null;
  eventSequence: number | null;
  createdAt: string;
  orderingQuality: MatchCognitionOrderingQuality;
  /** Thinking prose when artifactType is thinking; omitted otherwise. */
  thinkingProse?: MatchCognitionThinkingProse;
  /** Strategy prose when artifactType is strategy; omitted otherwise. */
  strategyProse?: MatchCognitionStrategyProse;
}

export interface MatchCognitionReadThroughDto {
  mode: "live_snapshot" | "completed_snapshot";
  throughCreatedAt: string | null;
  throughId: string | null;
}

export interface MatchCognitionPageOk {
  ok: true;
  schemaVersion: 1;
  game: {
    id: string;
    slug: string;
    status: string;
    cognitiveArtifactCaptureVersion: number;
  };
  orderingQuality: MatchCognitionOrderingQuality;
  readThrough: MatchCognitionReadThroughDto;
  filters: MatchCognitionNormalizedFilters;
  entries: MatchCognitionEntryDto[];
  pageSize: number;
  nextCursor: string | null;
  nextCursorKind: "page" | "catchup" | null;
  /** Cognition lane never alters transcript completeness. */
  contentTrust: typeof UNTRUSTED_GAME_AUTHORED;
}

export type MatchCognitionPageError =
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
      status: "not_captured_for_game";
      error: string;
    }
  | {
      ok: false;
      status: "unavailable";
      error: string;
    };

export type MatchCognitionPageResult = MatchCognitionPageOk | MatchCognitionPageError;

/**
 * Closed input object. Unknown keys are rejected by the parser.
 */
export interface ReadMatchCognitionInput {
  gameIdOrSlug: string;
  artifactType?: string;
  player?: string;
  phase?: string;
  round?: number;
  action?: string;
  cursor?: string;
  limit?: number;
}

const KNOWN_INPUT_KEYS = new Set([
  "gameIdOrSlug",
  "artifactType",
  "player",
  "phase",
  "round",
  "action",
  "cursor",
  "limit",
]);

export interface ReadMatchCognitionOptions {
  subjectUserId: string;
  /** Optional secret override for tests. */
  cursorSecret?: string;
  nowMs?: number;
}

type CognitionCandidateRow = {
  id: string;
  artifactType: string;
  actorRole: string;
  actorPlayerId: string | null;
  actorUserId: string | null;
  actorAgentProfileId: string | null;
  action: string;
  phase: string | null;
  round: number | null;
  eventSequence: number | null;
  payload: Record<string, unknown>;
  visibilityStatus: string;
  redactionStatus: string;
  createdAt: string;
};

/**
 * Read one owned thinking/strategy timeline page for a participating owner.
 * Rebuilds MatchAccessContext and reauthorizes every page inside one snapshot.
 */
export async function readMatchCognitionPage(
  db: DrizzleDB,
  rawInput: unknown,
  options: ReadMatchCognitionOptions,
): Promise<MatchCognitionPageResult> {
  const parsed = parseReadMatchCognitionInput(rawInput);
  if (!parsed.ok) return parsed;

  const input = parsed.value;
  const nowMs = options.nowMs ?? Date.now();

  let decodedCursor: MatchCognitionCursorClaims | null = null;
  if (input.cursor != null) {
    const decoded = decodeMatchCognitionCursor(input.cursor, {
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
      if (!hasPrivateMatchLaneAccess(context)) {
        return {
          ok: false as const,
          status: "denied" as const,
          error: "Match cognition is not available for this subject",
        };
      }

      const captureVersion = await loadCognitiveCaptureVersion(tx, context.gameId);
      if (captureVersion === null) {
        return {
          ok: false as const,
          status: "not_accessible" as const,
          error: "Game is not accessible",
        };
      }
      if (captureVersion !== COGNITIVE_ARTIFACT_CAPTURE_VERSION) {
        return {
          ok: false as const,
          status: "not_captured_for_game" as const,
          error: "Cognitive artifacts were not captured for this game",
        };
      }

      // Resolve optional player filter against roster (ambiguous → invalid_input).
      let actorPlayerId: string | null = null;
      if (input.player != null) {
        actorPlayerId = context.resolvePlayerId(input.player);
        if (!actorPlayerId) {
          return {
            ok: false as const,
            status: "invalid_input" as const,
            error: "player filter did not resolve to a unique roster player",
            field: "player",
          };
        }
        // Non-owned player filter: non-enumerating empty page (no error shape
        // that discloses which seats are owned beyond private-lane access).
        if (!context.ownedPlayerIds.has(actorPlayerId)) {
          return {
            ok: true as const,
            schemaVersion: 1 as const,
            game: {
              id: context.gameId,
              slug: context.gameSlug,
              status: context.gameStatus,
              cognitiveArtifactCaptureVersion: captureVersion,
            },
            orderingQuality: "created_at_id" as const,
            readThrough: {
              mode: context.gameStatus === "completed"
                ? "completed_snapshot" as const
                : "live_snapshot" as const,
              throughCreatedAt: null,
              throughId: null,
            },
            filters: {
              artifactType: input.artifactType,
              actorPlayerId: null,
              player: input.player,
              phase: input.phase,
              round: input.round,
              action: input.action,
            },
            entries: [],
            pageSize: 0,
            nextCursor: null,
            nextCursorKind: null,
            contentTrust: UNTRUSTED_GAME_AUTHORED,
          };
        }
      }

      const filters: MatchCognitionNormalizedFilters = {
        artifactType: input.artifactType,
        actorPlayerId,
        player: input.player,
        phase: input.phase,
        round: input.round,
        action: input.action,
      };
      const filterFingerprint = fingerprintMatchCognitionFilters({
        artifactType: filters.artifactType,
        actorPlayerId: filters.actorPlayerId,
        phase: filters.phase,
        round: filters.round,
        action: filters.action,
      });

      let appliedFilters: MatchCognitionNormalizedFilters;
      let boundFilterFingerprint: string;
      let effectiveActorFilter: string | null;

      if (decodedCursor) {
        if (input.hasExplicitFilters && decodedCursor.filterFingerprint !== filterFingerprint) {
          return {
            ok: false as const,
            status: "cursor_invalid_or_stale" as const,
            error: "Cursor is invalid or stale",
          };
        }
        boundFilterFingerprint = decodedCursor.filterFingerprint;
        if (!bindMatchCognitionCursor({
          claims: decodedCursor,
          subjectUserId: options.subjectUserId,
          gameId: context.gameId,
          ownershipFingerprint: context.ownershipFingerprint,
          filterFingerprint: boundFilterFingerprint,
          captureVersion,
        })) {
          return {
            ok: false as const,
            status: "cursor_invalid_or_stale" as const,
            error: "Cursor is invalid or stale",
          };
        }
        const sealedType = decodedCursor.filters.artifactType;
        if (
          sealedType != null
          && sealedType !== "thinking"
          && sealedType !== "strategy"
        ) {
          return {
            ok: false as const,
            status: "cursor_invalid_or_stale" as const,
            error: "Cursor is invalid or stale",
          };
        }
        appliedFilters = {
          artifactType: sealedType,
          actorPlayerId: decodedCursor.filters.actorPlayerId,
          player: decodedCursor.filters.player,
          phase: decodedCursor.filters.phase,
          round: decodedCursor.filters.round,
          action: decodedCursor.filters.action,
        };
        effectiveActorFilter = decodedCursor.filters.actorPlayerId;
      } else {
        appliedFilters = filters;
        boundFilterFingerprint = filterFingerprint;
        effectiveActorFilter = actorPlayerId;
      }

      let mode: MatchCognitionCursorMode = "snapshot";
      let readThrough: MatchCognitionReadThroughBoundary;
      let keyset: MatchCognitionKeyset;

      if (decodedCursor) {
        mode = decodedCursor.mode;
        readThrough = { ...decodedCursor.readThrough };
        keyset = { ...decodedCursor.keyset };

        if (mode === "catchup") {
          const newest = await loadNewestOwnedBoundary(tx, {
            gameId: context.gameId,
            ownedPlayerIds: context.ownedPlayerIds,
            ownedAgentProfileIds: context.ownedAgentProfileIds,
            subjectUserId: options.subjectUserId,
            filters: appliedFilters,
            effectiveActorFilter,
          });
          const prevThroughAt = decodedCursor.readThrough.throughCreatedAt;
          const prevThroughId = decodedCursor.readThrough.throughId;
          if (
            !newest
            || (
              prevThroughAt != null
              && prevThroughId != null
              && compareCreatedAtId(newest.createdAt, newest.id, prevThroughAt, prevThroughId) <= 0
            )
          ) {
            return buildEmptyCatchupResult({
              context,
              captureVersion,
              appliedFilters,
              readThrough: {
                mode: context.gameStatus === "completed" ? "completed_snapshot" : "live_snapshot",
                throughCreatedAt: prevThroughAt,
                throughId: prevThroughId,
              },
              subjectUserId: options.subjectUserId,
              filterFingerprint: boundFilterFingerprint,
              cursorSecret: options.cursorSecret,
              nowMs,
            });
          }
          // Catch-up: walk rows strictly newer than previous through, up to newest.
          readThrough = {
            throughCreatedAt: newest.createdAt,
            throughId: newest.id,
          };
          keyset = {
            afterCreatedAt: null,
            afterId: null,
          };
          // Special catch-up lower bound: after previous through (exclusive upper of old snapshot).
          const pageRows = await selectOwnedCognitionPage(tx, {
            gameId: context.gameId,
            ownedPlayerIds: context.ownedPlayerIds,
            ownedAgentProfileIds: context.ownedAgentProfileIds,
            subjectUserId: options.subjectUserId,
            filters: appliedFilters,
            effectiveActorFilter,
            // After previous through in DESC terms means "newer than" via inverted range.
            catchupAfter: prevThroughAt != null && prevThroughId != null
              ? { createdAt: prevThroughAt, id: prevThroughId }
              : null,
            readThrough,
            keyset: { afterCreatedAt: null, afterId: null },
            limit: input.limit,
          });

          return finalizePage({
            context,
            captureVersion,
            appliedFilters,
            boundFilterFingerprint,
            pageRows: pageRows.rows,
            exhausted: pageRows.exhausted,
            lastKeyset: pageRows.lastKeyset,
            readThrough,
            subjectUserId: options.subjectUserId,
            cursorSecret: options.cursorSecret,
            nowMs,
          });
        }
      } else {
        const newest = await loadNewestOwnedBoundary(tx, {
          gameId: context.gameId,
          ownedPlayerIds: context.ownedPlayerIds,
          ownedAgentProfileIds: context.ownedAgentProfileIds,
          subjectUserId: options.subjectUserId,
          filters: appliedFilters,
          effectiveActorFilter,
        });
        readThrough = {
          throughCreatedAt: newest?.createdAt ?? null,
          throughId: newest?.id ?? null,
        };
        keyset = {
          afterCreatedAt: null,
          afterId: null,
        };
      }

      const pageRows = await selectOwnedCognitionPage(tx, {
        gameId: context.gameId,
        ownedPlayerIds: context.ownedPlayerIds,
        ownedAgentProfileIds: context.ownedAgentProfileIds,
        subjectUserId: options.subjectUserId,
        filters: appliedFilters,
        effectiveActorFilter,
        catchupAfter: null,
        readThrough,
        keyset,
        limit: input.limit,
      });

      return finalizePage({
        context,
        captureVersion,
        appliedFilters,
        boundFilterFingerprint,
        pageRows: pageRows.rows,
        exhausted: pageRows.exhausted,
        lastKeyset: pageRows.lastKeyset,
        readThrough,
        subjectUserId: options.subjectUserId,
        cursorSecret: options.cursorSecret,
        nowMs,
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

function finalizePage(params: {
  context: MatchAccessContext;
  captureVersion: number;
  appliedFilters: MatchCognitionNormalizedFilters;
  boundFilterFingerprint: string;
  pageRows: CognitionCandidateRow[];
  exhausted: boolean;
  lastKeyset: MatchCognitionKeyset;
  readThrough: MatchCognitionReadThroughBoundary;
  subjectUserId: string;
  cursorSecret?: string;
  nowMs: number;
}): MatchCognitionPageOk {
  const entries = params.pageRows.map((row) => buildMatchCognitionEntryDto(row, params.context));

  let nextCursor: string | null = null;
  let nextCursorKind: "page" | "catchup" | null = null;

  const sealedFilters = {
    artifactType: params.appliedFilters.artifactType,
    actorPlayerId: params.appliedFilters.actorPlayerId,
    player: params.appliedFilters.player,
    phase: params.appliedFilters.phase,
    round: params.appliedFilters.round,
    action: params.appliedFilters.action,
  };

  if (!params.exhausted) {
    nextCursor = issueMatchCognitionCursor({
      subjectUserId: params.subjectUserId,
      gameId: params.context.gameId,
      filterFingerprint: params.boundFilterFingerprint,
      ownershipFingerprint: params.context.ownershipFingerprint,
      captureVersion: params.captureVersion,
      mode: "snapshot",
      readThrough: params.readThrough,
      keyset: params.lastKeyset,
      filters: sealedFilters,
      nowMs: params.nowMs,
    }, params.cursorSecret);
    nextCursorKind = "page";
  } else if (params.readThrough.throughCreatedAt != null) {
    nextCursor = issueMatchCognitionCursor({
      subjectUserId: params.subjectUserId,
      gameId: params.context.gameId,
      filterFingerprint: params.boundFilterFingerprint,
      ownershipFingerprint: params.context.ownershipFingerprint,
      captureVersion: params.captureVersion,
      mode: "catchup",
      readThrough: params.readThrough,
      keyset: {
        afterCreatedAt: params.readThrough.throughCreatedAt,
        afterId: params.readThrough.throughId,
      },
      filters: sealedFilters,
      nowMs: params.nowMs,
    }, params.cursorSecret);
    nextCursorKind = "catchup";
  }

  return {
    ok: true,
    schemaVersion: 1,
    game: {
      id: params.context.gameId,
      slug: params.context.gameSlug,
      status: params.context.gameStatus,
      cognitiveArtifactCaptureVersion: params.captureVersion,
    },
    orderingQuality: "created_at_id",
    readThrough: {
      mode: params.context.gameStatus === "completed" ? "completed_snapshot" : "live_snapshot",
      throughCreatedAt: params.readThrough.throughCreatedAt,
      throughId: params.readThrough.throughId,
    },
    filters: params.appliedFilters,
    entries,
    pageSize: entries.length,
    nextCursor,
    nextCursorKind,
    contentTrust: UNTRUSTED_GAME_AUTHORED,
  };
}

function buildEmptyCatchupResult(params: {
  context: MatchAccessContext;
  captureVersion: number;
  appliedFilters: MatchCognitionNormalizedFilters;
  readThrough: MatchCognitionReadThroughDto;
  subjectUserId: string;
  filterFingerprint: string;
  cursorSecret?: string;
  nowMs: number;
}): MatchCognitionPageOk {
  const nextCursor = params.readThrough.throughCreatedAt != null
    ? issueMatchCognitionCursor({
      subjectUserId: params.subjectUserId,
      gameId: params.context.gameId,
      filterFingerprint: params.filterFingerprint,
      ownershipFingerprint: params.context.ownershipFingerprint,
      captureVersion: params.captureVersion,
      mode: "catchup",
      readThrough: {
        throughCreatedAt: params.readThrough.throughCreatedAt,
        throughId: params.readThrough.throughId,
      },
      keyset: {
        afterCreatedAt: params.readThrough.throughCreatedAt,
        afterId: params.readThrough.throughId,
      },
      filters: {
        artifactType: params.appliedFilters.artifactType,
        actorPlayerId: params.appliedFilters.actorPlayerId,
        player: params.appliedFilters.player,
        phase: params.appliedFilters.phase,
        round: params.appliedFilters.round,
        action: params.appliedFilters.action,
      },
      nowMs: params.nowMs,
    }, params.cursorSecret)
    : null;

  return {
    ok: true,
    schemaVersion: 1,
    game: {
      id: params.context.gameId,
      slug: params.context.gameSlug,
      status: params.context.gameStatus,
      cognitiveArtifactCaptureVersion: params.captureVersion,
    },
    orderingQuality: "created_at_id",
    readThrough: params.readThrough,
    filters: params.appliedFilters,
    entries: [],
    pageSize: 0,
    nextCursor,
    nextCursorKind: nextCursor ? "catchup" : null,
    contentTrust: UNTRUSTED_GAME_AUTHORED,
  };
}

// ---------------------------------------------------------------------------
// Allowlisted DTO construction
// ---------------------------------------------------------------------------

export function buildMatchCognitionEntryDto(
  row: CognitionCandidateRow,
  context: MatchAccessContext,
): MatchCognitionEntryDto {
  const artifactType: SubjectOwnerTimelineArtifactType =
    row.artifactType === "strategy" ? "strategy" : "thinking";

  const playerId = row.actorPlayerId;
  const actor: MatchCognitionActorDto = {
    playerId,
    name: playerId ? context.resolvePlayerName(playerId) : null,
    agentProfileId: row.actorAgentProfileId,
  };

  const base: MatchCognitionEntryDto = {
    authority: COGNITION_AUTHORITY_LANE,
    id: row.id,
    artifactType,
    actor,
    action: row.action,
    phase: row.phase,
    round: row.round,
    eventSequence: row.eventSequence,
    createdAt: row.createdAt,
    orderingQuality: "created_at_id",
  };

  if (artifactType === "thinking") {
    base.thinkingProse = extractThinkingProse(row.payload);
  } else {
    base.strategyProse = extractStrategyProse(row.payload);
  }

  return base;
}

function extractThinkingProse(payload: Record<string, unknown>): MatchCognitionThinkingProse {
  const thinking = typeof payload.thinking === "string" ? payload.thinking : "";
  return {
    thinking,
    contentTrust: UNTRUSTED_GAME_AUTHORED,
  };
}

function extractStrategyProse(payload: Record<string, unknown>): MatchCognitionStrategyProse {
  const prose: MatchCognitionStrategyProse = {
    contentTrust: UNTRUSTED_GAME_AUTHORED,
  };
  assignOptionalString(prose, "decisionLog", payload.decisionLog);
  assignOptionalString(prose, "strategicLens", payload.strategicLens);
  assignOptionalString(prose, "strategicLensRationale", payload.strategicLensRationale);
  assignOptionalString(prose, "strategyPacketRevision", payload.strategyPacketRevision);
  assignOptionalString(prose, "strategyPacketUpdate", payload.strategyPacketUpdate);
  assignOptionalString(prose, "strategyPacketSummary", payload.strategyPacketSummary);
  assignOptionalString(prose, "strategicReflectionSummary", payload.strategicReflectionSummary);
  return prose;
}

function assignOptionalString(
  target: MatchCognitionStrategyProse,
  key: Exclude<keyof MatchCognitionStrategyProse, "contentTrust">,
  value: unknown,
): void {
  if (typeof value === "string" && value.length > 0) {
    target[key] = value;
  }
}

// ---------------------------------------------------------------------------
// SQL selection — ownership before limit
// ---------------------------------------------------------------------------

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

async function loadNewestOwnedBoundary(
  db: Pick<DrizzleDB, "select">,
  params: {
    gameId: string;
    ownedPlayerIds: ReadonlySet<string>;
    ownedAgentProfileIds: ReadonlySet<string>;
    subjectUserId: string;
    filters: MatchCognitionNormalizedFilters;
    effectiveActorFilter: string | null;
  },
): Promise<{ createdAt: string; id: string } | null> {
  const conditions = ownedCognitionBaseConditions(params);
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

async function selectOwnedCognitionPage(
  db: Pick<DrizzleDB, "select">,
  params: {
    gameId: string;
    ownedPlayerIds: ReadonlySet<string>;
    ownedAgentProfileIds: ReadonlySet<string>;
    subjectUserId: string;
    filters: MatchCognitionNormalizedFilters;
    effectiveActorFilter: string | null;
    catchupAfter: { createdAt: string; id: string } | null;
    readThrough: MatchCognitionReadThroughBoundary;
    keyset: MatchCognitionKeyset;
    limit: number;
  },
): Promise<{
  rows: CognitionCandidateRow[];
  exhausted: boolean;
  lastKeyset: MatchCognitionKeyset;
}> {
  const conditions = ownedCognitionBaseConditions(params);

  // Snapshot upper bound: only rows at or older than the pinned newest.
  if (params.readThrough.throughCreatedAt != null && params.readThrough.throughId != null) {
    const throughAt = params.readThrough.throughCreatedAt;
    const throughId = params.readThrough.throughId;
    conditions.push(sql`(
      ${schema.gameCognitiveArtifacts.createdAt} < ${throughAt}
      OR (
        ${schema.gameCognitiveArtifacts.createdAt} = ${throughAt}
        AND ${schema.gameCognitiveArtifacts.id} <= ${throughId}
      )
    )`);
  } else if (params.readThrough.throughCreatedAt == null) {
    // Empty snapshot — no rows.
    return {
      rows: [],
      exhausted: true,
      lastKeyset: { afterCreatedAt: null, afterId: null },
    };
  }

  // Catch-up lower bound: rows strictly newer than previous through.
  if (params.catchupAfter) {
    const afterAt = params.catchupAfter.createdAt;
    const afterId = params.catchupAfter.id;
    conditions.push(sql`(
      ${schema.gameCognitiveArtifacts.createdAt} > ${afterAt}
      OR (
        ${schema.gameCognitiveArtifacts.createdAt} = ${afterAt}
        AND ${schema.gameCognitiveArtifacts.id} > ${afterId}
      )
    )`);
  }

  // Keyset: continue after last returned row (DESC → older).
  if (params.keyset.afterCreatedAt != null && params.keyset.afterId != null) {
    const afterAt = params.keyset.afterCreatedAt;
    const afterId = params.keyset.afterId;
    conditions.push(sql`(
      ${schema.gameCognitiveArtifacts.createdAt} < ${afterAt}
      OR (
        ${schema.gameCognitiveArtifacts.createdAt} = ${afterAt}
        AND ${schema.gameCognitiveArtifacts.id} < ${afterId}
      )
    )`);
  }

  const limitPlus = params.limit + 1;
  const rawRows = await db
    .select({
      id: schema.gameCognitiveArtifacts.id,
      artifactType: schema.gameCognitiveArtifacts.artifactType,
      actorRole: schema.gameCognitiveArtifacts.actorRole,
      actorPlayerId: schema.gameCognitiveArtifacts.actorPlayerId,
      actorUserId: schema.gameCognitiveArtifacts.actorUserId,
      actorAgentProfileId: schema.gameCognitiveArtifacts.actorAgentProfileId,
      action: schema.gameCognitiveArtifacts.action,
      phase: schema.gameCognitiveArtifacts.phase,
      round: schema.gameCognitiveArtifacts.round,
      eventSequence: schema.gameCognitiveArtifacts.eventSequence,
      payload: schema.gameCognitiveArtifacts.payload,
      visibilityStatus: schema.gameCognitiveArtifacts.visibilityStatus,
      redactionStatus: schema.gameCognitiveArtifacts.redactionStatus,
      createdAt: schema.gameCognitiveArtifacts.createdAt,
    })
    .from(schema.gameCognitiveArtifacts)
    .where(and(...conditions))
    .orderBy(
      desc(schema.gameCognitiveArtifacts.createdAt),
      desc(schema.gameCognitiveArtifacts.id),
    )
    .limit(limitPlus);

  // Drop unavailable rows without counting them toward hidden diagnostics.
  // Ownership already applied in SQL; redaction/expiry/degraded filtered here
  // so status is per-owned-artifact only (never non-owned).
  const available = rawRows.filter((row) => isTimelineAvailable(row));
  const exhausted = available.length <= params.limit;
  const page = available.slice(0, params.limit);
  const last = page[page.length - 1];
  const lastKeyset: MatchCognitionKeyset = last
    ? { afterCreatedAt: last.createdAt, afterId: last.id }
    : { afterCreatedAt: params.keyset.afterCreatedAt, afterId: params.keyset.afterId };

  return {
    rows: page.map((row) => ({
      id: row.id,
      artifactType: row.artifactType,
      actorRole: row.actorRole,
      actorPlayerId: row.actorPlayerId,
      actorUserId: row.actorUserId,
      actorAgentProfileId: row.actorAgentProfileId,
      action: row.action,
      phase: row.phase,
      round: row.round,
      eventSequence: row.eventSequence,
      payload: row.payload,
      visibilityStatus: row.visibilityStatus,
      redactionStatus: row.redactionStatus,
      createdAt: row.createdAt,
    })),
    exhausted,
    lastKeyset,
  };
}

function ownedCognitionBaseConditions(params: {
  gameId: string;
  ownedPlayerIds: ReadonlySet<string>;
  ownedAgentProfileIds: ReadonlySet<string>;
  subjectUserId: string;
  filters: MatchCognitionNormalizedFilters;
  effectiveActorFilter: string | null;
}): SQL[] {
  const ownedPlayerIds = [...params.ownedPlayerIds];
  const ownedAgentProfileIds = [...params.ownedAgentProfileIds];

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

  const conditions: SQL[] = [
    eq(schema.gameCognitiveArtifacts.gameId, params.gameId),
    eq(schema.gameCognitiveArtifacts.redactionStatus, "active"),
    // Degraded/unavailable rows never pin boundaries, fill pages, or leak ids.
    eq(schema.gameCognitiveArtifacts.visibilityStatus, "active"),
    inArray(schema.gameCognitiveArtifacts.artifactType, ["thinking", "strategy"]),
    inArray(schema.gameCognitiveArtifacts.actorRole, ["player", "juror"]),
    or(...ownershipClauses)!,
  ];

  if (params.filters.artifactType) {
    conditions.push(
      eq(schema.gameCognitiveArtifacts.artifactType, params.filters.artifactType),
    );
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
  if (params.effectiveActorFilter != null) {
    conditions.push(
      eq(schema.gameCognitiveArtifacts.actorPlayerId, params.effectiveActorFilter),
    );
  }

  return conditions;
}

function isTimelineAvailable(row: {
  redactionStatus: string;
  visibilityStatus: string;
}): boolean {
  if (row.redactionStatus !== "active") return false;
  if (row.visibilityStatus === "capture_degraded") return false;
  return true;
}

/** Compare (createdAt, id) lexicographically; positive if left > right. */
function compareCreatedAtId(
  leftAt: string,
  leftId: string,
  rightAt: string,
  rightId: string,
): number {
  if (leftAt < rightAt) return -1;
  if (leftAt > rightAt) return 1;
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Closed input parser
// ---------------------------------------------------------------------------

type ParsedCognitionInput = {
  gameIdOrSlug: string;
  artifactType: SubjectOwnerTimelineArtifactType | null;
  player: string | null;
  phase: string | null;
  round: number | null;
  action: string | null;
  cursor: string | null;
  limit: number;
  hasExplicitFilters: boolean;
};

function parseReadMatchCognitionInput(
  rawInput: unknown,
): { ok: true; value: ParsedCognitionInput } | MatchCognitionPageError {
  if (rawInput === null || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return {
      ok: false,
      status: "invalid_input",
      error: "Input must be an object",
    };
  }
  const record = rawInput as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KNOWN_INPUT_KEYS.has(key)) {
      return {
        ok: false,
        status: "invalid_input",
        error: `Unknown input key: ${key}`,
        field: key,
      };
    }
  }

  if (typeof record.gameIdOrSlug !== "string" || record.gameIdOrSlug.length === 0) {
    return {
      ok: false,
      status: "invalid_input",
      error: "gameIdOrSlug is required",
      field: "gameIdOrSlug",
    };
  }
  if (record.gameIdOrSlug.length > MATCH_COGNITION_MAX_ID_CHARS) {
    return {
      ok: false,
      status: "invalid_input",
      error: "gameIdOrSlug exceeds maximum length",
      field: "gameIdOrSlug",
    };
  }

  let artifactType: SubjectOwnerTimelineArtifactType | null = null;
  if (record.artifactType !== undefined) {
    if (typeof record.artifactType !== "string") {
      return {
        ok: false,
        status: "invalid_input",
        error: "artifactType must be a string",
        field: "artifactType",
      };
    }
    if (!isSubjectOwnerTimelineArtifactType(record.artifactType as CognitiveArtifactType)) {
      // Reject reasoning and unknown types — timeline is thinking/strategy only.
      return {
        ok: false,
        status: "invalid_input",
        error: "artifactType must be thinking or strategy",
        field: "artifactType",
      };
    }
    artifactType = record.artifactType as SubjectOwnerTimelineArtifactType;
  }

  let player: string | null = null;
  if (record.player !== undefined) {
    if (typeof record.player !== "string" || record.player.length === 0) {
      return {
        ok: false,
        status: "invalid_input",
        error: "player must be a non-empty string",
        field: "player",
      };
    }
    if (record.player.length > MATCH_COGNITION_MAX_ID_CHARS) {
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
    if (typeof record.phase !== "string" || record.phase.length === 0) {
      return {
        ok: false,
        status: "invalid_input",
        error: "phase must be a non-empty string",
        field: "phase",
      };
    }
    if (record.phase.length > MATCH_COGNITION_MAX_ID_CHARS) {
      return {
        ok: false,
        status: "invalid_input",
        error: "phase exceeds maximum length",
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
    if (record.action.length > MATCH_COGNITION_MAX_ID_CHARS) {
      return {
        ok: false,
        status: "invalid_input",
        error: "action exceeds maximum length",
        field: "action",
      };
    }
    action = record.action;
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
    if (record.cursor.length > MATCH_COGNITION_MAX_CURSOR_CHARS) {
      return {
        ok: false,
        status: "invalid_input",
        error: "cursor exceeds maximum length",
        field: "cursor",
      };
    }
    cursor = record.cursor;
  }

  let limit = MATCH_COGNITION_DEFAULT_LIMIT;
  if (record.limit !== undefined) {
    if (
      typeof record.limit !== "number"
      || !Number.isInteger(record.limit)
      || record.limit < 1
      || record.limit > MATCH_COGNITION_MAX_LIMIT
    ) {
      return {
        ok: false,
        status: "invalid_input",
        error: `limit must be an integer between 1 and ${MATCH_COGNITION_MAX_LIMIT}`,
        field: "limit",
      };
    }
    limit = record.limit;
  }

  const hasExplicitFilters = artifactType != null
    || player != null
    || phase != null
    || round != null
    || action != null;

  return {
    ok: true,
    value: {
      gameIdOrSlug: record.gameIdOrSlug,
      artifactType,
      player,
      phase,
      round,
      action,
      cursor,
      limit,
      hasExplicitFilters,
    },
  };
}
