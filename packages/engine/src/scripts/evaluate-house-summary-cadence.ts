import { createHash, randomUUID } from "node:crypto";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { MockAgent } from "../__tests__/mock-agent";
import type { CanonicalGameEvent } from "../canonical-events";
import { GameRunner } from "../game-runner";
import type {
  HouseGameplaySummaryContext,
  HouseGameplaySummaryResult,
  HouseSelectiveSummaryContext,
  HouseSummaryAttemptResult,
  TranscriptEntry,
} from "../game-runner.types";
import {
  HOUSE_SUMMARY_NEAR_BUDGET_RATIO,
  costHouseProviderUsage,
  costHouseSummaryGame,
  isHouseSummaryCostWithinEnvelope,
} from "../house-summary-accounting";
import {
  createEmptyHouseNarrativeContinuity,
  retainHouseSummaryAtActorCoordinate,
  type HouseFactRow,
  type HouseNarrativeContinuity,
  type HouseSourceCoordinate,
  type HouseSummaryFrontier,
  type HouseSummaryPhaseReceipt,
} from "../house-summary-frontier";
import { LLMHouseInterviewer, TemplateHouseInterviewer } from "../house-interviewer";
import { createLlmClientFromEnv, NO_FLEX_TRANSPORT_RETRY_HEADER } from "../llm-client";
import { normalizeChatCompletion } from "../provider-adapters";
import { TokenTracker } from "../token-tracker";
import type { GameConfig, UUID } from "../types";
import { Phase } from "../types";

const MODEL = "gpt-5.6-luna";
const FIXTURE_SEED = 0x21_50_21;
const FIXTURE_PLAYERS = [
  ["00000000-0000-4000-8000-000000000001", "Ada"],
  ["00000000-0000-4000-8000-000000000002", "Blair"],
  ["00000000-0000-4000-8000-000000000003", "Cleo"],
  ["00000000-0000-4000-8000-000000000004", "Dax"],
  ["00000000-0000-4000-8000-000000000005", "Eve"],
  ["00000000-0000-4000-8000-000000000006", "Finn"],
] as const;

const FIXTURE_CONFIG: GameConfig = {
  timers: { introduction: 0, lobby: 0, mingle: 0, rumor: 0, vote: 0, power: 0, council: 0 },
  maxRounds: 3,
  minPlayers: 6,
  maxPlayers: 12,
  formatManifest: ["vote_bomb", "save_or_eliminate"],
};

interface CandidateAttempt {
  context: HouseSelectiveSummaryContext;
  result: HouseSummaryAttemptResult;
}

type HouseSummaryDelegate = Pick<TemplateHouseInterviewer, "generateHouseSummary">;

export interface PhaseEvaluation extends CandidateAttempt {
  receipt: HouseSummaryPhaseReceipt | null;
  priorNarrativeSeeded: boolean;
  selectedSourcesSupported: boolean;
  unsupportedSourceAliases: string[];
  freshBoundarySupport: boolean;
  canonicalSupportSatisfied: boolean;
  phaseSpecific: boolean;
  specific: boolean;
}

export interface QualitySignals {
  unsupportedAliasesDetected: boolean;
  canonicalContradictionsDetected: boolean | null;
  continuityBreaksDetected: boolean;
  repetitiveOrLowValueOrdinaryBeatsDetected: boolean | null;
  milestoneRegressionDetected: boolean | null;
  pacingHarmDetected: boolean | null;
  qualityReviewed: boolean;
  reviewer: string | null;
  reviewedAt: string | null;
}

interface ReviewableReport {
  scope: string;
  verdict: {
    automaticFullGatePassed: boolean;
    fullGatePassed: boolean;
    qualitySignals: QualitySignals;
  };
}

class NarrationFreeBaselineHouse extends TemplateHouseInterviewer {
  readonly baselineContexts: HouseGameplaySummaryContext[] = [];

  override async generateHouseSummary(
    context: HouseSelectiveSummaryContext,
  ): Promise<HouseSummaryAttemptResult> {
    return {
      status: "model_skipped",
      reason: "baseline_fixture_suppresses_selective_narration",
      boundary: context.frontier.boundary,
      providerCalls: 0,
      factCalls: 0,
      requestedCategories: [],
      returnedBytes: 0,
      usage: [],
    };
  }

  override async generateLongFormGameplaySummary(
    context: HouseGameplaySummaryContext,
  ): Promise<HouseGameplaySummaryResult> {
    this.baselineContexts.push(structuredClone(context));
    return super.generateLongFormGameplaySummary(context);
  }
}

class RuntimeCandidateHouse extends TemplateHouseInterviewer {
  readonly attempts: CandidateAttempt[] = [];

  constructor(private readonly delegate: HouseSummaryDelegate) {
    super();
  }

  override async generateHouseSummary(
    context: HouseSelectiveSummaryContext,
  ): Promise<HouseSummaryAttemptResult> {
    const capturedContext = structuredClone(context);
    let result: HouseSummaryAttemptResult;
    try {
      result = await this.delegate.generateHouseSummary(context);
    } catch {
      result = {
        status: "failed",
        reason: "house_interviewer_threw",
        boundary: context.frontier.boundary,
        providerCalls: 0,
        factCalls: 0,
        requestedCategories: [],
        returnedBytes: 0,
        usage: [],
      };
    }
    this.attempts.push({ context: capturedContext, result: structuredClone(result) });
    return result;
  }
}

function reconcileCandidateAttempt(
  attempt: CandidateAttempt,
  receipt: HouseSummaryPhaseReceipt | undefined,
): CandidateAttempt {
  if (!receipt || receipt.status === attempt.result.status) return attempt;
  return {
    context: attempt.context,
    result: {
      status: "failed",
      reason: `runtime_publication_${receipt.status}`,
      boundary: attempt.context.frontier.boundary,
      providerCalls: receipt.providerCalls,
      factCalls: receipt.factCalls,
      requestedCategories: [...receipt.requestedCategories],
      returnedBytes: receipt.returnedBytes,
      usage: receipt.usage.map((entry) => ({ ...entry })),
    },
  };
}

