import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const scriptPath = join(repoRoot, "scripts/free-game-draw.sh");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function runDrawScript(drawKey?: string) {
  const directory = await mkdtemp(join(tmpdir(), "free-game-draw-test-"));
  tempDirs.push(directory);
  const capturePath = join(directory, "curl-args.txt");
  const uuidgenPath = join(directory, "uuidgen");
  const curlPath = join(directory, "curl");

  await Bun.write(uuidgenPath, "#!/bin/sh\nprintf 'ABCDEF12-3456-7890-ABCD-EF1234567890\\n'\n");
  await Bun.write(curlPath, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$CAPTURE_PATH\"\nprintf '{\"drawn\":true}\\n201\\n'\n");
  await Promise.all([chmod(uuidgenPath, 0o755), chmod(curlPath, 0o755)]);

  const env: Record<string, string> = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH ?? ""}`,
    CAPTURE_PATH: capturePath,
    FREE_GAME_API_URL: "https://api.example.test",
    FREE_GAME_CRON_TOKEN: "test-token",
  };
  if (drawKey !== undefined) env.FREE_GAME_DRAW_KEY = drawKey;

  const processHandle = Bun.spawn(["bash", scriptPath], {
    cwd: repoRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);

  return {
    exitCode,
    stdout,
    stderr,
    curlArgs: await readFile(capturePath, "utf8").catch(() => ""),
  };
}

describe("free game draw operator script", () => {
  test("generates, prints, and forwards a stable manual request key", async () => {
    const result = await runDrawScript();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Idempotency key: daily-free:manual:abcdef12-3456-7890-abcd-ef1234567890",
    );
    expect(result.curlArgs).toContain(
      "Idempotency-Key: daily-free:manual:abcdef12-3456-7890-abcd-ef1234567890",
    );
  });

  test("reuses an explicit recovery key and rejects invalid keys before curl", async () => {
    const recovery = await runDrawScript("daily-free:schedule:2026-07-16T23:00:00Z");
    expect(recovery.exitCode).toBe(0);
    expect(recovery.curlArgs).toContain(
      "Idempotency-Key: daily-free:schedule:2026-07-16T23:00:00Z",
    );

    const invalid = await runDrawScript("   ");
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("FREE_GAME_DRAW_KEY must contain between 1 and 200 characters.");
    expect(invalid.curlArgs).toBe("");
  });
});
