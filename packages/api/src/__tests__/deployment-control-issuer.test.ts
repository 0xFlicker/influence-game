import { describe, expect, test } from "bun:test";
import { jwtVerify } from "jose";
import {
  DEPLOYMENT_CONTROL_AUDIENCE,
  DEPLOYMENT_CONTROL_PERMISSION,
  DEPLOYMENT_CONTROL_SUBJECT,
  MIN_DEPLOYMENT_CONTROL_LEASE_TOKEN_SECONDS,
} from "../middleware/auth.js";

const issuerPath = new URL("../scripts/mint-deployment-control-token.ts", import.meta.url).pathname;

async function issue(secret: string) {
  const child = Bun.spawn([process.execPath, issuerPath], {
    env: { JWT_SECRET: secret, NODE_ENV: "test" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

describe("host deployment controller issuer", () => {
  test("issues only the service authority with enough lifetime for a full lease", async () => {
    const secret = "controller-issuer-test-secret";
    const result = await issue(secret);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    const { payload, protectedHeader } = await jwtVerify(
      result.stdout.trim(),
      new TextEncoder().encode(secret),
      { issuer: "influence-api", audience: DEPLOYMENT_CONTROL_AUDIENCE },
    );
    expect(protectedHeader).toEqual({ alg: "HS256", typ: "JWT" });
    expect(payload.sub).toBe(DEPLOYMENT_CONTROL_SUBJECT);
    expect(payload.token_type).toBe("service");
    expect(payload.perms).toEqual([DEPLOYMENT_CONTROL_PERMISSION]);
    expect(payload.exp! - payload.iat!).toBe(6 * 60 * 60);
    expect(payload.exp! - Math.floor(Date.now() / 1000)).toBeGreaterThan(MIN_DEPLOYMENT_CONTROL_LEASE_TOKEN_SECONDS);
    expect(result.stdout).not.toContain(secret);
  });

  test.each(["", "   "])("fails without signing authority (%j)", async (secret) => {
    const result = await issue(secret);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("verify JWT_SECRET is configured");
  });
});
