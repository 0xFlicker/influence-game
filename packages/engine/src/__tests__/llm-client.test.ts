import { describe, expect, it } from "bun:test";
import {
  createLlmClientFromEnv,
  createFlexProcessingFetch,
  describeLlmProvider,
  normalizeOpenAIRequestServiceTier,
  resolveOpenAIReasoningSummaryMode,
  resolveModelForTier,
  resolveToolChoiceMode,
} from "../llm-client";

describe("LLM client env config", () => {
  it("returns null when no provider is configured", () => {
    expect(createLlmClientFromEnv({})).toBeNull();
  });

  it("uses OpenAI when OPENAI_API_KEY is set", () => {
    const config = createLlmClientFromEnv({ OPENAI_API_KEY: "sk-test" });

    expect(config).not.toBeNull();
    expect(config?.apiKeySource).toBe("OPENAI_API_KEY");
    expect(config?.baseURL).toBeUndefined();
    expect(config?.providerLabel).toBe("OpenAI");
    expect(config?.providerProfileId).toBe("openai");
    expect(config?.openAIReasoningSummary).toBe("auto");
    expect(config?.openAIServiceTier).toBe("flex");
    expect(config?.flexProcessingEnabled).toBe(true);
  });

  it("uses a local dummy API key for LM Studio-compatible endpoints", () => {
    const config = createLlmClientFromEnv({
      INFLUENCE_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
    });

    expect(config).not.toBeNull();
    expect(config?.apiKeySource).toBe("local-default");
    expect(config?.baseURL).toBe("http://127.0.0.1:1234/v1");
    expect(config?.providerProfileId).toBe("lm-studio");
    expect(config?.toolChoiceMode).toBe("required");
    expect(config?.openAIReasoningSummary).toBeUndefined();
    expect(describeLlmProvider(config!)).toBe(
      "OpenAI-compatible local (http://127.0.0.1:1234/v1)",
    );
  });

  it("does not route explicit LM Studio catalog selections to OpenAI without a base URL", () => {
    const config = createLlmClientFromEnv(
      { OPENAI_API_KEY: "openai-key" },
      { providerProfileId: "lm-studio" },
    );

    expect(config).toBeNull();
  });

  it("requires a base URL for explicit custom OpenAI-compatible catalog selections", () => {
    const config = createLlmClientFromEnv(
      { OPENAI_API_KEY: "openai-key" },
      { providerProfileId: "custom-openai-compatible" },
    );

    expect(config).toBeNull();
  });

  it("lets project-specific env override OpenAI-compatible aliases", () => {
    const config = createLlmClientFromEnv({
      INFLUENCE_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
      OPENAI_BASE_URL: "https://example.invalid/v1",
      INFLUENCE_LLM_API_KEY: "local-key",
      OPENAI_API_KEY: "openai-key",
    });

    expect(config?.apiKeySource).toBe("INFLUENCE_LLM_API_KEY");
    expect(config?.baseURLSource).toBe("INFLUENCE_LLM_BASE_URL");
    expect(config?.baseURL).toBe("http://127.0.0.1:1234/v1");
  });

  it("uses Katana when explicitly selected", () => {
    const config = createLlmClientFromEnv(
      {
        OPENAI_API_KEY: "openai-key",
        API_KAT_IMGNAI_KEY: "kat-key",
        API_KAT_IMGNAI_SECRET: "kat-secret",
      },
      { providerProfileId: "katana" },
    );

    expect(config).not.toBeNull();
    expect(config?.apiKeySource).toBe("API_KAT_IMGNAI_KEY+API_KAT_IMGNAI_SECRET");
    expect(config?.baseURL).toBe("https://kat.imgnai.com/v1");
    expect(config?.baseURLSource).toBe("katana-profile");
    expect(config?.providerLabel).toBe("Katana (IMGNAI)");
    expect(config?.providerProfileId).toBe("katana");
    expect(config?.openAIReasoningSummary).toBeUndefined();
  });

  it("does not route explicit OpenAI catalog selections to local base URLs", () => {
    const config = createLlmClientFromEnv(
      {
        INFLUENCE_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
        INFLUENCE_LLM_API_KEY: "local-key",
        OPENAI_API_KEY: "openai-key",
      },
      { providerProfileId: "openai" },
    );

    expect(config).not.toBeNull();
    expect(config?.apiKeySource).toBe("OPENAI_API_KEY");
    expect(config?.baseURL).toBeUndefined();
    expect(config?.providerProfileId).toBe("openai");
  });

  it("does not implicitly use Katana credentials for default games", () => {
    const config = createLlmClientFromEnv({
      API_KAT_IMGNAI_KEY: "kat-key",
      API_KAT_IMGNAI_SECRET: "kat-secret",
    });

    expect(config).toBeNull();
  });

  it("normalizes standard aliases and rejects invalid request tiers", () => {
    expect(normalizeOpenAIRequestServiceTier("standard")).toBe("auto");
    expect(normalizeOpenAIRequestServiceTier("default")).toBe("auto");
    expect(normalizeOpenAIRequestServiceTier("bogus")).toBeNull();
  });
});

