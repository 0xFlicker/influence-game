import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  hashCanonicalJson,
  type FrozenCaseArtifact,
  type JsonObject,
} from "@influence/prompt-lab-protocol";
import { GameState } from "../game-state";
import {
  capturePromptThreadReplay,
  runPromptThreadGeneratedCell,
  runPromptThreadMingleIntentProbe,
  runPromptThreadSourceGate,
  verifyPromptThreadSourceFidelity,
} from "../prompt-thread-lab";
import { Phase } from "../types";

const ROSTER = [
  { id: "a", name: "A", personality: "strategic" },
  { id: "b", name: "B", personality: "social" },
  { id: "c", name: "C", personality: "observer" },
  { id: "d", name: "D", personality: "honest" },
  { id: "e", name: "E", personality: "broker" },
] as const;

function continuity(playerId: string, playerName: string) {
  return {
    version: 2,
    playerId,
    playerName,
    compactStrategy: {
      lifecycle: "opening",
      baseline: null,
      deltas: [],
      priorEpoch: null,
      revision: 0,
    },
    notes: [],
    relationships: { allies: [], threats: [] },
    powerActionMemory: [],
    roundHistory: [],
  };
}

function intent(actorId: string, other: string, round = 1) {
  return {
    manifestId: `intent-${actorId}`,
    actorId,
    action: "mingle-intent",
    byteLength: 1,
    sha256: hashCanonicalJson(actorId),
    body: {
      version: 2,
      actor: { id: actorId, name: actorId.toUpperCase(), role: "player" },
      action: "mingle-intent",
      phase: Phase.MINGLE_I,
      round,
      model: { name: "fixture-model" },
      requestedReasoningEffort: "low",
      reasoningPolicy: "action-policy",
      prompt: { messages: [] },
      request: { transportOnly: "source-request-id" },
      output: {
        seekPlayers: [other],
        avoidPlayers: [],
        preferredRoomSize: "pair",
        purpose: `Compare notes with ${other}`,
        provisionalTarget: null,
        noTargetReason: "Still gathering evidence",
        openingAsk: `Ask ${other} what changed`,
        strategicLens: "broad_read",
        strategicLensRationale: "Use the room to compare reads.",
        decisionLog: `Keep ${other} close for this vote.`,
        thinking: "fixture intent",
      },
    },
  };
}

function speech(
  id: string,
  actorId: string,
  message: string,
  gotoRoomId: number | null = null,
  round = 1,
  gotoPlayerName: string | null = null,
) {
  return {
    manifestId: id,
    actorId,
    action: "mingle-turn",
    byteLength: 1,
    sha256: hashCanonicalJson(id),
    body: {
      version: 2,
      actor: { id: actorId, name: actorId.toUpperCase(), role: "player" },
      action: "mingle-turn",
      phase: Phase.MINGLE_I,
      round,
      model: { name: "fixture-model" },
      requestedReasoningEffort: "low",
      reasoningPolicy: "action-policy",
      prompt: { messages: [] },
      request: { transportOnly: "source-request-id" },
      output: {
        message,
        noReply: false,
        gotoRoomId,
        gotoPlayerName,
        proposedTarget: null,
        proposedAction: null,
        commitment: null,
        noProposalReason: null,
        decisionLog: `Recorded ${id}`,
        thinking: `Thinking ${id}`,
      },
    },
  };
}

