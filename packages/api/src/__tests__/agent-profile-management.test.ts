import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  AgentProfileManagementError,
  createOwnedAgent,
  listOwnedAgents,
  searchOwnedAgents,
  updateOwnedAgent,
} from "../services/agent-profile-management.js";
import { setupTestDB } from "./test-utils.js";

const USER_A_ID = "agent-mgmt-user-a";
const USER_B_ID = "agent-mgmt-user-b";

describe("agent profile management service", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
    await seedUsers(db);
  });

  test("lists only the authenticated user's agents with account-level rating provenance", async () => {
    await insertAgent(db, {
      id: "agent-a-1",
      userId: USER_A_ID,
      name: "Neon Gold Rune",
      personality: "A coalition-minded mediator.",
      backstory: "Built a reputation by ending messy deadlocks.",
      strategyStyle: "Broker peace until the timing favors a clean move.",
      personaKey: "diplomat",
      gamesPlayed: 7,
      gamesWon: 2,
    });
    await insertAgent(db, {
      id: "agent-a-2",
      userId: USER_A_ID,
      name: "Quiet Index",
      personality: "Patient, sharp, and difficult to read.",
      personaKey: "observer",
    });
    await insertAgent(db, {
      id: "agent-b-1",
      userId: USER_B_ID,
      name: "Other Neon",
      personality: "This should never leak into user A's roster.",
      personaKey: "provocateur",
    });

    const read = await listOwnedAgents(db, { userId: USER_A_ID });

    expect(read.schemaVersion).toBe(1);
    expect(read.accountRating).toEqual({
      kind: "account-level-free-track",
      currentElo: 1388,
      peakElo: 1440,
      accountGamesPlayed: 27,
      accountWins: 9,
      agentEloAvailable: false,
    });
    expect(read.agents.map((agent) => agent.displayName).sort()).toEqual([
      "Neon Gold Rune",
      "Quiet Index",
    ]);
    expect(read.agents.every((agent) => agent.rating.kind === "account-level-free-track")).toBe(true);
    expect(read.agents.every((agent) => agent.rating.agentEloAvailable === false)).toBe(true);
  });

  test("searches only owned agent fields", async () => {
    await insertAgent(db, {
      id: "agent-a-search",
      userId: USER_A_ID,
      name: "Neon Gold Rune",
      personality: "Warm diplomat who remembers every promise.",
      backstory: "Known for coalition craft.",
      personaKey: "diplomat",
    });
    await insertAgent(db, {
      id: "agent-b-search",
      userId: USER_B_ID,
      name: "Private Poison",
      personality: "Poison-pill prompt owned by another user.",
      personaKey: "deceptive",
    });

    const ownedMatch = await searchOwnedAgents(db, { userId: USER_A_ID, query: "coalition" });
    expect(ownedMatch.agents).toHaveLength(1);
    expect(ownedMatch.agents[0]!.displayName).toBe("Neon Gold Rune");

    const crossUserMatch = await searchOwnedAgents(db, { userId: USER_A_ID, query: "poison" });
    expect(crossUserMatch.agents).toEqual([]);
  });

  test("serializes daily-free queue state and active game enrollment", async () => {
    await insertAgent(db, {
      id: "agent-queued",
      userId: USER_A_ID,
      name: "Queued Diplomat",
      personality: "Waiting for the daily draw.",
      personaKey: "diplomat",
    });
    await insertAgent(db, {
      id: "agent-active",
      userId: USER_A_ID,
      name: "Open Game Strategist",
      personality: "Already enrolled in a waiting room.",
      personaKey: "strategic",
    });
    await db.insert(schema.freeGameQueue).values({
      id: "queue-entry-1",
      userId: USER_A_ID,
      agentProfileId: "agent-queued",
      joinedAt: "2026-06-30T00:01:00.000Z",
    });
    await db.insert(schema.games).values({
      id: "open-game-1",
      slug: "open-green-rune",
      config: JSON.stringify({ modelTier: "budget", maxPlayers: 4 }),
      status: "in_progress",
      trackType: "custom",
      minPlayers: 4,
      maxPlayers: 4,
      createdAt: "2026-06-30T00:02:00.000Z",
    });
    await db.insert(schema.gamePlayers).values({
      id: "player-active-1",
      gameId: "open-game-1",
      userId: USER_A_ID,
      agentProfileId: "agent-active",
      persona: JSON.stringify({ name: "Open Game Strategist" }),
      agentConfig: JSON.stringify({ model: "test", temperature: 0.9 }),
    });

    const read = await listOwnedAgents(db, { userId: USER_A_ID });
    const queued = read.agents.find((agent) => agent.id === "agent-queued")!;
    const active = read.agents.find((agent) => agent.id === "agent-active")!;

    expect(queued.queueState).toEqual({
      dailyFree: "queued",
      joinedAt: "2026-06-30T00:01:00.000Z",
      eligibility: "eligible",
    });
    expect(queued.activeEnrollment).toBeNull();
    expect(active.queueState.dailyFree).toBe("not-queued");
    expect(active.activeEnrollment).toEqual({
      gameId: "open-game-1",
      slug: "open-green-rune",
      status: "in_progress",
      queueType: "open-game",
      revision: {
        disposition: "pinned",
        effectiveRevisionId: null,
      },
    });
  });

  test("creates an agent with queue-ready metadata", async () => {
    const read = await createOwnedAgent(db, {
      userId: USER_A_ID,
      publicBaseUrl: "https://influence.test",
    }, {
      displayName: " Neon Gold Rune ",
      archetype: "Diplomat",
      personalityPrompt: " Slightly aggressive mediator with a beautiful memory. ",
      publicBiography: " A former debate coach with velvet-glove instincts. ",
      strategyStyle: "Make everyone feel heard, then choose the strongest bloc.",
      gender: "non-binary",
      avatarUrl: "/api/uploads/local?key=avatars/neon.png",
    });

    expect(read.message).toBe("Agent created.");
    expect(read.agent.id).toBeTruthy();
    expect(read.agent.displayName).toBe("Neon Gold Rune");
    expect(read.agent.archetype).toBe("diplomat");
    expect(read.agent.archetypeLabel).toBe("Diplomat");
    expect(read.agent.personalityPrompt).toBe("Slightly aggressive mediator with a beautiful memory.");
    expect(read.agent.publicBiography).toBe("A former debate coach with velvet-glove instincts.");
    expect(read.agent.gender).toBe("non-binary");
    expect(read.agent.avatarUrl).toBe("https://influence.test/api/uploads/local?key=avatars/neon.png");
    expect(read.agent.currentRevision).toEqual({
      revisionId: read.receipt.profileRevision.revisionId,
      ordinal: 1,
      active: true,
    });
    expect(read.agent.queueState.dailyFree).toBe("not-queued");
    expect(read.agent.rating.currentElo).toBe(1388);
    expect("statsReset" in read).toBe(false);
  });

  test("allows globally duplicated and House-catalog names while uniqueness is deferred", async () => {
    await createOwnedAgent(db, { userId: USER_B_ID }, {
      displayName: "Ember Quill",
      archetype: "strategic",
      personalityPrompt: "Patient and precise.",
      publicBiography: null,
      strategyStyle: null,
    });

    const duplicate = await createOwnedAgent(db, { userId: USER_A_ID }, {
      displayName: "  EMBER QUILL  ",
      archetype: "strategic",
      personalityPrompt: "A distinct competitor with a colliding name.",
      publicBiography: null,
      strategyStyle: null,
    });

    const houseCatalogName = await createOwnedAgent(db, { userId: USER_A_ID }, {
      displayName: " atlas ",
      archetype: "strategic",
      personalityPrompt: "Trying a reserved House identity.",
      publicBiography: null,
      strategyStyle: null,
    });

    expect(duplicate.agent.displayName).toBe("EMBER QUILL");
    expect(houseCatalogName.agent.displayName).toBe("atlas");
    expect(await db.select().from(schema.agentProfiles)).toHaveLength(3);
    expect(await db.select().from(schema.agentRevisions)).toHaveLength(3);
    expect(await db.select().from(schema.avatarChangeEvents)).toHaveLength(0);
  });

  test("allows concurrent normalized-name duplicates without orphaned side effects", async () => {
    const create = (userId: string, displayName: string) => createOwnedAgent(db, {
      userId,
      publicBaseUrl: "https://influence.test",
      avatarChangeSource: "mcp_provided_avatar",
    }, {
      displayName,
      archetype: "strategic",
      personalityPrompt: "Races cleanly for one persistent identity.",
      publicBiography: null,
      strategyStyle: null,
      avatarUrl: `/api/uploads/local?key=avatars/${userId}.png`,
    });

    const outcomes = await Promise.allSettled([
      create(USER_A_ID, "Signal Bloom"),
      create(USER_B_ID, " signal bloom "),
    ]);

    expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(await db.select().from(schema.agentProfiles)).toHaveLength(2);
    expect(await db.select().from(schema.agentRevisions)).toHaveLength(2);
    expect(await db.select().from(schema.avatarChangeEvents)).toHaveLength(2);
    expect(await db.select().from(schema.freeGameQueue)).toHaveLength(0);
  });

  test("allows a cross-owner duplicate rename with revision and avatar side effects", async () => {
    const ownerA = await createOwnedAgent(db, { userId: USER_A_ID }, {
      displayName: "Quiet Meridian",
      archetype: "strategic",
      personalityPrompt: "Quiet and deliberate.",
      publicBiography: null,
      strategyStyle: null,
    });
    await createOwnedAgent(db, { userId: USER_B_ID }, {
      displayName: "Copper Warden",
      archetype: "strategic",
      personalityPrompt: "Protective and patient.",
      publicBiography: null,
      strategyStyle: null,
    });
    const revisionsBefore = await db.select().from(schema.agentRevisions);

    const updated = await updateOwnedAgent(db, { userId: USER_A_ID }, {
      agentId: ownerA.agent.id,
      displayName: " copper warden ",
      avatarUrl: "https://cdn.example/should-write.png",
    });

    const [persisted] = await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, ownerA.agent.id));
    expect(updated.agent.displayName).toBe("copper warden");
    expect(persisted?.name).toBe("copper warden");
    expect(persisted?.avatarUrl).toBe("https://cdn.example/should-write.png");
    expect(await db.select().from(schema.agentRevisions)).toHaveLength(revisionsBefore.length + 1);
    expect(await db.select().from(schema.avatarChangeEvents)).toHaveLength(1);
  });

  test("allows legacy and newly adopted House-catalog names while uniqueness is deferred", async () => {
    await insertAgent(db, {
      id: "legacy-atlas",
      userId: USER_A_ID,
      name: "Atlas",
      personality: "A legacy profile awaiting explicit cleanup.",
      personaKey: "strategic",
    });
    await insertAgent(db, {
      id: "rename-candidate",
      userId: USER_B_ID,
      name: "Silver Current",
      personality: "A separately named profile.",
      personaKey: "strategic",
    });

    const legacy = await updateOwnedAgent(db, { userId: USER_A_ID }, {
      agentId: "legacy-atlas",
      displayName: " Atlas ",
      personalityPrompt: "Improved strategy without adopting a new identity.",
    });
    expect(legacy.agent.displayName).toBe("Atlas");
    expect(legacy.agent.personalityPrompt).toBe("Improved strategy without adopting a new identity.");

    const adopted = await updateOwnedAgent(db, { userId: USER_B_ID }, {
      agentId: "rename-candidate",
      displayName: "atlas",
    });
    expect(adopted.agent.displayName).toBe("atlas");
  });

  test("updates owned mutable fields without resetting lifetime statistics", async () => {
    await insertAgent(db, {
      id: "agent-update",
      userId: USER_A_ID,
      name: "Neon Gold Rune",
      personality: "Diplomatic but passive.",
      personaKey: "diplomat",
      gamesPlayed: 5,
      gamesWon: 2,
    });

    const read = await updateOwnedAgent(db, {
      userId: USER_A_ID,
    }, {
      agentId: "agent-update",
      archetype: "provocateur",
      gender: "male",
      personalityPrompt: "A little more aggressive, but still socially precise.",
    });

    expect(read.message).toBe("Agent updated.");
    expect(read.agent.archetype).toBe("provocateur");
    expect(read.agent.personalityPrompt).toBe("A little more aggressive, but still socially precise.");
    expect(read.agent.gender).toBe("male");
    expect(read.agent.stats.gamesPlayed).toBe(5);
    expect(read.agent.stats.wins).toBe(2);
    expect("statsReset" in read).toBe(false);
    expect("statsReset" in read.agent).toBe(false);
  });

  test("rejects immutable and unsupported mutation fields explicitly", async () => {
    await expect(createOwnedAgent(db, {
      userId: USER_A_ID,
    }, {
      id: randomUUID(),
      displayName: "Bad",
      archetype: "strategic",
      personalityPrompt: "Bad input",
    })).rejects.toMatchObject({
      code: "immutable_field",
      statusCode: 400,
    } satisfies Partial<AgentProfileManagementError>);

    await expect(createOwnedAgent(db, {
      userId: USER_A_ID,
    }, {
      userId: USER_B_ID,
      displayName: "Bad Owner",
      archetype: "strategic",
      personalityPrompt: "Trying to smuggle ownership.",
    })).rejects.toMatchObject({
      code: "immutable_field",
      statusCode: 400,
    } satisfies Partial<AgentProfileManagementError>);

    await expect(createOwnedAgent(db, {
      userId: USER_A_ID,
    }, {
      displayName: "Cosmetic Stretch",
      archetype: "strategic",
      personalityPrompt: "Trying unsupported cosmetics.",
      cosmetics: { border: "gold" },
    })).rejects.toMatchObject({
      code: "invalid_agent_input",
      statusCode: 400,
    } satisfies Partial<AgentProfileManagementError>);
  });

  test("rejects invalid archetypes with MCP-recoverable details", async () => {
    await expect(createOwnedAgent(db, {
      userId: USER_A_ID,
    }, {
      displayName: "Broker Maybe",
      archetype: "broker",
      personalityPrompt: "Not user-selectable yet.",
    })).rejects.toMatchObject({
      code: "invalid_archetype",
      statusCode: 400,
      details: {
        supportedArchetypes: expect.arrayContaining(["diplomat", "martyr"]),
      },
    } satisfies Partial<AgentProfileManagementError>);
  });
});

