import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type RenderExecution = {
  environment: "development" | "prod" | "staging";
  mode: "local" | "remote";
  network: "direct" | "tailnet";
  apiOrigin?: string;
  configDigest: string;
};

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
  if (selected.network === "tailnet") {
    if (typeof apiOrigin !== "string") throw new Error("Tailnet rendering requires an HTTPS API origin");
    const url = new URL(apiOrigin);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
      || !url.hostname.endsWith(".ts.net") || url.origin !== apiOrigin) throw new Error("Tailnet API origin must preserve its canonical HTTPS ts.net hostname");
  } else if (apiOrigin !== undefined) throw new Error("Direct rendering does not configure a tailnet origin");
  return { environment, mode: selected.mode, network: selected.network, ...(typeof apiOrigin === "string" ? { apiOrigin } : {}), configDigest };
}
