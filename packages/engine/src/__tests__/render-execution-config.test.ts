import { describe, expect, test } from "bun:test";
import { renderExecutionConfig, resolveRenderExecution } from "../render-execution-config";

describe("release-owned rendering policy", () => {
  test("first landing keeps both deployed environments local and ignores obsolete rollout flags", () => {
    expect(renderExecutionConfig({ INFLUENCE_DEPLOYMENT_ENVIRONMENT: "prod", POSTGAME_MEDIA_EXECUTION_MODE: "remote" }).mode).toBe("local");
    const stage = renderExecutionConfig({ INFLUENCE_DEPLOYMENT_ENVIRONMENT: "staging" });
    expect(stage.mode).toBe("local");
    expect(stage.apiOrigin).toBe("https://influence-staging.tail8a79ed.ts.net");
    expect(stage.configDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  test("existing host NODE_ENV bindings continue local rollout, explicit conflicts fail closed", () => {
    expect(renderExecutionConfig({ NODE_ENV: "production" }).environment).toBe("prod");
    expect(renderExecutionConfig({ NODE_ENV: "staging" }).environment).toBe("staging");
    expect(() => renderExecutionConfig({ NODE_ENV: "staging", INFLUENCE_DEPLOYMENT_ENVIRONMENT: "prod" })).toThrow("conflicts");
  });
  test("packaged releases require a binding and reject malformed policy or TLS aliases", () => {
    const raw = JSON.stringify({ schemaVersion: 1, environments: { staging: { mode: "remote", network: "tailnet", apiOrigin: "https://influence-staging.tail8a79ed.ts.net" } } });
    expect(() => resolveRenderExecution(raw, undefined, true)).toThrow("must bind");
    expect(() => resolveRenderExecution(raw, "unknown")).toThrow("must bind");
    expect(() => resolveRenderExecution(raw.replace("https:", "http:"), "staging")).toThrow("canonical HTTPS");
    expect(() => resolveRenderExecution(raw.replace("influence-staging.tail8a79ed.ts.net", "100.1.2.3"), "staging")).toThrow("canonical HTTPS");
    expect(resolveRenderExecution(raw, "staging").mode).toBe("remote");
    expect(resolveRenderExecution(raw + "\n", "staging").configDigest).not.toBe(resolveRenderExecution(raw, "staging").configDigest);
  });
});
