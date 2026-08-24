import { describe, expect, test } from "bun:test";
import {
  Phase,
  ProviderCallBudgetExhaustedError,
  type ProviderAttemptIntent,
  type ProviderAttemptRecord,
} from "../index";
import { createLocalProviderExecutionJournal } from "../simulate";

function intent(attemptOrdinal: number): ProviderAttemptIntent {
  return {
    coordinate: {
      gameId: "game-id",
      ownerEpoch: "owner-id",
      actor: { id: "atlas", name: "Atlas", role: "player" },
      action: "vote",
      phase: Phase.VOTE,
      round: 2,
      logicalCallOrdinal: 1,
    },
    attemptOrdinal,
    attemptId: `transport-${attemptOrdinal}`,
    preparedRequest: {
      transport: "chat_completions",
      providerProfileId: "openai",
      model: "gpt-5.6-luna",
      body: { messages: [{ role: "user", content: "Vote" }] },
    },
    startedAt: `2026-08-23T00:00:0${attemptOrdinal}.000Z`,
  };
}

function failure(base: ProviderAttemptIntent): ProviderAttemptRecord {
  return {
    ...base,
    completedAt: "2026-08-23T00:00:10.000Z",
    latencyMs: 1_000,
    outcome: { kind: "refusal", message: "invalid prompt", retryable: false },
    disposition: "exhausted",
    requestId: "req-1",
    rawResponse: { status: 400, body: { error: "invalid prompt" } },
  };
}

describe("local provider attempt journal", () => {
  test("writes the API evidence envelope shape and marks terminal 429 exhaustion", async () => {
    const journal = createLocalProviderExecutionJournal({
      gameId: "game-id",
      ownerEpoch: "owner-id",
    });
    const first = intent(1);
    await journal.hooks.onReserve?.(first);
    await journal.hooks.onTerminal?.({
      ...failure(first),
      outcome: { kind: "rate_limit", message: "slow down", retryable: true },
      disposition: "retry_scheduled",
      rawResponse: { status: 429, body: { secretNoise: "not retained" } },
    });
    const second = intent(2);
    await journal.hooks.onReserve?.(second);
    await journal.hooks.onTerminal?.(failure(second));

    const artifact = journal.snapshot();
    expect(artifact.failures).toHaveLength(1);
    expect(artifact.failures[0]).toMatchObject({
      gameId: "game-id",
      ownerEpoch: "owner-id",
      attempt: {
        attemptOrdinal: 2,
        preparedRequest: { body: { messages: [{ content: "Vote" }] } },
        rawResponse: { body: { error: "invalid prompt" } },
      },
    });
    expect(artifact.rateLimits).toEqual([expect.objectContaining({
      count: 1,
      outcome: "exhausted",
      terminalReason: "invalid prompt",
    })]);
    expect(JSON.stringify(artifact.rateLimits)).not.toContain("secretNoise");
  });

  test("marks aggregated 429s recovered only after a usable result", async () => {
    const journal = createLocalProviderExecutionJournal({
      gameId: "game-id",
      ownerEpoch: "owner-id",
    });
    const first = intent(1);
    await journal.hooks.onReserve?.(first);
    await journal.hooks.onTerminal?.({
      ...failure(first),
      outcome: { kind: "rate_limit", message: "slow down", retryable: true },
      disposition: "retry_scheduled",
      rawResponse: { status: 429, body: { error: "rate limited" } },
    });
    const second = intent(2);
    await journal.hooks.onReserve?.(second);
    await journal.hooks.onTerminal?.({
      ...second,
      completedAt: "2026-08-23T00:00:10.000Z",
      latencyMs: 1_000,
      outcome: { kind: "usable" },
      disposition: "accepted",
      acceptedValue: { target: "Atlas" },
    });

    expect(journal.snapshot().rateLimits).toEqual([expect.objectContaining({
      count: 1,
      outcome: "recovered",
    })]);
  });

  test("prevents duplicate reservations", async () => {
    const journal = createLocalProviderExecutionJournal({
      gameId: "game-id",
      ownerEpoch: "owner-id",
    });
    const first = intent(1);
    await journal.hooks.onReserve?.(first);
    expect(() => journal.hooks.onReserve?.(first)).toThrow("already reserved");
  });

  test("enforces sealed fallback call caps without a remote API journal", async () => {
    const journal = createLocalProviderExecutionJournal({
      gameId: "game-id",
      ownerEpoch: "owner-id",
      providerManifest: [
        {
          catalogId: "openai:gpt-5.6-luna",
          providerProfileId: "openai",
          modelId: "gpt-5.6-luna",
        },
        {
          catalogId: "katana:glm-5-2",
          providerProfileId: "katana",
          modelId: "glm-5-2",
          maxCallsPerGame: 1,
        },
      ],
    });
    const fallback = (attemptOrdinal: number): ProviderAttemptIntent => ({
      ...intent(attemptOrdinal),
      coordinate: {
        ...intent(attemptOrdinal).coordinate,
        logicalCallOrdinal: attemptOrdinal,
      },
      preparedRequest: {
        transport: "chat_completions",
        providerProfileId: "katana",
        catalogId: "katana:glm-5-2",
        model: "glm-5-2",
        body: { messages: [{ role: "user", content: "Vote" }] },
      },
    });

    await journal.hooks.onReserve?.(fallback(1));
    expect(() => journal.hooks.onReserve?.(fallback(2))).toThrow(
      ProviderCallBudgetExhaustedError,
    );
  });

  test("keeps artifact writer failures nonfatal", async () => {
    const journal = createLocalProviderExecutionJournal({
      gameId: "game-id",
      ownerEpoch: "owner-id",
      onChange: () => {
        throw new Error("disk unavailable");
      },
    });
    const first = intent(1);
    expect(() => journal.hooks.onReserve?.(first)).not.toThrow();
    expect(() => journal.hooks.onTerminal?.(failure(first))).not.toThrow();
    expect(journal.snapshot().failures).toHaveLength(1);
  });
});
