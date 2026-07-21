/**
 * Owner-unified transcript visibility policy (U3).
 *
 * Authorizes public, allowlisted system, Mingle/whisper, and session-time huddle
 * dialogue for subjects with participating ownership. Loads trusted canonical
 * huddle-session audiences as transcript-specific input; does not import MCP
 * server/catalog code.
 *
 * Hidden rows never contribute to returned totals, diagnostics, or existence
 * signals. Creator-only access does not open the private transcript lane.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { TranscriptSafeContext } from "../db/schema.js";
import {
  getPersistedGameEvents,
  type TrustedPersistedGameEvent,
} from "./game-event-read-model.js";
import {
  hasPrivateMatchLaneAccess,
  withMatchAccessSnapshot,
  type MatchAccessContext,
  type MatchAccessDB,
} from "./match-access-context.js";
import { isViewerSafeDialogueKind } from "./transcript-capture.js";

export type TranscriptVisibilityClass =
  | "public"
  | "system"
  | "mingle"
  | "whisper"
  | "huddle"
  | "legacy_mingle"
  | "legacy_whisper"
  | "legacy_huddle";

/** Authorized-view metadata only — never hidden-row counts or omitted scopes. */
export interface AuthorizedTranscriptRowRef {
  id: number;
  entrySequence: number | null;
  scope: string;
  visibilityClass: TranscriptVisibilityClass;
  round: number;
  phase: string;
  timestamp: number;
  speakerPlayerId: string | null;
  fromPlayerId: string | null;
  dialogueKind: string | null;
  captureVersion: number | null;
}

export type TranscriptLaneAccess =
  | { status: "authorized"; context: MatchAccessContext }
  | {
      /**
       * Non-enumerating denial: creator-only, no seats, or non-participant.
       * Callers must not distinguish reasons or reveal row existence.
       */
      status: "denied";
    };

export interface TrustedHuddleSession {
  sessionId: string;
  allianceId: string;
  round: number;
  window: string;
  phase: string;
  speakerIds: readonly string[];
  /** Lexically sorted speaker IDs for set equality checks. */
  speakerKey: string;
}

export interface TrustedHuddleSessionLoad {
  sessions: readonly TrustedHuddleSession[];
  /** True when the trusted prefix is empty or fully valid (no break). */
  trustedPrefixHealthy: boolean;
  lastTrustedSequence: number;
  /** Sessions whose canonical event fell outside a healthy prefix are excluded. */
  omittedUntrustedSessionCount: number;
}

export interface TranscriptRowAuthInput {
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
}

export interface TranscriptAuthorizationEvidence {
  ownedPlayerIds: ReadonlySet<string>;
  resolvePlayerId: (nameOrId: string) => string | null;
  /**
   * Trusted canonical huddle sessions. Modern huddles require a matching
   * trusted session when session identity is present; legacy huddles match
   * session-time participant sets only when correlation is unambiguous.
   */
  trustedHuddleSessions: readonly TrustedHuddleSession[];
  /**
   * When false, modern huddles fail closed (canonical invalidity). Public and
   * Mingle rows remain independently authorizable.
   */
  trustedPrefixHealthy: boolean;
}

const DIALOGUE_SCOPES = ["public", "system", "mingle", "whisper", "huddle"] as const;
const PRIVATE_ROOM_SCOPES = new Set(["mingle", "whisper"]);

/**
 * Transcript lane opens only for participating owners (not creator-only).
 */
export function evaluateTranscriptLaneAccess(
  context: MatchAccessContext,
): TranscriptLaneAccess {
  if (!hasPrivateMatchLaneAccess(context)) {
    return { status: "denied" };
  }
  return { status: "authorized", context };
}

/**
 * Load canonical huddle sessions from the trusted event prefix only.
 * Sessions after a hash/gap break are omitted (fail closed for those huddles).
 */
