import { describe, expect, test } from "bun:test";
import {
  assertRehearsalDatabaseUrl,
  assertRehearsalHealth,
} from "../packages/api/src/scripts/local-game-worker-rehearsal";

describe("local game-worker rehearsal guards", () => {
  test("accepts only explicitly named loopback rehearsal databases", () => {
    expect(assertRehearsalDatabaseUrl("postgresql://influence:influence@127.0.0.1:54320/influence_rehearsal_safe").pathname).toBe("/influence_rehearsal_safe");
  });
  test.each(["postgresql://influence:influence@127.0.0.1:54320/influence_test", "postgresql://influence:influence@localhost:54320/influence_rehearsal_safe", "postgresql://influence:influence@127.0.0.1:54320/postgres", "postgresql://influence:influence@127.0.0.1:54320/influence_rehearsal_unsafe-name"]) ("rejects unsafe database %s", (url) => expect(() => assertRehearsalDatabaseUrl(url)).toThrow());

  test("proves the API runtimeRole rather than an invented role field", () => {
    expect(() => assertRehearsalHealth({ runtimeRole: "gateway" }, "gateway")).not.toThrow();
    expect(() => assertRehearsalHealth({ role: "gateway" }, "gateway")).toThrow();
  });

  test("requires the expected immutable image digest for a game worker", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(() => assertRehearsalHealth(
      { runtimeRole: "game-worker", releaseControl: { imageDigest: digest } },
      "game-worker",
      digest,
    )).not.toThrow();
    expect(() => assertRehearsalHealth(
      { runtimeRole: "game-worker", releaseControl: { imageDigest: "sha256:wrong" } },
      "game-worker",
      digest,
    )).toThrow("exact image digest");
  });

  test("tracks and stops only the companion game-worker process", async () => {
    const launcher = await Bun.file("scripts/start-game-worker-local.sh").text();
    const stopper = await Bun.file("scripts/stop-game-worker-local.sh").text();

    expect(launcher).toContain("worker_pid=$!");
    expect(launcher).toContain('ps -p "$worker_pid" -o lstart=');
    expect(stopper).toContain('kill -TERM "$pid"');
    expect(stopper).not.toContain("pkill");
  });
});
