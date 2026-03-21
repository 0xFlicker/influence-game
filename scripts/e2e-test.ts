#!/usr/bin/env bun
/**
 * E2E Test Orchestrator
 *
 * Single entry point for the full e2e test suite.
 * Usage: doppler run -- bun scripts/e2e-test.ts
 *
 * Exit codes:
 *   0 = all tests pass
 *   1 = test failure
 *   2 = infrastructure failure (timeout, spawn error, etc.)
 */

import { spawn, type Subprocess } from "bun";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import path from "path";

const OVERALL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const ROOT_DIR = path.resolve(import.meta.dir, "..");
const API_DIR = path.join(ROOT_DIR, "packages/api");
const SCREENSHOT_DIR = path.join(ROOT_DIR, "e2e-screenshots");

let testProcess: Subprocess | null = null;
let timeoutId: Timer | null = null;
let exiting = false;

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[e2e ${ts}] ${msg}`);
}

function cleanupScreenshots() {
  if (!existsSync(SCREENSHOT_DIR)) return;
  const files = readdirSync(SCREENSHOT_DIR);
  for (const f of files) {
    try {
      unlinkSync(path.join(SCREENSHOT_DIR, f));
    } catch {
      // ignore
    }
  }
}

async function killTestProcess(): Promise<void> {
  if (!testProcess || exiting) return;
  exiting = true;

  const proc = testProcess;
  try {
    proc.kill("SIGTERM");
    // Wait up to 5s for graceful shutdown
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) return;
      await Bun.sleep(200);
    }
    proc.kill("SIGKILL");
  } catch {
    // Process may already be dead
  }
}

function cleanupTempDbs() {
  // Clean up any orphaned e2e test DBs in /tmp
  try {
    const tmpFiles = readdirSync("/tmp");
    for (const f of tmpFiles) {
      if (f.startsWith("influence-e2e-") && f.endsWith(".db")) {
        const dbPath = path.join("/tmp", f);
        for (const suffix of ["", "-wal", "-shm"]) {
          try {
            unlinkSync(dbPath + suffix);
          } catch {
            // ignore
          }
        }
        log(`Cleaned up orphaned test DB: ${f}`);
      }
    }
  } catch {
    // ignore
  }
}

async function cleanup(): Promise<void> {
  if (timeoutId) clearTimeout(timeoutId);
  await killTestProcess();
  cleanupTempDbs();
}

// Handle signals for clean shutdown
process.on("SIGINT", async () => {
  log("SIGINT received — cleaning up...");
  await cleanup();
  process.exit(2);
});
process.on("SIGTERM", async () => {
  log("SIGTERM received — cleaning up...");
  await cleanup();
  process.exit(2);
});

async function run(): Promise<number> {
  const startTime = Date.now();

  log("Starting e2e test suite");
  log(`  Root:       ${ROOT_DIR}`);
  log(`  API dir:    ${API_DIR}`);
  log(`  Timeout:    ${OVERALL_TIMEOUT_MS / 1000}s`);
  log(`  Screenshots: ${SCREENSHOT_DIR}`);
  console.log("");

  // Clean old screenshots
  cleanupScreenshots();
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Clean orphaned DBs from previous failed runs
  cleanupTempDbs();

  // Verify the e2e test file exists
  const testFile = path.join(API_DIR, "src/e2e/game-flow.e2e.test.ts");
  if (!existsSync(testFile)) {
    log(`ERROR: Test file not found: ${testFile}`);
    return 2;
  }

  // Set up overall timeout
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), OVERALL_TIMEOUT_MS);
  });

  // Spawn the test process
  try {
    testProcess = spawn({
      cmd: ["bun", "test", "src/e2e/game-flow.e2e.test.ts"],
      cwd: API_DIR,
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        // Ensure Puppeteer can find Chrome
        PUPPETEER_CACHE_DIR:
          process.env.PUPPETEER_CACHE_DIR ||
          path.join(ROOT_DIR, "node_modules/.cache/puppeteer"),
      },
    });
  } catch (err) {
    log(`ERROR: Failed to spawn test process: ${err}`);
    return 2;
  }

  // Race: test completion vs timeout
  const result = await Promise.race([
    testProcess.exited.then((code) => ({ kind: "done" as const, code })),
    timeoutPromise.then(() => ({ kind: "timeout" as const, code: -1 })),
  ]);

  if (timeoutId) clearTimeout(timeoutId);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (result.kind === "timeout") {
    log(`TIMEOUT: Test suite exceeded ${OVERALL_TIMEOUT_MS / 1000}s`);
    await killTestProcess();
    cleanupTempDbs();

    // Check for screenshots
    const screenshots = existsSync(SCREENSHOT_DIR)
      ? readdirSync(SCREENSHOT_DIR).filter((f) => f.endsWith(".png"))
      : [];
    if (screenshots.length > 0) {
      log(`Screenshots captured:`);
      for (const s of screenshots) {
        log(`  ${SCREENSHOT_DIR}/${s}`);
      }
    }

    console.log("");
    log(`RESULT: TIMEOUT (${elapsed}s)`);
    return 2;
  }

  // Test process completed
  const exitCode = result.code;

  // Check for screenshots (indicates failures)
  const screenshots = existsSync(SCREENSHOT_DIR)
    ? readdirSync(SCREENSHOT_DIR).filter((f) => f.endsWith(".png"))
    : [];
  if (screenshots.length > 0) {
    console.log("");
    log(`Screenshots captured:`);
    for (const s of screenshots) {
      log(`  ${SCREENSHOT_DIR}/${s}`);
    }
  }

  console.log("");
  if (exitCode === 0) {
    log(`RESULT: PASS (${elapsed}s)`);
    return 0;
  } else {
    log(`RESULT: FAIL (exit code ${exitCode}, ${elapsed}s)`);
    return 1;
  }
}

// Main
try {
  const code = await run();
  process.exit(code);
} catch (err) {
  log(`FATAL: ${err}`);
  await cleanup();
  process.exit(2);
}
