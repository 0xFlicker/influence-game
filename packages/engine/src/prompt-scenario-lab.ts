/**
 * Producer-only prompt scenario replay.
 *
 * A scenario freezes one real decision point (context, continuity, and the
 * actor-visible transcript) so context changes can be compared without
 * running another full game. The runner returns structural diagnostics only;
 * captured prompt text and model output stay inside the caller's private pack.
 */

import type OpenAI from "openai";
import { InfluenceAgent, type Personality } from "./agent";
import { GameState } from "./game-state";
import {
  compileRecallPlan,
  estimateTokensFromChars,
  toStructuralRecallPlanReceipt,
} from "./context-recall-plan";
import type {
  CompactStrategyApplicationResult,
  CompactStrategyState,
  PhaseContext,
  PrivateDecisionTrace,
  PromptReuseReceipt,
  RecallContinuitySnapshot,
  RecallPlanReceipt,
  RecallPromptClass,
  TranscriptEntry,
} from "./game-runner.types";
import { Phase, type UUID } from "./types";

export type PromptScenarioAction =
  | {
      readonly kind: "plea";
      readonly response: { readonly message: string; readonly thinking?: string };
    }
  | {
      readonly kind: "vote";
      readonly response: {
        readonly empower: string;
        readonly thinking?: string;
        readonly strategyDelta?: unknown;
      };
    };

/**
 * Private input pack. It may contain real producer-visible game data and must
 * never be written to the structural report or committed as a public fixture.
 */
export interface PromptScenario {
  /** Random, opaque key minted by the private scenario-pack producer. */
  readonly reportKey: string;
  /** Stable opaque key shared by baseline/candidate variants of the same snapshot. */
  readonly comparisonKey: string;
  readonly actor: {
    readonly id: UUID;
    readonly name: string;
    readonly personality: Personality;
  };
  readonly model: string;
  /** Full game roster, including eliminated players, for faithful hydration. */
  readonly fullRoster: readonly PhaseContext["alivePlayers"][number][];
  readonly promptClass: RecallPromptClass;
  readonly phaseContext: PhaseContext;
  readonly continuity: RecallContinuitySnapshot;
  readonly transcript: readonly TranscriptEntry[];
  readonly action: PromptScenarioAction;
}

export interface PromptScenarioStructuralReport {
  readonly version: 1;
  /** Opaque producer-minted key; never a real game, player, trace, or scenario ID. */
  readonly scenarioKey: string;
  readonly comparisonKey: string;
  readonly action: PromptScenarioAction["kind"];
  readonly model: string;
  readonly renderedPrompt: {
    readonly characters: number;
    readonly tokenEstimate: number;
    /** Recall Plan lane characters only; useful for exposing renderer drift. */
    readonly planLaneCharacters: number;
    /**
     * Difference between rendered prompt characters and the structured Recall
     * Plan lanes. This is a renderer-drift signal, not an exact section sum.
     */
    readonly rendererOverheadCharacters: number;
  };
  readonly recallPlanReceipt: RecallPlanReceipt;
  /** Prompt-content fingerprints only; actor lane and all raw text are removed. */
  readonly requestFingerprint?: Omit<PromptReuseReceipt, "lane" | "comparable" | "reusableCharacters" | "reusableTokenEstimate" | "firstBreak">;
}

export interface PromptScenarioComparison {
  readonly baselineScenarioKey: string;
  readonly candidateScenarioKey: string;
  readonly action: PromptScenarioAction["kind"];
  readonly renderedPrompt: {
    readonly tokenEstimateDelta: number;
    readonly rendererOverheadCharactersDelta: number;
  };
  readonly recall: {
    readonly historySelectionDelta: number;
    readonly protectedOverflowChanged: boolean;
  };
}

export interface PromptScenarioDiaryResponse {
  readonly message: string;
  readonly thinking?: string;
  readonly strategy?: unknown;
  readonly strategyDelta?: unknown;
}

