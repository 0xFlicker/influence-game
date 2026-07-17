import { randomUUID } from "node:crypto";
import {
  createPlayerUser,
  createTestUser,
  generateTestWallet,
} from "./test-auth.js";
import { createTestDb } from "./test-db.js";
import {
  startTestServers,
  stopTestServers,
  type TestServerHandles,
} from "./test-server.js";
import { schema, type DrizzleDB } from "../db/index.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { createSeason } from "../services/seasons.js";

const JWT_SECRET = "e2e-test-jwt-secret";
const LAUNCH_CUTOFF = "2026-07-01T00:00:00.000Z";
const PRIVATE_SENTINEL = "PRIVATE_E2E_PROFILE_SENTINEL";

process.env.JWT_SECRET = JWT_SECRET;

interface IdentityFixture {
  handle: string;
  publicId: string;
  walletAddress: string;
  completeJwt: string;
  requiredJwt: string;
  deferrableJwt: string;
  collisionJwt: string;
}

let servers: TestServerHandles | null = null;
let stopping = false;

async function main(): Promise<void> {
  const { db, databaseUrl } = await createTestDb();
  const fixture = await seedIdentityFixture(db);
  servers = await startTestServers({
    databaseUrl,
    jwtSecret: JWT_SECRET,
    publicIdentityLaunchCutoff: LAUNCH_CUTOFF,
  });
  if (!servers.webUrl) throw new Error("Identity harness requires the web server");

  console.log(`E2E_IDENTITY_READY ${JSON.stringify({
    apiUrl: servers.apiUrl,
    webUrl: servers.webUrl,
    fixture,
  })}`);

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await shutdown();
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (servers) await stopTestServers(servers);
}

async function seedIdentityFixture(db: DrizzleDB): Promise<IdentityFixture> {
  const completePublicId = randomUUID();
  const complete = await createPlayerUser(db, 0, {
    id: "e2e-complete-player",
    publicId: completePublicId,
    displayName: "E2E Flick",
    handle: "e2e-flick",
    createdAt: "2026-06-01T00:00:00.000Z",
  });

  const played = await createOwnedAgentProfile(db, { userId: complete.userId }, {
    name: "Vesper E2E",
    personality: PRIVATE_SENTINEL,
    backstory: PRIVATE_SENTINEL,
    strategyStyle: PRIVATE_SENTINEL,
    personaKey: "strategic",
  });
  await createOwnedAgentProfile(db, { userId: complete.userId }, {
    name: "Quartz E2E",
    personality: PRIVATE_SENTINEL,
    backstory: PRIVATE_SENTINEL,
    strategyStyle: PRIVATE_SENTINEL,
    personaKey: "observer",
  });

  const season = await createSeason(db, {
    slug: "e2e-season-zero",
    name: "E2E Season Zero",
    createdById: complete.userId,
  });
  const gameId = randomUUID();
  await db.insert(schema.games).values({
    id: gameId,
    slug: "e2e-public-result",
    config: "{}",
    status: "completed",
    trackType: "free",
    seasonId: season.id,
    minPlayers: 4,
    maxPlayers: 4,
    endedAt: "2026-06-20T00:00:00.000Z",
  });
  await db.insert(schema.competitionReceipts).values({
    id: randomUUID(),
    seasonId: season.id,
    gameId,
    ownerId: complete.userId,
    agentProfileId: played.profile.id,
    agentRevisionId: played.profileRevision.revisionId,
    ownerDisplayNameSnapshot: "E2E Flick",
    agentNameSnapshot: "Vesper E2E",
    eligibilityStatus: "eligible",
    eligibilityReason: null,
    lobbySize: 4,
    placement: 1,
    basePoints: 10,
    fieldBonus: 0,
    totalPoints: 10,
    scoringPolicyVersion: "season-scoring-v1",
    earnedAt: "2026-06-20T00:00:00.000Z",
  });

  const required = await createPlayerUser(db, 1, {
    id: "e2e-required-player",
    publicId: randomUUID(),
    displayName: null,
    handle: null,
    createdAt: LAUNCH_CUTOFF,
  });
  const deferrable = await createPlayerUser(db, 2, {
    id: "e2e-deferrable-player",
    publicId: randomUUID(),
    displayName: "Legacy Player",
    handle: null,
    createdAt: "2026-06-30T23:59:59.999Z",
  });
  const collision = await createPlayerUser(db, 3, {
    id: "e2e-collision-player",
    publicId: randomUUID(),
    displayName: null,
    handle: null,
    createdAt: LAUNCH_CUTOFF,
  });
  const collisionOwnerWallet = generateTestWallet();
  await createTestUser(db, {
    id: "e2e-collision-owner",
    publicId: randomUUID(),
    walletAddress: collisionOwnerWallet.address,
    displayName: "Handle Owner",
    handle: "collision-player",
    createdAt: "2026-06-01T00:00:00.000Z",
  });

  return {
    handle: "e2e-flick",
    publicId: completePublicId,
    walletAddress: complete.wallet.address,
    completeJwt: complete.jwt,
    requiredJwt: required.jwt,
    deferrableJwt: deferrable.jwt,
    collisionJwt: collision.jwt,
  };
}

void main().catch(async (error) => {
  console.error("Identity E2E harness failed:", error);
  await shutdown();
  process.exitCode = 1;
});
