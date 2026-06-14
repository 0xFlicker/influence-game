import { beforeEach, describe, expect, test } from "bun:test";
import { Phase } from "@influence/engine";
import { sha256StableJson } from "../services/stable-hash.js";
import { setupTestDB } from "./test-utils.js";
import type { DrizzleDB } from "../db/index.js";
import {
  insertGame,
  insertOwner,
  createCanonicalEventFixture,
  createCheckpointCapsule,
  enrichCapsuleForV1Candidate,
  buildSealedRuntimeSnapshot,
} from "./durable-run-test-utils.js";
import { appendGameEvents } from "../services/game-events.js";
import { hashCanonicalEvent } from "../services/game-events.js";
import { writeGameCheckpoint } from "../services/game-checkpoints.js";
import { getDurableRunInspection } from "../services/game-durable-run.js";
import {
  deriveHydrationPassport,
  forensicOnlyPassport,
} from "../services/checkpoint-hydration-passport.js";

function deriveInput(
  capsule: ReturnType<typeof createCheckpointCapsule>,
  overrides: {
    ownerEpoch?: string;
    eventHeadHash?: string;
    snapshot?: unknown;
    transcriptCursor?: unknown;
    tokenCostCursor?: unknown;
  } = {},
) {
  const eventHeadHash = overrides.eventHeadHash ?? "sha256:fixture";
  const projectionHash = sha256StableJson(capsule.projection);
  return {
    lastEventSequence: capsule.lastEventSequence,
    checkpointKind: capsule.checkpointKind,
    hydrateable: capsule.hydrateable,
    hydrationStatus: capsule.hydrationStatus,
    snapshot: overrides.snapshot ?? { eventCount: capsule.eventCount },
    transcriptCursor: overrides.transcriptCursor ?? capsule.transcriptCursor,
    tokenCostCursor: overrides.tokenCostCursor ?? capsule.tokenCostCursor,
    eventHeadHash,
    projectionHash,
    checkpointPhase: capsule.phase,
    checkpointRound: capsule.round,
    checkpointOwnerEpoch: overrides.ownerEpoch ?? "owner-1",
    degradedReason: "forensic_only_missing_runtime_hydration_inputs",
    createdAt: "2026-06-14T00:00:00.000Z",
    eventLogStatus: "complete" as const,
    projectionStatus: "replayed",
    hasValidEventPrefixUpTo: () => true,
    hasValidProjectionUpTo: () => true,
  };
}

