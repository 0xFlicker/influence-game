import { parseArgs } from "node:util";
import { createDeploymentControlToken } from "../packages/api/src/middleware/auth";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    url: { type: "string", default: "http://127.0.0.1:3000" },
    candidate: { type: "string" },
    actor: { type: "string" },
    "run-id": { type: "string" },
    "run-attempt": { type: "string" },
    "lease-id": { type: "string" },
    fence: { type: "string" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  console.info(`Local Doppler dev deployment control (no migrations or game starts).
Run via: doppler run --project social-strategy-agent --config dev -- bun scripts/game-worker-control.ts
  status | worker-status [--url http://127.0.0.1:3002]
  acquire --candidate FULL_SHA --actor REAL_GITHUB_LOGIN --run-id REAL_RUN_ID --run-attempt ATTEMPT
  heartbeat --lease-id UUID --fence NUMBER  (runs until Ctrl-C; does not release)
  release --lease-id UUID --fence NUMBER`);
  process.exit(0);
}

const command = positionals[0];
if (positionals.length !== 1 || !["status", "worker-status", "acquire", "heartbeat", "release"].includes(command!)) {
  throw new Error("Choose status, worker-status, acquire, heartbeat, or release; see --help");
}
if (process.env.DOPPLER_PROJECT !== "social-strategy-agent" || process.env.DOPPLER_CONFIG !== "dev") {
  throw new Error("Run this local helper through Doppler project social-strategy-agent, config dev");
}
const origin = new URL(values.url!);
if (origin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("--url must be a loopback HTTP origin");
}

function positiveInteger(name: "fence" | "run-id" | "run-attempt"): number {
  const value = Number(values[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
}

// This is the existing service identity, never a fabricated user/admin wallet.
// Keep its short-lived token in memory and out of logs/process arguments.
const token = await createDeploymentControlToken("6h");
async function request(path: string, body?: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(new URL(`/api/internal/deployment-control/${path}`, origin), {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error(`Deployment control HTTP ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

if (command === "status" || command === "worker-status") {
  console.info(JSON.stringify(await request(command === "status" ? "status" : "game-worker-drain-status"), null, 2));
} else if (command === "acquire") {
  if (!/^[a-f0-9]{40}$/.test(values.candidate ?? "") || !values.actor?.trim()) {
    throw new Error("Supply --candidate full app SHA and --actor your real GitHub login");
  }
  console.info(JSON.stringify(await request("leases", {
    candidateSha: values.candidate,
    sourceRepository: "0xFlicker/linode-iac",
    workflowRunId: positiveInteger("run-id"),
    workflowRunAttempt: positiveInteger("run-attempt"),
    actor: values.actor,
  }), null, 2));
} else {
  const leaseId = values["lease-id"];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(leaseId ?? "")) {
    throw new Error("--lease-id must be the UUID returned by acquire");
  }
  const fencingToken = positiveInteger("fence");
  if (command === "release") {
    console.info(JSON.stringify(await request(`leases/${leaseId}/release`, {
      fencingToken, reason: "Local operator worker handoff completed",
    }), null, 2));
  } else {
    let stop = false;
    let wake: (() => void) | undefined;
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stop = true; wake?.(); });
    while (!stop) {
      await request(`leases/${leaseId}/heartbeat`, { fencingToken });
      console.info(`Heartbeated dev admission lease ${leaseId}; claims remain closed.`);
      if (!stop) await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 30_000);
        wake = () => { clearTimeout(timer); resolve(); };
      });
    }
    console.info("Heartbeat stopped. Release this lease explicitly after the handoff.");
  }
}
