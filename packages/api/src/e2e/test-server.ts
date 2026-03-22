/**
 * E2E Test Server Bootstrap
 *
 * Starts the API and Web servers as Bun subprocesses against an isolated
 * test database. Provides health-check polling and graceful shutdown.
 */

import type { Subprocess } from "bun";
import path from "path";

const WORKSPACE_ROOT = path.resolve(import.meta.dir, "../../../..");

export interface TestServerHandles {
  apiProcess: Subprocess;
  webProcess: Subprocess | null;
  apiPort: number;
  webPort: number | null;
  apiUrl: string;
  webUrl: string | null;
}

export interface StartTestServersOptions {
  databaseUrl: string;
  apiPort?: number;
  webPort?: number;
  /** Admin wallet address for RBAC seeding (used as ADMIN_ADDRESS env var) */
  adminAddress?: string;
  /** JWT secret for token signing */
  jwtSecret?: string;
  /** Skip starting the web server (useful for API-only tests) */
  skipWeb?: boolean;
}

/**
 * Pick a random port in the ephemeral range.
 */
function randomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

/**
 * Poll a URL until it returns a 200 status, with timeout.
 */
async function waitForHealth(
  url: string,
  timeoutMs: number = 30000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(250);
  }
  throw new Error(`Server at ${url} did not become healthy within ${timeoutMs}ms`);
}

/**
 * Start API and optionally Web servers as child processes.
 *
 * The API server runs against the given test database URL with dummy Privy
 * credentials (e2e tests bypass Privy auth and mint JWTs directly).
 */
export async function startTestServers(
  opts: StartTestServersOptions,
): Promise<TestServerHandles> {
  const apiPort = opts.apiPort ?? randomPort();
  const webPort = opts.skipWeb ? null : (opts.webPort ?? randomPort());
  const jwtSecret = opts.jwtSecret ?? "e2e-test-jwt-secret";
  const adminAddress = opts.adminAddress ?? "0xe2eadmin0000000000000000000000000000dead";

  const apiEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    DATABASE_URL: opts.databaseUrl,
    PORT: String(apiPort),
    HOST: "127.0.0.1",
    JWT_SECRET: jwtSecret,
    ADMIN_ADDRESS: adminAddress,
    // Dummy Privy credentials — e2e tests bypass Privy auth
    PRIVY_APP_ID: "e2e-test-privy-app-id",
    PRIVY_APP_SECRET: "e2e-test-privy-app-secret",
    // Allow CORS from the test web server
    CORS_ORIGINS: webPort ? `http://localhost:${webPort}` : "",
  };

  const apiProcess = Bun.spawn(
    ["bun", "run", "src/index.ts"],
    {
      cwd: path.join(WORKSPACE_ROOT, "packages/api"),
      env: apiEnv,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const apiUrl = `http://127.0.0.1:${apiPort}`;

  // Wait for API to be healthy
  await waitForHealth(`${apiUrl}/health`);

  let webProcess: Subprocess | null = null;
  let webUrl: string | null = null;

  if (!opts.skipWeb && webPort != null) {
    const webEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      NODE_ENV: "development",
      PORT: String(webPort),
      NEXT_PUBLIC_API_URL: apiUrl,
    };

    webProcess = Bun.spawn(
      ["bun", "run", "dev"],
      {
        cwd: path.join(WORKSPACE_ROOT, "packages/web"),
        env: webEnv,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    webUrl = `http://localhost:${webPort}`;

    // Wait for web server to be healthy
    await waitForHealth(webUrl, 60000);
  }

  return {
    apiProcess,
    webProcess,
    apiPort,
    webPort,
    apiUrl,
    webUrl,
  };
}

/**
 * Gracefully stop test servers.
 */
export async function stopTestServers(
  handles: TestServerHandles,
): Promise<void> {
  const killTimeout = 5000;

  const killProcess = async (proc: Subprocess, name: string) => {
    try {
      proc.kill("SIGTERM");
      const exitPromise = proc.exited;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${name} did not exit in time`)), killTimeout),
      );
      await Promise.race([exitPromise, timeoutPromise]).catch(() => {
        proc.kill("SIGKILL");
      });
    } catch (err) {
      console.warn(`[test-server] Error stopping ${name}:`, err);
    }
  };

  if (handles.webProcess) {
    await killProcess(handles.webProcess, "web");
  }
  await killProcess(handles.apiProcess, "api");
}