function fixedAgents(): MockAgent[] {
  return FIXTURE_PLAYERS.map(([id, name]) => new MockAgent(id, name));
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

async function withDeterministicMathRandom<T>(run: () => Promise<T>): Promise<T> {
  const originalRandom = Math.random;
  Math.random = seededRandom(FIXTURE_SEED);
  try {
    return await run();
  } finally {
    Math.random = originalRandom;
  }
}

function authorityFingerprint(events: readonly CanonicalGameEvent[]): string {
  const authoritative = events.map((event) => ({
    sequence: event.sequence,
    gameId: event.gameId,
    round: event.round,
    phase: event.phase,
    type: event.type,
    source: event.source,
    visibility: event.visibility,
    payloadVersion: event.payloadVersion,
    sourcePointers: event.sourcePointers,
    payload: event.payload,
  }));
  return createHash("sha256").update(JSON.stringify(authoritative)).digest("hex");
}

function assertNarrationFreeBaseline(contexts: readonly HouseGameplaySummaryContext[]): void {
  const summaryEntries = contexts.flatMap((context) => context.evidence.recentTranscript)
    .filter((entry) => entry.dialogueKind === "house_summary");
  if (summaryEntries.length > 0) {
    throw new Error("Baseline fixture was contaminated by selective House narration.");
  }
}

export function createEvaluationFixtureGameId(): UUID {
  return randomUUID();
}

export async function captureBaselineFixture(gameId: UUID): Promise<{
  contexts: HouseGameplaySummaryContext[];
  authorityFingerprint: string;
}> {
  const house = new NarrationFreeBaselineHouse();
  const runner = new GameRunner(
    fixedAgents(),
    {
      ...FIXTURE_CONFIG,
      enableHouseStrategyBible: true,
      enableHouseLongFormSummaries: true,
    },
    house,
    { gameId, random: seededRandom(FIXTURE_SEED) },
  );
  await withDeterministicMathRandom(() => runner.run());
  if (house.baselineContexts.length === 0) {
    throw new Error("Representative game did not capture round-only baseline contexts.");
  }
  assertNarrationFreeBaseline(house.baselineContexts);
  return {
    contexts: house.baselineContexts,
    authorityFingerprint: authorityFingerprint(runner.getCanonicalEvents()),
  };
}

export async function runCandidateFixture(gameId: UUID, delegate: HouseSummaryDelegate): Promise<{
  attempts: CandidateAttempt[];
  receipts: HouseSummaryPhaseReceipt[];
  authorityFingerprint: string;
}> {
  const house = new RuntimeCandidateHouse(delegate);
  const runner = new GameRunner(
    fixedAgents(),
    FIXTURE_CONFIG,
    house,
    { gameId, random: seededRandom(FIXTURE_SEED) },
  );
  await withDeterministicMathRandom(() => runner.run());
  const receipts = [...runner.houseSummaryPhaseReceipts];
  return {
    attempts: house.attempts.map((attempt) => reconcileCandidateAttempt(
      attempt,
      receipts.find((receipt) => receipt.boundaryId === attempt.context.frontier.boundary.id),
    )),
    receipts,
    authorityFingerprint: authorityFingerprint(runner.getCanonicalEvents()),
  };
}

function source(
  sequence: number,
  type: "format.selected" | "format.resolved",
  phase: Phase.FORMAT_PICK | Phase.FORMAT_RESOLVE,
): HouseSourceCoordinate {
  return { kind: "canonical_event", sequence, type, round: 1, phase };
}

function formatPickContext(
  continuity: HouseNarrativeContinuity,
  gameId: UUID,
): HouseSelectiveSummaryContext {
  const selectedSource = source(8, "format.selected", Phase.FORMAT_PICK);
  const dialogueSource: HouseSourceCoordinate = {
    kind: "transcript_entry",
    sequence: 12,
    round: 1,
    phase: Phase.FORMAT_PICK,
    dialogueKind: "public",
  };
  const frontier: HouseSummaryFrontier = {
    version: 1,
    boundary: {
      version: 1,
      id: "1:format_pick:8:12",
      gameId,
      actorCoordinate: "format_pick",
      round: 1,
      phase: Phase.FORMAT_PICK,
      beatClass: "ordinary",
      canonicalHead: 8,
      dialogueHead: 12,
    },
    material: true,
    catalog: [
      {
        alias: "S1",
        category: "canonical_phase_facts",
        authority: "canonical_event",
        label: "format.selected",
        data: { empowered: "Ada", selectedFormat: "Vote Bomb" },
        source: selectedSource,
      },
      {
        alias: "S2",
        category: "audience_dialogue_quotes",
        authority: "dialogue_non_authoritative",
        label: "Ada spoke publicly",
        source: dialogueSource,
      },
    ],
    categoryCounts: {
      canonical_phase_facts: 1,
      player_projection_facts: 0,
      audience_dialogue_quotes: 1,
    },
    factStore: {
      canonical_phase_facts: [{
        alias: "S1",
        category: "canonical_phase_facts",
        authority: "canonical_event",
        label: "format.selected",
        data: { empowered: "Ada", selectedFormat: "Vote Bomb" },
        source: selectedSource,
      }],
      player_projection_facts: [],
      audience_dialogue_quotes: [{
        alias: "S2",
        category: "audience_dialogue_quotes",
        authority: "dialogue_non_authoritative",
        label: "Ada spoke publicly",
        data: { speaker: "Ada", quote: "I promised Blair safety, and Vote Bomb gives me room to prove it." },
        source: dialogueSource,
      }],
    },
  };
  return { frontier, continuity, factReadAllowed: false };
}

function formatResolveContext(
  continuity: HouseNarrativeContinuity,
  gameId: UUID,
): HouseSelectiveSummaryContext {
  const resolvedSource = source(11, "format.resolved", Phase.FORMAT_RESOLVE);
  const frontier: HouseSummaryFrontier = {
    version: 1,
    boundary: {
      version: 1,
      id: "1:format_resolve:11:13",
      gameId,
      actorCoordinate: "format_resolve",
      round: 1,
      phase: Phase.FORMAT_RESOLVE,
      beatClass: "milestone",
      canonicalHead: 11,
      dialogueHead: 13,
    },
    material: true,
    catalog: [{
      alias: "S1",
      category: "canonical_phase_facts",
      authority: "canonical_event",
      label: "format.resolved",
      data: {
        selectedFormat: "Vote Bomb",
        empowered: "Ada",
        eliminated: "Blair",
        resolutionKind: "sealed_ballot",
        tied: [],
        tiebreaker: null,
      },
      source: resolvedSource,
    }],
    categoryCounts: {
      canonical_phase_facts: 1,
      player_projection_facts: 0,
      audience_dialogue_quotes: 0,
    },
    factStore: {
      canonical_phase_facts: [{
        alias: "S1",
        category: "canonical_phase_facts",
        authority: "canonical_event",
        label: "format.resolved",
        data: {
          selectedFormat: "Vote Bomb",
          empowered: "Ada",
          eliminated: "Blair",
          resolutionKind: "sealed_ballot",
          tied: [],
          tiebreaker: null,
        },
        source: resolvedSource,
      }],
      player_projection_facts: [],
      audience_dialogue_quotes: [],
    },
  };
  return { frontier, continuity, factReadAllowed: true };
}

function advanceContinuity(
  previous: HouseNarrativeContinuity,
  result: HouseSummaryAttemptResult,
): HouseNarrativeContinuity {
  if (result.status !== "emitted") return previous;
  return {
    version: 1,
    lastBoundaryId: result.boundary.id,
    lastSummary: result.summary,
    lastSummaryByActorCoordinate: retainHouseSummaryAtActorCoordinate(
      previous.lastSummaryByActorCoordinate,
      result.boundary.actorCoordinate,
      result.summary,
    ),
    openQuestions: result.openQuestions,
    threadIds: result.threadIds,
    supportingSources: result.sources,
    examinedCanonicalHead: result.boundary.canonicalHead,
    examinedDialogueHead: result.boundary.dialogueHead,
    emittedCanonicalHead: result.boundary.canonicalHead,
    emittedDialogueHead: result.boundary.dialogueHead,
    pendingDeltaCarry: 0,
  };
}

function parseBaselineSummary(response: ChatCompletion): string {
  const content = response.choices[0]?.message?.content?.trim() ?? "";
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.summary === "string" && parsed.summary.trim()) return parsed.summary.trim();
  } catch {
    // Preserve the raw response when a provider violates the requested schema.
  }
  return content;
}