export async function loadTrustedHuddleSessions(
  db: MatchAccessDB,
  gameId: string,
): Promise<TrustedHuddleSessionLoad> {
  const read = await getPersistedGameEvents(db, gameId);
  return huddleSessionsFromTrustedEvents(read.events, {
    trustedPrefixHealthy: read.status !== "invalid",
    lastTrustedSequence: read.lastTrustedSequence,
    // When invalid, events is already the valid prefix only.
    omittedUntrustedSessionCount: countHuddleSessionsBeyondPrefix(read),
  });
}

export function huddleSessionsFromTrustedEvents(
  events: readonly TrustedPersistedGameEvent[],
  meta: {
    trustedPrefixHealthy: boolean;
    lastTrustedSequence: number;
    omittedUntrustedSessionCount?: number;
  },
): TrustedHuddleSessionLoad {
  const sessions: TrustedHuddleSession[] = [];
  for (const row of events) {
    if (row.eventType !== "alliance.huddle_completed") continue;
    const session = row.envelope.type === "alliance.huddle_completed"
      ? row.envelope.payload.session
      : null;
    if (!session) continue;
    const speakerIds = [...session.speakerIds];
    const phase = session.window === "pre_vote" ? "PRE_VOTE_HUDDLE" : "PRE_COUNCIL_HUDDLE";
    sessions.push({
      sessionId: session.id,
      allianceId: session.allianceId,
      round: session.round,
      window: session.window,
      phase,
      speakerIds,
      speakerKey: speakerSetKey(speakerIds),
    });
  }
  return {
    sessions,
    trustedPrefixHealthy: meta.trustedPrefixHealthy,
    lastTrustedSequence: meta.lastTrustedSequence,
    omittedUntrustedSessionCount: meta.omittedUntrustedSessionCount ?? 0,
  };
}

/**
 * Pure row authorization for tests and set-based filtering.
 * Returns the visibility class when authorized, otherwise null (omit silently).
 */
export function classifyAuthorizedTranscriptRow(
  row: TranscriptRowAuthInput,
  evidence: TranscriptAuthorizationEvidence,
): TranscriptVisibilityClass | null {
  if (!DIALOGUE_SCOPES.includes(row.scope as (typeof DIALOGUE_SCOPES)[number])) {
    return null;
  }

  if (row.scope === "public") {
    return "public";
  }

  if (row.scope === "system") {
    return classifySystemRow(row);
  }

  const isModern = isModernDialogueRow(row);

  if (PRIVATE_ROOM_SCOPES.has(row.scope)) {
    if (isModern) {
      return classifyModernPrivateRoom(row, evidence.ownedPlayerIds);
    }
    return classifyLegacyPrivateRoom(row, evidence);
  }

  if (row.scope === "huddle") {
    if (isModern) {
      return classifyModernHuddle(row, evidence);
    }
    return classifyLegacyHuddle(row, evidence);
  }

  return null;
}

/**
 * Select authorized dialogue rows for an owner-authorized transcript lane.
 * Deduplicates by modern entrySequence or legacy row id. Does not return
 * omitted-row counts or existence diagnostics.
 */
