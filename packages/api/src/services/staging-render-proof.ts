import { storeJson, readJson } from "./payload-storage.js";
/** Provider-free, single-fixture render proof. Never imports the application runtime. */
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { hashHouseHighlightsTrailerManifest, parseHouseHighlightsTrailerManifest } from "@influence/engine";
import { closeDB } from "../db/index.js";
import { runMigrations, calculateMigrationSet } from "../db/migrate.js";

export type ProofSQL = ReturnType<typeof postgres>;
export const PROOF_DATABASE = /^influence_render_proof_[a-z0-9_]{8,32}$/;
const STATIC_TABLES = new Set(["app_settings", "roles", "permissions", "role_permissions", "address_roles", "inference_plans", "agent_profile_name_occupied", "deployment_admission_state"]);
const PROOF_TABLES = new Set(["render_proof_guard", "games", "game_postgame_media", "deployment_admission_leases", "postgame_media_render_release", "postgame_media_render_generations", "postgame_media_wake_outbox"]);
export const PROOF_WRITES: Record<string, string[]> = {
  game_postgame_media: ["UPDATE"], postgame_media_render_release: ["INSERT", "UPDATE"],
  postgame_media_render_generations: ["INSERT"], postgame_media_wake_outbox: ["INSERT", "UPDATE", "DELETE"],
};
export interface RenderProofFixture {
  schemaVersion: 1;
  game: { id: string; slug: string; gameKind: "influence" | "werewolf"; config: string };
  media: { snapshot: unknown; snapshotHash: string; snapshotVersion: number; rendererVersion: string; timingContractVersion: string; musicAssetId: string; renderVersion: number };
}
export interface RenderProofIdentity {
  runId: string; database: string; principal: string; fixtureDigest: string; gameId: string;
  candidateSha: string; migrationSet: string; leaseId: string; fencingToken: number;
  sourceRepository: "0xFlicker/linode-iac"; workflowRunId: number; workflowRunAttempt: number;
  wakeUrl: string; wakeQueueArn: string; deadLetterQueueArn: string;
}
export function proofDigest(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)])) : item;
  return "sha256:" + createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
const identifier = (name: string) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error("Invalid proof SQL identifier");
  return '"' + name + '"';
};
export function proofDatabase(runId: string) {
  const name = "influence_render_proof_" + runId;
  if (!PROOF_DATABASE.test(name)) throw new Error("Use an 8–32 character lowercase proof run ID");
  return name;
}
export function validateFixture(value: unknown): RenderProofFixture {
  const fixture = value as Partial<RenderProofFixture> | null;
  if (!fixture || fixture.schemaVersion !== 1 || !fixture.game || !fixture.media
    || !/^[a-zA-Z0-9-]{1,64}$/.test(fixture.game.id) || !/^[a-z0-9-]{1,120}$/.test(fixture.game.slug)
    || !["influence", "werewolf"].includes(fixture.game.gameKind)) throw new Error("Invalid completed fixture");
  const config: unknown = JSON.parse(fixture.game.config);
  if (!config || typeof config !== "object" || Array.isArray(config)
    || ("visibility" in config && config.visibility !== "public")) throw new Error("Proof fixture must be public");
  const manifest = parseHouseHighlightsTrailerManifest(fixture.media.snapshot);
  if (manifest.game.id !== fixture.game.id || manifest.kind !== fixture.game.gameKind
    || hashHouseHighlightsTrailerManifest(manifest) !== fixture.media.snapshotHash
    || !Number.isInteger(fixture.media.renderVersion) || fixture.media.renderVersion < 1
    || fixture.media.snapshotVersion !== manifest.schemaVersion
    || fixture.media.timingContractVersion !== manifest.timingContractVersion
    || !fixture.media.rendererVersion || !fixture.media.timingContractVersion || !fixture.media.musicAssetId) throw new Error("Frozen fixture provenance differs");
  // Do not preserve transient signed URLs, credentials, or lease tokens in fixtures.
  const scan = (item: unknown): void => {
    if (typeof item === "string" && /^https?:\/\//.test(item)) {
      const url = new URL(item);
      if (url.protocol !== "https:" || url.username || url.password || url.search) throw new Error("Fixture asset must be credential-free HTTPS");
    } else if (Array.isArray(item)) item.forEach(scan);
    else if (item && typeof item === "object") Object.values(item).forEach(scan);
  };
  scan(manifest);
  return { schemaVersion: 1, game: { id: fixture.game.id, slug: fixture.game.slug, gameKind: fixture.game.gameKind, config: JSON.stringify(config) },
    media: { snapshot: manifest, snapshotHash: fixture.media.snapshotHash, snapshotVersion: fixture.media.snapshotVersion,
      rendererVersion: fixture.media.rendererVersion, timingContractVersion: fixture.media.timingContractVersion,
      musicAssetId: fixture.media.musicAssetId, renderVersion: fixture.media.renderVersion } };
}
export const fixtureDigest = (fixture: RenderProofFixture) => proofDigest(validateFixture(fixture));

