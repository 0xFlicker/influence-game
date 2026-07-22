import { describe, expect, test } from "bun:test";
import { Phase, type CanonicalGameEvent } from "@influence/engine";
import {
  attachTrustedRelatedActionRefs,
  buildTrustedVoteCastIndex,
  resolveTrustedRefsForGroup,
} from "../services/match-narrative-canonical-actions.js";
import type { NarrativeGroup } from "../services/match-narrative-grouping.js";

function voteCastEvent(params: {
  sequence: number;
  gameId?: string;
  voterId: string;
  decisionId?: string;
  action?: string;
  actorId?: string;
  phase?: string;
  round?: number;
  pointerPhase?: string;
  pointerRound?: number;
  empowerTarget?: string;
  exposeTarget?: string;
  malformedPointer?: boolean;
}): { sequence: number; eventType: string; envelope: CanonicalGameEvent } {
  const gameId = params.gameId ?? "game-1";
  const phase = (params.phase ?? Phase.VOTE) as Phase;
  const round = params.round ?? 2;
  const sourcePointers = params.malformedPointer
    ? [{ kind: "not_a_real_kind" } as never]
    : params.decisionId
      ? [
          {
            kind: "agent_turn" as const,
            actorId: params.actorId ?? params.voterId,
            action: params.action ?? "vote",
            round: params.pointerRound ?? round,
            phase: (params.pointerPhase ?? phase) as Phase,
            decisionId: params.decisionId,
          },
        ]
      : [];

  const envelope: CanonicalGameEvent = {
    sequence: params.sequence,
    gameId,
    round,
    phase,
    type: "vote.cast",
    timestamp: "2026-07-21T12:00:00.000Z",
    source: "engine",
    visibility: "producer",
    payloadVersion: 1,
    sourcePointers,
    payload: {
      voterId: params.voterId,
      empowerTarget: params.empowerTarget ?? "p-empower",
      exposeTarget: params.exposeTarget ?? "p-expose",
    },
  };

  return {
    sequence: params.sequence,
    eventType: "vote.cast",
    envelope,
  };
}

function strategyGroup(params: {
  decisionId: string | null;
  actorPlayerId: string | null;
  action?: string | null;
  phase?: string | null;
  round?: number | null;
  withDialogue?: boolean;
}): NarrativeGroup {
  const members: NarrativeGroup["members"] = [];
  if (params.withDialogue) {
    members.push({
      kind: "dialogue",
      authority: "transcript",
      id: "d:1",
      sortKey: 1,
      phase: params.phase ?? "VOTE",
      round: params.round ?? 2,
      action: null,
      decisionId: params.decisionId,
      eventSequence: null,
      fields: { text: "public line" },
    });
  }
  members.push({
    kind: "strategy",
    authority: "cognition",
    id: "c:s1",
    sortKey: 2,
    phase: params.phase ?? "VOTE",
    round: params.round ?? 2,
    action: params.action ?? "vote",
    decisionId: params.decisionId,
    eventSequence: null,
    fields: { decisionLog: "vote plan" },
  });

  return {
    groupId: "g1",
    decisionId: params.decisionId,
    correlation: { kind: "decision_id", basis: "decision_id" },
    actor: { playerId: params.actorPlayerId, name: "Alice" },
    phase: params.phase ?? "VOTE",
    round: params.round ?? 2,
    action: params.action ?? "vote",
    sortKey: 1,
    members,
  };
}

function dialogueOnlyGroup(decisionId: string, actorPlayerId: string): NarrativeGroup {
  return {
    groupId: "g1",
    decisionId,
    correlation: { kind: "decision_id", basis: "decision_id" },
    actor: { playerId: actorPlayerId, name: "Alice" },
    phase: "VOTE",
    round: 2,
    action: null,
    sortKey: 1,
    members: [
      {
        kind: "dialogue",
        authority: "transcript",
        id: "d:1",
        sortKey: 1,
        phase: "VOTE",
        round: 2,
        action: null,
        decisionId,
        eventSequence: null,
        fields: { text: "public only" },
      },
    ],
  };
}