function caseFixture(options: { resolvedPriorVote?: boolean } = {}): FrozenCaseArtifact {
  const source = new GameState(
    ROSTER.map(({ id, name }) => ({ id, name })),
    { gameId: "prompt-thread-fixture", now: () => 1_700_000_000_000 },
  );
  source.startRound();
  if (options.resolvedPriorVote) {
    source.recordVote("a", "b");
    source.recordVote("b", "a");
    source.recordVote("c", "b");
    source.recordVote("d", "b");
    source.recordVote("e", "b");
    source.tallyEmpowerVotes();
    source.startRound();
  }
  const round = source.round;
  const privateData = {
    version: 1,
    materializerVersion: "test/v1",
    baselineClaim: "trace_observable_message_equivalent",
    selection: {
      gameId: "prompt-thread-fixture",
      boundarySequence: source.getCanonicalEvents().length,
      phase: Phase.MINGLE_I,
      round,
      actorIds: ["a", "b"],
      targetManifestIds: ["turn-a-1", "turn-b-1", "turn-a-2", "turn-b-2"],
      intentManifestIds: ["intent-a", "intent-b"],
    },
    startingState: {
      canonicalEvents: source.getCanonicalEvents(),
      canonicalProjection: source.getDomainProjection(),
      config: {},
      roster: ROSTER.map((player) => ({
        id: player.id,
        persona: {
          name: player.name,
          personality: player.personality,
        },
        agentConfig: {
          model: "fixture-model",
          catalogId: "fixture-catalog",
          reasoningPolicy: "action-policy",
          providerProfileId: "openai",
        },
      })),
      continuity: {
        playerContinuityCapsules: [
          continuity("a", "A"),
          continuity("b", "B"),
        ],
      },
      transcriptReplay: [],
      historyCatalog: [],
      roomSchedule: [
        { roomId: 2, round, beat: 1, playerIds: ["a", "b"], playerCount: 2 },
        { roomId: 2, round, beat: 2, playerIds: ["a", "b"], playerCount: 2 },
      ],
      roomCounts: [
        {
          beat: 1,
          rooms: [
            { roomId: 1, playerCount: 1 },
            { roomId: 2, playerCount: 2 },
            { roomId: 3, playerCount: 2 },
          ],
        },
        {
          beat: 2,
          rooms: [
            { roomId: 1, playerCount: 1 },
            { roomId: 2, playerCount: 2 },
            { roomId: 3, playerCount: 2 },
          ],
        },
      ],
    },
    traces: [
      intent("a", "B", round),
      intent("b", "A", round),
      speech("turn-a-1", "a", "A opens", null, round, "B"),
      speech("turn-b-1", "b", "B answers", 3, round),
      speech("turn-a-2", "a", "A returns", null, round),
      speech("turn-b-2", "b", "B closes", null, round),
    ],
    fidelityContract: {
      canonicalizerId: "influence-canonical-json",
      canonicalizerVersion: "1",
      bytePreservingMessageContent: true,
      transportOnlyExclusions: ["request.transportOnly"],
    },
  } as unknown as JsonObject;
  return {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "frozen_case",
    createdAt: "2026-07-28T00:00:00.000Z",
    caseId: hashCanonicalJson(privateData),
    sourceReceiptHash: hashCanonicalJson("source"),
    privateData,
  };
}

function withCapturedSource(
  fixture: FrozenCaseArtifact,
  traces: Awaited<ReturnType<typeof capturePromptThreadReplay>>["traces"],
): FrozenCaseArtifact {
  const privateData = structuredClone(fixture.privateData);
  const stored = privateData.traces as Array<Record<string, unknown>>;
  for (let index = 0; index < stored.length; index += 1) {
    const body = stored[index]!.body as Record<string, unknown>;
    const captured = traces[index]!;
    body.prompt = structuredClone(captured.prompt);
    body.request = {
      ...(structuredClone(captured.request) as Record<string, unknown>),
      transportOnly: `different-${index}`,
    };
    body.model = structuredClone(captured.model);
    if (captured.requestedReasoningEffort !== undefined) {
      body.requestedReasoningEffort = captured.requestedReasoningEffort;
    } else {
      delete body.requestedReasoningEffort;
    }
    if (captured.reasoningPolicy !== undefined) {
      body.reasoningPolicy = captured.reasoningPolicy;
    } else {
      delete body.reasoningPolicy;
    }
    if (captured.toolName !== undefined) {
      body.toolName = captured.toolName;
    } else {
      delete body.toolName;
    }
    if (captured.promptReuse !== undefined) {
      body.promptReuse = structuredClone(captured.promptReuse);
    } else {
      delete body.promptReuse;
    }
  }
  return {
    ...fixture,
    caseId: hashCanonicalJson(privateData),
    privateData,
  };
}

