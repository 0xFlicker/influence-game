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
import {
  compileRecallPlan,
  estimateTokensFromChars,
  toStructuralRecallPlanReceipt,
} from "./context-recall-plan";
import type {
  PhaseContext,
  PrivateDecisionTrace,
  PromptReuseReceipt,
  RecallContinuitySnapshot,
  RecallPlanReceipt,
  RecallPromptClass,
  TranscriptEntry,
} from "./game-runner.types";
import type { UUID } from "./types";

export type PromptScenarioAction =
  | {
      readonly kind: "plea";
      readonly response: { readonly message: string; readonly thinking?: string };
    }
  | {
      readonly kind: "vote";
      readonly response: { readonly empower: string; readonly thinking?: string; readonly decisionLog?: string };
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

function seedContinuity(agent: InfluenceAgent, scenario: PromptScenario): void {
  const continuity = scenario.continuity;
  agent.restoreContinuityCapsule(
    {
      version: 1,
      playerId: scenario.actor.id,
      playerName: scenario.actor.name,
      strategyPacket: continuity.strategyPacket,
      reflectionSummary: continuity.reflectionSummary,
      notes: [],
      relationships: {
        allies: continuity.reflectionSummary?.allies ?? [],
        threats: continuity.reflectionSummary?.threats ?? [],
      },
      powerActionMemory: [],
      roundHistory: [],
      recentStrategicDecisions: continuity.recentStrategicDecisions.map((receipt) => ({ ...receipt })),
      strategyPacketRevisionCounter: continuity.strategyPacketRevisionCounter ?? 0,
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
                        decisionLog: action.response.decisionLog ?? null,
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