function priorBaselineEntry(summary: string, context: HouseGameplaySummaryContext): TranscriptEntry {
  return {
    round: context.round,
    phase: context.phase,
    timestamp: 0,
    from: "House",
    scope: "system",
    text: summary,
    speakerPlayerId: null,
    dialogueKind: "house_summary",
    audiencePlayerIds: [],
    dialogueContext: { version: 1 },
  };
}

function baselinePromptContext(
  captured: HouseGameplaySummaryContext,
  priorSummaries: ReadonlyArray<{ summary: string; context: HouseGameplaySummaryContext }>,
): HouseGameplaySummaryContext {
  const context = structuredClone(captured);
  context.evidence.recentTranscript.push(...priorSummaries.map(({ summary, context: priorContext }) => (
    priorBaselineEntry(summary, priorContext)
  )));
  return context;
}

function allFacts(frontier: HouseSummaryFrontier): HouseFactRow[] {
  return Object.values(frontier.factStore).flat();
}

function sourceKey(sourceCoordinate: HouseSourceCoordinate): string {
  switch (sourceCoordinate.kind) {
    case "canonical_event":
      return `event:${sourceCoordinate.sequence}:${sourceCoordinate.type}`;
    case "canonical_projection":
      return `projection:${sourceCoordinate.headSequence}:${sourceCoordinate.projection}`;
    case "transcript_entry":
      return `transcript:${sourceCoordinate.sequence}:${sourceCoordinate.dialogueKind}`;
  }
}

function sourceIsFresh(
  sourceCoordinate: HouseSourceCoordinate,
  continuity: HouseNarrativeContinuity,
): boolean {
  if (sourceCoordinate.kind === "canonical_event") {
    return sourceCoordinate.sequence > continuity.emittedCanonicalHead;
  }
  if (sourceCoordinate.kind === "canonical_projection") {
    return sourceCoordinate.headSequence > continuity.emittedCanonicalHead;
  }
  return sourceCoordinate.sequence > continuity.emittedDialogueHead;
}

function normalizedWordSequence(value: string): string[] {
  return value.replaceAll("_", " ").toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function phraseStarts(words: readonly string[], phrase: readonly string[]): number[] {
  if (phrase.length === 0 || phrase.length > words.length) return [];
  const starts: number[] = [];
  for (let index = 0; index <= words.length - phrase.length; index += 1) {
    if (phrase.every((word, offset) => words[index + offset] === word)) starts.push(index);
  }
  return starts;
}

const CLAIM_NEGATIONS = new Set(["avoid", "avoided", "deny", "denied", "didnt", "never", "no", "not", "refuse", "refused", "reject", "rejected", "without"]);

function containsPositivePhrase(words: readonly string[], value: unknown): boolean {
  if (typeof value !== "string") return false;
  const phrase = normalizedWordSequence(value);
  return phraseStarts(words, phrase).some((start) => {
    const nearby = words.slice(Math.max(0, start - 3), start + phrase.length + 3);
    return !nearby.some((word) => CLAIM_NEGATIONS.has(word));
  });
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  return typeof data[key] === "string" && data[key].trim() ? data[key].trim() : null;
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringValues);
  return [];
}

function containsAnyPositivePhrase(words: readonly string[], values: readonly unknown[]): boolean {
  return values.some((value) => containsPositivePhrase(words, value));
}

function containsAnyWord(words: readonly string[], values: readonly string[]): boolean {
  const vocabulary = new Set(words);
  return values.some((value) => vocabulary.has(value));
}

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
] as const;