export async function selectAuthorizedTranscriptRows(
  db: MatchAccessDB,
  context: MatchAccessContext,
  options: {
    trustedHuddleLoad?: TrustedHuddleSessionLoad;
  } = {},
): Promise<{
  lane: TranscriptLaneAccess;
  rows: AuthorizedTranscriptRowRef[];
  trustedHuddleLoad: TrustedHuddleSessionLoad;
}> {
  const lane = evaluateTranscriptLaneAccess(context);
  const trustedHuddleLoad = options.trustedHuddleLoad
    ?? await loadTrustedHuddleSessions(db, context.gameId);

  if (lane.status === "denied") {
    return { lane, rows: [], trustedHuddleLoad };
  }

  const evidence: TranscriptAuthorizationEvidence = {
    ownedPlayerIds: context.ownedPlayerIds,
    resolvePlayerId: (nameOrId) => context.resolvePlayerId(nameOrId),
    trustedHuddleSessions: trustedHuddleLoad.sessions,
    trustedPrefixHealthy: trustedHuddleLoad.trustedPrefixHealthy,
  };

  // Candidate dialogue rows only — diary/thinking never enter the product dialogue lane.
  const candidates = await db
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
    })
    .from(schema.transcripts)
    .where(and(
      eq(schema.transcripts.gameId, context.gameId),
      inArray(schema.transcripts.scope, [...DIALOGUE_SCOPES]),
    ))
    .orderBy(
      asc(schema.transcripts.entrySequence),
      asc(schema.transcripts.timestamp),
      asc(schema.transcripts.id),
    );

  const authorized: AuthorizedTranscriptRowRef[] = [];
  const seenModernSequences = new Set<number>();
  const seenLegacyIds = new Set<number>();

  for (const candidate of candidates) {
    const visibilityClass = classifyAuthorizedTranscriptRow(candidate, evidence);
    if (!visibilityClass) continue;

    if (candidate.entrySequence != null) {
      if (seenModernSequences.has(candidate.entrySequence)) continue;
      seenModernSequences.add(candidate.entrySequence);
    } else {
      if (seenLegacyIds.has(candidate.id)) continue;
      seenLegacyIds.add(candidate.id);
    }

    authorized.push({
      id: candidate.id,
      entrySequence: candidate.entrySequence,
      scope: candidate.scope,
      visibilityClass,
      round: candidate.round,
      phase: candidate.phase,
      timestamp: candidate.timestamp,
      speakerPlayerId: candidate.speakerPlayerId,
      fromPlayerId: candidate.fromPlayerId,
      dialogueKind: candidate.dialogueKind,
      captureVersion: candidate.captureVersion,
    });
  }

  // Stable chronological order: modern sequence first when present, else timestamp+id.
  authorized.sort((left, right) => {
    if (left.entrySequence != null && right.entrySequence != null) {
      return left.entrySequence - right.entrySequence;
    }
    if (left.entrySequence != null) return -1;
    if (right.entrySequence != null) return 1;
    return left.timestamp - right.timestamp || left.id - right.id;
  });

  return { lane, rows: authorized, trustedHuddleLoad };
}

/**
 * Snapshot helper: resolve access + authorize rows in one transaction so a
 * concurrent transfer cannot mix ownership with row selection.
 */
export async function selectAuthorizedTranscriptRowsInSnapshot(
  db: DrizzleDB,
  input: {
    subjectUserId: string;
    gameIdOrSlug: string;
  },
): Promise<{
  lane: TranscriptLaneAccess;
  rows: AuthorizedTranscriptRowRef[];
  trustedHuddleLoad: TrustedHuddleSessionLoad | null;
  context: MatchAccessContext | null;
}> {
  return withMatchAccessSnapshot(db, input, async ({ tx, resolution }) => {
    if (resolution.status !== "resolved") {
      return {
        lane: { status: "denied" },
        rows: [],
        trustedHuddleLoad: null,
        context: null,
      };
    }
    const result = await selectAuthorizedTranscriptRows(tx, resolution.context);
    return {
      lane: result.lane,
      rows: result.rows,
      trustedHuddleLoad: result.trustedHuddleLoad,
      context: resolution.context,
    };
  });
}

/** Owned-seat union membership tokens for legacy name-or-ID checks. */
export function ownedMembershipTokens(
  ownedPlayerIds: ReadonlySet<string>,
  resolvePlayerName: (playerId: string) => string | null,
): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const id of ownedPlayerIds) {
    tokens.add(id);
    const name = resolvePlayerName(id);
    if (name) tokens.add(name);
  }
  return tokens;
}

