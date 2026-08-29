import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  attachProviderScenarioBlindReview,
  completeProviderScenarioBlindReview,
  createProviderScenarioBlindReviewArtifacts,
  createProviderScenarioPairedReport,
  type ProviderScenarioBlindReviewBundle,
  type ProviderScenarioBlindReviewKey,
  type ProviderScenarioBlindReviewScores,
  type ProviderScenarioManifest,
  type ProviderScenarioPairedReport,
  type ProviderScenarioPrivateRun,
} from "../provider-scenario-evaluation";
import { findRepoRoot } from "./evaluate-r32-provider-surfaces";

function requiredArg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
  if (!value) throw new Error(`${prefix}... is required.`);
  return value;
}

function optionalArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length)
    .trim() || undefined;
}

function repoPath(repoRoot: string, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(repoRoot, value);
}

export function assertPrivateOutput(repoRoot: string, outputPath: string): void {
  const privateRoot = resolve(repoRoot, ".local-uploads");
  const child = relative(privateRoot, outputPath);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error("R32 paired report output must stay under .local-uploads.");
  }
}

async function readManifest(path: string): Promise<ProviderScenarioManifest> {
  return JSON.parse(await readFile(path, "utf8")) as ProviderScenarioManifest;
}

async function readPrivateJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    dirname(path),
    `.${randomUUID()}-${path.split("/").at(-1) ?? "paired-report.json"}.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot(import.meta.dir);
  const reviewScoresArg = optionalArg("review-scores");
  if (reviewScoresArg) {
    const outputPath = repoPath(repoRoot, requiredArg("output"));
    const detailOutputPath = repoPath(repoRoot, requiredArg("review-detail-output"));
    assertPrivateOutput(repoRoot, outputPath);
    assertPrivateOutput(repoRoot, detailOutputPath);
    const review = completeProviderScenarioBlindReview(
      await readPrivateJson<ProviderScenarioBlindReviewBundle>(
        repoPath(repoRoot, requiredArg("blind-bundle")),
      ),
      await readPrivateJson<ProviderScenarioBlindReviewKey>(
        repoPath(repoRoot, requiredArg("blind-key")),
      ),
      await readPrivateJson<ProviderScenarioBlindReviewScores>(
        repoPath(repoRoot, reviewScoresArg),
      ),
      requiredArg("reviewer"),
      new Date().toISOString(),
    );
    const report = attachProviderScenarioBlindReview(
      await readPrivateJson<ProviderScenarioPairedReport>(
        repoPath(repoRoot, requiredArg("paired")),
      ),
      review,
    );
    await writePrivateJson(outputPath, report);
    await writePrivateJson(detailOutputPath, review);
    process.stdout.write(`${JSON.stringify({
      presentationReview: report.presentationReview,
      output: relative(repoRoot, outputPath),
      reviewDetailOutput: relative(repoRoot, detailOutputPath),
    }, null, 2)}\n`);
    return;
  }
  const beforePath = repoPath(repoRoot, requiredArg("before"));
  const afterPath = repoPath(repoRoot, requiredArg("after"));
  const outputPath = repoPath(repoRoot, requiredArg("output"));
  assertPrivateOutput(repoRoot, outputPath);
  const blindBundleArg = optionalArg("blind-bundle-output");
  const blindKeyArg = optionalArg("blind-key-output");
  const beforePrivateArg = optionalArg("before-private");
  const afterPrivateArg = optionalArg("after-private");
  const blindSeed = optionalArg("blind-seed");
  const blindArgs = [
    blindBundleArg,
    blindKeyArg,
    beforePrivateArg,
    afterPrivateArg,
    blindSeed,
  ];
  if (blindArgs.some(Boolean) && !blindArgs.every(Boolean)) {
    throw new Error(
      "Blind review generation requires --before-private, --after-private, --blind-bundle-output, --blind-key-output, and --blind-seed together.",
    );
  }
  const report = createProviderScenarioPairedReport(
    await readManifest(beforePath),
    await readManifest(afterPath),
  );
  await writePrivateJson(outputPath, report);
  let blindReview: { bundle: string; key: string } | undefined;
  if (
    blindBundleArg
    && blindKeyArg
    && beforePrivateArg
    && afterPrivateArg
    && blindSeed
  ) {
    const bundlePath = repoPath(repoRoot, blindBundleArg);
    const keyPath = repoPath(repoRoot, blindKeyArg);
    assertPrivateOutput(repoRoot, bundlePath);
    assertPrivateOutput(repoRoot, keyPath);
    const artifacts = createProviderScenarioBlindReviewArtifacts(
      await readPrivateJson<ProviderScenarioPrivateRun>(repoPath(repoRoot, beforePrivateArg)),
      await readPrivateJson<ProviderScenarioPrivateRun>(repoPath(repoRoot, afterPrivateArg)),
      blindSeed,
    );
    await writePrivateJson(bundlePath, artifacts.bundle);
    await writePrivateJson(keyPath, artifacts.key);
    blindReview = {
      bundle: relative(repoRoot, bundlePath),
      key: relative(repoRoot, keyPath),
    };
  }
  process.stdout.write(`${JSON.stringify({
    comparable: report.comparable,
    beforeRunId: report.beforeRunId,
    afterRunId: report.afterRunId,
    samplePairs: report.samples.length,
    output: relative(repoRoot, outputPath),
    ...(blindReview && { blindReview }),
  }, null, 2)}\n`);
}

if (import.meta.main) await main();
