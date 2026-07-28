import { join } from "node:path";
import {
  hashCanonicalJson,
  validateHandshake,
  type EvidenceCardApprovalArtifact,
  type FrozenCaseArtifact,
} from "@influence/prompt-lab-protocol";
import {
  computePromptThreadWorkerHarnessDigest,
  createPromptThreadWorkerHandshake,
  type PromptThreadIntentProbeWorkerResult,
} from "@influence/engine/prompt-thread-worker";
import {
  comparePromptThreadEvidenceTotals,
  summarizePromptThreadEvidence,
  type PromptThreadEvidenceTotals,
} from "@influence/engine/prompt-thread-report";
import {
  assertEvidenceCardApproval,
  type PromptThreadEvidenceCard,
  type PromptThreadEvidenceCitation,
} from "./prompt-thread-evidence-card.js";
import {
  promptThreadSelectionReason,
  promptThreadSourceIdBySequence,
} from "./prompt-thread-evidence-mapping.js";
import {
  inspectPromptThreadGitCheckout,
  waitForPromptThreadWorker,
} from "./prompt-thread-panel.js";

const PROBE_TIMEOUT_MS = 60_000;

export type PromptThreadStrategicProbeArm = "baseline" | "candidate";
export type PromptThreadStrategicProbeVerdict =
  | "improved"
  | "regressed"
  | "mixed"
  | "not_exercised"
  | "inconclusive";

export interface PromptThreadStrategicProbeRevision {
  arm: PromptThreadStrategicProbeArm;
  checkoutPath: string;
  commitSha: string;
  compilerPolicyDigest: string;
  harnessDigest: string;
}

export type PromptThreadStrategicProbeEvidenceTotals =
  PromptThreadEvidenceTotals;

export interface PromptThreadStrategicProbeLedger {
  arm: PromptThreadStrategicProbeArm;
  actorId: string;
  promptClass: "strategic_decision";
  protectedOverflow: boolean;
  lanes: {
    protected: number;
    hot: number;
    historyAuthorized: number;
    historySelected: number;
  };
  budget: {
    envelopeChars: number;
    historyBudgetChars: number;
    protectedChars: number;
    hotChars: number;
    historyChars: number;
  };
  evidence: Array<{
    sourceId: string;
    label: PromptThreadEvidenceCitation["classification"];
    reason: "selected" | "policy_disabled" | "zero_overlap" | "budget_exhausted";
  }>;
}

export interface PromptThreadStrategicProbeComparison {
  version: 1;
  caseHash: string;
  evidenceCardHash: string;
  providerCalls: 0;
  verdict: PromptThreadStrategicProbeVerdict;
  baselineRevision: string;
  candidateRevision: string;
  baseline: PromptThreadStrategicProbeEvidenceTotals;
  candidate: PromptThreadStrategicProbeEvidenceTotals;
  probes: PromptThreadStrategicProbeLedger[];
}

export interface PromptThreadStrategicProbeInput {
  caseValue: FrozenCaseArtifact;
  evidenceDraft: PromptThreadEvidenceCard;
  evidenceApproval: EvidenceCardApprovalArtifact;
  baseline: PromptThreadStrategicProbeRevision;
  candidate: PromptThreadStrategicProbeRevision;
  actionSchemaHash: string;
}

export interface PromptThreadStrategicProbeDependencies {
  inspectCheckout?: (
    path: string,
  ) => Promise<{ commitSha: string; dirty: boolean }>;
  computeHarnessDigest?: (checkoutPath: string) => Promise<string>;
  runProbe?: (
    revision: PromptThreadStrategicProbeRevision,
    caseValue: FrozenCaseArtifact,
  ) => Promise<PromptThreadIntentProbeWorkerResult>;
}

