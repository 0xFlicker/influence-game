/**
 * Influence Game — Database Seed Script
 *
 * Populates the database with sample data for development.
 * Usage: bun run src/db/seed.ts
 */

import { randomUUID } from "crypto";
import { runMigrations } from "./migrate.js";
import { schema } from "./index.js";

const DB_PATH = process.env.SQLITE_PATH ?? "influence-seed.db";

// Run migrations first, then seed
const db = runMigrations(DB_PATH);

// ---------------------------------------------------------------------------
// Sample users
// ---------------------------------------------------------------------------

const userIds = {
  admin: randomUUID(),
  alice: randomUUID(),
  bob: randomUUID(),
  charlie: randomUUID(),
  diana: randomUUID(),
  eve: randomUUID(),
};

db.insert(schema.users)
  .values([
    {
      id: userIds.admin,
      walletAddress: "0x10xeng0000000000000000000000000000000000",
      displayName: "Admin (10xeng)",
    },
    {
      id: userIds.alice,
      walletAddress: "0xAlice0000000000000000000000000000000001",
      email: "alice@example.com",
      displayName: "Alice",
    },
    {
      id: userIds.bob,
      walletAddress: "0xBob00000000000000000000000000000000000002",
      email: "bob@example.com",
      displayName: "Bob",
    },
    {
      id: userIds.charlie,
      walletAddress: "0xCharlie000000000000000000000000000000003",
      displayName: "Charlie",
    },
    {
      id: userIds.diana,
      email: "diana@example.com",
      displayName: "Diana",
    },
    {
      id: userIds.eve,
      walletAddress: "0xEve00000000000000000000000000000000000005",
      email: "eve@example.com",
      displayName: "Eve",
    },
  ])
  .run();

console.log(`Seeded ${Object.keys(userIds).length} users`);

// ---------------------------------------------------------------------------
// Sample game (completed)
// ---------------------------------------------------------------------------

const gameId = randomUUID();
const defaultConfig = {
  timers: {
    introduction: 30000,
    lobby: 30000,
    whisper: 45000,
    rumor: 30000,
    vote: 20000,
    power: 15000,
    council: 20000,
  },
  maxRounds: 10,
  minPlayers: 4,
  maxPlayers: 12,
};

db.insert(schema.games)
  .values({
    id: gameId,
    config: JSON.stringify(defaultConfig),
    status: "completed",
    minPlayers: 4,
    maxPlayers: 6,
    createdById: userIds.admin,
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    endedAt: new Date().toISOString(),
  })
  .run();

console.log("Seeded 1 completed game");

// ---------------------------------------------------------------------------
// Sample game players (6 players with personas)
// ---------------------------------------------------------------------------

const personas = [
  { name: "Atlas", personality: "Strategic calculator who keeps alliances loose." },
  { name: "Vera", personality: "Master manipulator who spreads misinformation." },
  { name: "Finn", personality: "Plays with integrity and genuine alliances." },
  { name: "Mira", personality: "Wins through charm and social pressure." },
  { name: "Rex", personality: "Aggressive early targeting of strongest players." },
  { name: "Lyra", personality: "Trusts no one, pre-emptively eliminates threats." },
];

const playerUsers = [
  userIds.alice,
  userIds.bob,
  userIds.charlie,
  userIds.diana,
  userIds.eve,
  userIds.admin,
];

const playerIds: string[] = [];

for (let i = 0; i < 6; i++) {
  const playerId = randomUUID();
  playerIds.push(playerId);

  db.insert(schema.gamePlayers)
    .values({
      id: playerId,
      gameId,
      userId: playerUsers[i]!,
      persona: JSON.stringify(personas[i]),
      agentConfig: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.9,
      }),
    })
    .run();
}

console.log(`Seeded ${playerIds.length} game players`);

// ---------------------------------------------------------------------------
// Sample transcript entries
// ---------------------------------------------------------------------------

const now = Date.now();

db.insert(schema.transcripts)
  .values([
    {
      gameId,
      round: 1,
      phase: "INTRODUCTION",
      fromPlayerId: playerIds[0]!,
      scope: "public" as const,
      text: "I am Atlas. I observe, I calculate, and I survive.",
      timestamp: now - 3500_000,
    },
    {
      gameId,
      round: 1,
      phase: "INTRODUCTION",
      fromPlayerId: playerIds[1]!,
      scope: "public" as const,
      text: "Call me Vera. I'm here to make friends... or so they think.",
      timestamp: now - 3490_000,
    },
    {
      gameId,
      round: 1,
      phase: "LOBBY",
      scope: "system" as const,
      text: "Round 1 has begun. 6 players remain.",
      timestamp: now - 3400_000,
    },
    {
      gameId,
      round: 1,
      phase: "WHISPER",
      fromPlayerId: playerIds[0]!,
      scope: "whisper" as const,
      toPlayerIds: JSON.stringify([playerIds[2]]),
      text: "Finn, I think we should target Rex early. He's too aggressive.",
      timestamp: now - 3300_000,
    },
    {
      gameId,
      round: 1,
      phase: "VOTE",
      scope: "system" as const,
      text: "Vote results: Rex eliminated. Atlas empowered.",
      timestamp: now - 3100_000,
    },
  ])
  .run();

console.log("Seeded 5 transcript entries");

// ---------------------------------------------------------------------------
// Sample game result
// ---------------------------------------------------------------------------

db.insert(schema.gameResults)
  .values({
    id: randomUUID(),
    gameId,
    winnerId: playerIds[0]!, // Atlas wins
    roundsPlayed: 5,
    tokenUsage: JSON.stringify({
      promptTokens: 45000,
      completionTokens: 12000,
      totalTokens: 57000,
      estimatedCost: 0.05,
    }),
  })
  .run();

console.log("Seeded 1 game result");

// ---------------------------------------------------------------------------
// Second game (waiting — open for joins)
// ---------------------------------------------------------------------------

const waitingGameId = randomUUID();

db.insert(schema.games)
  .values({
    id: waitingGameId,
    config: JSON.stringify(defaultConfig),
    status: "waiting",
    minPlayers: 4,
    maxPlayers: 8,
    createdById: userIds.admin,
  })
  .run();

// Two players already joined
for (let i = 0; i < 2; i++) {
  db.insert(schema.gamePlayers)
    .values({
      id: randomUUID(),
      gameId: waitingGameId,
      userId: playerUsers[i]!,
      persona: JSON.stringify(personas[i]),
      agentConfig: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.9,
      }),
    })
    .run();
}

console.log("Seeded 1 waiting game with 2 players");
console.log(`\nSeed complete! Database: ${DB_PATH}`);
