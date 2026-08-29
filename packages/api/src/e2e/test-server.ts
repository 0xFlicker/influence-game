/**
 * E2E Test Server Bootstrap
 *
 * Starts the API and Web servers as Bun subprocesses against an isolated
 * test database. Provides health-check polling and graceful shutdown.
 */

import type { Subprocess } from "bun";
import { mkdir, writeFile } from "node:fs/promises";
import path from "path";
import { cleanupE2eResources } from "./cleanup.js";

const WORKSPACE_ROOT = path.resolve(import.meta.dir, "../../../..");

export interface TestServerHandles {
  apiProcess: Subprocess;
  webProcess: Subprocess | null;
  apiPort: number;
  webPort: number | null;
  apiUrl: string;
  webUrl: string | null;
  logDirectory: string | null;
  logCaptures: ProcessLogCapture[];
}

interface ProcessLogCapture {
  name: string;
  stdout: Promise<string>;
  stderr: Promise<string>;
}

export interface StartTestServersOptions {
  databaseUrl: string;
  apiPort?: number;
  webPort?: number;
  /** Admin wallet address for RBAC seeding (used as ADMIN_ADDRESS env var) */
  adminAddress?: string;
  /** JWT secret for token signing */
  jwtSecret?: string;
  /** Frozen identity-onboarding cutoff shared by every test producer. */
  publicIdentityLaunchCutoff?: string;
  /** Skip starting the web server (useful for API-only tests) */
  skipWeb?: boolean;
  /** Root directory for bounded service logs, usually uploaded only on failure. */
  logDirectory?: string;
  /** Abort startup promptly when the owning harness is terminating. */
  signal?: AbortSignal;
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
  signal?: AbortSignal,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (signal?.aborted) throw new Error(`Startup aborted while waiting for ${url}`);
      const remainingMs = timeoutMs - (Date.now() - start);
      const requestTimeout = AbortSignal.timeout(Math.max(1, Math.min(1_000, remainingMs)));
      const res = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout,
      });
      if (res.ok) return;
    } catch (error) {
      if (signal?.aborted) throw error;
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
  const publicIdentityLaunchCutoff =
    opts.publicIdentityLaunchCutoff ?? "2026-07-01T00:00:00.000Z";
  const configuredLogRoot = opts.logDirectory ?? process.env.INFLUENCE_E2E_RESULTS_DIR;
  const logDirectory = configuredLogRoot
    ? path.resolve(configuredLogRoot, `services-${apiPort}-${webPort ?? "api-only"}`)
    : null;

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
    PUBLIC_IDENTITY_LAUNCH_CUTOFF: publicIdentityLaunchCutoff,
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
  const apiLogs = captureProcessLogs(apiProcess, "api");

  const apiUrl = `http://127.0.0.1:${apiPort}`;

  try {
    await waitForHealth(`${apiUrl}/health`, 30_000, opts.signal);
  } catch (error) {
    await terminateProcess(apiProcess, "api");
    await persistProcessLogs([apiLogs], logDirectory);
    throw await startupError(error, [apiLogs]);
  }

  let webProcess: Subprocess | null = null;
  let webUrl: string | null = null;
  let webLogs: ProcessLogCapture | null = null;

  if (!opts.skipWeb && webPort != null) {
    const webEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      NODE_ENV: "development",
      PORT: String(webPort),
      API_URL: apiUrl,
      API_BACKEND_URL: apiUrl,
      NEXT_PUBLIC_API_URL: apiUrl,
      PRIVY_APP_ID: "e2e-test-privy-app-id-001",
      NEXT_PUBLIC_PRIVY_APP_ID: "e2e-test-privy-app-id-001",
      NEXT_PUBLIC_E2E_AUTH: "true",
    };

    webProcess = Bun.spawn(
      ["bun", "run", "dev", "--hostname", "127.0.0.1"],
      {
        cwd: path.join(WORKSPACE_ROOT, "packages/web"),
        env: webEnv,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    webLogs = captureProcessLogs(webProcess, "web");

    webUrl = `http://localhost:${webPort}`;

    // Wait for web server to be healthy. Preserve child output on failure;
    // otherwise a Next startup error is hidden behind a generic timeout.
    try {
      await waitForHealth(webUrl, 60_000, opts.signal);
    } catch (error) {
      await terminateProcess(webProcess, "web");
      await terminateProcess(apiProcess, "api");
      await persistProcessLogs([apiLogs, webLogs], logDirectory);
      throw await startupError(error, [apiLogs, webLogs]);
    }
  }

  return {
    apiProcess,
    webProcess,
    apiPort,
    webPort,
    apiUrl,
    webUrl,
    logDirectory,
    logCaptures: webLogs ? [apiLogs, webLogs] : [apiLogs],
  };
}

const MAX_CAPTURED_LOG_CHARS = 256 * 1024;

function captureProcessLogs(proc: Subprocess, name: string): ProcessLogCapture {
  return {
    name,
    stdout: readProcessPipe(proc.stdout),
    stderr: readProcessPipe(proc.stderr),
  };
}

async function readProcessPipe(pipe: Subprocess["stdout"]): Promise<string> {
  if (!pipe || typeof pipe === "number") return "";
  const reader = pipe.getReader();
  const decoder = new TextDecoder();
  let captured = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    captured += decoder.decode(value, { stream: true });
    if (captured.length > MAX_CAPTURED_LOG_CHARS) {
      captured = captured.slice(-MAX_CAPTURED_LOG_CHARS);
    }
  }
  captured += decoder.decode();
  return captured.slice(-MAX_CAPTURED_LOG_CHARS);
}

async function persistProcessLogs(
  captures: ProcessLogCapture[],
  logDirectory: string | null,
): Promise<void> {
  if (!logDirectory) return;
  await mkdir(logDirectory, { recursive: true });
  await Promise.all(captures.flatMap((capture) => [
    capture.stdout.then((value) => writeFile(path.join(logDirectory, `${capture.name}.stdout.log`), value)),
    capture.stderr.then((value) => writeFile(path.join(logDirectory, `${capture.name}.stderr.log`), value)),
  ]));
}

async function startupError(
  error: unknown,
  captures: ProcessLogCapture[],
): Promise<Error> {
  const logs = await Promise.all(captures.flatMap(async (capture) => [
    `--- ${capture.name} stdout ---\n${await capture.stdout}`,
    `--- ${capture.name} stderr ---\n${await capture.stderr}`,
  ])).then((groups) => groups.flat());
  return new Error([
    error instanceof Error ? error.message : String(error),
    ...logs,
  ].join("\n").trim());
}

async function terminateProcess(proc: Subprocess, name: string): Promise<void> {
  if (proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  if (await waitForProcessExit(proc, 5_000)) return;
  proc.kill("SIGKILL");
  if (!await waitForProcessExit(proc, 5_000)) {
    throw new Error(`${name} did not exit after SIGKILL`);
  }
}

async function waitForProcessExit(
  proc: Subprocess,
  timeoutMs: number,
): Promise<boolean> {
  if (proc.exitCode !== null) return true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      proc.exited.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Gracefully stop test servers.
 */
export async function stopTestServers(
  handles: TestServerHandles,
): Promise<void> {
  await cleanupE2eResources([
    ["web process", async () => {
      if (handles.webProcess) await terminateProcess(handles.webProcess, "web");
    }],
    ["api process", () => terminateProcess(handles.apiProcess, "api")],
    ["service logs", () => persistProcessLogs(handles.logCaptures, handles.logDirectory)],
  ]);
}
