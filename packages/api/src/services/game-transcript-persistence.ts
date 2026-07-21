/**
 * Transaction-scoped product-dialogue persistence.
 *
 * Accepts the caller's transaction (never opens its own). Lock order is always
 * owner → game_transcript_states. Checkpoints append only the missing dialogue
 * suffix and compare-and-advance the durable watermark; terminal settlement
 * reconciles the full projection and seals count/digest/state exactly once.
 *
 * Digest domain: influence.transcript.prefix.v1
 *   empty predecessor = SHA-256("influence.transcript.prefix.v1:empty")
 *   chain step        = SHA-256(domain + "\n" + predecessor + "\n" + u32be(len) + utf8(row))
 */

import { createHash } from "crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { TranscriptEntry } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { TranscriptDialogueKind, TranscriptSafeContext } from "../db/schema.js";
import {
  isCurrentTranscriptCapture,
  isDialogueTranscriptScope,
  TRANSCRIPT_CAPTURE_VERSION,
  TRANSCRIPT_PREFIX_DIGEST_EMPTY,
} from "./transcript-capture.js";
import { serializeTranscriptEntry } from "./transcript-serialization.js";

/** Domain label shared by empty genesis and chained prefix digests. */
export const TRANSCRIPT_PREFIX_DIGEST_DOMAIN = "influence.transcript.prefix.v1" as const;

/** Canonical row field domain (length-prefixed UTF-8 JSON body). */
export const CANONICAL_DIALOGUE_V2_DOMAIN = "influence.transcript.canonicalDialogueV2" as const;

export type ProductDialogueConflictCode =
  | "sparse_suffix"
  | "sequence_gap"
  | "sequence_mismatch"
  | "content_conflict"
  | "watermark_regression"
  | "boundary_regression"
  | "count_mismatch"
  | "state_missing"
  | "state_advance_conflict"
  | "terminal_already_sealed"
  | "invalid_projection";

export class ProductDialoguePersistenceError extends Error {
  constructor(
    public readonly code: ProductDialogueConflictCode,
    message: string,
  ) {
    super(message);
    this.name = "ProductDialoguePersistenceError";
  }
}

/** Fixed-key-order canonical row used for digests and golden vectors. */
export interface CanonicalDialogueV2 {
  sequence: number;
  round: number;
  phase: string;
  scope: string;
  speakerPlayerId: string | null;
  audiencePlayerIds: readonly string[];
  dialogueKind: string | null;
  context: CanonicalDialogueContextV2 | null;
  text: string;
  /** Integral millisecond timestamp; sequence is the durable order authority. */
  timestamp: number;
}

export interface CanonicalDialogueContextV2 {
  version: 1;
  roomId: number | null;
  allianceId: string | null;
  scheduleId: string | null;
  sessionId: string | null;
  window: string | null;
  /** Semantic array — order preserved, not sorted. */
  sessionAudiencePlayerIds: readonly string[] | null;
}

export interface ProductDialogueEvidence {
  version: 1;
  durableSequence: number;
  durableCount: number;
  prefixDigest: string;
  durableEventSequence: number;
  durableEventHash: string | null;
  ownerEpoch: string | null;
}

export interface LockedTranscriptState {
  gameId: string;
  captureVersion: number;
  ownerEpoch: string | null;
  durableEventSequence: number;
  durableEventHash: string | null;
  durableSequence: number;
  durableCount: number;
  prefixDigest: string;
  terminalState: string;
  terminalCount: number | null;
  terminalDigest: string | null;
}

export type TranscriptPersistenceTx = {
  select: DrizzleDB["select"];
  insert: DrizzleDB["insert"];
  update: DrizzleDB["update"];
  execute: DrizzleDB["execute"];
};

export interface PersistProductDialogueAtBoundaryInput {
  gameId: string;
  ownerEpoch: string;
  /** Canonical event sequence of this checkpoint boundary. */
  boundaryEventSequence: number;
  /** Null only for the pre-event initial boundary (sequence 0). */
  boundaryEventHash: string | null;
  /** Full product-dialogue projection (1..N); service slices the suffix. */
  productDialogueProjection: readonly TranscriptEntry[];
  transcriptCaptureVersion: number;
}

export interface PersistProductDialogueAtBoundaryResult {
  evidence: ProductDialogueEvidence;
  insertedSequences: number[];
  /** True when state already matched this boundary (retry no-op). */
  alreadyAtBoundary: boolean;
}

export interface ReconcileTerminalProductDialogueInput {
  gameId: string;
  ownerEpoch: string;
  boundaryEventSequence: number;
  boundaryEventHash: string | null;
  /** Full terminal transcript (dialogue + non-dialogue). */
  transcript: readonly TranscriptEntry[];
  transcriptCaptureVersion: number;
}

