import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startLocalHarness, stopLocalHarness } from "../e2e/local-harness";
import { cleanupE2eResources } from "../packages/api/src/e2e/cleanup";

let fixtureDirectory: string | null = null;

afterEach(async () => {
  delete process.env.LOCAL_HARNESS_FIXTURE_MODE;
  delete process.env.LOCAL_HARNESS_FIXTURE_PID_FILE;
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
  fixtureDirectory = null;
});

describe("local harness lifecycle", () => {
  test("terminates a child that publishes malformed readiness JSON", async () => {
    const pidFile = await configureFixture("malformed");
    await expect(startFixture(2_000)).rejects.toThrow("Fixture failed:");
    expect(processIsRunning(Number(await readFile(pidFile, "utf8")))).toBe(false);
  });

  test("escalates a startup timeout when the child ignores SIGTERM", async () => {
    const pidFile = await configureFixture("timeout");
    await expect(startFixture(500)).rejects.toThrow("startup exceeded 500ms");
    expect(processIsRunning(Number(await readFile(pidFile, "utf8")))).toBe(false);
  });

  test("rejects a nonzero graceful teardown exit", async () => {
    await configureFixture("ready-nonzero");
    const started = await startFixture(2_000);
    await expect(stopLocalHarness(started.process, 500)).rejects.toThrow("exit code 1");
  });

  test("attempts every ordered cleanup step and aggregates failures", async () => {
    const attempted: string[] = [];
    await expect(cleanupE2eResources([
      ["browser", () => { attempted.push("browser"); throw new Error("browser failed"); }],
      ["servers", () => { attempted.push("servers"); throw new Error("servers failed"); }],
      ["database", () => { attempted.push("database"); }],
    ])).rejects.toBeInstanceOf(AggregateError);
    expect(attempted).toEqual(["browser", "servers", "database"]);
  });
});

async function configureFixture(
  mode: "malformed" | "timeout" | "ready-nonzero",
): Promise<string> {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), "influence-local-harness-"));
  const pidFile = path.join(fixtureDirectory, "pid");
  process.env.LOCAL_HARNESS_FIXTURE_MODE = mode;
  process.env.LOCAL_HARNESS_FIXTURE_PID_FILE = pidFile;
  return pidFile;
}

function startFixture(startupTimeoutMs: number) {
  return startLocalHarness({
    script: "scripts/fixtures/local-harness-fixture.ts",
    readyPrefix: "FIXTURE_READY ",
    startupTimeoutMs,
    shutdownTimeoutMs: 50,
    errorLabel: "Fixture failed",
  });
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
