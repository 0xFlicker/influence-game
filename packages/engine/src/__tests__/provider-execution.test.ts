import { describe, expect, it } from "bun:test";
import { APIUserAbortError } from "openai";
import {
  ProviderAttemptError,
  ProviderAcceptedValueIntegrityError,
  ProviderCallBudgetExhaustedError,
  ProviderCircuitOpenError,
  ProviderExecutionCoordinator,
  assertProviderSemanticCoordinate,
  canonicalProviderSemanticCoordinate,
  classifyResponsesTerminalOutcome,
  createProviderEvidenceFetch,
  providerSemanticCoordinateHash,
  sanitizeProviderEvidence,
  type ProviderAttemptRecord,
  type ProviderLogicalCallCoordinate,
} from "../provider-execution";
import { Phase } from "../types";

const coordinate: ProviderLogicalCallCoordinate = {
  gameId: "game-1",
  actor: { id: "atlas-id", name: "Atlas", role: "player" },
  action: "vote",
  round: 2,
  phase: Phase.VOTE,
  semantic: {
    version: 1,
    kind: "phase_call",
    phase: Phase.VOTE,
    round: 2,
    canonicalEventSequence: 1,
    callSlot: 1,
  },
};

describe("ProviderExecutionCoordinator", () => {
  it("canonically hashes closed semantic coordinates and rejects malformed variants", () => {
    const diary = {
      version: 1 as const,
      kind: "diary_exchange" as const,
      sessionEventSequence: 19,
      playerId: "atlas-id",
      exchangeOrdinal: 2,
    };
    const sameDiary = {
      playerId: "atlas-id",
      exchangeOrdinal: 2,
      kind: "diary_exchange" as const,
      sessionEventSequence: 19,
      version: 1 as const,
    };
    const adjacentDiary = { ...diary, exchangeOrdinal: 3 };

    expect(canonicalProviderSemanticCoordinate(sameDiary)).toBe(
      canonicalProviderSemanticCoordinate(diary),
    );
    expect(providerSemanticCoordinateHash(sameDiary)).toBe(
      providerSemanticCoordinateHash(diary),
    );
    expect(providerSemanticCoordinateHash(adjacentDiary)).not.toBe(
      providerSemanticCoordinateHash(diary),
    );
    expect(() => assertProviderSemanticCoordinate({
      version: 2,
      kind: "diary_exchange",
      sessionEventSequence: 19,
      playerId: "atlas-id",
      exchangeOrdinal: 2,
    } as never)).toThrow("version must be 1");
    expect(() => assertProviderSemanticCoordinate({
      version: 1,
      kind: "unknown",
    } as never)).toThrow("kind is invalid");
    expect(() => assertProviderSemanticCoordinate({
      version: 1,
      kind: "diary_exchange",
      sessionEventSequence: 19,
      playerId: "atlas-id",
      exchangeOrdinal: 0,
    } as never)).toThrow("exchangeOrdinal must be a positive safe integer");
    for (const closedCoordinate of [
      {
        version: 1,
        kind: "phase_call",
        phase: Phase.VOTE,
        round: 2,
        canonicalEventSequence: 1,
        callSlot: 1,
      },
      diary,
      { version: 1, kind: "alliance_huddle", scheduleId: "schedule-1", exchangeOrdinal: 1 },
      { version: 1, kind: "durable_turn", turnId: "turn-1", subcallSlot: 1 },
      { version: 1, kind: "provider_health", providerProfileId: "katana", revision: 1 },
    ] as const) {
      expect(() => assertProviderSemanticCoordinate({
        ...closedCoordinate,
        untrustedExtra: true,
      } as never)).toThrow("fields are not exact");
    }
  });

  it("returns a durably accepted manifest value without allocating or dispatching", async () => {
    let allocations = 0;
    let dispatches = 0;
    const coordinator = new ProviderExecutionCoordinator({
      hooks: {
        onReadAccepted: () => ({
          attemptId: "attempt-accepted",
          attemptOrdinal: 2,
          catalogId: "katana:glm-5-2",
          value: { target: "maya" },
        }),
        onAllocateAttemptOrdinal: () => {
          allocations += 1;
          return 3;
        },
      },
    });

    const result = await coordinator.startCall(coordinate).executeManifest({
      entries: [{
        catalogId: "katana:glm-5-2",
        preparedRequest: {
          transport: "chat_completions",
          providerProfileId: "katana",
          catalogId: "katana:glm-5-2",
          model: "glm-5-2",
          body: { model: "glm-5-2" },
        },
        maxAttempts: 1,
        dispatch: async () => {
          dispatches += 1;
          return { target: "orion" };
        },
        validate: (response) => ({ status: "usable", value: response }),
      }],
    });

    expect(result).toEqual({
      value: { target: "maya" },
      catalogId: "katana:glm-5-2",
      manifestPosition: 0,
      acceptedAttemptId: "attempt-accepted",
      acceptedAttemptOrdinal: 2,
    });
    expect(allocations).toBe(0);
    expect(dispatches).toBe(0);
  });

  it("revalidates and decodes a durable accepted value before replay", async () => {
    let dispatches = 0;
    const coordinator = new ProviderExecutionCoordinator({
      hooks: {
        onReadAccepted: () => ({
          attemptId: "attempt-accepted",
          attemptOrdinal: 2,
          catalogId: "katana:glm-5-2",
          value: { targetPlayerId: "maya-id" },
        }),
      },
    });
    const result = await coordinator.startCall(coordinate).executeManifest({
      entries: [{
        catalogId: "katana:glm-5-2",
        preparedRequest: {
          transport: "chat_completions",
          providerProfileId: "katana",
          catalogId: "katana:glm-5-2",
          model: "glm-5-2",
          body: {},
        },
        maxAttempts: 1,
        dispatch: async () => {
          dispatches += 1;
          return { targetPlayerId: "other-id" };
        },
        validate: (value) => ({ status: "usable", value }),
      }],
      validateAcceptedValue: (value) => {
        const targetPlayerId = value && typeof value === "object"
          ? (value as Record<string, unknown>).targetPlayerId
          : undefined;
        return targetPlayerId === "maya-id"
          ? { status: "valid", value: { targetPlayerId } }
          : { status: "invalid", message: "accepted target is no longer legal" };
      },
    });

    expect(result.value).toEqual({ targetPlayerId: "maya-id" });
    expect(dispatches).toBe(0);
  });

  it("fails replay integrity without retry, fallback, terminal hooks, or dispatch", async () => {
    let allocations = 0;
    let dispatches = 0;
    let terminals = 0;
    let retries = 0;
    const coordinator = new ProviderExecutionCoordinator({
      hooks: {
        onReadAccepted: () => ({
          attemptOrdinal: 1,
          catalogId: "openai:primary",
          value: { targetPlayerId: "eliminated-id" },
        }),
        onAllocateAttemptOrdinal: () => {
          allocations += 1;
          return 2;
        },
        onTerminal: () => { terminals += 1; },
      },
    });
    const entry = (catalogId: string) => ({
      catalogId,
      preparedRequest: {
        transport: "responses",
        providerProfileId: "openai" as const,
        catalogId,
        model: catalogId,
        body: {},
      },
      maxAttempts: 2,
      dispatch: async () => {
        dispatches += 1;
        return { targetPlayerId: "legal-id" };
      },
      validate: (value: { targetPlayerId: string }) => ({ status: "usable" as const, value }),
      onRetry: () => { retries += 1; },
    });

    await expect(coordinator.startCall(coordinate).executeManifest({
      entries: [entry("openai:primary"), entry("openai:fallback")],
      validateAcceptedValue: () => ({
        status: "invalid",
        message: "accepted target is no longer legal",
      }),
    })).rejects.toBeInstanceOf(ProviderAcceptedValueIntegrityError);
    expect({ allocations, dispatches, terminals, retries }).toEqual({
      allocations: 0,
      dispatches: 0,
      terminals: 0,
      retries: 0,
    });
  });

  it("traverses the sealed manifest after refusal and starts the next logical call at primary", async () => {
    const dispatches: string[] = [];
    const coordinator = new ProviderExecutionCoordinator({
      wait: async () => undefined,
    });
    const entry = (
      catalogId: string,
      response: { ok: boolean },
    ) => ({
      catalogId,
      preparedRequest: {
        transport: "chat_completions" as const,
        providerProfileId: catalogId.startsWith("openai:")
          ? "openai" as const
          : "katana" as const,
        catalogId,
        model: catalogId.split(":")[1]!,
        body: { model: catalogId.split(":")[1] },
      },
      maxAttempts: 2,
      dispatch: async () => {
        dispatches.push(catalogId);
        return response;
      },
      validate: (candidate: { ok: boolean }) => candidate.ok
        ? { status: "usable" as const, value: candidate }
        : {
            status: "unusable" as const,
            kind: "refusal" as const,
            message: "invalid prompt",
            retryable: false,
          },
    });

    const first = await coordinator.startCall(coordinate).executeManifest({
      entries: [
        entry("openai:gpt-primary", { ok: false }),
        entry("katana:grok-fallback", { ok: true }),
      ],
    });
    expect(first).toMatchObject({
      catalogId: "katana:grok-fallback",
      manifestPosition: 1,
      value: { ok: true },
    });

    const second = await coordinator.startCall({
      ...coordinate,
      semantic: {
        version: 1,
        kind: "phase_call",
        phase: Phase.VOTE,
        round: 2,
        canonicalEventSequence: 1,
        callSlot: 2,
      },
    }).executeManifest({
      entries: [
        entry("openai:gpt-primary", { ok: true }),
        entry("katana:grok-fallback", { ok: true }),
      ],
    });
    expect(second.catalogId).toBe("openai:gpt-primary");
    expect(dispatches).toEqual([
      "openai:gpt-primary",
      "katana:grok-fallback",
      "openai:gpt-primary",
    ]);
  });

  it("skips a fallback whose durable dispatch budget is exhausted", async () => {
    const dispatches: string[] = [];
    const coordinator = new ProviderExecutionCoordinator({
      hooks: {
        onReserve: (intent) => {
          if (intent.preparedRequest.catalogId === "katana:grok") {
            throw new ProviderCallBudgetExhaustedError("katana:grok", 1, 1);
          }
        },
      },
      wait: async () => undefined,
    });
    const makeEntry = (catalogId: string, usable: boolean) => ({
      catalogId,
      preparedRequest: {
        transport: "chat_completions" as const,
        providerProfileId: catalogId.startsWith("openai:")
          ? "openai" as const
          : "katana" as const,
        catalogId,
        model: catalogId,
        body: { model: catalogId },
      },
      maxAttempts: 1,
      dispatch: async () => {
        dispatches.push(catalogId);
        return { usable };
      },
      validate: (candidate: { usable: boolean }) => candidate.usable
        ? { status: "usable" as const, value: candidate }
        : {
            status: "unusable" as const,
            kind: "service_error" as const,
            message: "unavailable",
            retryable: true,
          },
    });

    const result = await coordinator.startCall(coordinate).executeManifest({
      entries: [
        makeEntry("openai:primary", false),
        makeEntry("katana:grok", true),
        makeEntry("katana:glm", true),
      ],
    });
    expect(result.catalogId).toBe("katana:glm");
    expect(dispatches).toEqual(["openai:primary", "katana:glm"]);
  });

  it("halts the manifest when the primary provider circuit is open", async () => {
    const dispatches: string[] = [];
    const coordinator = new ProviderExecutionCoordinator({
      hooks: {
        onReserve: (intent) => {
          if (intent.preparedRequest.catalogId === "openai:primary") {
            throw new ProviderCircuitOpenError(
              "openai:primary",
              "provider:openai",
              4,
              true,
            );
          }
        },
      },
    });
    const entry = (catalogId: string) => ({
      catalogId,
      preparedRequest: {
        transport: "chat_completions" as const,
        providerProfileId: catalogId.startsWith("openai:")
          ? "openai" as const
          : "katana" as const,
        catalogId,
        model: catalogId,
        body: { model: catalogId },
      },
      maxAttempts: 1,
      dispatch: async () => {
        dispatches.push(catalogId);
        return { usable: true };
      },
      validate: (value: { usable: boolean }) => ({ status: "usable" as const, value }),
    });

    await expect(coordinator.startCall(coordinate).executeManifest({
      entries: [entry("openai:primary"), entry("katana:grok")],
    })).rejects.toMatchObject({
      name: "ProviderCircuitOpenError",
      scopeKey: "provider:openai",
      haltManifest: true,
    });
    expect(dispatches).toEqual([]);
  });

  it("skips an entry-scoped circuit and reaches the next fallback", async () => {
    const dispatches: string[] = [];
    const coordinator = new ProviderExecutionCoordinator({
      hooks: {
        onReserve: (intent) => {
          if (intent.preparedRequest.catalogId === "katana:grok") {
            throw new ProviderCircuitOpenError(
              "katana:grok",
              "entry:katana:grok",
              2,
              false,
            );
          }
        },
      },
    });
    const entry = (catalogId: string, usable: boolean) => ({
      catalogId,
      preparedRequest: {
        transport: "chat_completions" as const,
        providerProfileId: catalogId.startsWith("openai:")
          ? "openai" as const
          : "katana" as const,
        catalogId,
        model: catalogId,
        body: { model: catalogId },
      },
      maxAttempts: 1,
      dispatch: async () => {
        dispatches.push(catalogId);
        return { usable };
      },
      validate: (value: { usable: boolean }) => value.usable
        ? { status: "usable" as const, value }
        : {
            status: "unusable" as const,
            kind: "refusal" as const,
            message: "request-specific refusal",
            retryable: false,
          },
    });

    const result = await coordinator.startCall(coordinate).executeManifest({
      entries: [
        entry("openai:primary", false),
        entry("katana:grok", true),
        entry("katana:glm", true),
      ],
    });
    expect(result.catalogId).toBe("katana:glm");
    expect(dispatches).toEqual(["openai:primary", "katana:glm"]);
  });

  it("records one visible ordinal per dispatch and owns bounded retries", async () => {
    const records: ProviderAttemptRecord[] = [];
    const waits: number[] = [];
    let dispatches = 0;
    const coordinator = new ProviderExecutionCoordinator({
      hooks: {
        onTerminal: (record) => {
          records.push(record);
        },
      },
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });
    const call = coordinator.startCall(coordinate);

    const value = await call.execute({
      preparedRequest: {
        transport: "chat_completions",
        providerProfileId: "openai",
        model: "gpt-test",
        body: {
          model: "gpt-test",
          messages: [{ role: "user", content: "Vote." }],
        },
      },
      maxAttempts: 2,
      dispatch: async () => {
        dispatches += 1;
        if (dispatches === 1) {
          throw Object.assign(new Error("temporarily unavailable"), {
            status: 503,
          });
        }
        return { choices: [{ message: { content: "ok" } }] };
      },
      validate: (response) => ({
        status: "usable",
        value: response.choices[0]!.message.content,
      }),
    });

    expect(value).toBe("ok");
    expect(dispatches).toBe(2);
    expect(waits).toEqual([1_000]);
    expect(records.map((record) => record.attemptOrdinal)).toEqual([1, 2]);
    expect(records.map((record) => record.outcome.kind)).toEqual([
      "service_error",
      "usable",
    ]);
    expect(records.map((record) => record.disposition)).toEqual([
      "retry_scheduled",
      "accepted",
    ]);
  });

  it("fails fast when local validation throws instead of retrying or advancing the manifest", async () => {
    const records: ProviderAttemptRecord[] = [];
    const dispatches: string[] = [];
    const call = new ProviderExecutionCoordinator({
      hooks: { onTerminal: (record) => { records.push(record); } },
      wait: async () => undefined,
    }).startCall(coordinate);

    await expect(call.executeManifest({
      entries: [
        {
          catalogId: "openai:primary",
          preparedRequest: {
            transport: "chat_completions",
            providerProfileId: "openai",
            catalogId: "openai:primary",
            model: "primary",
            body: { model: "primary" },
          },
          maxAttempts: 3,
          dispatch: async () => {
            dispatches.push("openai:primary");
            return { choices: [] };
          },
          validate: () => {
            throw new TypeError("validator contract bug");
          },
        },
        {
          catalogId: "katana:fallback",
          preparedRequest: {
            transport: "chat_completions",
            providerProfileId: "katana",
            catalogId: "katana:fallback",
            model: "fallback",
            body: { model: "fallback" },
          },
          maxAttempts: 1,
          dispatch: async () => {
            dispatches.push("katana:fallback");
            return { choices: [{ message: { content: "fallback" } }] };
          },
          validate: (response) => ({ status: "usable", value: response }),
        },
      ],
    })).rejects.toThrow("validator contract bug");

    expect(dispatches).toEqual(["openai:primary"]);
    expect(records).toEqual([]);
  });

  it("uses durable attempt ordinals when a logical call is reconstructed", async () => {
    const allocated = [3, 4];
    const preparedOrdinals: number[] = [];
    const dispatchOrdinals: number[] = [];
    const records: ProviderAttemptRecord[] = [];
    const coordinator = new ProviderExecutionCoordinator({
      hooks: {
        onAllocateAttemptOrdinal: () => allocated.shift()!,
        onTerminal: (record) => {
          records.push(record);
        },
      },
      wait: async () => undefined,
    });

    await expect(coordinator.startCall(coordinate).execute({
      preparedRequest: (attemptOrdinal) => {
        preparedOrdinals.push(attemptOrdinal);
        return {
          transport: "chat_completions",
          providerProfileId: "openai",
          model: "gpt-test",
          body: { model: "gpt-test", attemptOrdinal },
        };
      },
      maxAttempts: 2,
      dispatch: async ({ attemptOrdinal }) => {
        dispatchOrdinals.push(attemptOrdinal);
        if (attemptOrdinal === 3) {
          throw Object.assign(new Error("temporarily unavailable"), {
            status: 503,
          });
        }
        return { choices: [{ message: { content: "ok" } }] };
      },
      validate: (response) => ({
        status: "usable",
        value: response.choices[0]!.message.content,
      }),
    })).resolves.toBe("ok");

    expect(preparedOrdinals).toEqual([3, 4]);
    expect(dispatchOrdinals).toEqual([3, 4]);
    expect(records.map((record) => record.attemptOrdinal)).toEqual([3, 4]);
  });

  it("captures safe usage and router billing facts before terminal hooks run", async () => {
    const records: ProviderAttemptRecord[] = [];
    const value = await new ProviderExecutionCoordinator({
      hooks: { onTerminal: (record) => { records.push(record); } },
    })
      .startCall(coordinate)
      .execute({
        preparedRequest: {
          transport: "chat_completions",
          providerProfileId: "katana",
          catalogId: "katana:glm-5-2",
          model: "glm-5-2",
          body: { model: "glm-5-2", messages: [{ role: "user", content: "Vote." }] },
        },
        maxAttempts: 1,
        dispatch: async () => ({
          id: "chatcmpl-katana",
          choices: [{ finish_reason: "stop", message: { content: "Maya" } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_tokens_details: { cached_tokens: 25 },
            completion_tokens_details: { reasoning_tokens: 5 },
            imgnai: {
              credits_charged: 0.1,
              provider_cost_usd: 0.0042,
              prompt: "must not enter accounting facts",
            },
          },
        }),
        validate: (response) => ({
          status: "usable",
          value: response.choices[0]!.message.content,
        }),
      });

    expect(value).toBe("Maya");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      disposition: "accepted",
      accounting: {
        usage: {
          promptTokens: 100,
          cachedTokens: 25,
          completionTokens: 20,
          reasoningTokens: 5,
          totalTokens: 120,
        },
        actualCostMicrousd: 4_200,
        providerNativeUnit: "katana_credit",
        providerNativeAmount: "0.1",
      },
    });
    expect(JSON.stringify(records[0]!.accounting)).not.toContain("must not enter accounting facts");
    expect(records[0]!.rawResponse).toBeUndefined();
  });

  it("does not dispatch when authoritative reservation fails", async () => {
    let dispatches = 0;
    const call = new ProviderExecutionCoordinator({
      hooks: {
        onReserve: () => {
          throw new Error("journal unavailable");
        },
      },
    }).startCall(coordinate);

    await expect(call.execute({
      preparedRequest: {
        transport: "chat_completions",
        providerProfileId: "openai",
        model: "gpt-test",
        body: { model: "gpt-test" },
      },
      maxAttempts: 1,
      dispatch: async () => {
        dispatches += 1;
        return { choices: [{ message: { content: "must not happen" } }] };
      },
      validate: (response) => ({ status: "usable", value: response }),
    })).rejects.toThrow("journal unavailable");
    expect(dispatches).toBe(0);
  });

  it.each([
    ["authentication", Object.assign(new Error("bad key"), { status: 401 })],
    ["rate_limit", Object.assign(new Error("slow down"), { status: 429 })],
    [
      "service_error",
      Object.assign(new Error("provider down"), { status: 500 }),
    ],
    [
      "transport_timeout",
      Object.assign(new Error("timed out"), { name: "APITimeoutError" }),
    ],
  ] as const)("keeps %s distinct", async (expectedKind, error) => {
    const records: ProviderAttemptRecord[] = [];
    const call = new ProviderExecutionCoordinator({
      hooks: {
        onTerminal: (record) => {
          records.push(record);
        },
      },
      wait: async () => undefined,
    }).startCall(coordinate);

    await expect(
      call.execute({
        preparedRequest: {
          transport: "chat_completions",
          providerProfileId: "openai",
          model: "gpt-test",
          body: { model: "gpt-test" },
        },
        maxAttempts: 1,
        dispatch: async () => {
          throw error;
        },
        validate: (response: unknown) => ({
          status: "usable",
          value: response,
        }),
      }),
    ).rejects.toBeInstanceOf(ProviderAttemptError);

    expect(records[0]?.outcome.kind).toBe(expectedKind);
  });

  it("keeps ambiguous client errors call-scoped", async () => {
    const records: ProviderAttemptRecord[] = [];
    await expect(new ProviderExecutionCoordinator({
      hooks: { onTerminal: (record) => { records.push(record); } },
    }).startCall(coordinate).execute({
      preparedRequest: {
        transport: "chat_completions",
        providerProfileId: "openai",
        model: "gpt-test",
        body: { model: "gpt-test" },
      },
      maxAttempts: 1,
      dispatch: async () => {
        throw Object.assign(new Error("unprocessable request"), { status: 422 });
      },
      validate: (response: unknown) => ({ status: "usable", value: response }),
    })).rejects.toBeInstanceOf(ProviderAttemptError);

    expect(records[0]?.outcome).toMatchObject({
      kind: "request_error",
      retryable: false,
    });
  });

  it.each([
    ["empty_output", "empty_output"],
    ["malformed_output", "malformed_output"],
    ["wrong_tool", "wrong_tool"],
    ["undecodable_structured_output", "undecodable_structured_output"],
  ] as const)(
    "retains raw successful responses classified as %s",
    async (_label, kind) => {
      const records: ProviderAttemptRecord[] = [];
      const rawResponse = {
        id: "response-1",
        choices: [
          { finish_reason: "stop", message: { content: "not usable" } },
        ],
      };
      const call = new ProviderExecutionCoordinator({
        hooks: {
          onTerminal: (record) => {
            records.push(record);
          },
        },
      }).startCall(coordinate);

      await expect(
        call.execute({
          preparedRequest: {
            transport: "chat_completions",
            providerProfileId: "openai",
            model: "gpt-test",
            body: { model: "gpt-test" },
          },
          maxAttempts: 1,
          dispatch: async () => rawResponse,
          validate: () => ({ status: "unusable", kind, message: kind }),
        }),
      ).rejects.toBeInstanceOf(ProviderAttemptError);

      expect(records[0]?.rawResponse?.body).toEqual(rawResponse);
      expect(records[0]?.outcome.kind).toBe(kind);
    },
  );

  it("records refusals without retrying and preserves request/response evidence", async () => {
    const records: ProviderAttemptRecord[] = [];
    let dispatches = 0;
    const call = new ProviderExecutionCoordinator({
      hooks: {
        onTerminal: (record) => {
          records.push(record);
        },
      },
      wait: async () => undefined,
    }).startCall(coordinate);
    const error = Object.assign(new Error("invalid prompt"), {
      status: 400,
      code: "invalid_prompt",
      request_id: "req-123",
      headers: {
        "x-request-id": "req-123",
        "content-type": "application/json",
        authorization: "Bearer secret-token",
        "set-cookie": "session=secret",
      },
      error: {
        code: "invalid_prompt",
        message: "invalid prompt",
        api_key: "secret-token",
      },
    });

    await expect(
      call.execute({
        preparedRequest: {
          transport: "chat_completions",
          providerProfileId: "openai",
          model: "gpt-test",
          body: {
            model: "gpt-test",
            messages: [{ role: "user", content: "exact rejected prompt" }],
            api_key: "secret-token",
          },
          credentialValues: ["secret-token"],
        },
        maxAttempts: 3,
        dispatch: async () => {
          dispatches += 1;
          throw error;
        },
        validate: (response: unknown) => ({
          status: "usable",
          value: response,
        }),
      }),
    ).rejects.toBeInstanceOf(ProviderAttemptError);

    expect(dispatches).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      requestId: "req-123",
      outcome: { kind: "refusal", retryable: false },
      preparedRequest: {
        body: {
          model: "gpt-test",
          messages: [{ role: "user", content: "exact rejected prompt" }],
        },
      },
      rawResponse: {
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-123",
        },
        body: { code: "invalid_prompt", message: "invalid prompt" },
      },
    });
    expect(JSON.stringify(records[0])).not.toContain("secret-token");
  });

  it("sanitizes reflected credentials in the persisted outcome message", async () => {
    const records: ProviderAttemptRecord[] = [];
    const secret = "sk-private-outcome-secret";
    const call = new ProviderExecutionCoordinator({
      hooks: { onTerminal: (record) => { records.push(record); } },
    }).startCall(coordinate);

    await expect(call.execute({
      preparedRequest: {
        transport: "chat_completions",
        providerProfileId: "openai",
        model: "gpt-test",
        body: { model: "gpt-test" },
        credentialValues: [secret],
      },
      maxAttempts: 1,
      dispatch: async () => {
        throw Object.assign(new Error(
          `bad key ${secret} at https://provider.test/v1?api_key=url-secret`,
        ), {
          status: 400,
          request_id: `${secret}?api_key=url-secret&trace=${"x".repeat(400)}`,
        });
      },
      validate: (response: unknown) => ({ status: "usable", value: response }),
    })).rejects.toBeInstanceOf(ProviderAttemptError);

    expect(records[0]!.outcome).toMatchObject({
      message:
        "bad key [REDACTED] at https://provider.test/v1?api_key=%5BREDACTED%5D",
    });
    expect(JSON.stringify(records[0])).not.toContain(secret);
    expect(JSON.stringify(records[0])).not.toContain("url-secret");
    expect(records[0]!.requestId?.length).toBeLessThanOrEqual(256);
    expect(records[0]!.requestId).toContain("[REDACTED]");
  });

  it("sanitizes reflected credentials in durable accepted values", async () => {
    for (const transport of ["openai.responses", "katana.chat_completions"]) {
      const records: ProviderAttemptRecord[] = [];
      const secret = `${transport}-private-secret`;
      const call = new ProviderExecutionCoordinator({
        hooks: { onTerminal: (record) => { records.push(record); } },
      }).startCall(coordinate);
      const value = {
        text: `provider reflected ${secret}`,
        nativeResponse: { id: "response-safe", output: secret },
      };

      expect(await call.execute({
        preparedRequest: {
          transport,
          providerProfileId: transport.startsWith("openai") ? "openai" : "katana",
          model: "model-test",
          body: { model: "model-test" },
          credentialValues: [secret],
        },
        maxAttempts: 1,
        dispatch: async () => value,
        validate: (response) => ({ status: "usable", value: response }),
      })).toBe(value);

      expect(records).toHaveLength(1);
      expect(JSON.stringify(records[0]?.acceptedValue)).not.toContain(secret);
      expect(records[0]?.acceptedValue).toMatchObject({
        text: "provider reflected [REDACTED]",
        nativeResponse: { id: "response-safe", output: "[REDACTED]" },
      });
    }
  });

  it("uses runtime evidence-fetch credentials to sanitize reflected failure metadata", async () => {
    const records: ProviderAttemptRecord[] = [];
    const secret = "runtime-only-provider-secret";
    const evidenceFetch = createProviderEvidenceFetch(
      async () => new Response(
        JSON.stringify({ error: { message: `provider reflected ${secret}` } }),
        {
          status: 400,
          headers: {
            "content-type": "application/json",
            "x-request-id": `request-${secret}`,
          },
        },
      ),
      [secret],
    );
    const call = new ProviderExecutionCoordinator({
      hooks: { onTerminal: (record) => { records.push(record); } },
    }).startCall(coordinate);

    await expect(call.execute({
      preparedRequest: {
        transport: "chat_completions",
        providerProfileId: "openai",
        model: "gpt-test",
        body: { model: "gpt-test" },
      },
      maxAttempts: 1,
      dispatch: async ({ requestOptions }) => {
        const response = await evidenceFetch(
          "https://api.openai.test/v1/chat/completions",
          {
            method: "POST",
            headers: {
              ...requestOptions.headers,
              authorization: `Bearer ${secret}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ model: "gpt-test" }),
          },
        );
        throw Object.assign(new Error(`provider reflected ${secret}`), {
          status: response.status,
          request_id: response.headers.get("x-request-id"),
        });
      },
      validate: (response: unknown) => ({ status: "usable", value: response }),
    })).rejects.toBeInstanceOf(ProviderAttemptError);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      requestId: "request-[REDACTED]",
      outcome: {
        message: "provider reflected [REDACTED]",
      },
      rawResponse: {
        status: 400,
        body: { error: { message: "provider reflected [REDACTED]" } },
      },
    });
    expect(JSON.stringify(records[0])).not.toContain(secret);
  });

  it("captures the exact sanitized HTTP request and raw response before parsing", async () => {
    const records: ProviderAttemptRecord[] = [];
    let outboundRequest: Request | undefined;
    const evidenceFetch = createProviderEvidenceFetch(
      async (input) => {
        outboundRequest =
          input instanceof Request ? input : new Request(input.toString());
        return new Response(
          '{"error":{"code":"invalid_prompt","message":"blocked"},"echo":"key-value"}',
          {
            status: 400,
            headers: {
              "content-type": "application/json",
              "x-request-id": "req-http",
              "set-cookie": "private-cookie",
            },
          },
        );
      },
      ["key-value"],
    );
    const call = new ProviderExecutionCoordinator({
      hooks: {
        onTerminal: (record) => {
          records.push(record);
        },
      },
    }).startCall(coordinate);

    await expect(
      call.execute({
        preparedRequest: {
          transport: "chat_completions",
          providerProfileId: "openai",
          model: "gpt-test",
          body: {
            model: "gpt-test",
            messages: [{ role: "user", content: "exact prompt" }],
          },
          credentialValues: ["key-value"],
        },
        maxAttempts: 1,
        dispatch: async ({ requestOptions }) =>
          evidenceFetch(
            "https://api.openai.test/v1/chat/completions?trace=key-value",
            {
            method: "POST",
            headers: {
              ...requestOptions.headers,
              authorization: "Bearer key-value",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-test",
              messages: [{ role: "user", content: "exact prompt" }],
            }),
            },
          ),
        validate: () => ({
          status: "unusable",
          kind: "refusal",
          message: "blocked",
        }),
      }),
    ).rejects.toBeInstanceOf(ProviderAttemptError);

    expect(outboundRequest?.headers.has("authorization")).toBe(true);
    expect(
      outboundRequest?.headers.has("x-influence-provider-attempt-id"),
    ).toBe(false);
    expect(
      outboundRequest?.headers.has("x-influence-no-flex-transport-retry"),
    ).toBe(false);
    expect(records[0]).toMatchObject({
      requestId: "req-http",
      preparedRequest: {
        transport: "chat_completions",
        providerProfileId: "openai",
        model: "gpt-test",
        body: {
          model: "gpt-test",
          messages: [{ role: "user", content: "exact prompt" }],
        },
      },
      rawRequest: {
        url: "https://api.openai.test/v1/chat/completions?trace=%5BREDACTED%5D",
        headers: { "content-type": "application/json" },
        body: {
          model: "gpt-test",
          messages: [{ role: "user", content: "exact prompt" }],
        },
      },
      rawResponse: {
        status: 400,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-http",
        },
        body: {
          error: { code: "invalid_prompt", message: "blocked" },
          echo: "[REDACTED]",
        },
      },
    });
  });

  it("treats owner cancellation as terminal while provider timeouts can retry", async () => {
    const controller = new AbortController();
    controller.abort(new Error("owner lost"));
    const records: ProviderAttemptRecord[] = [];
    const call = new ProviderExecutionCoordinator({
      hooks: {
        onTerminal: (record) => {
          records.push(record);
        },
      },
      wait: async () => undefined,
    }).startCall(coordinate);

    await expect(
      call.execute({
        preparedRequest: {
          transport: "responses",
          providerProfileId: "openai",
          model: "gpt-test",
          body: { model: "gpt-test" },
        },
        maxAttempts: 3,
        cancellationSignal: controller.signal,
        dispatch: async () => {
          throw Object.assign(new Error("aborted"), { name: "AbortError" });
        },
        validate: (response: unknown) => ({
          status: "usable",
          value: response,
        }),
      }),
    ).rejects.toMatchObject({ outcome: { kind: "cancellation" } });

    expect(records).toHaveLength(1);
  });

  it("classifies the pinned SDK's APIUserAbortError as timeout unless the owner signal aborted", async () => {
    const records: ProviderAttemptRecord[] = [];
    let dispatches = 0;
    const call = new ProviderExecutionCoordinator({
      hooks: { onTerminal: (record) => { records.push(record); } },
      wait: async () => undefined,
    }).startCall(coordinate);

    await expect(
      call.execute({
        preparedRequest: {
          transport: "chat_completions",
          providerProfileId: "openai",
          model: "gpt-test",
          body: { model: "gpt-test" },
        },
        maxAttempts: 2,
        dispatch: async () => {
          dispatches += 1;
          throw new APIUserAbortError();
        },
        validate: (response: unknown) => ({ status: "usable", value: response }),
      }),
    ).rejects.toMatchObject({ outcome: { kind: "transport_timeout" } });

    expect(dispatches).toBe(2);
    expect(records.map((record) => record.outcome.kind)).toEqual([
      "transport_timeout",
      "transport_timeout",
    ]);

    const controller = new AbortController();
    controller.abort(new Error("owner lost"));
    const cancelledRecords: ProviderAttemptRecord[] = [];
    await expect(
      new ProviderExecutionCoordinator({
        hooks: { onTerminal: (record) => { cancelledRecords.push(record); } },
      })
        .startCall(coordinate)
        .execute({
          preparedRequest: {
            transport: "chat_completions",
            providerProfileId: "openai",
            model: "gpt-test",
            body: { model: "gpt-test" },
          },
          maxAttempts: 2,
          cancellationSignal: controller.signal,
          dispatch: async () => {
            throw new APIUserAbortError();
          },
          validate: (response: unknown) => ({ status: "usable", value: response }),
        }),
    ).rejects.toMatchObject({ outcome: { kind: "cancellation" } });
    expect(cancelledRecords).toHaveLength(1);
  });
});

describe("classifyResponsesTerminalOutcome", () => {
  it.each([
    [
      "refusal",
      {
        status: "failed",
        error: { code: "invalid_prompt", message: "request rejected" },
      },
    ],
    [
      "rate_limit",
      {
        status: "failed",
        error: { code: "rate_limit_exceeded", message: "slow down" },
      },
    ],
    [
      "service_error",
      {
        status: "failed",
        error: { code: "server_error", message: "provider unavailable" },
      },
    ],
    [
      "transport_timeout",
      {
        status: "failed",
        error: { code: "request_timeout", message: "request timed out" },
      },
    ],
    [
      "refusal",
      {
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
        output: [{ type: "message", content: [] }],
      },
    ],
    [
      "undecodable_structured_output",
      {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{ type: "message", content: [{ type: "output_text", text: "{\"partial\":" }] }],
      },
    ],
  ] as const)("maps terminal Responses payloads to %s", (kind, response) => {
    expect(classifyResponsesTerminalOutcome(response)).toMatchObject({ kind });
  });

  it("accepts completed Responses payloads for action-specific validation", () => {
    expect(
      classifyResponsesTerminalOutcome({ status: "completed", output: [] }),
    ).toBeUndefined();
  });
});

describe("sanitizeProviderEvidence", () => {
  it("removes credential fields and reflected secret values recursively", () => {
    const sanitized = sanitizeProviderEvidence(
      {
        authorization: "Bearer key-value",
        cookie: "sid=abc",
        nested: {
          apiKey: "key-value",
          "x-goog-api-key": "key-value",
          text: "provider reflected key-value",
          safe: "keep me",
        },
      },
      ["key-value"],
    );

    expect(sanitized).toEqual({
      nested: {
        text: "provider reflected [REDACTED]",
        safe: "keep me",
      },
    });
  });
});
