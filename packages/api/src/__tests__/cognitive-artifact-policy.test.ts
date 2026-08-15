import { describe, expect, test } from "bun:test";
import {
  canReadCognitiveArtifact,
  type CognitiveArtifactAccessor,
  type CognitiveArtifactPolicyContext,
} from "../services/cognitive-artifact-policy.js";

const gameId = "game-compact-strategy-policy";
const ownerId = "player-owned";
const peerId = "player-peer";

function subjectAccessor(
  surfaceCapability: "participant_web" | "subject_owner",
): CognitiveArtifactAccessor {
  return {
    userId: "user-owner",
    authProfile: "subject",
    surfaceCapability,
    claims: {
      userId: "user-owner",
      gameIds: new Set([gameId]),
      createdGameIds: new Set(),
      joinedGameIds: new Set([gameId]),
      playerIds: new Set([ownerId]),
      agentProfileIds: new Set(),
    },
  };
}

function context(
  artifactType: "thinking" | "strategy",
  overrides: Partial<CognitiveArtifactPolicyContext> = {},
): CognitiveArtifactPolicyContext {
  return {
    gameId,
    artifactType,
    actorRole: "player",
    actorPlayerId: peerId,
    action: "vote",
    phase: "VOTE",
    ...overrides,
  };
}

describe("compact strategy cognition authorization", () => {
  test("uses exactly the existing thinking scope on every established surface", () => {
    const cases: Array<{
      accessor: CognitiveArtifactAccessor;
      overrides?: Partial<CognitiveArtifactPolicyContext>;
    }> = [
      { accessor: subjectAccessor("participant_web") },
      {
        accessor: subjectAccessor("participant_web"),
        overrides: { action: "alliance-action", phase: "MINGLE_I" },
      },
      {
        accessor: subjectAccessor("participant_web"),
        overrides: { action: "format-vote-bomb-ballot", phase: "FORMAT_RESOLVE" },
      },
      {
        accessor: subjectAccessor("participant_web"),
        overrides: { actorPlayerId: ownerId },
      },
      { accessor: subjectAccessor("subject_owner") },
      {
        accessor: subjectAccessor("subject_owner"),
        overrides: { actorPlayerId: ownerId },
      },
      {
        accessor: {
          authProfile: "producer",
          surfaceCapability: "producer",
        },
      },
    ];

    for (const testCase of cases) {
      const thinkingAllowed = canReadCognitiveArtifact(
        testCase.accessor,
        context("thinking", testCase.overrides),
      );
      const strategyAllowed = canReadCognitiveArtifact(
        testCase.accessor,
        context("strategy", testCase.overrides),
      );
      expect(strategyAllowed).toBe(thinkingAllowed);
    }
  });
});
