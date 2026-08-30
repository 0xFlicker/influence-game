import { describe, expect, test } from "bun:test";
import { assertRehearsalDatabaseUrl } from "../packages/api/src/scripts/local-game-worker-rehearsal";

describe("local game-worker rehearsal guards", () => {
  test("accepts only explicitly named loopback rehearsal databases", () => {
    expect(assertRehearsalDatabaseUrl("postgresql://influence:influence@127.0.0.1:54320/influence_rehearsal_safe").pathname).toBe("/influence_rehearsal_safe");
  });
  test.each(["postgresql://influence:influence@127.0.0.1:54320/influence_test", "postgresql://influence:influence@localhost:54320/influence_rehearsal_safe", "postgresql://influence:influence@127.0.0.1:54320/postgres", "postgresql://influence:influence@127.0.0.1:54320/influence_rehearsal_unsafe-name"]) ("rejects unsafe database %s", (url) => expect(() => assertRehearsalDatabaseUrl(url)).toThrow());
});
