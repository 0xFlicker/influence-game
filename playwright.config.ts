import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const localIdentityRun =
  process.env.PLAYWRIGHT_LOCAL_IDENTITY === "1"
  || process.env.PLAYWRIGHT_BASE_URL === undefined;
const layeredAuthRun = process.env.PLAYWRIGHT_LAYERED_AUTH;
const localSerialRun = localIdentityRun || layeredAuthRun === "deterministic";
const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromiumUse = {
  browserName: "chromium" as const,
  ...(existsSync(macChrome)
    ? { launchOptions: { executablePath: macChrome } }
    : {}),
};

export default defineConfig({
  testDir: "./e2e",
  timeout: layeredAuthRun ? 90_000 : 30_000,
  fullyParallel: !localSerialRun,
  workers: localSerialRun ? 1 : undefined,
  retries: localSerialRun ? 0 : 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://influence-staging",
    extraHTTPHeaders: {
      Accept: "application/json",
    },
    trace: "retain-on-failure",
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
