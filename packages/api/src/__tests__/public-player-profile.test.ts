import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { schema, type DrizzleDB } from "../db/index.js";
import type { GameMcpAuthContext } from "../game-mcp/auth.js";
import { ProductionGameMcpReadModel } from "../game-mcp/read-model.js";
import { ProductionGameMcpJsonRpcServer } from "../game-mcp/server.js";
import { createPublicPlayerRoutes } from "../routes/public-players.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { getPublicAgentPreviewsByProfileIds } from "../services/public-agent-preview.js";
import {
  getPublicPlayerProfile,
  type PublicPlayerProfileEnvelope,
} from "../services/public-player-profile.js";
import { publicPlayerDisplayName } from "../services/public-player-identity.js";
import { createSeason } from "../services/seasons.js";
import { setupTestDB } from "./test-utils.js";

const PRIVATE_SENTINELS = [
  "privy:private-player",
  "private@example.test",
  "0x1234567890abcdef1234567890abcdef12345678",
  "PRIVATE_PERSONALITY_SENTINEL",
  "PRIVATE_BACKSTORY_SENTINEL",
  "PRIVATE_STRATEGY_SENTINEL",
] as const;

const FORBIDDEN_KEYS = new Set([
  "id",
  "userId",
  "ownerId",
  "agentId",
  "agentProfileId",
  "agentRevisionId",
  "walletAddress",
  "email",
  "personality",
  "personalityPrompt",
  "backstory",
  "strategyStyle",
  "revision",
  "revisions",
  "reasoning",
  "reasoningContext",
  "cognitiveArtifacts",
  "provider",
  "providerDetails",
  "queueState",
  "admin",
]);

