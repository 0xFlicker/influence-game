import { describe, expect, test } from "bun:test";
import {
  ACCEPTED_ACTION_REGISTRY,
  Phase,
  type CanonicalGameEvent,
} from "@influence/engine";
import {
  attachTrustedRelatedActionRefs,
  buildTrustedAcceptedActionIndex,
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

function acceptedActionEvent(params: {
  sequence: number;
  eventType: CanonicalGameEvent["type"];
  actorId: string;
  decisionId: string;
  action: string;
  payload: Record<string, unknown>;
  phase?: Phase;
  round?: number;
}): { sequence: number; eventType: string; envelope: CanonicalGameEvent } {
  const phase = params.phase ?? Phase.POWER;
  const round = params.round ?? 2;
  return {
    sequence: params.sequence,
    eventType: params.eventType,
    envelope: {
      sequence: params.sequence,
      gameId: "game-1",
      round,
      phase,
      type: params.eventType,
      timestamp: "2026-07-25T12:00:00.000Z",
      source: "engine",
      visibility: "producer",
      payloadVersion: 1,
      sourcePointers: [{
        kind: "agent_turn",
        actorId: params.actorId,
        action: params.action,
        round,
        phase,
        decisionId: params.decisionId,
      }],
      payload: params.payload,
    } as CanonicalGameEvent,
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
    const index = buildTrustedAcceptedActionIndex([
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

  test("normalizes registry source action aliases before cognition matching", () => {
    const decisionId = "power-decision";
    const index = buildTrustedAcceptedActionIndex([
      acceptedActionEvent({
        sequence: 38,
        eventType: "power.action_set",
        actorId: "alice",
        decisionId,
        action: "power-action",
        payload: { actorId: "alice", power: "block" },
      }),
    ]);

    expect(resolveTrustedRefsForGroup(
      strategyGroup({
        decisionId,
        actorPlayerId: "alice",
        action: "power",
        phase: "POWER",
      }),
      index,
    )).toEqual([{
      eventSequence: 38,
      eventType: "power.action_set",
      phase: "POWER",
      round: 2,
      action: "power",
    }]);
  });

  test("indexes every accepted-action registry event with event-specific actor extraction", () => {
    const actorId = "alice";
    const specs: Array<{
      eventType: keyof typeof ACCEPTED_ACTION_REGISTRY;
      sourceAction: string;
      cognitionAction: string;
      payload: Record<string, unknown>;
    }> = [
      { eventType: "vote.cast", sourceAction: "vote", cognitionAction: "vote", payload: { voterId: actorId } },
      { eventType: "vote.empower_revote_cast", sourceAction: "empower-revote", cognitionAction: "empower-revote", payload: { voterId: actorId } },
      { eventType: "format.selected", sourceAction: "format-pick", cognitionAction: "format-pick", payload: { empoweredId: actorId } },
      { eventType: "format.ballot_cast", sourceAction: "format-save-or-eliminate-ballot", cognitionAction: "format-save-or-eliminate-ballot", payload: { voterId: actorId } },
      { eventType: "format.safety_bounce_pointer", sourceAction: "bounce-pointer", cognitionAction: "bounce-pointer", payload: { actorId } },
      { eventType: "format.resolved", sourceAction: "format-tiebreak", cognitionAction: "format-tiebreak", payload: { tiebreakerId: actorId } },
      { eventType: "power.action_set", sourceAction: "power-action", cognitionAction: "power", payload: {} },
      { eventType: "alliance.proposal_submitted", sourceAction: "alliance-action", cognitionAction: "alliance-action", payload: { lineage: { versions: [{ proposerId: actorId }] } } },
      { eventType: "alliance.response_recorded", sourceAction: "alliance-action", cognitionAction: "alliance-action", payload: { playerId: actorId } },
      { eventType: "alliance.counter_submitted", sourceAction: "alliance-action", cognitionAction: "alliance-action", payload: { lineage: { versions: [{ proposerId: actorId }] } } },
      { eventType: "alliance.amendment_resolved", sourceAction: "alliance-action", cognitionAction: "alliance-action", payload: { lineage: { versions: [{ proposerId: actorId }] } } },
      { eventType: "council.vote_cast", sourceAction: "council-vote", cognitionAction: "council-vote", payload: { voterId: actorId } },
      { eventType: "endgame.elimination_vote_cast", sourceAction: "elimination-vote", cognitionAction: "elimination-vote", payload: { voterId: actorId } },
      { eventType: "endgame.elimination_resolved", sourceAction: "tribunal-jury-tiebreaker-vote", cognitionAction: "tribunal-jury-tiebreaker-vote", payload: {} },
      { eventType: "jury.vote_cast", sourceAction: "jury-vote", cognitionAction: "jury-vote", payload: { jurorId: actorId } },
    ];
    expect(specs.map((spec) => spec.eventType).sort()).toEqual(
      (Object.keys(ACCEPTED_ACTION_REGISTRY) as Array<
        keyof typeof ACCEPTED_ACTION_REGISTRY
      >).sort(),
    );

    for (const [offset, spec] of specs.entries()) {
      const decisionId = `decision-${spec.eventType}`;
      const index = buildTrustedAcceptedActionIndex([
        acceptedActionEvent({
          sequence: offset + 1,
          eventType: spec.eventType,
          actorId,
          decisionId,
          action: spec.sourceAction,
          payload: spec.payload,
          phase: Phase.VOTE,
        }),
      ]);
      expect(resolveTrustedRefsForGroup(
        strategyGroup({
          decisionId,
          actorPlayerId: actorId,
          action: spec.cognitionAction,
          phase: "VOTE",
        }),
        index,
      )).toEqual([{
        eventSequence: offset + 1,
        eventType: spec.eventType,
        phase: "VOTE",
        round: 2,
        action: spec.cognitionAction,
      }]);
    }
  });

  test("indexes every allowed decision on a many-to-one aggregate resolution", () => {
    const event = acceptedActionEvent({
      sequence: 77,
      eventType: "endgame.elimination_resolved",
      actorId: "juror-a",
      decisionId: "decision-a",
      action: "tribunal-jury-tiebreaker-vote",
      payload: {},
      phase: Phase.VOTE,
    });
    event.envelope.sourcePointers.push({
      kind: "agent_turn",
      actorId: "juror-b",
      action: "tribunal-jury-tiebreaker-vote",
      round: 2,
      phase: Phase.VOTE,
      decisionId: "decision-b",
    });

    const index = buildTrustedAcceptedActionIndex([event]);
    expect(resolveTrustedRefsForGroup(
      strategyGroup({
        decisionId: "decision-a",
        actorPlayerId: "juror-a",
        action: "tribunal-jury-tiebreaker-vote",
      }),
      index,
    )?.map((ref) => ref.eventSequence)).toEqual([77]);
    expect(resolveTrustedRefsForGroup(
      strategyGroup({
        decisionId: "decision-b",
        actorPlayerId: "juror-b",
        action: "tribunal-jury-tiebreaker-vote",
      }),
      index,
    )?.map((ref) => ref.eventSequence)).toEqual([77]);
  });

  test("exact match attaches citation; mismatches and dialogue-only do not", () => {
    const decisionId = "dec-1";
    const index = buildTrustedAcceptedActionIndex([
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
    const indexNoId = buildTrustedAcceptedActionIndex([
      voteCastEvent({ sequence: 10, voterId: "alice" }),
    ]);
    expect(indexNoId.byDecisionId.size).toBe(0);

    const indexMismatch = buildTrustedAcceptedActionIndex([
      voteCastEvent({
        sequence: 11,
        voterId: "alice",
        actorId: "bob",
        decisionId: "dec-x",
      }),
    ]);
    expect(indexMismatch.byDecisionId.size).toBe(0);

    const malformed = buildTrustedAcceptedActionIndex([
      voteCastEvent({
        sequence: 12,
        voterId: "alice",
        decisionId: "dec-malformed",
        malformedPointer: true,
      }),
      voteCastEvent({
        sequence: 13,
        voterId: "alice",
        decisionId: "dec-phase",
        pointerPhase: "POWER",
      }),
      voteCastEvent({
        sequence: 14,
        voterId: "alice",
        decisionId: "dec-round",
        pointerRound: 3,
      }),
    ]);
    expect(malformed.byDecisionId.size).toBe(0);

    const pinned = buildTrustedAcceptedActionIndex(
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

  test("ambiguous multi-sequence decisions do not cite and missing indexes strip stale refs", () => {
    const decisionId = "dec-1";
    const index = buildTrustedAcceptedActionIndex([
      voteCastEvent({ sequence: 40, voterId: "alice", decisionId }),
      voteCastEvent({ sequence: 37, voterId: "alice", decisionId }),
    ]);

    const groups = attachTrustedRelatedActionRefs(
      [strategyGroup({ decisionId, actorPlayerId: "alice" })],
      index,
    );
    expect(groups[0]!.relatedActionRefs).toBeUndefined();

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
    const index = buildTrustedAcceptedActionIndex([
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
