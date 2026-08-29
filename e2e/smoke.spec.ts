import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Response,
  type TestInfo,
} from "@playwright/test";

const stagingReleaseGate = process.env.STAGING_RELEASE_GATE === "1";
const requestedImageTag = process.env.STAGING_IMAGE_TAG?.trim();
const expectedCommitSha = process.env.STAGING_EXPECTED_COMMIT_SHA?.trim();
const minimumReleaseControlProtocol = Number(process.env.STAGING_MIN_RELEASE_CONTROL_PROTOCOL ?? "1");

const SENSITIVE_RESPONSE_HEADER = /authorization|cookie|secret|token/i;

function requiredStagingCommit(): string | null {
  if (!stagingReleaseGate) return null;

  expect(
    requestedImageTag,
    "STAGING_IMAGE_TAG must be provided when STAGING_RELEASE_GATE=1",
  ).toMatch(/^[0-9a-f]{7,40}$/);
  expect(
    expectedCommitSha,
    "STAGING_EXPECTED_COMMIT_SHA must be provided when STAGING_RELEASE_GATE=1",
  ).toMatch(/^[0-9a-f]{40}$/);
  expect(
    minimumReleaseControlProtocol,
    "STAGING_MIN_RELEASE_CONTROL_PROTOCOL must be a positive integer",
  ).toBeGreaterThanOrEqual(1);

  const imageTag = requestedImageTag!;
  const commitSha = expectedCommitSha!;
  expect(
    commitSha.startsWith(imageTag),
    "checked-out commit must resolve the requested deployed image tag",
  ).toBe(true);

  return commitSha;
}

function redactResponseHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SENSITIVE_RESPONSE_HEADER.test(name)),
  );
}

async function assertApiHealth(
  request: APIRequestContext,
  expectedStagingCommit: string | null,
): Promise<void> {
  const response = await request.get("/api/health", {
    headers: { Accept: "application/json" },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json() as {
    status?: string;
    service?: string;
    commit?: string;
    releaseControl?: {
      protocolVersion?: number;
      runtimeState?: string;
    };
  };
  expect(body.status).toBe("ok");
  expect(body.service).toBe("influence-api");

  if (expectedStagingCommit) {
    expect(body.commit).toBe(expectedStagingCommit);
    expect(body.releaseControl?.protocolVersion).toBeGreaterThanOrEqual(minimumReleaseControlProtocol);
    expect(body.releaseControl?.runtimeState).toBe("active");
  }
}

async function attachHomepageFailureEvidence(
  page: Page,
  response: Response | null,
  testInfo: TestInfo,
): Promise<void> {
  let body: Buffer | null = null;
  let bodySource = "response";
  let bodyReadError: string | null = null;

  try {
    body = response ? await response.body() : Buffer.from(await page.content());
    if (!response) bodySource = "rendered-document";
  } catch (error) {
    bodyReadError = error instanceof Error ? error.message : String(error);
  }

  let title: string | null = null;
  let titleReadError: string | null = null;
  try {
    title = await page.title();
  } catch (error) {
    titleReadError = error instanceof Error ? error.message : String(error);
  }

  await writeFile(testInfo.outputPath("homepage-failure-evidence.json"), JSON.stringify({
    requestedImageTag: requestedImageTag ?? null,
    expectedCommitSha: expectedCommitSha ?? null,
    finalUrl: page.url(),
    responseUrl: response?.url() ?? null,
    responseStatus: response?.status() ?? null,
    responseHeaders: response ? redactResponseHeaders(response.headers()) : null,
    requestAccept: response?.request().headers().accept ?? null,
    title,
    titleReadError,
    bodySource,
    bodyByteLength: body?.byteLength ?? null,
    bodySha256: body
      ? createHash("sha256").update(body).digest("hex")
      : null,
    bodyReadError,
  }, null, 2));
}

test.describe("Smoke Tests", () => {
  const expectedStagingCommit = requiredStagingCommit();
  test.describe.configure({ mode: stagingReleaseGate ? "serial" : "default" });

  test.beforeEach(async ({ request }) => {
    if (expectedStagingCommit) {
      await assertApiHealth(request, expectedStagingCommit);
    }
  });

  test.afterEach(async ({ request }) => {
    if (expectedStagingCommit) {
      await assertApiHealth(request, expectedStagingCommit);
    }
  });

  test("homepage loads", async ({ page }, testInfo) => {
    let response: Response | null = null;

    try {
      response = await page.goto("/");
      expect(response, "homepage navigation must receive an HTTP response").not.toBeNull();
      expect(response?.status()).toBe(200);
      expect(response?.headers()["content-type"] ?? "").toContain("text/html");
      await expect(page).toHaveTitle(/the house.*influence/i);
    } catch (error) {
      await attachHomepageFailureEvidence(page, response, testInfo);
      throw error;
    }
  });

  test("API health check", async ({ request }) => {
    await assertApiHealth(request, expectedStagingCommit);
  });

  test("games list API returns 200", async ({ request }) => {
    const response = await request.get("/api/games");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("games page loads", async ({ page }) => {
    const response = await page.goto("/games");
    expect(response?.status()).toBe(200);
  });

  test("free queue page loads", async ({ page }) => {
    const response = await page.goto("/games/free");
    expect(response?.status()).toBe(200);
  });
});