describe("OpenAI Flex processing", () => {
  it("retries three Flex 429s with exponential backoff before using auto tier", async () => {
    const tiers: string[] = [];
    const delays: number[] = [];
    let attempts = 0;
    const flexFetch = createFlexProcessingFetch(
      async (request) => {
        tiers.push((await (request as unknown as Request).json() as { service_tier: string }).service_tier);
        attempts++;
        return new Response(null, { status: attempts <= 3 ? 429 : 200 });
      },
      async (delay) => {
        delays.push(delay);
      },
    );

    const response = await flexFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5-mini", input: "test" }),
    });

    expect(response.status).toBe(200);
    expect(tiers).toEqual(["flex", "flex", "flex", "auto"]);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
  });

  it("starts the next request on Flex after an auto-tier fallback", async () => {
    const tiers: string[] = [];
    const responses = [
      new Response(null, { status: 429 }),
      new Response(null, { status: 429 }),
      new Response(null, { status: 429 }),
      new Response(null, { status: 200 }),
      new Response(null, { status: 200 }),
    ];
    const flexFetch = createFlexProcessingFetch(
      async (request) => {
        tiers.push((await (request as Request).json() as { service_tier: string }).service_tier);
        return responses.shift()!;
      },
      async () => undefined,
    );

    await flexFetch("https://api.openai.com/v1/responses", { method: "POST", body: "{}" });
    await flexFetch("https://api.openai.com/v1/responses", { method: "POST", body: "{}" });

    expect(tiers).toEqual(["flex", "flex", "flex", "auto", "flex"]);
  });

  it("rebuilds requests without a stale content length", async () => {
    let rewrittenRequest: Request | undefined;
    const flexFetch = createFlexProcessingFetch(async (request) => {
      rewrittenRequest = request as Request;
      return new Response(null, { status: 200 });
    });

    await flexFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-length": "2" },
      body: "{}",
    });

    expect(await rewrittenRequest?.text()).toBe('{"service_tier":"flex"}');
    expect(rewrittenRequest?.headers.get("content-length")).not.toBe("2");
  });

  it("caps Retry-After delays and returns an auto-tier 429 without another retry", async () => {
    const tiers: string[] = [];
    const delays: number[] = [];
    const flexFetch = createFlexProcessingFetch(
      async (request) => {
        tiers.push((await (request as Request).json() as { service_tier: string }).service_tier);
        return new Response(null, { status: 429, headers: { "retry-after": "3600" } });
      },
      async (delay) => {
        delays.push(delay);
      },
    );

    const response = await flexFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5-mini", input: "test" }),
    });

    expect(response.status).toBe(429);
    expect(tiers).toEqual(["flex", "flex", "flex", "auto"]);
    expect(delays).toEqual([30_000, 30_000, 30_000]);
  });

  it("stops a pending Flex backoff when the request aborts", async () => {
    const controller = new AbortController();
    const abortReason = new Error("simulation timed out");
    let attempts = 0;
    const flexFetch = createFlexProcessingFetch(
      async () => {
        attempts++;
        return new Response(null, { status: 429 });
      },
      async (_delay, signal) => {
        controller.abort(abortReason);
        if (signal?.aborted) throw signal.reason;
      },
    );

    await expect(
      flexFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5-mini", input: "test" }),
        signal: controller.signal,
      }),
    ).rejects.toBe(abortReason);
    expect(attempts).toBe(1);
  });

  it("only enables Flex processing for hosted OpenAI", () => {
    const hosted = createLlmClientFromEnv(
      { OPENAI_API_KEY: "openai-key" },
      { flexProcessing: true, providerProfileId: "openai" },
    );
    const local = createLlmClientFromEnv(
      { INFLUENCE_LLM_BASE_URL: "http://127.0.0.1:1234/v1" },
      { flexProcessing: true, providerProfileId: "lm-studio" },
    );

    expect(hosted?.flexProcessingEnabled).toBe(true);
    expect(local?.flexProcessingEnabled).toBe(false);
  });

  it("wires Flex processing into hosted OpenAI client requests", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = Object.assign(
      async (request: string | URL | Request) => {
        requestBody = await (request as Request).json() as Record<string, unknown>;
        return new Response(
          JSON.stringify({ error: { message: "expected test failure", type: "invalid_request_error" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const config = createLlmClientFromEnv(
        { OPENAI_API_KEY: "openai-key" },
        { flexProcessing: true, providerProfileId: "openai" },
      );
      try {
        await config!.client.responses.create({ model: "gpt-5-mini", input: "test" });
      } catch {
        // The intercepted request intentionally returns an OpenAI API error.
      }
      expect(requestBody?.service_tier).toBe("flex");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("OpenAI reasoning summary config", () => {
  it("defaults hosted OpenAI to auto summaries", () => {
    expect(resolveOpenAIReasoningSummaryMode({}, undefined)).toBe("auto");
  });

  it("supports explicit summary modes for hosted OpenAI", () => {
    expect(resolveOpenAIReasoningSummaryMode({ INFLUENCE_OPENAI_REASONING_SUMMARY: "concise" }, undefined)).toBe("concise");
    expect(resolveOpenAIReasoningSummaryMode({ INFLUENCE_OPENAI_REASONING_SUMMARY: "detailed" }, undefined)).toBe("detailed");
  });

  it("can disable hosted OpenAI reasoning summaries", () => {
    expect(resolveOpenAIReasoningSummaryMode({ INFLUENCE_OPENAI_REASONING_SUMMARY: "off" }, undefined)).toBeUndefined();
  });

  it("does not enable summaries for OpenAI-compatible base URLs", () => {
    expect(resolveOpenAIReasoningSummaryMode({ INFLUENCE_OPENAI_REASONING_SUMMARY: "auto" }, "http://127.0.0.1:1234/v1")).toBeUndefined();
  });
});

describe("LLM structured output mode config", () => {
  it("uses named tool choice for OpenAI by default", () => {
    expect(resolveToolChoiceMode({}, undefined)).toBe("named");
  });

  it("uses required tool choice for local OpenAI-compatible providers", () => {
    expect(resolveToolChoiceMode({}, "http://127.0.0.1:1234/v1")).toBe("required");
  });

  it("lets env override the provider-derived mode", () => {
    expect(
      resolveToolChoiceMode(
        { INFLUENCE_LLM_TOOL_CHOICE_MODE: "json" },
        "http://127.0.0.1:1234/v1",
      ),
    ).toBe("json_schema");
  });
});

describe("legacy model tier mapping", () => {
  it("maps tiers to fixed catalog defaults", () => {
    expect(resolveModelForTier("budget")).toBe("gpt-5-nano");
    expect(resolveModelForTier("standard")).toBe("gpt-5-mini");
    expect(resolveModelForTier("premium")).toBe("gpt-5.4-mini");
  });

  it("falls back to budget for unknown tiers", () => {
    expect(resolveModelForTier("unknown")).toBe("gpt-5-nano");
  });
});
