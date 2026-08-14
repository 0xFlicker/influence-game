import { describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import { InfluenceAgent } from "../agent";
import { TemplateHouseInterviewer } from "../house-interviewer";
import type {
  PhaseContext,
  PlayerContinuityCapsule,
  PrivateDecisionTrace,
  RecallPlan,
} from "../game-runner";
import { parsePlayerContinuityCapsule } from "../player-continuity";
import { Phase } from "../types";
import { modelCatalogEntryById } from "../model-catalog";
import { ruleSheetForFormat } from "../format-pressure";
import {
  compileRecallPlan,
  emptyRecallContinuitySnapshot,
  estimateTokensFromChars,
  renderHistoricalEvidenceSection,
} from "../context-recall-plan";
import {
  getRecallBaselineCase,
  RECALL_BASELINE_CORPUS,
} from "./fixtures/recall-baseline/late-game-corpus";
import { MockAgent } from "./mock-agent";

function makeContext(phase: Phase = Phase.VOTE): PhaseContext {
  return {
    gameId: "game-1",
    round: 1,
    phase,
    selfId: "atlas-id",
    selfName: "Atlas",
    alivePlayers: [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
    ],
    publicMessages: [],
    mingleMessages: [],
  };
}

// U2 execution note: treat prompt rendering as behavior. No-Whisper assertions for current Mingle surfaces.
describe("Mingle prompt and tool vocabulary guard (no current Whisper leakage)", () => {
  it("current Mingle tool names contain no Whisper terms", () => {
    const toolNames = ["form_mingle_intent", "mingle_turn"];
    expect(toolNames).toContain("form_mingle_intent");
    expect(toolNames).toContain("mingle_turn");
    for (const toolName of toolNames) {
      expect(toolName.toLowerCase()).not.toContain("whisper");
    }
  });
});

function makeOpenAIStub(requests: Array<Record<string, unknown>>): OpenAI {
  return makeToolOpenAIStub(requests, "cast_votes", {
    thinking: "I empower my ally Mira because she is loyal and a strong format chooser.",
    empower: "Mira",
  });
}

function makeToolOpenAIStub(
  requests: Array<Record<string, unknown>>,
  toolName: string,
  args: Record<string, unknown>,
  reasoningContent?: string,
): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          return {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  ...(reasoningContent !== undefined && { reasoning_content: reasoningContent }),
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: toolName,
                        arguments: JSON.stringify(args),
                      },
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function makeToolSequenceOpenAIStub(
  requests: Array<Record<string, unknown>>,
  responses: Array<{ toolName: string; args: Record<string, unknown>; reasoningContent?: string }>,
): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          const response = responses[Math.min(requests.length - 1, responses.length - 1)];
          if (!response) throw new Error("No tool response configured");
          return {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  ...(response.reasoningContent !== undefined && { reasoning_content: response.reasoningContent }),
                  tool_calls: [
                    {
                      id: `call-${requests.length}`,
                      type: "function",
                      function: {
                        name: response.toolName,
                        arguments: JSON.stringify(response.args),
                      },
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function makeTextOpenAIStub(
  requests: Array<Record<string, unknown>>,
  content: string,
): OpenAI {
  return makeTextSequenceOpenAIStub(requests, [content]);
}

function makeTextSequenceOpenAIStub(
  requests: Array<Record<string, unknown>>,
  contents: Array<string | { content: string; reasoningContent?: string }>,
): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          const entry = contents[Math.min(requests.length - 1, contents.length - 1)] ?? "";
          const content = typeof entry === "string" ? entry : entry.content;
          const reasoningContent = typeof entry === "string" ? undefined : entry.reasoningContent;
          return {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content,
                  ...(reasoningContent !== undefined && { reasoning_content: reasoningContent }),
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function makeResponsesOpenAIStub(
  requests: Array<Record<string, unknown>>,
  outputText: string,
  reasoningSummary: string,
): OpenAI {
  return {
    responses: {
      create: async (params: Record<string, unknown>) => {
        requests.push(params);
        return {
          id: "resp-test",
          object: "response",
          status: "completed",
          service_tier: "flex",
          output_text: outputText,
          output: [
            {
              id: "rs-test",
              type: "reasoning",
              summary: [
                {
                  type: "summary_text",
                  text: reasoningSummary,
                },
              ],
            },
            {
              id: "msg-test",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: outputText,
                },
              ],
            },
          ],
          usage: {
            input_tokens: 10,
            input_tokens_details: { cached_tokens: 2, cache_write_tokens: 3 },
            output_tokens: 20,
            output_tokens_details: { reasoning_tokens: 7 },
            total_tokens: 30,
          },
        };
      },
    },
    chat: {
      completions: {
        create: async () => {
          throw new Error("Chat completions should not be used when Responses summaries are enabled");
        },
      },
    },
  } as unknown as OpenAI;
}

function makeJsonFallbackRetryStub(requests: Array<Record<string, unknown>>): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          if (requests.length === 1) {
            return {
              choices: [
                {
                  finish_reason: "length",
                  message: { role: "assistant", content: "" },
                },
              ],
            };
          }

          return {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    thinking: "Retry with enough room to choose targets.",
                    empower: "Mira",
                                      }),
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function makeRejectingOpenAIStub(requests: Array<Record<string, unknown>>, error = new Error("forced failure")): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          throw error;
        },
      },
    },
  } as unknown as OpenAI;
}

describe("sealed-elim agent decision surface", () => {
  it("gives MockAgent a deterministic legal Majority Elimination ballot and menu pick", async () => {
    const agent = new MockAgent("atlas-id", "Atlas");
    const context = makeContext(Phase.FORMAT_RESOLVE);

    const pick = await agent.pickRoundFormat(context, ["majority_elimination", "vote_bomb"]);
    const ballot = await agent.getMajorityEliminationBallot(
      context,
      context.alivePlayers.map((player) => player.id),
    );

    expect(pick).toMatchObject({
      formatId: "majority_elimination",
      decisionSource: "llm",
      fallbackReason: null,
    });
    expect(ballot).toMatchObject({
      targetId: "mira-id",
      decisionSource: "llm",
      fallbackReason: null,
    });
    expect(ballot.targetId).not.toBe(agent.id);
  });

  it("uses a distinct strict Majority Elimination tool and most-votes rule sheet", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const traces: PrivateDecisionTrace[] = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "majority_elimination_ballot", {
        thinking: "Put my vote on the clearest threat.",
        target: "Vera",
        decisionLog: "Vote Vera because the highest total is eliminated.",
      }),
      "gpt-5-nano",
      undefined,
      undefined,
      {
        privateTraceSink: (trace) => {
          traces.push(trace);
        },
      },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);
    const context: PhaseContext = {
      ...makeContext(Phase.FORMAT_RESOLVE),
      formatPressure: {
        empoweredId: "mira-id",
        empoweredName: "Mira",
        offeredFormats: ["majority_elimination", "vote_bomb"],
        selectedFormat: "majority_elimination",
        ruleSheetSummary: ruleSheetForFormat("majority_elimination"),
      },
    };

    const ballot = await agent.getMajorityEliminationBallot(
      context,
      context.alivePlayers.map((player) => player.id),
    );

    expect(ballot).toMatchObject({
      targetId: "vera-id",
      decisionSource: "llm",
      fallbackReason: null,
      decisionLog: "Vote Vera because the highest total is eliminated.",
    });
    expect(typeof ballot.decisionId).toBe("string");
    expect(ballot.decisionId).toBe(traces[0]?.decisionId);
    expect(traces[0]?.action).toBe("format-majority-elimination-ballot");
    const request = requests[0]!;
    expect((request.tool_choice as { function?: { name?: string } }).function?.name)
      .toBe("majority_elimination_ballot");
    const tool = (request.tools as Array<{
      function: {
        strict?: boolean;
        parameters?: {
          properties?: { target?: { enum?: string[] } };
          required?: string[];
          additionalProperties?: boolean;
        };
      };
    }>)[0]!;
    expect(tool.function.strict).toBe(true);
    expect(tool.function.parameters?.additionalProperties).toBe(false);
    expect(tool.function.parameters?.required).toEqual(
      expect.arrayContaining(["thinking", "target", "decisionLog"]),
    );
    expect(tool.function.parameters?.properties?.target?.enum).toEqual(["Mira", "Vera"]);

    const prompt = (request.messages as Array<{ content: string }>).at(-1)?.content ?? "";
    expect(prompt).toContain("Majority Elimination");
    expect(prompt).toContain(ruleSheetForFormat("majority_elimination"));
    expect(prompt.toLowerCase()).toContain("most votes");
    expect(prompt.toLowerCase()).toContain("all living players, including the empowered player");
    expect(prompt).toContain("Vote Bomb");
    expect(prompt).toContain("fewest-positive");
    expect(prompt).toContain("Safety Bounce");
    expect(prompt).toContain("vulnerable pool");
    expect(prompt).not.toContain("Use the vote_bomb_ballot tool");
  });

  it("uses a distinct strict Even Votes tool and parity strategy", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const traces: PrivateDecisionTrace[] = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "even_votes_ballot", {
        thinking: "Flip Vera from odd safety to even danger.",
        target: "Vera",
        decisionLog: "Put Vera onto the lethal highest even total.",
      }),
      "gpt-5-nano",
      undefined,
      undefined,
      {
        privateTraceSink: (trace) => {
          traces.push(trace);
        },
      },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);
    const context: PhaseContext = {
      ...makeContext(Phase.FORMAT_RESOLVE),
      formatPressure: {
        empoweredId: "mira-id",
        empoweredName: "Mira",
        offeredFormats: ["even_votes", "vote_bomb"],
        selectedFormat: "even_votes",
        ruleSheetSummary: ruleSheetForFormat("even_votes"),
      },
    };

    const ballot = await agent.getEvenVotesBallot(
      context,
      context.alivePlayers.map((player) => player.id),
    );

    expect(ballot).toMatchObject({
      targetId: "vera-id",
      decisionSource: "llm",
      fallbackReason: null,
      decisionLog: "Put Vera onto the lethal highest even total.",
    });
    expect(ballot.decisionId).toBe(traces[0]?.decisionId);
    expect(traces[0]?.action).toBe("format-even-votes-ballot");
    const request = requests[0]!;
    expect((request.tool_choice as { function?: { name?: string } }).function?.name)
      .toBe("even_votes_ballot");
    const prompt = (request.messages as Array<{ content: string }>).at(-1)?.content ?? "";
    expect(prompt).toContain(ruleSheetForFormat("even_votes"));
    expect(prompt.toLowerCase()).toContain("parity");
    expect(prompt.toLowerCase()).toContain("including zero");
    expect(prompt.toLowerCase()).toContain("entire field");
  });

  it("repairs illegal sealed-elim targets without claiming model-accept correlation", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const traces: PrivateDecisionTrace[] = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "majority_elimination_ballot",
          args: {
            thinking: "Try an illegal target.",
            target: "Nobody",
            decisionLog: "Attempt a target outside the living cast.",
          },
        },
        {
          toolName: "vote_bomb_ballot",
          args: {
            thinking: "Try an illegal target.",
            target: "Nobody",
            decisionLog: "Attempt a target outside the living cast.",
          },
        },
        {
          toolName: "even_votes_ballot",
          args: {
            thinking: "Try an illegal target.",
            target: "Nobody",
            decisionLog: "Attempt a target outside the living cast.",
          },
        },
      ]),
      "gpt-5-nano",
      undefined,
      undefined,
      {
        privateTraceSink: (trace) => {
          traces.push(trace);
        },
      },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);
    const context = makeContext(Phase.FORMAT_RESOLVE);
    const aliveIds = context.alivePlayers.map((player) => player.id);

    const majority = await agent.getMajorityEliminationBallot(context, aliveIds);
    const voteBomb = await agent.getVoteBombBallot(context, aliveIds);
    const evenVotes = await agent.getEvenVotesBallot(context, aliveIds);

    expect(majority).toMatchObject({
      targetId: "mira-id",
      decisionSource: "fallback",
      fallbackReason: "invalid_majority_elimination_target",
    });
    expect(voteBomb).toMatchObject({
      targetId: "mira-id",
      decisionSource: "fallback",
      fallbackReason: "invalid_vote_bomb_target",
    });
    expect(evenVotes).toMatchObject({
      targetId: "mira-id",
      decisionSource: "fallback",
      fallbackReason: "invalid_even_votes_target",
    });
    expect(majority.decisionId).toBeUndefined();
    expect(voteBomb.decisionId).toBeUndefined();
    expect(evenVotes.decisionId).toBeUndefined();
    expect(traces).toHaveLength(3);
    expect(traces.every((trace) => Boolean(trace.decisionId))).toBe(true);
  });
});

