import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, createAgent } from "../lib/api";
import { agentSaveErrorMessage } from "../app/dashboard/agents/agent-form";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("agent name uniqueness", () => {
  test("surfaces the generic name-taken response as the inline save error", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      code: "agent_name_taken",
      error: "That agent name is already in use. Choose another name.",
      retryable: false,
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

    let failure: unknown;
    try {
      await createAgent({
        name: "Atlas",
        personality: "Reserved House identity.",
        gender: "female",
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 409,
      code: "agent_name_taken",
      message: "That agent name is already in use. Choose another name.",
      retryable: false,
    });
    expect(agentSaveErrorMessage(failure)).toBe(
      "That agent name is already in use. Choose another name.",
    );
  });
});