export interface ReconcileTerminalProductDialogueResult {
  evidence: ProductDialogueEvidence;
  terminalCount: number;
  terminalDigest: string;
  insertedDialogueSequences: number[];
  insertedNonDialogueCount: number;
}

// ---------------------------------------------------------------------------
// Canonicalization + digests
// ---------------------------------------------------------------------------

/**
 * Build the fixed-key-order canonical dialogue object for a product row.
 * Cognition, DB ids, and settlement metadata are excluded.
 */
export function toCanonicalDialogueV2(entry: TranscriptEntry): CanonicalDialogueV2 {
  if (entry.entrySequence == null || entry.entrySequence < 1) {
    throw new ProductDialoguePersistenceError(
      "invalid_projection",
      "Product dialogue row requires positive entrySequence",
    );
  }
  if (!isDialogueTranscriptScope(entry.scope)) {
    throw new ProductDialoguePersistenceError(
      "invalid_projection",
      `Non-dialogue scope ${entry.scope} cannot enter product dialogue chain`,
    );
  }
  if (!Array.isArray(entry.audiencePlayerIds)) {
    throw new ProductDialoguePersistenceError(
      "invalid_projection",
      `Product dialogue row ${entry.entrySequence} missing audiencePlayerIds`,
    );
  }

  return {
    sequence: entry.entrySequence,
    round: entry.round,
    phase: String(entry.phase),
    scope: entry.scope,
    speakerPlayerId: entry.speakerPlayerId === undefined ? null : entry.speakerPlayerId,
    audiencePlayerIds: normalizeAudienceIds(entry.audiencePlayerIds),
    // Match serializeTranscriptEntry defaults so stored/projected digests agree.
    dialogueKind: entry.dialogueKind ?? defaultDialogueKindForScope(entry.scope),
    context: toCanonicalContext(entry.dialogueContext),
    text: entry.text,
    timestamp: Math.trunc(entry.timestamp),
  };
}

/**
 * Serialize canonicalDialogueV2 as UTF-8 JSON with fixed key insertion order.
 * Context object keys are recursively sorted; sessionAudiencePlayerIds preserves order.
 */
export function canonicalDialogueV2Json(canonical: CanonicalDialogueV2): string {
  // Manual construction guarantees key order independent of runtime key enumeration quirks.
  const contextJson = canonical.context === null
    ? "null"
    : serializeCanonicalContext(canonical.context);
  const audienceJson = JSON.stringify([...canonical.audiencePlayerIds]);
  return (
    `{"sequence":${canonical.sequence}` +
    `,"round":${canonical.round}` +
    `,"phase":${JSON.stringify(canonical.phase)}` +
    `,"scope":${JSON.stringify(canonical.scope)}` +
    `,"speakerPlayerId":${JSON.stringify(canonical.speakerPlayerId)}` +
    `,"audiencePlayerIds":${audienceJson}` +
    `,"dialogueKind":${JSON.stringify(canonical.dialogueKind)}` +
    `,"context":${contextJson}` +
    `,"text":${JSON.stringify(canonical.text)}` +
    `,"timestamp":${canonical.timestamp}}`
  );
}

export function canonicalDialogueV2Bytes(canonical: CanonicalDialogueV2): Buffer {
  return Buffer.from(canonicalDialogueV2Json(canonical), "utf8");
}

/**
 * Chain one length-prefixed canonical row onto a predecessor prefix digest.
 * Length prefix is a big-endian uint32 of the UTF-8 byte length of the row body.
 */
export function chainPrefixDigest(predecessorDigest: string, canonicalRowUtf8: Buffer): string {
  if (!isSha256Digest(predecessorDigest)) {
    throw new ProductDialoguePersistenceError(
      "invalid_projection",
      `Invalid predecessor digest: ${predecessorDigest}`,
    );
  }
  const hash = createHash("sha256");
  hash.update(TRANSCRIPT_PREFIX_DIGEST_DOMAIN);
  hash.update("\n");
  hash.update(predecessorDigest);
  hash.update("\n");
  const lengthPrefix = Buffer.alloc(4);
  lengthPrefix.writeUInt32BE(canonicalRowUtf8.length);
  hash.update(lengthPrefix);
  hash.update(canonicalRowUtf8);
  return `sha256:${hash.digest("hex")}`;
}

/** Compute the chained prefix digest over an ordered 1..N product projection. */
export function computePrefixDigest(
  entries: readonly TranscriptEntry[],
  predecessorDigest: string = TRANSCRIPT_PREFIX_DIGEST_EMPTY,
): string {
  let digest = predecessorDigest;
  for (const entry of entries) {
    const bytes = canonicalDialogueV2Bytes(toCanonicalDialogueV2(entry));
    digest = chainPrefixDigest(digest, bytes);
  }
  return digest;
}