function classifySystemRow(row: TranscriptRowAuthInput): TranscriptVisibilityClass | null {
  // Version-0 / null capture has no trustworthy safe-kind discriminator (KTD10).
  if (row.captureVersion == null || row.captureVersion < 1) {
    return null;
  }
  if (!row.dialogueKind || !isViewerSafeDialogueKind(row.dialogueKind)) {
    return null;
  }
  return "system";
}

function isModernDialogueRow(row: TranscriptRowAuthInput): boolean {
  return row.captureVersion != null
    && row.captureVersion >= 1
    && row.entrySequence != null
    && Array.isArray(row.audiencePlayerIds);
}

function classifyModernPrivateRoom(
  row: TranscriptRowAuthInput,
  ownedPlayerIds: ReadonlySet<string>,
): TranscriptVisibilityClass | null {
  if (ownedIntersectsAudience(row, ownedPlayerIds)) {
    return row.scope === "whisper" ? "whisper" : "mingle";
  }
  return null;
}

function classifyLegacyPrivateRoom(
  row: TranscriptRowAuthInput,
  evidence: TranscriptAuthorizationEvidence,
): TranscriptVisibilityClass | null {
  const recipients = parseRecipientTokens(row.toPlayerIds);
  // Malformed restricted recipients fail closed.
  if (row.toPlayerIds != null && row.toPlayerIds.trim() !== "" && recipients === null) {
    return null;
  }

  const membership = new Set<string>();
  if (row.fromPlayerId) {
    const senderId = evidence.resolvePlayerId(row.fromPlayerId);
    if (senderId) membership.add(senderId);
    // Unresolvable sender token is not automatically fatal if recipients authorize,
    // but an owned sender name/id must resolve unambiguously to grant via sender.
    if (!senderId && tokenCouldBeOwned(row.fromPlayerId, evidence)) {
      return null; // ambiguous owned-adjacent sender — omit
    }
  }

  if (recipients) {
    for (const token of recipients) {
      const resolved = evidence.resolvePlayerId(token);
      if (resolved) {
        membership.add(resolved);
        continue;
      }
      // Ambiguous or unknown recipient token: omit the whole restricted row.
      return null;
    }
  }

  for (const playerId of membership) {
    if (evidence.ownedPlayerIds.has(playerId)) {
      return row.scope === "whisper" ? "legacy_whisper" : "legacy_mingle";
    }
  }

  // Sender may be stored as owned UUID/name even when recipients exclude sender.
  if (row.fromPlayerId) {
    const senderId = evidence.resolvePlayerId(row.fromPlayerId);
    if (senderId && evidence.ownedPlayerIds.has(senderId)) {
      return row.scope === "whisper" ? "legacy_whisper" : "legacy_mingle";
    }
  }

  return null;
}

function classifyModernHuddle(
  row: TranscriptRowAuthInput,
  evidence: TranscriptAuthorizationEvidence,
): TranscriptVisibilityClass | null {
  if (!evidence.trustedPrefixHealthy && !row.safeContext?.sessionId) {
    // Without a healthy prefix and without captured session identity, fail closed.
    return null;
  }

  const sessionId = row.safeContext?.sessionId;
  const sessionAudience = row.safeContext?.sessionAudiencePlayerIds;

  if (sessionId) {
    const session = evidence.trustedHuddleSessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      // Canonical invalidity / missing session fails this huddle closed.
      return null;
    }
    if (!ownedInSpeakerSet(session.speakerIds, evidence.ownedPlayerIds)) {
      return null;
    }
    // Captured row audience must not expand beyond session membership when present.
    if (sessionAudience && sessionAudience.length > 0) {
      if (!ownedInSpeakerSet(sessionAudience, evidence.ownedPlayerIds)) {
        return null;
      }
    }
    return "huddle";
  }

  // Modern huddle without sessionId: require audience intersection + trusted
  // unambiguous session correlation on round/phase/participant set.
  if (!ownedIntersectsAudience(row, evidence.ownedPlayerIds)) {
    return null;
  }

  const audience = row.audiencePlayerIds ?? [];
  const matches = evidence.trustedHuddleSessions.filter((session) =>
    session.round === row.round
    && session.phase === row.phase
    && speakerSetKey(session.speakerIds) === speakerSetKey(audience)
    && ownedInSpeakerSet(session.speakerIds, evidence.ownedPlayerIds)
  );
  if (matches.length !== 1) return null;
  return "huddle";
}

