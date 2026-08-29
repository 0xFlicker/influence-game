/**
 * Frozen late-game baseline corpus for selective context recall promotion (U4 → U5).
 *
 * Inputs are fixed PhaseContext + continuity snapshots representing:
 * 1. ordinary endgame speech (no historical archive under new policy)
 * 2. huddle-heavy strategic decision
 * 3. post-eviction diary strategy reconciliation
 *
 * `legacy` estimates were measured against the pre-U4 full-history renderer
 * (`## Full Public Transcript` + complete `## Game Event Record`) using
 * `estimateTokensFromChars = ceil(chars / 4)`. They exist only for the
 * deterministic U5 promotion gate — not as a live rendering path.
 */

import { Phase } from "../../../types";
import type { AllianceHuddleFactAtom } from "../../../types";
import type {
  PhaseContext,
  RecallContinuitySnapshot,
  RecallPromptClass,
  CompactStrategyState,
} from "../../../game-runner.types";
import { estimateTokensFromChars } from "../../../context-recall-plan";

export type RecallBaselineCaseId =
  | "ordinary_endgame_speech"
  | "huddle_heavy_strategic_decision"
  | "post_eviction_diary_strategy";

export interface RecallBaselineLegacyEstimate {
  /** Character length of the legacy `buildUserPrompt` output. */
  readonly characterCount: number;
  /** `ceil(characterCount / 4)` using the shared estimator. */
  readonly tokenEstimate: number;
}

export interface RecallBaselineCase {
  readonly id: RecallBaselineCaseId;
  readonly promptClass: RecallPromptClass;
  /** Raw phase context inputs (no attached recallPlan — U5 recompiles). */
  readonly phaseContext: PhaseContext;
  readonly continuity: RecallContinuitySnapshot;
  readonly legacy: RecallBaselineLegacyEstimate;
}

function huddleCommitment(
  factId: string,
  actorPlayerId: string,
  targetPlayerId: string,
): AllianceHuddleFactAtom {
  return {
    kind: "commitment",
    factId,
    sessionId: `${factId}-session`,
    actorPlayerId,
    actionKind: "empower_vote",
    targetPlayerId,
    confidence: "high",
  };
}

const COMPACT_STRATEGY: CompactStrategyState = {
  lifecycle: "active",
  baseline: "Survive Reckoning with Mira as the closest partner while treating Vera as the public threat and Nyx as flexible.",
  deltas: [
    "Ask Mira whether she will still cover on a direct elimination vote.",
    "Reassess if Mira publicly breaks with Atlas.",
  ],
  priorEpoch: null,
  revision: 3,
};

const LONG_PUBLIC_LINES = Array.from({ length: 40 }, (_, index) => {
  const round = Math.max(1, Math.floor(index / 5) + 1);
  const speakers = ["Mira", "Vera", "Nyx", "House", "Atlas"] as const;
  const from = speakers[index % speakers.length]!;
  return {
    round,
    phase: index % 7 === 0 ? Phase.LOBBY : index % 5 === 0 ? Phase.COUNCIL : Phase.MINGLE,
    from,
    text:
      `Late-game public line ${index}: coalition talk about Vera pressure, Mira loyalty, ` +
      `Nyx flexibility, past shield on Echo, and whether the jury will punish bold moves. ` +
      `Receipt fragment: expose heat and empower math from earlier rounds still colors trust.`,
  };
});

const LONG_GAME_EVENTS = Array.from({ length: 28 }, (_, index) => {
  const round = Math.floor(index / 4) + 1;
  const kinds = [
    `R${round}/VOTE: Player voted empower=Mira, expose=Vera.`,
    `R${round}/POWER: Power action: protect -> Echo.`,
    `R${round}/POWER: Power resolved candidates=Rex, Finn; shield granted=Echo; auto-eliminated=none.`,
    `R${round}/COUNCIL: Council resolved: candidates Rex, Finn; eliminated by plurality.`,
    `R${round}/MINGLE: Room traffic summarized; private deals not listed here.`,
    `R${round}/ELIMINATION: Player left the game after council.`,
    `R${round}/VOTE: reckoning elimination resolved when applicable.`,
  ] as const;
  return kinds[index % kinds.length]!;
});