/** Filter and sort product-dialogue entries (dialogue scopes with sequences only). */
export function extractProductDialogueProjection(
  entries: readonly TranscriptEntry[],
): TranscriptEntry[] {
  const dialogue = entries.filter(
    (entry) =>
      isDialogueTranscriptScope(entry.scope) &&
      typeof entry.entrySequence === "number" &&
      entry.entrySequence >= 1,
  );
  return [...dialogue].sort((a, b) => (a.entrySequence ?? 0) - (b.entrySequence ?? 0));
}

export function extractNonDialogueEntries(
  entries: readonly TranscriptEntry[],
): TranscriptEntry[] {
  return entries.filter((entry) => !isDialogueTranscriptScope(entry.scope));
}

export function buildProductDialogueEvidence(
  state: Pick<
    LockedTranscriptState,
    | "durableSequence"
    | "durableCount"
    | "prefixDigest"
    | "durableEventSequence"
    | "durableEventHash"
    | "ownerEpoch"
  >,
): ProductDialogueEvidence {
  return {
    version: 1,
    durableSequence: state.durableSequence,
    durableCount: state.durableCount,
    prefixDigest: state.prefixDigest,
    durableEventSequence: state.durableEventSequence,
    durableEventHash: state.durableEventHash,
    ownerEpoch: state.ownerEpoch,
  };
}

export function parseProductDialogueEvidence(value: unknown): ProductDialogueEvidence | null {
  if (!isRecord(value)) return null;
  const nested = isRecord(value.productDialogue) ? value.productDialogue : value;
  if (nested.version !== 1) return null;
  if (typeof nested.durableSequence !== "number" || nested.durableSequence < 0) return null;
  if (typeof nested.durableCount !== "number" || nested.durableCount < 0) return null;
  if (typeof nested.prefixDigest !== "string" || !isSha256Digest(nested.prefixDigest)) return null;
  if (typeof nested.durableEventSequence !== "number" || nested.durableEventSequence < 0) return null;
  if (
    nested.durableEventHash !== null &&
    nested.durableEventHash !== undefined &&
    (typeof nested.durableEventHash !== "string" || !isSha256Digest(nested.durableEventHash))
  ) {
    return null;
  }
  if (
    nested.ownerEpoch !== null &&
    nested.ownerEpoch !== undefined &&
    typeof nested.ownerEpoch !== "string"
  ) {
    return null;
  }
  return {
    version: 1,
    durableSequence: nested.durableSequence,
    durableCount: nested.durableCount,
    prefixDigest: nested.prefixDigest,
    durableEventSequence: nested.durableEventSequence,
    durableEventHash: nested.durableEventHash === undefined ? null : nested.durableEventHash,
    ownerEpoch: nested.ownerEpoch === undefined ? null : nested.ownerEpoch,
  };
}

export function productEvidenceMatchesState(
  evidence: ProductDialogueEvidence,
  state: LockedTranscriptState,
): boolean {
  return (
    evidence.durableSequence === state.durableSequence &&
    evidence.durableCount === state.durableCount &&
    evidence.prefixDigest === state.prefixDigest &&
    evidence.durableEventSequence === state.durableEventSequence &&
    (evidence.durableEventHash ?? null) === (state.durableEventHash ?? null)
  );
}

// ---------------------------------------------------------------------------
// Transaction primitives
// ---------------------------------------------------------------------------

/** Lock the product transcript state row (caller must already hold the owner lock). */
export async function lockGameTranscriptState(
  tx: TranscriptPersistenceTx,
  gameId: string,
): Promise<LockedTranscriptState | null> {
  const row = (await tx
    .select({
      gameId: schema.gameTranscriptStates.gameId,
      captureVersion: schema.gameTranscriptStates.captureVersion,
      ownerEpoch: schema.gameTranscriptStates.ownerEpoch,
      durableEventSequence: schema.gameTranscriptStates.durableEventSequence,
      durableEventHash: schema.gameTranscriptStates.durableEventHash,
      durableSequence: schema.gameTranscriptStates.durableSequence,
      durableCount: schema.gameTranscriptStates.durableCount,
      prefixDigest: schema.gameTranscriptStates.prefixDigest,
      terminalState: schema.gameTranscriptStates.terminalState,
      terminalCount: schema.gameTranscriptStates.terminalCount,
      terminalDigest: schema.gameTranscriptStates.terminalDigest,
    })
    .from(schema.gameTranscriptStates)
    .where(eq(schema.gameTranscriptStates.gameId, gameId))
    .for("update")
    .limit(1))[0];
  return row ?? null;
}