function containsAliveCountClaim(words: readonly string[], aliveCount: number): boolean {
  const countClaims = [String(aliveCount), COUNT_WORDS[aliveCount]].filter(
    (value): value is string => typeof value === "string",
  );
  return countClaims.some((countClaim) => words.some((word, index) => {
    if (word !== countClaim) return false;
    const nearby = words.slice(Math.max(0, index - 4), index + 6);
    return containsAnyWord(nearby, ["player", "players", "contestant", "contestants", "houseguest", "houseguests", "finalist", "finalists"])
      && (
        containsAnyWord(nearby, ["alive", "left", "remain", "remains", "remaining", "stand", "standing"])
        || (nearby.includes("still") && nearby.includes("in"))
      );
  }));
}

function factClaimSupported(fact: HouseFactRow, summaryWords: readonly string[]): boolean {
  const data = fact.data;
  const value = (key: string): string | null => stringField(data, key);
  const anyValue = (key: string): boolean => containsAnyPositivePhrase(summaryWords, stringValues(data[key]));
  const semantic = (...words: string[]): boolean => containsAnyWord(summaryWords, words);

  if (fact.category === "audience_dialogue_quotes") {
    const quoteKeywords = normalizedWordSequence(value("quote") ?? "")
      .filter((word) => word.length >= 5 && !["about", "after", "before", "could", "every", "house", "their", "there", "these", "those", "would"].includes(word));
    return containsPositivePhrase(summaryWords, value("speaker"))
      && quoteKeywords.some((word) => summaryWords.includes(word));
  }

  if (fact.category === "player_projection_facts") {
    if (fact.label === "Current public room allocation") {
      return semantic("room", "rooms", "mingle", "allocation")
        && containsAnyPositivePhrase(summaryWords, stringValues(data.rooms));
    }
    if (fact.label === "Audience-safe alliance projection") {
      return semantic("alliance", "alliances", "bloc", "coalition", "pact")
        && containsAnyPositivePhrase(summaryWords, stringValues(data.alliances));
    }
    const aliveCount = Array.isArray(data.alive) ? data.alive.length : 0;
    const countedRosterClaim = aliveCount > 0 && containsAliveCountClaim(summaryWords, aliveCount);
    const namedBoardClaim = semantic("alive", "eliminated", "empowered", "format", "candidate", "candidates", "endgame", "finalists")
      && containsAnyPositivePhrase(summaryWords, [
        ...stringValues(data.eliminated),
        ...stringValues(data.empowered),
        ...stringValues(data.selectedFormat),
        ...stringValues(data.councilCandidates),
        ...stringValues(data.endgameStage),
        ...stringValues(data.alive),
      ]);
    return countedRosterClaim || namedBoardClaim;
  }

  switch (fact.label) {
    case "game.roster_initialized":
      return semantic("roster", "players", "contestants", "houseguests", "field");
    case "round.started":
      return semantic("round")
        && containsAnyPositivePhrase(summaryWords, [String(data.round)])
        && semantic("start", "started", "starts", "begin", "begins", "began", "open", "opens", "opened");
    case "shields.expired":
      return anyValue("players") && semantic("shield", "shields", "protection", "safety", "expired", "exposed");
    case "vote.empower_tally_resolved":
    case "vote.empowered_set":
      return containsPositivePhrase(summaryWords, value("empowered"))
        && semantic("empowered", "power", "control", "leverage", "vote", "tally");
    case "format.menu_offered":
      return anyValue("offeredFormats") && semantic("format", "formats", "choice", "choices", "menu", "options");
    case "format.selected":
      return containsPositivePhrase(summaryWords, value("selectedFormat"))
        && semantic("select", "selected", "selecting", "choose", "chooses", "choosing", "chose", "choice", "lock", "locks", "locked", "locking", "pick", "picks", "picked", "picking", "opted");
    case "format.resolved":
      return containsPositivePhrase(summaryWords, value("selectedFormat"))
        && containsPositivePhrase(summaryWords, value("eliminated"))
        && semantic("out", "eliminated", "exit", "exits", "left", "leaves", "resolved", "falls", "fell");
    case "power.action_set":
      return containsPositivePhrase(summaryWords, value("action"))
        && (value("target") === null || containsPositivePhrase(summaryWords, value("target")));
    case "power.candidates_resolved":
      return containsAnyPositivePhrase(summaryWords, [
        ...stringValues(data.candidates),
        ...stringValues(data.autoEliminated),
        ...stringValues(data.shieldGranted),
      ]) && semantic("candidate", "candidates", "danger", "block", "shield", "safe", "out", "eliminated");
    case "council.elimination_resolved":
      return containsPositivePhrase(summaryWords, value("eliminated"))
        && semantic("council", "vote", "voted", "out", "eliminated", "exit", "left");
    case "player.eliminated":
      return containsPositivePhrase(summaryWords, value("player"))
        && semantic("out", "eliminated", "exit", "exits", "left", "leaves", "gone");
    case "endgame.stage_set":
      return containsPositivePhrase(summaryWords, value("stage"))
        && semantic("endgame", "final", "finale", "reckoning", "tribunal", "judgment", "jury", "stage");
    case "endgame.elimination_resolved":
      return containsPositivePhrase(summaryWords, value("eliminated"))
        && semantic("out", "eliminated", "exit", "exits", "left", "leaves", "falls", "fell");
    case "jury.winner_determined":
      return containsPositivePhrase(summaryWords, value("winner"))
        && semantic("win", "wins", "winner", "won", "crowned", "champion");
    case "round.result_recorded":
      return containsPositivePhrase(summaryWords, value("eliminated"))
        && semantic("round", "out", "eliminated", "exit", "left");
    default:
      return false;
  }
}

const FINALIST_CLOSING_THEME_WORDS = [
  ["strategic", "strategy", "moves", "play"],
  ["honest", "honesty", "integrity", "truth"],
  ["alliance", "alliances", "people", "relationship", "relationships", "social", "trust"],
  ["appeal", "case", "closing", "pitch", "jury", "vote"],
] as const;

