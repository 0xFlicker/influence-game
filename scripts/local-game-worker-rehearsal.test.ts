import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertRehearsalDatabaseUrl } from "../packages/api/src/scripts/local-game-worker-rehearsal";

describe("local game-worker rehearsal guards", () => {
  test("accepts only explicitly named loopback rehearsal databases", () => {
    expect(assertRehearsalDatabaseUrl("postgresql://influence:influence@127.0.0.1:54320/influence_rehearsal_safe").pathname).toBe("/influence_rehearsal_safe");
  });
  test.each(["postgresql://influence:influence@127.0.0.1:54320/influence_test", "postgresql://influence:influence@localhost:54320/influence_rehearsal_safe", "postgresql://influence:influence@127.0.0.1:54320/postgres", "postgresql://influence:influence@127.0.0.1:54320/influence_rehearsal_unsafe-name"]) ("rejects unsafe database %s", (url) => expect(() => assertRehearsalDatabaseUrl(url)).toThrow());

  test("keeps the documented replacement-worker port variable aligned with the launcher", () => {
    const root = path.resolve(import.meta.dir, "..");
    const runbook = readFileSync(path.join(root, "docs/deployment/game-worker-operations.md"), "utf8");
    const launcher = readFileSync(path.join(root, "scripts/start-game-worker-local.sh"), "utf8");
    expect(runbook).toContain("REHEARSAL_WORKER_PORT=3102");
    expect(launcher).toContain("REHEARSAL_WORKER_PORT:-3101");
    expect(launcher).not.toContain("GAME_WORKER_PORT");
  });
});