export async function readGameTranscriptState(
  db: Pick<DrizzleDB, "select">,
  gameId: string,
): Promise<LockedTranscriptState | null> {
  const row = (await db
    .select({
      gameId: schema.gameTranscriptStates.gameId,
      captureVersion: schema.gameTranscriptStates.captureVersion,
      ownerEpoch: schema.gameTranscriptStates.ownerEpoch,
      durableEventSequence: schema.gameTranscriptStates.durableEventSequence,
      durableEventHash: schema.gameTranscriptStates.durableEventHash,
      durableSequence: schema.gameTranscriptStates.durableSequence,
      durableCount: schema.gameTranscriptStates.durableCount,
      prefixDigest: schema.gameTranscriptStates.prefixDigest,
      terminalState: schema.gameTranscriptStates.terminalState,
      terminalCount: schema.gameTranscriptStates.terminalCount,
      terminalDigest: schema.gameTranscriptStates.terminalDigest,
    })
    .from(schema.gameTranscriptStates)
    .where(eq(schema.gameTranscriptStates.gameId, gameId))
    .limit(1))[0];
  return row ?? null;
}

/**
 * Validate projection shape, verify durable prefix identity, insert missing suffix,
 * and compare-and-advance the watermark to the given boundary.
 */
export async function persistProductDialogueAtBoundary(
  tx: TranscriptPersistenceTx,
  input: PersistProductDialogueAtBoundaryInput,
): Promise<PersistProductDialogueAtBoundaryResult> {
  if (!isCurrentTranscriptCapture(input.transcriptCaptureVersion)) {
    throw new ProductDialoguePersistenceError(
      "invalid_projection",
      "persistProductDialogueAtBoundary requires current transcript capture",
    );
  }

  const state = await lockGameTranscriptState(tx, input.gameId);
  if (!state) {
    throw new ProductDialoguePersistenceError(
      "state_missing",
      `No game_transcript_states row for game ${input.gameId}`,
    );
  }

  const projection = normalizeAndValidateProjection(input.productDialogueProjection);

  // Reject lower logical boundaries (event sequence regression).
  if (input.boundaryEventSequence < state.durableEventSequence) {
    throw new ProductDialoguePersistenceError(
      "boundary_regression",
      `Boundary ${input.boundaryEventSequence} is behind durable event ${state.durableEventSequence}`,
    );
  }

  // Projection must cover at least the durable prefix.
  if (projection.length < state.durableSequence) {
    throw new ProductDialoguePersistenceError(
      "watermark_regression",
      `Projection length ${projection.length} is behind durableSequence ${state.durableSequence}`,
    );
  }

  await assertStoredPrefixMatches(tx, input.gameId, state, projection);

  const sameBoundary =
    state.durableEventSequence === input.boundaryEventSequence &&
    state.durableEventHash === input.boundaryEventHash &&
    state.ownerEpoch === input.ownerEpoch;
  const suffix = projection.slice(state.durableSequence);
  validateContiguousSuffix(suffix, state.durableSequence);

  // Exact retry at this boundary with no new dialogue → no-op success.
  if (sameBoundary && suffix.length === 0) {
    if (state.durableCount !== state.durableSequence) {
      throw new ProductDialoguePersistenceError(
        "count_mismatch",
        `Stored count ${state.durableCount} != sequence ${state.durableSequence}`,
      );
    }
    return {
      evidence: buildProductDialogueEvidence(state),
      insertedSequences: [],
      alreadyAtBoundary: true,
    };
  }

  let nextDigest = state.prefixDigest;
  const insertedSequences: number[] = [];
  if (suffix.length > 0) {
    const rows = suffix.map((entry) => {
      const insertRow = serializeTranscriptEntry(input.gameId, entry, {
        transcriptCaptureVersion: input.transcriptCaptureVersion,
      });
      // firstDurableEventSequence is positive-only; leave null at the empty initial boundary.
      if (input.boundaryEventSequence > 0) {
        insertRow.firstDurableEventSequence = input.boundaryEventSequence;
      }
      const bytes = canonicalDialogueV2Bytes(toCanonicalDialogueV2(entry));
      nextDigest = chainPrefixDigest(nextDigest, bytes);
      insertedSequences.push(entry.entrySequence!);
      return insertRow;
    });

    const chunkSize = 100;
    for (let index = 0; index < rows.length; index += chunkSize) {
      await tx.insert(schema.transcripts).values(rows.slice(index, index + chunkSize));
    }
  } else {
    // Empty suffix at a newer boundary still advances owner/event identity.
    nextDigest = state.prefixDigest;
  }

  const nextSequence = state.durableSequence + suffix.length;
  const nextCount = nextSequence;

  const advanced = await compareAndAdvanceTranscriptState(tx, {
    gameId: input.gameId,
    expected: state,
    next: {
      ownerEpoch: input.ownerEpoch,
      durableEventSequence: input.boundaryEventSequence,
      durableEventHash: input.boundaryEventHash,
      durableSequence: nextSequence,
      durableCount: nextCount,
      prefixDigest: nextDigest,
    },
  });

  return {
    evidence: buildProductDialogueEvidence(advanced),
    insertedSequences,
    alreadyAtBoundary: false,
  };
}

