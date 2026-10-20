import { expect, test } from "bun:test";
import { resolve } from "node:path";

const cwd = resolve(import.meta.dir, "../..");
function run(source: string, upload: boolean) {
  return Bun.spawnSync([process.execPath, "-e", source], {
    cwd, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, POSTHOG_UPLOAD_SOURCEMAPS: upload ? "1" : "0", POSTHOG_PERSONAL_API_KEY: "", NEXT_PUBLIC_GIT_SHA: "a".repeat(40), POSTHOG_RELEASE_ID: "", WEBPACK: "0" },
  });
}

test("ordinary builds need no upload credential", () => {
  const ordinary = run('const {default: config} = await import("./next.config"); if (config.productionBrowserSourceMaps) throw new Error("Public maps enabled");', false);
  expect(ordinary.exitCode).toBe(0);
});

test("real PostHog compiler hook uploads only browser maps, deletes after success and fails on upload errors", () => {
  const result = run(String.raw`
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, rmSync } from "node:fs";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    import { createRequire } from "node:module";
    const { withPostHogConfig: realWrapper } = await import("@posthog/nextjs-config");
    const dir = mkdtempSync(join(tmpdir(), "house-posthog-build-"));
    try {
      const cli = join(dir, "cli");
      // Only the upload transport is faked. The installed plugin/config/compiler
      // hook, release injection and map deletion run unchanged.
      writeFileSync(cli, '#!/usr/bin/env bun\n' +
        'import {existsSync} from "node:fs";\n' +
        'if (process.argv[2] === "release") { console.log("01234567-89ab-cdef-0123-456789abcdef"); process.exit(0); }\n' +
        'if (process.env.TEST_UPLOAD_FAIL === "1") process.exit(1);\n' +
        'const args = process.argv; const dir = args[args.indexOf("--directory") + 1];\n' +
        'if (!dir.endsWith("/static") || !existsSync(dir + "/chunks/app.js.map") || existsSync(dir + "/build") || existsSync(dir + "/server") || process.env.POSTHOG_CLI_PROJECT_ID !== "671431" || process.env.POSTHOG_CLI_HOST !== "https://us.posthog.com" || !args.includes("upload")) process.exit(2);\n');
      chmodSync(cli, 0o755);
      process.env.POSTHOG_PERSONAL_API_KEY = "test-only";
      mock.module("@posthog/nextjs-config", () => ({ withPostHogConfig: (config, options) => {
        const require = createRequire(process.cwd() + "/next.config.ts");
        assert.equal(require("@posthog/cli/package.json").version, "0.18.10");
        assert.equal(options.cliBinaryPath, require.resolve("@posthog/cli/run-posthog-cli.js"));
        return realWrapper(config, { ...options, cliBinaryPath: cli });
      } }));
      const { default: configFn } = await import("./next.config");
      const config = await configFn("phase-production-build", { defaultConfig: {} });
      assert.equal(config.productionBrowserSourceMaps, true);
      assert.equal(config.turbopack.debugIds, true);
      assert.equal(config.env.POSTHOG_RELEASE_ID, "01234567-89ab-cdef-0123-456789abcdef");
      assert.ok(!JSON.stringify(config).includes("test-only"));
      mkdirSync(join(dir, "static/chunks"), { recursive: true });
      const map = join(dir, "static/chunks/app.js.map");
      writeFileSync(map, "{}");
      // These match the production failure: build/SSR chunks lack browser IDs.
      for (const lane of ["build", "server"]) {
        mkdirSync(join(dir, lane, "chunks"), { recursive: true });
        writeFileSync(join(dir, lane, "chunks/tool.js"), "console.log('no debug ID')");
        writeFileSync(join(dir, lane, "chunks/tool.js.map"), "{}");
      }
      const build = { distDir: dir };
      await config.compiler.runAfterProductionCompile(build);
      assert.equal(build.distDir, dir);
      assert.equal(existsSync(map), false);
      assert.equal(existsSync(join(dir, "build/chunks/tool.js.map")), true);
      assert.equal(existsSync(join(dir, "server/chunks/tool.js.map")), true);
      writeFileSync(map, "{}");
      process.env.TEST_UPLOAD_FAIL = "1";
      await assert.rejects(config.compiler.runAfterProductionCompile({ distDir: dir }));
      assert.equal(existsSync(map), true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  `, true);
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
