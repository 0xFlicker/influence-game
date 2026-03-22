#!/usr/bin/env bun
/**
 * Dev Test Harness — Create, fill, and start a game via the API.
 *
 * Usage:
 *   doppler run -- bun scripts/test-game.ts [options]
 *
 * Options:
 *   --api-url <url>       API base URL (default: http://localhost:3001)
 *   --web-url <url>       Web base URL for viewer link (default: http://localhost:3000)
 *   --players <n>         Player count (default: 6)
 *   --model <tier>        Model tier: budget|standard|premium (default: budget)
 *   --timing <preset>     Timing preset: fast|standard|slow (default: fast)
 *   --wait                Poll until game starts running
 *   --no-fill             Skip the fill step (create only)
 *   --no-start            Skip the start step (create + fill only)
 *
 * Required env vars (injected via doppler):
 *   JWT_SECRET            Signing secret for session JWTs
 *   ADMIN_ADDRESS         Admin wallet address
 *   DATABASE_URL          PostgreSQL connection string
 */

import { SignJWT } from "jose";
import { sql } from "drizzle-orm";
import { parseArgs } from "util";
import { createDB, schema } from "../packages/api/src/db/index.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    "api-url": { type: "string", default: "http://localhost:3001" },
    "web-url": { type: "string", default: "http://localhost:3000" },
    players: { type: "string", default: "6" },
    model: { type: "string", default: "budget" },
    timing: { type: "string", default: "fast" },
    wait: { type: "boolean", default: false },
    "no-fill": { type: "boolean", default: false },
    "no-start": { type: "boolean", default: false },
  },
  strict: true,
});

const API_URL = args["api-url"]!;
const WEB_URL = args["web-url"]!;
const PLAYER_COUNT = parseInt(args.players!, 10);
const MODEL_TIER = args.model!;
const TIMING_PRESET = args.timing!;
const WAIT = args.wait!;
const SKIP_FILL = args["no-fill"]!;
const SKIP_START = args["no-start"]!;

// ---------------------------------------------------------------------------
// Auth — mint a dev admin JWT
// ---------------------------------------------------------------------------

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_ADDRESS = process.env.ADMIN_ADDRESS;

if (!JWT_SECRET) {
  console.error("ERROR: JWT_SECRET not set. Run with: doppler run -- bun scripts/test-game.ts");
  process.exit(1);
}
if (!ADMIN_ADDRESS) {
  console.error("ERROR: ADMIN_ADDRESS not set. Run with: doppler run -- bun scripts/test-game.ts");
  process.exit(1);
}

const DEV_ADMIN_ID = "dev-admin-test-harness";

// Ensure a dev admin user exists in the database
const db = createDB();

const existing = await db
  .select({ id: schema.users.id })
  .from(schema.users)
  .where(sql`${schema.users.id} = ${DEV_ADMIN_ID}`);

if (existing.length === 0) {
  await db.insert(schema.users).values({
    id: DEV_ADMIN_ID,
    walletAddress: ADMIN_ADDRESS.toLowerCase(),
    displayName: "Dev Admin",
  });
  console.log("Created dev admin user in database");
} else {
  // Ensure wallet address matches current ADMIN_ADDRESS
  await db
    .update(schema.users)
    .set({ walletAddress: ADMIN_ADDRESS.toLowerCase() })
    .where(sql`${schema.users.id} = ${DEV_ADMIN_ID}`);
}

// Mint a JWT
const secret = new TextEncoder().encode(JWT_SECRET);
const token = await new SignJWT({ sub: DEV_ADMIN_ID })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .setIssuer("influence-api")
  .sign(secret);

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`API ${method} ${path} failed (${res.status}):`, data);
    process.exit(1);
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\n🎮 Influence Test Harness`);
console.log(`   API: ${API_URL}`);
console.log(`   Players: ${PLAYER_COUNT} | Model: ${MODEL_TIER} | Timing: ${TIMING_PRESET}\n`);

// Step 1: Create game
console.log("1. Creating game...");
const game = await api<{ id: string; slug: string; gameNumber: number }>("POST", "/api/games", {
  playerCount: PLAYER_COUNT,
  modelTier: MODEL_TIER,
  timingPreset: TIMING_PRESET,
  slotType: "all_ai",
  viewerMode: "speedrun",
  visibility: "public",
});
console.log(`   Game #${game.gameNumber} created: ${game.slug} (${game.id})`);

// Step 2: Fill with AI players
if (!SKIP_FILL) {
  console.log("2. Filling with AI players...");
  const fill = await api<{ filled: number; totalPlayers: number }>(
    "POST",
    `/api/games/${game.id}/fill`
  );
  console.log(`   Filled ${fill.filled} players (total: ${fill.totalPlayers})`);
} else {
  console.log("2. Skipping fill (--no-fill)");
}

// Step 3: Start game
if (!SKIP_FILL && !SKIP_START) {
  console.log("3. Starting game...");
  const start = await api<{ status: string; players: number }>(
    "POST",
    `/api/games/${game.id}/start`
  );
  console.log(`   Status: ${start.status} (${start.players} players)`);
} else {
  console.log("3. Skipping start (--no-start)");
}

// Step 4: Poll until running (optional)
if (WAIT && !SKIP_START && !SKIP_FILL) {
  console.log("4. Waiting for game to start running...");
  let attempts = 0;
  const MAX_ATTEMPTS = 30;
  while (attempts < MAX_ATTEMPTS) {
    const status = await api<{ status: string }>("GET", `/api/games/${game.id}`);
    if (status.status === "in_progress") {
      console.log("   Game is running!");
      break;
    }
    if (status.status === "completed" || status.status === "cancelled") {
      console.log(`   Game ended with status: ${status.status}`);
      break;
    }
    attempts++;
    await Bun.sleep(1000);
  }
  if (attempts >= MAX_ATTEMPTS) {
    console.log("   Timed out waiting for game to start");
  }
}

// Output
console.log(`\n--- Results ---`);
console.log(`Game ID:   ${game.id}`);
console.log(`Slug:      ${game.slug}`);
console.log(`API:       ${API_URL}/api/games/${game.id}`);
console.log(`Viewer:    ${WEB_URL}/games/${game.slug}`);
console.log(`WebSocket: ws://${API_URL.replace(/^https?:\/\//, "")}/ws/games/${game.slug}`);
console.log();