describe("checkpoint hydration passport validator", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("existing forensic checkpoint rows report missing required stamps and are non-candidate", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);

    await appendGameEvents(db, { gameId, ownerEpoch, events });
    const capsule = createCheckpointCapsule(events);
    const writeRes = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint: capsule });
    expect(writeRes.ok).toBeTrue();

    const result = await getDurableRunInspection(db, gameId);
    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error("unexpected");

    const entry = result.response.checkpoints.entries[0]!;
    expect(entry.hydrateable).toBeFalse();
    expect(entry.passport.verdict).not.toBe("hydration_candidate");
    expect(entry.resumeAvailable).toBeFalse();
    expect(entry.passport.stamps.some((stamp) => stamp.id === "actorWitness" && stamp.status === "missing")).toBeTrue();
  });

  test("complete positive v1 fixture yields hydration_candidate", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("pos-cand"));
    const ownerEpoch = "owner-positive";
    const eventHeadHash = "sha256:positive-boundary";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const fullSnapshot = {
      eventCount: base.eventCount,
      state: base.state,
      projectionSummary: base.projectionSummary,
      manifestVersion: positive.snapshotManifest!.version,
      manifest: positive.snapshotManifest,
      boundaryCertificate: positive.boundaryCertificate,
      runtimeSnapshot: positive.runtimeSnapshot,
      playerContinuityCapsules: positive.playerContinuityCapsules,
      houseContinuityCapsule: positive.houseContinuityCapsule,
      expectedActivePlayerIds: ["atlas", "echo", "mira", "nyx"],
    };

    const res = deriveHydrationPassport({
      ...deriveInput(base, { ownerEpoch, eventHeadHash, snapshot: fullSnapshot }),
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
      degradedReason: null,
    });

    expect(res.passport.verdict).toBe("hydration_candidate");
    expect(res.passport.stamps.every((stamp) => stamp.status === "passed" && !stamp.blocking)).toBeTrue();
  });

  test("forensicOnlyPassport helper is non-candidate with all required stamps missing", () => {
    const passport = forensicOnlyPassport(42);
    expect(passport.verdict).toBe("forensic_only");
    expect(passport.stamps.length).toBe(12);
    expect(passport.stamps.every((stamp) => stamp.status === "missing" && stamp.blocking)).toBeTrue();
  });

  test("actor witness phase mismatch fails actor stamp", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("actor-mismatch"));
    const ownerEpoch = "owner-actor";
    const eventHeadHash = hashCanonicalEvent(createCanonicalEventFixture("actor-mismatch").at(-1)!);
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const runtimeSnapshot = positive.runtimeSnapshot!;
    runtimeSnapshot.actorWitness.contextSummary.phase = Phase.LOBBY;

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
      },
      transcriptCursor: positive.transcriptCursor,
    }));

    const actorStamp = res.passport.stamps.find((stamp) => stamp.id === "actorWitness");
    expect(actorStamp?.status).toBe("failed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  test("accumulator not_v1_hydratable without proof fails accumulator stamp", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("accum-fail"));
    const ownerEpoch = "owner-accum";
    const eventHeadHash = "sha256:accum";
    const runtimeSnapshot = buildSealedRuntimeSnapshot({
      ownerEpoch,
      eventHeadHash,
      projectionHash: sha256StableJson(base.projection),
      capsule: base,
    });
    runtimeSnapshot.accumulatorRegistry.entries = runtimeSnapshot.accumulatorRegistry.entries.map((entry) =>
      entry.id === "mingleInbox"
        ? { id: entry.id, status: "not_v1_hydratable" }
        : entry,
    );

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: { runtimeSnapshot, projectionSummary: base.projectionSummary },
    }));

    const accumStamp = res.passport.stamps.find((stamp) => stamp.id === "accumulatorRegistry");
    expect(accumStamp?.status).toBe("failed");
  });

  test("entry-count-only transcript evidence fails transcript stamp", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("transcript-fail"));
    const res = deriveHydrationPassport(deriveInput(base, {
      transcriptCursor: { entries: 12 },
    }));

    const transcriptStamp = res.passport.stamps.find((stamp) => stamp.id === "transcriptCursor");
    expect(transcriptStamp?.status).toBe("failed");
  });

  test("live DB write plus durable-run inspection returns hydration_candidate", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const base = createCheckpointCapsule(events);
    const eventHeadHash = hashCanonicalEvent(events.at(-1)!);
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const writeRes = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint: positive });
    expect(writeRes.ok).toBeTrue();

    const inspection = await getDurableRunInspection(db, gameId);
    expect(inspection.ok).toBeTrue();
    if (!inspection.ok) throw new Error("inspection failed");

    const entry = inspection.response.checkpoints.entries[0]!;
    expect(entry.passport.verdict).toBe("hydration_candidate");
    expect(entry.resumeAvailable).toBeFalse();
    expect(entry.hydrateable).toBeFalse();
    expect(JSON.stringify(inspection.response)).not.toContain("strategyPacket");
  });

  test("privacy stamp blocks raw reasoning fields in continuity capsules", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("g-private"));
    const ownerEpoch = "owner-private";
    const eventHeadHash = "sha256:privacy";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const capsules = positive.playerContinuityCapsules ?? [];
    capsules[0] = { ...capsules[0]!, reasoningContext: "must not pass readiness" } as typeof capsules[0];

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot: positive.runtimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        playerContinuityCapsules: capsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
      },
      transcriptCursor: positive.transcriptCursor,
    }));

    const privacyStamp = res.passport.stamps.find((stamp) => stamp.id === "privacy");
    expect(privacyStamp?.status).toBe("failed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });
});