describe("public player profile", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("never publishes raw or truncated wallet-shaped snapshot copy", () => {
    for (const displayName of [
      "0x1234567890abcdef1234567890abcdef12345678",
      "0x1234...5678",
    ]) {
      expect(publicPlayerDisplayName({
        displayName,
        email: null,
        walletAddress: null,
      })).toBe("Anonymous");
    }
  });

  test("projects one allowlisted profile by handle or UUID from eligible visible Free receipts", async () => {
    const fixture = await seedPublicPlayerFixture(db);

    const byHandle = await getPublicPlayerProfile(db, "  FLICK  ");
    const byUuid = await getPublicPlayerProfile(db, fixture.publicId.toUpperCase());

    expect(byHandle).toEqual(byUuid);
    expect(byHandle).toMatchObject({
      schemaVersion: 1,
      status: "found",
      profile: {
        identity: {
          publicId: fixture.publicId,
          handle: "flick",
          displayName: "Flick",
        },
        career: {
          rating: 1540,
          peakRating: 1600,
          gamesPlayed: 8,
          wins: 5,
          winRate: 0.625,
        },
        currentSeason: {
          season: {
            slug: fixture.seasonSlug,
            name: "Current Season",
            status: "active",
          },
          architectStanding: {
            rank: 1,
          },
          honors: {
            agentChampion: false,
            architectChampion: false,
          },
        },
      },
    });
    if (byHandle.status !== "found") throw new Error("Expected found profile");

    const previewByProfileId = await getPublicAgentPreviewsByProfileIds(db, [
      fixture.zuluProfileId,
      fixture.zuluProfileId,
      randomUUID(),
    ]);
    expect(previewByProfileId.size).toBe(1);
    expect(previewByProfileId.get(fixture.zuluProfileId)).toMatchObject({
      name: "Zulu",
      competition: {
        gamesPlayed: 6,
        wins: 2,
        winRate: 2 / 6,
      },
    });

    expect(byHandle.profile.agents).toEqual([
      {
        name: "alpha",
        avatarUrl: null,
        role: null,
        competition: {
          gamesPlayed: 0,
          wins: 0,
          winRate: 0,
        },
      },
      {
        name: "Zulu",
        avatarUrl: "https://cdn.example.test/zulu.png",
        role: {
          key: "strategic",
          label: "Strategic",
        },
        competition: {
          gamesPlayed: 6,
          wins: 2,
          winRate: 2 / 6,
        },
      },
    ]);
    expect(byHandle.profile.recentResults).toHaveLength(5);
    expect(byHandle.profile.recentResults.map((result) => result.gameSlug)).toEqual([
      "valid-tie-b",
      "valid-tie-a",
      "valid-4",
      "valid-3",
      "valid-2",
    ]);
    expect(byHandle.profile.recentResults.map((result) => result.gameSlug)).not.toEqual(
      expect.arrayContaining(["hidden", "custom", "unfinished", "ineligible"]),
    );

    assertNoForbiddenPublicData(byHandle);
  });

  test("keeps mutable handles uncached while immutable UUID resolution survives the change", async () => {
    const fixture = await seedPublicPlayerFixture(db);
    await db.update(schema.users)
      .set({ handle: "oxflick" })
      .where(eq(schema.users.id, fixture.userId));

    expect(await getPublicPlayerProfile(db, "flick")).toEqual({
      schemaVersion: 1,
      status: "not_found",
    });
    expect(await getPublicPlayerProfile(db, "oxflick")).toMatchObject({
      schemaVersion: 1,
      status: "found",
      profile: { identity: { publicId: fixture.publicId, handle: "oxflick" } },
    });
    expect(await getPublicPlayerProfile(db, fixture.publicId)).toMatchObject({
      schemaVersion: 1,
      status: "found",
      profile: { identity: { publicId: fixture.publicId, handle: "oxflick" } },
    });
  });

  test("returns Anonymous for auth-derived placeholders and rejects imported synthetic users", async () => {
    const walletAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const walletPublicId = randomUUID();
    await db.insert(schema.users).values({
      id: "privy:wallet-player",
      publicId: walletPublicId,
      handle: "wallet-player",
      walletAddress,
      email: "wallet@example.test",
      displayName: "0xabcd...abcd",
    });
    const playerPublicId = randomUUID();
    await db.insert(schema.users).values({
      id: "privy:player-placeholder",
      publicId: playerPublicId,
      handle: "plain-player",
      displayName: "Player",
    });
    await db.insert(schema.users).values({
      id: "imported-private-user",
      publicId: randomUUID(),
      handle: "imported-player",
      walletAddress: "imported-batch-42",
      displayName: "Imported Player",
    });

    expect(await getPublicPlayerProfile(db, "wallet-player")).toMatchObject({
      status: "found",
      profile: { identity: { displayName: "Anonymous" } },
    });
    expect(await getPublicPlayerProfile(db, playerPublicId)).toMatchObject({
      status: "found",
      profile: { identity: { displayName: "Anonymous", handle: "plain-player" } },
    });
    expect(await getPublicPlayerProfile(db, "imported-player")).toEqual({
      schemaVersion: 1,
      status: "not_found",
    });
  });

  test("REST returns deep profile parity with the MCP read model and no-store on every terminal state", async () => {
    const fixture = await seedPublicPlayerFixture(db);
    const app = new Hono();
    app.route("/", createPublicPlayerRoutes(db));

    const foundResponse = await app.request(`/api/players/${fixture.publicId}`);
    const found = await foundResponse.json() as PublicPlayerProfileEnvelope;
    const readModel = new ProductionGameMcpReadModel(db);
    const mcp = await readModel.readPlayerProfile(fixture.publicId);
    const server = new ProductionGameMcpJsonRpcServer(readModel);

    expect(foundResponse.status).toBe(200);
    expect(foundResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(found).toEqual(mcp);
    for (const auth of [gamesAuth("subject"), gamesAuth("producer")]) {
      const response = await server.handle({
        jsonrpc: "2.0",
        id: auth.authProfile,
        method: "tools/call",
        params: {
          name: "read_player_profile",
          arguments: { identifier: fixture.publicId },
        },
      }, auth);
      expect(response?.error).toBeUndefined();
      const result = response?.result as {
        structuredContent: PublicPlayerProfileEnvelope;
        content: Array<{ text: string }>;
      };
      expect(result.structuredContent).toEqual(found);
      expect(JSON.parse(result.content[0]!.text)).toEqual(found);
    }

    for (const identifier of ["unknown-player", randomUUID(), "x".repeat(37), "bad%20handle"]) {
      const response = await app.request(`/api/players/${identifier}`);
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        schemaVersion: 1,
        status: "not_found",
      });
    }

    const restMissing = await app.request("/api/players/unknown-player");
    const mcpMissing = await server.handle({
      jsonrpc: "2.0",
      id: "missing",
      method: "tools/call",
      params: {
        name: "read_player_profile",
        arguments: { identifier: "unknown-player" },
      },
    }, gamesAuth("subject"));
    expect((mcpMissing?.result as { structuredContent: unknown }).structuredContent)
      .toEqual(await restMissing.json());
  });
});

