import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

export type RenderExecution = {
  environment: "development" | "prod" | "staging";
  mode: "local" | "remote";
  network: "direct" | "tailnet";
  apiOrigin?: string;
  configDigest: string;
  targets?: {trailer:"existing"|"aws-batch";"studio-export":"existing"|"aws-batch"};
};

export function isLocalRenderExecution(execution: RenderExecution): boolean {
  return execution.environment === "development" && execution.mode === "local" && execution.network === "direct";
}

export function studioRenderEnabled(execution: RenderExecution): boolean {
  return isLocalRenderExecution(execution) || execution.targets?.["studio-export"] === "aws-batch";
}

/** Source identity for a native development worker, never an admitted container digest. */
export function localRendererDigest(): string {
  const root = resolve(import.meta.dir, "../../..");
  const paths = ["package.json", "bun.lock", "tsconfig.json", "deployment/render-execution.json",
    "packages/engine/src", "packages/engine/package.json", "packages/web/src", "packages/web/public",
    "packages/web/package.json", "packages/web/tailwind.config.ts", "music", ":(exclude)**/*.test.*", ":(exclude)**/__tests__/**"];
  const git = (args: string[]) => execFileSync("git", ["-C", root, ...args], { maxBuffer: 64 * 1024 * 1024 });
  const hash = createHash("sha256").update("house.local-renderer.v1\0").update(git(["rev-parse", "HEAD"]))
    .update(git(["diff", "HEAD", "--no-ext-diff", "--binary", "--", ...paths]));
  for (const path of git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...paths]).toString().split("\0").filter(Boolean)) {
    hash.update(path).update("\0").update(readFileSync(resolve(root, path))).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function renderWorkerDigest(execution: RenderExecution, env: Record<string, string | undefined> = process.env): string | undefined {
  return isLocalRenderExecution(execution) ? localRendererDigest() : env.RENDER_JOB_WORKER_DIGEST;
}

/** Release-owned policy. Only the environment binding and credentials are runtime inputs. */
export function renderExecutionConfig(env: Record<string, string | undefined> = process.env): RenderExecution {
  const packaged = env.INFLUENCE_RENDER_CONFIG_PACKAGED === "1";
  const raw = readFileSync(packaged ? "/app/deployment/render-execution.json" : resolve(import.meta.dir, "../../../deployment/render-execution.json"), "utf8");
  const explicit = env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;
  const inherited = env.NODE_ENV === "staging" ? "staging" : env.NODE_ENV === "production" ? "prod" : undefined;
  if (explicit && inherited && explicit !== inherited) throw new Error("Render environment binding conflicts with NODE_ENV");
  const policy = resolveRenderExecution(raw, explicit ?? inherited, packaged);
  // Old hosts can keep deploying local releases. Remote activation requires the
  // updated host's explicit binding and digest-verified candidate preflight.
  if (!explicit && policy.mode === "remote") throw new Error("Remote rendering requires explicit INFLUENCE_DEPLOYMENT_ENVIRONMENT binding");
  return policy;
}

export function resolveRenderExecution(raw: string, environment: string | undefined, packaged = false): RenderExecution {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1 || !("environments" in value)
    || !value.environments || typeof value.environments !== "object") throw new Error("Invalid render execution config");
  const configDigest = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  if (!environment && !packaged) return { environment: "development", mode: "local", network: "direct", configDigest };
  if (environment !== "prod" && environment !== "staging") throw new Error("INFLUENCE_DEPLOYMENT_ENVIRONMENT must bind this release to prod or staging");
  const selected: unknown = (value.environments as Record<string, unknown>)[environment];
  if (!selected || typeof selected !== "object" || !("mode" in selected) || !("network" in selected)
    || (selected.mode !== "local" && selected.mode !== "remote") || (selected.network !== "direct" && selected.network !== "tailnet")) throw new Error("Invalid environment render policy");
  const apiOrigin = "apiOrigin" in selected ? selected.apiOrigin : undefined;
  let targets:RenderExecution["targets"];
  if("targets" in selected) {
    const t=selected.targets;
    if(!t||typeof t!=="object"||Array.isArray(t)||Object.keys(t).sort().join()!=="studio-export,trailer"
      || !["existing","aws-batch"].includes(String((t as Record<string,unknown>).trailer))
      || !["existing","aws-batch"].includes(String((t as Record<string,unknown>)["studio-export"])))throw new Error("Invalid render targets");
    targets=t as NonNullable<RenderExecution["targets"]>;
  }
  if (selected.network === "tailnet") {
    if (typeof apiOrigin !== "string") throw new Error("Tailnet rendering requires an HTTPS API origin");
    const url = new URL(apiOrigin);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
      || !url.hostname.endsWith(".ts.net") || url.origin !== apiOrigin) throw new Error("Tailnet API origin must preserve its canonical HTTPS ts.net hostname");
  } else if (apiOrigin !== undefined) throw new Error("Direct rendering does not configure a tailnet origin");
  return { environment, mode: selected.mode, network: selected.network, ...(typeof apiOrigin === "string" ? { apiOrigin } : {}),...(targets ? {targets}:{}), configDigest };
}