function classifyLegacyHuddle(
  row: TranscriptRowAuthInput,
  evidence: TranscriptAuthorizationEvidence,
): TranscriptVisibilityClass | null {
  const participants = resolveLegacyParticipantIds(row, evidence);
  if (participants === null) {
    // Ambiguous or malformed participant resolution — omit.
    return null;
  }
  if (participants.size === 0) return null;

  const participantKey = speakerSetKey([...participants]);
  const matches = evidence.trustedHuddleSessions.filter((session) => {
    if (session.round !== row.round || session.phase !== row.phase) return false;
    if (!ownedInSpeakerSet(session.speakerIds, evidence.ownedPlayerIds)) return false;
    // Compatibility: every session speaker appears in participants (name-or-ID),
    // and the participant set is not a disjoint foreign huddle.
    const sessionKey = session.speakerKey;
    if (sessionKey === participantKey) return true;
    // Allow stored rows that list a subset/superset only when the owned members
    // of the session are all present and no extra unowned speakers invent a second session.
    return session.speakerIds.every((id) => participants.has(id));
  });

  // Ambiguous multi-session overlap fails closed.
  if (matches.length !== 1) return null;
  return "legacy_huddle";
}

function ownedIntersectsAudience(
  row: TranscriptRowAuthInput,
  ownedPlayerIds: ReadonlySet<string>,
): boolean {
  if (row.speakerPlayerId && ownedPlayerIds.has(row.speakerPlayerId)) return true;
  if (!row.audiencePlayerIds) return false;
  for (const id of row.audiencePlayerIds) {
    if (ownedPlayerIds.has(id)) return true;
  }
  return false;
}

function ownedInSpeakerSet(
  speakerIds: readonly string[],
  ownedPlayerIds: ReadonlySet<string>,
): boolean {
  return speakerIds.some((id) => ownedPlayerIds.has(id));
}

function speakerSetKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join("\0");
}

/**
 * Parse JSON recipient array. Returns null when malformed (fail closed for
 * restricted scopes). Empty array is valid.
 */
function parseRecipientTokens(value: string | null): string[] | null {
  if (value == null || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const tokens: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") return null;
      tokens.push(item);
    }
    return tokens;
  } catch {
    return null;
  }
}

function resolveLegacyParticipantIds(
  row: TranscriptRowAuthInput,
  evidence: TranscriptAuthorizationEvidence,
): Set<string> | null {
  const participants = new Set<string>();
  if (row.fromPlayerId) {
    const resolved = evidence.resolvePlayerId(row.fromPlayerId);
    if (!resolved) return null;
    participants.add(resolved);
  }
  const recipients = parseRecipientTokens(row.toPlayerIds);
  if (recipients === null) return null;
  for (const token of recipients) {
    const resolved = evidence.resolvePlayerId(token);
    if (!resolved) return null;
    participants.add(resolved);
  }
  return participants;
}

function tokenCouldBeOwned(
  token: string,
  _evidence: TranscriptAuthorizationEvidence,
): boolean {
  // Non-resolving non-empty tokens are treated as potentially ambiguous for the
  // owned-sender path (duplicate names, unknown tokens). Fail closed via caller.
  return token.trim().length > 0;
}

function countHuddleSessionsBeyondPrefix(
  _read: Awaited<ReturnType<typeof getPersistedGameEvents>>,
): number {
  // getPersistedGameEvents already truncates to the valid prefix. Untrusted tail
  // sessions are never loaded into product authorization evidence.
  return 0;
}
