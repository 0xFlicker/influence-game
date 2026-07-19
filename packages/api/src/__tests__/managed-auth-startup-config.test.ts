import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

const apiRoot = resolve(import.meta.dir, "../..");

async function runApiStartup(
  managedAuthEnv: Record<string, string | undefined>,
) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    PRIVY_APP_ID: "privy-app",
    PRIVY_APP_SECRET: "privy-secret",
    JWT_SECRET: "influence-jwt-secret",
    ADMIN_ADDRESS: "0x0000000000000000000000000000000000000001",
    DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/influence",
  };

  for (const [key, value] of Object.entries(managedAuthEnv)) {
    if (value !== undefined) env[key] = value;
  }

  const processHandle = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: apiRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);

  return { exitCode, stdout, stderr };
}

describe("API managed authentication startup config", () => {
  it("rejects an unknown managed-auth mode before database startup", async () => {
    const result = await runApiStartup({ MANAGED_AUTH_MODE: "surprise" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'MANAGED_AUTH_MODE must be one of "disabled", "existing-only", or "full"',
    );
  });

  it("rejects an invalid Privy compatibility bridge mode", async () => {
    const result = await runApiStartup({
      PRIVY_COMPATIBILITY_BRIDGE_ENABLED: "sometimes",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'PRIVY_COMPATIBILITY_BRIDGE_ENABLED must be "true" or "false"',
    );
  });

  it("requires Clerk server credentials only when managed auth is enabled", async () => {
    const result = await runApiStartup({ MANAGED_AUTH_MODE: "existing-only" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CLERK_SECRET_KEY");
    expect(result.stderr).toContain("CLERK_JWT_KEY");
    expect(result.stderr).toContain("CLERK_AUTHORIZED_PARTIES");
  });

  it("does not require Clerk credentials in disabled mode", async () => {
    const result = await runApiStartup({ MANAGED_AUTH_MODE: "disabled" });

    expect(result.stderr).not.toContain("CLERK_SECRET_KEY");
    expect(result.stderr).not.toContain("CLERK_JWT_KEY");
    expect(result.stderr).not.toContain("CLERK_AUTHORIZED_PARTIES");
  });

  it("accepts complete Clerk server config in full mode", async () => {
    const result = await runApiStartup({
      MANAGED_AUTH_MODE: "full",
      CLERK_SECRET_KEY: "sk_test_private",
      CLERK_JWT_KEY: "test-public-pem",
      CLERK_AUTHORIZED_PARTIES: "http://127.0.0.1:3001, https://example.test",
    });

    expect(result.stderr).not.toContain("Managed authentication configuration error");
    expect(result.stderr).not.toContain("CLERK_SECRET_KEY is required");
    expect(result.stderr).not.toContain("CLERK_JWT_KEY is required");
    expect(result.stderr).not.toContain("CLERK_AUTHORIZED_PARTIES is required");
  });
});
