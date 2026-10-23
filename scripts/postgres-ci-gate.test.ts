import { expect, test } from "bun:test";

interface Job {
  name: string;
  needs?: string[];
  if?: string;
  "continue-on-error"?: boolean;
  strategy?: { "fail-fast": boolean; matrix: { shard: number[] } };
  services?: { postgres?: unknown };
  steps: { run?: string; if?: string; env?: Record<string, string>; "continue-on-error"?: boolean }[];
}

const { jobs } = Bun.YAML.parse(
  await Bun.file(new URL("../.github/workflows/ci.yml", import.meta.url)).text(),
) as { jobs: Record<string, Job> };
const gate = jobs["api-postgres"]!;
const shards = jobs["api-postgres-shards"]!;

test("required PostgreSQL gate covers every isolated serial shard", async () => {
  expect(gate.name).toBe("API / PostgreSQL tests");
  expect(gate.needs).toEqual(["api-postgres-shards"]);
  expect(gate.if).toBe("${{ always() }}");
  expect(gate["continue-on-error"]).not.toBe(true);
  expect(shards["continue-on-error"]).not.toBe(true);
  expect(shards.strategy?.["fail-fast"]).toBe(false);
  expect(shards.services?.postgres).toBeDefined();

  const step = shards.steps.find(step => step.run?.startsWith("bun run test:postgres"))!;
  expect(step.if).toBeUndefined();
  expect(step["continue-on-error"]).not.toBe(true);
  const match = step.run?.match(/^bun run test:postgres --shard=\$\{\{ matrix\.shard \}\}\/(\d+)$/);
  expect(match).not.toBeNull();
  const count = Number(match![1]);
  expect(count).toBeGreaterThan(1);
  expect(shards.strategy?.matrix.shard).toEqual(Array.from({ length: count }, (_, i) => i + 1));
  const api = await Bun.file(new URL("../packages/api/package.json", import.meta.url)).json();
  expect(api.scripts["test:postgres"]).toContain("--max-concurrency 1");
  expect(api.scripts["test:postgres"]).not.toMatch(/--(?:parallel|concurrent)\b/);
  expect(jobs["release-manifest"]!.needs).toContain("api-postgres");
});

for (const result of ["success", "failure", "cancelled", "skipped", ""]) {
  test(`PostgreSQL gate ${result === "success" ? "accepts" : "rejects"} ${result || "missing result"}`, async () => {
    expect(gate.steps).toHaveLength(1);
    const step = gate.steps[0]!;
    expect(step.if).toBeUndefined();
    expect(step.env?.SHARD_RESULT).toBe("${{ needs.api-postgres-shards.result }}");
    expect(step["continue-on-error"]).not.toBe(true);
    const process = Bun.spawn(["bash", "-e", "-c", step.run!], {
      env: { ...Bun.env, SHARD_RESULT: result },
      stdout: "ignore",
      stderr: "inherit",
    });
    expect(await process.exited).toBe(result === "success" ? 0 : 1);
  });
}
