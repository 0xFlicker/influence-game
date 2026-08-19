import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { Hono } from "hono";
import { Phase, type PrivateDecisionTrace } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameMcpAuthContext } from "../game-mcp/auth.js";
import {
  ProductionGameMcpJsonRpcServer,
} from "../game-mcp/server.js";
import { ProductionGameMcpReadModel } from "../game-mcp/read-model.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAdminRoutes } from "../routes/admin.js";
import { recordProviderSpendForTrace } from "../services/provider-cost-accounting.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

const MCP_RESOURCE = "http://127.0.0.1:3000/mcp";
const PRODUCER_USER_ID = "producer-cost-reader";

const PRODUCER_AUTH: GameMcpAuthContext = {
  userId: PRODUCER_USER_ID,
  clientId: "producer-cost-contract-client",
  resource: MCP_RESOURCE,
  scope: "producer",
  scopes: ["producer"],
  authProfile: "producer",
  expiresAt: 1_800_000_000,
};

const ROLE_ELIGIBLE_SUBJECT_AUTH: GameMcpAuthContext = {
  ...PRODUCER_AUTH,
  scope: "games:read",
  scopes: ["games:read"],
  authProfile: "subject",
};

const NORMAL_SUBJECT_AUTH: GameMcpAuthContext = {
  ...ROLE_ELIGIBLE_SUBJECT_AUTH,
  userId: "normal-cost-reader",
};

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-producer-game-cost-mcp";
});

function createCostTrace(
  kind: "actual" | "estimated",
  responseId: string,
): PrivateDecisionTrace {
  const actual = kind === "actual";
  return {
    version: 2,
    action: "vote",
    actor: { id: "atlas", name: "Atlas", role: "player" },
    phase: Phase.VOTE,
    round: 1,
    createdAt: "2026-08-19T12:00:00.000Z",
    model: actual
      ? {
          provider: "katana",
          providerProfileId: "katana",
          catalogId: "katana:grok-4-3",
          name: "grok-4-3",
        }
      : {
          provider: "openai",
          providerProfileId: "openai",
          catalogId: "openai:gpt-5-nano",
          name: "gpt-5-nano",
        },
    prompt: { messages: [{ role: "user", content: "private contract prompt" }] },
    response: {
      raw: {
        id: responseId,
        usage: actual
          ? {
              prompt_tokens: 100,
              completion_tokens: 25,
              total_tokens: 125,
              imgnai: {
                credits: "17",
                providerCostUsd: "0.0042",
              },
            }
          : {
              input_tokens: 1_000,
              output_tokens: 200,
              total_tokens: 1_200,
            },
      },
      finishReason: "stop",
    },
  };
}

function createProducerServer(db: DrizzleDB): ProductionGameMcpJsonRpcServer {
  return new ProductionGameMcpJsonRpcServer(
    new ProductionGameMcpReadModel(db),
    undefined,
    async ({ userId }) => ({
      clientScopes: ["games:read", "producer"],
      hasProducerRole: userId === PRODUCER_USER_ID,
    }),
  );
}

async function callProducerCostTool(
  server: ProductionGameMcpJsonRpcServer,
  gameIdOrSlug: string,
  auth: GameMcpAuthContext,
) {
  return server.handle({
    jsonrpc: "2.0",
    id: `cost-${gameIdOrSlug}`,
    method: "tools/call",
    params: {
      name: "read_producer_game_cost_detail",
      arguments: { gameIdOrSlug },
    },
  }, auth);
}