export interface PromptScenarioChain {
  readonly reportKey: string;
  readonly comparisonKey: string;
  readonly actor: PromptScenario["actor"];
  readonly model: string;
  readonly fullRoster: PromptScenario["fullRoster"];
  readonly phaseContext: PhaseContext;
  readonly continuity: RecallContinuitySnapshot;
  readonly transcript: readonly TranscriptEntry[];
  readonly eliminatedPlayerId: UUID;
  readonly diary: {
    readonly firstQuestion: string;
    readonly firstResponse: PromptScenarioDiaryResponse;
    readonly followUp?: {
      readonly question: string;
      readonly response: PromptScenarioDiaryResponse;
    };
  };
  readonly nextVote: {
    readonly response: {
      readonly empower: string;
      readonly thinking?: string;
      readonly strategy?: unknown;
      readonly strategyDelta?: unknown;
    };
  };
}

export interface PromptScenarioChainStructuralReport {
  readonly version: 1;
  readonly scenarioKey: string;
  readonly comparisonKey: string;
  readonly model: string;
  readonly canonicalElimination: {
    readonly committed: true;
    readonly sequence: number;
    readonly survivorCount: number;
  };
  readonly diary: {
    readonly firstMessageAccepted: true;
    readonly firstStrategyStatus: CompactStrategyApplicationResult["status"];
    readonly followUpPresent: boolean;
    readonly followUpStrategyStatus?: CompactStrategyApplicationResult["status"];
  };
  readonly nextDecision: {
    readonly legalChoiceCount: number;
    readonly modelActionAccepted: true;
    readonly selectedTargetWasLiving: true;
    readonly strategyStatus: CompactStrategyApplicationResult["status"];
  };
  readonly finalStrategy: {
    readonly lifecycle: CompactStrategyState["lifecycle"];
    readonly revision: number;
    readonly hasBaseline: boolean;
    readonly deltaCount: number;
    readonly priorEpochRetained: boolean;
  };
  readonly renderedPrompts: ReadonlyArray<{
    readonly action: "diary" | "vote";
    readonly characters: number;
    readonly tokenEstimate: number;
  }>;
  readonly requestFingerprints: ReadonlyArray<
    NonNullable<PromptScenarioStructuralReport["requestFingerprint"]>
  >;
}

export interface PromptScenarioChainPrivatePack {
  readonly scenario: PromptScenarioChain;
  readonly canonicalEvents: ReturnType<GameState["getCanonicalEvents"]>;
  readonly providerRequests: ReadonlyArray<Record<string, unknown>>;
  readonly decisionTraces: readonly PrivateDecisionTrace[];
  readonly firstDiaryResponse: Awaited<ReturnType<InfluenceAgent["getDiaryEntry"]>>;
  readonly firstStrategyResult: CompactStrategyApplicationResult;
  readonly followUpDiaryResponse?: Awaited<ReturnType<InfluenceAgent["getDiaryEntry"]>>;
  readonly followUpStrategyResult?: CompactStrategyApplicationResult;
  readonly nextVoteResponse: Awaited<ReturnType<InfluenceAgent["getVotes"]>>;
  readonly nextVoteStrategyResult: CompactStrategyApplicationResult;
  readonly finalStrategy: CompactStrategyState;
}

export interface PromptScenarioChainRun {
  readonly report: PromptScenarioChainStructuralReport;
  readonly privatePack: PromptScenarioChainPrivatePack;
}

function requireOpaqueKey(label: string, value: string): void {
  if (!/^[a-f0-9]{24}$/i.test(value)) {
    throw new Error(`${label} must be a 24-character opaque hexadecimal key.`);
  }
}

function toRequestFingerprint(receipt: PromptReuseReceipt | undefined): PromptScenarioStructuralReport["requestFingerprint"] {
  if (!receipt) return undefined;
  const { lane: _lane, comparable: _comparable, reusableCharacters: _reusableCharacters, reusableTokenEstimate: _reusableTokenEstimate, firstBreak: _firstBreak, ...fingerprint } = receipt;
  return fingerprint;
}

