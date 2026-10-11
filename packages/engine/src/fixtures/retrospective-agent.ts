import type { IAgent } from "../game-runner.types";
import type { WerewolfAgent } from "../werewolf/runner";
import { assertRetrospectiveSpeakerContext, type RetrospectiveSpeakerContext } from "../retrospective-context";
import { retrospectiveSpeechArtifact, type RetrospectiveSpeechV1 } from "../retrospective";
import { exactStructuredOutputRegistry } from "../structured-output";

/** Provider-free speech fixture; never a production fallback. */
function fixtureStatement(context: RetrospectiveSpeakerContext, signal?: AbortSignal): RetrospectiveSpeechV1 {
  signal?.throwIfAborted();
  assertRetrospectiveSpeakerContext(context);
  return { speech: `${context.self.name}: I have seen the complete game and heard ${context.priorStatements.length} earlier final statements. This is my final reflection.` };
}

export const fixtureInfluenceRetrospective: IAgent["getRetrospectiveStatement"] = async (_phase, context, options) => fixtureStatement(context, options?.signal);
export const fixtureWerewolfRetrospective: WerewolfAgent["getRetrospectiveStatement"] = async input => fixtureStatement(input.context, input.signal);

/** Exact detached contexts and scripted speeches for subsequent runtime proofs. */
export class RetrospectiveStatementFixture {
  readonly contexts: RetrospectiveSpeakerContext[] = [];
  constructor(private readonly speeches: readonly RetrospectiveSpeechV1[] = []) {}

  async emit(context: RetrospectiveSpeakerContext, signal?: AbortSignal): Promise<RetrospectiveSpeechV1> {
    const defaultStatement = fixtureStatement(context, signal);
    const decoded = exactStructuredOutputRegistry.decodeAcceptedValue(retrospectiveSpeechArtifact,
      this.speeches[this.contexts.length] ?? defaultStatement);
    if (decoded.status !== "valid") throw new Error(decoded.message);
    this.contexts.push(structuredClone(context));
    return structuredClone(decoded.value);
  }
}
