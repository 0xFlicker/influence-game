import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDB, schema } from "../db/index.js";
import { createDeploymentControlToken, createSessionToken } from "../middleware/auth.js";
import { adoptDurableGameRunOwner } from "../services/game-ownership.js";

const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = "54320";
const DEV_DATABASE_NAME = "influence_dev";
const DOPPLER_PROJECT = "social-strategy-agent";
const DOPPLER_CONFIG = "dev";
const WORKER_ACKNOWLEDGEMENT = "adopt_existing_dev_games";

type RunnableGame = {
  gameId: string;
  slug: string;
  status: string;
  activeOwnerProcessId: string | null;
};

export function assertDevelopmentDatabaseUrl(value: string | undefined): URL {
  if (!value) throw new Error("DATABASE_URL must be injected by Doppler dev");
  const url = new URL(value);
  if (
    url.protocol !== "postgresql:"
    || url.hostname !== LOCAL_HOST
    || url.port !== LOCAL_PORT
    || url.pathname.slice(1) !== DEV_DATABASE_NAME
  ) {
    throw new Error("DATABASE_URL must target 127.0.0.1:54320/influence_dev");
  }
  return url;
}

export function assertDevelopmentDopplerEnvironment(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.DOPPLER_PROJECT !== DOPPLER_PROJECT || env.DOPPLER_CONFIG !== DOPPLER_CONFIG) {
    throw new Error("Local rehearsal requires Doppler project social-strategy-agent and config dev");
  }
  const database = assertDevelopmentDatabaseUrl(env.DATABASE_URL);
  return {
    project: env.DOPPLER_PROJECT,
    config: env.DOPPLER_CONFIG,
    host: database.hostname,
    port: database.port,
    database: database.pathname.slice(1),
  };
}

export function readRehearsalAdminAddress(
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env.ADMIN_ADDRESS?.trim();
  if (!value) throw new Error("ADMIN_ADDRESS must be injected by Doppler dev");
  return value;
}

export function assertFixtureIsolation(
  games: readonly RunnableGame[],
  fixtureGameId: string | undefined,
): void {
  const unrelated = games.filter((game) => game.gameId !== fixtureGameId);
  if (unrelated.length > 0) {
    throw new Error(`Local dev rehearsal blocked by unrelated runnable games: ${unrelated.map((game) => `${game.slug} (${game.status})`).join(", ")}`);
  }
  if (fixtureGameId === undefined && games.length > 0) {
    throw new Error("Local dev rehearsal requires an empty runnable-game inventory before creating a fixture");
  }
}

export function assertDevWorkerAcknowledgement(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.REHEARSAL_DEV_WORKER_ACKNOWLEDGEMENT !== WORKER_ACKNOWLEDGEMENT) {
    throw new Error(`Set REHEARSAL_DEV_WORKER_ACKNOWLEDGEMENT=${WORKER_ACKNOWLEDGEMENT} only after reviewing preflight output`);
  }
}

function config() {
  const identity = assertDevelopmentDopplerEnvironment();
  return { databaseUrl: process.env.DATABASE_URL!, identity };
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function listRunnableGames(databaseUrl: string): Promise<RunnableGame[]> {
  const db = createDB(databaseUrl);
  const games = await db.select({
    gameId: schema.games.id,
    slug: schema.games.slug,
    status: schema.games.status,
  }).from(schema.games).where(inArray(schema.games.status, ["waiting", "in_progress", "suspended"]));
  const owners = await db.select({
    gameId: schema.gameRunOwners.gameId,
    processId: schema.gameRunOwners.processId,
  }).from(schema.gameRunOwners).where(eq(schema.gameRunOwners.status, "active"));
  const activeOwnerByGame = new Map(owners.map((owner) => [owner.gameId, owner.processId]));
  const inventory = new Map<string, RunnableGame>(games.map((game) => [game.gameId, {
    ...game,
    activeOwnerProcessId: activeOwnerByGame.get(game.gameId) ?? null,
  }]));
  for (const owner of owners) {
    if (!inventory.has(owner.gameId)) {
      inventory.set(owner.gameId, {
        gameId: owner.gameId,
        slug: "unknown-slug",
        status: "active_owner",
        activeOwnerProcessId: owner.processId,
      });
    }
  }
  return [...inventory.values()];
}

async function preflight(fixtureGameId = process.env.REHEARSAL_FIXTURE_GAME_ID) {
  const { databaseUrl, identity } = config();
  readRehearsalAdminAddress();
  const games = await listRunnableGames(databaseUrl);
  console.log(JSON.stringify({
    doppler: { project: identity.project, config: identity.config },
    database: { host: identity.host, port: identity.port, database: identity.database },
    runnableGames: games,
    fixtureGameId: fixtureGameId ?? null,
  }));
  assertFixtureIsolation(games, fixtureGameId);
}

function runtimeEnv(databaseUrl: string, role: "gateway" | "game-worker", port: string) {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: port,
    INFLUENCE_API_ROLE: role,
    POSTGAME_MEDIA_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
  } as Record<string, string>;
}

async function serve(role: "gateway" | "game-worker") {
  const { databaseUrl } = config();
  const port = role === "gateway" ? "3100" : process.env.REHEARSAL_WORKER_PORT ?? "3101";
  if (role === "game-worker") {
    await preflight(required("REHEARSAL_FIXTURE_GAME_ID"));
    assertDevWorkerAcknowledgement();
  }
  const child = spawn("bun", ["run", "src/index.ts"], {
    stdio: "inherit",
    env: runtimeEnv(databaseUrl, role, port),
  });
  process.exitCode = await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}