function finalistClosingGroupClaimSupported(
  selectedFacts: readonly HouseFactRow[],
  summaryWords: readonly string[],
  actorCoordinate: HouseSummaryFrontier["boundary"]["actorCoordinate"],
): boolean {
  if (actorCoordinate !== "judgment_closing") return false;
  const dialogueFacts = selectedFacts.filter((fact) => fact.category === "audience_dialogue_quotes");
  const speakers = new Set(dialogueFacts.flatMap((fact) => stringValues(fact.data.speaker)));
  if (dialogueFacts.length < 2 || speakers.size < 2) return false;
  const collectiveFinalists = phraseStarts(summaryWords, ["both", "finalists"]).length > 0
    || phraseStarts(summaryWords, ["two", "finalists"]).length > 0;
  if (!collectiveFinalists) return false;

  const supportedThemes = FINALIST_CLOSING_THEME_WORDS.filter((theme) => dialogueFacts.every((fact) => {
    const quoteWords = normalizedWordSequence(stringField(fact.data, "quote") ?? "");
    return containsAnyWord(quoteWords, theme);
  }));
  return supportedThemes.filter((theme) => containsAnyWord(summaryWords, theme)).length >= 2;
}

export function evaluatePhase(attempt: CandidateAttempt, receipt: HouseSummaryPhaseReceipt | null): PhaseEvaluation {
  const { context, result } = attempt;
  if (result.status !== "emitted") {
    return {
      ...attempt,
      receipt,
      priorNarrativeSeeded: context.continuity.lastSummary !== null,
      selectedSourcesSupported: false,
      unsupportedSourceAliases: [],
      freshBoundarySupport: false,
      canonicalSupportSatisfied: false,
      phaseSpecific: false,
      specific: false,
    };
  }

  const facts = allFacts(context.frontier);
  const factByAlias = new Map(facts.map((fact) => [fact.alias, fact]));
  const frontierSources = new Set(facts.map((fact) => sourceKey(fact.source)));
  const unsupportedSourceAliases = result.sourceAliases.filter((alias) => !factByAlias.has(alias));
  const selectedFacts = result.sourceAliases.flatMap((alias) => {
    const fact = factByAlias.get(alias);
    return fact ? [fact] : [];
  });
  const selectedSourcesSupported = unsupportedSourceAliases.length === 0
    && result.sources.length === result.sourceAliases.length
    && result.sources.every((coordinate) => frontierSources.has(sourceKey(coordinate)));
  const freshBoundarySupport = result.sources.length > 0
    && result.sources.every((coordinate) => sourceIsFresh(coordinate, context.continuity));
  const canonicalFactsAvailable = facts.some((fact) => fact.authority !== "dialogue_non_authoritative");
  const canonicalSupportSatisfied = !canonicalFactsAvailable
    || selectedFacts.some((fact) => fact.authority !== "dialogue_non_authoritative");
  const summaryWords = normalizedWordSequence(result.summary);
  const phaseSpecific = selectedFacts.some((fact) => factClaimSupported(fact, summaryWords))
    || finalistClosingGroupClaimSupported(
      selectedFacts,
      summaryWords,
      context.frontier.boundary.actorCoordinate,
    );

  return {
    ...attempt,
    receipt,
    priorNarrativeSeeded: context.continuity.lastSummary !== null,
    selectedSourcesSupported,
    unsupportedSourceAliases,
    freshBoundarySupport,
    canonicalSupportSatisfied,
    phaseSpecific,
    specific: selectedSourcesSupported
      && freshBoundarySupport
      && canonicalSupportSatisfied
      && phaseSpecific,
  };
}

function normalizedWords(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  const intersection = [...left].filter((word) => right.has(word)).length;
  return intersection / (left.size + right.size - intersection);
}

export interface RepetitionSummaryCoordinate {
  actorCoordinate: HouseSummaryFrontier["boundary"]["actorCoordinate"];
  boundaryId: string;
  round: number;
  summary: string;
}

export interface MaxJaccardPairEvidence {
  score: number;
  left: RepetitionSummaryCoordinate;
  right: RepetitionSummaryCoordinate;
}

export function maximumSummaryJaccardPair(
  summaries: readonly RepetitionSummaryCoordinate[],
): MaxJaccardPairEvidence | null {
  let maximum: MaxJaccardPairEvidence | null = null;
  for (let left = 0; left < summaries.length; left += 1) {
    for (let right = left + 1; right < summaries.length; right += 1) {
      const leftSummary = summaries[left]!;
      const rightSummary = summaries[right]!;
      const score = jaccard(normalizedWords(leftSummary.summary), normalizedWords(rightSummary.summary));
      if (maximum === null || score > maximum.score) {
        maximum = { score, left: leftSummary, right: rightSummary };
      }
    }
  }
  return maximum;
}

export function repetitionEvidence(phases: readonly PhaseEvaluation[]): {
  publicSummariesUnique: boolean;
  maxPairwiseWordJaccard: number;
  maxPairwiseWordJaccardPair: MaxJaccardPairEvidence | null;
  automaticRepetitionDetected: boolean;
} {
  const summaries = phases.flatMap((phase): RepetitionSummaryCoordinate[] => phase.result.status === "emitted"
    ? [{
        actorCoordinate: phase.context.frontier.boundary.actorCoordinate,
        boundaryId: phase.context.frontier.boundary.id,
        round: phase.context.frontier.boundary.round,
        summary: phase.result.summary,
      }]
    : []);
  const normalized = summaries.map(({ summary }) => summary.toLowerCase().replace(/\s+/g, " ").trim());
  const maxPairwiseWordJaccardPair = maximumSummaryJaccardPair(summaries);
  const maxPairwiseWordJaccard = maxPairwiseWordJaccardPair?.score ?? 0;
  const publicSummariesUnique = new Set(normalized).size === normalized.length;
  return {
    publicSummariesUnique,
    maxPairwiseWordJaccard,
    maxPairwiseWordJaccardPair,
    automaticRepetitionDetected: !publicSummariesUnique || maxPairwiseWordJaccard >= 0.82,
  };
}

