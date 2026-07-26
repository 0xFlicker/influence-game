import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";

const probePath = resolve(import.meta.dir, "fixtures/test-db-process-lock-probe.ts");
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://influence:influence@127.0.0.1:54320/influence_test";
const probeLockNamespace = 0x494e464c;
const probeLockId = 1_000_000_000 + (process.pid % 1_000_000);
const spawned: Bun.Subprocess[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  for (const processHandle of spawned) {
    if (processHandle.exitCode === null) processHandle.kill();
  }
  await Promise.all(spawned.map((processHandle) => processHandle.exited));
  spawned.length = 0;
  for (const directory of tempDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
  tempDirectories.length = 0;
});

async function waitForFile(path: string, processHandle: Bun.Subprocess): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await Bun.file(path).exists()) return;
    if (processHandle.exitCode !== null) {
      const stderr = processHandle.stderr instanceof ReadableStream
        ? await new Response(processHandle.stderr).text()
        : "";
      throw new Error(`DB lock probe exited before acquiring the lock: ${stderr}`);
    }
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for DB lock probe");
}

function spawnProbe(holdMs: number, startedPath: string, readyPath: string): Bun.Subprocess {
  const processHandle = Bun.spawn(
    [process.execPath, "run", probePath, String(holdMs), startedPath, readyPath],
    {
      cwd: resolve(import.meta.dir, "../.."),
      env: {
        ...process.env,
        DRIZZLE_MIGRATIONS_DIR: "./drizzle",
        INFLUENCE_TEST_DB_ADVISORY_LOCK_ID: String(probeLockId),
      },
      stdout: "ignore",
      stderr: "pipe",
    },
  );
  spawned.push(processHandle);
  return processHandle;
}

async function waitForAdvisoryLockContention(): Promise<void> {
  const client = postgres(testDatabaseUrl, { max: 1, onnotice: () => {} });
  try {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const rows = await client<{ granted: boolean }[]>`
        SELECT granted
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND classid::bigint = ${probeLockNamespace}
          AND objid::bigint = ${probeLockId}
      `;
      if (rows.some(({ granted }) => granted) && rows.some(({ granted }) => !granted)) {
        return;
      }
      await Bun.sleep(10);
    }
  } finally {
    await client.end({ timeout: 1 });
  }
  throw new Error("Timed out waiting for one advisory lock owner and one waiter");
}

describe("shared test database process lock", () => {
  test("blocks a second Bun process until the first process exits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "influence-db-lock-"));
    tempDirectories.push(directory);
    const firstStartedPath = join(directory, "first-started");
    const firstReadyPath = join(directory, "first-ready");
    const secondStartedPath = join(directory, "second-started");
    const secondReadyPath = join(directory, "second-ready");

    const first = spawnProbe(1_500, firstStartedPath, firstReadyPath);
    await waitForFile(firstReadyPath, first);

    const second = spawnProbe(0, secondStartedPath, secondReadyPath);
    await waitForFile(secondStartedPath, second);
    await waitForAdvisoryLockContention();

    expect(await first.exited).toBe(0);
    await waitForFile(secondReadyPath, second);
    expect(await second.exited).toBe(0);
  }, 10_000);
});
