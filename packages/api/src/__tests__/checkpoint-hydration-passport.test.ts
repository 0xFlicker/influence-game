import { beforeEach, describe, expect, test } from "bun:test";
import { setupTestDB } from "./test-utils.js";
import type { DrizzleDB } from "../db/index.js";
import { insertGame, insertOwner, createCanonicalEventFixture, createCheckpointCapsule, insertCanonicalEventRows } from "./durable-run-test-utils.js";
import { appendGameEvents } from "../services/game-events.js";
import { writeGameCheckpoint } from "../services/game-checkpoints.js";
import { getDurableRunInspection } from "../services/game-durable-run.js";
import {
  deriveHydrationPassport,
  forensicOnlyPassport,
} from "../services/checkpoint-hydration-passport.js";

describe("checkpoint hydration passport validator (U1 skeleton)", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("existing forensic checkpoint rows report missing required stamps and are non-candidate", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId); // default lastPersisted=0; append will advance
    const events = createCanonicalEventFixture(gameId);

    await appendGameEvents(db, { gameId, ownerEpoch, events });
    const capsule = createCheckpointCapsule(events);
    // write will force hydrateable=false + old missing list
    const writeRes = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint: capsule });
    expect(writeRes.ok).toBeTrue();

    const result = await getDurableRunInspection(db, gameId);
    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error("unexpected");

    expect(result.response.checkpoints.count).toBe(1);
    const entry = result.response.checkpoints.entries[0]!;
    expect(entry.hydrateable).toBeFalse();
    expect(entry.passport.verdict).not.toBe("hydration_candidate");
    expect(["forensic_only", "blocked"]).toContain(entry.passport.verdict);

    const stampIds = entry.passport.stamps.map((s) => s.id);
    expect(stampIds).toEqual([
      "eventLogReplay",
      "projectionReplay",
      "boundaryCertificate",
      "snapshotManifest",
      "transcriptCursor",
      "tokenCursor",
      "playerContinuity",
      "houseContinuity",
      "ownerEpoch",
      "privacy",
    ]);

    // The write path adds a receipt-backed boundary cert, but the manifest still
    // advertises missing runtime subsystems -> overall blocked/non-candidate.
    const continuityStamps = entry.passport.stamps.filter((s) => s.id === "playerContinuity" || s.id === "houseContinuity");
    expect(continuityStamps.every((s) => s.status === "missing" && s.blocking)).toBeTrue();

    const boundaryStamp = entry.passport.stamps.find((s) => s.id === "boundaryCertificate");
    expect(boundaryStamp?.status).toBe("passed");

    const manifestStamp = entry.passport.stamps.find((s) => s.id === "snapshotManifest");
    expect(manifestStamp?.status).toBe("failed");
  });

  test("malformed hydration status fails closed (produces blocking diagnostic and non-candidate)", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId, { lastPersistedEventSequence: 4 });
    const events = createCanonicalEventFixture(gameId);
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);

    // Manually insert a bad row (bypass normal write which guards)
    await db.insert((await import("../db/index.js")).schema.gameCheckpoints).values({
      id: "bad-checkpoint",
      gameId,
      ownerEpoch,
      lastEventSequence: 4,
      checkpointKind: "phase_boundary",
      phase: "VOTE",
      round: 1,
      eventHeadHash: "sha256:bad",
      projectionHash: "sha256:badproj",
      hydrateable: true, // lie
      hydrationStatus: { foo: "not a proper list" }, // malformed for the old path too
      snapshot: {},
      transcriptCursor: null,
      tokenCostCursor: null,
      degradedReason: "test-malformed",
      createdAt: "2026-06-14T00:00:00.000Z",
    });

    const result = await getDurableRunInspection(db, gameId);
    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error("unexpected");

    const entry = result.response.checkpoints.entries[0]!;
    expect(entry.hydrateable).toBeFalse(); // forced closed
    expect(entry.passport.verdict).not.toBe("hydration_candidate");
    expect(result.response.diagnostics.some((d) => d.code === "malformed_checkpoint_hydration_status")).toBeTrue();
  });

  test("deriveHydrationPassport on raw forensic shape produces blocking stamps and non-candidate verdict", () => {
    const forensic = createCheckpointCapsule(createCanonicalEventFixture("g1"));
    const res = deriveHydrationPassport({
      lastEventSequence: forensic.lastEventSequence,
      checkpointKind: forensic.checkpointKind,
      hydrateable: forensic.hydrateable,
      hydrationStatus: forensic.hydrationStatus,
      snapshot: { eventCount: forensic.eventCount },
      transcriptCursor: forensic.transcriptCursor,
      tokenCostCursor: forensic.tokenCostCursor,
      eventHeadHash: "sha256:fixture",
      checkpointOwnerEpoch: "owner-1",
      degradedReason: "forensic_only_missing_runtime_hydration_inputs",
      createdAt: "2026-06-14T00:00:00.000Z",
      eventLogStatus: "complete",
      projectionStatus: "replayed",
      hasValidEventPrefixUpTo: () => true,
      hasValidProjectionUpTo: () => true,
    });

    expect(res.passport.verdict).toBe("blocked"); // has evidence -> blocked, not forensic_only
    // With U2-U4, manifest/boundary/transcript/token may pass depending on overrides; continuity still missing (U5)
    const missingOrFailedBlocking = res.passport.stamps.filter((s) => (s.status === "missing" || s.status === "failed") && s.blocking);
    expect(missingOrFailedBlocking.length).toBeGreaterThanOrEqual(2); // at least player + house continuity
    expect(res.passport.stamps.every((s) => s.blocking || s.status === "passed")).toBeTrue();
  });

  test("complete positive fixture (all stamps including continuity capsules) yields hydration_candidate", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("pos-cand"));
    if (!base.snapshotManifest) throw new Error("expected checkpoint fixture manifest");
    const capturedManifest = {
      ...base.snapshotManifest,
      components: Object.fromEntries(
        Object.keys(base.snapshotManifest.components).map((key) => [key, { status: "captured", version: 1 }]),
      ) as typeof base.snapshotManifest.components,
    };
    const eventHeadHash = "sha256:positive-boundary";
    const playerContinuityCapsules = ["atlas", "echo", "mira", "nyx"].map((playerId) => ({
      playerId,
      playerName: playerId,
      strategyPacket: null,
      reflectionSummary: null,
      notes: [],
      commitments: [],
      relationships: { allies: [], threats: [] },
      powerActionMemory: null,
      roundHistory: [],
    }));
    // Simulate DB snapshot row shape containing everything the write service persists
    const fullSnapshot = {
      eventCount: base.eventCount,
      state: base.state,
      projectionSummary: base.projectionSummary,
      manifestVersion: capturedManifest.version,
      manifest: capturedManifest,
      boundaryCertificate: {
        ...base.boundaryCertificate,
        ownerEpoch: "owner-positive",
        eventCommitReceipt: { sequence: base.lastEventSequence, hash: eventHeadHash },
      },
      playerContinuityCapsules,
      houseContinuityCapsule: {
        revisionId: "h1",
        previousRevisionId: null,
        updatedAtRound: 1,
        updatedAtPhase: "INIT",
        summary: "",
        alliances: [],
        tensions: [],
        promises: [],
        voteBlocs: [],
        mingleDiscoveries: [],
        playerTrajectories: [],
        storyArcs: [],
        droppedThreads: [],
        openQuestions: [],
        changedSincePrevious: "",
      },
    };
    const res = deriveHydrationPassport({
      lastEventSequence: base.lastEventSequence,
      checkpointKind: base.checkpointKind,
      hydrateable: base.hydrateable,
      hydrationStatus: base.hydrationStatus,
      snapshot: fullSnapshot,
      transcriptCursor: { ...base.transcriptCursor, durableBoundary: true, version: 1 },
      tokenCostCursor: base.tokenCostCursor,
      eventHeadHash,
      checkpointOwnerEpoch: "owner-positive",
      degradedReason: null,
      createdAt: "2026-06-14T00:00:00.000Z",
      eventLogStatus: "complete",
      projectionStatus: "replayed",
      hasValidEventPrefixUpTo: () => true,
      hasValidProjectionUpTo: () => true,
    });
    // Positive candidate requires all stamps; in this slice with full continuity supplied the continuity+boundary+manifest pass.
    // (event/projection also pass via the hasValid fns.) For end-to-end candidate see full durable kernel when all U's wired.
    const contStamps = res.passport.stamps.filter((s) => s.id === "playerContinuity" || s.id === "houseContinuity");
    expect(contStamps.every((s) => s.status === "passed")).toBeTrue();
    const manifestStamp = res.passport.stamps.find((s) => s.id === "snapshotManifest");
    expect(manifestStamp?.status).toBe("passed");
    expect(res.passport.verdict).toBe("hydration_candidate");
    expect(res.passport.stamps.every((s) => s.status === "passed" && !s.blocking)).toBeTrue();
  });

  test("forensicOnlyPassport helper is non-candidate with all required stamps missing", () => {
    const p = forensicOnlyPassport(42);
    expect(p.verdict).toBe("forensic_only");
    expect(p.stamps.length).toBe(8);
    expect(p.stamps.every((s) => s.status === "missing" && s.blocking)).toBeTrue();
  });

  test("unknown manifest version fails closed with unknown_version stamp", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("g2"));
    const res = deriveHydrationPassport({
      lastEventSequence: base.lastEventSequence,
      checkpointKind: base.checkpointKind,
      hydrateable: false,
      hydrationStatus: base.hydrationStatus,
      snapshot: { manifestVersion: 99, components: {} },
      transcriptCursor: base.transcriptCursor,
      tokenCostCursor: base.tokenCostCursor,
      eventHeadHash: "sha256:fixture",
      checkpointOwnerEpoch: "owner-1",
      degradedReason: null,
      createdAt: "2026-06-14T00:00:00.000Z",
      eventLogStatus: "complete",
      projectionStatus: "replayed",
      hasValidEventPrefixUpTo: () => true,
      hasValidProjectionUpTo: () => true,
    });

    const manifest = res.passport.stamps.find((s) => s.id === "snapshotManifest");
    expect(manifest?.status).toBe("unknown_version");
    expect(manifest?.blocking).toBeTrue();
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  // U3 boundary certificate direct cases (embedded in snapshot for derive input)
  test("valid fixture boundary certificate passes its stamp", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("gb1"));
    const goodBc = {
      gameId: base.gameId,
      ownerEpoch: "owner-1",
      boundarySequence: base.lastEventSequence,
      checkpointReason: base.checkpointKind,
      eventCommitReceipt: { sequence: base.lastEventSequence, hash: "sha256:ok" },
      noPendingEffectsAsserted: true,
    };
    const res = deriveHydrationPassport({
      lastEventSequence: base.lastEventSequence,
      checkpointKind: base.checkpointKind,
      hydrateable: false,
      hydrationStatus: base.hydrationStatus,
      snapshot: { eventCount: base.eventCount, boundaryCertificate: goodBc, manifestVersion: 1, manifest: base.snapshotManifest },
      transcriptCursor: base.transcriptCursor,
      tokenCostCursor: base.tokenCostCursor,
      eventHeadHash: "sha256:ok",
      checkpointOwnerEpoch: "owner-1",
      degradedReason: null,
      createdAt: "2026-06-14T00:00:00.000Z",
      eventLogStatus: "complete",
      projectionStatus: "replayed",
      hasValidEventPrefixUpTo: () => true,
      hasValidProjectionUpTo: () => true,
    });
    const bcStamp = res.passport.stamps.find((s) => s.id === "boundaryCertificate");
    expect(bcStamp?.status).toBe("passed");
  });

  test("boundary sequence mismatch fails the boundary stamp", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("gb2"));
    const badBc = {
      gameId: base.gameId,
      boundarySequence: base.lastEventSequence + 99, // mismatch
      checkpointReason: base.checkpointKind,
      eventCommitReceipt: null,
      noPendingEffectsAsserted: true,
    };
    const res = deriveHydrationPassport({
      lastEventSequence: base.lastEventSequence,
      checkpointKind: base.checkpointKind,
      hydrateable: false,
      hydrationStatus: base.hydrationStatus,
      snapshot: { eventCount: base.eventCount, boundaryCertificate: badBc, manifestVersion: 1, manifest: base.snapshotManifest },
      transcriptCursor: base.transcriptCursor,
      tokenCostCursor: base.tokenCostCursor,
      eventHeadHash: "sha256:fixture",
      checkpointOwnerEpoch: "owner-1",
      degradedReason: null,
      createdAt: "2026-06-14T00:00:00.000Z",
      eventLogStatus: "complete",
      projectionStatus: "replayed",
      hasValidEventPrefixUpTo: () => true,
      hasValidProjectionUpTo: () => true,
    });
    const bcStamp = res.passport.stamps.find((s) => s.id === "boundaryCertificate");
    expect(bcStamp?.status).toBe("failed");
    expect(bcStamp?.blocking).toBeTrue();
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  test("missing no-pending-effect assertion fails boundary stamp", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("gb3"));
    const badBc = {
      gameId: base.gameId,
      boundarySequence: base.lastEventSequence,
      checkpointReason: base.checkpointKind,
      eventCommitReceipt: { sequence: base.lastEventSequence, hash: "h" },
      noPendingEffectsAsserted: false,
    };
    const res = deriveHydrationPassport({
      lastEventSequence: base.lastEventSequence,
      checkpointKind: base.checkpointKind,
      hydrateable: false,
      hydrationStatus: base.hydrationStatus,
      snapshot: { eventCount: base.eventCount, boundaryCertificate: badBc, manifestVersion: 1, manifest: base.snapshotManifest },
      transcriptCursor: base.transcriptCursor,
      tokenCostCursor: base.tokenCostCursor,
      eventHeadHash: "h",
      checkpointOwnerEpoch: "owner-1",
      degradedReason: null,
      createdAt: "2026-06-14T00:00:00.000Z",
      eventLogStatus: "complete",
      projectionStatus: "replayed",
      hasValidEventPrefixUpTo: () => true,
      hasValidProjectionUpTo: () => true,
    });
    const bcStamp = res.passport.stamps.find((s) => s.id === "boundaryCertificate");
    expect(bcStamp?.status).toBe("failed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  test("missing commit receipt fails the boundary stamp", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("gb4"));
    const badBc = {
      gameId: base.gameId,
      ownerEpoch: "owner-1",
      boundarySequence: base.lastEventSequence,
      checkpointReason: base.checkpointKind,
      eventCommitReceipt: null,
      noPendingEffectsAsserted: true,
    };
    const res = deriveHydrationPassport({
      lastEventSequence: base.lastEventSequence,
      checkpointKind: base.checkpointKind,
      hydrateable: false,
      hydrationStatus: base.hydrationStatus,
      snapshot: { eventCount: base.eventCount, boundaryCertificate: badBc, manifestVersion: 1, manifest: base.snapshotManifest },
      transcriptCursor: base.transcriptCursor,
      tokenCostCursor: base.tokenCostCursor,
      eventHeadHash: "sha256:missing-receipt",
      checkpointOwnerEpoch: "owner-1",
      degradedReason: null,
      createdAt: "2026-06-14T00:00:00.000Z",
      eventLogStatus: "complete",
      projectionStatus: "replayed",
      hasValidEventPrefixUpTo: () => true,
      hasValidProjectionUpTo: () => true,
    });

    const bcStamp = res.passport.stamps.find((s) => s.id === "boundaryCertificate");
    expect(bcStamp?.status).toBe("failed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  test("privacy stamp blocks raw reasoning fields in continuity capsules", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("g-private"));
    const eventHeadHash = "sha256:privacy";
    const fullSnapshot = {
      eventCount: base.eventCount,
      state: base.state,
      projectionSummary: base.projectionSummary,
      manifestVersion: 1,
      manifest: {
        version: 1,
        components: Object.fromEntries(
          Object.keys(base.snapshotManifest!.components).map((key) => [key, { status: "captured", version: 1 }]),
        ),
      },
      boundaryCertificate: {
        ...base.boundaryCertificate,
        ownerEpoch: "owner-private",
        eventCommitReceipt: { sequence: base.lastEventSequence, hash: eventHeadHash },
      },
      playerContinuityCapsules: [
        {
          playerId: "atlas",
          playerName: "Atlas",
          strategyPacket: null,
          reflectionSummary: null,
          notes: [],
          commitments: [],
          relationships: { allies: [], threats: [] },
          powerActionMemory: null,
          roundHistory: [],
          reasoningContext: "must not pass readiness",
        },
        ...["echo", "mira", "nyx"].map((playerId) => ({
          playerId,
          playerName: playerId,
          strategyPacket: null,
          reflectionSummary: null,
          notes: [],
          commitments: [],
          relationships: { allies: [], threats: [] },
          powerActionMemory: null,
          roundHistory: [],
        })),
      ],
      houseContinuityCapsule: {
        revisionId: "h1",
        previousRevisionId: null,
        updatedAtRound: 1,
        updatedAtPhase: "INIT",
        summary: "",
        alliances: [],
        tensions: [],
        promises: [],
        voteBlocs: [],
        mingleDiscoveries: [],
        playerTrajectories: [],
        storyArcs: [],
        droppedThreads: [],
        openQuestions: [],
        changedSincePrevious: "",
      },
    };
    const res = deriveHydrationPassport({
      lastEventSequence: base.lastEventSequence,
      checkpointKind: base.checkpointKind,
      hydrateable: base.hydrateable,
      hydrationStatus: base.hydrationStatus,
      snapshot: fullSnapshot,
      transcriptCursor: { ...base.transcriptCursor, durableBoundary: true, version: 1 },
      tokenCostCursor: base.tokenCostCursor,
      eventHeadHash,
      checkpointOwnerEpoch: "owner-private",
      degradedReason: null,
      createdAt: "2026-06-14T00:00:00.000Z",
      eventLogStatus: "complete",
      projectionStatus: "replayed",
      hasValidEventPrefixUpTo: () => true,
      hasValidProjectionUpTo: () => true,
    });

    const privacyStamp = res.passport.stamps.find((s) => s.id === "privacy");
    expect(privacyStamp?.status).toBe("failed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });
});
