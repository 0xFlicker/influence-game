import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { resolveGamesMcpClaims } from "../game-mcp/claims.js";
import {
  buildMatchAccessContext,
  hasPrivateMatchLaneAccess,
  ownershipFingerprintForPlayerIds,
  resolveMatchAccessContext,
  resolveSubjectGameAccessClaims,
} from "../services/match-access-context.js";
import { insertGame } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("Games MCP claims + MatchAccessContext", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("resolveGamesMcpClaims mirrors subject game access claims adapter", async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    await db.insert(schema.users).values([
      { id: userId, walletAddress: "0xclaimstest0000000000000000000000000001" },
      { id: otherUserId, walletAddress: "0xclaimstest0000000000000000000000000002" },
    ]);

    const createdGameId = await insertGame(db, { slug: "claims-created" });
    await db.update(schema.games).set({ createdById: userId }).where(eq(schema.games.id, createdGameId));

    const joinedGameId = await insertGame(db, { slug: "claims-joined" });
    const agentGameId = await insertGame(db, { slug: "claims-agent" });
    const unrelatedGameId = await insertGame(db, { slug: "claims-unrelated" });

    await insertPlayer(db, { gameId: joinedGameId, userId, name: "Direct" });
    const profileId = randomUUID();
    await db.insert(schema.agentProfiles).values({
      id: profileId,
      userId,
      name: "Owned Profile",
      personality: "steady",
    });
    await insertPlayer(db, { gameId: agentGameId, agentProfileId: profileId, name: "ViaProfile" });
    await insertPlayer(db, { gameId: unrelatedGameId, userId: otherUserId, name: "Other" });

    const viaAdapter = await resolveGamesMcpClaims(db, userId);
    const viaService = await resolveSubjectGameAccessClaims(db, userId);

    expect(viaAdapter.userId).toBe(userId);
    expect(viaService.userId).toBe(userId);
    expect([...viaAdapter.createdGameIds].sort()).toEqual([createdGameId]);
    expect([...viaAdapter.joinedGameIds].sort()).toEqual([agentGameId, joinedGameId].sort());
    expect([...viaAdapter.gameIds].sort()).toEqual(
      [createdGameId, joinedGameId, agentGameId].sort(),
    );
    expect(viaAdapter.gameIds.has(unrelatedGameId)).toBe(false);
    expect(viaAdapter.playerIds.size).toBe(2);
    expect(viaAdapter.agentProfileIds.has(profileId)).toBe(true);
    expect([...viaAdapter.gameIds].sort()).toEqual([...viaService.gameIds].sort());
    expect([...viaAdapter.playerIds].sort()).toEqual([...viaService.playerIds].sort());
  });

  test("direct-seat and agent-profile ownership authorize; creator-only does not open private lanes", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: "0xownership000000000000000000000000000001",
    });

    const createdOnlyId = await insertGame(db, { slug: "creator-only" });
    await db.update(schema.games).set({ createdById: userId }).where(eq(schema.games.id, createdOnlyId));

    const joinedId = await insertGame(db, { slug: "joined-seat" });
    const seatId = await insertPlayer(db, { gameId: joinedId, userId, name: "Seat" });

    const profileGameId = await insertGame(db, { slug: "profile-seat" });
    const profileId = randomUUID();
    await db.insert(schema.agentProfiles).values({
      id: profileId,
      userId,
      name: "Agent Seat",
      personality: "careful",
    });
    const profileSeatId = await insertPlayer(db, {
      gameId: profileGameId,
      agentProfileId: profileId,
      name: "AgentSeat",
    });

    const creator = await resolveMatchAccessContext(db, {
      subjectUserId: userId,
      gameIdOrSlug: "creator-only",
    });
    expect(creator.status).toBe("resolved");
    if (creator.status !== "resolved") return;
    expect(creator.context.isCreator).toBe(true);
    expect(creator.context.hasCanonicalAccess).toBe(true);
    expect(creator.context.hasParticipatingOwnership).toBe(false);
    expect(hasPrivateMatchLaneAccess(creator.context)).toBe(false);

    const joined = await resolveMatchAccessContext(db, {
      subjectUserId: userId,
      gameIdOrSlug: joinedId,
    });
    expect(joined.status).toBe("resolved");
    if (joined.status !== "resolved") return;
    expect(joined.context.hasParticipatingOwnership).toBe(true);
    expect(joined.context.ownedPlayerIds.has(seatId)).toBe(true);
    expect(hasPrivateMatchLaneAccess(joined.context)).toBe(true);

    const viaProfile = await resolveMatchAccessContext(db, {
      subjectUserId: userId,
      gameIdOrSlug: "profile-seat",
    });
    expect(viaProfile.status).toBe("resolved");
    if (viaProfile.status !== "resolved") return;
    expect(viaProfile.context.ownedPlayerIds.has(profileSeatId)).toBe(true);
    expect(viaProfile.context.ownedAgentProfileIds.has(profileId)).toBe(true);
  });

  test("unknown and inaccessible games are indistinguishable", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: "0xnonenum00000000000000000000000000000001",
    });
    const otherUserId = randomUUID();
    await db.insert(schema.users).values({
      id: otherUserId,
      walletAddress: "0xnonenum00000000000000000000000000000002",
    });
    const foreignGameId = await insertGame(db, { slug: "foreign-game" });
    await insertPlayer(db, { gameId: foreignGameId, userId: otherUserId, name: "Foreign" });

    const missing = await resolveMatchAccessContext(db, {
      subjectUserId: userId,
      gameIdOrSlug: "definitely-missing",
    });
    const foreign = await resolveMatchAccessContext(db, {
      subjectUserId: userId,
      gameIdOrSlug: foreignGameId,
    });
    expect(missing).toEqual({ status: "not_accessible" });
    expect(foreign).toEqual({ status: "not_accessible" });
  });

  test("roster name-or-ID resolution is unambiguous-only", () => {
    const alice = randomUUID();
    const bob = randomUUID();
    const echoA = randomUUID();
    const echoB = randomUUID();
    const context = buildMatchAccessContext({
      subjectUserId: "user-1",
      gameId: "game-1",
      gameSlug: "slug",
      gameStatus: "in_progress",
      transcriptCaptureVersion: 1,
      isCreator: false,
      hasParticipatingOwnership: true,
      hasCanonicalAccess: true,
      ownedPlayerIds: new Set([alice]),
      ownedAgentProfileIds: new Set(),
      ownedSeats: [{ playerId: alice, name: "Alice", agentProfileId: null }],
      roster: [
        { id: alice, name: "Alice", userId: "user-1", agentProfileId: null },
        { id: bob, name: "Bob", userId: null, agentProfileId: null },
        { id: echoA, name: "Echo", userId: null, agentProfileId: null },
        { id: echoB, name: "echo", userId: null, agentProfileId: null },
      ],
    });

    expect(context.resolvePlayerId(alice)).toBe(alice);
    expect(context.resolvePlayerId("Alice")).toBe(alice);
    expect(context.resolvePlayerId("aLiCe")).toBe(alice);
    expect(context.resolvePlayerId("Bob")).toBe(bob);
    expect(context.resolvePlayerId("Echo")).toBeNull(); // duplicate names
    expect(context.resolvePlayerId("unknown")).toBeNull();
    expect(context.resolvePlayerName(bob)).toBe("Bob");
  });

  test("ownership fingerprint is stable over set order", () => {
    const a = "player-a";
    const b = "player-b";
    expect(ownershipFingerprintForPlayerIds([b, a])).toBe(
      ownershipFingerprintForPlayerIds([a, b]),
    );
    expect(ownershipFingerprintForPlayerIds([a])).not.toBe(
      ownershipFingerprintForPlayerIds([a, b]),
    );
  });
});

async function insertPlayer(
  db: DrizzleDB,
  params: {
    gameId: string;
    userId?: string;
    agentProfileId?: string;
    name: string;
  },
): Promise<string> {
  const playerId = randomUUID();
  await db.insert(schema.gamePlayers).values({
    id: playerId,
    gameId: params.gameId,
    userId: params.userId,
    agentProfileId: params.agentProfileId,
    persona: JSON.stringify({ name: params.name, personality: "test" }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  });
  return playerId;
}