export async function comparePromptThreadStrategicProbes(
  input: PromptThreadStrategicProbeInput,
  dependencies: PromptThreadStrategicProbeDependencies = {},
): Promise<PromptThreadStrategicProbeComparison> {
  assertEvidenceCardApproval(
    input.caseValue,
    input.evidenceDraft,
    input.evidenceApproval,
  );
  if (
    input.baseline.harnessDigest !== input.candidate.harnessDigest
    || !input.baseline.harnessDigest
  ) {
    throw new Error("Strategic probe requires one shared non-variant harness");
  }
  if (
    input.baseline.compilerPolicyDigest
    === input.candidate.compilerPolicyDigest
  ) {
    throw new Error("Strategic probe requires a recall-policy delta");
  }
  const inspectCheckout = dependencies.inspectCheckout
    ?? inspectPromptThreadGitCheckout;
  const computeHarnessDigest = dependencies.computeHarnessDigest
    ?? computePromptThreadWorkerHarnessDigest;
  const runProbe = dependencies.runProbe ?? runTrustedIntentProbe;
  const caseHash = input.evidenceApproval.caseHash;
  const expectedActors = intentActorIds(input.caseValue);
  const citationsByTurn = indexCitationsByTurn(input.evidenceDraft.items);
  const results = new Map<
    PromptThreadStrategicProbeArm,
    PromptThreadIntentProbeWorkerResult
  >();
  for (const revision of [input.baseline, input.candidate]) {
    const checkout = await inspectCheckout(revision.checkoutPath);
    if (checkout.dirty || checkout.commitSha !== revision.commitSha) {
      throw new Error(`Strategic probe checkout ${revision.arm} is dirty or SHA-mismatched`);
    }
    if (
      await computeHarnessDigest(revision.checkoutPath)
      !== revision.harnessDigest
    ) {
      throw new Error(`Strategic probe checkout ${revision.arm} harness mismatch`);
    }
    const result = await runProbe(revision, input.caseValue);
    validateProbeResult(
      input,
      revision,
      result,
      caseHash,
      expectedActors,
    );
    results.set(revision.arm, result);
  }

  const sourceIds = promptThreadSourceIdBySequence(
    input.caseValue.privateData,
  );
  const firstTurnByActor = firstTurnByActorId(input.caseValue);
  const ledgers = ([input.baseline, input.candidate] as const).flatMap(
    (revision) => {
      const result = results.get(revision.arm)!;
      return result.probe.probes.map((probe): PromptThreadStrategicProbeLedger => {
        const firstTurn = firstTurnByActor.get(probe.actorId);
        if (!firstTurn) {
          throw new Error(`Strategic probe actor ${probe.actorId} has no scheduled Mingle turn`);
        }
        const evidence = evidenceForProbe(
          probe.items,
          citationsByTurn.get(firstTurn) ?? [],
          sourceIds,
        );
        return {
          arm: revision.arm,
          actorId: probe.actorId,
          promptClass: "strategic_decision",
          protectedOverflow:
            probe.budget.protectedChars >= probe.budget.envelopeChars,
          lanes: {
            protected: probe.laneSummary.protectedCount,
            hot: probe.laneSummary.hotCount,
            historyAuthorized: probe.laneSummary.authorizedHistoryCount,
            historySelected: probe.laneSummary.selectedHistoryCount,
          },
          budget: structuredClone(probe.budget),
          evidence,
        };
      });
    },
  );
  const baseline = evidenceTotals(ledgers, "baseline");
  const candidate = evidenceTotals(ledgers, "candidate");
  return {
    version: 1,
    caseHash,
    evidenceCardHash: input.evidenceApproval.cardHash,
    providerCalls: 0,
    verdict: strategicProbeVerdict(ledgers, baseline, candidate),
    baselineRevision: input.baseline.commitSha,
    candidateRevision: input.candidate.commitSha,
    baseline,
    candidate,
    probes: ledgers,
  };
}

export function renderPromptThreadStrategicProbeMarkdown(
  result: PromptThreadStrategicProbeComparison,
): string {
  return [
    "# Strategic history probe",
    "",
    `- Verdict: **${result.verdict}**`,
    "- Provider calls: **0**",
    `- Baseline: \`${result.baselineRevision}\``,
    `- Candidate: \`${result.candidateRevision}\``,
    "",
    "| Arm | Actor | Overflow | History selected / authorized | History chars / budget | Evidence |",
    "|---|---|---|---|---|---|",
    ...result.probes.map((probe) => [
      `| ${probe.arm}`,
      probe.actorId,
      probe.protectedOverflow ? "yes" : "no",
      `${probe.lanes.historySelected}/${probe.lanes.historyAuthorized}`,
      `${probe.budget.historyChars}/${probe.budget.historyBudgetChars}`,
      probe.evidence.length === 0
        ? "none"
        : probe.evidence
            .map((item) => `${item.sourceId}:${item.label}:${item.reason}`)
            .join("<br>"),
    ].join(" | ") + " |"),
    "",
    "This deterministic probe compares the two real Mingle-intent contexts. " +
      "It measures evidence selection, not whether a model uses the selected evidence well.",
    "",
    `Comparison fingerprint: \`${hashCanonicalJson(result)}\``,
  ].join("\n");
}

function validateProbeResult(
  input: PromptThreadStrategicProbeInput,
  revision: PromptThreadStrategicProbeRevision,
  result: PromptThreadIntentProbeWorkerResult,
  caseHash: string,
  expectedActors: readonly string[],
): void {
  const expectedHandshake = createPromptThreadWorkerHandshake({
    harnessDigest: revision.harnessDigest,
    compilerPolicyDigest: revision.compilerPolicyDigest,
    actionSchemaHash: input.actionSchemaHash,
  });
  validateHandshake(
    expectedHandshake,
    result.handshake,
    ["prompt-thread-worker"],
  );
  if (
    result.status !== "completed"
    || result.caseHash !== caseHash
    || result.probe.caseId !== input.caseValue.caseId
    || result.probe.providerCalls !== 0
    || result.probe.probes.length !== expectedActors.length
    || result.probe.probes.some((probe, index) => (
      probe.actorId !== expectedActors[index]
      || probe.action !== "mingle-intent"
      || probe.promptClass !== "strategic_decision"
    ))
  ) {
    throw new Error(`Strategic probe checkout ${revision.arm} returned an invalid result`);
  }
}

