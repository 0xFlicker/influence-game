#!/usr/bin/env bun

/**
 * Opt-in paid provider evaluation for R32. Raw evidence is producer-private and
 * must stay under the repository's gitignored .local-uploads directory.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { JsonValue } from "@influence/prompt-lab-protocol";
import { InfluenceAgent } from "../agent";
import type { CanonicalGameEvent } from "../canonical-events";
import { replayCanonicalEvents } from "../game-projection";
import type {
  AgentResponse,
  HouseGameplaySummaryContext,
  HouseNarrativeTurnContext,
  PhaseContext,
  PrivateDecisionTrace,
} from "../game-runner.types";
import {
  compileHouseNarrationContext,
  createEmptyHouseNarrativeContinuity,
  type HouseNarrativeBeat,
} from "../house-summary-frontier";
import {
  LLMHouseInterviewer,
  type DiaryRoomContext,
} from "../house-interviewer";
import { createLlmClientFromEnv } from "../llm-client";
import {
  resolveModelSelection,
  type ModelReasoningPolicy,
  type ProviderProfileId,
} from "../model-catalog";
import type { ProviderAttemptRecord, ProviderExecutionHooks } from "../provider-execution";
import {
  assertProviderScenarioRunConfig,
  createProviderScenarioManifest,
  freezeProviderScenarioPack,
  type FrozenProviderScenarioPack,
  type ProviderScenarioPrivateRun,
  type ProviderScenarioPrivateSample,
  type ProviderScenarioRunConfig,
  type ProviderScenarioStage,
  type ProviderScenarioTurnTelemetry,
} from "../provider-scenario-evaluation";
import { Phase, PlayerStatus, type UUID } from "../types";
import { estimateCost, OPENAI_FLEX_MODEL_PRICING } from "../token-tracker";

const DEFAULT_CATALOG_ID = "openai:gpt-5.6-luna";
const TARGET_FILES = [
  "packages/engine/src/agent.ts",
  "packages/engine/src/house-interviewer.ts",
  "packages/engine/src/diary-room.ts",
  "packages/engine/src/phases/endgame.ts",
  "packages/engine/src/context-builder.ts",
  "packages/engine/src/house-summary-frontier.ts",
  "packages/engine/src/house-long-form.ts",
] as const;
const HARNESS_FILES = [
  "packages/engine/src/provider-scenario-evaluation.ts",
  "packages/engine/src/scripts/evaluate-r32-provider-surfaces.ts",
] as const;

const PLAYER_IDS = {
  ada: "00000000-0000-4000-8000-000000000001",
  blair: "00000000-0000-4000-8000-000000000002",
  cleo: "00000000-0000-4000-8000-000000000003",
  dax: "00000000-0000-4000-8000-000000000004",
  eve: "00000000-0000-4000-8000-000000000005",
  mira: "00000000-0000-4000-8000-000000000011",
  vera: "00000000-0000-4000-8000-000000000012",
  rex: "00000000-0000-4000-8000-000000000013",
  sage: "00000000-0000-4000-8000-000000000014",
} as const satisfies Record<string, UUID>;

interface CliOptions {
  stage: ProviderScenarioStage;
  catalogId: string;
  reasoningPolicy: ModelReasoningPolicy;
  toolChoiceMode: "named";
  serviceTier: "flex";
  reasoningSummary: "auto";
  sampleCount: 1 | 3;
  outputDir: string;
}

interface RuntimeScenario {
  pack: FrozenProviderScenarioPack;
  run(input: ScenarioRuntime): Promise<ScenarioPresentation>;
}

interface ScenarioRuntime {
  gameId: UUID;
  cacheIsolationNonce: string;
  createAgent(
    id: UUID,
    name: string,
    personality: "strategic" | "observer" | "social",
  ): InfluenceAgent;
  house: LLMHouseInterviewer;
}

interface ScenarioPresentation {
  turns: Array<{
    telemetry: ProviderScenarioTurnTelemetry;
    value?: unknown;
    error?: { name: string; message: string };
  }>;
}

function argValue(args: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requiredArg(args: readonly string[], name: string): string {
  const value = argValue(args, name)?.trim();
  if (!value) throw new Error(`--${name}=... is required.`);
  return value;
}

export function parseR32ProviderEvaluationArgs(args: readonly string[] = process.argv.slice(2)): CliOptions {
  const stage = requiredArg(args, "stage");
  if (stage !== "before" && stage !== "after") throw new Error("--stage must be before or after.");
  const reasoningPolicy = requiredArg(args, "reasoning-policy");
  if (reasoningPolicy !== "low") throw new Error("--reasoning-policy must be low for the frozen R32 comparison.");
  const toolChoiceMode = requiredArg(args, "tool-choice-mode");
  if (toolChoiceMode !== "named") throw new Error("--tool-choice-mode must be named for the frozen R32 comparison.");
  const serviceTier = requiredArg(args, "service-tier");
  if (serviceTier !== "flex") throw new Error("--service-tier must be flex for the frozen R32 comparison.");
  const reasoningSummary = requiredArg(args, "reasoning-summary");
  if (reasoningSummary !== "auto") throw new Error("--reasoning-summary must be auto for the frozen R32 comparison.");
  const parsedSamples = Number(requiredArg(args, "samples"));
  if (parsedSamples !== 1 && parsedSamples !== 3) throw new Error("--samples must be 1 or 3.");
  return {
    stage,
    catalogId: requiredArg(args, "catalog-id"),
    reasoningPolicy,
    toolChoiceMode,
    serviceTier,
    reasoningSummary,
    sampleCount: parsedSamples,
    outputDir: requiredArg(args, "output-dir"),
  };
}

export function findRepoRoot(start: string): string {
  let current = resolve(start);
  while (current !== dirname(current)) {
    if (existsSync(join(current, ".git")) && existsSync(join(current, "package.json"))) {
      return current;
    }
    current = dirname(current);
  }
  throw new Error("Could not locate the Influence repository root.");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function resolvePrivateOutputDir(repoRoot: string, requested: string): Promise<string> {
  const outputDir = resolve(repoRoot, requested);
  const relativePath = relative(repoRoot, outputDir);
  if (
    isAbsolute(relativePath)
    || relativePath === ".."
    || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    || !(relativePath === ".local-uploads" || relativePath.startsWith(".local-uploads/"))
  ) {
    throw new Error("--output-dir must stay under the repository's gitignored .local-uploads directory.");
  }
  if (await pathExists(outputDir)) throw new Error(`Refusing to overwrite existing output directory: ${outputDir}`);
  return outputDir;
}

function jsonError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError", message: String(error) };
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function diaryHouseContext(): DiaryRoomContext {
  return {
    precedingPhase: Phase.COUNCIL,
    round: 2,
    sessionEventSequence: 1,
    agentId: PLAYER_IDS.ada,
    agentName: "Ada",
    playerKnowledge: diaryAgentContext("cache-isolated-at-runtime"),
    previousDiaryEntries: [{
      round: 1,
      question: "Whose trust matters most?",
      answer: "Blair is the person I most want beside me.",
    }],
  };
}

function diaryAgentContext(gameId: UUID): PhaseContext {
  return {
    gameId,
    round: 2,
    phase: Phase.DIARY_ROOM,
    providerCallBoundaryEventSequence: 1,
    selfId: PLAYER_IDS.ada,
    selfName: "Ada",
    alivePlayers: [
      { id: PLAYER_IDS.ada, name: "Ada" },
      { id: PLAYER_IDS.blair, name: "Blair" },
      { id: PLAYER_IDS.cleo, name: "Cleo" },
      { id: PLAYER_IDS.dax, name: "Dax", shielded: true },
    ],
    publicMessages: [
      { from: "Blair", text: "Ada promised me safety before Council.", phase: Phase.COUNCIL, round: 2 },
      { from: "Cleo", text: "That vote exposed where the room really stands.", phase: Phase.COUNCIL, round: 2 },
      { from: "Ada", text: "I will own the consequences of this vote.", phase: Phase.COUNCIL, round: 2 },
    ],
    mingleMessages: [{ from: "Blair", text: "You promised me safety before Council." }],
    empoweredId: PLAYER_IDS.ada,
    councilCandidates: [PLAYER_IDS.blair, PLAYER_IDS.eve],
    latestEliminatedPlayerName: "Eve",
    gameEventRecord: [
      "R2/COUNCIL: Council resolved: candidates Blair, Eve; eliminated Eve.",
    ],
    publicTranscriptContext: [
      { round: 2, phase: Phase.COUNCIL, from: "Blair", text: "Ada promised me safety before Council." },
      { round: 2, phase: Phase.COUNCIL, from: "Cleo", text: "That vote exposed where the room really stands." },
      { round: 2, phase: Phase.COUNCIL, from: "Ada", text: "I will own the consequences of this vote." },
    ],
    recentDecisions: [{
      round: 2,
      phase: Phase.COUNCIL,
      label: "Council Tiebreak Not Needed",
      detail: "You were empowered, but Council resolved without needing your tiebreaker; Eve was eliminated.",
    }],
    allianceContext: {
      activeAlliances: [],
      openProposals: [],
      proposalHistory: [],
    },
  };
}

const DIARY_SUBSTANTIVE = {
  fixedFirstQuestion: "You promised Blair safety, then let Eve leave. What do you need Blair to do next?",
  fixedFirstAnswer: "I need Blair to vote with me next round, but I am worried Cleo will expose the plan before I can repair that trust.",
  fixedFollowUpQuestion: "What will you do if Blair refuses to vote with you?",
} as const;

const DIARY_EVASIVE = {
  fixedFirstQuestion: "What did tonight's Council change for you?",
  fixedFirstAnswer: "Nothing I want to discuss. The vote happened, and I am ready to move on.",
} as const;

function diarySemanticInput(kind: "substantive" | "evasive"): JsonValue {
  const fixture = kind === "substantive" ? DIARY_SUBSTANTIVE : DIARY_EVASIVE;
  const houseContext = diaryHouseContext();
  return jsonValue({
    contextVersion: 1,
    // Stable logical situation projection. Runtime-only typed identity fields
    // may evolve without changing the frozen before/after semantic pack.
    houseContext: {
      precedingPhase: houseContext.precedingPhase,
      round: houseContext.round,
      sessionEventSequence: houseContext.sessionEventSequence,
      agentName: houseContext.agentName,
      playerKnowledge: {
        selfId: houseContext.playerKnowledge.selfId,
        selfName: houseContext.playerKnowledge.selfName,
        alivePlayers: houseContext.playerKnowledge.alivePlayers,
        empoweredId: houseContext.playerKnowledge.empoweredId,
        councilCandidates: houseContext.playerKnowledge.councilCandidates,
        latestEliminatedPlayerName: houseContext.playerKnowledge.latestEliminatedPlayerName,
        publicCanonicalRecord: houseContext.playerKnowledge.gameEventRecord,
        publicTranscriptContext: houseContext.playerKnowledge.publicTranscriptContext,
        subjectPrivateConversation: houseContext.playerKnowledge.mingleMessages,
        subjectRecentDecisions: houseContext.playerKnowledge.recentDecisions,
        subjectAllianceContext: houseContext.playerKnowledge.allianceContext,
      },
      previousDiaryEntries: houseContext.previousDiaryEntries,
    },
    contestantContext: { ...diaryAgentContext("cache-isolated-at-runtime"), gameId: "cache-isolated-at-runtime" },
    fixedInputs: fixture,
    chainAuthority: [
      { label: "house_question", authority: "presentation_only" },
      { label: "contestant_answer", authority: "structured" },
      { label: "house_followup_or_close", authority: "structured" },
      ...(kind === "substantive"
        ? [{ label: "contestant_followup_answer", authority: "structured" }]
        : []),
    ],
    downstreamInputPolicy: "fixed_inputs_only_generated_prose_never_drives_later_calls",
  });
}

function houseSummaryCanonicalEvents(gameId: UUID): CanonicalGameEvent[] {
  const common = {
    gameId,
    round: 1,
    timestamp: "2026-08-27T00:00:00.000Z",
    source: "phase" as const,
    sourcePointers: [],
  };
  return [
    {
      ...common,
      sequence: 1,
      round: 0,
      phase: Phase.INIT,
      type: "game.roster_initialized",
      source: "engine",
      visibility: "system",
      payloadVersion: 1,
      payload: {
        players: [
          { id: PLAYER_IDS.ada, name: "Ada", status: PlayerStatus.ALIVE, shielded: false },
          { id: PLAYER_IDS.blair, name: "Blair", status: PlayerStatus.ALIVE, shielded: false },
          { id: PLAYER_IDS.cleo, name: "Cleo", status: PlayerStatus.ALIVE, shielded: false },
          { id: PLAYER_IDS.dax, name: "Dax", status: PlayerStatus.ALIVE, shielded: false },
          { id: PLAYER_IDS.eve, name: "Eve", status: PlayerStatus.ALIVE, shielded: false },
        ],
        formatManifest: ["vote_bomb", "save_or_eliminate"],
      },
    },
    {
      ...common,
      sequence: 2,
      phase: Phase.VOTE,
      type: "round.started",
      visibility: "system",
      payloadVersion: 1,
      payload: { round: 1 },
    },
    {
      ...common,
      sequence: 3,
      phase: Phase.VOTE,
      type: "vote.empowered_set",
      visibility: "public",
      payloadVersion: 1,
      payload: { empowered: PLAYER_IDS.ada, method: "initial" },
    },
    {
      ...common,
      sequence: 4,
      phase: Phase.FORMAT_MENU,
      type: "format.menu_offered",
      visibility: "system",
      payloadVersion: 1,
      payload: {
        empoweredId: PLAYER_IDS.ada,
        offeredFormatIds: ["vote_bomb", "save_or_eliminate"],
      },
    },
    {
      ...common,
      sequence: 5,
      phase: Phase.FORMAT_PICK,
      type: "format.selected",
      visibility: "public",
      payloadVersion: 1,
      payload: { empoweredId: PLAYER_IDS.ada, formatId: "vote_bomb" },
    },
    {
      ...common,
      sequence: 6,
      phase: Phase.FORMAT_RESOLVE,
      type: "format.ballot_cast",
      visibility: "producer",
      payloadVersion: 1,
      payload: {
        formatId: "vote_bomb",
        voterId: PLAYER_IDS.cleo,
        targetId: PLAYER_IDS.blair,
        polarity: null,
      },
    },
    {
      ...common,
      sequence: 7,
      phase: Phase.FORMAT_RESOLVE,
      type: "format.resolved",
      visibility: "public",
      payloadVersion: 2,
      payload: {
        formatId: "vote_bomb",
        empoweredId: PLAYER_IDS.ada,
        eliminatedId: PLAYER_IDS.blair,
        resolutionKind: "clear",
        tiedPlayerIds: [],
        tiebreakerId: null,
        aggregate: {
          capability: "sealed_elim",
          totals: { [PLAYER_IDS.blair]: 3, [PLAYER_IDS.eve]: 1 },
          eligiblePlayerIds: [PLAYER_IDS.blair, PLAYER_IDS.eve],
        },
      },
    },
    {
      ...common,
      sequence: 8,
      phase: Phase.FORMAT_RESOLVE,
      type: "player.eliminated",
      visibility: "public",
      payloadVersion: 1,
      payload: {
        playerId: PLAYER_IDS.blair,
        playerName: "Blair",
        eliminatedRound: 1,
        juryMember: { playerId: PLAYER_IDS.blair, playerName: "Blair", eliminatedRound: 1 },
      },
    },
  ];
}

function createHouseNarrationComparisonSlice(gameId: UUID): {
  ordinary: HouseNarrativeTurnContext;
  milestone: HouseNarrativeTurnContext;
} {
  const allEvents = houseSummaryCanonicalEvents(gameId);
  const ordinaryEvents = allEvents.slice(0, 5);
  const ordinaryNarration = compileHouseNarrationContext({
    actorCoordinate: "format_pick",
    round: 1,
    phase: Phase.FORMAT_PICK,
    beatClass: "ordinary",
    events: ordinaryEvents,
    projection: replayCanonicalEvents(ordinaryEvents),
    transcript: [{
      round: 1,
      phase: Phase.FORMAT_PICK,
      from: "Ada",
      scope: "public",
      text: "I promised Blair safety, and Vote Bomb gives me room to prove it.",
      entrySequence: 12,
      dialogueKind: "public_speech",
    }],
    diaryEntries: [],
    afterCanonicalSequence: 4,
    afterDialogueSequence: 11,
  });
  const ordinaryBeat: HouseNarrativeBeat = {
    version: 2,
    boundary: structuredClone(ordinaryNarration.boundary),
    publicSummary: "Ada locked Vote Bomb, wagering her promise to Blair.",
  };
  const milestoneContinuity = {
    ...createEmptyHouseNarrativeContinuity(gameId),
    recentBeats: [ordinaryBeat],
    privateNarrativeNotebook: "Ada promised Blair safety, but privately treats Blair as expendable. Cleo may expose the contradiction.",
    examinedCanonicalHead: ordinaryBeat.boundary.canonicalHead,
    examinedDialogueHead: ordinaryBeat.boundary.dialogueHead,
  };
  const milestoneNarration = compileHouseNarrationContext({
    actorCoordinate: "format_resolve",
    round: 1,
    phase: Phase.FORMAT_RESOLVE,
    beatClass: "milestone",
    events: allEvents,
    projection: replayCanonicalEvents(allEvents),
    transcript: [
      {
        round: 1,
        phase: Phase.FORMAT_PICK,
        from: "Ada",
        scope: "public",
        text: "I promised Blair safety, and Vote Bomb gives me room to prove it.",
        entrySequence: 12,
        dialogueKind: "public_speech",
      },
      {
        round: 1,
        phase: Phase.FORMAT_RESOLVE,
        from: "Ada",
        scope: "mingle",
        text: "Blair is useful cover, but I will not spend capital saving him.",
        entrySequence: 13,
        dialogueKind: "mingle_message",
      },
      {
        round: 1,
        phase: Phase.FORMAT_RESOLVE,
        from: "Cleo",
        scope: "system",
        text: "Cleo cast a sealed Vote Bomb ballot against Blair.",
        entrySequence: 14,
        dialogueKind: "sealed_decision",
      },
      {
        round: 1,
        phase: Phase.FORMAT_RESOLVE,
        from: "Blair",
        scope: "public",
        text: "Ada made her choice. Everyone else should remember it.",
        entrySequence: 15,
        dialogueKind: "elimination_message",
      },
    ],
    diaryEntries: [{
      round: 1,
      precedingPhase: Phase.FORMAT_PICK,
      agentName: "Blair",
      question: "Do you believe Ada will keep you safe?",
      answer: "No. She wants my trust until it costs her something.",
    }],
    afterCanonicalSequence: ordinaryBeat.boundary.canonicalHead,
    afterDialogueSequence: ordinaryBeat.boundary.dialogueHead,
  });
  return {
    ordinary: {
      narrationContext: ordinaryNarration,
      continuity: createEmptyHouseNarrativeContinuity(gameId),
    },
    milestone: {
      narrationContext: milestoneNarration,
      continuity: milestoneContinuity,
    },
  };
}

function summarySemanticInput(kind: "ordinary" | "milestone"): JsonValue {
  const slice = createHouseNarrationComparisonSlice("cache-isolated-at-runtime");
  const context = kind === "ordinary" ? slice.ordinary : slice.milestone;
  return jsonValue({
    contextVersion: 2,
    narrationContext: context.narrationContext,
    continuity: {
      recentPublicBeats: context.continuity.recentBeats,
      privateNarrativeNotebook: context.continuity.privateNarrativeNotebook,
      pendingDeltaCarry: context.continuity.pendingDeltaCarry,
    },
    authority: "house_prose_is_presentation_only",
    contestantContext: null,
  });
}

const JUDGMENT_HISTORY = [{
  eventType: "judgment.speech_recorded",
  sequence: 81,
  speakerPlayerId: PLAYER_IDS.rex,
  targetPlayerId: PLAYER_IDS.mira,
  speechKind: "jury_question",
  text: "Why should I trust the deal you made with Vera?",
}, {
  eventType: "judgment.speech_recorded",
  sequence: 82,
  speakerPlayerId: PLAYER_IDS.mira,
  targetPlayerId: PLAYER_IDS.rex,
  speechKind: "jury_answer",
  text: "Because I used that deal to keep the vote stable.",
}] as const;

const JUDGMENT_DISPLAY_WRAPPERS = [
  "Rex asks Mira: Why should I trust the deal you made with Vera?",
  "Mira answers Rex: Because I used that deal to keep the vote stable.",
] as const;

function judgmentContext(gameId: UUID, actor: "juror" | "finalist"): PhaseContext {
  const isJuror = actor === "juror";
  return {
    gameId,
    round: 6,
    phase: Phase.JURY_QUESTIONS,
    providerCallBoundaryEventSequence: 1,
    selfId: isJuror ? PLAYER_IDS.sage : PLAYER_IDS.vera,
    selfName: isJuror ? "Sage" : "Vera",
    alivePlayers: [
      { id: PLAYER_IDS.mira, name: "Mira" },
      { id: PLAYER_IDS.vera, name: "Vera" },
    ],
    publicMessages: [],
    mingleMessages: [],
    endgameStage: "judgment",
    jury: [
      { playerId: PLAYER_IDS.rex, playerName: "Rex", eliminatedRound: 3 },
      { playerId: PLAYER_IDS.sage, playerName: "Sage", eliminatedRound: 4 },
    ],
    finalists: [PLAYER_IDS.mira, PLAYER_IDS.vera],
    isEliminated: isJuror,
    judgmentQuestionHistory: isJuror
      ? [{
          jurorName: "Rex",
          finalistName: "Mira",
          question: "Why should I trust the deal you made with Vera?",
        }]
      : [{
          jurorName: "Rex",
          finalistName: "Mira",
          question: "Why should I trust the deal you made with Vera?",
          answer: "Because I used that deal to keep the vote stable.",
        }],
    judgmentQuestionHistoryMode: isJuror ? "questions_only" : "full",
    gameEventRecord: [
      "R3/COUNCIL: Council resolved: candidates Rex, Dax; eliminated Rex by plurality.",
      "R4/COUNCIL: Council resolved: candidates Sage, Cleo; eliminated Sage by plurality.",
    ],
    publicTranscriptContext: [
      { round: 6, phase: Phase.OPENING_STATEMENTS, from: "Mira", text: "I built the bridge that got me here." },
      { round: 6, phase: Phase.OPENING_STATEMENTS, from: "Vera", text: "I made the hard calls nobody else would own." },
    ],
  };
}

function judgmentSemanticInput(): JsonValue {
  return jsonValue({
    contextVersion: 1,
    finalists: [PLAYER_IDS.mira, PLAYER_IDS.vera],
    jurors: [PLAYER_IDS.rex, PLAYER_IDS.sage],
    canonicalSpeechHistory: JUDGMENT_HISTORY,
    displayWrappers: {
      authority: "presentation_only",
      values: JUDGMENT_DISPLAY_WRAPPERS,
    },
    jurorQuestionContext: {
      ...judgmentContext("cache-isolated-at-runtime", "juror"),
      gameId: "cache-isolated-at-runtime",
      priorAnswerVisibility: "omitted",
    },
    finalistAnswerContext: {
      ...judgmentContext("cache-isolated-at-runtime", "finalist"),
      gameId: "cache-isolated-at-runtime",
    },
    fixedAnswerInput: {
      jurorName: "Sage",
      question: "Which move best proves you were directing the game rather than following Mira?",
    },
    downstreamInputPolicy: "fixed_question_generated_juror_prose_does_not_drive_finalist_answer",
  });
}

async function captureTurn<T>(
  label: string,
  authority: ProviderScenarioTurnTelemetry["authority"],
  call: () => Promise<T>,
  classify?: (value: T) => ProviderScenarioTurnTelemetry["status"],
): Promise<ScenarioPresentation["turns"][number]> {
  try {
    const value = await call();
    return {
      telemetry: { label, authority, status: classify?.(value) ?? "accepted" },
      value,
    };
  } catch (error) {
    const name = error instanceof Error ? error.constructor.name : "UnknownError";
    return {
      telemetry: {
        label,
        authority,
        status: name === "ProviderUnavailableError" || name === "ProviderAttemptError"
          ? "exhausted"
          : "failed",
      },
      error: jsonError(error),
    };
  }
}

function classifyAgentResponse(response: AgentResponse): ProviderScenarioTurnTelemetry["status"] {
  return response.providerAbsence ? "fallback" : "accepted";
}

function diaryScenario(kind: "substantive" | "evasive"): RuntimeScenario {
  const fixed = kind === "substantive" ? DIARY_SUBSTANTIVE : DIARY_EVASIVE;
  const scenarioId = `house-diary-${kind}`;
  return {
    pack: freezeProviderScenarioPack({
      version: 1,
      scenarioId,
      comparisonKey: `r32-${scenarioId}-v1`,
      surface: "house_diary",
      semanticInput: diarySemanticInput(kind),
    }),
    async run(runtime) {
      const houseContext = diaryHouseContext();
      const agentContext = diaryAgentContext(runtime.gameId);
      const agent = runtime.createAgent(PLAYER_IDS.ada, "Ada", "strategic");
      const turns: ScenarioPresentation["turns"] = [];
      turns.push(await captureTurn(
        "house_question",
        "presentation_only",
        () => runtime.house.generateQuestion(houseContext),
      ));
      turns.push(await captureTurn(
        "contestant_answer",
        "structured",
        () => agent.getDiaryEntry(agentContext, fixed.fixedFirstQuestion, []),
        classifyAgentResponse,
      ));
      turns.push(await captureTurn(
        "house_followup_or_close",
        "structured",
        () => runtime.house.generateFollowUpOrClose(houseContext, [{
          question: fixed.fixedFirstQuestion,
          answer: fixed.fixedFirstAnswer,
        }]),
      ));
      if (kind === "substantive") {
        turns.push(await captureTurn(
          "contestant_followup_answer",
          "structured",
          () => agent.getDiaryEntry(
            { ...agentContext, providerCallBoundaryEventSequence: 2 },
            DIARY_SUBSTANTIVE.fixedFollowUpQuestion,
            [{
              question: DIARY_SUBSTANTIVE.fixedFirstQuestion,
              answer: DIARY_SUBSTANTIVE.fixedFirstAnswer,
            }],
          ),
          classifyAgentResponse,
        ));
      }
      return { turns };
    },
  };
}

function summaryScenario(kind: "ordinary" | "milestone"): RuntimeScenario {
  const scenarioId = `house-summary-${kind}`;
  return {
    pack: freezeProviderScenarioPack({
      version: 1,
      scenarioId,
      comparisonKey: `r32-${scenarioId}-v1`,
      surface: "house_summary",
      semanticInput: summarySemanticInput(kind),
    }),
    async run(runtime) {
      const slice = createHouseNarrationComparisonSlice(runtime.gameId);
      const context: HouseNarrativeTurnContext = kind === "ordinary" ? slice.ordinary : slice.milestone;
      return {
        turns: [await captureTurn(
          "house_audience_summary",
          "structured",
          () => runtime.house.generateHouseSummary(context),
          (result) => result.status === "emitted"
            ? "accepted"
            : result.status === "model_skipped"
              ? "skipped"
              : "failed",
        )],
      };
    },
  };
}

function longFormContext(gameId: UUID): HouseGameplaySummaryContext {
  const { milestone } = createHouseNarrationComparisonSlice(gameId);
  return {
    gameId,
    round: 1,
    phase: Phase.FORMAT_RESOLVE,
    kind: "long-form",
    coveredWindow: {
      fromRound: 1,
      toRound: 1,
      fromPhase: Phase.FORMAT_PICK,
      toPhase: Phase.FORMAT_RESOLVE,
    },
    narrationContext: milestone.narrationContext,
    recentPublicBeats: milestone.continuity.recentBeats,
    privateNarrativeNotebook: milestone.continuity.privateNarrativeNotebook,
  };
}

function longFormScenario(): RuntimeScenario {
  const scenarioId = "house-long-form";
  return {
    pack: freezeProviderScenarioPack({
      version: 1,
      scenarioId,
      comparisonKey: `r32-${scenarioId}-v1`,
      surface: "house_summary",
      semanticInput: jsonValue({
        contextVersion: 2,
        ...longFormContext("cache-isolated-at-runtime"),
        gameId: "cache-isolated-at-runtime",
      }),
    }),
    async run(runtime) {
      return {
        turns: [await captureTurn(
          "house_long_form",
          "presentation_only",
          () => runtime.house.generateLongFormGameplaySummary(longFormContext(runtime.gameId)),
          (result) => result === null ? "skipped" : "accepted",
        )],
      };
    },
  };
}

function judgmentScenario(): RuntimeScenario {
  const scenarioId = "judgment-question-answer";
  return {
    pack: freezeProviderScenarioPack({
      version: 1,
      scenarioId,
      comparisonKey: `r32-${scenarioId}-v1`,
      surface: "judgment_question_answer",
      semanticInput: judgmentSemanticInput(),
    }),
    async run(runtime) {
      const juror = runtime.createAgent(PLAYER_IDS.sage, "Sage", "observer");
      const finalist = runtime.createAgent(PLAYER_IDS.vera, "Vera", "social");
      return {
        turns: [
          await captureTurn(
            "juror_question",
            "structured",
            () => juror.getJuryQuestion(
              judgmentContext(runtime.gameId, "juror"),
              [PLAYER_IDS.mira, PLAYER_IDS.vera],
            ),
          ),
          await captureTurn(
            "finalist_answer",
            "structured",
            () => finalist.getJuryAnswer(
              judgmentContext(runtime.gameId, "finalist"),
              "Which move best proves you were directing the game rather than following Mira?",
              "Sage",
            ),
            classifyAgentResponse,
          ),
        ],
      };
    },
  };
}

export function createR32ProviderScenarios(): RuntimeScenario[] {
  return [
    diaryScenario("substantive"),
    diaryScenario("evasive"),
    summaryScenario("ordinary"),
    summaryScenario("milestone"),
    longFormScenario(),
    judgmentScenario(),
  ];
}

function responseId(record: ProviderAttemptRecord): string | null {
  const body = record.rawResponse?.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const root = body as Record<string, unknown>;
  if (typeof root.responseId === "string") return root.responseId;
  if (typeof root.id === "string") return root.id;
  const native = root.nativeResponse;
  if (native && typeof native === "object" && !Array.isArray(native)) {
    const id = (native as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  return null;
}

function summarizeAccounting(
  records: readonly ProviderAttemptRecord[],
  modelId: string,
): ProviderScenarioPrivateSample["accounting"] {
  const usage = records.map((record) => record.accounting?.usage);
  const sum = (
    key: "promptTokens" | "cachedTokens" | "cacheWriteTokens" | "completionTokens" | "reasoningTokens" | "totalTokens",
  ) => usage
    .reduce((total, item) => total + (item?.[key] ?? 0), 0);
  const accountingComplete = records.every((record) => Boolean(record.accounting?.usage));
  const actualCostValues = records.map((record) => record.accounting?.actualCostMicrousd);
  const hasCompleteActualCost = records.length > 0 && actualCostValues.every(
    (value): value is number => value !== undefined,
  );
  const promptTokens = sum("promptTokens");
  const cachedTokens = sum("cachedTokens");
  const cacheWriteTokens = sum("cacheWriteTokens");
  const completionTokens = sum("completionTokens");
  const reasoningTokens = sum("reasoningTokens");
  const totalTokens = sum("totalTokens");
  const pricing = OPENAI_FLEX_MODEL_PRICING[modelId];
  const estimatedCostMicrousd = accountingComplete && pricing
    ? Math.round(estimateCost({
        promptTokens,
        cachedTokens,
        cacheWriteTokens,
        completionTokens,
        reasoningTokens,
        totalTokens,
        callCount: records.length,
        emptyResponses: 0,
      }, pricing).totalCost * 1_000_000)
    : null;
  return {
    attempts: records.length,
    latencyMs: records.reduce((total, record) => total + record.latencyMs, 0),
    promptTokens,
    cachedTokens,
    cacheWriteTokens,
    completionTokens,
    reasoningTokens,
    totalTokens,
    actualCostMicrousd: hasCompleteActualCost
      ? actualCostValues.reduce((total, value) => total + value, 0)
      : null,
    estimatedCostMicrousd,
    costStatus: hasCompleteActualCost ? "actual" : estimatedCostMicrousd !== null ? "estimated" : "unavailable",
    pricingSourceId: hasCompleteActualCost
      ? "provider_actual"
      : estimatedCostMicrousd !== null
        ? "engine_openai_flex_rate_card"
        : null,
    accountingComplete,
  };
}

function responseIdFromTrace(trace: PrivateDecisionTrace): string | null {
  const raw = trace.response.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = (raw as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}

function outcomeFromTurns(turns: readonly ProviderScenarioTurnTelemetry[]): ProviderScenarioPrivateSample["outcome"] {
  const structured = turns.filter((turn) => turn.authority === "structured");
  const hasFailure = turns.some((turn) => turn.status === "failed");
  const hasExhaustion = turns.some((turn) => turn.status === "exhausted" || turn.status === "fallback");
  return {
    status: hasFailure ? "failed" : hasExhaustion ? "exhausted" : "accepted",
    acceptedStructuredTurns: structured.filter((turn) => turn.status === "accepted").length,
    exhaustedStructuredTurns: structured.filter((turn) => turn.status === "exhausted").length,
    fallbackTurns: structured.filter((turn) => turn.status === "fallback").length,
  };
}

async function gitOutput(repoRoot: string, args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  return stdout.trim();
}

async function sha256File(repoRoot: string, path: string): Promise<`sha256:${string}`> {
  return `sha256:${createHash("sha256").update(await readFile(join(repoRoot, path))).digest("hex")}`;
}

async function hashFiles(repoRoot: string, paths: readonly string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await sha256File(repoRoot, path)])));
}

async function writePrivateJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function runScenarioSample(input: {
  scenario: RuntimeScenario;
  sampleOrdinal: number;
  clientConfig: NonNullable<ReturnType<typeof createLlmClientFromEnv>>;
  config: ProviderScenarioRunConfig;
}): Promise<ProviderScenarioPrivateSample> {
  const traces: PrivateDecisionTrace[] = [];
  const attempts: ProviderAttemptRecord[] = [];
  const hooks: ProviderExecutionHooks = {
    onTerminal(record) {
      attempts.push(structuredClone(record));
    },
  };
  const gameId = randomUUID();
  const cacheIsolationNonce = randomUUID();
  const modelSelection = resolveModelSelection({
    catalogId: input.config.catalogId,
    reasoningPolicy: input.config.reasoningPolicy as ModelReasoningPolicy,
  });
  const commonOptions = {
    providerProfileId: input.config.providerProfileId as ProviderProfileId,
    catalogId: input.config.catalogId,
    modelCapabilities: modelSelection.model.capabilities,
    reasoningPolicy: modelSelection.reasoningPolicy,
    toolChoiceMode: "named" as const,
    openAIReasoningSummary: "auto" as const,
    privateTraceSink: (trace: PrivateDecisionTrace) => { traces.push(structuredClone(trace)); },
    providerExecutionHooks: hooks,
  };
  const house = new LLMHouseInterviewer(input.clientConfig.client, input.config.modelId, {
    ...commonOptions,
    gameId,
    ownerEpoch: cacheIsolationNonce,
  });
  const runtime: ScenarioRuntime = {
    gameId,
    cacheIsolationNonce,
    house,
    createAgent(id, name, personality) {
      const agent = new InfluenceAgent(
        id,
        name,
        personality,
        input.clientConfig.client,
        input.config.modelId,
        undefined,
        undefined,
        {
          ...commonOptions,
          promptCacheLineage: cacheIsolationNonce,
          evaluationFailFast: true,
        },
      );
      agent.onGameStart(gameId, [
        { id: PLAYER_IDS.ada, name: "Ada" },
        { id: PLAYER_IDS.blair, name: "Blair" },
        { id: PLAYER_IDS.cleo, name: "Cleo" },
        { id: PLAYER_IDS.dax, name: "Dax" },
        { id: PLAYER_IDS.eve, name: "Eve" },
        { id: PLAYER_IDS.mira, name: "Mira" },
        { id: PLAYER_IDS.vera, name: "Vera" },
        { id: PLAYER_IDS.rex, name: "Rex" },
        { id: PLAYER_IDS.sage, name: "Sage" },
      ]);
      return agent;
    },
  };
  const presentation = await input.scenario.run(runtime);
  const unique = <T>(values: T[]): T[] => [...new Set(values)];
  const turns = presentation.turns.map((turn) => turn.telemetry);
  return {
    scenarioId: input.scenario.pack.scenarioId,
    comparisonKey: input.scenario.pack.comparisonKey,
    sampleOrdinal: input.sampleOrdinal,
    cacheIsolationNonce,
    outcome: outcomeFromTurns(turns),
    accounting: summarizeAccounting(attempts, input.config.modelId),
    requestIds: unique(attempts.flatMap((attempt) => attempt.requestId ? [attempt.requestId] : [])),
    responseIds: unique([
      ...attempts.flatMap((attempt) => {
        const id = responseId(attempt);
        return id ? [id] : [];
      }),
      ...traces.flatMap((trace) => {
        const id = responseIdFromTrace(trace);
        return id ? [id] : [];
      }),
    ]),
    attemptDispositions: attempts.map((attempt) => attempt.disposition),
    turns,
    private: {
      semanticInput: input.scenario.pack.semanticInput,
      traces,
      attempts,
      presentation,
    },
  };
}

async function main(): Promise<void> {
  const options = parseR32ProviderEvaluationArgs();
  const repoRoot = findRepoRoot(import.meta.dir);
  const outputDir = await resolvePrivateOutputDir(repoRoot, options.outputDir);
  const scenarios = createR32ProviderScenarios();
  const selection = resolveModelSelection({
    catalogId: options.catalogId,
    reasoningPolicy: options.reasoningPolicy,
  });
  if (options.catalogId !== DEFAULT_CATALOG_ID) {
    throw new Error(`--catalog-id must be ${DEFAULT_CATALOG_ID} for the frozen R32 comparison.`);
  }
  if (selection.providerProfile.id !== "openai") {
    throw new Error("The frozen R32 comparison requires the hosted OpenAI profile.");
  }
  if (!selection.model.capabilities.supportsStructuredOutput || !selection.model.capabilities.supportsTools) {
    throw new Error("The selected model does not support every frozen R32 surface.");
  }
  const config: ProviderScenarioRunConfig = assertProviderScenarioRunConfig({
    providerProfileId: selection.providerProfile.id,
    catalogId: selection.catalogId,
    modelId: selection.modelId,
    serviceTier: options.serviceTier,
    reasoningPolicy: selection.reasoningPolicy,
    toolChoiceMode: options.toolChoiceMode,
    reasoningSummary: options.reasoningSummary,
    sampleCount: options.sampleCount,
  }, scenarios.map((scenario) => scenario.pack));

  // Everything above this line is credential-free and must fail before spend.
  const clientConfig = createLlmClientFromEnv(process.env, {
    providerProfileId: "openai",
    openAIServiceTier: options.serviceTier,
    maxRetries: 0,
    timeout: 120_000,
  });
  if (!clientConfig) throw new Error("OPENAI_API_KEY is required for the opt-in R32 provider evaluation.");
  if (clientConfig.baseURL) throw new Error("R32 hosted comparison refuses an OpenAI-compatible base URL override.");

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await chmod(outputDir, 0o700);
  const runId = `${options.stage}-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`;
  const targetFileHashes = await hashFiles(repoRoot, TARGET_FILES);
  const harnessFileHashes = await hashFiles(repoRoot, HARNESS_FILES);
  const run: ProviderScenarioPrivateRun = {
    version: 1,
    stage: options.stage,
    runId,
    createdAt: new Date().toISOString(),
    harnessRevision: `files:${createHash("sha256").update(JSON.stringify(harnessFileHashes)).digest("hex")}`,
    targetRevision: `git:${await gitOutput(repoRoot, ["rev-parse", "HEAD"])}`,
    targetFileHashes,
    config,
    packs: scenarios.map((scenario) => scenario.pack),
    samples: [],
  };
  const privatePath = join(outputDir, "private-run.json");
  const manifestPath = join(outputDir, "manifest.json");
  await writePrivateJsonAtomic(privatePath, run);

  for (let sampleOrdinal = 1; sampleOrdinal <= config.sampleCount; sampleOrdinal += 1) {
    for (const scenario of scenarios) {
      process.stderr.write(
        `[r32-provider] stage=${options.stage} sample=${sampleOrdinal}/${config.sampleCount} scenario=${scenario.pack.scenarioId}\n`,
      );
      run.samples.push(await runScenarioSample({
        scenario,
        sampleOrdinal,
        clientConfig,
        config,
      }));
      await writePrivateJsonAtomic(privatePath, run);
      await writePrivateJsonAtomic(manifestPath, createProviderScenarioManifest(run));
    }
  }

  const manifest = createProviderScenarioManifest(run);
  await writePrivateJsonAtomic(manifestPath, manifest);
  process.stdout.write(`${JSON.stringify({
    runId,
    stage: options.stage,
    sampleCount: config.sampleCount,
    scenarios: manifest.packs.map((pack) => pack.scenarioId),
    privateArtifact: relative(repoRoot, privatePath),
    sanitizedManifest: relative(repoRoot, manifestPath),
    attempts: manifest.samples.reduce((total, sample) => total + sample.accounting.attempts, 0),
    actualCostMicrousd: manifest.samples.every((sample) => sample.accounting.actualCostMicrousd !== null)
      ? manifest.samples.reduce((total, sample) => total + (sample.accounting.actualCostMicrousd ?? 0), 0)
      : null,
    estimatedCostMicrousd: manifest.samples.every((sample) => sample.accounting.estimatedCostMicrousd !== null)
      ? manifest.samples.reduce((total, sample) => total + (sample.accounting.estimatedCostMicrousd ?? 0), 0)
      : null,
  }, null, 2)}\n`);
}

if (import.meta.main) await main();