async function seedUsers(db: DrizzleDB): Promise<void> {
  await db.insert(schema.users).values([
    {
      id: USER_A_ID,
      email: "agent-a@test.example",
      displayName: "Agent A",
      rating: 1388,
      peakRating: 1440,
      gamesPlayed: 27,
      gamesWon: 9,
    },
    {
      id: USER_B_ID,
      email: "agent-b@test.example",
      displayName: "Agent B",
      rating: 1210,
      peakRating: 1300,
      gamesPlayed: 4,
      gamesWon: 1,
    },
  ]);
}

async function insertAgent(
  db: DrizzleDB,
  input: {
    id: string;
    userId: string;
    name: string;
    personality: string;
    backstory?: string | null;
    strategyStyle?: string | null;
    personaKey?: string | null;
    gamesPlayed?: number;
    gamesWon?: number;
  },
): Promise<void> {
  await db.insert(schema.agentProfiles).values({
    id: input.id,
    userId: input.userId,
    name: input.name,
    backstory: input.backstory ?? null,
    personality: input.personality,
    strategyStyle: input.strategyStyle ?? null,
    personaKey: input.personaKey ?? null,
    avatarUrl: null,
    gamesPlayed: input.gamesPlayed ?? 0,
    gamesWon: input.gamesWon ?? 0,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
  });
}