export function assertRehearsalHealth(
  body: { runtimeRole?: string },
  expectedRole: "gateway" | "game-worker",
): void {
  if (body.runtimeRole !== expectedRole) throw new Error(`expected ${expectedRole} health response`);
}

async function health(role: "gateway" | "game-worker") {
  const port = role === "gateway" ? "3100" : process.env.REHEARSAL_WORKER_PORT ?? "3101";
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  const body = await response.json() as { runtimeRole?: string };
  if (!response.ok) throw new Error(`expected ${role} health response`);
  assertRehearsalHealth(body, role);
  console.log(JSON.stringify(body));
}

async function fixture() {
  await preflight(undefined);
  const { databaseUrl } = config();
  const db = createDB(databaseUrl);
  const marker = `local-worker-rehearsal-${randomUUID()}`;
  await db.insert(schema.users).values({
    id: marker,
    email: `${marker}@example.test`,
    displayName: marker,
  });
  const token = await createSessionToken(marker, {
    roles: ["sysop"],
    permissions: ["create_game", "fill_game", "start_game"],
  });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const created = await fetch("http://127.0.0.1:3100/api/games", {
    method: "POST",
    headers,
    body: JSON.stringify({
      playerCount: 6,
      modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
      formatManifest: ["two_names", "vote_bomb"],
      timingPreset: "fast",
      visibility: "private",
      viewerMode: "speedrun",
    }),
  });
  const game = await created.json() as { id: string };
  if (!created.ok || !game.id) throw new Error("fixture creation failed");
  for (const path of ["fill", "start"]) {
    const response = await fetch(`http://127.0.0.1:3100/api/games/${game.id}/${path}`, { method: "POST", headers });
    if (!response.ok) throw new Error(`fixture ${path} failed`);
  }
  console.error(JSON.stringify({ fixtureMarker: marker, fixtureUserId: marker, gameId: game.id }));
  console.log(game.id);
}

async function contention() {
  const gameId = required("REHEARSAL_FIXTURE_GAME_ID");
  await preflight(gameId);
  const { databaseUrl } = config();
  const db = createDB(databaseUrl);
  const state = (await db.select({ turns: schema.gameExecutionStates.committedTurnSequence })
    .from(schema.gameExecutionStates).where(eq(schema.gameExecutionStates.gameId, gameId)))[0];
  const contender = await adoptDurableGameRunOwner(db, gameId, { processId: "manual-rehearsal-worker-2" });
  console.log(JSON.stringify({ state, contender }));
}

async function drain(action: "acquire" | "status" | "release") {
  await preflight(required("REHEARSAL_FIXTURE_GAME_ID"));
  const token = await createDeploymentControlToken("6h");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let url = "http://127.0.0.1:3100/api/internal/deployment-control/leases";
  let body: object | undefined;
  if (action === "acquire") {
    body = { candidateSha: "1291291291291291291291291291291291291291", sourceRepository: "0xFlicker/linode-iac", workflowRunId: 129, workflowRunAttempt: 1, actor: "local-manual-rehearsal" };
  } else if (action === "status") {
    url = "http://127.0.0.1:3101/api/internal/deployment-control/game-worker-drain-status";
  } else {
    url += `/${required("REHEARSAL_LEASE_ID")}/release`;
    body = { fencingToken: Number(required("REHEARSAL_FENCE")), reason: "local manual rehearsal replacement recovery" };
  }
  const response = await fetch(url, { method: action === "status" ? "GET" : "POST", headers, ...(body && { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify(result));
}

async function recovery() {
  const gameId = required("REHEARSAL_FIXTURE_GAME_ID");
  const leaseId = required("REHEARSAL_LEASE_ID");
  await preflight(gameId);
  const { databaseUrl } = config();
  const db = createDB(databaseUrl);
  console.log(JSON.stringify({
    owners: await db.select({
      processId: schema.gameRunOwners.processId,
      ownerEpoch: schema.gameRunOwners.ownerEpoch,
      status: schema.gameRunOwners.status,
    }).from(schema.gameRunOwners).where(eq(schema.gameRunOwners.gameId, gameId)),
    reconciliation: await db.select({
      status: schema.deploymentRecoveryReconciliations.status,
      attempts: schema.deploymentRecoveryReconciliations.attempts,
      lastError: schema.deploymentRecoveryReconciliations.lastError,
    }).from(schema.deploymentRecoveryReconciliations)
      .where(eq(schema.deploymentRecoveryReconciliations.leaseId, leaseId)),
  }));
}

if (import.meta.main) {
  const action = process.argv[2] ?? "";
  const commands: Record<string, () => Promise<void>> = {
    preflight,
    gateway: () => serve("gateway"),
    worker: () => serve("game-worker"),
    "health:gateway": () => health("gateway"),
    "health:worker": () => health("game-worker"),
    fixture,
    contention,
    "drain:acquire": () => drain("acquire"),
    "drain:status": () => drain("status"),
    "drain:release": () => drain("release"),
    recovery,
  };
  const command = commands[action];
  if (!command) throw new Error(`unknown rehearsal action: ${action}`);
  await command();
}