function seedContinuity(
  agent: InfluenceAgent,
  scenario: Pick<PromptScenario, "continuity" | "actor" | "phaseContext">,
): void {
  const continuity = scenario.continuity;
  agent.restoreContinuityCapsule(
    {
      version: 2,
      playerId: scenario.actor.id,
      playerName: scenario.actor.name,
      compactStrategy: continuity.compactStrategy,
      notes: [],
      relationships: {
        allies: [],
        threats: [],
      },
      powerActionMemory: [],
      roundHistory: [],
    },
    {
      livingPlayerNames: scenario.phaseContext.alivePlayers.map((player) => player.name),
    },
  );
}

function makeReplayOpenAIStub(
  requests: Array<Record<string, unknown>>,
  action: PromptScenarioAction,
): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          if (action.kind === "vote") {
            return {
              choices: [{
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{
                    id: "scenario-vote",
                    type: "function",
                    function: {
                      name: "cast_votes",
                      arguments: JSON.stringify({
                        thinking: action.response.thinking ?? "Fixture vote reasoning.",
                        empower: action.response.empower,
                        strategyDelta: action.response.strategyDelta ?? null,
                      }),
                    },
                  }],
                },
              }],
            };
          }

          return {
            choices: [{
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  thinking: action.response.thinking ?? "Fixture plea reasoning.",
                  message: action.response.message,
                }),
              },
            }],
          };
        },
      },
    },
  } as unknown as OpenAI;
}

type PromptScenarioChainProviderStep =
  | { readonly kind: "diary"; readonly response: PromptScenarioDiaryResponse }
  | { readonly kind: "vote"; readonly response: PromptScenarioChain["nextVote"]["response"] };

function makeChainReplayOpenAIStub(
  requests: Array<Record<string, unknown>>,
  steps: readonly PromptScenarioChainProviderStep[],
): OpenAI {
  let stepIndex = 0;
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          const step = steps[stepIndex];
          stepIndex += 1;
          if (!step) throw new Error("Prompt scenario chain received an unexpected provider retry or extra call.");
          if (step.kind === "diary") {
            return {
              choices: [{
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    thinking: step.response.thinking ?? "Fixture diary reasoning.",
                    message: step.response.message,
                    ...(Object.prototype.hasOwnProperty.call(step.response, "strategy") && {
                      strategy: step.response.strategy,
                    }),
                    ...(Object.prototype.hasOwnProperty.call(step.response, "strategyDelta") && {
                      strategyDelta: step.response.strategyDelta,
                    }),
                  }),
                },
              }],
            };
          }
          return {
            choices: [{
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "scenario-chain-vote",
                  type: "function",
                  function: {
                    name: "cast_votes",
                    arguments: JSON.stringify({
                      thinking: step.response.thinking ?? "Fixture next-vote reasoning.",
                      empower: step.response.empower,
                      ...(Object.prototype.hasOwnProperty.call(step.response, "strategy") && {
                        strategy: step.response.strategy,
                      }),
                      ...(Object.prototype.hasOwnProperty.call(step.response, "strategyDelta") && {
                        strategyDelta: step.response.strategyDelta,
                      }),
                    }),
                  },
                }],
              },
            }],
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function lastUserPrompt(request: Record<string, unknown>): string {
  const messages = request.messages;
  if (!Array.isArray(messages)) throw new Error("Prompt scenario replay expected a Chat Completions request.");
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      typeof message === "object"
      && message !== null
      && "role" in message
      && "content" in message
      && message.role === "user"
      && typeof message.content === "string"
    ) {
      return message.content;
    }
  }
  throw new Error("Prompt scenario replay did not capture a user prompt.");
}

/**
 * Runs one public agent action against a deterministic fake provider.
 * This intentionally exercises the production prompt path, not a private
 * prompt-builder shortcut.
 */