/**
 * Terminal settlement: reconcile full product dialogue, insert non-dialogue rows,
 * and seal terminal count/digest/state. Caller holds owner lock and settlement lock.
 */
export async function reconcileTerminalProductDialogue(
  tx: TranscriptPersistenceTx,
  input: ReconcileTerminalProductDialogueInput,
): Promise<ReconcileTerminalProductDialogueResult> {
  if (!isCurrentTranscriptCapture(input.transcriptCaptureVersion)) {
    throw new ProductDialoguePersistenceError(
      "invalid_projection",
      "reconcileTerminalProductDialogue requires current transcript capture",
    );
  }

  const state = await lockGameTranscriptState(tx, input.gameId);
  if (!state) {
    throw new ProductDialoguePersistenceError(
      "state_missing",
      `No game_transcript_states row for game ${input.gameId}`,
    );
  }

  if (state.terminalState === "complete") {
    // Exact-once: verify the sealed terminal matches this projection.
    const projection = normalizeAndValidateProjection(
      extractProductDialogueProjection(input.transcript),
    );
    const digest = computePrefixDigest(projection);
    if (
      state.terminalCount !== projection.length ||
      state.terminalDigest !== digest ||
      state.durableSequence !== projection.length ||
      state.prefixDigest !== digest
    ) {
      throw new ProductDialoguePersistenceError(
        "content_conflict",
        `Terminal seal for game ${input.gameId} conflicts with projection`,
      );
    }
    return {
      evidence: buildProductDialogueEvidence(state),
      terminalCount: state.terminalCount ?? projection.length,
      terminalDigest: state.terminalDigest ?? digest,
      insertedDialogueSequences: [],
      insertedNonDialogueCount: 0,
    };
  }

  if (state.terminalState !== "unset") {
    throw new ProductDialoguePersistenceError(
      "terminal_already_sealed",
      `Transcript terminal state is ${state.terminalState}`,
    );
  }

  // Advance live watermark to the terminal boundary first (inserts missing suffix).
  const boundaryResult = await persistProductDialogueAtBoundary(tx, {
    gameId: input.gameId,
    ownerEpoch: input.ownerEpoch,
    boundaryEventSequence: input.boundaryEventSequence,
    boundaryEventHash: input.boundaryEventHash,
    productDialogueProjection: extractProductDialogueProjection(input.transcript),
    transcriptCaptureVersion: input.transcriptCaptureVersion,
  });

  // Non-dialogue (diary/thinking) is outside the product watermark but still terminal-persisted.
  const nonDialogue = extractNonDialogueEntries(input.transcript);
  let insertedNonDialogueCount = 0;
  if (nonDialogue.length > 0) {
    // Best-effort presence check: non-dialogue rows have no sequence identity.
    // Insert only when no non-dialogue rows exist yet for this game (exact-once retry).
    const existingNonDialogue = (await tx
      .select({ id: schema.transcripts.id })
      .from(schema.transcripts)
      .where(and(
        eq(schema.transcripts.gameId, input.gameId),
        sql`${schema.transcripts.scope} IN ('diary', 'thinking')`,
      ))
      .limit(1))[0];
    if (!existingNonDialogue) {
      const rows = nonDialogue.map((entry) =>
        serializeTranscriptEntry(input.gameId, entry, {
          transcriptCaptureVersion: input.transcriptCaptureVersion,
        }),
      );
      const chunkSize = 100;
      for (let index = 0; index < rows.length; index += chunkSize) {
        await tx.insert(schema.transcripts).values(rows.slice(index, index + chunkSize));
      }
      insertedNonDialogueCount = rows.length;
    }
  }

  const sealed = await sealTerminalTranscriptState(tx, {
    gameId: input.gameId,
    expectedPrefixDigest: boundaryResult.evidence.prefixDigest,
    expectedDurableSequence: boundaryResult.evidence.durableSequence,
    terminalCount: boundaryResult.evidence.durableCount,
    terminalDigest: boundaryResult.evidence.prefixDigest,
  });

  return {
    evidence: buildProductDialogueEvidence(sealed),
    terminalCount: sealed.terminalCount ?? boundaryResult.evidence.durableCount,
    terminalDigest: sealed.terminalDigest ?? boundaryResult.evidence.prefixDigest,
    insertedDialogueSequences: boundaryResult.insertedSequences,
    insertedNonDialogueCount,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function normalizeAndValidateProjection(
  entries: readonly TranscriptEntry[],
): TranscriptEntry[] {
  const projection = extractProductDialogueProjection(entries);
  if (projection.length === 0) return projection;

  for (let i = 0; i < projection.length; i++) {
    const entry = projection[i]!;
    const expected = i + 1;
    if (entry.entrySequence !== expected) {
      throw new ProductDialoguePersistenceError(
        "sparse_suffix",
        `Product dialogue projection is not contiguous at index ${i}: expected sequence ${expected}, got ${entry.entrySequence}`,
      );
    }
    // Force canonical validation (throws on missing fields).
    toCanonicalDialogueV2(entry);
  }
  return projection;
}

function validateContiguousSuffix(
  suffix: readonly TranscriptEntry[],
  predecessorSequence: number,
): void {
  for (let i = 0; i < suffix.length; i++) {
    const expected = predecessorSequence + i + 1;
    if (suffix[i]!.entrySequence !== expected) {
      throw new ProductDialoguePersistenceError(
        "sparse_suffix",
        `Suffix not contiguous: expected ${expected}, got ${suffix[i]!.entrySequence}`,
      );
    }
  }
}

async function assertStoredPrefixMatches(
  tx: TranscriptPersistenceTx,
  gameId: string,
  state: LockedTranscriptState,
  projection: readonly TranscriptEntry[],
): Promise<void> {
  if (state.durableSequence === 0) {
    if (state.durableCount !== 0 || state.prefixDigest !== TRANSCRIPT_PREFIX_DIGEST_EMPTY) {
      throw new ProductDialoguePersistenceError(
        "count_mismatch",
        "Empty watermark must have count 0 and genesis digest",
      );
    }
    return;
  }

  const stored = await tx
    .select({
      entrySequence: schema.transcripts.entrySequence,
      round: schema.transcripts.round,
      phase: schema.transcripts.phase,
      scope: schema.transcripts.scope,
      speakerPlayerId: schema.transcripts.speakerPlayerId,
      audiencePlayerIds: schema.transcripts.audiencePlayerIds,
      dialogueKind: schema.transcripts.dialogueKind,
      safeContext: schema.transcripts.safeContext,
      text: schema.transcripts.text,
      timestamp: schema.transcripts.timestamp,
    })
    .from(schema.transcripts)
    .where(and(
      eq(schema.transcripts.gameId, gameId),
      sql`${schema.transcripts.entrySequence} IS NOT NULL`,
      sql`${schema.transcripts.entrySequence} <= ${state.durableSequence}`,
    ))
    .orderBy(asc(schema.transcripts.entrySequence));

  if (stored.length !== state.durableSequence || stored.length !== state.durableCount) {
    throw new ProductDialoguePersistenceError(
      "count_mismatch",
      `Stored dialogue rows ${stored.length} do not match durableSequence ${state.durableSequence}`,
    );
  }

  let digest: string = TRANSCRIPT_PREFIX_DIGEST_EMPTY;
  for (let i = 0; i < stored.length; i++) {
    const row = stored[i]!;
    const sequence = row.entrySequence;
    if (sequence !== i + 1) {
      throw new ProductDialoguePersistenceError(
        "sequence_gap",
        `Stored dialogue gap at sequence ${i + 1}`,
      );
    }
    const projected = projection[i];
    if (!projected || projected.entrySequence !== sequence) {
      throw new ProductDialoguePersistenceError(
        "sequence_mismatch",
        `Projection missing durable sequence ${sequence}`,
      );
    }
    const projectedCanonical = toCanonicalDialogueV2(projected);
    const storedCanonical = storedRowToCanonical(row);
    if (canonicalDialogueV2Json(projectedCanonical) !== canonicalDialogueV2Json(storedCanonical)) {
      throw new ProductDialoguePersistenceError(
        "content_conflict",
        `Content conflict at product dialogue sequence ${sequence}`,
      );
    }
    digest = chainPrefixDigest(digest, canonicalDialogueV2Bytes(storedCanonical));
  }

  if (digest !== state.prefixDigest) {
    throw new ProductDialoguePersistenceError(
      "content_conflict",
      "Recomputed stored prefix digest does not match game_transcript_states",
    );
  }
}

function storedRowToCanonical(row: {
  entrySequence: number | null;
  round: number;
  phase: string;
  scope: string;
  speakerPlayerId: string | null;
  audiencePlayerIds: string[] | null;
  dialogueKind: TranscriptDialogueKind | null;
  safeContext: TranscriptSafeContext | null;
  text: string;
  timestamp: number;
}): CanonicalDialogueV2 {
  if (row.entrySequence == null || row.entrySequence < 1) {
    throw new ProductDialoguePersistenceError("sequence_gap", "Stored row missing sequence");
  }
  if (!Array.isArray(row.audiencePlayerIds)) {
    throw new ProductDialoguePersistenceError(
      "content_conflict",
      `Stored row ${row.entrySequence} missing audience`,
    );
  }
  return {
    sequence: row.entrySequence,
    round: row.round,
    phase: row.phase,
    scope: row.scope,
    speakerPlayerId: row.speakerPlayerId,
    audiencePlayerIds: normalizeAudienceIds(row.audiencePlayerIds),
    dialogueKind: row.dialogueKind,
    context: toCanonicalContext(row.safeContext ?? undefined),
    text: row.text,
    timestamp: Math.trunc(row.timestamp),
  };
}

async function compareAndAdvanceTranscriptState(
  tx: TranscriptPersistenceTx,
  params: {
    gameId: string;
    expected: LockedTranscriptState;
    next: {
      ownerEpoch: string;
      durableEventSequence: number;
      durableEventHash: string | null;
      durableSequence: number;
      durableCount: number;
      prefixDigest: string;
    };
  },
): Promise<LockedTranscriptState> {
  if (params.next.durableCount !== params.next.durableSequence) {
    throw new ProductDialoguePersistenceError(
      "count_mismatch",
      "Advance requires durableCount === durableSequence",
    );
  }
  if (params.next.durableSequence < params.expected.durableSequence) {
    throw new ProductDialoguePersistenceError(
      "watermark_regression",
      "Refusing to regress durableSequence",
    );
  }
  if (params.next.durableEventSequence < params.expected.durableEventSequence) {
    throw new ProductDialoguePersistenceError(
      "boundary_regression",
      "Refusing to regress durableEventSequence",
    );
  }

  const updatedAt = new Date().toISOString();
  const updated = (await tx
    .update(schema.gameTranscriptStates)
    .set({
      ownerEpoch: params.next.ownerEpoch,
      durableEventSequence: params.next.durableEventSequence,
      durableEventHash: params.next.durableEventHash,
      durableSequence: params.next.durableSequence,
      durableCount: params.next.durableCount,
      prefixDigest: params.next.prefixDigest,
      updatedAt,
    })
    .where(and(
      eq(schema.gameTranscriptStates.gameId, params.gameId),
      eq(schema.gameTranscriptStates.durableSequence, params.expected.durableSequence),
      eq(schema.gameTranscriptStates.durableCount, params.expected.durableCount),
      eq(schema.gameTranscriptStates.prefixDigest, params.expected.prefixDigest),
      eq(schema.gameTranscriptStates.durableEventSequence, params.expected.durableEventSequence),
      eq(schema.gameTranscriptStates.terminalState, "unset"),
    ))
    .returning({
      gameId: schema.gameTranscriptStates.gameId,
      captureVersion: schema.gameTranscriptStates.captureVersion,
      ownerEpoch: schema.gameTranscriptStates.ownerEpoch,
      durableEventSequence: schema.gameTranscriptStates.durableEventSequence,
      durableEventHash: schema.gameTranscriptStates.durableEventHash,
      durableSequence: schema.gameTranscriptStates.durableSequence,
      durableCount: schema.gameTranscriptStates.durableCount,
      prefixDigest: schema.gameTranscriptStates.prefixDigest,
      terminalState: schema.gameTranscriptStates.terminalState,
      terminalCount: schema.gameTranscriptStates.terminalCount,
      terminalDigest: schema.gameTranscriptStates.terminalDigest,
    }))[0];

  if (!updated) {
    throw new ProductDialoguePersistenceError(
      "state_advance_conflict",
      `Compare-and-advance failed for game ${params.gameId}`,
    );
  }
  return updated;
}

async function sealTerminalTranscriptState(
  tx: TranscriptPersistenceTx,
  params: {
    gameId: string;
    expectedPrefixDigest: string;
    expectedDurableSequence: number;
    terminalCount: number;
    terminalDigest: string;
  },
): Promise<LockedTranscriptState> {
  const updatedAt = new Date().toISOString();
  const updated = (await tx
    .update(schema.gameTranscriptStates)
    .set({
      terminalState: "complete",
      terminalCount: params.terminalCount,
      terminalDigest: params.terminalDigest,
      updatedAt,
    })
    .where(and(
      eq(schema.gameTranscriptStates.gameId, params.gameId),
      eq(schema.gameTranscriptStates.prefixDigest, params.expectedPrefixDigest),
      eq(schema.gameTranscriptStates.durableSequence, params.expectedDurableSequence),
      eq(schema.gameTranscriptStates.terminalState, "unset"),
    ))
    .returning({
      gameId: schema.gameTranscriptStates.gameId,
      captureVersion: schema.gameTranscriptStates.captureVersion,
      ownerEpoch: schema.gameTranscriptStates.ownerEpoch,
      durableEventSequence: schema.gameTranscriptStates.durableEventSequence,
      durableEventHash: schema.gameTranscriptStates.durableEventHash,
      durableSequence: schema.gameTranscriptStates.durableSequence,
      durableCount: schema.gameTranscriptStates.durableCount,
      prefixDigest: schema.gameTranscriptStates.prefixDigest,
      terminalState: schema.gameTranscriptStates.terminalState,
      terminalCount: schema.gameTranscriptStates.terminalCount,
      terminalDigest: schema.gameTranscriptStates.terminalDigest,
    }))[0];

  if (!updated) {
    throw new ProductDialoguePersistenceError(
      "state_advance_conflict",
      `Terminal seal failed for game ${params.gameId}`,
    );
  }
  return updated;
}

function toCanonicalContext(
  context: TranscriptEntry["dialogueContext"] | TranscriptSafeContext | undefined,
): CanonicalDialogueContextV2 | null {
  if (!context) {
    return {
      version: 1,
      roomId: null,
      allianceId: null,
      scheduleId: null,
      sessionId: null,
      window: null,
      sessionAudiencePlayerIds: null,
    };
  }
  return {
    version: 1,
    roomId: context.roomId === undefined ? null : context.roomId,
    allianceId: context.allianceId === undefined ? null : context.allianceId,
    scheduleId: context.scheduleId === undefined ? null : context.scheduleId,
    sessionId: context.sessionId === undefined ? null : context.sessionId,
    window: context.window === undefined ? null : context.window,
    sessionAudiencePlayerIds:
      context.sessionAudiencePlayerIds === undefined
        ? null
        : [...context.sessionAudiencePlayerIds],
  };
}

/**
 * Serialize context with recursively sorted keys. Semantic arrays keep order.
 * Fixed logical field set so nulls are explicit and digests are stable.
 */
function serializeCanonicalContext(context: CanonicalDialogueContextV2): string {
  // Fixed field order for context (not alphabetically sorted) so golden vectors are stable.
  // Plan says "context object keys recursively sorted" — use alphabetical for nested objects;
  // this context is flat, so alphabetical key order:
  // allianceId, roomId, scheduleId, sessionAudiencePlayerIds, sessionId, version, window
  const parts: string[] = [];
  parts.push(`"allianceId":${JSON.stringify(context.allianceId)}`);
  parts.push(`"roomId":${JSON.stringify(context.roomId)}`);
  parts.push(`"scheduleId":${JSON.stringify(context.scheduleId)}`);
  parts.push(
    `"sessionAudiencePlayerIds":${
      context.sessionAudiencePlayerIds === null
        ? "null"
        : JSON.stringify([...context.sessionAudiencePlayerIds])
    }`,
  );
  parts.push(`"sessionId":${JSON.stringify(context.sessionId)}`);
  parts.push(`"version":1`);
  parts.push(`"window":${JSON.stringify(context.window)}`);
  return `{${parts.join(",")}}`;
}

function normalizeAudienceIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function defaultDialogueKindForScope(scope: TranscriptEntry["scope"]): string | null {
  switch (scope) {
    case "public":
      return "public_speech";
    case "mingle":
      return "mingle_speech";
    case "huddle":
      return "huddle_speech";
    case "whisper":
      return "whisper_speech";
    default:
      return null;
  }
}

function isSha256Digest(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Re-export capture constants used by callers/tests. */
export {
  TRANSCRIPT_CAPTURE_VERSION,
  TRANSCRIPT_PREFIX_DIGEST_EMPTY,
  isCurrentTranscriptCapture,
};

/** Load stored product dialogue rows beyond a watermark (diagnostic helper). */
export async function loadProductDialogueRowsAfter(
  tx: TranscriptPersistenceTx,
  gameId: string,
  afterSequence: number,
): Promise<Array<{ entrySequence: number | null; text: string }>> {
  return tx
    .select({
      entrySequence: schema.transcripts.entrySequence,
      text: schema.transcripts.text,
    })
    .from(schema.transcripts)
    .where(and(
      eq(schema.transcripts.gameId, gameId),
      gt(schema.transcripts.entrySequence, afterSequence),
    ))
    .orderBy(asc(schema.transcripts.entrySequence));
}