export function continuityEvidence(phases: readonly PhaseEvaluation[]): {
  continuityOpportunities: number;
  continuityCovered: number;
  continuityCoverageRate: number;
  continuityBreaksDetected: boolean;
} {
  let latestEmittedSummary: string | null = null;
  let continuityOpportunities = 0;
  let continuityCovered = 0;
  let continuityBreaksDetected = false;
  for (const phase of phases) {
    if (latestEmittedSummary !== null) {
      continuityOpportunities += 1;
      if (phase.context.continuity.lastSummary === latestEmittedSummary) continuityCovered += 1;
      else continuityBreaksDetected = true;
    } else if (phase.context.continuity.lastSummary !== null) {
      continuityBreaksDetected = true;
    }
    if (phase.result.status === "emitted") latestEmittedSummary = phase.result.summary;
  }
  return {
    continuityOpportunities,
    continuityCovered,
    continuityCoverageRate: continuityOpportunities === 0 ? 1 : continuityCovered / continuityOpportunities,
    continuityBreaksDetected,
  };
}

export function reviewedQualitySignalsPass(signals: QualitySignals): boolean {
  return signals.qualityReviewed
    && !signals.unsupportedAliasesDetected
    && signals.canonicalContradictionsDetected === false
    && !signals.continuityBreaksDetected
    && signals.repetitiveOrLowValueOrdinaryBeatsDetected === false
    && signals.milestoneRegressionDetected === false
    && signals.pacingHarmDetected === false;
}

function isReviewableReport(value: unknown): value is ReviewableReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  if (report.scope !== "full_cadence") return false;
  if (!report.verdict || typeof report.verdict !== "object" || Array.isArray(report.verdict)) return false;
  const verdict = report.verdict as Record<string, unknown>;
  return typeof verdict.automaticFullGatePassed === "boolean"
    && typeof verdict.fullGatePassed === "boolean"
    && Boolean(verdict.qualitySignals)
    && typeof verdict.qualitySignals === "object"
    && !Array.isArray(verdict.qualitySignals);
}

async function writeReport(
  report: unknown,
  outputPath: string | null,
  emitStdout = true,
): Promise<void> {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await Bun.write(outputPath, serialized);
  if (emitStdout) process.stdout.write(serialized);
}

const MANUAL_QUALITY_SIGNAL_KEYS = [
  "canonicalContradictionsDetected",
  "repetitiveOrLowValueOrdinaryBeatsDetected",
  "milestoneRegressionDetected",
  "pacingHarmDetected",
] as const satisfies ReadonlyArray<keyof QualitySignals>;

function hasExplicitManualQualitySignals(signals: QualitySignals): boolean {
  return MANUAL_QUALITY_SIGNAL_KEYS.every((key) => typeof signals[key] === "boolean");
}

export async function attestSavedReport(
  inputPath: string,
  outputPath: string | null,
  options: {
    qualityReviewed: boolean;
    reviewer: string | null;
    reviewedAt?: string;
    emitStdout?: boolean;
  },
): Promise<boolean> {
  if (!options.qualityReviewed || !options.reviewer) {
    throw new Error("Offline review requires --quality-reviewed and --reviewer=<local reviewer id>.");
  }
  const parsed: unknown = JSON.parse(await Bun.file(inputPath).text());
  if (!isReviewableReport(parsed)) throw new Error("Saved report is not a reviewable full-cadence evaluation.");
  const signals = parsed.verdict.qualitySignals;
  if (!hasExplicitManualQualitySignals(signals)) {
    throw new Error(
      "Offline review must explicitly set every manual quality signal to true or false in the saved report; pending values cannot be attested.",
    );
  }
  signals.qualityReviewed = true;
  signals.reviewer = options.reviewer;
  signals.reviewedAt = options.reviewedAt ?? new Date().toISOString();
  parsed.verdict.fullGatePassed = parsed.verdict.automaticFullGatePassed
    && reviewedQualitySignalsPass(signals);
  await writeReport(parsed, outputPath, options.emitStdout ?? true);
  return parsed.verdict.fullGatePassed;
}