function baseAlivePlayers(): PhaseContext["alivePlayers"] {
  return [
    { id: "atlas-id", name: "Atlas", shielded: false },
    { id: "mira-id", name: "Mira", shielded: false },
    { id: "vera-id", name: "Vera", shielded: false },
    { id: "nyx-id", name: "Nyx", shielded: false },
  ];
}

function baseAllianceContext(): NonNullable<PhaseContext["allianceContext"]> {
  return {
    activeAlliances: [
      {
        id: "alliance-atlas-mira",
        name: "Atlas Mira Compact",
        memberIds: ["atlas-id", "mira-id"],
        memberNames: ["Atlas", "Mira"],
        purpose: "Mutual cover through midgame and Reckoning",
        timebox: null,
        status: "active",
        huddleOutcomes: [
          {
            id: "outcome-r2-pre-vote",
            round: 2,
            facts: [huddleCommitment("fact-r2", "atlas-id", "mira-id")],
          },
          {
            id: "outcome-r3-pre-council",
            round: 3,
            facts: [huddleCommitment("fact-r3", "mira-id", "atlas-id")],
          },
          {
            id: "outcome-r4-pre-vote",
            round: 4,
            facts: [huddleCommitment("fact-r4", "atlas-id", "vera-id")],
          },
        ],
      },
      {
        id: "alliance-closed-echo",
        name: "Echo Side Channel",
        memberIds: ["atlas-id", "echo-id"],
        memberNames: ["Atlas", "Echo"],
        purpose: "Temporary midgame information trade",
        timebox: "through R3",
        status: "closed",
        huddleOutcomes: [
          {
            id: "outcome-r1-echo",
            round: 1,
            facts: [huddleCommitment("fact-r1", "atlas-id", "mira-id")],
          },
        ],
      },
    ],
    openProposals: [],
    proposalHistory: [
      {
        lineageId: "lineage-nyx",
        allianceId: "alliance-nyx-flex",
        status: "declined",
        currentVersionId: "v1",
        currentTerms: {
          name: "Nyx Flex",
          memberIds: ["atlas-id", "nyx-id"],
          memberNames: ["Atlas", "Nyx"],
          purpose: "Flexible endgame insurance",
          timebox: null,
        },
        yourResponse: "declined",
      },
    ],
  };
}

function baseContinuity(): RecallContinuitySnapshot {
  return {
    compactStrategy: {
      ...COMPACT_STRATEGY,
      deltas: [...COMPACT_STRATEGY.deltas],
    },
  };
}

function makeOrdinaryEndgameSpeechContext(): PhaseContext {
  return {
    gameId: "game-baseline-1",
    round: 5,
    phase: Phase.PLEA,
    selfId: "atlas-id",
    selfName: "Atlas",
    alivePlayers: baseAlivePlayers(),
    publicMessages: LONG_PUBLIC_LINES.map((line) => ({
      from: line.from,
      text: line.text,
      phase: line.phase,
      round: line.round,
    })),
    publicTranscriptContext: LONG_PUBLIC_LINES.map((line) => ({ ...line })),
    mingleMessages: [
      { from: "Mira", text: "Stay on Vera. Do not let Nyx reframe the pair as the threat." },
      { from: "Nyx", text: "I can be flexible if you leave me out of the first Reckoning vote." },
    ],
    endgameStage: "reckoning",
    latestEliminatedPlayerName: "Sage",
    jury: [{ playerId: "sage-id", playerName: "Sage", eliminatedRound: 4 }],
    gameEventRecord: [...LONG_GAME_EVENTS],
    allianceContext: baseAllianceContext(),
    recentDecisions: [
      {
        round: 4,
        phase: Phase.VOTE,
        label: "Empowered Mira",
        detail: "Atlas empowered Mira",
      },
    ],
    revealedVoteLedger: [
      {
        round: 4,
        voterId: "atlas-id",
        voterName: "Atlas",
        empowerTargetId: "mira-id",
        empowerTargetName: "Mira",
      },
      {
        round: 4,
        voterId: "mira-id",
        voterName: "Mira",
        empowerTargetId: "atlas-id",
        empowerTargetName: "Atlas",
      },
      {
        round: 4,
        voterId: "vera-id",
        voterName: "Vera",
        empowerTargetId: "nyx-id",
        empowerTargetName: "Nyx",
      },
    ],
  };
}

