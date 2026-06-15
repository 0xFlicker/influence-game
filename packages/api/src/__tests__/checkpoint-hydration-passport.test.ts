import { beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  GameRunner,
  Phase,
  TemplateHouseInterviewer,
  TokenTracker,
  type AgentResponse,
  type IAgent,
  type MingleIntentAction,
  type PhaseContext,
  type PlayerContinuityCapsule,
  type PowerAction,
  type StrategicReflectionAction,
  type TargetDecision,
  type UUID,
} from "@influence/engine";
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
  type PassportStampId,
} from "../services/checkpoint-hydration-passport.js";

function stampStatus(result: ReturnType<typeof deriveHydrationPassport>, id: PassportStampId) {
  return result.passport.stamps.find((stamp) => stamp.id === id)?.status;
}

function mockResponse(message: string): AgentResponse {
  return { thinking: "passport proof mock", message };
}

class PassportProofAgent implements IAgent {
  readonly id: UUID;
  readonly name: string;
  private started = false;

  constructor(id: UUID, name: string) {
    this.id = id;
    this.name = name;
  }

  onGameStart(): void {
    this.started = true;
  }

  async onPhaseStart(): Promise<void> {}

  getContinuityCapsule(): Omit<PlayerContinuityCapsule, "playerId" | "playerName"> | null {
    if (!this.started) return null;
    return {
      strategyPacket: null,
      reflectionSummary: null,
      notes: [],
      commitments: [],
      relationships: { allies: [], threats: [] },
      powerActionMemory: null,
      roundHistory: [],
    };
  }

  async getIntroduction(): Promise<AgentResponse> {
    return mockResponse(`Hi, I'm ${this.name}`);
  }

  async getLobbyMessage(ctx: PhaseContext): Promise<AgentResponse> {
    return mockResponse(`${this.name} round ${ctx.round}`);
  }

  async getWhispers(ctx: PhaseContext): Promise<Array<{ to: UUID[]; text: string }>> {
    const target = ctx.alivePlayers.find((player) => player.id !== this.id);
    return target ? [{ to: [target.id], text: "secret" }] : [];
  }

  async getMingleIntent(ctx: PhaseContext): Promise<MingleIntentAction> {
    const other = ctx.alivePlayers.find((player) => player.id !== this.id)?.name ?? null;
    return {
      seekPlayers: other ? [other] : [],
      avoidPlayers: [],
      preferredRoomSize: "any",
      purpose: "passport proof Mingle intent",
      provisionalTarget: null,
      noTargetReason: "passport proof mock does not pick a target",
      openingAsk: "compare notes",
      strategicLens: "room_traffic",
      strategicLensRationale: "passport proof mock watches room traffic",
      thinking: "passport proof Mingle intent",
    };
  }

  async sendRoomMessage(
    _ctx: PhaseContext,
    roomMates: string[],
    conversationHistory?: Array<{ from: string; text: string }>,
  ): Promise<AgentResponse | null> {
    const alreadySpoke = conversationHistory?.some((message) => message.from === this.name) ?? false;
    if (alreadySpoke) return null;
    const others = roomMates.filter((name) => name !== this.name);
    return others.length > 0 ? mockResponse(`room note to ${others.join(", ")}`) : null;
  }

  async getRumorMessage(): Promise<AgentResponse> { return mockResponse("rumor"); }

  async getVotes(ctx: PhaseContext): Promise<{ empowerTarget: UUID; exposeTarget: UUID; thinking?: string }> {
    const others = ctx.alivePlayers.filter((player) => player.id !== this.id);
    return {
      empowerTarget: others[0]?.id ?? this.id,
      exposeTarget: others[others.length - 1]?.id ?? this.id,
      thinking: "passport proof votes",
    };
  }

  async getEmpowerRevote(ctx: PhaseContext, tiedCandidates: UUID[]): Promise<{ empowerTarget: UUID; thinking?: string }> {
    return {
      empowerTarget: tiedCandidates[0] ?? ctx.alivePlayers.find((player) => player.id !== this.id)?.id ?? this.id,
      thinking: "passport proof empower revote",
    };
  }

