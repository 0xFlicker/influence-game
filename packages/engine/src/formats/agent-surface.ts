import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type {
  FormatDecisionFallbackReason,
  FormatDecisionProvenance,
  StrategicDecisionMetadata,
} from "../game-runner.types";
import type { UUID } from "../types";
import {
  requireSealedElimRegistration,
  type SealedElimFormatId,
} from "./catalog";

export const STRATEGIC_DECISION_TOOL_PROPERTIES = {
  decisionLog: {
    type: ["string", "null"],
    description: "Compact private producer/debug receipt for what this action means strategically. Use null when there is no meaningful strategic note.",
  },
};

export const STRATEGIC_DECISION_REQUIRED = ["decisionLog"];

export interface SealedElimTargetPlayer {
  id: UUID;
  name: string;
}

export interface SealedElimModelOutput {
  thinking?: string;
  target?: unknown;
  decisionLog?: unknown;
  decisionId?: UUID;
  reasoningContext?: string;
}

export type SealedElimTargetDecision = FormatDecisionProvenance &
  StrategicDecisionMetadata & {
    targetId: UUID;
    thinking?: string;
    reasoningContext?: string;
  };

export interface SealedElimToolCallRequest {
  prompt: string;
  tool: ChatCompletionTool;
  traceAction: string;
}

export interface RunSealedElimTargetDecisionInput {
  formatId: SealedElimFormatId;
  selfId: UUID;
  aliveIds: readonly UUID[];
  alivePlayers: readonly SealedElimTargetPlayer[];
  basePrompt: string;
  ruleSheet: string;
  callTool: (
    request: SealedElimToolCallRequest,
  ) => Promise<SealedElimModelOutput>;
  recordDecision: (
    action: string,
    label: string,
    metadata: StrategicDecisionMetadata,
  ) => void;
  onToolFailure?: (
    error: unknown,
    fallbackTarget: SealedElimTargetPlayer,
  ) => void;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function legalTargetsFor(
  input: RunSealedElimTargetDecisionInput,
): SealedElimTargetPlayer[] {
  return input.aliveIds
    .filter((id) => id !== input.selfId)
    .map((id) => input.alivePlayers.find((player) => player.id === id))
    .filter((player): player is SealedElimTargetPlayer => player !== undefined);
}

function findTargetByName(
  legalTargets: readonly SealedElimTargetPlayer[],
  value: unknown,
): SealedElimTargetPlayer | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeName(value);
  return legalTargets.find((player) => normalizeName(player.name) === normalized);
}

function acceptedActionMetadata(
  metadata: StrategicDecisionMetadata,
  directModelChoice: boolean,
): StrategicDecisionMetadata {
  if (directModelChoice) return metadata;
  return metadata.decisionLog ? { decisionLog: metadata.decisionLog } : {};
}

function strategicDecisionMetadata(
  output: SealedElimModelOutput,
): StrategicDecisionMetadata {
  const decisionLog = typeof output.decisionLog === "string"
    ? output.decisionLog.trim()
    : "";
  const decisionId = typeof output.decisionId === "string"
    ? output.decisionId.trim()
    : "";
  return {
    ...(decisionLog ? { decisionLog } : {}),
    ...(decisionId ? { decisionId } : {}),
  };
}

function decisionProvenance(
  accepted: boolean,
  fallbackReason: FormatDecisionFallbackReason,
): FormatDecisionProvenance {
  return accepted
    ? { decisionSource: "llm", fallbackReason: null }
    : { decisionSource: "fallback", fallbackReason };
}

export function buildSealedElimBallotTool(
  formatId: SealedElimFormatId,
  legalTargetNames: readonly string[],
): ChatCompletionTool {
  const surface = requireSealedElimRegistration(formatId).decision;
  return {
    type: "function",
    function: {
      name: surface.toolName,
      description: surface.toolDescription,
      parameters: {
        type: "object",
        properties: {
          thinking: {
            type: "string",
            description: "Your hidden strategic reasoning for this sealed ballot.",
          },
          target: {
            type: "string",
            enum: [...legalTargetNames],
            description: "One legal living non-self target name.",
          },
          ...STRATEGIC_DECISION_TOOL_PROPERTIES,
        },
        required: ["thinking", "target", ...STRATEGIC_DECISION_REQUIRED],
        additionalProperties: false,
      },
      strict: true,
    },
  };
}

/** Shared validate -> tool call -> deterministic repair -> provenance path. */
export async function runSealedElimTargetDecision(
  input: RunSealedElimTargetDecisionInput,
): Promise<SealedElimTargetDecision> {
  const surface = requireSealedElimRegistration(input.formatId).decision;
  const legalTargets = legalTargetsFor(input);
  const fallbackTarget = legalTargets[0];
  if (!fallbackTarget) {
    throw new Error(
      `${surface.publicName} requires at least one living non-self target`,
    );
  }

  const prompt = `${input.basePrompt}
## ${surface.ballotHeading}
Fixed rule sheet: ${input.ruleSheet}

Your ballot is sealed until the House reveal. Cast one sealed vote for exactly one living non-self target.
Legal targets: ${legalTargets.map((player) => player.name).join(", ")}

${surface.strategyGuidance}

Use the ${surface.toolName} tool.`;

  try {
    const output = await input.callTool({
      prompt,
      tool: buildSealedElimBallotTool(
        input.formatId,
        legalTargets.map((player) => player.name),
      ),
      traceAction: surface.traceAction,
    });
    const metadata = strategicDecisionMetadata(output);
    input.recordDecision(surface.traceAction, surface.decisionLabel, metadata);
    const target = findTargetByName(legalTargets, output.target);
    const accepted = target !== undefined;
    return {
      targetId: target?.id ?? fallbackTarget.id,
      thinking: output.thinking,
      reasoningContext: output.reasoningContext,
      ...acceptedActionMetadata(metadata, accepted),
      ...decisionProvenance(accepted, surface.invalidTargetReason),
    };
  } catch (error) {
    input.onToolFailure?.(error, fallbackTarget);
    return {
      targetId: fallbackTarget.id,
      thinking: surface.fallbackThinking,
      decisionSource: "fallback",
      fallbackReason: "tool_call_failed",
    };
  }
}
