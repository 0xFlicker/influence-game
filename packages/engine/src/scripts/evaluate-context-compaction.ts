#!/usr/bin/env bun
/** Opt-in paid comparison using synthetic fixtures only. Does not modify the production catalog. */
import { mkdir, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createLlmClientFromEnv, type LlmProviderRuntime } from "../llm-client";
import { modelCatalogEntryById } from "../model-catalog";
import { createProviderAdapter } from "../provider-adapters";
import { estimateCostForKnownModel } from "../token-tracker";
import { COMPACTION_SCENARIOS, compactionEvaluationFixtureHash, evaluateCompactionLane, evaluationUsage, type EvaluationLane } from "../context-compaction-evaluation";

const candidates = ["openai:gpt-6-luna", "meta-muse:muse-spark-1.3-contributor", "katana:glm-5-3-private", "katana:glm-5-3-flash-private"];
const args = process.argv.slice(2);
let samples = 2, models = candidates.slice(0, 3);
for (const argument of args) {
  if (argument.startsWith("--samples=")) samples = Number(argument.slice(10));
  else if (argument.startsWith("--models=")) models = argument.slice(9).split(",");
  else throw new Error(`Unknown argument ${argument}`);
}
if (![1, 2, 3].includes(samples) || models.some(model => !candidates.includes(model)) || new Set(models).size !== models.length) throw new Error("Use 1–3 samples and supported evaluation models");
const repo = resolve(import.meta.dir, "../../../..");
const outputDir = resolve(repo, ".local-uploads/context-compaction", `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`);
await mkdir(outputDir, { recursive: true, mode: 0o700 });
const targetFiles = ["context-adaptation.ts", "provider-adapters.ts", "context-compaction-evaluation.ts", "scripts/evaluate-context-compaction.ts"];
const fileHashes = Object.fromEntries(await Promise.all(targetFiles.map(async file => [file, createHash("sha256").update(await Bun.file(resolve(import.meta.dir, "..", file)).text()).digest("hex")])));
const git = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repo });
if (git.exitCode !== 0) throw new Error("Cannot record source revision");
type Row = { catalogId: string; scenario: string; sample: number; lane: EvaluationLane };
const rows: Row[] = [];
const unavailable: Array<{ catalogId: string; reason: string }> = [];
const run = { version: 1, createdAt: new Date().toISOString(), gitCommit: git.stdout.toString().trim(), fileHashes,
  fixtureHash: compactionEvaluationFixtureHash(), syntheticOnly: true, injectedOverflow: true,
  samples, models, maxProviderCallsPerModel: 32, fixtures: COMPACTION_SCENARIOS, rows, unavailable };
async function save() {
  const temporary = resolve(outputDir, "private-run.tmp");
  await writeFile(temporary, JSON.stringify(run, null, 2), { mode: 0o600 });
  await rename(temporary, resolve(outputDir, "private-run.json"));
}
await save();
console.log(JSON.stringify({ outputDir, samples, models, maxProviderCallsPerModel: 32 }));
modelRuns: for (const catalogId of models) {
  // The discovered GLM 5.3 candidate is evaluation-only; test the existing Katana GLM transport contract.
  const template = modelCatalogEntryById(catalogId.startsWith("katana:glm-5-3") ? "katana:glm-5-2" : catalogId)!;
  const modelId = catalogId.slice(catalogId.indexOf(":") + 1);
  const config = createLlmClientFromEnv(process.env, { providerProfileId: template.providerProfileId, maxRetries: 0, timeout: 90_000, flexProcessing: false });
  if (!config) { unavailable.push({ catalogId, reason: "credentials unavailable" }); await save(); continue; }
  try {
    const listed = await config.client.models.list();
    if (!listed.data.some(model => model.id === modelId)) { unavailable.push({ catalogId, reason: "not in provider model listing" }); await save(); continue; }
  } catch { unavailable.push({ catalogId, reason: "model discovery failed" }); await save(); continue; }
  const runtime: LlmProviderRuntime = { adapter: createProviderAdapter(template.providerProfileId, config.client),
    catalogId, providerProfileId: template.providerProfileId, modelId, modelCapabilities: template.capabilities,
    reasoningPolicy: "low", toolChoiceMode: "named", position: 0, role: "primary" };
  let providerCalls = 0;
  for (let sample = 1; sample <= samples; sample++) {
    for (const scenario of COMPACTION_SCENARIOS) {
      // Alternate paired order to avoid always warming one condition first.
      for (const mode of sample % 2 ? ["full", "compacted"] as const : ["compacted", "full"] as const) {
        const lane = await evaluateCompactionLane({ runtime, scenario, mode, sample,
          beforeProviderCall: () => { if (providerCalls >= 32) throw new Error("Evaluation provider-call budget exhausted"); providerCalls++; } });
        rows.push({ catalogId, scenario: scenario.id, sample, lane }); await save();
        console.log(JSON.stringify({ catalogId, scenario: scenario.id, sample, mode, calls: lane.calls.length,
          error: lane.error, choice: lane.answer?.choice, probeMatches: lane.probeMatches }));
        if (lane.error && lane.calls.length && lane.calls.every(call => call.failure)) {
          unavailable.push({ catalogId, reason: `Provider dispatch failed: ${lane.calls.at(-1)!.failure}` });
          await save(); continue modelRuns;
        }
      }
    }
  }
}
const summary = rows.map(row => {
  const calls = row.lane.calls;
  const usage = evaluationUsage(row.lane);
  const actual = calls.every(call => call.outcome?.accounting?.actualCostMicrousd !== undefined)
    ? calls.reduce((sum, call) => sum + call.outcome!.accounting!.actualCostMicrousd!, 0) / 1_000_000 : null;
  const estimated = calls.every(call => call.outcome?.accounting?.usage !== undefined)
    ? estimateCostForKnownModel(usage, row.catalogId.slice(row.catalogId.indexOf(":") + 1)) : null;
  return { catalogId: row.catalogId, scenario: row.scenario, sample: row.sample, mode: row.lane.mode,
    calls: calls.length, injectedOverflows: row.lane.injectedOverflows, error: row.lane.error,
    answer: row.lane.answer, probeMatches: row.lane.probeMatches, preferredChoiceMatch: row.lane.preferredChoiceMatch,
    requestCharacters: calls.filter(call => call.kind === "action").at(-1)?.characters,
    totalLatencyMs: calls.reduce((sum, call) => sum + call.latencyMs, 0), usage, actualUsd: actual, estimatedUsd: estimated?.totalCost ?? null };
});
await writeFile(resolve(outputDir, "summary.json"), JSON.stringify({ ...run, fixtures: undefined, rows: summary }, null, 2), { mode: 0o600 });
await writeFile(resolve(outputDir, "review.json"), JSON.stringify({
  version: 1, createdAt: run.createdAt, gitCommit: run.gitCommit, fileHashes, fixtureHash: run.fixtureHash,
  syntheticOnly: true, injectedOverflow: true, models, samples, unavailable,
  rows: summary.map((row, index) => ({ ...row,
    summaries: rows[index]!.lane.calls.filter(call => call.kind === "summary").map(call => call.outcome?.text ?? null),
    failures: rows[index]!.lane.attempts.filter(attempt => attempt.outcome.kind !== "usable").map(attempt => attempt.outcome),
  })),
}, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ outputDir, completedLanes: rows.length, failedLanes: rows.filter(row => row.lane.error).length, unavailable }));
if (unavailable.length || rows.some(row => row.lane.error)) process.exitCode = 1;
