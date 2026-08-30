import { spawn } from "node:child_process";
import { createDB, schema } from "../db/index.js";
import { createSessionToken, createDeploymentControlToken } from "../middleware/auth.js";
import { adoptDurableGameRunOwner } from "../services/game-ownership.js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

const DB_NAME = /^influence_rehearsal_[a-z0-9_]+$/;
const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = "54320";
const adminUrl = "postgresql://influence:influence@127.0.0.1:54320/postgres";

export function assertRehearsalDatabaseUrl(value: string | undefined): URL {
  if (!value) throw new Error("REHEARSAL_URL is required");
  const url = new URL(value);
  if (url.protocol !== "postgresql:" || url.hostname !== LOCAL_HOST || url.port !== LOCAL_PORT || !DB_NAME.test(url.pathname.slice(1))) {
    throw new Error("REHEARSAL_URL must target 127.0.0.1:54320/influence_rehearsal_*");
  }
  return url;
}

function config() {
  const rehearsal = assertRehearsalDatabaseUrl(process.env.REHEARSAL_URL);
  const test = assertRehearsalDatabaseUrl(process.env.REHEARSAL_TEST_URL);
  return { rehearsal: rehearsal.toString(), test: test.toString(), rehearsalName: rehearsal.pathname.slice(1), testName: test.pathname.slice(1) };
}

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
function runtimeEnv(databaseUrl: string, role: "gateway" | "game-worker", port: string) {
  return { ...process.env, DATABASE_URL: databaseUrl, PORT: port, INFLUENCE_API_ROLE: role, JWT_SECRET: "rehearsal-jwt-secret", ADMIN_ADDRESS: "0x1234567890123456789012345678901234567890", PRIVY_APP_ID: "rehearsal", PRIVY_APP_SECRET: "rehearsal", MANAGED_AUTH_MODE: "disabled", INFLUENCE_API_TEST_MOCK_RUNNER: "true", INFLUENCE_STORAGE_BACKEND: "disabled", POSTGAME_MEDIA_WORKER_TOKEN: "rehearsal-worker", POSTGAME_MEDIA_PUBLIC_BASE_URL: `http://127.0.0.1:${port}` } as Record<string, string>;
}

async function setup() {
  const c = config(); const sql = postgres(adminUrl);
  try { for (const name of [c.rehearsalName, c.testName]) await sql.unsafe(`CREATE DATABASE ${name}`); }
  finally { await sql.end(); }
  const child = spawn("bun", ["run", "src/db/migrate.ts"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: c.rehearsal, DRIZZLE_MIGRATIONS_DIR: "./drizzle" } });
  if (await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1))) !== 0) process.exitCode = 1;
}

async function cleanup() {
  const c = config(); const sql = postgres(adminUrl);
  try { for (const name of [c.rehearsalName, c.testName]) { await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${name} AND pid <> pg_backend_pid()`; await sql.unsafe(`DROP DATABASE IF EXISTS ${name}`); } }
  finally { await sql.end(); }
}

async function serve(role: "gateway" | "game-worker") {
  const c = config(); const port = role === "gateway" ? "3100" : process.env.REHEARSAL_WORKER_PORT ?? "3101";
  const child = spawn("bun", ["run", "src/index.ts"], { stdio: "inherit", env: runtimeEnv(c.rehearsal, role, port) });
  process.exitCode = await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}

async function health(role: "gateway" | "game-worker") { const port = role === "gateway" ? "3100" : process.env.REHEARSAL_WORKER_PORT ?? "3101"; const response = await fetch(`http://127.0.0.1:${port}/api/health`); const body = await response.json() as { role?: string }; if (!response.ok || body.role !== role) throw new Error(`expected ${role} health response`); console.log(JSON.stringify(body)); }

async function fixture() {
  const c = config(); const db = createDB(c.rehearsal); const admin = "rehearsal-admin";
  await db.insert(schema.users).values({ id: admin, walletAddress: "0x1234567890123456789012345678901234567890", email: "rehearsal@example.test", displayName: "Rehearsal Admin" }).onConflictDoNothing();
  const token = await createSessionToken(admin, { roles: ["sysop"], permissions: ["create_game", "fill_game", "start_game"] }); const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const created = await fetch("http://127.0.0.1:3100/api/games", { method: "POST", headers, body: JSON.stringify({ playerCount: 6, modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" }, formatManifest: ["two_names", "vote_bomb"], timingPreset: "fast", visibility: "private", viewerMode: "speedrun" }) });
  const game = await created.json() as { id: string }; if (!created.ok || !game.id) throw new Error("fixture creation failed");
  for (const path of ["fill", "start"]) { const r = await fetch(`http://127.0.0.1:3100/api/games/${game.id}/${path}`, { method: "POST", headers }); if (!r.ok) throw new Error(`fixture ${path} failed`); }
  console.log(game.id);
}

async function contention() { const c = config(); const gameId = required("REHEARSAL_GAME_ID"); const db = createDB(c.rehearsal); const state = (await db.select({ turns: schema.gameExecutionStates.committedTurnSequence }).from(schema.gameExecutionStates).where(eq(schema.gameExecutionStates.gameId, gameId)))[0]; const contender = await adoptDurableGameRunOwner(db, gameId, { processId: "manual-rehearsal-worker-2" }); console.log(JSON.stringify({ state, contender })); }
async function drain(action: "acquire" | "status" | "release") { const token = await createDeploymentControlToken("6h"); const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }; let url = "http://127.0.0.1:3100/api/internal/deployment-control/leases"; let body: object | undefined; if (action === "acquire") body = { candidateSha: "1291291291291291291291291291291291291291", sourceRepository: "0xFlicker/linode-iac", workflowRunId: 129, workflowRunAttempt: 1, actor: "local-manual-rehearsal" }; else if (action === "status") { url = "http://127.0.0.1:3101/api/internal/deployment-control/game-worker-drain-status"; } else { url += `/${required("REHEARSAL_LEASE_ID")}/release`; body = { fencingToken: Number(required("REHEARSAL_FENCE")), reason: "local manual rehearsal replacement recovery" }; } const response = await fetch(url, { method: action === "status" ? "GET" : "POST", headers, ...(body && { body: JSON.stringify(body) }) }); const result = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result)); console.log(JSON.stringify(result)); }
async function recovery() { const c = config(); const sql = postgres(c.rehearsal); try { console.log(JSON.stringify({ owners: await sql`SELECT process_id, owner_epoch, status FROM game_run_owners WHERE game_id=${required("REHEARSAL_GAME_ID")} ORDER BY acquired_at`, reconciliation: await sql`SELECT status, attempts, last_error FROM deployment_recovery_reconciliations ORDER BY requested_at DESC LIMIT 1` })); } finally { await sql.end(); } }

if (import.meta.main) { const action = process.argv[2] ?? ""; const commands: Record<string, () => Promise<void>> = { setup, cleanup, gateway: () => serve("gateway"), worker: () => serve("game-worker"), "health:gateway": () => health("gateway"), "health:worker": () => health("game-worker"), fixture, contention, "drain:acquire": () => drain("acquire"), "drain:status": () => drain("status"), "drain:release": () => drain("release"), recovery }; const command = commands[action]; if (!command) throw new Error(`unknown rehearsal action: ${action}`); await command(); }