function makeHuddleHeavyStrategicDecisionContext(): PhaseContext {
  return {
    ...makeOrdinaryEndgameSpeechContext(),
    phase: Phase.VOTE,
    endgameStage: "reckoning",
    // Strategic endgame elimination vote path still uses endgame stage.
  };
}

function makePostEvictionDiaryStrategyContext(): PhaseContext {
  return {
    ...makeOrdinaryEndgameSpeechContext(),
    phase: Phase.DIARY_ROOM,
    endgameStage: "reckoning",
  };
}

/**
 * Frozen legacy estimates measured from the pre-U4 full-history `buildUserPrompt`
 * on this corpus (U4 Step A). Do not recompute from the live path after full-history
 * retirement — these numbers are the U5 promotion baseline only.
 *
 * Measured 2026-07-26 on `feat/selective-context-recall` immediately before U4
 * rendering replacement. Legacy endgame prompts shared the full transcript + complete
 * game-event-record path, so speech and strategic decision sizes match; diary-room
 * phase label length accounts for the reflection delta.
 */
const LEGACY_ORDINARY_CHARS = 18_645;
const LEGACY_STRATEGIC_CHARS = 18_645;
const LEGACY_DIARY_STRATEGY_CHARS = 18_657;

export const RECALL_BASELINE_CORPUS: readonly RecallBaselineCase[] = [
  {
    id: "ordinary_endgame_speech",
    promptClass: "ordinary_speech",
    phaseContext: makeOrdinaryEndgameSpeechContext(),
    continuity: baseContinuity(),
    legacy: {
      characterCount: LEGACY_ORDINARY_CHARS,
      tokenEstimate: estimateTokensFromChars(LEGACY_ORDINARY_CHARS),
    },
  },
  {
    id: "huddle_heavy_strategic_decision",
    promptClass: "strategic_decision",
    phaseContext: makeHuddleHeavyStrategicDecisionContext(),
    continuity: baseContinuity(),
    legacy: {
      characterCount: LEGACY_STRATEGIC_CHARS,
      tokenEstimate: estimateTokensFromChars(LEGACY_STRATEGIC_CHARS),
    },
  },
  {
    id: "post_eviction_diary_strategy",
    promptClass: "strategic_decision",
    phaseContext: makePostEvictionDiaryStrategyContext(),
    continuity: {
      compactStrategy: {
        lifecycle: "reconciliation_required",
        baseline: null,
        deltas: [],
        priorEpoch: {
          lifecycle: "active",
          baseline: COMPACT_STRATEGY.baseline,
          deltas: [...COMPACT_STRATEGY.deltas],
          revision: COMPACT_STRATEGY.revision,
        },
        revision: 4,
      },
    },
    legacy: {
      characterCount: LEGACY_DIARY_STRATEGY_CHARS,
      tokenEstimate: estimateTokensFromChars(LEGACY_DIARY_STRATEGY_CHARS),
    },
  },
];

/** Lookup helper for U5 promotion tests. */
export function getRecallBaselineCase(id: RecallBaselineCaseId): RecallBaselineCase {
  const found = RECALL_BASELINE_CORPUS.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Unknown recall baseline case: ${id}`);
  }
  return found;
}