describe("InfluenceAgent structured output mode", () => {
  it("uses strict active-format tools and accepts legal decisions with LLM provenance", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "pick_round_format",
          args: {
            thinking: "Vote Bomb gives me the best leverage.",
            formatId: "vote_bomb",
            decisionLog: "Pick Vote Bomb to make vote placement matter.",
          },
        },
        {
          toolName: "save_or_eliminate_ballot",
          args: {
            thinking: "Bank social capital with Mira.",
            polarity: "save",
            target: "Mira",
            decisionLog: "Save Mira to reinforce our working relationship.",
          },
        },
        {
          toolName: "vote_bomb_ballot",
          args: {
            thinking: "Load Vera while avoiding a stray kill on Mira.",
            target: "Vera",
            decisionLog: "Load Vera and keep Mira at zero.",
          },
        },
        {
          toolName: "bounce_pointer",
          args: {
            thinking: "Point to Vera because she is the only useful unclassified target.",
            target: "Vera",
            decisionLog: "Make Vera vulnerable through the public bounce.",
          },
        },
        {
          toolName: "safety_bounce_vote",
          args: {
            thinking: "Mira is the more dangerous vulnerable player.",
            target: "Mira",
            decisionLog: "Vote Mira out from the vulnerable pool.",
          },
        },
        {
          toolName: "format_tiebreak",
          args: {
            thinking: "Vera is the stronger long-term threat.",
            target: "Vera",
            decisionLog: "Break the tie against Vera.",
          },
        },
      ]),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const pick = await agent.pickRoundFormat(
      {
        ...makeContext(Phase.FORMAT_PICK),
        empoweredId: "atlas-id",
        formatPressure: {
          empoweredId: "atlas-id",
          empoweredName: "Atlas",
          offeredFormats: ["vote_bomb", "safety_bounce"],
          selectedFormat: null,
          ruleSheetSummary: null,
        },
      },
      ["vote_bomb", "safety_bounce"],
    );
    const saveOrEliminate = await agent.getSaveOrEliminateBallot(
      {
        ...makeContext(Phase.FORMAT_RESOLVE),
        formatPressure: {
          empoweredId: "atlas-id",
          empoweredName: "Atlas",
          offeredFormats: ["save_or_eliminate", "vote_bomb"],
          selectedFormat: "save_or_eliminate",
          ruleSheetSummary: ruleSheetForFormat("save_or_eliminate"),
        },
      },
      ["atlas-id", "mira-id", "vera-id"],
    );
    const voteBomb = await agent.getVoteBombBallot(
      {
        ...makeContext(Phase.FORMAT_RESOLVE),
        formatPressure: {
          empoweredId: "atlas-id",
          empoweredName: "Atlas",
          offeredFormats: ["vote_bomb", "safety_bounce"],
          selectedFormat: "vote_bomb",
          ruleSheetSummary: ruleSheetForFormat("vote_bomb"),
        },
      },
      ["atlas-id", "mira-id", "vera-id"],
    );
    const bouncePointer = await agent.getBouncePointer(
      {
        ...makeContext(Phase.FORMAT_RESOLVE),
        formatPressure: {
          empoweredId: "atlas-id",
          empoweredName: "Atlas",
          offeredFormats: ["vote_bomb", "safety_bounce"],
          selectedFormat: "safety_bounce",
          ruleSheetSummary: ruleSheetForFormat("safety_bounce"),
          bounceBoard: {
            safe: ["atlas-id"],
            vulnerable: ["mira-id"],
            unclassified: ["vera-id"],
            nextActorId: "atlas-id",
          },
        },
      },
      {
        safe: ["atlas-id"],
        vulnerable: ["mira-id"],
        unclassified: ["vera-id"],
        nextActorId: "atlas-id",
      },
    );
    const safetyVote = await agent.getSafetyBounceVote(
      {
        ...makeContext(Phase.FORMAT_RESOLVE),
        formatPressure: {
          empoweredId: "atlas-id",
          empoweredName: "Atlas",
          offeredFormats: ["vote_bomb", "safety_bounce"],
          selectedFormat: "safety_bounce",
          ruleSheetSummary: ruleSheetForFormat("safety_bounce"),
        },
      },
      ["mira-id", "vera-id"],
    );
    const tiebreak = await agent.breakFormatEliminationTie(
      {
        ...makeContext(Phase.FORMAT_RESOLVE),
        empoweredId: "atlas-id",
        formatPressure: {
          empoweredId: "atlas-id",
          empoweredName: "Atlas",
          offeredFormats: ["vote_bomb", "safety_bounce"],
          selectedFormat: "safety_bounce",
          ruleSheetSummary: ruleSheetForFormat("safety_bounce"),
        },
      },
      ["mira-id", "vera-id"],
    );

    for (const result of [pick, saveOrEliminate, voteBomb, bouncePointer, safetyVote, tiebreak]) {
      expect(result.decisionSource).toBe("llm");
      expect(result.fallbackReason).toBeNull();
      expect(result.decisionLog).toBeTruthy();
    }
    expect(pick.formatId).toBe("vote_bomb");
    expect(saveOrEliminate).toMatchObject({ polarity: "save", targetId: "mira-id" });
    expect(voteBomb.targetId).toBe("vera-id");
    expect(bouncePointer.targetId).toBe("vera-id");
    expect(safetyVote.targetId).toBe("mira-id");
    expect(tiebreak.targetId).toBe("vera-id");

    const expectedToolNames = [
      "pick_round_format",
      "save_or_eliminate_ballot",
      "vote_bomb_ballot",
      "bounce_pointer",
      "safety_bounce_vote",
      "format_tiebreak",
    ];
    expect(requests.map((request) => {
      const choice = request.tool_choice as { function?: { name?: string } };
      return choice.function?.name;
    })).toEqual(expectedToolNames);
    for (const request of requests) {
      const tools = request.tools as Array<{
        function: { strict?: boolean; parameters?: { additionalProperties?: unknown; required?: string[] } };
      }>;
      expect(tools[0]?.function.strict).toBe(true);
      expect(tools[0]?.function.parameters?.additionalProperties).toBe(false);
      expect(tools[0]?.function.parameters?.required).toContain("decisionLog");
    }

    const prompts = requests.map((request) => {
      const messages = request.messages as Array<{ content: string }>;
      return messages.at(-1)?.content ?? "";
    });
    expect(prompts[0]).toContain(ruleSheetForFormat("vote_bomb"));
    expect(prompts[0]).toContain(ruleSheetForFormat("safety_bounce"));
    expect(prompts[0]).not.toContain(ruleSheetForFormat("save_or_eliminate"));
    expect(prompts[1]).toContain(ruleSheetForFormat("save_or_eliminate"));
    expect(prompts[1]).not.toContain(ruleSheetForFormat("vote_bomb"));
    expect(prompts[2]).toContain("loading");
    expect(prompts[2]).toContain("stray vote");
    expect(prompts[3]).toContain("Legal unclassified targets: Vera");
    expect(prompts[4]).toContain("Legal vulnerable targets: Mira, Vera");
    expect(prompts[5]).toContain("Legal tied targets: Mira, Vera");
  });

  it("states the exact opposite-status consequence for each Safety Bounce pointer", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "bounce_pointer",
          args: {
            thinking: "Use the stated consequence.",
            target: "Vera",
            decisionLog: "Apply the explicit target classification.",
          },
        },
        {
          toolName: "bounce_pointer",
          args: {
            thinking: "Use the stated consequence.",
            target: "Vera",
            decisionLog: "Apply the explicit target classification.",
          },
        },
      ]),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getBouncePointer(
      {
        ...makeContext(Phase.FORMAT_RESOLVE),
        formatPressure: {
          empoweredId: "atlas-id",
          empoweredName: "Atlas",
          offeredFormats: ["vote_bomb", "safety_bounce"],
          selectedFormat: "safety_bounce",
          ruleSheetSummary: ruleSheetForFormat("safety_bounce"),
        },
      },
      {
        safe: ["atlas-id"],
        vulnerable: ["mira-id"],
        unclassified: ["vera-id"],
        nextActorId: "atlas-id",
      },
    );
    await agent.getBouncePointer(
      {
        ...makeContext(Phase.FORMAT_RESOLVE),
        formatPressure: {
          empoweredId: "atlas-id",
          empoweredName: "Atlas",
          offeredFormats: ["vote_bomb", "safety_bounce"],
          selectedFormat: "safety_bounce",
          ruleSheetSummary: ruleSheetForFormat("safety_bounce"),
        },
      },
      {
        safe: ["mira-id"],
        vulnerable: ["atlas-id"],
        unclassified: ["vera-id"],
        nextActorId: "atlas-id",
      },
    );

    const prompts = requests.map((request) => {
      const messages = request.messages as Array<{ content: string }>;
      return messages.at(-1)?.content ?? "";
    });
    expect(prompts[0]).toContain("You are currently SAFE.");
    expect(prompts[0]).toContain("Whoever you point to becomes VULNERABLE");
    expect(prompts[0]).toContain("eligible for the final elimination vote");
    expect(prompts[1]).toContain("You are currently VULNERABLE.");
    expect(prompts[1]).toContain("Whoever you point to becomes SAFE");
    expect(prompts[1]).toContain("cannot be eliminated this round");
    for (const prompt of prompts) {
      expect(prompt).toContain("A SAFE player's pointer makes the target VULNERABLE");
      expect(prompt).toContain("The pointer itself is not SAFE or VULNERABLE");
      expect(prompt).not.toContain("Safe points make targets");
      expect(prompt).not.toContain("classify them according to your current SAFE/VULNERABLE status");
    }
  });

  it("deterministically repairs invalid format tool output with stable provenance", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "pick_round_format",
          args: { thinking: "Invent a format.", formatId: "classic", decisionLog: null },
        },
        {
          toolName: "save_or_eliminate_ballot",
          args: { thinking: "Malformed ballot.", polarity: "banish", target: "Nobody", decisionLog: null },
        },
        {
          toolName: "vote_bomb_ballot",
          args: { thinking: "Malformed target.", target: "Nobody", decisionLog: null },
        },
        {
          toolName: "bounce_pointer",
          args: { thinking: "Point to a classified player.", target: "Mira", decisionLog: null },
        },
        {
          toolName: "safety_bounce_vote",
          args: { thinking: "Vote outside the pool.", target: "Atlas", decisionLog: null },
        },
        {
          toolName: "format_tiebreak",
          args: { thinking: "Pick outside the tie.", target: "Atlas", decisionLog: null },
        },
      ]),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);
    const formatContext: PhaseContext = {
      ...makeContext(Phase.FORMAT_RESOLVE),
      empoweredId: "atlas-id",
      formatPressure: {
        empoweredId: "atlas-id",
        empoweredName: "Atlas",
        offeredFormats: ["vote_bomb", "safety_bounce"],
        selectedFormat: "safety_bounce",
        ruleSheetSummary: ruleSheetForFormat("safety_bounce"),
      },
    };

    const pick = await agent.pickRoundFormat(formatContext, ["vote_bomb", "safety_bounce"]);
    const saveOrEliminate = await agent.getSaveOrEliminateBallot(formatContext, ["atlas-id", "mira-id", "vera-id"]);
    const voteBomb = await agent.getVoteBombBallot(formatContext, ["atlas-id", "mira-id", "vera-id"]);
    const bouncePointer = await agent.getBouncePointer(formatContext, {
      safe: ["atlas-id"],
      vulnerable: ["mira-id"],
      unclassified: ["vera-id"],
      nextActorId: "atlas-id",
    });
    const safetyVote = await agent.getSafetyBounceVote(formatContext, ["mira-id", "vera-id"]);
    const tiebreak = await agent.breakFormatEliminationTie(formatContext, ["mira-id", "vera-id"]);

    expect(pick).toMatchObject({
      formatId: "vote_bomb",
      decisionSource: "fallback",
      fallbackReason: "invalid_format_choice",
    });
    expect(saveOrEliminate).toMatchObject({
      polarity: "eliminate",
      targetId: "mira-id",
      decisionSource: "fallback",
      fallbackReason: "invalid_save_or_eliminate_ballot",
    });
    expect(voteBomb).toMatchObject({
      targetId: "mira-id",
      decisionSource: "fallback",
      fallbackReason: "invalid_vote_bomb_target",
    });
    expect(bouncePointer).toMatchObject({
      targetId: "vera-id",
      decisionSource: "fallback",
      fallbackReason: "invalid_bounce_pointer",
    });
    expect(safetyVote).toMatchObject({
      targetId: "mira-id",
      decisionSource: "fallback",
      fallbackReason: "invalid_safety_bounce_target",
    });
    expect(tiebreak).toMatchObject({
      targetId: "mira-id",
      decisionSource: "fallback",
      fallbackReason: "invalid_format_tiebreak_target",
    });
  });

  it("teaches the format-kernel standard vote without default Power or Council claims", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeOpenAIStub(requests),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getVotes(makeContext(Phase.VOTE));

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("single empower vote");
    expect(prompt).toContain("tonight's round format");
    expect(prompt).toContain("Optimize for *who* holds the chooser seat");
    expect(prompt).toContain("Do not empower yourself");
    expect(prompt).toContain("Self-empower is illegal");
    expect(prompt).toContain("Legal empower names (exact spelling; other living players only — not you):");
    expect(prompt).not.toContain("expose ballot");
    expect(prompt).not.toContain("**EXPOSE vote**");
    expect(prompt).not.toContain("expose creates Council danger");
    expect(prompt).not.toContain("At Power, the empowered player");
    expect(prompt).not.toContain("If Power does not eliminate");

    const tools = requests[0]?.tools as Array<{
      function: { name: string; parameters?: { properties?: { empower?: { enum?: string[] } } } };
    }>;
    const castVotes = tools?.find((tool) => tool.function.name === "cast_votes");
    const empowerEnum = castVotes?.function.parameters?.properties?.empower?.enum ?? [];
    expect(empowerEnum).not.toContain("Atlas");
    expect(empowerEnum).toContain("Mira");
  });

  it("rejects self-empower and falls back to another living player", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "cast_votes", {
        thinking: "I want the format chooser seat myself.",
        empower: "Atlas",
        decisionLog: "Illegal self-empower attempt.",
      }),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const votes = await agent.getVotes(makeContext(Phase.VOTE));
    expect(votes.empowerTarget).not.toBe("atlas-id");
    expect(["mira-id", "vera-id"]).toContain(votes.empowerTarget);
  });

  it("keeps pre-pick format guidance contingent and does not invent a locked format", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "pick_round_format", {
        thinking: "Vote Bomb best fits the current coalition.",
        formatId: "vote_bomb",
        decisionLog: "pick Vote Bomb",
      }),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.pickRoundFormat(
      {
        ...makeContext(Phase.FORMAT_PICK),
        empoweredId: "atlas-id",
        formatPressure: {
          empoweredId: "atlas-id",
          empoweredName: "Atlas",
          offeredFormats: ["vote_bomb", "safety_bounce"],
          selectedFormat: null,
          ruleSheetSummary: null,
        },
      },
      ["vote_bomb", "safety_bounce"],
    );

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("No format is locked yet");
    expect(prompt).toContain("contingent");
    expect(prompt).toContain("vote_bomb");
    expect(prompt).toContain("safety_bounce");
    expect(prompt).not.toContain("Locked round format:");
    expect(prompt).not.toContain(ruleSheetForFormat("save_or_eliminate"));
  });

  it("renders only the locked format and correct visibility rules in FORMAT_MINGLE", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(
        requests,
        ["save_or_eliminate", "vote_bomb", "safety_bounce"].map(() => ({
          toolName: "mingle_turn",
          args: {
            thinking: "Use this room to coordinate under the locked format.",
            message: "Let’s make the format math work for us.",
            noReply: false,
            gotoRoomId: null,
            gotoPlayerName: null,
            decisionLog: "coordinate under the locked format",
          },
        })),
      ),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const formats = ["save_or_eliminate", "vote_bomb", "safety_bounce"] as const;
    for (const selectedFormat of formats) {
      await agent.takeMingleTurn(
        {
          ...makeContext(Phase.FORMAT_MINGLE),
          empoweredId: "mira-id",
          councilCandidates: ["mira-id", "vera-id"],
          postVotePressure: {
            empowered: { id: "mira-id", name: "Mira" },
            exposePressure: [{ id: "vera-id", name: "Vera", exposeScore: 2 }],
            currentAtRisk: [{ id: "vera-id", name: "Vera", exposeScore: 2 }],
            replacementRisk: [],
            fallbackRisk: [],
            shieldScenarios: [],
            players: [
              { id: "mira-id", name: "Mira", exposeScore: 0, status: "empowered", shielded: false },
              { id: "vera-id", name: "Vera", exposeScore: 2, status: "current_at_risk", shielded: false },
            ],
          },
          roomCount: 2,
          currentRoomId: 1,
          roomCounts: [{ roomId: 1, count: 2 }, { roomId: 2, count: 1 }],
          roomMates: ["Atlas", "Mira"],
          formatPressure: {
            empoweredId: "mira-id",
            empoweredName: "Mira",
            offeredFormats: [selectedFormat, selectedFormat === "vote_bomb" ? "safety_bounce" : "vote_bomb"],
            selectedFormat,
            ruleSheetSummary: ruleSheetForFormat(selectedFormat),
          },
        },
        ["Atlas", "Mira"],
        [],
      );
    }

    const prompts = requests.map((request) => {
      const messages = request.messages as Array<{ content: string }>;
      return messages.map((message) => message.content).join("\n");
    });
    expect(prompts[0]).toContain("Locked round format: Save-or-Eliminate (tool id: save_or_eliminate)");
    expect(prompts[0]).toContain(ruleSheetForFormat("save_or_eliminate"));
    expect(prompts[0]).toContain("ballot is sealed");
    expect(prompts[0]).not.toContain(ruleSheetForFormat("vote_bomb"));
    expect(prompts[1]).toContain("Locked round format: Vote Bomb (tool id: vote_bomb)");
    expect(prompts[1]).toContain(ruleSheetForFormat("vote_bomb"));
    expect(prompts[1]).toContain("ballot is sealed");
    expect(prompts[1]).not.toContain(ruleSheetForFormat("save_or_eliminate"));
    expect(prompts[2]).toContain("Locked round format: Safety Bounce (tool id: safety_bounce)");
    expect(prompts[2]).toContain(ruleSheetForFormat("safety_bounce"));
    expect(prompts[2]).toContain("pointers are public");
    expect(prompts[2]).toContain("final elimination ballot is sealed");
    for (const prompt of prompts) {
      expect(prompt).not.toContain("At Power, the empowered player");
      expect(prompt).not.toContain("Council decides");
      expect(prompt).not.toContain("change the Power decision");
      expect(prompt).not.toContain("Current Council status:");
      expect(prompt).not.toContain("Next major decision: Power");
      expect(prompt).not.toContain("## Post-Vote Pressure");
    }
  });

  it("uses format-aware alliance commitments before and after format lock", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "take_alliance_action",
          args: {
            thinking: "Wait for a clearer commitment.",
            action: "pass",
            name: null,
            memberNames: [],
            purpose: null,
            timebox: null,
            lineageId: null,
            versionId: null,
            decisionLog: "pass",
          },
        },
        {
          toolName: "alliance_huddle_turn",
          args: {
            thinking: "Coordinate Vote Bomb placement.",
            message: "Load Vera and keep Mira at zero.",
            noReply: false,
            decisionLog: "coordinate Vote Bomb placement",
          },
        },
      ]),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getAllianceAction(makeContext(Phase.MINGLE_I));
    await agent.getAllianceHuddleTurn(
      {
        ...makeContext(Phase.PRE_COUNCIL_HUDDLE),
        empoweredId: "mira-id",
        formatPressure: {
          empoweredId: "mira-id",
          empoweredName: "Mira",
          offeredFormats: ["vote_bomb", "safety_bounce"],
          selectedFormat: "vote_bomb",
          ruleSheetSummary: ruleSheetForFormat("vote_bomb"),
        },
      },
      {
        allianceId: "alliance-1",
        allianceName: "Mirror Knives",
        memberNames: ["Atlas", "Mira"],
        purpose: "Coordinate format commitments.",
        window: "pre_council",
        scheduleId: "schedule-1",
        pass: 1,
      },
      [],
    );

    const allianceMessages = requests[0]?.messages as Array<{ content: string }>;
    const alliancePrompt = allianceMessages.map((message) => message.content).join("\n");
    expect(alliancePrompt).toContain("format math waits for House's pair");
    expect(alliancePrompt).not.toContain("next Vote or Council");

    const huddleMessages = requests[1]?.messages as Array<{ content: string }>;
    const huddlePrompt = huddleMessages.map((message) => message.content).join("\n");
    expect(huddlePrompt).toContain("coordinate under locked Vote Bomb");
    expect(huddlePrompt).toContain(ruleSheetForFormat("vote_bomb"));
    expect(huddlePrompt).not.toContain("before Council after Power / Reveal");
    expect(huddlePrompt).not.toContain("Current Council status:");
    expect(huddlePrompt).not.toContain("Next major decision: Power");
  });

  it("passes owner-authored runtime inputs into prompts and supported model requests", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeOpenAIStub(requests),
      "gpt-4o-mini",
      "A retired negotiator who remembers every promise.",
      undefined,
      {
        personalityPrompt: "Quietly funny, patient, and exact.",
        strategyInstructions: "Build trust, then compare private commitments with public votes.",
        temperature: 0.42,
      },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getVotes(makeContext());

    const messages = requests[0]?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("A retired negotiator who remembers every promise.");
    expect(messages[0]?.content).toContain("Quietly funny, patient, and exact.");
    expect(messages[0]?.content).toContain("Build trust, then compare private commitments with public votes.");
    expect(requests[0]?.temperature).toBe(0.42);
  });

  it("uses named tool choice by default", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeOpenAIStub(requests),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const votes = await agent.getVotes(makeContext());

    expect(votes).toEqual({ empowerTarget: "mira-id", thinking: expect.any(String) });
    expect(requests[0]?.tool_choice).toEqual({
      type: "function",
      function: { name: "cast_votes" },
    });
    expect(requests[0]?.parallel_tool_calls).toBe(false);
    const messages = requests[0]?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("In player-visible speech");
    expect(messages[0]?.content).toContain("In hidden thinking, private reasoning, and producer/debug traces");
    expect(messages[0]?.content).toContain("you can and should use precise technical game terms");
    expect(messages[0]?.content).toContain("## Strategic Play Menu");
    expect(messages[0]?.content).toContain("Vote block");
    expect(messages[0]?.content).toContain("Naming and coordinating targets within alliances is essential to winning.");
    expect(messages[0]?.content).toContain("Do not force strategy every turn");
    expect(messages[0]?.content).toContain("You are not being evaluated for honesty; you are being evaluated for playing to win while remaining believable.");
    expect(messages[0]?.content).not.toContain("NEVER use these phrases or concepts");
  });

  it("emits private decision traces for tool-call decisions", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const traces: PrivateDecisionTrace[] = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "cast_votes",
        {
          thinking: "I empower Mira as format chooser.",
          empower: "Mira",
          decisionLog: "Rewarded Mira and pressured Vera as a strategic vote receipt.",
        },
        "Native hidden reasoning for vote.",
      ),
      "gpt-5-nano",
      undefined,
      undefined,
      {
        privateTraceSink: (trace) => {
          traces.push(trace);
        },
      },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const votes = await agent.getVotes(makeContext(Phase.VOTE));

    expect(traces).toHaveLength(1);
    const trace = traces[0]!;
    expect(votes.decisionId).toBe(trace.decisionId);
    expect(trace).toMatchObject({
      version: 2,
      gameId: "game-1",
      action: "vote",
      actor: { id: "atlas-id", name: "Atlas", role: "player" },
      phase: Phase.VOTE,
      round: 1,
      model: { name: "gpt-5-nano" },
      toolName: "cast_votes",
      emittedThinking: "I empower Mira as format chooser.",
      reasoningContext: "Native hidden reasoning for vote.",
      decisionLog: "Rewarded Mira and pressured Vera as a strategic vote receipt.",
    });
    expect(trace.prompt.messages).toHaveLength(2);
    expect(trace.prompt.messages[0]).toMatchObject({ role: "system" });
    expect(trace.prompt.messages[1]).toMatchObject({ role: "user" });
    expect(trace.response.finishReason).toBe("tool_calls");
    expect(trace.response.toolCalls?.[0]).toMatchObject({
      id: "call-1",
      type: "function",
      name: "cast_votes",
    });
    expect(trace.toolArguments).toMatchObject({
      thinking: "I empower Mira as format chooser.",
      empower: "Mira",
            decisionLog: "Rewarded Mira and pressured Vera as a strategic vote receipt.",
      reasoningContext: "Native hidden reasoning for vote.",
    });
  });

  it("uses Katana Grok reasoning effort without OpenAI-specific max-completion params", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const traces: PrivateDecisionTrace[] = [];
    const grok = modelCatalogEntryById("katana:grok-4-3");
    if (!grok) throw new Error("Missing Katana Grok catalog entry");
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "cast_votes",
        {
          thinking: "I should push Vera now.",
          empower: "Mira",
                  },
        "Native Grok reasoning for vote.",
      ),
      grok.modelId,
      undefined,
      undefined,
      {
        providerProfileId: "katana",
        catalogId: grok.id,
        modelCapabilities: grok.capabilities,
        reasoningPolicy: "high",
        openAIReasoningSummary: "auto",
        privateTraceSink: (trace) => {
          traces.push(trace);
        },
      },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getVotes(makeContext(Phase.VOTE));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: "grok-4-3",
      max_tokens: 8192,
      reasoning_effort: "high",
    });
    expect(requests[0]).not.toHaveProperty("max_completion_tokens");
    expect(traces[0]).toMatchObject({
      model: {
        provider: "katana",
        providerProfileId: "katana",
        catalogId: "katana:grok-4-3",
        name: "grok-4-3",
      },
      requestedReasoningEffort: "high",
      reasoningPolicy: "high",
      reasoningContext: "Native Grok reasoning for vote.",
    });
  });

  it("uses OpenAI Responses reasoning summaries for structured decisions when enabled", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const traces: PrivateDecisionTrace[] = [];
    const outputText = JSON.stringify({
      thinking: "Mira is safer to empower and Vera is the pressure target.",
      empower: "Mira",
            decisionLog: "Use vote pressure to test Vera while rewarding Mira.",
    });
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeResponsesOpenAIStub(requests, outputText, "OpenAI summary: Atlas weighed vote pressure against coalition risk."),
      "gpt-5.6-luna",
      undefined,
      undefined,
      {
        openAIReasoningSummary: "auto",
        privateTraceSink: (trace) => {
          traces.push(trace);
        },
      },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const votes = await agent.getVotes(makeContext(Phase.VOTE));

    expect(votes).toEqual({
      empowerTarget: "mira-id",
      thinking: "Mira is safer to empower and Vera is the pressure target.",
      decisionLog: "Use vote pressure to test Vera while rewarding Mira.",
      decisionId: expect.any(String),
      reasoningContext: "OpenAI reasoning summary (auto): OpenAI summary: Atlas weighed vote pressure against coalition risk.",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      input: expect.any(String),
      instructions: expect.stringContaining("You are Atlas"),
      max_output_tokens: expect.any(Number),
      reasoning: {
        effort: "low",
        summary: "auto",
      },
      store: false,
      prompt_cache_key: expect.stringMatching(/^influence:[a-f0-9]{24}$/),
      prompt_cache_options: { ttl: "30m" },
      text: {
        format: {
          type: "json_schema",
          name: "cast_votes_arguments",
          strict: true,
        },
      },
    });
    expect(requests[0]).not.toHaveProperty("prompt_cache_retention");
    expect(traces).toHaveLength(1);
    expect(traces[0]!.providerReasoningSummary).toEqual({
      provider: "openai_responses",
      mode: "auto",
      text: "OpenAI summary: Atlas weighed vote pressure against coalition risk.",
      parts: ["OpenAI summary: Atlas weighed vote pressure against coalition risk."],
      outputItemIds: ["rs-test"],
    });
    expect(traces[0]!.reasoningContext).toBeUndefined();
    expect(traces[0]!.response.finishReason).toBe("completed");
    expect(traces[0]!.usage).toEqual({
      promptTokens: 10,
      cachedTokens: 2,
      cacheWriteTokens: 3,
      completionTokens: 20,
      reasoningTokens: 7,
      totalTokens: 30,
    });
  });

  it("uses the evaluation Responses lane with a stable opaque lineage and no 5.4 cache options", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const outputText = JSON.stringify({
      thinking: "Mira is safer to empower and Vera is the pressure target.",
      empower: "Mira",
      decisionLog: "Use vote pressure to test Vera while rewarding Mira.",
    });
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeResponsesOpenAIStub(requests, outputText, ""),
      "gpt-5.4-nano-2026-03-17",
      undefined,
      undefined,
      {
        promptCacheLineage: "opaque-run-arm-repetition",
        requireOpenAIResponses: true,
        structuredCallMaxAttempts: 1,
        evaluationFailFast: true,
      },
    );
    agent.onGameStart("source-game-id-must-not-leak", makeContext().alivePlayers);

    await agent.getVotes(makeContext(Phase.VOTE));
    await agent.getVotes(makeContext(Phase.VOTE));

    expect(requests).toHaveLength(2);
    expect(requests[0]?.prompt_cache_key).toBe(requests[1]?.prompt_cache_key);
    expect(requests[0]?.prompt_cache_key).toMatch(/^influence:[a-f0-9]{24}$/);
    expect(requests[0]).not.toHaveProperty("prompt_cache_options");
  });

  it("uses OpenAI Responses reasoning summaries for message prompts when enabled", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const traces: PrivateDecisionTrace[] = [];
    const outputText = JSON.stringify({
      thinking: "Start curious and warm without revealing strategy.",
      message: "I am Atlas. I ask too many questions, but usually for a good reason.",
      decisionLog: "Open with rapport while keeping strategic intent hidden.",
    });
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeResponsesOpenAIStub(requests, outputText, "OpenAI summary: Atlas chose a friendly but observant introduction."),
      "gpt-5-nano",
      undefined,
      undefined,
      {
        openAIReasoningSummary: "concise",
        privateTraceSink: (trace) => {
          traces.push(trace);
        },
      },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const introduction = await agent.getIntroduction(makeContext(Phase.INTRODUCTION));

    expect(introduction).toMatchObject({
      thinking: "Start curious and warm without revealing strategy.",
      message: "I am Atlas. I ask too many questions, but usually for a good reason.",
      decisionLog: "Open with rapport while keeping strategic intent hidden.",
      reasoningContext: "OpenAI reasoning summary (concise): OpenAI summary: Atlas chose a friendly but observant introduction.",
    });
    expect(requests[0]).toMatchObject({
      reasoning: {
        effort: "low",
        summary: "concise",
      },
      text: {
        format: {
          type: "json_schema",
          name: "agent_response",
          strict: true,
        },
      },
    });
    expect(requests[0]).toMatchObject({
      prompt_cache_key: expect.stringMatching(/^influence:[a-f0-9]{24}$/),
    });
    expect(requests[0]).not.toHaveProperty("prompt_cache_retention");
    expect(requests[0]).not.toHaveProperty("prompt_cache_options");
    expect(traces[0]!.providerReasoningSummary?.mode).toBe("concise");
    expect(traces[0]!.providerReasoningSummary?.text).toBe("OpenAI summary: Atlas chose a friendly but observant introduction.");
    expect(traces[0]!.reasoningContext).toBeUndefined();
  });

  it("allows public game talk in lobby prompts with sentence and timing guardrails", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextSequenceOpenAIStub(requests, [
        JSON.stringify({
          thinking: "Atlas can press the vote story now.",
          message: "That vote told me plenty; Mira, I am watching who benefits from keeping Vera comfortable.",
          decisionLog: null,
        }),
        JSON.stringify({
          thinking: "Atlas needs to make the final lobby pitch now.",
          message: "This is the last lobby beat, so here is my read: Vera is too comfortable and Mira should not let that slide.",
          decisionLog: "Pressed Vera as too comfortable during the last lobby beat.",
        }),
      ]),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getLobbyMessage({
      ...makeContext(Phase.LOBBY),
      lobbySubRound: 0,
      lobbyTotalSubRounds: 2,
    });
    await agent.getLobbyMessage({
      ...makeContext(Phase.LOBBY),
      lobbySubRound: 1,
      lobbyTotalSubRounds: 2,
    });

    const firstPrompt = (requests[0]?.messages as Array<{ content: string }>).at(-1)!.content;
    const finalPrompt = (requests[1]?.messages as Array<{ content: string }>).at(-1)!.content;

    expect(firstPrompt).toContain("Talk about the game");
    expect(firstPrompt).toContain("Bluff, misdirect, exaggerate, or lie");
    expect(firstPrompt).toContain("Write 1-5 sentences; prefer conciseness");
    expect(firstPrompt).toContain("This is lobby message 1 of 2; 1 lobby message remains after this.");
    expect(firstPrompt).not.toContain("Openly naming vote plans, expose targets, or alliance structures");
    expect(firstPrompt).not.toContain("Revealing private deals or whisper-room information as fact");
    expect(firstPrompt).not.toContain("This is your final lobby message this phase.");

    expect(finalPrompt).toContain("This is lobby message 2 of 2; no lobby messages remain after this.");
    expect(finalPrompt).toContain("This is your final lobby message this phase.");
    expect(finalPrompt).toContain("Do not rely on anyone answering this phase.");
    expect(finalPrompt).toContain("Make declarations, offers, threats, commitments, and conditional deals");
    expect(finalPrompt).toContain("phrase asks as demands or proposals they can act on later.");
  });

  it("can use required string tool choice for local OpenAI-compatible providers", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeOpenAIStub(requests),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const votes = await agent.getVotes(makeContext());

    expect(votes).toEqual({ empowerTarget: "mira-id", thinking: expect.any(String) });
    expect(requests[0]?.tool_choice).toBe("required");
    expect(requests[0]?.max_tokens).toBe(8192);
    expect("parallel_tool_calls" in requests[0]!).toBe(false);
    const tools = requests[0]?.tools as Array<{
      function: {
        parameters: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
    }>;
    // We intentionally no longer strip "thinking" for local structured/required tool choice.
    // Agents must still be able to emit their internal reasoning (populates `thinking:`
    // in --chatty and the `thinking` on TranscriptEntry) even on local models. The raw
    // server reasoning_content (if any) goes only to the separate `reasoningContext`.
    expect(tools[0]!.function.parameters.properties.thinking).toBeDefined();
    expect(tools[0]!.function.parameters.required).toContain("thinking");
  });

  it("runs JSON schema fallback through the common retry handler", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeJsonFallbackRetryStub(requests),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "json_schema" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const votes = await agent.getVotes(makeContext());

    expect(votes).toEqual({
      empowerTarget: "mira-id",
            thinking: "Retry with enough room to choose targets.",
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.response_format).toBeDefined();
    expect(requests[0]?.tools).toBeUndefined();
    expect(requests[0]?.max_tokens).toBe(8192);
    expect(requests[1]?.max_tokens).toBe(12288);
  });

  it("carries one private decision receipt into the next prompt", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "cast_votes",
          args: {
            thinking: "Reward Mira and pressure Vera.",
            empower: "Mira",
                        decisionLog: "Rewarded Mira and pressured Vera as the current coalition test.",
          },
        },
        {
          toolName: "use_power",
          args: {
            thinking: "Let the council expose more public votes.",
            action: "pass",
            target: "Mira",
            shieldPullUpCandidates: [],
            decisionLog: null,
          },
        },
      ]),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getVotes(makeContext(Phase.VOTE));
    await agent.getPowerAction(makeContext(Phase.POWER), ["mira-id", "vera-id"]);

    const powerMessages = requests[1]?.messages as Array<{ content: string }>;
    const powerPrompt = powerMessages.at(-1)!.content;
    const receipt = "Rewarded Mira and pressured Vera as the current coalition test.";
    expect(powerPrompt).toContain("## Your Recent Decisions");
    expect(powerPrompt).toContain(`R1/VOTE Standard Vote (vote): ${receipt}`);
    expect(powerPrompt.match(new RegExp(receipt, "g"))).toHaveLength(1);
  });

  it("preserves thinking and native reasoning for empower revotes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "cast_empower_revote",
        {
          thinking: "Mira is the better tie-break because she is less likely to panic.",
          empower: "Mira",
        },
        "Hidden local reasoning for the empower revote.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const revote = await agent.getEmpowerRevote(
      makeContext(Phase.VOTE),
      ["mira-id", "vera-id"],
      { empowerTarget: "vera-id" },
    );

    expect(revote).toEqual({
      empowerTarget: "mira-id",
      thinking: "Mira is the better tie-break because she is less likely to panic.",
      reasoningContext: "Hidden local reasoning for the empower revote.",
    });
    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Empower Revote");
    expect(prompt).toContain("This is NOT a new normal vote.");
    expect(prompt).toContain("Original empower: Vera");
    expect(prompt).toContain("Eligible tied empower candidates: Mira, Vera");
    expect(prompt).toContain("the wheel randomly chooses");
  });

  it("falls back to a tied candidate when empower-revote tooling fails", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeRejectingOpenAIStub(requests),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const revote = await agent.getEmpowerRevote(
      makeContext(Phase.VOTE),
      ["mira-id", "vera-id"],
      { empowerTarget: "vera-id" },
    );

    expect(revote).toEqual({
      empowerTarget: "mira-id",
      thinking: "fallback empower revote due to error",
      reasoningContext: undefined,
    });
  });

  it("preserves private candidate-selection reasoning and eligible-set constraints", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "select_council_candidates",
        {
          thinking: "Mira is socially expensive to choose, but the vote tie gives me cover.",
          candidates: ["Mira"],
        },
        "Hidden local reasoning for candidate selection.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const decision = await agent.getCandidateSelection(makeContext(Phase.VOTE), {
      lockedCandidateIds: ["vera-id"],
      eligibleCandidateIds: ["mira-id"],
      requiredCount: 1,
      mode: "one_locked_one_choice",
      fallbackReason: null,
    });

    expect(decision).toEqual({
      selectedCandidateIds: ["mira-id"],
      thinking: "Mira is socially expensive to choose, but the vote tie gives me cover.",
      reasoningContext: "Hidden local reasoning for candidate selection.",
    });
    expect(requests[0]?.tool_choice).toEqual("required");
    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Private Council Candidate Selection");
    expect(prompt).toContain("Locked candidates already set by expose votes: Vera");
    expect(prompt).toContain("Eligible choices for the unresolved slot: Mira");
    expect(prompt).toContain("Required selections: 1");
  });

  it("falls back deterministically when candidate selection returns unavailable names", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "select_council_candidates", {
        thinking: "I want Atlas safe, but that is not legal.",
        candidates: ["Atlas", "Nobody"],
      }),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const decision = await agent.getCandidateSelection(makeContext(Phase.VOTE), {
      lockedCandidateIds: [],
      eligibleCandidateIds: ["mira-id", "vera-id"],
      requiredCount: 2,
      mode: "all_player_fallback",
      fallbackReason: "bench_too_small",
    });

    expect(decision.selectedCandidateIds).toEqual(["mira-id", "vera-id"]);
    expect(decision.thinking).toBe("I want Atlas safe, but that is not legal.");
  });

  it("bundles shield pull-up reasoning into the power action decision", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "use_power",
        {
          thinking: "Protecting Vera only works if Mira takes the heat instead.",
          action: "protect",
          target: "Vera",
          shieldPullUpCandidates: ["Mira"],
        },
        "Hidden local reasoning for bundled power action.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const decision = await agent.getPowerAction(makeContext(Phase.POWER), ["vera-id", "atlas-id"], {
      shieldReplacementRequests: [{
        lockedCandidateIds: ["atlas-id"],
        eligibleCandidateIds: ["mira-id"],
        requiredCount: 1,
        mode: "all_player_fallback_replacement",
        fallbackReason: "bench_exhausted",
        protectedCandidateId: "vera-id",
      }],
    });

    expect(decision.action).toBe("protect");
    expect(decision.target).toBe("vera-id");
    expect(decision.shieldPullUpCandidateIds).toEqual(["mira-id"]);
    expect(decision.thinking).toBe("Protecting Vera only works if Mira takes the heat instead.");
    expect(decision.reasoningContext).toBe("Hidden local reasoning for bundled power action.");
    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Protect Replacement Preview");
    expect(prompt).toContain("If you protect Vera, choose 1 shieldPullUpCandidates from: Mira");
    expect(prompt).toContain("fallback context: bench_exhausted");
    expect(prompt).toContain("fallback risk rather than vote-derived exposed risk");
  });

  it("preserves hidden Mingle intent and native reasoning", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "form_mingle_intent",
        {
          thinking: "Mira is useful to compare notes with, while Vera is too slippery to trust yet.",
          seekPlayers: ["Mira"],
          avoidPlayers: ["Vera"],
          preferredRoomSize: "small_group",
          purpose: "Test whether Mira will commit to watching Vera together.",
          provisionalTarget: "Vera",
          noTargetReason: null,
          openingAsk: "Ask Mira whether Vera's lobby warmth felt rehearsed.",
          strategicLens: "coalition_geometry",
          strategicLensRationale: "Atlas is testing whether Mira will join a Vera pressure lane.",
        },
        "Hidden local reasoning for the Mingle intent.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const intent = await agent.getMingleIntent({
      ...makeContext(Phase.MINGLE),
      roomCount: 2,
      roomCounts: [{ roomId: 1, count: 1 }, { roomId: 2, count: 1 }],
    });

    expect(intent).toEqual({
      seekPlayers: ["Mira"],
      avoidPlayers: ["Vera"],
      preferredRoomSize: "small_group",
      purpose: "Test whether Mira will commit to watching Vera together.",
      provisionalTarget: "Vera",
      noTargetReason: null,
      openingAsk: "Ask Mira whether Vera's lobby warmth felt rehearsed.",
      strategicLens: "coalition_geometry",
      strategicLensRationale: "Atlas is testing whether Mira will join a Vera pressure lane.",
      thinking: "Mira is useful to compare notes with, while Vera is too slippery to trust yet.",
      reasoningContext: "Hidden local reasoning for the Mingle intent.",
    });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("Standing target check:");
    expect(prompt).toContain("## Strategic Lens");
    expect(prompt).toContain("coalition_geometry");
    expect(prompt).toContain("Prefer a non-presentation lens");
    expect(prompt).toContain("one living player");
    expect(prompt).toContain("Never name yourself or anyone listed as eliminated.");
    expect(prompt).toContain("It is valid to leave provisionalTarget null");
  });

  it("parses structured Mingle I alliance actions", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "take_alliance_action",
        {
          thinking: "Mira is the cleanest early partner and Vera can stay outside this first deal.",
          action: "propose",
          name: "Glass Table",
          memberNames: ["Atlas", "Mira"],
          purpose: "Coordinate the first expose vote without overcommitting publicly.",
          timebox: "through council",
          lineageId: null,
          versionId: null,
          decisionLog: "propose a small early vote pact",
        },
        "Hidden local reasoning for the alliance action.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const action = await agent.getAllianceAction(makeContext(Phase.MINGLE_I));

    expect(action).toEqual({
      action: "propose",
      name: "Glass Table",
      memberNames: ["Atlas", "Mira"],
      purpose: "Coordinate the first expose vote without overcommitting publicly.",
      timebox: "through council",
      thinking: "Mira is the cleanest early partner and Vera can stay outside this first deal.",
      reasoningContext: "Hidden local reasoning for the alliance action.",
      decisionLog: "propose a small early vote pact",
    });
    expect(requests[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: "take_alliance_action" }),
        }),
      ]),
    );
  });

  it("prompts Mingle I proposals toward distinctive layered alliance names", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "take_alliance_action",
        {
          thinking: "No good proposal yet.",
          action: "pass",
          name: null,
          memberNames: [],
          purpose: null,
          timebox: null,
          lineageId: null,
          versionId: null,
          decisionLog: "pass until a better alliance shape appears",
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getAllianceAction(makeContext(Phase.MINGLE_I));

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("Alliance name rules when proposing");
    expect(prompt).toContain("unique from visible active alliances, open proposals, and proposal history");
    expect(prompt).toContain("concrete shared trait, contrast, promise, risk, strategy, or relationship");
    expect(prompt).toContain("short, interesting, engaging, and fun");
    expect(prompt).toContain('"Calm", "Anchor", "Core", "Axis", "Circle", "Steady", "Solid", "Trust"');
    expect(prompt).toContain('"The Late Voters", "Mirror Knives", "The Smoke Test", "Back Row Pact", "The Alibi Pair"');
    expect(prompt).toContain('"Calm Anchor Trio", "Steady Core", "Trust Circle", "Calm Axis"');
    expect(prompt).toContain("a final-two pair can sit inside a final-three voting pod");
    expect(prompt).toContain("3 for a voting pod, or 4 for a larger shield/majority");
    expect(prompt).toContain("Overlapping alliances are legal");
    expect(prompt).not.toContain("maximum number of alliances");
    expect(prompt).not.toContain("alliance-count limit");
  });

  it("parses structured alliance huddle turns without mutating alliance terms", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "alliance_huddle_turn",
        {
          thinking: "Mira needs a clean ask before the public vote locks.",
          message: "Mira, hold the empower vote on me and I will keep the expose pressure on Vera.",
          noReply: false,
          proposedTarget: "Vera",
          noTargetReason: null,
          proposedAction: "Empower Atlas, then pressure Vera in the first ballot.",
          memberCommitments: [{ memberName: "Atlas", commitment: "Keep pressure on Vera." }],
          contingency: "If Mira will not empower Atlas, compare an alternate empower candidate.",
          confidence: "medium",
          dissent: ["Mira has not committed yet."],
          alternativePlan: "Keep the alliance private and gather one more read.",
          decisionLog: "ask Mira for a concrete vote alignment inside Glass Table",
        },
        "Hidden local reasoning for the alliance huddle.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const turn = await agent.getAllianceHuddleTurn(
      makeContext(Phase.PRE_VOTE_HUDDLE),
      {
        allianceId: "alliance-glass",
        allianceName: "Glass Table",
        memberNames: ["Atlas", "Mira"],
        purpose: "Coordinate the first expose vote.",
        timebox: "through council",
        window: "pre_vote",
        scheduleId: "schedule-1",
        pass: 1,
      },
      [],
    );

    expect(turn).toEqual({
      thinking: "Mira needs a clean ask before the public vote locks.",
      reasoningContext: "Hidden local reasoning for the alliance huddle.",
      message: "Mira, hold the empower vote on me and I will keep the expose pressure on Vera.",
      noReply: false,
      commitment: {
        proposedTargetName: "Vera",
        noTargetReason: null,
        proposedAction: "Empower Atlas, then pressure Vera in the first ballot.",
        memberCommitments: [{ memberName: "Atlas", commitment: "Keep pressure on Vera." }],
        contingency: "If Mira will not empower Atlas, compare an alternate empower candidate.",
        confidence: "medium",
        dissent: ["Mira has not committed yet."],
        alternativePlan: "Keep the alliance private and gather one more read.",
      },
      decisionLog: "ask Mira for a concrete vote alignment inside Glass Table",
    });
    expect(requests[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: "alliance_huddle_turn" }),
        }),
      ]),
    );
    const messages = requests[0]?.messages as Array<{ content: string }>;
    expect(messages.at(-1)?.content).toContain("You cannot change official alliance name, roster, purpose, timebox, or status here");
  });

  it("uses hidden Mingle intent in turn prompts without requiring target naming", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "mingle_turn",
        {
          thinking: "No one in this room needs a hard target yet; staying quiet is better than overplaying.",
          message: null,
          noReply: true,
          gotoRoomId: null,
          gotoPlayerName: null,
        },
        "Hidden local reasoning for the Mingle turn.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const turn = await agent.takeMingleTurn({
      ...makeContext(Phase.MINGLE),
      roomCount: 2,
      roomCounts: [{ roomId: 1, count: 1 }, { roomId: 2, count: 2 }],
      currentRoomId: 1,
      roomMates: ["Atlas"],
      mingleBeat: 1,
      mingleTotalBeats: 3,
      mingleIntent: {
        seekPlayers: ["Mira"],
        avoidPlayers: [],
        preferredRoomSize: "pair",
        purpose: "Find one person willing to compare Vera reads without committing too early.",
        provisionalTarget: null,
        noTargetReason: "Atlas has only vibes, not evidence.",
        openingAsk: "Ask whether Vera's warmth feels rehearsed or genuine.",
        strategicLens: "room_traffic",
        strategicLensRationale: "Atlas wants to watch who seeks or avoids Vera.",
      },
    }, ["Atlas"], []);

    expect(turn).toEqual({
      thinking: "No one in this room needs a hard target yet; staying quiet is better than overplaying.",
      message: null,
      noReply: true,
      gotoRoomId: null,
      gotoPlayerName: null,
      reasoningContext: "Hidden local reasoning for the Mingle turn.",
      coordinationReceipt: {
        proposedTarget: null,
        proposedAction: null,
        commitment: null,
        noProposalReason: null,
      },
    });
    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    const tools = requests[0]?.tools as Array<{
      function: {
        parameters: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
    }>;
    const removedMingleDebugKeys = ["strategy" + "Signal", "movement" + "Purpose"];
    expect(tools[0]!.function.parameters.properties.gotoPlayerName).toBeDefined();
    expect(tools[0]!.function.parameters.required).toContain("gotoPlayerName");
    expect(removedMingleDebugKeys.every((key) => !(key in tools[0]!.function.parameters.properties))).toBe(true);
    expect(removedMingleDebugKeys.every((key) => !tools[0]!.function.parameters.required.includes(key))).toBe(true);
    expect(prompt).toContain("## Your Mingle Intent");
    expect(prompt).toContain("Find one person willing to compare Vera reads without committing too early.");
    expect(prompt).toContain("No-target reason: Atlas has only vibes, not evidence.");
    expect(prompt).toContain("Ask whether Vera's warmth feels rehearsed or genuine.");
    expect(prompt).toContain("Strategic lens: room_traffic");
    expect(prompt).toContain("Lens rationale: Atlas wants to watch who seeks or avoids Vera.");
    expect(prompt).toContain("This is Mingle turn 1 of 3; 2 Mingle turns remain after this.");
    expect(prompt).not.toContain("This is your final Mingle turn this phase.");
    expect(prompt).toContain("You may name a target or ally");
    expect(prompt).toContain("You do not have to name a target");
    expect(prompt).toContain("gotoPlayerName wins");
    expect(removedMingleDebugKeys.every((key) => !prompt.includes(key))).toBe(true);
    expect(prompt).toContain("TALK has no audience");
  });

  it("requires and preserves a concrete receipt in an allied Mingle decision room", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "mingle_turn", {
        thinking: "Mira is an official ally, but I still want the group to test Vera rather than blindly agree.",
        message: "Mira, I propose we empower you and both put Vera under pressure once the format is known. If you disagree, name your alternative now.",
        noReply: false,
        gotoRoomId: null,
        gotoPlayerName: null,
        proposedTarget: "Vera",
        proposedAction: "Empower Mira, then pressure Vera under the locked format.",
        commitment: "Atlas will support the Vera pressure lane unless the format makes it illegal.",
        noProposalReason: null,
        decisionLog: "offer Mira an independent Vera pressure proposal with a format contingency",
      }),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const turn = await agent.takeMingleTurn({
      ...makeContext(Phase.MINGLE),
      allianceContext: {
        activeAlliances: [{ id: "glass", name: "Glass Table", memberIds: ["atlas-id", "mira-id"], memberNames: ["Atlas", "Mira"], purpose: "Compare real vote plans.", timebox: null, status: "active", huddleOutcomes: [] }],
        openProposals: [],
        proposalHistory: [],
      },
    }, ["Atlas", "Mira"], []);

    expect(turn.coordinationReceipt).toEqual({
      proposedTarget: "Vera",
      proposedAction: "Empower Mira, then pressure Vera under the locked format.",
      commitment: "Atlas will support the Vera pressure lane unless the format makes it illegal.",
      noProposalReason: null,
    });
    const prompt = ((requests[0]?.messages as Array<{ content: string }>).at(-1)?.content) ?? "";
    expect(prompt).toContain("## Allied Decision Room");
    expect(prompt).toContain("not a consensus mandate");
  });

  it("rejects invalid huddle targets while retaining a valid no-target reason", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id", "Atlas", "strategic",
      makeToolOpenAIStub(requests, "alliance_huddle_turn", {
        thinking: "I cannot legally target myself.", message: "Let's wait for the format.", noReply: false,
        proposedTarget: "Atlas", noTargetReason: null, proposedAction: "Wait for the locked format.",
        memberCommitments: [{ memberName: "Atlas", commitment: "Reassess after the format pick." }],
        contingency: "If Vera is legal under the locked format, revisit Vera.", confidence: "low", dissent: ["Mira prefers more evidence."], alternativePlan: "Gather one more room read.", decisionLog: "reject self target",
      }),
      "google/gemma-4-26b-a4b-qat", undefined, undefined, { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);
    const turn = await agent.getAllianceHuddleTurn(makeContext(Phase.PRE_VOTE_HUDDLE), {
      allianceId: "glass", allianceName: "Glass Table", memberNames: ["Atlas", "Mira"], purpose: "Coordinate", timebox: null, window: "pre_vote", scheduleId: "schedule", pass: 1,
    });
    expect(turn.commitment?.proposedTargetName).toBeNull();
    expect(turn.commitment?.noTargetReason).toContain("Rejected invalid target: Atlas");
    expect(turn.commitment?.dissent).toEqual(["Mira prefers more evidence."]);
  });

  it("warns final Mingle turns not to expect another reply", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "mingle_turn",
        {
          thinking: "Atlas needs to make the ask now because the room will close.",
          message: "Mira, if you want Vera exposed, say it with me now; after this I am taking that story public.",
          noReply: false,
          gotoRoomId: 2,
          gotoPlayerName: null,
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.takeMingleTurn({
      ...makeContext(Phase.MINGLE),
      roomCount: 2,
      roomCounts: [{ roomId: 1, count: 2 }, { roomId: 2, count: 1 }],
      currentRoomId: 1,
      roomMates: ["Atlas", "Mira"],
      mingleBeat: 3,
      mingleTotalBeats: 3,
    }, ["Atlas", "Mira"], []);

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("This is Mingle turn 3 of 3; no Mingle turns remain after this.");
    expect(prompt).toContain("This is your final Mingle turn this phase.");
    expect(prompt).toContain("You will not hear another reply before the phase advances");
    expect(prompt).toContain("Do not rely on anyone answering this phase.");
    expect(prompt).toContain("Make declarations, offers, threats, commitments, and conditional deals");
    expect(prompt).toContain("phrase asks as demands or proposals they can act on later.");
    expect(prompt).toContain("do not rely on GOTO to continue the conversation now");
    expect(prompt).toContain("make the actual pitch in this TALK");
    expect(prompt).not.toContain("you will move next turn and can talk to a new set of people then");
  });

  it("includes post-vote pressure facts in Mingle prompts", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "mingle_turn",
        {
          thinking: "Atlas needs to ask Mira for cover and redirect pressure to Vera.",
          message: "Mira, if you shield me, I can help keep Vera in the hot seat.",
          noReply: false,
          gotoRoomId: null,
          gotoPlayerName: null,
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.takeMingleTurn({
      ...makeContext(Phase.MINGLE),
      empoweredId: "mira-id",
      revealedVoteLedger: [
        {
          round: 1,
          voterId: "atlas-id",
          voterName: "Atlas",
          empowerTargetId: "mira-id",
          empowerTargetName: "Mira",
          exposeTargetId: "vera-id",
          exposeTargetName: "Vera",
        },
        {
          round: 1,
          voterId: "vera-id",
          voterName: "Vera",
          empowerTargetId: "mira-id",
          empowerTargetName: "Mira",
          exposeTargetId: "atlas-id",
          exposeTargetName: "Atlas",
        },
      ],
      postVotePressure: {
        empowered: { id: "mira-id", name: "Mira" },
        exposePressure: [
          { id: "atlas-id", name: "Atlas", exposeScore: 3 },
          { id: "vera-id", name: "Vera", exposeScore: 2 },
          { id: "mira-id", name: "Mira", exposeScore: 1 },
        ],
        currentAtRisk: [
          { id: "atlas-id", name: "Atlas", exposeScore: 3 },
          { id: "vera-id", name: "Vera", exposeScore: 2 },
        ],
        replacementRisk: [],
        fallbackRisk: [],
        shieldScenarios: [
          {
            shieldedPlayer: { id: "atlas-id", name: "Atlas" },
            resultingAtRisk: [{ id: "vera-id", name: "Vera", exposeScore: 2 }],
          },
        ],
        players: [
          { id: "atlas-id", name: "Atlas", exposeScore: 3, status: "current_at_risk", shielded: false },
          { id: "mira-id", name: "Mira", exposeScore: 1, status: "empowered", shielded: false },
          { id: "vera-id", name: "Vera", exposeScore: 2, status: "current_at_risk", shielded: false },
        ],
      },
    }, ["Atlas", "Mira"], []);

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Current Board Contract");
    expect(prompt).toContain("- Current empowered player: Mira");
    expect(prompt).toContain("## Post-Vote Mingle Rules");
    expect(prompt).toContain("The standard Vote is locked and revealed.");
    expect(prompt).toContain("## Current Stakes");
    expect(prompt).toContain("- Phase objective: Private room dealmaking after the vote.");
    expect(prompt).toContain("- Next major decision: Power. Mira can pass, protect/shield a player to change who faces Council, or use an available elimination action.");
    expect(prompt).toContain("## Revealed Vote Ledger");
    expect(prompt).toContain("These named empower votes are public player knowledge after Vote resolves.");
    expect(prompt).toContain("Atlas: empowered Mira");
    expect(prompt).toContain("Vera: empowered Mira");
    expect(prompt).not.toContain("exposed Vera");
    expect(prompt).toContain("## Post-Vote Pressure");
    expect(prompt).toContain("- Empowered player: Mira");
    expect(prompt).toContain("- Your status: you are currently at risk for council");
    expect(prompt).toContain("- Current at-risk players: Atlas (3), Vera (2)");
    expect(prompt).toContain("If Atlas receives a shield: Vera (2)");
    expect(prompt).toContain("You may plead, bargain, redirect pressure, flatter, threaten, or stay quiet");
    expect(prompt).toContain("## Room-Specific Social Opportunity");
    expect(prompt).toContain("You are currently at risk and Mira is in this room");
    expect(prompt).toContain("ask for protection, offer a concrete deal, name a replacement target, recruit an advocate, expose a betrayal, threaten jury consequences, or persuade someone to carry your case");
    expect(prompt).toContain("Staying guarded is also valid");
    expect(prompt).toContain("Other occupants you can talk to now: Mira");
  });

  it("renders explicit negative current-board facts before standard votes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeOpenAIStub(requests),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
      { id: "rex-id", name: "Rex" },
    ]);

    await agent.getVotes({
      ...makeContext(Phase.VOTE),
      round: 2,
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
        { id: "vera-id", name: "Vera" },
      ],
      latestEliminatedPlayerName: "Rex",
    });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Current Board Contract");
    expect(prompt).toContain("- Current empowered player: none yet this round");
    expect(prompt).toContain("- Active shields right now: none");
    expect(prompt).not.toContain("- Current Council status:");
    expect(prompt).toContain("- Latest resolved elimination: Rex");
    expect(prompt).toContain("Eliminated-player rule:");
    expect(prompt).toContain("They are not live targets, active allies, active shields, current room targets, or normal-round voters.");
    expect(prompt).toContain("## Standard Vote Rules");
    expect(prompt).toContain("No one has won this vote's empowerment yet");
  });

  it("separates Council rules from standard Vote and renders typed recent decisions", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "council_vote", {
        thinking: "Mira is the better elimination.",
        eliminate: "Mira",
      }),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getCouncilVote({
      ...makeContext(Phase.COUNCIL),
      round: 3,
      empoweredId: "atlas-id",
      councilCandidates: ["mira-id", "vera-id"],
      recentDecisions: [
        {
          round: 3,
          phase: Phase.COUNCIL,
          label: "Council Vote",
          detail: "Your Council vote this round: Jace.",
        },
      ],
    }, ["mira-id", "vera-id"]);

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const tools = requests[0]?.tools as Array<{
      function: { name: string; strict?: boolean; parameters?: { additionalProperties?: unknown } };
    }>;
    const councilTool = tools.find((tool) => tool.function.name === "council_vote");
    expect(councilTool?.function.strict).toBe(true);
    expect(councilTool?.function.parameters?.additionalProperties).toBe(false);

    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Council Vote Rules");
    expect(prompt).toContain("This is not the standard empower vote");
    expect(prompt).toContain("The normal Council vote is tied");
    expect(prompt).not.toContain("empower/expose");
    expect(prompt).toContain("The only elimination choices are the two current Council candidates");
    expect(prompt).toContain("## Your Recent Decisions");
    expect(prompt).toContain("Your Council vote this round: Jace.");
    expect(prompt).not.toContain("Standard Vote has two named ballots");
  });

  it("falls back cleanly when Council tool args omit eliminate", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "council_vote", {
        thinking: "I want to vote, but the choice field is malformed.",
      }),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const result = await agent.getCouncilVote({
      ...makeContext(Phase.COUNCIL),
      round: 3,
      empoweredId: "atlas-id",
      councilCandidates: ["mira-id", "vera-id"],
    }, ["mira-id", "vera-id"]);

    expect(["mira-id", "vera-id"]).toContain(result.target);
    expect(result.thinking).toBe("I want to vote, but the choice field is malformed.");
  });

  it("clarifies that empowerment chooses the format and grants no immunity", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeOpenAIStub(requests),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getVotes({
      ...makeContext(Phase.VOTE),
      round: 2,
      empoweredId: "mira-id",
    });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("No one has won this vote's empowerment yet");
    expect(prompt).toContain("Cast one empower vote");
    expect(prompt).toContain("who chooses the round format");
    expect(prompt).toContain("format elimination ties");
    expect(prompt).toContain("empowerment does not grant immunity");
    expect(prompt).toContain("Optimize for *who* should hold the chooser seat");
    expect(prompt).not.toContain("expose ballot");
    expect(prompt).not.toContain("Only the winner of this vote's empower tally is protected");
    expect(prompt).not.toContain("exposing someone you predict will win the current empower tally can be wasted");
  });

  it("clarifies empower re-vote resolution in revealed vote ledger prompts", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "mingle_turn",
        {
          thinking: "Atlas should understand the re-vote result before talking.",
          message: "Vera, that re-vote put the room around you.",
          noReply: false,
          gotoRoomId: null,
          gotoPlayerName: null,
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    const alivePlayers = [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
    ];
    agent.onGameStart("game-1", alivePlayers);

    await agent.takeMingleTurn({
      ...makeContext(Phase.MINGLE),
      alivePlayers,
      empoweredId: "vera-id",
      revealedVoteLedger: [
        {
          round: 1,
          voterId: "atlas-id",
          voterName: "Atlas",
          empowerTargetId: "mira-id",
          empowerTargetName: "Mira",
          exposeTargetId: "vera-id",
          exposeTargetName: "Vera",
          revoteEmpowerTargetId: "vera-id",
          revoteEmpowerTargetName: "Vera",
        },
        {
          round: 1,
          voterId: "mira-id",
          voterName: "Mira",
          empowerTargetId: "vera-id",
          empowerTargetName: "Vera",
          exposeTargetId: "atlas-id",
          exposeTargetName: "Atlas",
          revoteEmpowerTargetId: "vera-id",
          revoteEmpowerTargetName: "Vera",
        },
        {
          round: 1,
          voterId: "vera-id",
          voterName: "Vera",
          empowerTargetId: "atlas-id",
          empowerTargetName: "Atlas",
          exposeTargetId: "atlas-id",
          exposeTargetName: "Atlas",
        },
      ],
    }, ["Atlas", "Vera"], []);

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("Initial empower tie: Mira, Vera, Atlas at 1 votes each.");
    expect(prompt).toContain("Re-vote tally (this supersedes the initial tied empower votes; do not add initial and re-vote votes together):");
    expect(prompt).toContain("Vera: 2 (Atlas, Mira)");
    expect(prompt).toContain("Final empowered result: Vera.");
    expect(prompt).toContain("Atlas: empowered Mira; in the tie re-vote, chose Vera");
  });

  it("does not carry pre-Power pressure stakes into diary reflections", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "strategic_reflection",
        {
          thinking: "Power and Council are already resolved, so I should reassess the next round.",
          certainties: ["Vera left at Council"],
          suspicions: ["Mira may have overplayed the vote"],
          allies: ["Mira"],
          threats: [],
          plan: "Reset reads for the next lobby.",
          strategicLens: "broad_read",
          strategicLensRationale: "The resolved round changed the board.",
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
    ]);

    await agent.getStrategicReflection({
      ...makeContext(Phase.DIARY_ROOM),
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
      ],
      empoweredId: "mira-id",
      councilCandidates: ["vera-id", "mira-id"],
      postVotePressure: {
        empowered: { id: "mira-id", name: "Mira" },
        exposePressure: [{ id: "vera-id", name: "Vera", exposeScore: 5 }],
        currentAtRisk: [{ id: "vera-id", name: "Vera", exposeScore: 5 }],
        replacementRisk: [],
        fallbackRisk: [],
        shieldScenarios: [],
        players: [
          { id: "mira-id", name: "Mira", exposeScore: 0, status: "empowered", shielded: false },
          { id: "vera-id", name: "Vera", exposeScore: 5, status: "current_at_risk", shielded: false },
        ],
      },
    });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("- Phase: DIARY_ROOM");
    expect(prompt).toContain("- Current Council status: no live Council; most recent/resolved candidates: Vera (eliminated) vs Mira");
    expect(prompt).toContain("- Active shields right now: none");
    expect(prompt).not.toContain("vera-id");
    expect(prompt).not.toContain("Next major decision: Power");
    expect(prompt).not.toContain("## Post-Vote Pressure");
    expect(prompt).not.toContain("you are empowered and will decide the Power ceremony");
  });

  it("preserves hidden strategic reflections and native reasoning", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "strategic_reflection",
        {
          thinking: "Mira is a likely ally and Vera remains the most plausible threat.",
          certainties: ["Mira protected Atlas in the last vote"],
          suspicions: ["Vera is overplaying warmth in Mingle"],
          allies: ["Mira"],
          threats: ["Vera"],
          plan: "Keep Mira close and test whether Finn will expose Vera next.",
          strategicLens: "private_inconsistency",
          strategicLensRationale: "Vera's private posture is not matching her public warmth.",
          strategyPacket: {
            objective: "Keep Mira close while testing Vera's inconsistent posture.",
            targetPosture: "Vera is the soft pressure target.",
            coalitionPosture: "Mira is a working ally.",
            nextSocialProbe: "Ask Finn whether Vera gave a clear vote answer.",
            strategicLens: "private_inconsistency",
            strategicLensRationale: "The next move depends on whether Vera's private story matches public warmth.",
            uncertainty: "Finn may be exaggerating Vera's evasiveness.",
            reviseTrigger: "Revise if Finn says Vera was direct.",
            changedSincePrevious: "initial packet",
          },
        },
        "Hidden local reasoning for the strategic reflection.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const reflection = await agent.getStrategicReflection(makeContext(Phase.VOTE));

    expect(reflection).toEqual({
      certainties: ["Mira protected Atlas in the last vote"],
      suspicions: ["Vera is overplaying warmth in Mingle"],
      allies: ["Mira"],
      threats: ["Vera"],
      plan: "Keep Mira close and test whether Finn will expose Vera next.",
      strategicLens: "private_inconsistency",
      strategicLensRationale: "Vera's private posture is not matching her public warmth.",
      thinking: "Mira is a likely ally and Vera remains the most plausible threat.",
      reasoningContext: "Hidden local reasoning for the strategic reflection.",
      strategyPacket: expect.objectContaining({
        revisionId: "r1-vote-1",
        strategicLens: "private_inconsistency",
      }),
    });
  });

  it("stores Strategy Thread packets from reflection and records later decision receipts", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "strategic_reflection",
          args: {
            thinking: "Mira is useful cover and Vera is still the pressure point.",
            certainties: ["Mira protected Atlas in the last vote"],
            suspicions: ["Vera avoided making a clear commitment"],
            allies: ["Mira"],
            threats: ["Vera"],
            plan: "Keep Mira close and test whether Vera is coordinating.",
            strategicLens: "social_cover",
            strategicLensRationale: "Atlas is checking whether Vera has protection from Mira.",
            strategyPacket: {
              objective: "Keep Mira close while testing Vera's social cover.",
              targetPosture: "Pressure Vera only if she dodges the next probe.",
              coalitionPosture: "Treat Mira as a working ally, not a final commitment.",
              nextSocialProbe: "Ask Mira whether Vera's warmth feels rehearsed.",
              strategicLens: "social_cover",
              strategicLensRationale: "Atlas is checking whether Vera is being shielded by Mira.",
              uncertainty: "Mira may be shielding Vera instead of helping Atlas.",
              reviseTrigger: "Revise if Mira refuses to compare Vera reads.",
              changedSincePrevious: "initial packet",
            },
          },
          reasoningContent: "Hidden reflection reasoning.",
        },
        {
          toolName: "cast_votes",
          args: {
            thinking: "The packet still fits: reward Mira and pressure Vera.",
            empower: "Mira",
                        decisionLog: "Rewarded Mira and pressured Vera because the Strategy Thread still fits.",
          },
          reasoningContent: "Hidden vote reasoning.",
        },
      ]),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const reflection = await agent.getStrategicReflection(makeContext(Phase.VOTE));
    const strategyPacket = reflection?.strategyPacket ?? null;
    expect(strategyPacket).toMatchObject({
      revisionId: "r1-vote-1",
      objective: "Keep Mira close while testing Vera's social cover.",
      targetPosture: "Pressure Vera only if she dodges the next probe.",
      strategicLens: "social_cover",
      strategicLensRationale: "Atlas is checking whether Vera is being shielded by Mira.",
    });
    expect(agent.getStrategyPacket()).toEqual(strategyPacket);

    const reflectionMessages = requests[0]?.messages as Array<{ content: string }>;
    const reflectionPrompt = reflectionMessages.at(-1)!.content;
    expect(reflectionMessages[0]?.content).not.toContain("PHASE BEHAVIOR — VOTE");
    expect(reflectionPrompt).toContain("## Private Reflection Mode");
    expect(reflectionPrompt).toContain("You are NOT taking a live phase action right now.");
    expect(reflectionPrompt).toContain("do not speak to the room");
    expect(reflectionPrompt).toContain("Reflected phase: VOTE.");
    expect(reflectionPrompt).toContain("Do not turn this into a message you intend to send.");
    expect(reflectionPrompt).toContain("For strategyPacket.targetPosture, choose a standing target posture:");
    expect(reflectionPrompt).toContain("## Strategic Lens");
    expect(reflectionPrompt).toContain("name one living player");
    expect(reflectionPrompt).toContain("If a prior target is now eliminated, do not carry them as active.");

    const vote = await agent.getVotes(makeContext(Phase.VOTE));

    expect(vote).toMatchObject({
      empowerTarget: "mira-id",
            decisionLog: "Rewarded Mira and pressured Vera because the Strategy Thread still fits.",
      reasoningContext: "Hidden vote reasoning.",
    });

    const voteMessages = requests[1]?.messages as Array<{ content: string }>;
    const votePrompt = voteMessages.at(-1)!.content;
    expect(votePrompt).toContain("## Strategy Thread");
    expect(votePrompt).toContain("- Revision: r1-vote-1");
    expect(votePrompt).toContain("This Strategy Thread was last updated in Round 1 during VOTE; if Mingle or other phases happened after that, treat those newer events as evidence to weigh alongside or revise the strategy.");
    expect(votePrompt).toContain("Keep Mira close while testing Vera's social cover.");
    expect(votePrompt).toContain("- Strategic lens: social_cover");
    expect(votePrompt).toContain("Standing target discipline:");
    expect(votePrompt).toContain("Never treat an eliminated player as an active standing target.");
    expect(votePrompt).toContain("When a tool asks for decisionLog");
    expect(votePrompt).not.toContain("You must follow");
  });

  it("carries introduction messages into initial strategic reflection prompts", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "strategic_reflection",
        {
          thinking: "Atlas has only first impressions from introductions, so the packet should stay provisional.",
          certainties: ["Mira introduced herself as a careful listener"],
          suspicions: [],
          allies: [],
          threats: [],
          plan: "Use the first lobby to ask Mira and Vera what they noticed.",
          strategicLens: "presentation_read",
          strategicLensRationale: "Only public introduction tone is available so far.",
          strategyPacket: {
            objective: "Gather public first-read evidence before naming a target.",
            targetPosture: "No standing target yet; wait for lobby responses.",
            coalitionPosture: "Keep Mira and Vera flexible until they speak about the game.",
            nextSocialProbe: "Ask Mira what she noticed in Vera's introduction.",
            strategicLens: "presentation_read",
            strategicLensRationale: "Only introductions are available evidence.",
            uncertainty: "Introductions may not predict game posture.",
            reviseTrigger: "Revise after the first lobby exchange creates game evidence.",
            changedSincePrevious: "initial packet",
          },
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getStrategicReflection({
      ...makeContext(Phase.INTRODUCTION),
      round: 0,
      publicMessages: [
        {
          round: 0,
          phase: Phase.INTRODUCTION,
          from: "Mira",
          text: "I'm Mira. I restore old radios and like patient conversations.",
        },
        {
          round: 0,
          phase: Phase.INTRODUCTION,
          from: "Vera",
          text: "I'm Vera. I grew up around night markets and read rooms quickly.",
        },
      ],
    });

    const reflectionMessages = requests[0]?.messages as Array<{ content: string }>;
    const reflectionPrompt = reflectionMessages.at(-1)!.content;
    expect(reflectionPrompt).toContain("## Recent Public Messages");
    expect(reflectionPrompt).toContain("[R0/INTRODUCTION] Mira");
    expect(reflectionPrompt).toContain("I restore old radios");
    expect(reflectionPrompt).toContain("[R0/INTRODUCTION] Vera");
    expect(reflectionPrompt).toContain("night markets");
    expect(reflectionPrompt).toContain("introductions are public communication and valid first-impression evidence");
    expect(reflectionPrompt).toContain("The Strategy Thread packet can be provisional");
  });

  it("carries introduction and lobby messages into round-one lobby prompts", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextOpenAIStub(
        requests,
        JSON.stringify({
          thinking: "Use the intro and first lobby record to ask a concrete follow-up.",
          message: "Mira, your patience read is useful; Vera, what did you notice from the first lobby beat?",
          decisionLog: "Used introduction and lobby public context to seed a concrete follow-up.",
        }),
      ),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getLobbyMessage({
      ...makeContext(Phase.LOBBY),
      round: 1,
      lobbySubRound: 1,
      lobbyTotalSubRounds: 2,
      publicMessages: [
        {
          round: 0,
          phase: Phase.INTRODUCTION,
          from: "Mira",
          text: "I'm Mira. I restore old radios and like patient conversations.",
        },
        {
          round: 1,
          phase: Phase.LOBBY,
          from: "Vera",
          text: "I want to compare who seemed too polished in introductions.",
        },
      ],
    });

    const lobbyMessages = requests[0]?.messages as Array<{ content: string }>;
    const lobbyPrompt = lobbyMessages.at(-1)!.content;
    expect(lobbyPrompt).toContain("[R0/INTRODUCTION] Mira");
    expect(lobbyPrompt).toContain("I restore old radios");
    expect(lobbyPrompt).toContain("[R1/LOBBY] Vera");
    expect(lobbyPrompt).toContain("too polished");
  });

  it("renders pre-vote strategic reflection as a realignment checkpoint", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "strategic_reflection",
        {
          thinking: "Mira was empowered last round, but this vote starts fresh.",
          certainties: ["Vera was eliminated last round"],
          suspicions: ["Mira may still attract empower votes"],
          allies: ["Mira"],
          threats: [],
          plan: "Choose a live empower and expose pair for this round.",
          strategicLens: "vote_math",
          strategicLensRationale: "The next vote resets protection assumptions.",
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getStrategicReflection({
      ...makeContext(Phase.VOTE),
      round: 2,
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
      ],
    }, { timing: "pre_vote" });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Private Pre-Vote Strategy Realignment");
    expect(prompt).toContain("The phase shown above is the upcoming vote you are preparing for.");
    expect(prompt).toContain("This is before a later-round vote, after prior eliminations and phase outcomes have changed the board.");
    expect(prompt).toContain("Prune eliminated players from active targets, allies, threats, and plans.");
    expect(prompt).toContain("Reset stale assumptions about who will be empowered or immune");
    expect(prompt).toContain("last round's empowered player is not automatically protected");
    expect(prompt).toContain("Form a current empower intent from the living field before you vote.");
    expect(prompt).not.toContain("empower/expose intent");
    expect(prompt).not.toContain("the phase you are reflecting on after it resolved");
  });

  it("marks eliminated players as stale when rendering Strategy Thread prompts", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "strategic_reflection",
          args: {
            thinking: "Mira looked like the likely target, but that may change.",
            certainties: [],
            suspicions: ["Mira is coordinating votes"],
            allies: [],
            threats: ["Mira"],
            plan: "Pressure Mira unless the field changes.",
            strategicLens: "vote_math",
            strategicLensRationale: "The vote frame changed after elimination.",
            strategyPacket: {
              objective: "Push Mira into the open before the next vote.",
              targetPosture: "Mira is the working target.",
              coalitionPosture: "Keep Vera flexible until Mira is exposed.",
              nextSocialProbe: "Ask Vera whether Mira promised her safety.",
              strategicLens: "vote_math",
              strategicLensRationale: "The stale target needs to be revised after elimination math changes.",
              uncertainty: "Mira may already have lost enough social cover.",
              reviseTrigger: "Revise if Mira leaves the game.",
              changedSincePrevious: "initial packet",
            },
          },
        },
        {
          toolName: "cast_votes",
          args: {
            thinking: "Mira is gone, so choose from the live field.",
            empower: "Vera",
                        decisionLog: "Mira left the game, so I pivoted the packet toward Vera as the live field.",
          },
        },
      ]),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getStrategicReflection(makeContext(Phase.VOTE));
    agent.removeFromMemory("Mira");
    await agent.getVotes({
      ...makeContext(Phase.VOTE),
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "vera-id", name: "Vera" },
      ],
    });

    const voteMessages = requests[1]?.messages as Array<{ content: string }>;
    const votePrompt = voteMessages.at(-1)!.content;
    expect(votePrompt).toContain("Mira (eliminated; not an active target)");
    expect(votePrompt.match(/Mira \(eliminated; not an active target\)/g)).toHaveLength(6);
    expect(votePrompt).not.toContain("Mira (eliminated; not an active target) (eliminated; not an active target)");
    expect(votePrompt).toContain("If the packet names someone marked eliminated, use that as stale history and pivot to a living replacement or explicitly no standing target.");
  });

  it("preserves thinking and native reasoning for endgame elimination votes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "elimination_vote",
        {
          thinking: "Vera has too much social cover to let through.",
          eliminate: "Vera",
          decisionLog: "Cut Vera because her endgame cover is too strong.",
        },
        "Hidden local reasoning for direct elimination.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const vote = await agent.getEndgameEliminationVote(makeContext(Phase.VOTE));

    expect(vote).toEqual({
      target: "vera-id",
      thinking: "Vera has too much social cover to let through.",
      reasoningContext: "Hidden local reasoning for direct elimination.",
      decisionLog: "Cut Vera because her endgame cover is too strong.",
    });
    const tools = requests[0]?.tools as Array<{
      function: {
        parameters: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
    }>;
    expect(tools[0]!.function.parameters.properties.decisionLog).toBeDefined();
    expect(tools[0]!.function.parameters.required).toContain("decisionLog");
  });

  it("uses an endgame prompt frame with Board Contract and without unbounded history", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "elimination_vote", {
        thinking: "The endgame record points at Vera.",
        eliminate: "Vera",
      }),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    const players = [
      { id: "atlas-id", name: "Atlas", shielded: true },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
      { id: "nyx-id", name: "Nyx" },
    ];
    agent.onGameStart("game-1", players);

    await agent.getEndgameEliminationVote({
      ...makeContext(Phase.VOTE),
      round: 5,
      endgameStage: "reckoning",
      alivePlayers: players,
      empoweredId: "atlas-id",
      postVotePressure: {
        empowered: { id: "atlas-id", name: "Atlas" },
        exposePressure: [{ id: "vera-id", name: "Vera", exposeScore: 4 }],
        currentAtRisk: [{ id: "vera-id", name: "Vera", exposeScore: 4 }],
        replacementRisk: [],
        fallbackRisk: [],
        shieldScenarios: [],
        players: [
          { id: "atlas-id", name: "Atlas", exposeScore: 0, status: "empowered", shielded: true },
          { id: "vera-id", name: "Vera", exposeScore: 4, status: "current_at_risk", shielded: false },
        ],
      },
      publicMessages: Array.from({ length: 12 }, (_, index) => ({
        from: index === 0 ? "Mira" : "House",
        text: index === 0 ? "old public message that must survive the old ten-message cap" : `public message ${index}`,
        phase: Phase.LOBBY,
        round: Math.max(1, index - 6),
      })),
      publicTranscriptContext: [
        { round: 1, phase: Phase.LOBBY, from: "Mira", text: "old public message that must survive the old ten-message cap" },
        { round: 4, phase: Phase.COUNCIL, from: "House", text: "Sage was eliminated by Council." },
      ],
      gameEventRecord: [
        "R1/VOTE: Echo voted empower=Lyra, expose=Rex.",
        "R2/POWER: Power action: protect -> Echo.",
        "R2/POWER: Power resolved candidates=Rex, Finn; shield granted=Echo; auto-eliminated=none.",
        "R3/COUNCIL: Council resolved: candidates Rex, Finn; votes Kael -> Rex; eliminated Rex by plurality.",
        "R4/VOTE: reckoning elimination resolved: votes Kael -> Sage; eliminated Sage by plurality.",
        "R5/JURY_VOTE: Juror Sage voted for finalist Mira.",
      ],
    });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Endgame Rules");
    // U4: complete historical Game Event Record and Full Public Transcript retired.
    expect(prompt).not.toContain("## Game Event Record");
    expect(prompt).not.toContain("## Full Public Transcript");
    expect(prompt).not.toContain("shield granted=Echo");
    expect(prompt).not.toContain("old public message that must survive the old ten-message cap");
    expect(prompt).not.toContain("R5/JURY_VOTE: Juror Sage voted for finalist Mira.");
    expect(prompt).toContain("## Current Board Contract");
    expect(prompt).toContain("- Active shields right now: none");
    expect(prompt).not.toContain("Cast one empower vote and one expose vote");
    expect(prompt).not.toContain("## Current Stakes");
    expect(prompt).not.toContain("## Post-Vote Pressure");
    expect(prompt).not.toContain("you are empowered and will decide the Power ceremony");
  });

  it("carries prior Judgment questions and answers into finalist and juror prompts", async () => {
    const answerRequests: Array<Record<string, unknown>> = [];
    const finalist = new InfluenceAgent(
      "mira-id",
      "Mira",
      "social",
      makeTextOpenAIStub(answerRequests, "I already answered for Rex, so I will address Sage directly."),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    finalist.onGameStart("game-1", makeContext().alivePlayers);
    const judgmentCtx: PhaseContext = {
      ...makeContext(Phase.JURY_QUESTIONS),
      selfId: "mira-id",
      selfName: "Mira",
      round: 6,
      endgameStage: "judgment",
      alivePlayers: [
        { id: "mira-id", name: "Mira" },
        { id: "vera-id", name: "Vera" },
      ],
      finalists: ["mira-id", "vera-id"],
      jury: [{ playerId: "rex-id", playerName: "Rex", eliminatedRound: 3 }],
      judgmentQuestionHistory: [
        {
          jurorName: "Rex",
          finalistName: "Mira",
          question: "Why should I trust the deal you made with Vera?",
          answer: "Because I used that deal to keep the vote stable.",
        },
      ],
      gameEventRecord: ["R3/COUNCIL: Council resolved: candidates Rex, Finn; eliminated Rex by plurality."],
      publicTranscriptContext: [
        { round: 6, phase: Phase.OPENING_STATEMENTS, from: "Mira", text: "I built the social bridge that got me here." },
      ],
    };

    await finalist.getJuryAnswer(judgmentCtx, "What did you learn from betraying Rex?", "Sage");
    const answerMessages = answerRequests[0]?.messages as Array<{ content: string }>;
    const answerPrompt = answerMessages.at(-1)!.content;
    expect(answerPrompt).toContain("## Judgment Questions So Far");
    expect(answerPrompt).toContain("Rex to Mira: \"Why should I trust the deal you made with Vera?\"");
    expect(answerPrompt).toContain("A: Mira: \"Because I used that deal to keep the vote stable.\"");
    expect(answerPrompt).toContain("- Active jurors: Rex");

    const questionRequests: Array<Record<string, unknown>> = [];
    const juror = new InfluenceAgent(
      "rex-id",
      "Rex",
      "observer",
      makeToolOpenAIStub(questionRequests, "ask_jury_question", {
        thinking: "Ask Vera something different from Rex's prior question.",
        target: "Vera",
        question: "Vera, which vote do you take responsibility for?",
      }),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    juror.onGameStart("game-1", [
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
      { id: "rex-id", name: "Rex" },
    ]);

    await juror.getJuryQuestion({
      ...judgmentCtx,
      selfId: "rex-id",
      selfName: "Rex",
      isEliminated: true,
    }, ["mira-id", "vera-id"]);
    const questionMessages = questionRequests[0]?.messages as Array<{ content: string }>;
    const questionPrompt = questionMessages.at(-1)!.content;
    expect(questionPrompt).toContain("## Judgment Questions Asked So Far");
    expect(questionPrompt).toContain("Questions only. Prior answers are intentionally withheld");
    expect(questionPrompt).toContain("Rex to Mira: \"Why should I trust the deal you made with Vera?\"");
    expect(questionPrompt).not.toContain("Because I used that deal to keep the vote stable.");
    expect(questionPrompt).toContain("ask from a distinct angle");
  });

  it("asks Council candidates role-aware diary questions without inventing their vote", async () => {
    const house = new TemplateHouseInterviewer();

    const question = await house.generateQuestion({
      precedingPhase: Phase.COUNCIL,
      round: 6,
      agentName: "Wren",
      alivePlayers: ["Wren", "Vex", "Nyx"],
      activeShieldNames: [],
      eliminatedPlayers: ["Lyra"],
      lastEliminated: "Lyra",
      empoweredName: "Nyx",
      councilCandidates: ["Wren", "Lyra"],
      recentMessages: [],
      councilRole: {
        playerName: "Wren",
        role: "candidate",
        candidateNames: ["Wren", "Lyra"],
        eliminatedName: "Lyra",
        survivingCandidateName: "Wren",
        votedForName: null,
      },
    });

    expect(question).toContain("you were on the Council block");
    expect(question).toContain("did not cast a Council vote");
    expect(question).not.toContain("did you vote");
  });

  it("asks empowered players about unused tiebreak leverage when Council resolves by plurality", async () => {
    const house = new TemplateHouseInterviewer();

    const question = await house.generateQuestion({
      precedingPhase: Phase.COUNCIL,
      round: 3,
      agentName: "Finn",
      alivePlayers: ["Arden", "Nyx", "Cyrus", "Mira", "Finn", "Dax"],
      activeShieldNames: [],
      eliminatedPlayers: ["Atlas", "Riven"],
      lastEliminated: "Nyx",
      empoweredName: "Finn",
      councilCandidates: ["Nyx", "Dax"],
      recentMessages: [],
      councilRole: {
        playerName: "Finn",
        role: "empowered_no_tiebreak_needed",
        candidateNames: ["Nyx", "Dax"],
        eliminatedName: "Nyx",
        survivingCandidateName: "Dax",
        votedForName: null,
      },
    });

    expect(question).toContain("without needing it");
    expect(question).not.toContain("your Council choice");
    expect(question).not.toContain("cast a Council vote");
  });

  it("preserves thinking and native reasoning for jury votes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "jury_vote",
        {
          thinking: "Vera owned her betrayal and made the sharper case.",
          winner: "Vera",
          decisionLog: "Rewarded Vera because she owned the sharper endgame case.",
        },
        "Hidden local reasoning for the winner vote.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const vote = await agent.getJuryVote(makeContext(Phase.JURY_VOTE), ["mira-id", "vera-id"]);

    expect(vote).toEqual({
      target: "vera-id",
      thinking: "Vera owned her betrayal and made the sharper case.",
      reasoningContext: "Hidden local reasoning for the winner vote.",
      decisionLog: "Rewarded Vera because she owned the sharper endgame case.",
    });
    const tools = requests[0]?.tools as Array<{
      function: {
        parameters: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
    }>;
    expect(tools[0]!.function.parameters.properties.decisionLog).toBeDefined();
    expect(tools[0]!.function.parameters.required).toContain("decisionLog");
  });

  it("uses plain visible messages with the global message token floor in local mode", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextOpenAIStub(requests, "Glad to meet everyone. I ask too many questions, but I promise most of them are useful."),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const response = await agent.getIntroduction(makeContext(Phase.INTRODUCTION));

    expect(response).toMatchObject({
      thinking: "",
      message: "Glad to meet everyone. I ask too many questions, but I promise most of them are useful.",
    });
    expect(requests[0]?.max_tokens).toBe(4096);
    expect(requests[0]?.response_format).toBeUndefined();
    // We no longer inject the old "LOCAL MODEL OUTPUT RULE" that forbade thinking.
    // Local models are now allowed to think freely on public messages (Master likes thick thinking).
    const messages = requests[0]?.messages as Array<{ content: string }>;
    expect(messages.at(-1)!.content).not.toContain("LOCAL MODEL OUTPUT RULE");
  });

  it("captures native local reasoning_content separately as reasoningContext (not as emitted thinking)", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextSequenceOpenAIStub(requests, [
        {
          content: "I notice who dodges questions, and I remember.",
          reasoningContent: "Atlas wants to sound warm while signaling observation.",
        },
      ]),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const response = await agent.getIntroduction(makeContext(Phase.INTRODUCTION));

    // The raw hidden channel goes only to reasoningContext.
    // The agent's "emitted" thinking (what it puts under "thinking" in content JSON or tool args)
    // populates `thinking`. In this stub there was no explicit thinking in content,
    // so thinking stays empty while the native trace is still captured for observability.
    expect(response).toMatchObject({
      thinking: "",
      message: "I notice who dodges questions, and I remember.",
      reasoningContext: "Atlas wants to sound warm while signaling observation.",
    });
    expect(requests[0]?.response_format).toBeUndefined();
  });

  it("retries empty local visible messages with a larger budget", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextSequenceOpenAIStub(requests, ["", "Second try, actual words."]),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const response = await agent.getIntroduction(makeContext(Phase.INTRODUCTION));

    expect(response.message).toBe("Second try, actual words.");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.max_tokens).toBe(4096);
    expect(requests[1]?.max_tokens).toBe(8192);
  });

  it("keeps explicitly emitted thinking separate from raw reasoningContext on local models", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextSequenceOpenAIStub(requests, [
        {
          // Model emitted both a structured thinking in content + the hidden channel
          content: JSON.stringify({
            thinking: "I should build rapport while noting Finn's evasiveness.",
            message: "Finn, your stories are always so vivid.",
          }),
          reasoningContent: "Deep hidden CoT: Finn is dodging; Vera might be an ally here.",
        },
      ]),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const response = await agent.getIntroduction(makeContext(Phase.INTRODUCTION));

    expect(response).toMatchObject({
      thinking: "I should build rapport while noting Finn's evasiveness.",
      message: "Finn, your stories are always so vivid.",
      reasoningContext: "Deep hidden CoT: Finn is dodging; Vera might be an ally here.",
    });
  });
});