/** Source connection is used only inside a READ ONLY transaction. */
export async function exportProofFixture(source: ProofSQL, gameId: string): Promise<RenderProofFixture> {
  return source.begin(async transaction => {
    const tx = transaction as unknown as ProofSQL;
    await tx`SET TRANSACTION READ ONLY`;
    const [identity] = await tx`SELECT current_database() AS name`;
    if (identity?.name !== "influence_staging") throw new Error("Export only from the approved staging database");
    const [row] = await tx`SELECT g.id,g.slug,g.game_kind,g.config,m.* FROM games g JOIN game_postgame_media m ON m.game_id=g.id
      WHERE g.id=${gameId} AND g.status='completed' AND g.hidden_at IS NULL AND m.status='ready'`;
    if (!row) throw new Error("Select one completed, ready staging fixture");
    return validateFixture({ schemaVersion: 1,
      game: { id: row.id, slug: row.slug, gameKind: row.game_kind, config: row.config },
      media: { snapshot: await readJson(row.render_input_snapshot_object), snapshotHash: row.render_input_snapshot_hash,
        snapshotVersion: row.render_input_snapshot_version, rendererVersion: row.renderer_version,
        timingContractVersion: row.timing_contract_version, musicAssetId: row.music_asset_id, renderVersion: row.render_version } });
  });
}

