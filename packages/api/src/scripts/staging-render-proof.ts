/** Explicit operator CLI. Does not run on build, import, or normal API startup. */
import { readFileSync, writeFileSync, openSync, fstatSync, closeSync, constants } from "node:fs";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { exportProofFixture, prepareProofDatabase, proofDatabaseReceipt, assertProofDatabase, validateFixture, proofDigest, type RenderProofIdentity } from "../services/staging-render-proof.js";

function privateFile(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid?.() || st.size > 10 * 1024 * 1024) throw new Error("Operator input must be a private owned regular file");
    return readFileSync(fd, "utf8").trim();
  } finally { closeSync(fd); }
}
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  "run-id": { type: "string" }, "game-id": { type: "string" }, "url-file": { type: "string" },
  fixture: { type: "string" }, approval: { type: "string" }, output: { type: "string" }, confirm: { type: "string" },
} });
const command = positionals[0];
if (!values["url-file"]) throw new Error("Use --url-file; never pass database credentials as command arguments");
const url = privateFile(values["url-file"]);
try {
  if (command === "prepare") {
    if (values.confirm !== "CREATE_FRESH_PROOF_DATABASE" || !values.fixture || !values.approval || !values.output) throw new Error("Exact proof approval, fixture, output and create confirmation required");
    const approval = JSON.parse(privateFile(values.approval)) as Parameters<typeof prepareProofDatabase>[2];
    const identity = await prepareProofDatabase(url, validateFixture(JSON.parse(privateFile(values.fixture))), approval);
    writeFileSync(values.output, JSON.stringify(identity, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.info("Proof DB/principal prepared with NOLOGIN; secure credential entry remains separate");
  } else {
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      if (command === "export") {
        if (!values["game-id"] || !values.output) throw new Error("Fixture ID and private output required");
        writeFileSync(values.output, JSON.stringify(await exportProofFixture(sql, values["game-id"]), null, 2) + "\n", { mode: 0o600, flag: "wx" });
        console.info("Exported one ready, frozen staging fixture; no providers or writes");
      } else if (command === "verify" || command === "receipt") {
        if (!values["run-id"]) throw new Error("Proof run ID required");
        const result = command === "verify" ? await assertProofDatabase(sql, values["run-id"]) : await proofDatabaseReceipt(sql, values["run-id"]);
        if (!values.output) throw new Error("Private output required");
        writeFileSync(values.output, JSON.stringify(result, null, 2) + "\n", { mode: 0o600, flag: "wx" });
        console.info("Verified proof metadata written without credentials or lease tokens");
      } else if (command === "cleanup") {
        // Cleanup requires the host's explicit, verified restore receipt. Do not
        // terminate sessions, reset renderer state, purge queues, or force-drop.
        if (!values.approval || values.confirm !== "DROP_EXACT_RESTORED_PROOF_DATABASE") throw new Error("Verified restoration receipt and exact cleanup confirmation required");
        const receipt = JSON.parse(privateFile(values.approval)) as { identity: RenderProofIdentity; proofStopped: boolean; normalDatabaseRestored: boolean; cloudOccupied: unknown; tailnetCleanupConfirmed: boolean };
        const id = receipt.identity;
        if (receipt.proofStopped !== true || receipt.normalDatabaseRestored !== true || receipt.cloudOccupied !== null || receipt.tailnetCleanupConfirmed !== true
          || id.runId !== values["run-id"] || !/^influence_render_proof_[a-z0-9_]{8,32}$/.test(id.database) || id.principal !== id.database + "_api") throw new Error("Proof restoration incomplete");
        const [who] = await sql`SELECT current_database() AS name,current_user AS principal`;
        if (who?.name === id.database || who?.principal === id.principal) throw new Error("Cleanup requires separately authorized administration, not proof runtime");
        const [active] = await sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=${id.database}`;
        if (active?.count !== 0) throw new Error("Proof database still has connected writers");
        const checkUrl = new URL(url); checkUrl.pathname = "/" + id.database;
        const check = postgres(checkUrl.toString(), { max: 1, onnotice: () => {} });
        try {
          const [guard] = await check`SELECT identity FROM render_proof_guard WHERE id=1`;
          if (proofDigest(guard?.identity) !== proofDigest(id)) throw new Error("Cleanup identity differs from database guard");
          const leases = await check`SELECT 1 FROM game_postgame_media WHERE status IN ('queued','claimed','rendering','composing','uploading')`;
          if (leases.length) throw new Error("Proof rendering is not terminal");
        } finally { await check.end(); }
        await sql.unsafe('DROP DATABASE "' + id.database + '"');
        await sql.unsafe('DROP ROLE "' + id.principal + '"');
        console.info("Removed only the restored proof DB/principal; cloud state and assets retained");
      } else throw new Error("Use export, prepare, verify, receipt, or cleanup");
    } finally { await sql.end(); }
  }
} catch { console.error("Render proof command failed; private state retained for diagnosis; no automatic cleanup"); process.exitCode = 1; }