async function runIntentProbeWorker(stdin: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(import.meta.dir, "../prompt-thread-worker.ts"),
      "intent-probe",
    ],
    {
      cwd: resolve(import.meta.dir, "../../../.."),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  child.stdin.write(stdin);
  child.stdin.end();
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("real prompt-thread replay", () => {
  test("captures the two strategic intent selections without running continuation turns", async () => {
    const fixture = caseFixture();
    const result = await runPromptThreadMingleIntentProbe(fixture);

    expect(result.caseId).toBe(fixture.caseId);
    expect(result.providerCalls).toBe(0);
    expect(result.probes).toHaveLength(2);
    expect(result.probes.map(({ actorId, action, promptClass }) => ({
      actorId,
      action,
      promptClass,
    }))).toEqual([
      { actorId: "a", action: "mingle-intent", promptClass: "strategic_decision" },
      { actorId: "b", action: "mingle-intent", promptClass: "strategic_decision" },
    ]);
    expect(result.probes.every(({ laneSummary, budget, items }) => (
      laneSummary.authorizedHistoryCount === items.length
      && budget.envelopeChars > 0
    ))).toBe(true);
  });

  test("runs the provider-free intent probe through the worker stdin/stdout boundary", async () => {
    const fixture = caseFixture();
    const completed = await runIntentProbeWorker(JSON.stringify(fixture));
    const result = JSON.parse(completed.stdout) as {
      status: "completed";
      probe: Awaited<ReturnType<typeof runPromptThreadMingleIntentProbe>>;
    };

    expect(completed).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(result.status).toBe("completed");
    expect(result.probe).toMatchObject({
      caseId: fixture.caseId,
      providerCalls: 0,
    });

    const malformed = await runIntentProbeWorker("{");
    expect(malformed.exitCode).not.toBe(0);
    expect(malformed.stdout).toBe("");
    expect(JSON.parse(malformed.stderr)).toEqual({
      code: "worker_failed",
    });
  });

  test("hydrates canonical revealed votes and preserves the configured phase beat count", async () => {
    const fixture = caseFixture({ resolvedPriorVote: true });
    const roster = (fixture.privateData.startingState as JsonObject).roster as Array<{
      agentConfig: Record<string, unknown>;
    }>;
    for (const player of roster) {
      player.agentConfig.model = "gpt-5.4-nano";
    }
    fixture.caseId = hashCanonicalJson(fixture.privateData);
    const capture = await capturePromptThreadReplay(fixture);
    const firstTurnUser = capture.traces[2]?.prompt.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n") ?? "";
    const returningTurnUser = capture.traces[4]?.prompt.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n") ?? "";

    expect(firstTurnUser).toContain("## Revealed Vote Ledger");
    expect(firstTurnUser).toContain("A: empowered B");
    expect(firstTurnUser).toContain("E: empowered B");
    expect(returningTurnUser).toContain(
      "This is Mingle turn 2 of 3; 1 Mingle turn remains after this.",
    );
    expect(returningTurnUser).not.toContain(
      "This is your final Mingle turn this phase.",
    );
    expect(capture.traces[2]?.promptReuse?.requestShape).toBe("openai.responses");

    const accepted = withCapturedSource(fixture, capture.traces);
    const acceptedCapture = await capturePromptThreadReplay(accepted);
    expect(
      verifyPromptThreadSourceFidelity(accepted, acceptedCapture).status,
    ).toBe("matched");
  });

  test("replays intents and A-B-A-B turns with exact inbox/beat and checkpoint semantics", async () => {
    const fixture = caseFixture();
    const capture = await capturePromptThreadReplay(fixture);

    expect(capture.actorOrder).toEqual(["a", "b", "a", "b"]);
    expect(capture.turns.map((turn) => turn.conversationHistoryBefore)).toEqual([
      [],
      [{ from: "A", text: "A opens" }],
      [],
      [{ from: "A", text: "A returns" }],
    ]);
    expect(capture.turns.map((turn) => turn.inboxBefore)).toEqual([
      [],
      [{ from: "A", text: "A opens" }],
      [{ from: "B", text: "B answers" }],
      [
        { from: "A", text: "A opens" },
        { from: "A", text: "A returns" },
      ],
    ]);
    expect(capture.checkpoints).toHaveLength(4);
    expect(capture.checkpoints.map((checkpoint) => checkpoint.turn)).toEqual([1, 2, 3, 4]);
    expect(capture.movementRecords[0]).toMatchObject({
      toRoomId: 2,
      requestedToRoomId: 3,
      movementApplied: false,
      gotoStatus: "player_valid",
    });
    expect(capture.traces.slice(0, 2).map((trace) => trace.action))
      .toEqual(["mingle-intent", "mingle-intent"]);
    expect(capture.traces[2]?.request).toMatchObject({
      catalogId: "fixture-catalog",
    });

    const accepted = withCapturedSource(fixture, capture.traces);
    const acceptedCapture = await capturePromptThreadReplay(accepted);
    expect(verifyPromptThreadSourceFidelity(accepted, acceptedCapture).status).toBe("matched");
    expect((await runPromptThreadSourceGate(accepted)).receipt.status).toBe("matched");

    const fresh = await capturePromptThreadReplay(fixture);
    expect(fresh.turns[0]?.inboxBefore).toEqual([]);
    expect(fresh.actorOrder).toEqual(capture.actorOrder);
    expect(fresh.checkpoints).toHaveLength(4);
  });

  test("rebuilds a generated branch from saved responses before each brokered cell", async () => {
    const fixture = caseFixture();
    const previousResponses: unknown[] = [];
    for (const turn of [1, 2, 3, 4] as const) {
      let calls = 0;
      const result = await runPromptThreadGeneratedCell(fixture, {
        turn,
        model: "gpt-5.4-nano-2026-03-17",
        promptCacheKey: `opaque-${turn % 2}`,
        previousResponses,
        dispatch: async (request) => {
          calls += 1;
          expect(request.model).toBe("gpt-5.4-nano-2026-03-17");
          expect(request.prompt_cache_key).toBe(`opaque-${turn % 2}`);
          return generatedResponse(turn);
        },
      });
      expect(calls).toBe(1);
      expect(result.capture.turns).toHaveLength(turn);
      expect(result.checkpoint.turn).toBe(turn);
      previousResponses.push(result.response);
    }
    expect(previousResponses).toHaveLength(4);
  });

  test("fails on the first changed byte but ignores only the explicit transport exclusion", async () => {
    const fixture = caseFixture();
    const capture = await capturePromptThreadReplay(fixture);
    const accepted = withCapturedSource(fixture, capture.traces);
    const acceptedCapture = await capturePromptThreadReplay(accepted);
    expect(() => verifyPromptThreadSourceFidelity(accepted, acceptedCapture)).not.toThrow();
    const unprovenEnvelopeChange = structuredClone(accepted);
    const unprovenTraces = unprovenEnvelopeChange.privateData.traces as Array<Record<string, unknown>>;
    const unprovenBody = unprovenTraces[2]!.body as Record<string, unknown>;
    unprovenBody.request = {
      ...(unprovenBody.request as Record<string, unknown>),
      catalogId: "unavailable-historical-routing",
      transportOnly: "different-transport",
    };
    unprovenEnvelopeChange.caseId = hashCanonicalJson(
      unprovenEnvelopeChange.privateData,
    );
    const unprovenCapture = await capturePromptThreadReplay(
      unprovenEnvelopeChange,
    );
    expect(() => verifyPromptThreadSourceFidelity(
      unprovenEnvelopeChange,
      unprovenCapture,
    )).not.toThrow();

    const changed = structuredClone(accepted);
    const traces = changed.privateData.traces as Array<Record<string, unknown>>;
    const prompt = (traces[2]!.body as Record<string, unknown>).prompt as {
      messages: Array<{ role: string; content: string }>;
    };
    prompt.messages[0]!.content += " ";
    changed.caseId = hashCanonicalJson(changed.privateData);
    const changedCapture = await capturePromptThreadReplay(changed);
    expect(() => verifyPromptThreadSourceFidelity(changed, changedCapture))
      .toThrow("turn 1 lane prompt.messages");
  });

  test("rejects mutated source state and missing intent before provider setup", async () => {
    const missingIntent = caseFixture();
    (missingIntent.privateData.traces as unknown[]).shift();
    missingIntent.caseId = hashCanonicalJson(missingIntent.privateData);
    let setups = 0;
    await expect(capturePromptThreadReplay(missingIntent, {
      onDeterministicProviderSetup: () => {
        setups += 1;
      },
    })).rejects.toThrow("six ordered traces");
    expect(setups).toBe(0);

    const mutated = caseFixture();
    (mutated.privateData.startingState as JsonObject).canonicalProjection = {
      changed: true,
    };
    mutated.caseId = hashCanonicalJson(mutated.privateData);
    await expect(capturePromptThreadReplay(mutated, {
      onDeterministicProviderSetup: () => {
        setups += 1;
      },
    })).rejects.toThrow("projection");
    expect(setups).toBe(0);
  });
});

function generatedResponse(turn: number): Record<string, unknown> {
  const outputText = JSON.stringify({
    thinking: `thinking ${turn}`,
    message: `generated turn ${turn}`,
    noReply: false,
    gotoRoomId: null,
    gotoPlayerName: null,
    proposedTarget: null,
    proposedAction: null,
    commitment: null,
    noProposalReason: null,
    decisionLog: `generated ${turn}`,
  });
  return {
    id: `generated-${turn}`,
    object: "response",
    status: "completed",
    service_tier: "flex",
    output_text: outputText,
    output: [{
      id: `message-${turn}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: outputText }],
    }],
    usage: {
      input_tokens: 2_000,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 100,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2_100,
    },
  };
}
