import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLocalGameRuntime } from "../services/local-game-runtime.js";

test("local adapters require a local runtime, even with a loopback database", () => {
  for (const NODE_ENV of ["staging", "production"]) expect(isLocalGameRuntime({ NODE_ENV, DATABASE_URL: "postgres://localhost/test" })).toBe(false);
  for (const NODE_ENV of ["development", "test"]) expect(isLocalGameRuntime({ NODE_ENV })).toBe(true);
  expect(isLocalGameRuntime({ DATABASE_URL: "postgres://127.0.0.1/test" })).toBe(true);
  expect(isLocalGameRuntime({ DATABASE_URL: "postgres://remote/test" })).toBe(false);
  expect(isLocalGameRuntime({})).toBe(false);
});

test("Bun deployment bundle uses runtime environment, not the build environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "championship-runtime-"));
  try {
    // Same target and default build defines as Dockerfile.api.
    const result = await Bun.build({ entrypoints: [join(import.meta.dir, "../services/local-game-runtime.ts")], target: "bun", outdir: directory });
    expect(result.success).toBe(true);
    const path = join(directory, "local-game-runtime.js");
    for (const [NODE_ENV, expected] of [["staging", false], ["production", false], ["development", true], ["test", true]] as const) {
      const child = Bun.spawn([process.execPath, "-e", `const m=await import(${JSON.stringify(path)});console.log(m.isLocalGameRuntime())`], {
        env: { ...process.env, NODE_ENV, DATABASE_URL: "postgres://localhost/test" }, stdout: "pipe", stderr: "pipe",
      });
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      expect(output.trim()).toBe(String(expected));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
