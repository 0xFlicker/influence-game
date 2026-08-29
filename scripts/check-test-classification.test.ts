import { describe, expect, test } from "bun:test";
import {
  classifyTestFile,
  isRepositoryTestFile,
  validateBrowserSpecRunners,
} from "./check-test-classification";

describe("test classification ownership", () => {
  test("recognizes every Bun test basename convention", () => {
    for (const basename of [
      "ordinary.test.ts",
      "ordinary_test.tsx",
      "ordinary.spec.js",
      "ordinary_spec.jsx",
    ]) {
      const file = `packages/engine/src/${basename}`;
      expect(isRepositoryTestFile(file)).toBe(true);
      expect(classifyTestFile(file)).toEqual(["provider-free"]);
    }
  });

  test("recognizes Playwright test and module extensions", () => {
    for (const basename of [
      "new-story.test.ts",
      "new-story.spec.mts",
      "new-story.test.cjs",
      "new-story.spec.tsx",
    ]) {
      const file = `e2e/${basename}`;
      expect(isRepositoryTestFile(file)).toBe(true);
      expect(classifyTestFile(file)).toBeInstanceOf(Error);
    }
  });

  test("records both deterministic and real-Clerk ownership", () => {
    expect(classifyTestFile("e2e/layered-authentication.spec.ts")).toEqual([
      "browser-coverage",
      "real-clerk",
    ]);
  });

  test("rejects browser ownership without an executable package runner", () => {
    const errors = validateBrowserSpecRunners({
      "test:e2e:identity": "echo e2e/public-player-identity.spec.ts",
    });
    expect(errors).toContain(
      "e2e/public-player-identity.spec.ts package runner test:e2e:identity must be: PLAYWRIGHT_LOCAL_IDENTITY=1 bunx playwright test e2e/public-player-identity.spec.ts",
    );
  });

  test("rejects swapped deterministic and real-Clerk selectors", () => {
    const errors = validateBrowserSpecRunners({
      "test:e2e:layered-auth": "PLAYWRIGHT_LAYERED_AUTH=real-clerk bunx playwright test e2e/layered-authentication.spec.ts --project=layered-auth-real-clerk",
    });
    expect(errors).toContain(
      "e2e/layered-authentication.spec.ts package runner test:e2e:layered-auth must be: PLAYWRIGHT_LAYERED_AUTH=deterministic bunx playwright test e2e/layered-authentication.spec.ts --project=layered-auth-deterministic",
    );
  });

  test("assigns every owned API path to a runner that searches the package root", () => {
    expect(classifyTestFile("packages/api/root-level.test.ts")).toEqual([
      "api-postgres",
    ]);
  });

  test("classifies every lane and fails closed at exceptional API boundaries", () => {
    const owned: Array<[string, readonly string[]]> = [
      ["packages/engine/src/ordinary.test.ts", ["provider-free"]],
      ["packages/api/src/services/ordinary.test.ts", ["api-postgres"]],
      ["packages/api/src/e2e/story.e2e.test.ts", ["browser-coverage"]],
      ["packages/engine/src/run.live-provider.test.ts", ["live-provider"]],
      ["packages/api/src/run.external-smoke.test.ts", ["external-smoke"]],
      ["e2e/smoke.spec.ts", ["staging"]],
    ];
    for (const [file, lanes] of owned) {
      expect(classifyTestFile(file)).toEqual(lanes);
    }
    expect(classifyTestFile("packages/api/src/e2e/unowned.test.ts"))
      .toBeInstanceOf(Error);
  });

  test("rejects malformed reserved manual-suite suffixes", () => {
    for (const file of [
      "packages/engine/src/paid.live-provider.spec.ts",
      "packages/api/src/__tests__/trace.external-smoke.spec.ts",
      "packages/engine/src/paid.live-provider_test.ts",
      "packages/api/src/__tests__/trace.external-smoke_test.ts",
    ]) {
      expect(isRepositoryTestFile(file)).toBe(true);
      expect(classifyTestFile(file)).toBeInstanceOf(Error);
    }
  });

  test("fails closed for a Bun test outside an owned source root", () => {
    const file = "test/new-surface.test.ts";
    expect(isRepositoryTestFile(file)).toBe(true);
    expect(classifyTestFile(file)).toBeInstanceOf(Error);
  });
});
