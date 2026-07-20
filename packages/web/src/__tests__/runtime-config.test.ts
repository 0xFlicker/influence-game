import { afterEach, describe, expect, it } from "bun:test";
import { getPublicRuntimeConfig } from "@/lib/server-runtime-config";

const managedAuthEnvKeys = [
  "MANAGED_AUTH_MODE",
  "CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_JWT_KEY",
] as const;

const originalEnv = Object.fromEntries(
  managedAuthEnvKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of managedAuthEnvKeys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("managed authentication public runtime config", () => {
  it("defaults to disabled without requiring or exposing Clerk credentials", () => {
    for (const key of managedAuthEnvKeys) delete process.env[key];

    const config = getPublicRuntimeConfig();

    expect(config.MANAGED_AUTH_MODE).toBe("disabled");
    expect(config.CLERK_PUBLISHABLE_KEY).toBe("");
    expect(config).not.toHaveProperty("CLERK_SECRET_KEY");
    expect(config).not.toHaveProperty("CLERK_JWT_KEY");
  });

  it("exposes only the publishable key and mode when managed auth is enabled", () => {
    process.env.MANAGED_AUTH_MODE = "full";
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_public";
    process.env.CLERK_SECRET_KEY = "sk_test_private";
    process.env.CLERK_JWT_KEY = "private-pem";

    const config = getPublicRuntimeConfig();

    expect(config.MANAGED_AUTH_MODE).toBe("full");
    expect(config.CLERK_PUBLISHABLE_KEY).toBe("pk_test_public");
    expect(JSON.stringify(config)).not.toContain("sk_test_private");
    expect(JSON.stringify(config)).not.toContain("private-pem");
  });

  it("rejects unknown managed-auth modes", () => {
    process.env.MANAGED_AUTH_MODE = "surprise";

    expect(() => getPublicRuntimeConfig()).toThrow(
      'MANAGED_AUTH_MODE must be one of "disabled", "existing-only", or "full"',
    );
  });

  it("requires a publishable key for existing-only and full modes", () => {
    process.env.MANAGED_AUTH_MODE = "existing-only";
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

    expect(() => getPublicRuntimeConfig()).toThrow(
      "CLERK_PUBLISHABLE_KEY is required when MANAGED_AUTH_MODE is existing-only",
    );
  });
});
