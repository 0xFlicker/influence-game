import { describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import type { ProviderAttemptRecord } from "../provider-execution";
import {
  HOUSE_LONG_FORM_SUMMARY_SCHEMA,
  HOUSE_PRODUCER_BRIEF_SCHEMA,
  HOUSE_STRATEGY_BIBLE_SCHEMA,
  compileHouseDiaryProducerEvidence,
  compileHouseProducerEvidence,
  decodeAcceptedHouseLongForm,
  decodeAcceptedHouseProducerBrief,
  decodeAcceptedHouseStrategyBible,
  decodeHouseLongFormProvider,
  decodeHouseProducerBriefProvider,
  decodeHouseStrategyBibleProvider,
} from "../house-producer-evidence";
import { LLMHouseInterviewer, type DiaryRoomContext } from "../house-interviewer";
import type {
  HouseEvidenceBundle,
  HouseGameplaySummaryContext,
  HouseStrategyBiblePacket,
  HouseStrategyBibleUpdateContext,
} from "../game-runner.types";
import { Phase } from "../types";
import type { HouseAudienceSummaryArtifact } from "../house-summary-frontier";

const ATLAS = "atlas-id";
const NYX = "nyx-id";

function audienceSummaryArtifact(
  renderedText = "Atlas selects vote bomb. Nyx: “Now the alliance has to prove itself.”",
): HouseAudienceSummaryArtifact {
  return {
    version: 1,
    boundary: {
      version: 1,
      id: "house-beat/v1:2:format_pick:8:4",
      gameId: "game-id",
      actorCoordinate: "format_pick",
      round: 2,
      phase: Phase.FORMAT_PICK,
      beatClass: "ordinary",
      canonicalHead: 8,
      dialogueHead: 4,
    },
    claims: [{ kind: "canonical_event", sourceAlias: "S1" }],
    sources: [{
      kind: "canonical_event",
      sequence: 8,
      type: "format.selected",
      round: 2,
      phase: Phase.FORMAT_PICK,
    }],
    renderedText,
  };
}

function makeOpenAIStub(
  requests: Array<Record<string, unknown>>,
  responses: Array<string | Error>,
): OpenAI {
  const next = (params: Record<string, unknown>): string => {
    requests.push(params);
    const response = responses[Math.min(requests.length - 1, responses.length - 1)];
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error("No response configured");
    return response;
  };
  return {
    responses: {
      create: async (params: Record<string, unknown>) => {
        const content = next(params);
        return {
          id: `response-${requests.length}`,
          object: "response",
          status: "completed",
          output_text: content,
          output: [{
            id: `message-${requests.length}`,
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: content }],
          }],
          usage: { input_tokens: 20, output_tokens: 20, total_tokens: 40 },
        };
      },
    },
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          const content = next(params);
          return {
            id: `completion-${requests.length}`,
            choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
            usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function roundFacts(): HouseEvidenceBundle["roundFacts"] {
  return {
    round: 2,
    empoweredName: "Nyx",
    empowerMethod: "plurality",
    empowerVoteCounts: [],
    exposeVoteCounts: [],
    councilCandidates: null,
    powerAction: null,
    shieldGrantedName: null,
    autoEliminatedName: null,
    councilVoteCounts: [],
    councilMethod: null,
    eliminatedName: null,
    councilRoles: [],
    selectedFormatId: "vote_bomb",
    selectedFormatName: "Vote Bomb",
    offeredFormatIds: ["vote_bomb", "safety_bounce"],
    offeredFormatNames: ["Vote Bomb", "Safety Bounce"],
    formatMethod: "vote_bomb",
    eliminationPath: "format",
    formatResolution: null,
  };
}

function evidenceBundle(): HouseEvidenceBundle {
  return {
    round: 2,
    phase: Phase.FORMAT_RESOLVE,
    canonicalHead: 9,
    players: [
      { id: ATLAS, name: "Atlas", status: "alive" },
      { id: NYX, name: "Nyx", status: "alive" },
    ],
    alivePlayers: ["Atlas", "Nyx"],
    eliminatedPlayers: [],
    activeShieldNames: [],
    empoweredName: "Nyx",
    councilCandidates: null,
    recentTranscript: [{
      round: 2,
      phase: Phase.FORMAT_MINGLE,
      timestamp: 1,
      from: "Atlas",
      scope: "public",
      text: "Nyx and I should compare the same target.",
      speakerPlayerId: ATLAS,
      entrySequence: 4,
      dialogueKind: "public_speech",
      audiencePlayerIds: [],
    }],
    recentPublicMessages: [],
    recentDiaryEntries: [{
      round: 1,
      precedingPhase: Phase.COUNCIL,
      agentId: NYX,
      agentName: "Nyx",
      question: "Who do you trust?",
      answer: "Atlas, for now.",
    }],
    audienceSummaryArtifacts: [],
    roomAllocations: [],
    roundFacts: roundFacts(),
    canonicalEventCount: 9,
  };
}

function strategyContext(previousPacket: HouseStrategyBiblePacket | null = null): HouseStrategyBibleUpdateContext {
  return {
    round: 2,
    phase: Phase.FORMAT_RESOLVE,
    previousPacket,
    evidence: evidenceBundle(),
    coveredWindow: { fromRound: 1, toRound: 2, toPhase: Phase.FORMAT_RESOLVE },
  };
}

function gameplayContext(packet: HouseStrategyBiblePacket | null = null): HouseGameplaySummaryContext {
  return {
    gameId: "game-id",
    round: 2,
    phase: Phase.FORMAT_RESOLVE,
    kind: "long-form",
    alivePlayers: ["Atlas", "Nyx"],
    packet,
    evidence: evidenceBundle(),
    coveredWindow: { fromRound: 1, toRound: 2, toPhase: Phase.FORMAT_RESOLVE },
  };
}

function diaryContext(): DiaryRoomContext {
  return {
    precedingPhase: Phase.FORMAT_RESOLVE,
    round: 2,
    providerInterviewOrdinal: 1,
    agentId: ATLAS,
    agentName: "Atlas",
    canonicalHead: 9,
    players: [
      { id: ATLAS, name: "Atlas", status: "alive" },
      { id: NYX, name: "Nyx", status: "alive" },
    ],
    alivePlayers: ["Atlas", "Nyx"],
    activeShieldNames: [],
    eliminatedPlayers: [],
    lastEliminated: null,
    empoweredName: "Nyx",
    councilCandidates: null,
    recentMessages: [{
      fromPlayerId: NYX,
      from: "Nyx",
      text: "Atlas and I should compare the same target.",
      phase: Phase.FORMAT_MINGLE,
    }],
    previousDiaryEntries: [],
    playerMessages: [],
    audienceSummaryArtifacts: [],
  };
}

function producerAlias(kind: "roster_snapshot" | "round_snapshot" | "player_statement" | "diary_statement"): string {
  return compileHouseProducerEvidence(evidenceBundle()).catalog.find((source) => source.kind === kind)!.alias;
}

function diaryProducerAlias(kind: "roster_snapshot" | "player_statement" | "diary_statement"): string {
  const context = diaryContext();
  return compileHouseDiaryProducerEvidence({
    round: context.round,
    phase: context.precedingPhase,
    canonicalHead: context.canonicalHead,
    playerId: context.agentId,
    players: context.players,
    recentMessages: context.recentMessages,
    previousDiaryEntries: context.previousDiaryEntries ?? [],
    playerMessages: context.playerMessages ?? [],
    roundSummary: "fixture",
  }).catalog.find((source) => source.kind === kind)!.alias;
}

function strategyPayload(overrides: Record<string, unknown> = {}): string {
  const statementReceipt = producerAlias("player_statement");
  return JSON.stringify({
    hypotheses: [{
      kind: "alliance_coordination",
      status: "emerging",
      confidence: "medium",
      subjectPlayerIds: [ATLAS],
      relatedPlayerIds: [NYX],
      sourceAliases: [statementReceipt],
    }],
    openQuestions: [{
      kind: "coordination_test",
      subjectPlayerIds: [ATLAS],
      relatedPlayerIds: [NYX],
      sourceAliases: [statementReceipt],
    }],
    interpretation: "The House sees a potentially useful pair.",
    thinking: "Track whether the public signal survives pressure.",
    ...overrides,
  });
}

function assertRecursivelyClosed(schema: unknown): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  const record = schema as Record<string, unknown>;
  if (record.type === "object") expect(record.additionalProperties).toBe(false);
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) child.forEach(assertRecursivelyClosed);
    else assertRecursivelyClosed(child);
  }
}

