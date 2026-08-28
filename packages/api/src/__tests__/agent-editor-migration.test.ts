import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { setupTestDB } from "./test-utils.js";

const MIGRATION_PATH = new URL("../../drizzle/0073_agent_editor_avatar_attachment.sql", import.meta.url);

describe("Agent editor avatar attachment migration", () => {
  test("detaches only unconsumed legacy drafts and installs creation idempotency", async () => {
    const db = await setupTestDB();
    const testSchema = `agent_editor_${randomUUID().replaceAll("-", "")}`;
    await db.execute(sql.raw(`
      CREATE SCHEMA "${testSchema}";
      CREATE TABLE "${testSchema}"."agent_profiles" (
        "id" text PRIMARY KEY,
        "user_id" text NOT NULL
      );
      CREATE TABLE "${testSchema}"."avatar_generation_requests" (
        "id" text PRIMARY KEY,
        "agent_profile_id" text NOT NULL,
        "trigger_source" text NOT NULL,
        "safe_metadata" jsonb
      );
      INSERT INTO "${testSchema}"."agent_profiles" ("id", "user_id") VALUES
        ('profile-a', 'user-a'),
        ('profile-b', 'user-b');
      INSERT INTO "${testSchema}"."avatar_generation_requests"
        ("id", "agent_profile_id", "trigger_source", "safe_metadata")
      VALUES
        ('unconsumed-draft', 'draft-unconsumed', 'web_ai_help_draft', '{}'),
        ('consumed-draft', 'draft-consumed', 'web_ai_help_draft', '{"consumedAt":"2026-08-01T00:00:00Z"}'),
        ('other-draft', 'draft-other', 'other_source', '{}'),
        ('real-profile', 'profile-a', 'web_ai_help_draft', '{}');
    `));

    try {
      const statements = readFileSync(MIGRATION_PATH, "utf8")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${testSchema}", public`));
        for (const statement of statements) {
          await tx.execute(sql.raw(statement));
        }
      });

      const requests = await db.execute<{ id: string; agent_profile_id: string | null }>(sql.raw(`
        SELECT "id", "agent_profile_id"
        FROM "${testSchema}"."avatar_generation_requests"
        ORDER BY "id"
      `));
      expect([...requests]).toEqual([
        { id: "consumed-draft", agent_profile_id: "draft-consumed" },
        { id: "other-draft", agent_profile_id: "draft-other" },
        { id: "real-profile", agent_profile_id: "profile-a" },
        { id: "unconsumed-draft", agent_profile_id: null },
      ]);

      const columns = await db.execute<{ column_name: string; is_nullable: string }>(sql.raw(`
        SELECT "column_name", "is_nullable"
        FROM information_schema.columns
        WHERE "table_schema" = '${testSchema}'
          AND (
            ("table_name" = 'agent_profiles' AND "column_name" IN ('creation_request_id', 'creation_payload_fingerprint'))
            OR ("table_name" = 'avatar_generation_requests' AND "column_name" = 'agent_profile_id')
          )
        ORDER BY "column_name"
      `));
      expect([...columns]).toEqual([
        { column_name: "agent_profile_id", is_nullable: "YES" },
        { column_name: "creation_payload_fingerprint", is_nullable: "YES" },
        { column_name: "creation_request_id", is_nullable: "YES" },
      ]);

      await db.execute(sql.raw(`
        UPDATE "${testSchema}"."agent_profiles"
        SET "creation_request_id" = 'request-1', "creation_payload_fingerprint" = 'fingerprint-1'
        WHERE "id" = 'profile-a'
      `));
      await expect((async () => {
        await db.execute(sql.raw(`
          UPDATE "${testSchema}"."agent_profiles"
          SET "user_id" = 'user-a', "creation_request_id" = 'request-1'
          WHERE "id" = 'profile-b'
        `));
      })()).rejects.toThrow();
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });
});