async function seedPublicPlayerFixture(db: DrizzleDB) {
  const userId = "privy:private-player";
  const publicId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    publicId,
    handle: "flick",
    email: "private@example.test",
    walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
    displayName: "Flick",
    rating: 1540,
    gamesPlayed: 8,
    gamesWon: 5,
    peakRating: 1600,
  });

  const alpha = (await createOwnedAgentProfile(db, { userId }, {
    name: "alpha",
    personality: "PRIVATE_PERSONALITY_SENTINEL",
    backstory: "PRIVATE_BACKSTORY_SENTINEL",
    strategyStyle: "PRIVATE_STRATEGY_SENTINEL",
  })).profile;
  const zulu = (await createOwnedAgentProfile(db, { userId }, {
    name: "Zulu",
    personality: "PRIVATE_PERSONALITY_SENTINEL",
    backstory: "PRIVATE_BACKSTORY_SENTINEL",
    strategyStyle: "PRIVATE_STRATEGY_SENTINEL",
    personaKey: "strategic",
    avatarUrl: "https://cdn.example.test/zulu.png",
  })).profile;
  await db.update(schema.agentProfiles)
    .set({ gamesPlayed: 9_999, gamesWon: 8_888 })
    .where(eq(schema.agentProfiles.userId, userId));
  await db.update(schema.agentProfiles)
    .set({ personaKey: "not-a-real-role" })
    .where(eq(schema.agentProfiles.id, alpha.id));

  const season = await createSeason(db, {
    slug: `current-${randomUUID()}`,
    name: "Current Season",
    createdById: userId,
  });
  const valid = [
    { id: "valid-receipt-1", slug: "valid-1", earnedAt: "2026-07-10T00:00:00.000Z", placement: 1 },
    { id: "valid-receipt-2", slug: "valid-2", earnedAt: "2026-07-11T00:00:00.000Z", placement: 3 },
    { id: "valid-receipt-3", slug: "valid-3", earnedAt: "2026-07-12T00:00:00.000Z", placement: 2 },
    { id: "valid-receipt-4", slug: "valid-4", earnedAt: "2026-07-13T00:00:00.000Z", placement: 4 },
    { id: "valid-receipt-a", slug: "valid-tie-a", earnedAt: "2026-07-14T00:00:00.000Z", placement: 1 },
    { id: "valid-receipt-b", slug: "valid-tie-b", earnedAt: "2026-07-14T00:00:00.000Z", placement: 2 },
  ] as const;
  for (const receipt of valid) {
    await insertReceiptFixture(db, {
      seasonId: season.id,
      ownerId: userId,
      agentProfileId: zulu.id,
      agentRevisionId: zulu.currentRevisionId!,
      receiptId: receipt.id,
      gameSlug: receipt.slug,
      earnedAt: receipt.earnedAt,
      placement: receipt.placement,
    });
  }
  await insertReceiptFixture(db, {
    seasonId: season.id,
    ownerId: userId,
    agentProfileId: zulu.id,
    agentRevisionId: zulu.currentRevisionId!,
    receiptId: "hidden-receipt",
    gameSlug: "hidden",
    earnedAt: "2026-07-20T00:00:00.000Z",
    placement: 1,
    hiddenAt: "2026-07-20T01:00:00.000Z",
  });
  await insertReceiptFixture(db, {
    seasonId: season.id,
    ownerId: userId,
    agentProfileId: zulu.id,
    agentRevisionId: zulu.currentRevisionId!,
    receiptId: "custom-receipt",
    gameSlug: "custom",
    earnedAt: "2026-07-21T00:00:00.000Z",
    placement: 1,
    trackType: "custom",
  });
  await insertReceiptFixture(db, {
    seasonId: season.id,
    ownerId: userId,
    agentProfileId: zulu.id,
    agentRevisionId: zulu.currentRevisionId!,
    receiptId: "unfinished-receipt",
    gameSlug: "unfinished",
    earnedAt: "2026-07-22T00:00:00.000Z",
    placement: 1,
    status: "in_progress",
  });
  await insertReceiptFixture(db, {
    seasonId: season.id,
    ownerId: userId,
    agentProfileId: zulu.id,
    agentRevisionId: zulu.currentRevisionId!,
    receiptId: "ineligible-receipt",
    gameSlug: "ineligible",
    earnedAt: "2026-07-23T00:00:00.000Z",
    eligibilityStatus: "ineligible",
  });

  expect(alpha.currentRevisionId).not.toBeNull();
  return {
    userId,
    publicId,
    seasonSlug: season.slug,
    zuluProfileId: zulu.id,
  };
}