/** Creates only a fresh proof DB and NOLOGIN principal. Human credential entry is separate. */
export async function prepareProofDatabase(adminUrl: string, fixture: RenderProofFixture, input: Omit<RenderProofIdentity, "database" | "principal" | "fixtureDigest" | "gameId" | "migrationSet" | "leaseId" | "fencingToken">): Promise<RenderProofIdentity> {
  const approvalFields = ["runId", "candidateSha", "sourceRepository", "workflowRunId", "workflowRunAttempt", "wakeUrl", "wakeQueueArn", "deadLetterQueueArn"];
  if (!input || Object.keys(input).length !== approvalFields.length || Object.keys(input).some(key => !approvalFields.includes(key))) throw new Error("Proof approval must contain exactly its nonsecret identity fields");
  fixture = validateFixture(fixture);
  const database = proofDatabase(input.runId), principal = database + "_api";
  identifier(principal);
  if (!/^[a-f0-9]{40}$/.test(input.candidateSha) || !Number.isSafeInteger(input.workflowRunId) || input.workflowRunId < 1
    || !Number.isSafeInteger(input.workflowRunAttempt) || input.workflowRunAttempt < 1 || input.sourceRepository !== "0xFlicker/linode-iac"
    || !/^https:\/\/[a-z0-9]+\.lambda-url\.us-west-1\.on\.aws\/$/.test(input.wakeUrl)
    || !/^arn:aws:sqs:us-west-1:978355607658:house-render-staging-wakes$/.test(input.wakeQueueArn)
    || !/^arn:aws:sqs:us-west-1:978355607658:house-render-staging-dead-letters$/.test(input.deadLetterQueueArn)) throw new Error("Proof approval identity is incomplete");
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    const [origin] = await admin`SELECT current_database() AS database`;
    const target = new URL(adminUrl);
    const disposableLocal = ["127.0.0.1", "localhost"].includes(target.hostname) && target.port === "54320" && origin?.database === "postgres";
    if (origin?.database !== "influence_staging" && !disposableLocal) throw new Error("Preparation requires approved staging administration, or the local disposable test service");
    const existing = await admin`SELECT datname FROM pg_database WHERE datname=${database}`;
    const roles = await admin`SELECT rolname FROM pg_roles WHERE rolname=${principal}`;
    if (existing.length || roles.length) throw new Error("Proof database/principal already exists; never reuse or reset it");
    await admin.unsafe(`CREATE ROLE ${identifier(principal)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await admin.unsafe(`CREATE DATABASE ${identifier(database)}`);
    await admin.unsafe(`REVOKE ALL ON DATABASE ${identifier(database)} FROM PUBLIC`);
    await admin.unsafe(`GRANT CONNECT ON DATABASE ${identifier(database)} TO ${identifier(principal)}`);
  } finally { await admin.end(); }
  const url = new URL(adminUrl); url.pathname = "/" + database;
  try { await runMigrations(url.toString()); } finally { await closeDB(url.toString()); }
  const owner = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const identity: RenderProofIdentity = { ...input, database, principal, fixtureDigest: fixtureDigest(fixture), gameId: fixture.game.id,
    migrationSet: calculateMigrationSet(), leaseId: randomUUID(), fencingToken: 1 };
  const fixtureObject = await storeJson(fixture);
  const snapshotObject = await storeJson(fixture.media.snapshot);
  try {
    await owner.begin(async transaction => {
    const tx = transaction as unknown as ProofSQL;
      await tx`CREATE TABLE render_proof_guard (id integer PRIMARY KEY CHECK(id=1), identity jsonb NOT NULL, fixture_object jsonb NOT NULL)`;
      await tx`INSERT INTO render_proof_guard VALUES (1,${tx.json(JSON.parse(JSON.stringify(identity)))},${tx.json(JSON.parse(JSON.stringify(fixtureObject)))})`;
      await tx`INSERT INTO games (id,slug,game_kind,config,status,track_type) VALUES (${fixture.game.id},${fixture.game.slug},${fixture.game.gameKind},${fixture.game.config},'completed','custom')`;
      await tx`INSERT INTO game_postgame_media (game_id,media_type,status,render_version,attempt_number,artifact_version,render_input_snapshot_object,render_input_snapshot_hash,render_input_snapshot_version,renderer_version,timing_contract_version,music_asset_id)
        VALUES (${fixture.game.id},'house_highlights_trailer','waiting_inputs',${fixture.media.renderVersion},1,${randomUUID()},${tx.json(JSON.parse(JSON.stringify(snapshotObject)))},${fixture.media.snapshotHash},${fixture.media.snapshotVersion},${fixture.media.rendererVersion},${fixture.media.timingContractVersion},${fixture.media.musicAssetId})`;
      await tx`INSERT INTO postgame_media_render_release(id,mode,draining) VALUES(1,'local',false)`;
      // Existing admission fence, non-expiring switching phase, only inside this fresh DB.
      await tx`INSERT INTO deployment_admission_leases(id,fencing_token,candidate_sha,source_repository,workflow_run_id,workflow_run_attempt,actor,phase,status,expires_at,absolute_deadline_at)
        VALUES(${identity.leaseId},1,${input.candidateSha},'0xFlicker/linode-iac',${input.workflowRunId},${input.workflowRunAttempt},'render-proof','switching','active',now()::text,now()::text)`;
      await tx`UPDATE deployment_admission_state SET next_fencing_token=2 WHERE id=1`;
      await tx.unsafe(`REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO ${identifier(principal)}`);
      await tx.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${identifier(principal)}`);
      await tx.unsafe("REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC");
      for (const [table, grants] of Object.entries(PROOF_WRITES)) await tx.unsafe(`GRANT ${grants.join(",")} ON ${identifier(table)} TO ${identifier(principal)}`);
    });
  } finally { await owner.end(); }
  return identity;
}

