import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createInterface } from "node:readline";

export type LocalHarnessProcess = ChildProcessWithoutNullStreams;

const stderrTails = new WeakMap<LocalHarnessProcess, string>();

export async function startLocalHarness<T>(options: {
  script: string;
  readyPrefix: string;
  startupTimeoutMs: number;
  shutdownTimeoutMs?: number;
  errorLabel: string;
}): Promise<{ process: LocalHarnessProcess; harness: T }> {
  const child = spawn("bun", ["run", options.script], {
    cwd: process.cwd(),
    env: process.env,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderrTail = "";
  let ready = false;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-16_384);
    stderrTails.set(child, stderrTail);
    if (ready) process.stderr.write(chunk);
  });

  const lines = createInterface({ input: child.stdout });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const readiness = (async () => {
    for await (const line of lines) {
      if (!line.startsWith(options.readyPrefix)) continue;
      return {
        process: child,
        harness: JSON.parse(line.slice(options.readyPrefix.length)) as T,
      };
    }
    throw new Error("Harness exited before publishing readiness");
  })();
  try {
    const started = await Promise.race([
      readiness,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Harness startup exceeded ${options.startupTimeoutMs}ms`)),
          options.startupTimeoutMs,
        );
      }),
    ]);
    ready = true;
    return started;
  } catch (error) {
    let cleanupError: unknown;
    try {
      await stopLocalHarness(child, options.shutdownTimeoutMs);
    } catch (error) {
      cleanupError = error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    const cleanupReason = cleanupError
      ? `\nHarness cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
      : "";
    throw new Error(`${options.errorLabel}: ${reason}\n${stderrTail}${cleanupReason}`.trim());
  } finally {
    if (timeout) clearTimeout(timeout);
    lines.close();
  }
}

export async function stopLocalHarness(
  child: LocalHarnessProcess,
  timeoutMs = 30_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    assertCleanExit(child);
    return;
  }

  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const waitForExit = async (): Promise<boolean> => Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);

  try {
    signalLocalHarness(child, "SIGTERM");
    if (await waitForExit()) {
      assertCleanExit(child);
      return;
    }

    signalLocalHarness(child, "SIGKILL");
    if (!await waitForExit()) {
      throw new Error(`Local harness process ${child.pid ?? "unknown"} did not exit after SIGKILL`);
    }
    throw new Error(
      `Local harness process ${child.pid ?? "unknown"} required SIGKILL; cleanup did not complete${formatStderrTail(child)}`,
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function assertCleanExit(child: LocalHarnessProcess): void {
  if (child.exitCode === 0 && child.signalCode === null) return;
  const status = child.exitCode === null
    ? `signal ${child.signalCode ?? "unknown"}`
    : `exit code ${child.exitCode}`;
  throw new Error(
    `Local harness process ${child.pid ?? "unknown"} ended with ${status}${formatStderrTail(child)}`,
  );
}

function formatStderrTail(child: LocalHarnessProcess): string {
  const tail = stderrTails.get(child)?.trim();
  return tail ? `\nHarness stderr:\n${tail}` : "";
}

function signalLocalHarness(
  child: LocalHarnessProcess,
  signal: NodeJS.Signals,
): void {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    }
  }
  child.kill(signal);
}