describe("receipt-backed House producer artifacts", () => {
  it("uses exact recursively closed schemas for all three producer artifacts", () => {
    assertRecursivelyClosed(HOUSE_STRATEGY_BIBLE_SCHEMA);
    assertRecursivelyClosed(HOUSE_LONG_FORM_SUMMARY_SCHEMA);
    assertRecursivelyClosed(HOUSE_PRODUCER_BRIEF_SCHEMA);
  });

  it("keeps producer receipts bound to the same typed source across shifted frontiers", () => {
    const originalBundle = evidenceBundle();
    const original = compileHouseProducerEvidence(originalBundle);
    const statement = original.catalog.find((source) => source.kind === "player_statement")!;
    const roster = original.catalog.find((source) => source.kind === "roster_snapshot")!;

    const shiftedBundle = evidenceBundle();
    shiftedBundle.canonicalHead += 1;
    shiftedBundle.recentTranscript = [{
      ...shiftedBundle.recentTranscript[0]!,
      entrySequence: 3,
      text: "A different accepted statement.",
    }, shiftedBundle.recentTranscript[0]!];
    const shifted = compileHouseProducerEvidence(shiftedBundle);

    expect(shifted.sourceValuesByAlias.get(statement.alias)?.summary).toBe(statement.summary);
    expect(shifted.catalog.find((source) => source.kind === "roster_snapshot")?.alias).not.toBe(roster.alias);
    expect(shifted.sourceValuesByAlias.has(roster.alias)).toBe(false);
  });

  it("rejects malformed accepted producer artifacts against current domain bounds", () => {
    const strategyEvidence = compileHouseProducerEvidence(evidenceBundle());
    const strategy = decodeHouseStrategyBibleProvider(
      JSON.parse(strategyPayload()),
      strategyContext(),
      strategyEvidence,
    );
    if (strategy.status === "invalid" || !strategy.value.packet) throw new Error("strategy fixture invalid");
    const strategyWithExtra = structuredClone(strategy.value);
    (strategyWithExtra.packet!.hypotheses[0] as unknown as Record<string, unknown>).inventedFact = "Atlas promised safety";
    expect(decodeAcceptedHouseStrategyBible(
      strategyWithExtra,
      strategyContext(),
      strategyEvidence,
    ).status).toBe("invalid");

    const gameplay = gameplayContext();
    const claims = Array.from({ length: 9 }, (_, index) => ({
      kind: "game_state" as const,
      sourceAlias: `${producerAlias("roster_snapshot")}-${index}`,
    }));
    const longForm = {
      summary: "invalid",
      kind: gameplay.kind,
      packetRevisionId: null,
      coveredWindow: gameplay.coveredWindow,
      claims,
    };
    expect(decodeAcceptedHouseLongForm(longForm, gameplay, strategyEvidence).status).toBe("invalid");

    const diary = diaryContext();
    const diaryEvidence = compileHouseDiaryProducerEvidence({
      round: diary.round,
      phase: diary.precedingPhase,
      canonicalHead: diary.canonicalHead,
      playerId: diary.agentId,
      players: diary.players,
      recentMessages: diary.recentMessages,
      previousDiaryEntries: diary.previousDiaryEntries ?? [],
      playerMessages: diary.playerMessages ?? [],
      roundSummary: "fixture",
    });
    const brief = decodeHouseProducerBriefProvider({
      focusItems: [{
        kind: "trust",
        subjectPlayerId: ATLAS,
        relatedPlayerIds: [],
        sourceAliases: [diaryProducerAlias("roster_snapshot")],
        confidence: "medium",
        disclosure: "safe_to_reference",
      }],
      questionAngles: [],
      producerNote: null,
      thinking: null,
    }, ATLAS, "Atlas", null, diaryEvidence);
    if (brief.status === "invalid") throw new Error("brief fixture invalid");
    const briefWithExtra = structuredClone(brief.value);
    (briefWithExtra.focusItems[0] as unknown as Record<string, unknown>).inventedFact = "Nyx betrayed Atlas";
    expect(decodeAcceptedHouseProducerBrief(
      briefWithExtra,
      ATLAS,
      "Atlas",
      null,
      diaryEvidence,
    ).status).toBe("invalid");
  });

  it("retries a nested extra field and accepts only the exact Strategy Bible revision", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const attempts: ProviderAttemptRecord[] = [];
    const malformed = JSON.parse(strategyPayload()) as Record<string, unknown>;
    (malformed.hypotheses as Array<Record<string, unknown>>)[0]!.inventedFact = "Atlas promised Nyx safety";
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [JSON.stringify(malformed), strategyPayload()]),
      "test-model",
      { providerExecutionHooks: { onTerminal: (record) => { attempts.push(record); } } },
    );

    const result = await house.updateStrategyBible(strategyContext());

    expect(result.packet).toMatchObject({
      revisionId: "house/v2:9:2:FORMAT_RESOLVE",
      previousRevisionId: null,
      hypotheses: [{ id: "H1", sourceAliases: [producerAlias("player_statement")] }],
      openQuestions: [{ id: "Q1", sourceAliases: [producerAlias("player_statement")] }],
    });
    expect(attempts.map((attempt) => attempt.outcome.kind)).toEqual(["malformed_output", "usable"]);
    expect(requests[0]?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "house_strategy_bible_v2", strict: true },
    });
  });

  it("preserves the prior Strategy Bible byte-for-byte after typed provider exhaustion", async () => {
    const accepted = decodeHouseStrategyBibleProvider(
      JSON.parse(strategyPayload()),
      strategyContext(),
      compileHouseProducerEvidence(evidenceBundle()),
    );
    if (accepted.status === "invalid" || !accepted.value.packet) throw new Error("fixture invalid");
    const previous = accepted.value.packet;
    const before = JSON.stringify(previous);
    const house = new LLMHouseInterviewer(
      makeOpenAIStub([], ["{}"]),
      "test-model",
    );

    const result = await house.updateStrategyBible(strategyContext(previous));

    expect(result.packet).toBe(previous);
    expect(JSON.stringify(result.packet)).toBe(before);
    expect(result.fallback).toMatchObject({ source: "engine", reason: "provider_exhausted" });
  });

  it("rejects unknown receipts, unknown players, and authority-mismatched hypothesis kinds", () => {
    const context = strategyContext();
    const evidence = compileHouseProducerEvidence(context.evidence);
    const unknownReceipt = JSON.parse(strategyPayload()) as Record<string, unknown>;
    (unknownReceipt.hypotheses as Array<Record<string, unknown>>)[0]!.sourceAliases = ["P999"];
    expect(decodeHouseStrategyBibleProvider(unknownReceipt, context, evidence).status).toBe("invalid");
    const unknownPlayer = JSON.parse(strategyPayload()) as Record<string, unknown>;
    (unknownPlayer.hypotheses as Array<Record<string, unknown>>)[0]!.subjectPlayerIds = ["unknown-player"];
    expect(decodeHouseStrategyBibleProvider(unknownPlayer, context, evidence).status).toBe("invalid");
    const wrongAuthority = JSON.parse(strategyPayload()) as Record<string, unknown>;
    Object.assign((wrongAuthority.hypotheses as Array<Record<string, unknown>>)[0]!, {
      kind: "vote_coordination",
      sourceAliases: [producerAlias("player_statement")],
    });
    expect(decodeHouseStrategyBibleProvider(wrongAuthority, context, evidence).status).toBe("invalid");
  });

  it("renders long-form factual copy identically when House analysis contradicts itself", () => {
    const context = gameplayContext();
    const evidence = compileHouseProducerEvidence(context.evidence);
    const common = {
      claims: [
        { kind: "game_state", sourceAlias: producerAlias("roster_snapshot") },
        { kind: "round_outcome", sourceAlias: producerAlias("round_snapshot") },
      ],
      thinking: null,
    };
    const first = decodeHouseLongFormProvider({ ...common, analysis: "Atlas controls everyone." }, context, evidence);
    const second = decodeHouseLongFormProvider({ ...common, analysis: "Atlas controls nobody." }, context, evidence);
    if (first.status === "invalid" || second.status === "invalid") throw new Error("fixture invalid");

    expect(first.value.summary).toBe(second.value.summary);
    expect(first.value.claims).toEqual(second.value.claims);
    expect(first.value.analysis).not.toBe(second.value.analysis);
  });

  it("keeps audience-summary receipts and narrative beats separate on every producer surface", async () => {
    const artifact = audienceSummaryArtifact();
    const parsePrompt = (request: Record<string, unknown>): Record<string, unknown> => {
      const messages = request.messages as Array<{ content: string }>;
      return JSON.parse(messages.at(-1)!.content) as Record<string, unknown>;
    };

    const strategyRequests: Array<Record<string, unknown>> = [];
    const strategyEvidence = evidenceBundle();
    strategyEvidence.audienceSummaryArtifacts = [artifact];
    const strategyHouse = new LLMHouseInterviewer(
      makeOpenAIStub(strategyRequests, [strategyPayload()]),
      "test-model",
    );
    await strategyHouse.updateStrategyBible({
      ...strategyContext(),
      evidence: strategyEvidence,
    });

    const longFormRequests: Array<Record<string, unknown>> = [];
    const longFormEvidence = evidenceBundle();
    longFormEvidence.audienceSummaryArtifacts = [artifact];
    const longFormHouse = new LLMHouseInterviewer(
      makeOpenAIStub(longFormRequests, [JSON.stringify({
        claims: [{ kind: "game_state", sourceAlias: producerAlias("roster_snapshot") }],
        analysis: "Continue the pressure arc.",
        thinking: null,
      })]),
      "test-model",
    );
    await longFormHouse.generateLongFormGameplaySummary({
      ...gameplayContext(),
      evidence: longFormEvidence,
    });

    const briefRequests: Array<Record<string, unknown>> = [];
    const briefContext = diaryContext();
    briefContext.audienceSummaryArtifacts = [artifact];
    const briefHouse = new LLMHouseInterviewer(
      makeOpenAIStub(briefRequests, [JSON.stringify({
        focusItems: [],
        questionAngles: [],
        producerNote: null,
        thinking: null,
      })]),
      "test-model",
    );
    await briefHouse.generateProducerBrief(briefContext, null);

    for (const request of [strategyRequests[0]!, longFormRequests[0]!, briefRequests[0]!]) {
      const payload = parsePrompt(request);
      expect(payload.typedAudienceSummaryContinuity).toEqual([{
        boundary: artifact.boundary,
        claims: artifact.claims,
        sources: artifact.sources,
      }]);
      expect(payload.audienceNarrativeContext).toEqual([{
        boundaryId: artifact.boundary.id,
        authority: "narrative_non_authoritative",
        renderedBeat: artifact.renderedText,
      }]);
      expect(JSON.stringify(payload.producerEvidenceCatalog)).not.toContain(artifact.renderedText);
    }
  });

  it("rejects private receipts labeled safe and omits producer prose from the visible-question prompt", async () => {
    const context = diaryContext();
    const audienceArtifact = audienceSummaryArtifact();
    context.audienceSummaryArtifacts = [audienceArtifact];
    const requests: Array<Record<string, unknown>> = [];
    const privateReceipt = decodeHouseProducerBriefProvider({
      focusItems: [{
        kind: "trust",
        subjectPlayerId: ATLAS,
        relatedPlayerIds: [NYX],
        sourceAliases: [producerAlias("diary_statement")],
        confidence: "medium",
        disclosure: "safe_to_reference",
      }],
      questionAngles: [],
      producerNote: null,
      thinking: null,
    }, ATLAS, "Atlas", null, compileHouseProducerEvidence(evidenceBundle()));
    expect(privateReceipt.status).toBe("invalid");

    const briefPayload = JSON.stringify({
      focusItems: [{
        kind: "trust",
        subjectPlayerId: ATLAS,
        relatedPlayerIds: [NYX],
        sourceAliases: [diaryProducerAlias("player_statement")],
        confidence: "medium",
        disclosure: "safe_to_reference",
      }],
      questionAngles: [{
        kind: "trust_test",
        focusItemIds: ["F1"],
        subjectPlayerId: ATLAS,
        relatedPlayerIds: [NYX],
      }],
      producerNote: "SECRET PRODUCER CLAIM: Nyx is betraying Atlas.",
      thinking: null,
    });
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [briefPayload, "Atlas, how much do you trust Nyx?"]),
      "test-model",
    );
    const brief = await house.generateProducerBrief(context, null);
    context.producerBrief = brief;
    await house.generateQuestion(context);
    const questionMessages = requests[1]?.messages as Array<{ content: string }>;
    const prompt = questionMessages.at(-1)?.content ?? "";
    expect(prompt).toContain("Probe Atlas's trust with Nyx.");
    expect(prompt).not.toContain("SECRET PRODUCER CLAIM");
    expect(prompt).not.toContain("producerNote");
    expect(prompt).toContain("## Accepted House Audience-Summary Lineage");
    expect(prompt).toContain('"sourceAlias":"S1"');
    expect(prompt).toContain("## House Narrative Context (narrative_non_authoritative)");
    expect(prompt).toContain(audienceArtifact.renderedText);
  });
});