/** Whole-database containment, not merely a selected game's state. Unknown populated tables fail closed. */
export async function assertProofDatabase(sql: ProofSQL, runId: string): Promise<RenderProofIdentity> {
  const database = proofDatabase(runId);
  const [who] = await sql`SELECT current_database() AS database,current_user AS principal`;
  if (who?.database !== database || who.principal !== database + "_api") throw new Error("Proof database or principal differs");
  const [role] = await sql`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
  const memberships = await sql`SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)`;
  if (!role || Object.values(role).some(Boolean) || memberships.length) throw new Error("Proof principal has excess authority");
  const [guard] = await sql`SELECT identity,fixture_object AS fixture FROM render_proof_guard WHERE id=1`;
  if (guard) guard.fixture = await readJson(guard.fixture);
  const identity = guard?.identity as RenderProofIdentity | undefined;
  if (!guard || !identity || identity.runId !== runId || identity.database !== database || identity.principal !== who.principal
    || identity.fixtureDigest !== fixtureDigest(validateFixture(guard.fixture)) || identity.migrationSet !== calculateMigrationSet()) throw new Error("Proof guard or release migrations differ");
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
  const unrelated = tables.map(table => String(table.tablename)).filter(name => !STATIC_TABLES.has(name) && !PROOF_TABLES.has(name));
  if (unrelated.length) {
    // Batch whole-DB checks: the staging/prod databases share a managed server.
    // A proof sweep must not add hundreds of round trips to that server.
    const rows = await sql.unsafe(unrelated.map(name => {
      const quoted = identifier(name); // also validates the literal below
      return `SELECT '${name}' AS name, EXISTS(SELECT 1 FROM ${quoted} LIMIT 1) AS populated`;
    }).join(" UNION ALL "));
    const populated = rows.find(row => row.populated);
    if (populated) throw new Error("Unrelated or upstream proof data: " + String(populated.name));
  }
  const rights = await sql`SELECT t.tablename,p.action,has_table_privilege(current_user,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),p.action) AS allowed
    FROM pg_tables t CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER']) AS p(action) WHERE t.schemaname='public'`;
  for (const right of rights) {
    const name = String(right.tablename), action = String(right.action);
    if (Boolean(right.allowed) !== Boolean(PROOF_WRITES[name]?.includes(action))) throw new Error("Proof table permissions differ: " + name + " " + action);
  }
  const [authority] = await sql`SELECT has_database_privilege(current_user,current_database(),'CREATE') AS db_create,
    has_database_privilege(current_user,current_database(),'TEMP') AS db_temp,
    has_schema_privilege(current_user,'public','CREATE') AS schema_create,
    (SELECT datdba FROM pg_database WHERE datname=current_database())=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owner`;
  if (!authority || Object.values(authority).some(Boolean)) throw new Error("Proof principal can create or own database objects");
  const definer = await sql`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE')`;
  if (definer.length) throw new Error("Proof principal can execute a security-definer function");
  const fixture = validateFixture(guard.fixture);
  const games = await sql`SELECT id,slug,game_kind,config,status,hidden_at FROM games`;
  if (games.length !== 1 || games[0]?.id !== identity.gameId || games[0]?.status !== "completed" || games[0]?.hidden_at
    || games[0]?.slug !== fixture.game.slug || games[0]?.game_kind !== fixture.game.gameKind
    || proofDigest(JSON.parse(games[0]?.config)) !== proofDigest(JSON.parse(fixture.game.config))) throw new Error("Proof game inventory differs");
  const media = await sql`SELECT game_id,render_input_snapshot_object,render_input_snapshot_hash FROM game_postgame_media`;
  if (media.length !== 1 || media[0]?.game_id !== identity.gameId || media[0]?.render_input_snapshot_hash !== fixture.media.snapshotHash
    || hashHouseHighlightsTrailerManifest(parseHouseHighlightsTrailerManifest(await readJson(media[0]?.render_input_snapshot_object))) !== fixture.media.snapshotHash) throw new Error("Proof frozen input changed");
  const holds = await sql`SELECT id,fencing_token,status,phase FROM deployment_admission_leases WHERE status='active'`;
  if (holds.length !== 1 || holds[0]?.id !== identity.leaseId || Number(holds[0]?.fencing_token) !== identity.fencingToken || holds[0]?.phase !== "switching") throw new Error("Proof admission hold differs");
  return identity;
}

