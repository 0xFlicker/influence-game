/**
 * Frozen late-game baseline corpus for selective context recall promotion (U4 → U5).
 *
 * Inputs are fixed PhaseContext + continuity snapshots representing:
 * 1. ordinary endgame speech (no historical archive under new policy)
 * 2. huddle-heavy strategic decision
 * 3. Strategy Reflection
 *
 * `legacy` estimates were measured against the pre-U4 full-history renderer
 * (`## Full Public Transcript` + complete `## Game Event Record`) using
 * `estimateTokensFromChars = ceil(chars / 4)`. They exist only for the
 * deterministic U5 promotion gate — not as a live rendering path.
 */

import { Phase } from "../../../types";
import type {
  PhaseContext,
  RecallContinuitySnapshot,
  RecallPromptClass,
  StrategyPacketSummary,
} from "../../../game-runner.types";
import { estimateTokensFromChars } from "../../../context-recall-plan";

export type RecallBaselineCaseId =
  | "ordinary_endgame_speech"
  | "huddle_heavy_strategic_decision"
  | "strategic_reflection";

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

const STRATEGY_PACKET: StrategyPacketSummary = {
  revisionId: "rev-late-3",
  previousRevisionId: "rev-late-2",
  updatedAtRound: 4,
  updatedAtPhase: Phase.VOTE,
  objective: "Survive Reckoning and carry Mira into the final two",
  targetPosture: "Pressure Vera as the public threat; watch Nyx as secondary",
  coalitionPosture: "Hold Atlas-Mira pair; treat Nyx as flexible",
  nextSocialProbe: "Ask Mira whether she will still cover on a direct elimination vote",
  strategicLens: "coalition_geometry",
  strategicLensRationale: "Pair integrity is the only remaining durable structure",
  uncertainty: "Whether Vera has a secret juror commitment",
  reviseTrigger: "If Mira publicly breaks with Atlas",
  changedSincePrevious: "Dropped Rex after elimination; retargeted Vera",
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
            ask: "Lock empower on Mira and pressure Vera",
            plan: "Publicly soft-talk Vera then ballot Mira empower",
            promises: ["Mira covers Atlas if expose heat rises"],
            dissent: [],
            confidence: "high",
            posture: "locked_pair",
            leakOrBetrayalClaims: [],
          },
          {
            id: "outcome-r3-pre-council",
            round: 3,
            ask: "Survive council without spending eliminate",
            plan: "Lobby pass; keep pair votes off each other",
            promises: ["Neither names the other as council target"],
            dissent: ["Mira worried Nyx will flip"],
            confidence: "medium",
            posture: "defensive_pair",
            leakOrBetrayalClaims: ["Nyx claimed Mira offered a side deal"],
          },
          {
            id: "outcome-r4-pre-vote",
            round: 4,
            ask: "Enter Reckoning with Vera as public threat",
            plan: "Coordinate direct elimination heat toward Vera",
            promises: ["Atlas and Mira vote Vera if four remain"],
            dissent: [],
            confidence: "high",
            posture: "endgame_pair",
            leakOrBetrayalClaims: [],
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
            ask: "Share expose reads without formal alliance language",
            plan: "Atlas signals Vera; Echo softens on Mira",
            promises: ["No public betrayal this round"],
            dissent: [],
            confidence: "low",
            posture: "info_trade",
            leakOrBetrayalClaims: [],
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
    strategyPacket: { ...STRATEGY_PACKET },
    reflectionSummary: {
      certainties: ["Mira still treats Atlas as primary cover", "Vera is the loudest public threat"],
      suspicions: ["Nyx may be shopping a juror story", "Vera will pitch jury punishment"],
      allies: ["Mira"],
      threats: ["Vera", "Nyx"],
      plan: "Keep Mira close, isolate Vera, reassess Nyx after Reckoning speech",
      strategicLens: "coalition_geometry",
      strategicLensRationale: "Pair math dominates with four left",
    },
    recentStrategicDecisions: [
      {
        round: 4,
        phase: Phase.VOTE,
        action: "empower",
        label: "Empower ballot",
        decisionLog: "Empowered Mira to keep chooser seat with the pair",
      },
      {
        round: 3,
        phase: Phase.COUNCIL,
        action: "council_vote",
        label: "Council ballot",
        decisionLog: "Voted Finn to protect pair geometry",
      },
    ],
    strategicEvidenceVersion: 7,
    strategyPacketRevisionCounter: 3,
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

function makeStrategicReflectionContext(): PhaseContext {
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
const LEGACY_REFLECTION_CHARS = 18_657;

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
    id: "strategic_reflection",
    promptClass: "strategic_reflection",
    phaseContext: makeStrategicReflectionContext(),
    continuity: baseContinuity(),
    legacy: {
      characterCount: LEGACY_REFLECTION_CHARS,
      tokenEstimate: estimateTokensFromChars(LEGACY_REFLECTION_CHARS),
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
