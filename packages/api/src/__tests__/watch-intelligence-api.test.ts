import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { createWatchIntelligenceRoutes } from "../routes/watch-intelligence.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame } from "./durable-run-test-utils.js";

interface WatchIntelligenceOkBody {
  ok: true;
  intelligence: {
    thinking: {
      cards: Array<{
        text: string;
        source: string;
      }>;
    };
  };
}

describe("watch intelligence API", () => {
  let db: DrizzleDB;
  let app: Hono;

  beforeEach(async () => {
    db = await setupTestDB();
    app = new Hono();
    app.route("/", createWatchIntelligenceRoutes(db));
  });

  test("serves public selected-player intelligence without auth", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-intelligence-route",
      status: "in_progress",
    });
    await db.insert(schema.gamePlayers).values({
      id: "atlas",
      gameId,
      persona: JSON.stringify({ name: "Atlas", personality: "careful" }),
      agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
    });
    await db.insert(schema.gameCognitiveArtifacts).values({
      id: "route-thinking",
      gameId,
      captureVersion: 1,
      artifactType: "thinking",
      actorRole: "player",
      actorPlayerId: "atlas",
      action: "lobby",
      phase: "LOBBY",
      round: 1,
      visibilityStatus: "active",
      payloadByteLength: 34,
      payload: {
        thinking: "Atlas wants a calm opening.",
        reasoningContext: "ROUTE_REASONING_SENTINEL",
      },
      retentionClass: "debug",
      redactionStatus: "active",
    });

    const response = await app.request(
      "/api/games/watch-intelligence-route/watch-intelligence?actorPlayerId=atlas&round=1&phase=LOBBY",
    );
    const body = await response.json() as WatchIntelligenceOkBody;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.intelligence.thinking.cards[0]).toMatchObject({
      text: "Atlas wants a calm opening.",
      source: "cognitive_artifact",
    });
    expect(JSON.stringify(body)).not.toContain("ROUTE_REASONING_SENTINEL");
  });

  test("returns 404 for missing games", async () => {
    const response = await app.request("/api/games/missing/watch-intelligence?actorPlayerId=atlas");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      ok: false,
      status: "not_found",
      error: "Game not found",
    });
  });
});