export async function runPromptScenario(scenario: PromptScenario): Promise<PromptScenarioStructuralReport> {
  requireOpaqueKey("reportKey", scenario.reportKey);
  requireOpaqueKey("comparisonKey", scenario.comparisonKey);
  const requests: Array<Record<string, unknown>> = [];
  const traces: PrivateDecisionTrace[] = [];
  const plan = compileRecallPlan({
    actorId: scenario.actor.id,
    promptClass: scenario.promptClass,
    continuity: scenario.continuity,
    phaseContext: scenario.phaseContext,
    transcript: scenario.transcript,
  });
  const agent = new InfluenceAgent(
    scenario.actor.id,
    scenario.actor.name,
    scenario.actor.personality,
    makeReplayOpenAIStub(requests, scenario.action),
    scenario.model,
    undefined,
    undefined,
    { privateTraceSink: (trace) => { traces.push(trace); } },
  );
  agent.onGameStart(scenario.phaseContext.gameId, scenario.fullRoster.map((player) => ({ ...player })));
  seedContinuity(agent, scenario);

  const context: PhaseContext = {
    ...scenario.phaseContext,
    recallPromptClass: scenario.promptClass,
    recallPlan: plan,
  };
  if (scenario.action.kind === "vote") await agent.getVotes(context);
  else await agent.getPlea(context);

  const prompt = lastUserPrompt(requests[0] ?? {});
  const planLaneCharacters = plan.budget.protectedChars + plan.budget.hotChars + plan.budget.historyChars;
  const trace = traces.at(0);
  const requestFingerprint = toRequestFingerprint(trace?.promptReuse);

  return {
    version: 1,
    scenarioKey: scenario.reportKey,
    comparisonKey: scenario.comparisonKey,
    action: scenario.action.kind,
    model: scenario.model,
    renderedPrompt: {
      characters: prompt.length,
      tokenEstimate: estimateTokensFromChars(prompt.length),
      planLaneCharacters,
      rendererOverheadCharacters: Math.max(0, prompt.length - planLaneCharacters),
    },
    recallPlanReceipt: toStructuralRecallPlanReceipt(plan.receipt),
    ...(requestFingerprint && { requestFingerprint }),
  };
}

function buildChainPhaseContext(
  scenario: PromptScenarioChain,
  agent: InfluenceAgent,
  gameState: GameState,
  phase: Phase,
): PhaseContext {
  const continuity = agent.getRecallContinuitySnapshot();
  const alivePlayers = gameState.getAlivePlayers().map((player) => ({
    id: player.id,
    name: player.name,
    shielded: player.shielded,
  }));
  const latestEliminatedPlayerName = gameState.getAllPlayers()
    .filter((player) => player.status === "eliminated")
    .at(-1)?.name;
  const base: PhaseContext = {
    ...scenario.phaseContext,
    round: gameState.round,
    phase,
    alivePlayers,
    ...(latestEliminatedPlayerName && { latestEliminatedPlayerName }),
    recallPromptClass: "strategic_decision",
  };
  const recallPlan = compileRecallPlan({
    actorId: scenario.actor.id,
    promptClass: "strategic_decision",
    continuity,
    phaseContext: base,
    transcript: scenario.transcript,
  });
  return { ...base, recallPlan };
}

function compactStrategyBoundaryForNextAction(
  state: CompactStrategyState,
): "ordinary_action" | "action_repair" {
  return state.lifecycle === "reconciliation_required" || state.lifecycle === "repair_required"
    ? "action_repair"
    : "ordinary_action";
}

/**
 * Runs the provider-free multi-step contract used by the replacement gate.
 * The structural report is safe to share; the separate private pack deliberately
 * retains complete prompts, model proposals, strategy prose, and provenance.
 */
