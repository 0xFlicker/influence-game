import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const localIdentityRun =
  process.env.PLAYWRIGHT_LOCAL_IDENTITY === "1"
  || process.env.PLAYWRIGHT_BASE_URL === undefined;
const layeredAuthRun = process.env.PLAYWRIGHT_LAYERED_AUTH;
const localFormatViewerRun = process.env.PLAYWRIGHT_FORMAT_VIEWER === "1";
const localSerialRun =
  localIdentityRun || localFormatViewerRun || layeredAuthRun === "deterministic";
const stagingReleaseGate = process.env.STAGING_RELEASE_GATE === "1";
const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromiumUse = {
  browserName: "chromium" as const,
  ...(existsSync(macChrome)
    ? { launchOptions: { executablePath: macChrome } }
    : {}),
};

export default defineConfig({
  testDir: "./e2e",
  timeout: layeredAuthRun || localFormatViewerRun ? 90_000 : 30_000,
  fullyParallel: !localSerialRun,
  workers: localSerialRun ? 1 : undefined,
  retries: localSerialRun ? 0 : 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://influence-staging.tail8a79ed.ts.net",
    trace: stagingReleaseGate
      ? {
          mode: "retain-on-failure",
          snapshots: false,
          screenshots: true,
          sources: false,
        }
      : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: layeredAuthRun
    ? [
        {
          name: layeredAuthRun === "real-clerk"
            ? "layered-auth-real-clerk"
            : "layered-auth-deterministic",
          testMatch: /layered-authentication\.spec\.ts/,
          use: chromiumUse,
        },
      ]
    : [{ name: "chromium", use: chromiumUse }],
});
