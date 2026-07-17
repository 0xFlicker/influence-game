import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const localIdentityRun = process.env.PLAYWRIGHT_LOCAL_IDENTITY === "1";
const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: !localIdentityRun,
  workers: localIdentityRun ? 1 : undefined,
  retries: localIdentityRun ? 0 : 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://influence-staging",
    extraHTTPHeaders: {
      Accept: "application/json",
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        ...(existsSync(macChrome)
          ? { launchOptions: { executablePath: macChrome } }
          : {}),
      },
    },
  ],
});