describe("match-narrative-canonical-actions", () => {
  test("indexes trusted vote.cast by decisionId with agreement fields", () => {
    const decisionId = "dec-1";
    const index = buildTrustedVoteCastIndex([
      voteCastEvent({
        sequence: 37,
        voterId: "alice",
        decisionId,
        action: "vote",
        phase: "VOTE",
        round: 2,
      }),
    ]);

    expect(index.lastTrustedSequence).toBe(37);
    expect(index.byDecisionId.get(decisionId)).toEqual([
      {
        eventSequence: 37,
        eventType: "vote.cast",
        decisionId,
        actorPlayerId: "alice",
        action: "vote",
        phase: "VOTE",
        round: 2,
      },
    ]);
  });

  test("exact match attaches citation; mismatches and dialogue-only do not", () => {
    const decisionId = "dec-1";
    const index = buildTrustedVoteCastIndex([
      voteCastEvent({
        sequence: 37,
        voterId: "alice",
        decisionId,
      }),
    ]);

    const match = resolveTrustedRefsForGroup(
      strategyGroup({ decisionId, actorPlayerId: "alice" }),
      index,
    );
    expect(match).toEqual([
      {
        eventSequence: 37,
        eventType: "vote.cast",
        phase: "VOTE",
        round: 2,
        action: "vote",
      },
    ]);

    expect(
      resolveTrustedRefsForGroup(
        strategyGroup({ decisionId, actorPlayerId: "bob" }),
        index,
      ),
    ).toBeUndefined();

    expect(
      resolveTrustedRefsForGroup(
        strategyGroup({ decisionId, actorPlayerId: "alice", action: "power" }),
        index,
      ),
    ).toBeUndefined();

    expect(
      resolveTrustedRefsForGroup(
        strategyGroup({ decisionId, actorPlayerId: "alice", phase: "mingle" }),
        index,
      ),
    ).toBeUndefined();

    expect(
      resolveTrustedRefsForGroup(
        strategyGroup({ decisionId, actorPlayerId: "alice", round: 3 }),
        index,
      ),
    ).toBeUndefined();

    expect(
      resolveTrustedRefsForGroup(
        strategyGroup({ decisionId: "missing", actorPlayerId: "alice" }),
        index,
      ),
    ).toBeUndefined();

    // Public dialogue alone never unlocks a citation.
    expect(
      resolveTrustedRefsForGroup(dialogueOnlyGroup(decisionId, "alice"), index),
    ).toBeUndefined();
  });

  test("absent decisionId, actor mismatch on pointer, and pin ignore later events", () => {
    const indexNoId = buildTrustedVoteCastIndex([
      voteCastEvent({ sequence: 10, voterId: "alice" }),
    ]);
    expect(indexNoId.byDecisionId.size).toBe(0);

    const indexMismatch = buildTrustedVoteCastIndex([
      voteCastEvent({
        sequence: 11,
        voterId: "alice",
        actorId: "bob",
        decisionId: "dec-x",
      }),
    ]);
    expect(indexMismatch.byDecisionId.size).toBe(0);

    const pinned = buildTrustedVoteCastIndex(
      [
        voteCastEvent({
          sequence: 5,
          voterId: "alice",
          decisionId: "dec-old",
        }),
        voteCastEvent({
          sequence: 40,
          voterId: "alice",
          decisionId: "dec-new",
        }),
      ],
      5,
    );
    expect(pinned.byDecisionId.has("dec-old")).toBe(true);
    expect(pinned.byDecisionId.has("dec-new")).toBe(false);
    expect(pinned.lastTrustedSequence).toBe(40);
  });

  test("attachTrustedRelatedActionRefs dedupes by sequence ascending and strips without index", () => {
    const decisionId = "dec-1";
    const index = buildTrustedVoteCastIndex([
      voteCastEvent({ sequence: 40, voterId: "alice", decisionId }),
      voteCastEvent({ sequence: 37, voterId: "alice", decisionId }),
    ]);

    const groups = attachTrustedRelatedActionRefs(
      [strategyGroup({ decisionId, actorPlayerId: "alice" })],
      index,
    );
    expect(groups[0]!.relatedActionRefs?.map((r) => r.eventSequence)).toEqual([37, 40]);

    const stripped = attachTrustedRelatedActionRefs(
      [
        {
          ...strategyGroup({ decisionId, actorPlayerId: "alice" }),
          relatedActionRefs: [
            {
              eventSequence: 1,
              eventType: "vote.cast",
              phase: "VOTE",
              round: 2,
              action: "vote",
            },
          ],
        },
      ],
      null,
    );
    expect(stripped[0]!.relatedActionRefs).toBeUndefined();
  });

  test("never indexes non-vote action strings on vote.cast", () => {
    const index = buildTrustedVoteCastIndex([
      voteCastEvent({
        sequence: 1,
        voterId: "alice",
        decisionId: "dec-1",
        action: "mingle-turn",
      }),
    ]);
    expect(index.byDecisionId.size).toBe(0);
  });
});
