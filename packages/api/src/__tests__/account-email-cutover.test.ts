import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { applyMigrationsSerialized } from "../db/serialized-migrations.js";
import { hashAccountEmail } from "../lib/verified-email.js";

test("stopped-writer email upgrade rewrites tables and preserves legacy and verified matches", async () => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://influence:influence@127.0.0.1:54320/influence_test");
  url.pathname = "/postgres";
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const name = `email_cutover_${randomUUID().replaceAll("-", "")}`;
  const base = await mkdtemp(join(tmpdir(), "house-email-cutover-"));
  const full = resolve(import.meta.dir, "../../drizzle");
  process.env.ACCOUNT_EMAIL_HMAC_KEY ??= Buffer.alloc(32, 7).toString("base64");

  await admin.unsafe(`CREATE DATABASE ${name}`);
  url.pathname = `/${name}`;
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const journal = JSON.parse(await readFile(join(full, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    journal.entries = journal.entries.filter(entry => entry.idx < 176);
    await mkdir(join(base, "meta"));
    await writeFile(join(base, "meta/_journal.json"), JSON.stringify(journal));
    await Promise.all(journal.entries.map(({ tag }) => symlink(join(full, `${tag}.sql`), join(base, `${tag}.sql`))));
    await applyMigrationsSerialized(url.toString(), base);
    await db`INSERT INTO users (id, email, display_name) VALUES
      ('legacy', ' Person+Tag@Example.Test ', 'Person+Tag@example.test'),
      ('other', 'Person+Tag@example.test', 'Keep this name')`;
    await db`INSERT INTO verified_email_claims (normalized_email, user_id, state) VALUES
      ('person+tag@example.test', 'legacy', 'active'), ('conflict@example.test', NULL, 'conflict')`;
    const [before] = await db`SELECT pg_relation_filenode('users') AS users, pg_relation_filenode('verified_email_claims') AS claims`;
    await expect(applyMigrationsSerialized(url.toString(), full)).rejects.toThrow("stopped-writer cutover");
    await expect(applyMigrationsSerialized(url.toString(), full, {
      accountEmailCutover: true, verifyWritersStopped: true,
    })).rejects.toThrow("Disconnect all");
    await db.end();
    await applyMigrationsSerialized(url.toString(), full, { accountEmailCutover: true, verifyWritersStopped: true });

    const reader = postgres(url.toString(), { max: 1 });
    try {
      const [after] = await reader`SELECT pg_relation_filenode('users') AS users, pg_relation_filenode('verified_email_claims') AS claims`;
      expect(after!.users).not.toBe(before!.users);
      expect(after!.claims).not.toBe(before!.claims);
      const hash = hashAccountEmail("person+tag@example.test");
      expect([...(await reader`SELECT id, legacy_email_hash, display_name FROM users ORDER BY id`)]).toEqual([
        { id: "legacy", legacy_email_hash: hash, display_name: null },
        { id: "other", legacy_email_hash: hash, display_name: "Keep this name" },
      ]);
      expect([...(await reader`SELECT email_hash, user_id, state FROM verified_email_claims ORDER BY state`)]).toEqual([
        { email_hash: hash, user_id: "legacy", state: "active" },
        { email_hash: hashAccountEmail("conflict@example.test"), user_id: null, state: "conflict" },
      ]);
      expect(await reader`SELECT column_name FROM information_schema.columns
        WHERE (table_name, column_name) IN (('users','email'),('verified_email_claims','normalized_email'))`).toHaveLength(0);
    } finally {
      await reader.end();
    }
  } finally {
    await db.end();
    await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
    await rm(base, { recursive: true, force: true });
  }
}, 60_000);