async function insertReceiptFixture(
  db: DrizzleDB,
  input: {
    seasonId: string;
    ownerId: string;
    agentProfileId: string;
    agentRevisionId: string;
    receiptId: string;
    gameSlug: string;
    earnedAt: string;
    placement?: number;
    hiddenAt?: string;
    trackType?: "free" | "custom";
    status?: "completed" | "in_progress";
    eligibilityStatus?: "eligible" | "ineligible";
  },
) {
  const gameId = randomUUID();
  await db.insert(schema.games).values({
    id: gameId,
    slug: input.gameSlug,
    config: "{}",
    status: input.status ?? "completed",
    trackType: input.trackType ?? "free",
    seasonId: input.seasonId,
    minPlayers: 4,
    maxPlayers: 4,
    endedAt: input.status === "in_progress" ? null : input.earnedAt,
    hiddenAt: input.hiddenAt,
  });
  const eligible = (input.eligibilityStatus ?? "eligible") === "eligible";
  await db.insert(schema.competitionReceipts).values({
    id: input.receiptId,
    seasonId: input.seasonId,
    gameId,
    ownerId: input.ownerId,
    agentProfileId: input.agentProfileId,
    agentRevisionId: input.agentRevisionId,
    ownerDisplayNameSnapshot: "Flick",
    agentNameSnapshot: "Zulu",
    eligibilityStatus: eligible ? "eligible" : "ineligible",
    eligibilityReason: eligible ? null : "excluded fixture",
    lobbySize: 4,
    placement: eligible ? input.placement ?? 2 : null,
    basePoints: eligible ? 10 : 0,
    fieldBonus: 0,
    totalPoints: eligible ? 10 : 0,
    scoringPolicyVersion: "season-scoring-v1",
    earnedAt: input.earnedAt,
  });
}

function assertNoForbiddenPublicData(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of PRIVATE_SENTINELS) {
    expect(serialized).not.toContain(sentinel);
  }
  walk(value, (key) => {
    expect(FORBIDDEN_KEYS.has(key)).toBe(false);
  });
}

function walk(value: unknown, visitKey: (key: string) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visitKey);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    visitKey(key);
    walk(child, visitKey);
  }
}

function gamesAuth(
  authProfile: "subject" | "producer",
): GameMcpAuthContext {
  return authProfile === "producer"
    ? {
        userId: "admin-user",
        clientId: "public-profile-test",
        resource: "http://127.0.0.1:3000/mcp",
        scope: "producer",
        scopes: ["producer"],
        authProfile,
        expiresAt: 1_800_000_000,
      }
    : {
        userId: "signed-in-user",
        clientId: "public-profile-test",
        resource: "http://127.0.0.1:3000/mcp",
        scope: "games:read",
        scopes: ["games:read"],
        authProfile,
        expiresAt: 1_800_000_000,
      };
}