export async function runPromptScenarioChain(
  scenario: PromptScenarioChain,
): Promise<PromptScenarioChainRun> {
  requireOpaqueKey("reportKey", scenario.reportKey);
  requireOpaqueKey("comparisonKey", scenario.comparisonKey);
  if (scenario.eliminatedPlayerId === scenario.actor.id) {
    throw new Error("Prompt scenario chain actor must survive the canonical elimination.");
  }

  const providerRequests: Array<Record<string, unknown>> = [];
  const decisionTraces: PrivateDecisionTrace[] = [];
  const providerSteps: PromptScenarioChainProviderStep[] = [
    { kind: "diary", response: scenario.diary.firstResponse },
    ...(scenario.diary.followUp
      ? [{ kind: "diary" as const, response: scenario.diary.followUp.response }]
      : []),
    { kind: "vote", response: scenario.nextVote.response },
  ];
  const agent = new InfluenceAgent(
    scenario.actor.id,
    scenario.actor.name,
    scenario.actor.personality,
    makeChainReplayOpenAIStub(providerRequests, providerSteps),
    scenario.model,
    undefined,
    undefined,
    { privateTraceSink: (trace) => { decisionTraces.push(trace); } },
  );
  agent.onGameStart(
    scenario.phaseContext.gameId,
    scenario.fullRoster.map((player) => ({ id: player.id, name: player.name })),
  );
  seedContinuity(agent, scenario);

  const gameState = new GameState(
    scenario.fullRoster.map((player) => ({ id: player.id, name: player.name })),
    { gameId: scenario.phaseContext.gameId, now: () => 1_700_000_000_000 },
  );
  gameState.startRound();
  if (!gameState.getPlayer(scenario.eliminatedPlayerId)) {
    throw new Error("Prompt scenario chain eliminated player is not in the frozen roster.");
  }
  gameState.eliminatePlayer(scenario.eliminatedPlayerId);
  agent.markCompactStrategyReconciliationRequired();

  const canonicalEvents = gameState.getCanonicalEvents();
  const eliminationEvent = [...canonicalEvents]
    .reverse()
    .find((event) => event.type === "player.eliminated");
  if (!eliminationEvent) throw new Error("Prompt scenario chain failed to commit canonical elimination.");

  const firstDiaryContext = buildChainPhaseContext(scenario, agent, gameState, Phase.DIARY_ROOM);
  const firstDiaryResponse = await agent.getDiaryEntry(
    firstDiaryContext,
    scenario.diary.firstQuestion,
    [],
  );
  const firstStrategyResult = agent.commitCompactStrategyCandidate(
    "post_eviction_diary",
    firstDiaryResponse,
  );

  let followUpDiaryResponse: Awaited<ReturnType<InfluenceAgent["getDiaryEntry"]>> | undefined;
  let followUpStrategyResult: CompactStrategyApplicationResult | undefined;
  if (scenario.diary.followUp) {
    const followUpContext = buildChainPhaseContext(scenario, agent, gameState, Phase.DIARY_ROOM);
    followUpDiaryResponse = await agent.getDiaryEntry(
      followUpContext,
      scenario.diary.followUp.question,
      [{ question: scenario.diary.firstQuestion, answer: firstDiaryResponse.message }],
    );
    const followUpBoundary = agent.getCompactStrategyState().lifecycle === "repair_required"
      ? "diary_repair"
      : "diary_follow_up";
    followUpStrategyResult = agent.commitCompactStrategyCandidate(
      followUpBoundary,
      followUpDiaryResponse,
    );
  }

  const nextVoteContext = buildChainPhaseContext(scenario, agent, gameState, Phase.VOTE);
  const legalChoiceCount = nextVoteContext.alivePlayers.filter(
    (player) => player.id !== scenario.actor.id,
  ).length;
  if (legalChoiceCount < 2) {
    throw new Error("Prompt scenario chain requires at least two materially different legal next-vote choices.");
  }
  const nextVoteResponse = await agent.getVotes(nextVoteContext);
  if (nextVoteResponse.strategyGameplayAccepted === false) {
    throw new Error("Prompt scenario chain requires a non-fallback accepted next action.");
  }
  const selectedTargetWasLiving = nextVoteContext.alivePlayers.some(
    (player) => player.id === nextVoteResponse.empowerTarget && player.id !== scenario.actor.id,
  );
  if (!selectedTargetWasLiving) {
    throw new Error("Prompt scenario chain next action selected a non-living or self target.");
  }
  const nextVoteStrategyResult = agent.commitCompactStrategyCandidate(
    compactStrategyBoundaryForNextAction(agent.getCompactStrategyState()),
    nextVoteResponse,
  );
  const finalStrategy = agent.getCompactStrategyState();

  const actionByRequest = providerSteps.map((step) => step.kind);
  const renderedPrompts = providerRequests.map((request, index) => {
    const prompt = lastUserPrompt(request);
    return {
      action: actionByRequest[index] ?? "diary",
      characters: prompt.length,
      tokenEstimate: estimateTokensFromChars(prompt.length),
    };
  });
  const requestFingerprints = decisionTraces
    .map((trace) => toRequestFingerprint(trace.promptReuse))
    .filter((receipt): receipt is NonNullable<typeof receipt> => receipt !== undefined);

  const report: PromptScenarioChainStructuralReport = {
    version: 1,
    scenarioKey: scenario.reportKey,
    comparisonKey: scenario.comparisonKey,
    model: scenario.model,
    canonicalElimination: {
      committed: true,
      sequence: eliminationEvent.sequence,
      survivorCount: gameState.getAlivePlayers().length,
    },
    diary: {
      firstMessageAccepted: true,
      firstStrategyStatus: firstStrategyResult.status,
      followUpPresent: scenario.diary.followUp !== undefined,
      ...(followUpStrategyResult && { followUpStrategyStatus: followUpStrategyResult.status }),
    },
    nextDecision: {
      legalChoiceCount,
      modelActionAccepted: true,
      selectedTargetWasLiving: true,
      strategyStatus: nextVoteStrategyResult.status,
    },
    finalStrategy: {
      lifecycle: finalStrategy.lifecycle,
      revision: finalStrategy.revision,
      hasBaseline: finalStrategy.baseline !== null,
      deltaCount: finalStrategy.deltas.length,
      priorEpochRetained: finalStrategy.priorEpoch !== null,
    },
    renderedPrompts,
    requestFingerprints,
  };

  return {
    report,
    privatePack: {
      scenario,
      canonicalEvents,
      providerRequests,
      decisionTraces,
      firstDiaryResponse,
      firstStrategyResult,
      ...(followUpDiaryResponse && { followUpDiaryResponse }),
      ...(followUpStrategyResult && { followUpStrategyResult }),
      nextVoteResponse,
      nextVoteStrategyResult,
      finalStrategy,
    },
  };
}

/** Compare private baseline/candidate runs without returning either prompt. */
export function comparePromptScenarioReports(
  baseline: PromptScenarioStructuralReport,
  candidate: PromptScenarioStructuralReport,
): PromptScenarioComparison {
  if (baseline.action !== candidate.action || baseline.comparisonKey !== candidate.comparisonKey) {
    throw new Error("Prompt scenario comparison requires variants of the same action and opaque snapshot key.");
  }
  return {
    baselineScenarioKey: baseline.scenarioKey,
    candidateScenarioKey: candidate.scenarioKey,
    action: baseline.action,
    renderedPrompt: {
      tokenEstimateDelta: candidate.renderedPrompt.tokenEstimate - baseline.renderedPrompt.tokenEstimate,
      rendererOverheadCharactersDelta:
        candidate.renderedPrompt.rendererOverheadCharacters - baseline.renderedPrompt.rendererOverheadCharacters,
    },
    recall: {
      historySelectionDelta:
        candidate.recallPlanReceipt.selectedLaneCounts.history - baseline.recallPlanReceipt.selectedLaneCounts.history,
      protectedOverflowChanged:
        candidate.recallPlanReceipt.protectedOverflow !== baseline.recallPlanReceipt.protectedOverflow,
    },
  };
}