export async function queueProofFixture(sql: ProofSQL, runId: string) {
  const identity = await assertProofDatabase(sql, runId);
  return sql.begin(async transaction => {
    const tx = transaction as unknown as ProofSQL;
    const [guard] = await tx`SELECT fixture_object AS fixture FROM render_proof_guard WHERE id=1`;
    if (!guard) throw new Error("Proof guard absent");
    const fixture = validateFixture(await readJson(guard.fixture));
    const [release] = await tx`SELECT mode,draining,generation FROM postgame_media_render_release WHERE id=1 FOR UPDATE`;
    if (release?.mode !== "remote" || release.draining || !release.generation) throw new Error("Remote renderer is not admitted");
    // Admission creates a wake for the ordinary dispatcher. In this fresh DB,
    // no job exists yet: replace that local intent with the single enqueue wake.
    // Nothing has been delivered to SQS and no shared queue is purged/reset.
    const [fresh] = await tx`SELECT 1 FROM game_postgame_media WHERE game_id=${identity.gameId} AND status='waiting_inputs' AND render_version=${fixture.media.renderVersion} FOR UPDATE`;
    if (!fresh) throw new Error("Proof fixture was already queued; use a new proof run");
    await tx`DELETE FROM postgame_media_wake_outbox WHERE delivered_at IS NULL`;
    const [job] = await tx`UPDATE game_postgame_media SET status='queued',render_version=render_version+1,artifact_version=${randomUUID()},updated_at=now()::text
      WHERE game_id=${identity.gameId} AND status='waiting_inputs' AND render_version=${fixture.media.renderVersion} RETURNING render_version`;
    if (!job) throw new Error("Proof fixture was already queued; use a new proof run");
    return { gameId: identity.gameId, renderVersion: job.render_version };
  });
}

/** Safe local receipt; cloud/task/tailnet and restoration evidence is collected by the host harness. */
export async function proofDatabaseReceipt(sql: ProofSQL, runId: string) {
  const identity = await assertProofDatabase(sql, runId);
  const [job] = await sql`SELECT status,render_version,attempt_number,claimed_at,attempt_started_at,attempt_finished_at,lease_expires_at,render_duration_ms,artifact_metadata FROM game_postgame_media WHERE game_id=${identity.gameId}`;
  const [wakes] = await sql`SELECT count(*) FILTER(WHERE delivered_at IS NULL)::int AS pending FROM postgame_media_wake_outbox`;
  if (!job || !wakes) throw new Error("Proof receipt inventory differs");
  const artifacts = job.artifact_metadata as Record<string, { byteLength?: number; contentType?: string }> | null;
  return { schemaVersion: 1, identity, status: job.status, renderVersion: job.render_version, attemptNumber: job.attempt_number,
    claimedAt: job.claimed_at, startedAt: job.attempt_started_at, finishedAt: job.attempt_finished_at,
    leaseExpiresAt: job.lease_expires_at, renderDurationMs: job.render_duration_ms, pendingWakes: wakes.pending,
    artifacts: Object.fromEntries(["video", "poster", "captions", "manifest"].map(key => [key, { bytes: artifacts?.[key]?.byteLength ?? 0, contentType: artifacts?.[key]?.contentType ?? null }])) };
}