export function buildRoundOnlyBaselineRequest(prompt: string): ChatCompletionCreateParamsNonStreaming {
  return {
    model: MODEL,
    messages: [
      {
        role: "system",
        content: "You are the House MC — omniscient, dramatic reality TV narrator. Return JSON only.",
      },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "house_mc_summary",
        schema: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
    max_completion_tokens: 5_600,
    reasoning_effort: "low",
  };
}

async function generateBaselineResponse(
  llmConfig: NonNullable<ReturnType<typeof createLlmClientFromEnv>>,
  prompt: string,
): Promise<ChatCompletion> {
  return llmConfig.client.chat.completions.create(buildRoundOnlyBaselineRequest(prompt), {
    maxRetries: 0,
    signal: AbortSignal.timeout(90_000),
    headers: { [NO_FLEX_TRANSPORT_RETRY_HEADER]: "1" },
  });
}

async function main(): Promise<void> {
  const outputPath = process.argv.find((arg) => arg.startsWith("--output="))?.split("=")[1] ?? null;
  const reviewReportPath = process.argv.find((arg) => arg.startsWith("--review-report="))?.split("=")[1] ?? null;
  const reviewer = process.argv.find((arg) => arg.startsWith("--reviewer="))?.split("=")[1] ?? null;
  if (reviewReportPath) {
    const passed = await attestSavedReport(reviewReportPath, outputPath, {
      qualityReviewed: process.argv.includes("--quality-reviewed"),
      reviewer,
    });
    if (!passed) process.exitCode = 1;
    return;
  }

  const scopeArg = process.argv.find((arg) => arg.startsWith("--scope="))?.split("=")[1] ?? "slice";
  if (scopeArg !== "slice" && scopeArg !== "full") throw new Error("--scope must be slice or full.");
  if (process.argv.includes("--quality-reviewed")) {
    throw new Error("Review saved output offline with --review-report before supplying --quality-reviewed.");
  }
  const candidateOnly = process.argv.includes("--candidate-only");

  const llmConfig = createLlmClientFromEnv(process.env, {
    providerProfileId: "openai",
    maxRetries: 0,
    timeout: 90_000,
  });
  if (!llmConfig || llmConfig.providerProfileId !== "openai") {
    throw new Error("Hosted OpenAI configuration is required.");
  }

  const llmHouse = new LLMHouseInterviewer(llmConfig.client, MODEL, {
    providerProfileId: "openai",
    reasoningPolicy: "low",
    toolChoiceMode: llmConfig.toolChoiceMode,
  });
  llmHouse.setTokenTracker(new TokenTracker());

  const fixtureGameId = createEvaluationFixtureGameId();
  const baselineFixture = scopeArg === "full" ? await captureBaselineFixture(fixtureGameId) : null;
  const baselinePrompts: string[] = [];
  const baselineResponses: ChatCompletion[] = [];
  const priorBaselineSummaries: Array<{ summary: string; context: HouseGameplaySummaryContext }> = [];
  if (!candidateOnly) {
    if (baselineFixture) {
      for (const capturedContext of baselineFixture.contexts) {
        const promptContext = baselinePromptContext(capturedContext, priorBaselineSummaries);
        const prompt = llmHouse.renderGameplaySummaryPrompt(
          promptContext,
          "Generate a concise, watchable 3-5 sentence House MC summary for the audience.",
        );
        baselinePrompts.push(prompt);
        const response = await generateBaselineResponse(llmConfig, prompt);
        baselineResponses.push(response);
        priorBaselineSummaries.push({ summary: parseBaselineSummary(response), context: capturedContext });
      }
    } else {
      const prompt = JSON.stringify({
        accumulatedTranscript: [
          "Ada promised Blair safety before the format menu.",
          "Blair said loyalty would be measured by the final ballot.",
        ],
        publicMessages: Array.from({ length: 18 }, (_, index) => ({
          from: ["Ada", "Blair", "Cleo", "Dax"][index % 4],
          text: `Round-one public exchange ${index + 1} about safety, leverage, and Vote Bomb.`,
        })),
        diaryEntries: [
          { player: "Ada", text: "I may need to break the promise if Blair controls the middle." },
          { player: "Blair", text: "Ada's promise is the only public protection I have." },
        ],
        roomAllocations: [{ room: "Kitchen", players: ["Ada", "Blair"] }],
        strategyPacket: {
          tensions: ["Ada's public promise conflicts with her private threat read."],
          openQuestions: ["Will Blair treat format selection as proof of loyalty?"],
        },
        roundFacts: {
          empowered: "Ada",
          selectedFormat: "Vote Bomb",
          eliminated: "Blair",
          resolutionKind: "sealed_ballot",
        },
      });
      baselinePrompts.push(prompt);
      baselineResponses.push(await generateBaselineResponse(llmConfig, prompt));
    }
  }

  const baselineUsage = baselineResponses.map((response) => (
    LLMHouseInterviewer.providerUsage(
      normalizeChatCompletion(response, "openai.chat_completions"),
      randomUUID(),
    )
  ));
  const attempts: CandidateAttempt[] = [];
  let candidateReceipts: HouseSummaryPhaseReceipt[] = [];
  let candidateAuthorityFingerprint: string | null = null;
  if (scopeArg === "full") {
    const candidateFixture = await runCandidateFixture(fixtureGameId, llmHouse);
    attempts.push(...candidateFixture.attempts);
    candidateReceipts = candidateFixture.receipts;
    candidateAuthorityFingerprint = candidateFixture.authorityFingerprint;
  } else {
    let continuity = createEmptyHouseNarrativeContinuity();
    for (const buildContext of [formatPickContext, formatResolveContext]) {
      const context = buildContext(continuity, fixtureGameId);
      const result = await llmHouse.generateHouseSummary(context);
      attempts.push({ context, result });
      continuity = advanceContinuity(continuity, result);
    }
  }

  const phaseResults = attempts.map((attempt) => evaluatePhase(
    attempt,
    candidateReceipts.find((receipt) => receipt.boundaryId === attempt.result.boundary.id) ?? null,
  ));
  const candidateUsage = phaseResults.flatMap((phase) => phase.result.usage);
  const baselineCost = baselineResponses.length > 0
    ? costHouseProviderUsage(baselineUsage, MODEL, baselineResponses.length)
    : null;
  const candidateProviderCalls = phaseResults.reduce((sum, phase) => sum + phase.result.providerCalls, 0);
  const candidateGameCost = scopeArg === "full"
    ? costHouseSummaryGame(candidateReceipts, MODEL)
    : null;
  const candidateCost = candidateGameCost?.accounting
    ?? costHouseProviderUsage(candidateUsage, MODEL, candidateProviderCalls);
  const candidateBoundaryCostById = new Map(
    candidateGameCost?.boundaries.map((boundary) => [boundary.boundaryId, boundary.accounting] as const) ?? [],
  );
  const candidatePhaseAccounting = (phase: PhaseEvaluation) => {
    if (scopeArg !== "full") {
      return costHouseProviderUsage(
        phase.result.usage,
        MODEL,
        phase.result.providerCalls,
      );
    }
    const accounting = candidateBoundaryCostById.get(phase.result.boundary.id);
    if (!accounting) throw new Error(`Missing candidate receipt accounting for ${phase.result.boundary.id}.`);
    return accounting;
  };
  const ratio = baselineCost?.status === "exact" && candidateCost.status === "exact" && baselineCost.totalCostUsd > 0
    ? candidateCost.totalCostUsd / baselineCost.totalCostUsd
    : null;
  const preflightReceipts = candidateReceipts.filter((receipt) => receipt.status === "preflight_skipped");
  const preflightProviderCalls = preflightReceipts.reduce((sum, receipt) => sum + receipt.providerCalls, 0);
  const materiallyEligibleReceipts = candidateReceipts.filter((receipt) => receipt.status !== "preflight_skipped");
  const receiptResultReconciled = scopeArg !== "full" || (
    materiallyEligibleReceipts.length === phaseResults.length
    && phaseResults.every((phase) => phase.receipt?.status === phase.result.status)
    && materiallyEligibleReceipts.reduce((sum, receipt) => sum + receipt.providerCalls, 0) === candidateProviderCalls
  );
  const authorityEquivalent = scopeArg !== "full"
    || baselineFixture?.authorityFingerprint === candidateAuthorityFingerprint;
  if (!authorityEquivalent) {
    throw new Error("Baseline and candidate deterministic game runs diverged in canonical authority.");
  }

  const emittedCount = phaseResults.filter((phase) => phase.result.status === "emitted").length;
  const eligibleEmissionRate = phaseResults.length === 0 ? 0 : emittedCount / phaseResults.length;
  const specificBeatRate = phaseResults.length === 0
    ? 0
    : phaseResults.filter((phase) => phase.specific).length / phaseResults.length;
  const sourceReceiptsPresent = phaseResults.every(
    (phase) => phase.result.status !== "emitted" || phase.result.sources.length > 0,
  );
  const unsupportedAliasesDetected = phaseResults.some((phase) => phase.unsupportedSourceAliases.length > 0);
  const repetition = repetitionEvidence(phaseResults);
  const continuity = continuityEvidence(phaseResults);
  const automaticFullGatePassed = scopeArg === "full"
    && eligibleEmissionRate >= 0.8
    && specificBeatRate >= 0.8
    && sourceReceiptsPresent
    && !unsupportedAliasesDetected
    && phaseResults.every((phase) => phase.result.status !== "emitted" || phase.freshBoundarySupport)
    && continuity.continuityCoverageRate >= 0.8
    && !continuity.continuityBreaksDetected
    && !repetition.automaticRepetitionDetected
    && receiptResultReconciled
    && authorityEquivalent
    && candidateCost.status === "exact"
    && baselineCost?.status === "exact"
    && isHouseSummaryCostWithinEnvelope(candidateCost.totalCostUsd, baselineCost.totalCostUsd)
    && preflightProviderCalls === 0;
  const qualitySignals: QualitySignals = {
    unsupportedAliasesDetected,
    canonicalContradictionsDetected: null,
    continuityBreaksDetected: continuity.continuityBreaksDetected,
    repetitiveOrLowValueOrdinaryBeatsDetected: repetition.automaticRepetitionDetected ? true : null,
    milestoneRegressionDetected: null,
    pacingHarmDetected: null,
    qualityReviewed: false,
    reviewer: null,
    reviewedAt: null,
  };

  const report = {
    version: 2,
    evaluatedAt: new Date().toISOString(),
    scope: scopeArg === "full" ? "full_cadence" : "proving_slice",
    model: MODEL,
    provider: llmConfig.providerLabel,
    requestedServiceTier: llmConfig.openAIServiceTier ?? null,
    deterministicFixture: {
      gameId: fixtureGameId,
      seed: FIXTURE_SEED,
      playerIds: FIXTURE_PLAYERS.map(([id]) => id),
      baselineAuthorityFingerprint: baselineFixture?.authorityFingerprint ?? null,
      candidateAuthorityFingerprint,
      authorityEquivalent,
      baselineSelectiveNarrationSuppressed: scopeArg === "full",
      baselineInputsExcludeCandidateSummaries: true,
      laterBaselineInputsCarryOnlyPriorBaselineOutputs: scopeArg === "full",
    },
    baseline: {
      calls: baselineResponses.length,
      summaries: baselineResponses.map(parseBaselineSummary),
      promptCount: baselinePrompts.length,
      accounting: baselineCost,
    },
    candidate: {
      phases: phaseResults.map((phase) => ({
        actorCoordinate: phase.context.frontier.boundary.actorCoordinate,
        beatClass: phase.context.frontier.boundary.beatClass,
        priorNarrativeSeeded: phase.priorNarrativeSeeded,
        selectedSourcesSupported: phase.selectedSourcesSupported,
        unsupportedSourceAliases: phase.unsupportedSourceAliases,
        freshBoundarySupport: phase.freshBoundarySupport,
        canonicalSupportSatisfied: phase.canonicalSupportSatisfied,
        phaseSpecific: phase.phaseSpecific,
        specific: phase.specific,
        pendingDelta: phase.receipt?.pendingDelta ?? null,
        result: phase.result,
        accounting: candidatePhaseAccounting(phase),
      })),
      preflightReceipts: preflightReceipts.length,
      preflightProviderCalls,
      receiptResultReconciled,
      accounting: candidateCost,
    },
    verdict: {
      accountingComplete: (candidateOnly || baselineCost?.status === "exact") && candidateCost.status === "exact",
      materiallyEligibleBoundaries: phaseResults.length,
      emittedBoundaries: emittedCount,
      eligibleEmissionRate,
      specificBeatRate,
      continuityOpportunities: continuity.continuityOpportunities,
      continuityCovered: continuity.continuityCovered,
      continuityCoverageRate: continuity.continuityCoverageRate,
      sourceReceiptsPresent,
      publicSummariesUnique: repetition.publicSummariesUnique,
      maxPairwiseWordJaccard: repetition.maxPairwiseWordJaccard,
      maxPairwiseWordJaccardPair: repetition.maxPairwiseWordJaccardPair,
      preflightZeroCall: preflightProviderCalls === 0,
      candidateToRoundOnlyCostRatio: ratio,
      maxAcceptedCostRatio: HOUSE_SUMMARY_NEAR_BUDGET_RATIO,
      qualitySignals,
      sliceGatePassed:
        phaseResults.every((phase) => phase.result.status === "emitted" && phase.specific)
        && sourceReceiptsPresent
        && !unsupportedAliasesDetected
        && !continuity.continuityBreaksDetected
        && repetition.publicSummariesUnique
        && (candidateOnly || baselineCost?.status === "exact")
        && candidateCost.status === "exact",
      automaticFullGatePassed,
      fullGatePassed: automaticFullGatePassed && reviewedQualitySignalsPass(qualitySignals),
    },
  };

  await writeReport(report, outputPath);
  if (scopeArg === "full" ? !report.verdict.fullGatePassed : !report.verdict.sliceGatePassed) {
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
