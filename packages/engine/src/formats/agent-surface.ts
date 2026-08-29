import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type {
  FormatDecisionFallbackReason,
  FormatDecisionProvenance,
  StrategicDecisionMetadata,
} from "../game-runner.types";
import { displayNameForFormat } from "../format-presentation-metadata";
import type { UUID } from "../types";
import {
  requireSealedElimRegistration,
  type SealedElimFormatId,
} from "./catalog";

export const STRATEGIC_THINKING_TOOL_PROPERTIES = {
  thinking: {
    type: "string",
    description: "Your concise private reasoning for this decision.",
  },
};

export const STRATEGY_DELTA_GUIDANCE = "Treat strategyDelta as an exceptional private carry-forward update. Set it only for a material, actionable change to targets, alliance posture, commitments, threat assessment, priorities, or contingencies that should guide future decisions. Use JSON null, never the string \"null\", when the current strategy still applies; omit the field when the response format permits omission. Do not summarize the action, repeat the baseline, narrate unchanged intent, or use the field merely to prove strategic consideration.";

export const STRATEGY_DELTA_TOOL_PROPERTIES = {
  strategyDelta: {
    type: ["string", "null"],
    description: STRATEGY_DELTA_GUIDANCE,
  },
};

export const FULL_STRATEGY_TOOL_PROPERTIES = {
  strategy: {
    type: "string",
    description: "Your concise but complete private strategy after reconciling the current remaining field, material commitments, coalition posture, target posture, and important uncertainty.",
  },
};

/** Ordinary strategic surfaces retain their historical import name during U1. */
export const STRATEGIC_DECISION_TOOL_PROPERTIES = STRATEGY_DELTA_TOOL_PROPERTIES;
export const STRATEGIC_DECISION_REQUIRED = ["strategyDelta"] as const;
export const FULL_STRATEGY_REQUIRED = ["strategy"] as const;

export interface SealedElimTargetPlayer {
  id: UUID;
  name: string;
}

export interface SealedElimModelOutput {
  thinking?: string;
  targetId: UUID;
  strategyDelta?: unknown;
  strategy?: unknown;
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

export type TwoNamesTargetAction = "replacement" | "ballot" | "tiebreak";

function exactTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: readonly string[],
): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: {
          ...STRATEGIC_THINKING_TOOL_PROPERTIES,
          ...properties,
          ...STRATEGIC_DECISION_TOOL_PROPERTIES,
        },
        required: ["thinking", ...required, ...STRATEGIC_DECISION_REQUIRED],
        additionalProperties: false,
      },
      strict: true,
    },
  };
}

export function buildTwoNamesInitialNamesTool(
  legalNomineeNames: readonly string[],
): ChatCompletionTool {
  return exactTool(
    "two_names_initial_names",
    "Name two distinct legal contestants for the Two Names round.",
    {
      first: {
        type: "string",
        enum: [...legalNomineeNames],
        description: "The first nominee revealed to the room.",
      },
      second: {
        type: "string",
        enum: [...legalNomineeNames],
        description: "The second, distinct nominee revealed to the room.",
      },
    },
    ["first", "second"],
  );
}

export function buildTwoNamesOverrideTool(
  initialNomineeNames: readonly [string, string],
): ChatCompletionTool {
  return exactTool(
    "two_names_override",
    "Decline Override or remove exactly one current nominee.",
    {
      useOverride: {
        type: "boolean",
        description: "True to remove one nominee; false to leave both names unchanged.",
      },
      removed: {
        type: ["string", "null"],
        enum: [...initialNomineeNames, null],
        description: "The removed nominee when useOverride is true; otherwise null.",
      },
    },
    ["useOverride", "removed"],
  );
}

export function buildTwoNamesTargetTool(
  action: TwoNamesTargetAction,
  legalTargetNames: readonly string[],
): ChatCompletionTool {
  const config = {
    replacement: {
      name: "two_names_replacement",
      description: "Choose one legal replacement nominee.",
    },
    ballot: {
      name: "two_names_ballot",
      description: "Cast one sealed exit ballot for a final nominee.",
    },
    tiebreak: {
      name: "two_names_tiebreak",
      description: "Break the tied vote by eliminating one final nominee.",
    },
  } as const;
  return exactTool(
    config[action].name,
    config[action].description,
    {
      target: {
        type: "string",
        enum: [...legalTargetNames],
        description: "One player from the exact legal choice list.",
      },
    },
    ["target"],
  );
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
}

function legalTargetsFor(
  input: RunSealedElimTargetDecisionInput,
): SealedElimTargetPlayer[] {
  return input.aliveIds
    .filter((id) => id !== input.selfId)
    .map((id) => input.alivePlayers.find((player) => player.id === id))
    .filter((player): player is SealedElimTargetPlayer => player !== undefined);
}

function acceptedActionMetadata(
  metadata: StrategicDecisionMetadata,
  directModelChoice: boolean,
): StrategicDecisionMetadata {
  if (!directModelChoice) {
    const { decisionId: _decisionId, ...candidate } = metadata;
    return {
      ...candidate,
      strategyGameplayAccepted: false,
    };
  }
  return metadata;
}

function strategicDecisionMetadata(output: SealedElimModelOutput): StrategicDecisionMetadata {
  const decisionId = typeof output.decisionId === "string"
    ? output.decisionId.trim()
    : "";
  const hasStrategyCandidate = Object.prototype.hasOwnProperty.call(output, "strategyDelta")
    || Object.prototype.hasOwnProperty.call(output, "strategy");
  return {
    ...(Object.prototype.hasOwnProperty.call(output, "strategyDelta")
      ? { strategyDelta: output.strategyDelta }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(output, "strategy")
      ? { strategy: output.strategy }
      : {}),
    ...(!hasStrategyCandidate
      ? { strategyCandidateProposed: true }
      : {}),
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
          ...STRATEGIC_THINKING_TOOL_PROPERTIES,
          target: {
            type: "string",
            enum: [...legalTargetNames],
            description: "One remaining non-self contestant from the legal target list.",
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

/** Shared validate -> exact tool call -> accepted typed decision path. */
export async function runSealedElimTargetDecision(
  input: RunSealedElimTargetDecisionInput,
): Promise<SealedElimTargetDecision> {
  const surface = requireSealedElimRegistration(input.formatId).decision;
  const publicName = displayNameForFormat(input.formatId);
  const legalTargets = legalTargetsFor(input);
  const fallbackTarget = legalTargets[0];
  if (!fallbackTarget) {
    throw new Error(
      `${publicName} requires at least one remaining non-self target`,
    );
  }

  const prompt = `${input.basePrompt}
## ${publicName} Ballot
Fixed rule sheet: ${input.ruleSheet}

Your ballot is sealed until the House reveal. Cast one sealed vote for exactly one remaining non-self contestant.
Legal targets: ${legalTargets.map((player) => player.name).join(", ")}

${surface.strategyGuidance}

Use the ${surface.toolName} tool.`;

  const output = await input.callTool({
    prompt,
    tool: buildSealedElimBallotTool(
      input.formatId,
      legalTargets.map((player) => player.name),
    ),
    traceAction: surface.traceAction,
  });
  const metadata = strategicDecisionMetadata(output);
  return {
    targetId: output.targetId,
    thinking: output.thinking,
    reasoningContext: output.reasoningContext,
    ...acceptedActionMetadata(metadata, true),
    ...decisionProvenance(true, surface.invalidTargetReason),
  };
}