function evidenceForProbe(
  items: readonly {
    sourceId: string;
    entrySequence: number;
    terminalReason:
      | "selected_history"
      | "history_disabled"
      | "seed_miss"
      | "budget_excluded";
  }[],
  citations: readonly PromptThreadEvidenceCitation[],
  sourceIds: ReadonlyMap<string, string>,
): PromptThreadStrategicProbeLedger["evidence"] {
  const reasons = new Map<string, PromptThreadStrategicProbeLedger["evidence"][number]["reason"]>();
  for (const item of items) {
    const stableSourceId = sourceIds.get(String(item.entrySequence));
    if (!stableSourceId) {
      throw new Error("Strategic probe selection source is unavailable in the case");
    }
    reasons.set(
      stableSourceId,
      promptThreadSelectionReason(item.terminalReason),
    );
  }
  return citations.map((citation) => {
    const reason = reasons.get(citation.sourceId);
    if (!reason) {
      throw new Error(
        `Approved evidence ${citation.sourceId} is unavailable for strategic probe`,
      );
    }
    return {
      sourceId: citation.sourceId,
      label: citation.classification,
      reason,
    };
  });
}

function indexCitationsByTurn(
  citations: readonly PromptThreadEvidenceCitation[],
): Map<number, PromptThreadEvidenceCitation[]> {
  const indexed = new Map<number, PromptThreadEvidenceCitation[]>();
  for (const citation of citations) {
    for (const turn of citation.applicableTurns) {
      const values = indexed.get(turn) ?? [];
      values.push(citation);
      indexed.set(turn, values);
    }
  }
  return indexed;
}

function strategicProbeVerdict(
  probes: readonly PromptThreadStrategicProbeLedger[],
  baseline: PromptThreadStrategicProbeEvidenceTotals,
  candidate: PromptThreadStrategicProbeEvidenceTotals,
): PromptThreadStrategicProbeVerdict {
  if (probes.every((probe) => probe.budget.historyBudgetChars === 0)) {
    return "not_exercised";
  }
  const hasScoredEvidence = probes.some((probe) => (
    probe.evidence.some((item) => item.label !== "unscored")
  ));
  if (!hasScoredEvidence) return "inconclusive";
  return comparePromptThreadEvidenceTotals(baseline, candidate);
}

function evidenceTotals(
  probes: readonly PromptThreadStrategicProbeLedger[],
  arm: PromptThreadStrategicProbeArm,
): PromptThreadStrategicProbeEvidenceTotals {
  return summarizePromptThreadEvidence(
    probes.filter((probe) => probe.arm === arm).flatMap(
      (probe) => probe.evidence,
    ),
  );
}

function intentActorIds(caseValue: FrozenCaseArtifact): string[] {
  if (!Array.isArray(caseValue.privateData.traces)) {
    throw new Error("Case has no traces for strategic probe");
  }
  const actors = caseValue.privateData.traces.flatMap((value) => {
    const trace = record(value, "trace");
    return trace.action === "mingle-intent" && typeof trace.actorId === "string"
      ? [trace.actorId]
      : [];
  });
  if (actors.length !== 2 || new Set(actors).size !== 2) {
    throw new Error("Strategic probe requires exactly two intent actors");
  }
  return actors;
}

function firstTurnByActorId(caseValue: FrozenCaseArtifact): Map<string, number> {
  if (!Array.isArray(caseValue.privateData.traces)) {
    throw new Error("Case has no traces for strategic probe");
  }
  const mapping = new Map<string, number>();
  let turn = 0;
  for (const value of caseValue.privateData.traces) {
    const trace = record(value, "trace");
    if (trace.action !== "mingle-turn" || typeof trace.actorId !== "string") continue;
    turn += 1;
    if (!mapping.has(trace.actorId)) mapping.set(trace.actorId, turn);
  }
  return mapping;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

async function runTrustedIntentProbe(
  revision: PromptThreadStrategicProbeRevision,
  caseValue: FrozenCaseArtifact,
): Promise<PromptThreadIntentProbeWorkerResult> {
  const workerPath = join(
    revision.checkoutPath,
    "packages/engine/src/prompt-thread-worker.ts",
  );
  const child = Bun.spawn(
    [process.execPath, workerPath, "intent-probe"],
    {
      cwd: revision.checkoutPath,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  child.stdin.write(JSON.stringify(caseValue));
  child.stdin.end();
  const [exitCode, stdout] = await waitForPromptThreadWorker(
    child,
    "strategic probe",
    PROBE_TIMEOUT_MS,
  );
  if (exitCode !== 0) {
    throw new Error(`Strategic probe checkout ${revision.arm} worker failed`);
  }
  return JSON.parse(stdout) as PromptThreadIntentProbeWorkerResult;
}