  async getPowerAction(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<PowerAction> {
    return { action: "protect", target: candidates[0] };
  }

  async getCouncilVote(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<{ target: UUID; thinking?: string }> {
    return { target: candidates[0], thinking: "passport proof council vote" };
  }

  async getLastMessage(): Promise<AgentResponse> { return mockResponse("goodbye"); }
  async getDiaryEntry(): Promise<AgentResponse> { return mockResponse("diary entry"); }
  async getPlea(): Promise<AgentResponse> { return mockResponse("please keep me"); }

  async getEndgameEliminationVote(ctx: PhaseContext): Promise<TargetDecision> {
    const target = ctx.alivePlayers.find((player) => player.id !== this.id);
    return { target: target?.id ?? this.id, thinking: "passport proof endgame vote" };
  }

  async getAccusation(ctx: PhaseContext): Promise<{ targetId: UUID; text: string; thinking?: string }> {
    const target = ctx.alivePlayers.find((player) => player.id !== this.id);
    return { targetId: target?.id ?? this.id, text: "accusation", thinking: "passport proof accusation" };
  }

  async getDefense(): Promise<AgentResponse> { return mockResponse("defense"); }
  async getOpeningStatement(): Promise<AgentResponse> { return mockResponse("opening"); }

  async getJuryQuestion(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<{ targetFinalistId: UUID; question: string; thinking?: string }> {
    return { targetFinalistId: finalistIds[0], question: "why?", thinking: "passport proof jury question" };
  }

  async getJuryAnswer(): Promise<AgentResponse> { return mockResponse("because"); }
  async getClosingArgument(): Promise<AgentResponse> { return mockResponse("closing"); }

  async getJuryVote(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<TargetDecision> {
    return { target: finalistIds[0], thinking: "passport proof jury vote" };
  }

  async getStrategicReflection(_ctx: PhaseContext): Promise<StrategicReflectionAction> {
    return {
      certainties: [],
      suspicions: [],
      allies: [],
      threats: [],
      plan: "passport proof plan",
      strategicLens: "broad_read",
      strategicLensRationale: "passport proof broad reflection",
      thinking: "passport proof strategic reflection",
    };
  }

  updateAlly(_playerName: string): void {}
  updateThreat(_playerName: string): void {}
  addNote(_playerName: string, _note: string): void {}
  removeFromMemory(_playerName: string): void {}
}

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
    snapshot: overrides.snapshot ?? { eventCount: capsule.eventCount },
    transcriptCursor: overrides.transcriptCursor ?? capsule.transcriptCursor,
    tokenCostCursor: overrides.tokenCostCursor ?? capsule.tokenCostCursor,
    eventHeadHash,
    projectionHash,
    checkpointPhase: capsule.phase,
    checkpointRound: capsule.round,
    checkpointOwnerEpoch: overrides.ownerEpoch ?? "owner-1",
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

  test("actor witness alive players must match expected active players", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("actor-player-mismatch"));
    const ownerEpoch = "owner-actor-player";
    const eventHeadHash = "sha256:actor-player";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const runtimeSnapshot = {
      ...positive.runtimeSnapshot!,
      actorWitness: {
        ...positive.runtimeSnapshot!.actorWitness,
        contextSummary: {
          ...positive.runtimeSnapshot!.actorWitness.contextSummary,
          alivePlayerIds: ["atlas"],
        },
      },
    };

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        state: base.state,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
        expectedActivePlayerIds: ["atlas", "echo", "mira", "nyx"],
      },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
    }));

    expect(stampStatus(res, "actorWitness")).toBe("failed");
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

  test("captured accumulator status is not accepted in v1", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("accum-captured"));
    const ownerEpoch = "owner-accum-captured";
    const eventHeadHash = "sha256:accum-captured";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const runtimeSnapshot = positive.runtimeSnapshot!;
    const malformedRuntimeSnapshot = {
      ...runtimeSnapshot,
      accumulatorRegistry: {
        ...runtimeSnapshot.accumulatorRegistry,
        entries: runtimeSnapshot.accumulatorRegistry.entries.map((entry) =>
          entry.id === "mingleInbox"
            ? { id: entry.id, status: "captured" }
            : entry,
        ),
      },
    };

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot: malformedRuntimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        state: base.state,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
        expectedActivePlayerIds: ["atlas", "echo", "mira", "nyx"],
      },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
    }));

    expect(stampStatus(res, "accumulatorRegistry")).toBe("malformed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  test("accumulator proof kind must match the claimed status", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("accum-proof-mismatch"));
    const ownerEpoch = "owner-accum-proof-mismatch";
    const eventHeadHash = "sha256:accum-proof-mismatch";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const runtimeSnapshot = positive.runtimeSnapshot!;
    const mismatchedRuntimeSnapshot = {
      ...runtimeSnapshot,
      accumulatorRegistry: {
        ...runtimeSnapshot.accumulatorRegistry,
        entries: runtimeSnapshot.accumulatorRegistry.entries.map((entry) =>
          entry.id === "mingleInbox"
            ? { id: entry.id, status: "empty", proof: { kind: "drained_at_boundary" } }
            : entry,
        ),
      },
    };

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot: mismatchedRuntimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        state: base.state,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
        expectedActivePlayerIds: ["atlas", "echo", "mira", "nyx"],
      },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
    }));

    expect(stampStatus(res, "accumulatorRegistry")).toBe("failed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  test("malformed runtime snapshot subobjects fail stamps without throwing", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("malformed-runtime"));
    const ownerEpoch = "owner-malformed-runtime";
    const eventHeadHash = "sha256:malformed-runtime";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const runtimeSnapshot = {
      ...positive.runtimeSnapshot!,
      actorWitness: { version: 1 },
    };

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        state: base.state,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
        expectedActivePlayerIds: ["atlas", "echo", "mira", "nyx"],
      },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
    }));

    expect(stampStatus(res, "actorWitness")).toBe("malformed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  test("player continuity requires declared expected active players when live players exist", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("missing-expected-players"));
    const ownerEpoch = "owner-missing-expected";
    const eventHeadHash = "sha256:missing-expected";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot: positive.runtimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        state: base.state,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
      },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
    }));

    expect(stampStatus(res, "playerContinuity")).toBe("failed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  test("player continuity rejects truncated expected active players", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("truncated-expected-players"));
    const ownerEpoch = "owner-truncated-expected";
    const eventHeadHash = "sha256:truncated-expected";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot: positive.runtimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        state: base.state,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
        expectedActivePlayerIds: ["atlas"],
      },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
    }));

    expect(stampStatus(res, "playerContinuity")).toBe("failed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  test("entry-count-only transcript evidence fails transcript stamp", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("transcript-fail"));
    const res = deriveHydrationPassport(deriveInput(base, {
      transcriptCursor: { entries: 12 },
    }));

    const transcriptStamp = res.passport.stamps.find((stamp) => stamp.id === "transcriptCursor");
    expect(transcriptStamp?.status).toBe("failed");
  });

  test("transcript cursor entries must match the runtime watermark", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("transcript-entry-mismatch"));
    const ownerEpoch = "owner-transcript-entry-mismatch";
    const eventHeadHash = "sha256:transcript-entry-mismatch";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const transcriptCursor = {
      ...positive.transcriptCursor,
      entries: positive.runtimeSnapshot!.transcriptWatermark.entryCount + 1,
    };

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot: positive.runtimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        state: base.state,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
        expectedActivePlayerIds: ["atlas", "echo", "mira", "nyx"],
      },
      transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
    }));

    expect(stampStatus(res, "transcriptCursor")).toBe("failed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  test("transcript watermark must cover the checkpoint event boundary", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("transcript-stale-boundary"));
    const ownerEpoch = "owner-transcript-stale-boundary";
    const eventHeadHash = "sha256:transcript-stale-boundary";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const runtimeSnapshot = {
      ...positive.runtimeSnapshot!,
      transcriptWatermark: {
        ...positive.runtimeSnapshot!.transcriptWatermark,
        lastCanonicalSequence: positive.lastEventSequence - 1,
      },
    };
    const transcriptCursor = {
      ...positive.transcriptCursor,
      lastCanonicalSequence: positive.lastEventSequence - 1,
    };

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        state: base.state,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
        expectedActivePlayerIds: ["atlas", "echo", "mira", "nyx"],
      },
      transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
    }));

    expect(stampStatus(res, "transcriptCursor")).toBe("failed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });

  test("token cursor must be bound to the checkpoint boundary", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("token-boundary"));
    const ownerEpoch = "owner-token-boundary";
    const eventHeadHash = "sha256:token-boundary";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });

    const boundaryless = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot: positive.runtimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        state: base.state,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
        expectedActivePlayerIds: ["atlas", "echo", "mira", "nyx"],
      },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: base.tokenCostCursor,
    }));
    expect(stampStatus(boundaryless, "tokenCursor")).toBe("failed");

    const mismatched = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot: positive.runtimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        state: base.state,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
        expectedActivePlayerIds: ["atlas", "echo", "mira", "nyx"],
      },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor
        ? {
            ...positive.tokenCostCursor,
            boundary: {
              ...positive.tokenCostCursor.boundary!,
              boundarySequence: positive.lastEventSequence + 1,
            },
          }
        : null,
    }));
    expect(stampStatus(mismatched, "tokenCursor")).toBe("failed");
  });

  test("runtime snapshot must be present, v1, and well-formed", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("runtime-validation"));
    const ownerEpoch = "owner-runtime";
    const eventHeadHash = "sha256:runtime";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const validSnapshot = {
      runtimeSnapshot: positive.runtimeSnapshot,
      boundaryCertificate: positive.boundaryCertificate,
      projectionSummary: base.projectionSummary,
      state: base.state,
      playerContinuityCapsules: positive.playerContinuityCapsules,
      houseContinuityCapsule: positive.houseContinuityCapsule,
      expectedActivePlayerIds: ["atlas", "echo", "mira", "nyx"],
    };

    const missing = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: { ...validSnapshot, runtimeSnapshot: undefined },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
    }));
    expect(stampStatus(missing, "runtimeSnapshot")).toBe("missing");

    const unknownVersion = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: { ...validSnapshot, runtimeSnapshot: { version: 2 } },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
    }));
    expect(stampStatus(unknownVersion, "runtimeSnapshot")).toBe("unknown_version");

    const malformed = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: { ...validSnapshot, runtimeSnapshot: "not-an-object" },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor: positive.tokenCostCursor,
    }));
    expect(stampStatus(malformed, "runtimeSnapshot")).toBe("malformed");
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
    expect(JSON.stringify(inspection.response)).not.toContain("strategyPacket");
  });

  test("real GameRunner checkpoint can earn hydration_candidate through DB inspection", async () => {
    const gameId = await insertGame(db, { id: "runner-candidate-proof", status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const tokenTracker = new TokenTracker();
    tokenTracker.record("fixture", 10, 5);
    const agents = [
      new PassportProofAgent("atlas", "Atlas"),
      new PassportProofAgent("echo", "Echo"),
      new PassportProofAgent("mira", "Mira"),
      new PassportProofAgent("nyx", "Nyx"),
    ];

    let wroteCandidateShape = false;
    let runner: GameRunner | null = null;
    runner = new GameRunner(
      agents,
      {
        ...DEFAULT_CONFIG,
        maxRounds: 1,
        enableHouseStrategyBible: true,
        enableHouseRoundSummaries: true,
      },
      new TemplateHouseInterviewer(),
      {
        gameId,
        tokenTracker,
        durableEventSink: (events) => appendGameEvents(db, { gameId, ownerEpoch, events }),
        durableCheckpointSink: async (checkpoint) => {
          const result = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
          expect(result.ok).toBeTrue();
          if (checkpoint.checkpointKind === "phase_boundary" &&
              checkpoint.runtimeSnapshot &&
              checkpoint.houseContinuityCapsule &&
              checkpoint.tokenCostCursor?.boundary) {
            const transcriptEntry = checkpoint.runtimeSnapshot.accumulatorRegistry.entries.find((entry) => entry.id === "transcriptStreamBuffer");
            expect(transcriptEntry?.status).toBe("drained");
            wroteCandidateShape = true;
            runner?.abort();
          }
        },
      },
    );

    await expect(runner.run()).rejects.toThrow("Game run aborted");
    expect(wroteCandidateShape).toBeTrue();

    const inspection = await getDurableRunInspection(db, gameId);
    expect(inspection.ok).toBeTrue();
    if (!inspection.ok) throw new Error("inspection failed");

    const candidate = inspection.response.checkpoints.entries.find((entry) =>
      entry.checkpointKind === "phase_boundary" &&
      entry.passport.verdict === "hydration_candidate"
    );
    expect(candidate).toBeDefined();
    expect(candidate?.resumeAvailable).toBeFalse();
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

  test("privacy stamp blocks forbidden fields in token cursor evidence", () => {
    const base = createCheckpointCapsule(createCanonicalEventFixture("token-private"));
    const ownerEpoch = "owner-token-private";
    const eventHeadHash = "sha256:token-private";
    const positive = enrichCapsuleForV1Candidate(base, { ownerEpoch, eventHeadHash });
    const tokenCostCursor = {
      ...positive.tokenCostCursor!,
      prompt: "must not pass readiness",
    };

    const res = deriveHydrationPassport(deriveInput(base, {
      ownerEpoch,
      eventHeadHash,
      snapshot: {
        runtimeSnapshot: positive.runtimeSnapshot,
        boundaryCertificate: positive.boundaryCertificate,
        projectionSummary: base.projectionSummary,
        state: base.state,
        playerContinuityCapsules: positive.playerContinuityCapsules,
        houseContinuityCapsule: positive.houseContinuityCapsule,
        expectedActivePlayerIds: ["atlas", "echo", "mira", "nyx"],
      },
      transcriptCursor: positive.transcriptCursor,
      tokenCostCursor,
    }));

    expect(stampStatus(res, "privacy")).toBe("failed");
    expect(res.passport.verdict).not.toBe("hydration_candidate");
  });
});