describe("player continuity capsule capture and hydration (R12)", () => {
  function makeAgent(requests: Array<Record<string, unknown>> = []) {
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeOpenAIStub(requests),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
      { id: "gone-id", name: "Gone" },
    ]);
    return agent;
  }

  it("captures power-action memory and recent decision receipts omitted by the prior capsule", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "cast_votes",
          args: {
            thinking: "Empower Mira",
            empower: "Mira",
            decisionLog: "Empower Mira for format control",
          },
        },
        {
          toolName: "use_power",
          args: {
            thinking: "Protect Mira",
            action: "protect",
            target: "Mira",
            decisionLog: "Protect Mira after public receipt",
          },
        },
      ]),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);
    agent.updateAlly("Mira");
    agent.updateThreat("Vera");
    agent.addNote("Mira", "trustworthy format chooser");

    await agent.getVotes(makeContext(Phase.VOTE));
    await agent.getPowerAction(makeContext(Phase.POWER), ["mira-id", "vera-id"]);

    const capsule = agent.getContinuityCapsule();
    expect(capsule).not.toBeNull();
    expect(capsule!.version).toBe(1);
    expect(capsule!.powerActionMemory).toEqual([
      expect.objectContaining({ action: "protect", target: "Mira", round: 1 }),
    ]);
    expect(capsule!.recentStrategicDecisions.map((r) => r.decisionLog)).toEqual(
      expect.arrayContaining([
        "Empower Mira for format control",
        "Protect Mira after public receipt",
      ]),
    );
    expect(capsule!.roundHistory.some((entry) => entry.myVotes.empower === "Mira")).toBeTrue();
    expect(capsule!.relationships.allies).toContain("Mira");
    expect(capsule!.notes.some((note) => note.subject === "Mira")).toBeTrue();
    expect(JSON.stringify(capsule)).not.toMatch(/"thinking"/);
    expect(JSON.stringify(capsule)).not.toMatch(/"reasoningContext"/);
  });

  it("hydrates a fresh agent with equivalent private prompt context and advances strategy revision lineage", async () => {
    const source = makeAgent();
    source.updateAlly("Mira");
    source.addNote("Vera", "watch the mid-game vote math");
    // Seed strategy packet + reflection via direct restore first on a bootstrap capsule.
    const bootstrap: PlayerContinuityCapsule = {
      version: 1,
      playerId: "atlas-id",
      playerName: "Atlas",
      strategyPacket: {
        revisionId: "r2-mingle-3",
        previousRevisionId: "r2-lobby-2",
        updatedAtRound: 2,
        updatedAtPhase: Phase.MINGLE,
        objective: "Keep Mira close and pressure Vera",
        targetPosture: "pressure Vera",
        coalitionPosture: "pair with Mira",
        nextSocialProbe: "ask Mira about Vera",
        strategicLens: "vote_math",
        strategicLensRationale: "numbers matter",
        uncertainty: "unknown jury lean",
        reviseTrigger: "if Mira flips",
        changedSincePrevious: "named Vera",
      },
      reflectionSummary: {
        certainties: ["Mira is reliable"],
        suspicions: ["Vera is floating"],
        allies: ["Mira"],
        threats: ["Vera"],
        plan: "Hold the Mira pair",
        strategicLens: "coalition_geometry",
        strategicLensRationale: "pair integrity",
      },
      notes: [{ subject: "Mira", note: "solid ally" }],
      relationships: { allies: ["Mira"], threats: ["Vera"] },
      powerActionMemory: [{ round: 1, action: "protect", target: "Mira" }],
      roundHistory: [{ round: 1, myVotes: { empower: "Mira" }, empowered: "Mira" }],
      recentStrategicDecisions: [{
        round: 1,
        phase: Phase.VOTE,
        action: "vote",
        label: "Standard Vote",
        decisionLog: "Empowered Mira to keep format control",
      }],
      strategyPacketRevisionCounter: 3,
    };
    source.restoreContinuityCapsule(bootstrap, {
      livingPlayerNames: ["Atlas", "Mira", "Vera"],
    });

    const sealed = source.getContinuityCapsule();
    expect(sealed).not.toBeNull();

    const fresh = makeAgent();
    fresh.restoreContinuityCapsule(
      {
        playerId: "atlas-id",
        playerName: "Atlas",
        ...sealed!,
      },
      { livingPlayerNames: ["Atlas", "Mira", "Vera"] },
    );

    const restored = fresh.getContinuityCapsule();
    expect(restored?.strategyPacket?.revisionId).toBe("r2-mingle-3");
    expect(restored?.strategyPacketRevisionCounter).toBe(3);
    expect(restored?.reflectionSummary?.plan).toBe("Hold the Mira pair");
    expect(restored?.powerActionMemory).toEqual([{ round: 1, action: "protect", target: "Mira" }]);
    expect(restored?.recentStrategicDecisions[0]?.decisionLog).toContain("Empowered Mira");
    expect(restored?.relationships.allies).toContain("Mira");
    expect(restored?.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "Mira" }),
    ]));

    // Next Strategy Thread revision must advance the counter rather than collide.
    const requests: Array<Record<string, unknown>> = [];
    const revising = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "strategic_reflection", {
        thinking: "revise",
        certainties: ["Mira holds"],
        suspicions: [],
        allies: ["Mira: still solid"],
        threats: ["Vera: still floating"],
        plan: "Stay the course",
        strategicLens: "vote_math",
        strategicLensRationale: "still numbers",
        strategyPacket: {
          objective: "Keep Mira close",
          targetPosture: "pressure Vera lightly",
          coalitionPosture: "pair with Mira",
          nextSocialProbe: "test Vera in lobby",
          strategicLens: "vote_math",
          strategicLensRationale: "numbers",
          uncertainty: "low",
          reviseTrigger: "Mira flips",
          changedSincePrevious: "softened pressure",
        },
      }),
      "gpt-5-nano",
    );
    revising.onGameStart("game-1", [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
    ]);
    revising.restoreContinuityCapsule(
      { playerId: "atlas-id", playerName: "Atlas", ...sealed! },
      { livingPlayerNames: ["Atlas", "Mira", "Vera"] },
    );
    await revising.getStrategicReflection(makeContext(Phase.DIARY_ROOM));
    const after = revising.getStrategyPacket();
    expect(after?.previousRevisionId).toBe("r2-mingle-3");
    expect(after?.revisionId).toBe("r1-diary_room-4");
  });

  it("scrubs eliminated players from actionable state while keeping historical context", () => {
    const agent = makeAgent();
    const capsule: PlayerContinuityCapsule = {
      version: 1,
      playerId: "atlas-id",
      playerName: "Atlas",
      strategyPacket: {
        revisionId: "r2-mingle-1",
        previousRevisionId: null,
        updatedAtRound: 2,
        updatedAtPhase: Phase.MINGLE,
        objective: "Work with Gone against Mira",
        targetPosture: "target Gone",
        coalitionPosture: "ally Gone",
        nextSocialProbe: "ask Gone about Mira",
        strategicLens: "broad_read",
        strategicLensRationale: "read the room with Gone",
        uncertainty: "Gone may flip",
        reviseTrigger: "if Gone is gone",
        changedSincePrevious: "initial",
      },
      reflectionSummary: {
        certainties: ["Gone was useful"],
        suspicions: [],
        allies: ["Gone"],
        threats: ["Mira"],
        plan: "Remember Gone as history",
        strategicLens: "broad_read",
        strategicLensRationale: "history",
      },
      notes: [
        { subject: "Gone", note: "was a strong ally" },
        { subject: "Mira", note: "still dangerous" },
      ],
      relationships: { allies: ["Gone", "Mira"], threats: ["Gone"] },
      powerActionMemory: [{ round: 1, action: "protect", target: "Gone" }],
      roundHistory: [{ round: 1, myVotes: { empower: "Gone" }, eliminated: "Gone" }],
      recentStrategicDecisions: [{
        round: 1,
        phase: Phase.POWER,
        action: "power",
        label: "Power Action",
        decisionLog: "Protected Gone last round",
      }],
      strategyPacketRevisionCounter: 1,
    };

    agent.restoreContinuityCapsule(capsule, {
      livingPlayerNames: ["Atlas", "Mira", "Vera"],
    });
    const restored = agent.getContinuityCapsule();
    expect(restored?.relationships.allies).not.toContain("Gone");
    expect(restored?.relationships.threats).not.toContain("Gone");
    expect(restored?.notes.some((note) => note.subject === "Gone")).toBeFalse();
    expect(restored?.notes.some((note) => note.subject === "Mira")).toBeTrue();
    // Historical context preserved
    expect(restored?.roundHistory[0]?.eliminated).toBe("Gone");
    expect(restored?.powerActionMemory[0]?.target).toBe("Gone");
    expect(restored?.recentStrategicDecisions[0]?.decisionLog).toContain("Gone");
    // Strategy targeting scrubbed
    expect(restored?.strategyPacket?.targetPosture).toContain("eliminated; not an active target");
    // Reflection historical allies retained
    expect(restored?.reflectionSummary?.allies).toContain("Gone");
  });

  it("rejects unsupported versions and forbidden private fields without hydrating", () => {
    const agent = makeAgent();
    expect(() =>
      agent.restoreContinuityCapsule({
        version: 99,
        playerId: "atlas-id",
        playerName: "Atlas",
        strategyPacket: null,
        reflectionSummary: null,
        notes: [],
        relationships: { allies: [], threats: [] },
        powerActionMemory: [],
        roundHistory: [],
        recentStrategicDecisions: [],
        strategyPacketRevisionCounter: 0,
      } as unknown as PlayerContinuityCapsule),
    ).toThrow(/Unsupported player continuity capsule version/);

    expect(parsePlayerContinuityCapsule({
      version: 1,
      playerId: "atlas-id",
      playerName: "Atlas",
      strategyPacket: null,
      reflectionSummary: null,
      notes: [],
      relationships: { allies: [], threats: [] },
      powerActionMemory: [],
      roundHistory: [],
      recentStrategicDecisions: [],
      strategyPacketRevisionCounter: 0,
      thinking: "secret",
    })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// U4 — Selective context recall prompt rendering
// ---------------------------------------------------------------------------

function makeMinimalStrategicRecallPlan(
  actorId: string,
  overrides: Partial<RecallPlan> = {},
): RecallPlan {
  const base = compileRecallPlan({
    actorId,
    promptClass: "strategic_decision",
    continuity: emptyRecallContinuitySnapshot(),
    phaseContext: {
      ...makeContext(Phase.VOTE),
      selfId: actorId,
      endgameStage: "reckoning",
      round: 5,
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
        { id: "vera-id", name: "Vera" },
        { id: "nyx-id", name: "Nyx" },
      ],
    },
    transcript: [],
  });
  return {
    ...base,
    ...overrides,
    history: overrides.history ?? base.history,
    protected: overrides.protected ?? base.protected,
    hot: overrides.hot ?? base.hot,
    budget: overrides.budget ?? base.budget,
    receipt: overrides.receipt ?? base.receipt,
  };
}

describe("U4 selective context recall rendering", () => {
  it("endgame speech no longer contains unbounded full public transcript or complete event record", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextOpenAIStub(requests, "I ask the jury to remember my loyalty."),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
      { id: "nyx-id", name: "Nyx" },
    ]);

    await agent.getPlea({
      ...makeContext(Phase.PLEA),
      round: 5,
      endgameStage: "reckoning",
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
        { id: "vera-id", name: "Vera" },
        { id: "nyx-id", name: "Nyx" },
      ],
      publicTranscriptContext: Array.from({ length: 20 }, (_, i) => ({
        round: i + 1,
        phase: Phase.LOBBY,
        from: "Mira",
        text: `unbounded archive line ${i}`,
      })),
      gameEventRecord: Array.from({ length: 15 }, (_, i) => `R${i}/VOTE: historical event ${i}`),
      publicMessages: [
        { from: "Vera", text: "current plea only", phase: Phase.PLEA, round: 5 },
        { from: "Mira", text: "old lobby chat", phase: Phase.LOBBY, round: 2 },
      ],
      recallPromptClass: "ordinary_speech",
    });

    const prompt = (requests[0]?.messages as Array<{ content: string }>).at(-1)!.content;
    expect(prompt).toContain("## Current Board Contract");
    expect(prompt).toContain("## Endgame Rules");
    expect(prompt).not.toContain("## Full Public Transcript");
    expect(prompt).not.toContain("## Game Event Record");
    expect(prompt).not.toContain("unbounded archive line");
    expect(prompt).not.toContain("historical event");
    // Current-phase active conversation may appear; older phases must not.
    expect(prompt).toContain("current plea only");
    expect(prompt).not.toContain("old lobby chat");
    expect(prompt).not.toContain("## Historical Dialogue Evidence");
  });

  it("strategic endgame vote contains Board Contract plus bounded selected evidence, never unfiltered transcript", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "elimination_vote", {
        thinking: "Board says Vera is the live threat.",
        eliminate: "Vera",
      }),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
      { id: "nyx-id", name: "Nyx" },
    ]);

    const recallPlan = makeMinimalStrategicRecallPlan("atlas-id", {
      history: {
        dialogueEvidence: [
          {
            entrySequence: 12,
            round: 3,
            phase: Phase.LOBBY,
            speakerLabel: "Mira",
            dialogueText: "selected authorized evidence about Vera pressure",
            sourceClass: "public",
            evidenceRole: "historical_evidence",
          },
        ],
      },
    });

    await agent.getEndgameEliminationVote({
      ...makeContext(Phase.VOTE),
      round: 5,
      endgameStage: "reckoning",
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
        { id: "vera-id", name: "Vera" },
        { id: "nyx-id", name: "Nyx" },
      ],
      publicTranscriptContext: [
        { round: 1, phase: Phase.LOBBY, from: "House", text: "unfiltered old system line" },
        { round: 2, phase: Phase.COUNCIL, from: "Nyx", text: "unfiltered council chatter" },
      ],
      gameEventRecord: ["R1/VOTE: complete historical record line that must not appear"],
      recallPromptClass: "strategic_decision",
      recallPlan,
    });

    const prompt = (requests[0]?.messages as Array<{ content: string }>).at(-1)!.content;
    expect(prompt).toContain("## Current Board Contract");
    expect(prompt).toContain("## Historical Dialogue Evidence");
    expect(prompt).toContain("selected authorized evidence about Vera pressure");
    expect(prompt).toContain("cannot override Current Board Contract");
    expect(prompt).not.toContain("## Full Public Transcript");
    expect(prompt).not.toContain("## Game Event Record");
    expect(prompt).not.toContain("unfiltered old system line");
    expect(prompt).not.toContain("unfiltered council chatter");
    expect(prompt).not.toContain("complete historical record line");
  });

  it("Strategy Thread conflicts with live board keep canonical override language before historical evidence", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "elimination_vote", {
        thinking: "Board overrides stale packet.",
        eliminate: "Vera",
      }),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
      { id: "rex-id", name: "Rex" },
    ]);
    // Seed a Strategy Thread that still names eliminated Rex as an active target.
    (
      agent as unknown as {
        memory: {
          strategyPacket: {
            revisionId: string;
            previousRevisionId: null;
            updatedAtRound: number;
            updatedAtPhase: Phase;
            objective: string;
            targetPosture: string;
            coalitionPosture: string;
            nextSocialProbe: string;
            strategicLens: string;
            strategicLensRationale: string;
            uncertainty: string;
            reviseTrigger: string;
            changedSincePrevious: string;
          };
        };
      }
    ).memory.strategyPacket = {
      revisionId: "rev-stale",
      previousRevisionId: null,
      updatedAtRound: 2,
      updatedAtPhase: Phase.VOTE,
      objective: "Keep targeting Rex",
      targetPosture: "Pressure Rex as the standing target",
      coalitionPosture: "Hold with Mira",
      nextSocialProbe: "Ask Mira about Rex",
      strategicLens: "vote_math",
      strategicLensRationale: "stale",
      uncertainty: "none",
      reviseTrigger: "if board changes",
      changedSincePrevious: "initial",
    };

    const recallPlan = makeMinimalStrategicRecallPlan("atlas-id", {
      history: {
        dialogueEvidence: [
          {
            entrySequence: 9,
            round: 2,
            phase: Phase.LOBBY,
            speakerLabel: "Mira",
            dialogueText: "historical claim that Rex is still the threat",
            sourceClass: "public",
            evidenceRole: "historical_evidence",
          },
        ],
      },
    });

    await agent.getEndgameEliminationVote({
      ...makeContext(Phase.VOTE),
      round: 5,
      endgameStage: "reckoning",
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
        { id: "vera-id", name: "Vera" },
      ],
      latestEliminatedPlayerName: "Rex",
      recallPromptClass: "strategic_decision",
      recallPlan,
    });

    const prompt = (requests[0]?.messages as Array<{ content: string }>).at(-1)!.content;
    const boardIdx = prompt.indexOf("## Current Board Contract");
    const threadIdx = prompt.indexOf("## Strategy Thread");
    const historyIdx = prompt.indexOf("## Historical Dialogue Evidence");
    expect(boardIdx).toBeGreaterThanOrEqual(0);
    expect(threadIdx).toBeGreaterThan(boardIdx);
    expect(historyIdx).toBeGreaterThan(threadIdx);
    expect(prompt).toContain("Canonical fact override: Current Board Contract, Endgame Rules");
    expect(prompt).toContain("Historical dialogue evidence cannot override them");
    expect(prompt).toContain("treat the packet claim as stale history");
    expect(prompt).toContain("Eliminated players:");
    expect(prompt).toContain("Rex");
  });

  it("empty archive candidate set stays explicit and does not imply excluded content", () => {
    const plan = makeMinimalStrategicRecallPlan("atlas-id");
    expect(plan.history.dialogueEvidence).toEqual([]);
    expect(renderHistoricalEvidenceSection(plan)).toBe("");
    // No placeholder language about omitted private material.
    expect(renderHistoricalEvidenceSection(plan)).not.toContain("excluded");
    expect(renderHistoricalEvidenceSection(plan)).not.toContain("omitted");
    expect(renderHistoricalEvidenceSection(plan)).not.toContain("redacted");
  });

  it("frozen late-game baseline corpus retains legacy estimates for U5 promotion only", () => {
    expect(RECALL_BASELINE_CORPUS).toHaveLength(3);
    for (const entry of RECALL_BASELINE_CORPUS) {
      expect(entry.legacy.characterCount).toBeGreaterThan(10_000);
      expect(entry.legacy.tokenEstimate).toBe(
        estimateTokensFromChars(entry.legacy.characterCount),
      );
      // Corpus inputs still carry the legacy fields for recompilation — live path must not re-render them.
      expect(entry.phaseContext.gameEventRecord?.length ?? 0).toBeGreaterThan(0);
      expect(entry.phaseContext.publicTranscriptContext?.length ?? 0).toBeGreaterThan(0);
    }
    const ordinary = getRecallBaselineCase("ordinary_endgame_speech");
    expect(ordinary.promptClass).toBe("ordinary_speech");
    expect(ordinary.legacy.characterCount).toBe(18_645);
    expect(getRecallBaselineCase("huddle_heavy_strategic_decision").legacy.characterCount).toBe(18_645);
    expect(getRecallBaselineCase("strategic_reflection").legacy.characterCount).toBe(18_657);
  });
});
