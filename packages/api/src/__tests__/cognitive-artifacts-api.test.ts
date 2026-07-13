import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { createCognitiveArtifactRoutes } from "../routes/cognitive-artifacts.js";
import { setupTestDB } from "./test-utils.js";

const OWNER_USER_ID = "artifact-api-owner";
const PARTICIPANT_USER_ID = "artifact-api-participant";
const ADMIN_USER_ID = "artifact-api-admin";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-for-cognitive-artifacts";
});

describe("cognitive artifact API routes", () => {
  let db: DrizzleDB;
  let app: Hono;
  let ownerToken: string;
  let participantToken: string;
  let adminToken: string;

  beforeEach(async () => {
    db = await setupTestDB();
    app = new Hono();
    app.route("/", createCognitiveArtifactRoutes(db));
    await db.insert(schema.users).values([
      { id: OWNER_USER_ID },
      { id: PARTICIPANT_USER_ID },
      { id: ADMIN_USER_ID },
    ]);
    ownerToken = await createSessionToken(OWNER_USER_ID, { roles: ["player"], permissions: [] });
    participantToken = await createSessionToken(PARTICIPANT_USER_ID, { roles: ["player"], permissions: [] });
    adminToken = await createSessionToken(ADMIN_USER_ID, { roles: ["sysop"], permissions: ["view_admin"] });
  });

  test("lists participant-visible artifacts and keeps other reasoning owner-only", async () => {
    const fixture = await insertCapturedGameFixture();

    const listRes = await app.request(
      `/api/games/${fixture.gameId}/cognitive-artifacts`,
      authGet(participantToken),
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { ok: boolean; artifacts: Array<{ id: string }> };
    expect(listBody.ok).toBe(true);
    expect(listBody.artifacts.map((artifact) => artifact.id).sort()).toEqual([
      fixture.strategyId,
      fixture.thinkingId,
    ].sort());

    const deniedReasoning = await app.request(
      `/api/games/${fixture.gameId}/cognitive-artifacts/${fixture.reasoningId}?artifactType=reasoning&actorPlayerId=${fixture.ownerPlayerId}`,
      authGet(participantToken),
    );
    expect(deniedReasoning.status).toBe(403);

    const ownerReasoning = await app.request(
      `/api/games/${fixture.gameId}/cognitive-artifacts/${fixture.reasoningId}?artifactType=reasoning&actorPlayerId=${fixture.ownerPlayerId}`,
      authGet(ownerToken),
    );
    expect(ownerReasoning.status).toBe(200);
    const ownerBody = await ownerReasoning.json() as { ok: boolean; artifact: { payload: unknown } };
    expect(ownerBody.ok).toBe(true);
    expect(ownerBody.artifact.payload).toEqual({ reasoningContext: "owner reasoning" });
  });

  test("allows admin API access to split artifact payloads", async () => {
    const fixture = await insertCapturedGameFixture();

    const res = await app.request(
      `/api/games/${fixture.gameId}/cognitive-artifacts/${fixture.reasoningId}`,
      authGet(adminToken),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; artifact: { payload: unknown } };
    expect(body.ok).toBe(true);
    expect(body.artifact.payload).toEqual({ reasoningContext: "owner reasoning" });
  });

  test("returns old-game no-capture after participant authorization", async () => {
    const gameId = randomUUID();
    const playerId = randomUUID();
    await db.insert(schema.games).values({
      id: gameId,
      slug: `test-${gameId}`,
      config: "{}",
      cognitiveArtifactCaptureVersion: 0,
    });
    await db.insert(schema.gamePlayers).values({
      id: playerId,
      gameId,
      userId: OWNER_USER_ID,
      persona: "{}",
      agentConfig: "{}",
    });

    const res = await app.request(
      `/api/games/${gameId}/cognitive-artifacts/${randomUUID()}?artifactType=thinking&actorPlayerId=${playerId}`,
      authGet(ownerToken),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: false,
      status: "not_captured_for_game",
    });
  });

  async function insertCapturedGameFixture() {
    const gameId = randomUUID();
    const ownerPlayerId = randomUUID();
    const participantPlayerId = randomUUID();
    const reasoningId = randomUUID();
    const thinkingId = randomUUID();
    const strategyId = randomUUID();
    await db.insert(schema.games).values({
      id: gameId,
      slug: `test-${gameId}`,
      config: "{}",
      status: "in_progress",
      cognitiveArtifactCaptureVersion: 1,
    });
    await db.insert(schema.gamePlayers).values([
      {
        id: ownerPlayerId,
        gameId,
        userId: OWNER_USER_ID,
        persona: "{}",
        agentConfig: "{}",
      },
      {
        id: participantPlayerId,
        gameId,
        userId: PARTICIPANT_USER_ID,
        persona: "{}",
        agentConfig: "{}",
      },
    ]);
    await db.insert(schema.gameCognitiveArtifacts).values([
      artifactRow(reasoningId, gameId, ownerPlayerId, "reasoning", { reasoningContext: "owner reasoning" }),
      artifactRow(thinkingId, gameId, ownerPlayerId, "thinking", { thinking: "participant thinking" }),
      artifactRow(strategyId, gameId, ownerPlayerId, "strategy", { decisionLog: "participant strategy" }),
    ]);
    return { gameId, ownerPlayerId, reasoningId, thinkingId, strategyId };
  }
});

function authGet(token: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
}

function artifactRow(
  id: string,
  gameId: string,
  actorPlayerId: string,
  artifactType: "reasoning" | "thinking" | "strategy",
  payload: Record<string, unknown>,
): typeof schema.gameCognitiveArtifacts.$inferInsert {
  return {
    id,
    gameId,
    artifactType,
    actorRole: "player",
    actorPlayerId,
    actorUserId: OWNER_USER_ID,
    action: "vote",
    payloadByteLength: Buffer.byteLength(JSON.stringify(payload), "utf8"),
    payload,
  };
}