describe("producer MCP game cost detail", () => {
  let db: DrizzleDB;
  let app: Hono;
  let adminToken: string;
  let server: ProductionGameMcpJsonRpcServer;

  beforeEach(async () => {
    db = await setupTestDB();
    const adminUserId = randomUUID();
    await db.insert(schema.users).values({
      id: adminUserId,
      email: "cost-contract-admin@example.test",
      displayName: "Cost Contract Admin",
    });
    adminToken = await createSessionToken(adminUserId, {
      roles: ["admin"],
      permissions: ["view_admin"],
    });
    app = new Hono();
    app.route("/", createAdminRoutes(db));
    server = createProducerServer(db);
  });

  test("returns the exact Admin Cost Detail contract for every accounting state", async () => {
    const actualGameId = await insertGame(db, { slug: "cost-contract-actual" });
    const actualOwnerEpoch = await insertOwner(db, actualGameId);
    await recordProviderSpendForTrace(db, {
      gameId: actualGameId,
      ownerEpoch: actualOwnerEpoch,
      trace: createCostTrace("actual", "cost-contract-actual-response"),
    });

    const estimatedGameId = await insertGame(db, { slug: "cost-contract-estimated" });
    const estimatedOwnerEpoch = await insertOwner(db, estimatedGameId);
    await recordProviderSpendForTrace(db, {
      gameId: estimatedGameId,
      ownerEpoch: estimatedOwnerEpoch,
      trace: createCostTrace("estimated", "cost-contract-estimated-response"),
    });
    await db.insert(schema.gamePromptReuseRollups).values({
      id: randomUUID(),
      gameId: estimatedGameId,
      ownerEpoch: estimatedOwnerEpoch,
      requestCount: 3,
      comparableCount: 2,
      reusableCharacters: 1_024,
      reusableTokenEstimate: 256,
      firstBreakCounts: { history: 1 },
      watermark: 17,
      coverage: "partial",
    });

    await insertGame(db, { slug: "cost-contract-no-calls" });

    const unavailableGameId = await insertGame(db, { slug: "cost-contract-unavailable" });
    const unavailableOwnerEpoch = await insertOwner(db, unavailableGameId);
    await db.insert(schema.gameProviderSpendEntries).values({
      id: randomUUID(),
      gameId: unavailableGameId,
      ownerEpoch: unavailableOwnerEpoch,
      sourceKey: `live:${unavailableGameId}:unavailable`,
      captureSource: "live_trace",
      costSource: "unavailable",
      callStatus: "succeeded",
      actorId: "atlas",
      actorName: "Atlas",
      actorRole: "player",
      action: "vote",
      provider: "unknown-provider",
      modelName: "unpriced-model",
      promptTokens: 40,
      cachedTokens: 0,
      completionTokens: 10,
      reasoningTokens: 0,
      totalTokens: 50,
    });

    const cases = [
      { slug: "cost-contract-actual", state: "actual" },
      { slug: "cost-contract-estimated", state: "estimated" },
      { slug: "cost-contract-no-calls", state: "no_calls" },
      { slug: "cost-contract-unavailable", state: "unavailable" },
    ] as const;

    for (const fixture of cases) {
      const adminResponse = await app.request(
        `/api/admin/games/${fixture.slug}/costs`,
        { headers: { Authorization: `Bearer ${adminToken}` } },
      );
      expect(adminResponse.status).toBe(200);
      const adminDetail = await adminResponse.json() as Record<string, unknown>;

      const mcpResponse = await callProducerCostTool(server, fixture.slug, PRODUCER_AUTH);
      expect(mcpResponse?.error).toBeUndefined();
      const mcpDetail = (mcpResponse?.result as {
        structuredContent: Record<string, unknown>;
      }).structuredContent;

      expect(mcpDetail).toEqual(adminDetail);
      expect(mcpDetail.state).toBe(fixture.state);
    }

    const estimatedResponse = await callProducerCostTool(
      server,
      "cost-contract-estimated",
      PRODUCER_AUTH,
    );
    const estimatedDetail = (estimatedResponse?.result as {
      structuredContent: Record<string, unknown>;
    }).structuredContent;
    expect(estimatedDetail.promptReuse).toEqual({
      version: 1,
      coverage: "partial",
      ownerEpochs: [{
        ownerEpoch: estimatedOwnerEpoch,
        requestCount: 3,
        comparableCount: 2,
        reusableCharacters: 1_024,
        reusableTokenEstimate: 256,
        firstBreakCounts: { history: 1 },
        watermark: 17,
        coverage: "partial",
      }],
    });
  });

  test("returns the MCP not-found error without a cost payload", async () => {
    const response = await callProducerCostTool(
      server,
      "cost-contract-missing",
      PRODUCER_AUTH,
    );

    expect(response?.result).toBeUndefined();
    expect(response?.error).toEqual({
      code: -32000,
      message: "Game not found",
    });
  });

  test("denies subject-scoped callers even when the subject currently has the producer role", async () => {
    await insertGame(db, { slug: "cost-contract-private" });

    const roleEligibleSubject = await callProducerCostTool(
      server,
      "cost-contract-private",
      ROLE_ELIGIBLE_SUBJECT_AUTH,
    );
    expect(roleEligibleSubject?.error).toBeUndefined();
    expect(roleEligibleSubject?.result).toMatchObject({
      isError: true,
      content: [{
        type: "text",
        text: "Additional authorization is required to use this tool.",
      }],
    });
    expect(JSON.stringify(roleEligibleSubject)).not.toContain("no_calls");

    const normalSubject = await callProducerCostTool(
      server,
      "cost-contract-private",
      NORMAL_SUBJECT_AUTH,
    );
    expect(normalSubject?.result).toBeUndefined();
    expect(normalSubject?.error?.message).toBe("Unknown or unauthorized MCP tool");
  });
});
