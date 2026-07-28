import {
  CANONICALIZER_ID,
  CANONICALIZER_VERSION,
  hashCanonicalJson,
  parseArtifact,
  type ArtifactEnvelope,
  type BlindDecisionsArtifact,
  type BlindPacketArtifact,
  type CuratorApprovalArtifact,
  type EvidenceCardApprovalArtifact,
  type FrozenCaseArtifact,
  type PaidApprovalArtifact,
  type UnblindingKeyArtifact,
} from "@influence/prompt-lab-protocol";
import {
  PROMPT_THREAD_FIDELITY_LANES,
  PROMPT_THREAD_TRANSPORT_ONLY_EXCLUSIONS,
  runPromptThreadSourceGate,
  type PromptThreadFidelityReceipt,
} from "@influence/engine/prompt-thread-lab";
import { relative } from "node:path";
import { closeDB, createDB } from "../db/index.js";
import {
  materializePromptThreadCase,
  type MaterializePromptThreadCaseResult,
} from "../services/prompt-thread-case-materializer.js";
import {
  applyCuratorResponses,
  approveCuratorManifest,
  assertCuratorApproval,
  buildCuratorManifest,
  createManualEvidenceCard,
  freezeEvidenceCard,
  renderEvidenceCardMarkdown,
  type CuratorManifest,
  type CuratorPartitionResponse,
  type PromptThreadEvidenceCard,
  type PromptThreadEvidenceCitation,
} from "../services/prompt-thread-evidence-card.js";
import {
  buildPromptThreadReportFromRun,
  initializePromptThreadBlindReview,
  promptThreadBlindReviewStatus,
  recordPromptThreadBlindDecision,
  renderPromptThreadBlindPacket,
  unblindPromptThreadReview,
  type BlindChoice,
  type BlindDecisionReasons,
  type BlindReviewStatus,
  type PromptThreadUnblindedReview,
} from "../services/prompt-thread-blind-review.js";
import {
  createPromptThreadOpenAIDispatch,
  PromptThreadProviderBroker,
} from "../services/prompt-thread-provider-broker.js";
import {
  approvePromptThreadPanel,
  createTrustedCheckoutPanelDependencies,
  createPromptThreadPanelManifest,
  initializePromptThreadPanelRun,
  runPromptThreadPanel,
  structuralPanelStatus,
  type PanelPreflightDependencies,
  type PromptThreadPanelManifest,
  type RunPanelDependencies,
} from "../services/prompt-thread-panel.js";
import {
  atomicWriteArtifact,
  atomicWriteJson,
  atomicWritePrivateText,
  createPrivateWorkspace,
  readArtifact,
  readArtifactIfExists,
  readPrivateJson,
  recoverOrInvalidateRun,
  inspectRunRecovery,
  purgeCompletedRun,
  withRunMutationLock,
} from "../services/prompt-thread-workspace.js";

type PromptThreadLabCommand =
  | "materialize"
  | "verify-source"
  | "manual-draft"
  | "curator-manifest"
  | "curator-approve"
  | "curate"
  | "apply-curator-response"
  | "freeze"
  | "panel-manifest"
  | "panel-approve"
  | "panel-init"
  | "panel-status"
  | "panel-run"
  | "panel-resume"
  | "blind-init"
  | "render-blind-packet"
  | "blind-status"
  | "record-blind-decision"
  | "unblind"
  | "report"
  | "purge";

export interface PromptThreadLabResult {
  status: "ok" | "error";
  lifecycle:
    | "draft"
    | "approved"
    | "frozen"
    | "materialized"
    | "source_verified"
    | "running"
    | "completed"
    | "invalidated"
    | "blind_ready"
    | "review_in_progress"
    | "reviewed"
    | "unblinded"
    | "reported"
    | "purged"
    | "error";
  errorCode?: string;
  requiresHuman: boolean;
  guidance?: string;
  artifactPath?: string;
  artifactHash?: string;
  markdown?: string;
  nextActions: string[];
  reservedSpendUsd: number;
  settledSpendUsd: number;
  completedCells: number;
  outstandingCells: number;
  completedPairTokens?: string[];
  outstandingPairTokens?: string[];
  sourceManifestCount?: number;
  matchedTurns?: number;
}

export interface PromptThreadLabCliDependencies {
  isTTY?: boolean;
  now?: () => Date;
  curatorBroker?: {
    dispatchPartition(input: {
      manifest: CuratorManifest;
      approval: CuratorApprovalArtifact;
      partition: CuratorManifest["partitions"][number];
    }): Promise<CuratorPartitionResponse>;
  };
  panelRunner?: RunPanelDependencies;
  panelPreflight?: PanelPreflightDependencies;
  materializeCase?: (
    workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  ) => Promise<MaterializePromptThreadCaseResult>;
  verifySource?: (
    caseValue: FrozenCaseArtifact,
  ) => Promise<{ receipt: PromptThreadFidelityReceipt }>;
}

const DEFAULT_PATHS = {
  manualDraft: "evidence/manual-draft.json",
  curatorManifest: "evidence/curator-manifest.json",
  curatorApproval: "evidence/curator-approval.json",
  curatorResponses: "evidence/curator-responses.json",
  curatorDraft: "evidence/curator-draft.json",
  evidenceApproval: "evidence/evidence-card-approval.json",
  sourceFidelity: "source/source-fidelity.json",
  panelManifest: "panel/run-manifest.json",
  panelApproval: "panel/paid-approval.json",
} as const;

export async function runPromptThreadLabCli(
  argv: readonly string[],
  dependencies: PromptThreadLabCliDependencies = {},
): Promise<PromptThreadLabResult> {
  try {
    const { command, flags } = parseCommand(argv);
    const workspaceRoot = requiredFlag(flags, "workspace");
    const workspace = await createPrivateWorkspace(workspaceRoot);
    const now = dependencies.now?.() ?? new Date();

    if (command === "materialize") {
      const result = dependencies.materializeCase
        ? await dependencies.materializeCase(workspace)
        : await materializeDefaultCase(workspace);
      return {
        status: "ok",
        lifecycle: "materialized",
        requiresHuman: false,
        artifactPath: relative(workspace.root, result.casePath),
        artifactHash: hashCanonicalJson(result.caseArtifact),
        nextActions: ["verify-source"],
        reservedSpendUsd: 0,
        settledSpendUsd: 0,
        completedCells: 0,
        outstandingCells: 0,
        sourceManifestCount: result.traceManifestIds.length,
      };
    }

    if (command === "verify-source") {
      const caseValue = await readFrozenCase(
        workspace,
        requiredFlag(flags, "case"),
      );
      const { receipt } = dependencies.verifySource
        ? await dependencies.verifySource(caseValue)
        : await runPromptThreadSourceGate(caseValue);
      const artifactPath = flags.get("output") ?? DEFAULT_PATHS.sourceFidelity;
      await withRunMutationLock(workspace, "source-fidelity", async (lock) => {
        await atomicWriteJson(lock, artifactPath, receipt);
      });
      return {
        status: "ok",
        lifecycle: "source_verified",
        requiresHuman: false,
        artifactPath,
        artifactHash: hashCanonicalJson(receipt),
        nextActions: ["manual-draft", "curator-manifest"],
        reservedSpendUsd: 0,
        settledSpendUsd: 0,
        completedCells: 0,
        outstandingCells: 0,
        matchedTurns: receipt.turnCount,
      };
    }

    if (command === "manual-draft") {
      const caseValue = await readFrozenCase(workspace, requiredFlag(flags, "case"));
      const card = createManualEvidenceCard(
        caseValue,
        parseJsonFlag<PromptThreadEvidenceCitation[]>(flags, "items"),
        now,
      );
      return writeArtifactResult(workspace, flags, "manual-draft", DEFAULT_PATHS.manualDraft, card, {
        lifecycle: "draft",
        markdown: renderEvidenceCardMarkdown(card),
        nextActions: ["freeze"],
      });
    }

    if (command === "curator-manifest") {
      const caseValue = await readFrozenCase(workspace, requiredFlag(flags, "case"));
      const manifest = buildCuratorManifest(caseValue, {
        model: requiredFlag(flags, "model"),
        maximumCalls: numberFlag(flags, "max-calls"),
        maximumSpendUsd: numberFlag(flags, "max-spend-usd"),
        maxItemsPerPartition: numberFlag(flags, "max-items-per-partition"),
        now,
      });
      return writeArtifactResult(workspace, flags, "curator-manifest", DEFAULT_PATHS.curatorManifest, manifest, {
        lifecycle: "draft",
        nextActions: ["curator-approve"],
      });
    }

    if (command === "curator-approve") {
      const blocked = requireInteractiveConfirmation(dependencies.isTTY ?? Boolean(process.stdin.isTTY), flags);
      if (blocked) return blocked;
      const manifest = await readCuratorManifest(workspace, requiredFlag(flags, "manifest"));
      const approval = approveCuratorManifest(manifest, requiredFlag(flags, "reviewer"), now);
      return writeArtifactResult(workspace, flags, "curator-approve", DEFAULT_PATHS.curatorApproval, approval, {
        lifecycle: "approved",
        nextActions: ["curate"],
      });
    }

    if (command === "curate") {
      const blocked = requireInteractiveConfirmation(
        dependencies.isTTY ?? Boolean(process.stdin.isTTY),
        flags,
      );
      if (blocked) return blocked;
      const manifest = await readCuratorManifest(
        workspace,
        requiredFlag(flags, "manifest"),
      );
      const approval = await readCuratorApproval(
        workspace,
        requiredFlag(flags, "approval"),
      );
      assertCuratorApproval(manifest, approval);
      const responses = dependencies.curatorBroker
        ? await dispatchInjectedCurator(
            dependencies.curatorBroker,
            manifest,
            approval,
          )
        : await dispatchApprovedCurator(
            workspace,
            manifest,
            approval,
            process.env.OPENAI_API_KEY,
          );
      const artifactPath = flags.get("output") ?? DEFAULT_PATHS.curatorResponses;
      await withRunMutationLock(workspace, "evidence-curate", async (lock) => {
        await atomicWriteJson(lock, artifactPath, responses);
      });
      return {
        status: "ok",
        lifecycle: "draft",
        requiresHuman: false,
        artifactPath,
        artifactHash: hashCanonicalJson(responses),
        nextActions: ["apply-curator-response"],
        reservedSpendUsd: manifest.maximumSpendUsd,
        settledSpendUsd: 0,
        completedCells: responses.length,
        outstandingCells: manifest.partitions.length - responses.length,
      };
    }

    if (command === "apply-curator-response") {
      const caseValue = await readFrozenCase(workspace, requiredFlag(flags, "case"));
      const manifest = await readCuratorManifest(workspace, requiredFlag(flags, "manifest"));
      const approval = await readCuratorApproval(workspace, requiredFlag(flags, "approval"));
      const responses = flags.has("responses-path")
        ? await readPrivateJson(
            workspace,
            requiredFlag(flags, "responses-path"),
          ) as CuratorPartitionResponse[]
        : parseJsonFlag<CuratorPartitionResponse[]>(flags, "responses");
      const card = applyCuratorResponses(
        caseValue,
        manifest,
        approval,
        responses,
        now,
      );
      return writeArtifactResult(workspace, flags, "apply-curator-response", DEFAULT_PATHS.curatorDraft, card, {
        lifecycle: "draft",
        markdown: renderEvidenceCardMarkdown(card),
        nextActions: ["freeze"],
      });
    }

    if (command === "panel-manifest") {
      const caseValue = await readFrozenCase(workspace, requiredFlag(flags, "case"));
      const draft = await readEvidenceDraft(workspace, requiredFlag(flags, "draft"));
      const evidenceApproval = await readEvidenceApproval(
        workspace,
        requiredFlag(flags, "evidence-approval"),
      );
      const sourceFidelity = parseSourceFidelityReceipt(await readPrivateJson(
        workspace,
        requiredFlag(flags, "source-fidelity-path"),
      ));
      const manifest = await createPromptThreadPanelManifest({
        caseValue,
        sourceFidelity,
        evidenceDraft: draft,
        evidenceApproval,
        baseline: {
          arm: "baseline",
          checkoutPath: requiredFlag(flags, "baseline-checkout"),
          commitSha: requiredFlag(flags, "baseline-sha"),
          compilerPolicyDigest: requiredFlag(flags, "baseline-policy-digest"),
          harnessDigest: requiredFlag(flags, "harness-digest"),
        },
        candidate: {
          arm: "candidate",
          checkoutPath: requiredFlag(flags, "candidate-checkout"),
          commitSha: requiredFlag(flags, "candidate-sha"),
          compilerPolicyDigest: requiredFlag(flags, "candidate-policy-digest"),
          harnessDigest: requiredFlag(flags, "harness-digest"),
        },
        verdictScope: parseVerdictScope(requiredFlag(flags, "verdict-scope")),
        historyEnabled: flags.get("history-enabled") === "true",
        modelSnapshot: requiredFlag(flags, "model"),
        requestedServiceTier: "flex",
        zdrStatus: parseZdrStatus(requiredFlag(flags, "zdr-status")),
        runtimeHash: requiredFlag(flags, "runtime-hash"),
        actionSchemaHash: requiredFlag(flags, "action-schema-hash"),
        maximumSpendUsd: numberFlag(flags, "max-spend-usd"),
        estimatedInputTokensPerCall: numberFlag(flags, "input-token-ceiling"),
        maximumOutputTokensPerCall: numberFlag(flags, "output-token-ceiling"),
        actorIds: parseActorIds(requiredFlag(flags, "actor-ids")),
        now,
      }, dependencies.panelPreflight);
      return writeArtifactResult(
        workspace,
        flags,
        "panel-manifest",
        DEFAULT_PATHS.panelManifest,
        manifest,
        { lifecycle: "draft", nextActions: ["panel-approve"] },
      );
    }

    if (command === "panel-approve") {
      const blocked = requireInteractiveConfirmation(
        dependencies.isTTY ?? Boolean(process.stdin.isTTY),
        flags,
      );
      if (blocked) return blocked;
      const manifest = await readPanelManifest(
        workspace,
        requiredFlag(flags, "manifest"),
      );
      const approval = approvePromptThreadPanel(
        manifest,
        requiredFlag(flags, "reviewer"),
        now,
      );
      return writeArtifactResult(
        workspace,
        flags,
        "panel-approve",
        DEFAULT_PATHS.panelApproval,
        approval,
        { lifecycle: "approved", nextActions: ["panel-init"] },
      );
    }

    if (command === "panel-init") {
      const manifest = await readPanelManifest(
        workspace,
        requiredFlag(flags, "manifest"),
      );
      const approval = await readPaidApproval(
        workspace,
        requiredFlag(flags, "approval"),
      );
      await initializePromptThreadPanelRun(workspace, manifest, approval);
      return panelResult(
        structuralPanelStatus(manifest.cells, [], manifest.runId),
      );
    }

    if (command === "panel-status") {
      const manifest = await readPanelManifest(
        workspace,
        requiredFlag(flags, "manifest"),
      );
      const inspection = await inspectRunRecovery(workspace, manifest.runId);
      const latestStages = latestTransitionStages(inspection.transitions);
      const completed = manifest.cells
        .filter((cell) => latestStages.get(cell.cellId) === "completed")
        .map(({ cellId }) => cellId);
      return panelResult(structuralPanelStatus(
        manifest.cells,
        completed,
        manifest.runId,
        inspection.invalidReason,
      ));
    }

    if (command === "panel-run" || command === "panel-resume") {
      const manifest = await readPanelManifest(
        workspace,
        requiredFlag(flags, "manifest"),
      );
      const approval = await readPaidApproval(
        workspace,
        requiredFlag(flags, "approval"),
      );
      const caseValue = await readFrozenCase(workspace, requiredFlag(flags, "case"));
      const draft = await readEvidenceDraft(workspace, requiredFlag(flags, "draft"));
      const evidenceApproval = await readEvidenceApproval(
        workspace,
        requiredFlag(flags, "evidence-approval"),
      );
      const inspection = await inspectRunRecovery(workspace, manifest.runId);
      if (await readArtifactIfExists(
        workspace,
        `runs/${manifest.runId}/blind-decisions.json`,
      )) {
        throw new Error("An unblinded panel run is terminal and cannot run or resume");
      }
      assertPanelCommandState(command, manifest, inspection.transitions);
      const interrupt = dependencies.panelRunner ? null : installPanelInterruptHandler();
      const panelRunner = dependencies.panelRunner
        ?? defaultPanelRunner(
          workspace,
          manifest,
          process.env.OPENAI_API_KEY,
          interrupt?.stopRequested,
        );
      try {
        return panelResult(await runPromptThreadPanel(
          workspace,
          manifest,
          approval,
          caseValue,
          draft,
          evidenceApproval,
          panelRunner,
        ));
      } finally {
        interrupt?.dispose();
      }
    }

    if (command === "blind-init") {
      const manifest = await readPanelManifest(
        workspace,
        requiredFlag(flags, "manifest"),
      );
      const draft = await readEvidenceDraft(
        workspace,
        requiredFlag(flags, "draft"),
      );
      const { packet } = await initializePromptThreadBlindReview(
        workspace,
        manifest,
        draft,
        { now },
      );
      const status = await promptThreadBlindReviewStatus(
        workspace,
        manifest.runId,
        packet,
      );
      return blindResult(status, {
        artifactPath: `runs/${manifest.runId}/blind-packet.json`,
        artifactHash: hashCanonicalJson(packet),
        nextActions: ["render-blind-packet", "record-blind-decision"],
      });
    }

    if (command === "render-blind-packet") {
      const packetPath = requiredFlag(flags, "packet");
      const packet = await readBlindPacket(workspace, packetPath);
      return {
        status: "ok",
        lifecycle: "blind_ready",
        requiresHuman: true,
        artifactPath: packetPath,
        artifactHash: hashCanonicalJson(packet),
        markdown: renderPromptThreadBlindPacket(packet),
        nextActions: ["record-blind-decision"],
        reservedSpendUsd: 0,
        settledSpendUsd: 0,
        completedCells: 0,
        outstandingCells: 0,
        outstandingPairTokens: packetPairTokens(packet),
      };
    }

    if (command === "blind-status") {
      const manifest = await readPanelManifest(
        workspace,
        requiredFlag(flags, "manifest"),
      );
      const packet = await readBlindPacket(
        workspace,
        requiredFlag(flags, "packet"),
      );
      const status = await promptThreadBlindReviewStatus(
        workspace,
        manifest.runId,
        packet,
      );
      return blindResult(status, {
        nextActions: status.outstandingPairTokens.length > 0
          ? ["record-blind-decision"]
          : ["unblind"],
      });
    }

    if (command === "record-blind-decision") {
      const blocked = requireInteractiveConfirmation(
        dependencies.isTTY ?? Boolean(process.stdin.isTTY),
        flags,
      );
      if (blocked) return blocked;
      const manifest = await readPanelManifest(
        workspace,
        requiredFlag(flags, "manifest"),
      );
      const packet = await readBlindPacket(
        workspace,
        requiredFlag(flags, "packet"),
      );
      const decision = await recordPromptThreadBlindDecision(
        workspace,
        manifest.runId,
        packet,
        {
          pairToken: requiredFlag(flags, "pair-token"),
          choice: parseBlindChoice(requiredFlag(flags, "choice")),
          reviewer: requiredFlag(flags, "reviewer"),
          ...(flags.has("reasons") && {
            reasons: parseJsonFlag<BlindDecisionReasons>(flags, "reasons"),
          }),
          now,
        },
      );
      const status = await promptThreadBlindReviewStatus(
        workspace,
        manifest.runId,
        packet,
      );
      return blindResult(status, {
        artifactPath: `runs/${manifest.runId}/blind-decisions/${requiredFlag(flags, "pair-token")}.json`,
        artifactHash: hashCanonicalJson(decision),
        nextActions: status.outstandingPairTokens.length > 0
          ? ["record-blind-decision"]
          : ["unblind"],
      });
    }

    if (command === "unblind") {
      const blocked = requireInteractiveConfirmation(
        dependencies.isTTY ?? Boolean(process.stdin.isTTY),
        flags,
      );
      if (blocked) return blocked;
      const manifest = await readPanelManifest(
        workspace,
        requiredFlag(flags, "manifest"),
      );
      const packet = await readBlindPacket(
        workspace,
        requiredFlag(flags, "packet"),
      );
      const key = await readUnblindingKey(
        workspace,
        requiredFlag(flags, "key"),
      );
      const review = await unblindPromptThreadReview(
        workspace,
        manifest.runId,
        packet,
        key,
      );
      return {
        status: "ok",
        lifecycle: "unblinded",
        requiresHuman: false,
        artifactPath: `runs/${manifest.runId}/blind-decisions.json`,
        artifactHash: hashCanonicalJson(review.decisionsArtifact),
        nextActions: ["report"],
        reservedSpendUsd: 0,
        settledSpendUsd: 0,
        completedCells: 0,
        outstandingCells: 0,
        completedPairTokens: packetPairTokens(packet),
        outstandingPairTokens: [],
      };
    }

    if (command === "report") {
      const manifest = await readPanelManifest(
        workspace,
        requiredFlag(flags, "manifest"),
      );
      const draft = await readEvidenceDraft(
        workspace,
        requiredFlag(flags, "draft"),
      );
      const caseValue = await readFrozenCase(
        workspace,
        requiredFlag(flags, "case"),
      );
      const review = await readUnblindedReview(workspace, manifest.runId);
      const { report, markdown } = await buildPromptThreadReportFromRun(
        workspace,
        manifest,
        draft,
        review,
        caseValue,
        { now },
      );
      return {
        status: "ok",
        lifecycle: "reported",
        requiresHuman: false,
        artifactPath: `runs/${manifest.runId}/final-report.json`,
        artifactHash: hashCanonicalJson(report),
        markdown,
        nextActions: ["purge"],
        reservedSpendUsd: manifest.maximumSpendUsd,
        settledSpendUsd: 0,
        completedCells: manifest.cells.length,
        outstandingCells: 0,
      };
    }

    if (command === "purge") {
      const blocked = requireInteractiveConfirmation(
        dependencies.isTTY ?? Boolean(process.stdin.isTTY),
        flags,
      );
      if (blocked) return blocked;
      const manifest = await readPanelManifest(
        workspace,
        requiredFlag(flags, "manifest"),
      );
      await purgeCompletedRun(workspace, manifest.runId);
      return {
        status: "ok",
        lifecycle: "purged",
        requiresHuman: false,
        nextActions: [],
        reservedSpendUsd: 0,
        settledSpendUsd: 0,
        completedCells: manifest.cells.length,
        outstandingCells: 0,
      };
    }

    const blocked = requireInteractiveConfirmation(dependencies.isTTY ?? Boolean(process.stdin.isTTY), flags);
    if (blocked) return blocked;
    const caseValue = await readFrozenCase(workspace, requiredFlag(flags, "case"));
    const draft = await readEvidenceDraft(workspace, requiredFlag(flags, "draft"));
    const approval = freezeEvidenceCard(caseValue, draft, requiredFlag(flags, "reviewer"), now);
    return writeArtifactResult(workspace, flags, "freeze", DEFAULT_PATHS.evidenceApproval, approval, {
      lifecycle: "frozen",
      nextActions: ["panel-manifest"],
    });
  } catch (error) {
    return errorResult(error);
  }
}

function assertPanelCommandState(
  command: "panel-run" | "panel-resume",
  manifest: PromptThreadPanelManifest,
  transitions: readonly { cellId: string; stage: string }[],
): void {
  const latest = latestTransitionStages(transitions);
  if (
    manifest.cells.some((cell) => !latest.has(cell.cellId))
    || latest.size !== manifest.cells.length
  ) {
    throw new Error("Panel run must be initialized before execution");
  }
  if (
    command === "panel-run"
    && manifest.cells.some((cell) => latest.get(cell.cellId) !== "planned")
  ) {
    throw new Error("panel-run requires an untouched initialized journal; use panel-resume");
  }
}

function latestTransitionStages(
  transitions: readonly { cellId: string; stage: string }[],
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const transition of transitions) {
    latest.set(transition.cellId, transition.stage);
  }
  return latest;
}

function defaultPanelRunner(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  manifest: PromptThreadPanelManifest,
  apiKey: string | undefined,
  stopRequested: (() => boolean) | undefined,
): RunPanelDependencies {
  if (!apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY is required for an approved panel dispatch");
  }
  return createTrustedCheckoutPanelDependencies(
    workspace,
    manifest,
    createPromptThreadOpenAIDispatch(apiKey),
    {
      ...(stopRequested && {
        stopBeforeCell: stopRequested,
        stopAfterCell: stopRequested,
      }),
    },
  );
}

async function materializeDefaultCase(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
): Promise<MaterializePromptThreadCaseResult> {
  const connectionString = process.env.DATABASE_URL;
  try {
    return await materializePromptThreadCase(createDB(connectionString), {
      workspace,
    });
  } finally {
    await closeDB(connectionString);
  }
}

function installPanelInterruptHandler(): {
  stopRequested: () => boolean;
  dispose: () => void;
} {
  let requested = false;
  let interrupts = 0;
  const handler = () => {
    interrupts += 1;
    if (interrupts === 1) {
      requested = true;
      return;
    }
    process.removeListener("SIGINT", handler);
    process.kill(process.pid, "SIGINT");
  };
  process.on("SIGINT", handler);
  return {
    stopRequested: () => requested,
    dispose: () => process.removeListener("SIGINT", handler),
  };
}

function panelResult(
  summary: Awaited<ReturnType<typeof runPromptThreadPanel>>,
): PromptThreadLabResult {
  return {
    status: summary.lifecycle === "failed" || summary.lifecycle === "aborted"
      ? "error"
      : "ok",
    lifecycle: summary.lifecycle === "failed" || summary.lifecycle === "aborted"
      ? "error"
      : summary.lifecycle,
    requiresHuman: summary.requiresHuman,
    nextActions: summary.nextActions,
    reservedSpendUsd: summary.reservedSpendUsd,
    settledSpendUsd: summary.settledSpendUsd,
    completedCells: summary.completedCells,
    outstandingCells: summary.outstandingCells,
    ...(summary.reasonCode ? { guidance: summary.reasonCode } : {}),
  };
}

function blindResult(
  status: BlindReviewStatus,
  metadata: {
    artifactPath?: string;
    artifactHash?: string;
    nextActions: string[];
  },
): PromptThreadLabResult {
  return {
    status: "ok",
    lifecycle: status.lifecycle,
    requiresHuman: true,
    ...(metadata.artifactPath ? { artifactPath: metadata.artifactPath } : {}),
    ...(metadata.artifactHash ? { artifactHash: metadata.artifactHash } : {}),
    nextActions: metadata.nextActions,
    reservedSpendUsd: 0,
    settledSpendUsd: 0,
    completedCells: 0,
    outstandingCells: 0,
    completedPairTokens: status.completedPairTokens,
    outstandingPairTokens: status.outstandingPairTokens,
  };
}

async function dispatchInjectedCurator(
  broker: NonNullable<PromptThreadLabCliDependencies["curatorBroker"]>,
  manifest: CuratorManifest,
  approval: CuratorApprovalArtifact,
): Promise<CuratorPartitionResponse[]> {
  const responses: CuratorPartitionResponse[] = [];
  for (const partition of manifest.partitions) {
    responses.push(await broker.dispatchPartition({ manifest, approval, partition }));
  }
  return responses;
}

async function dispatchApprovedCurator(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  manifest: CuratorManifest,
  approval: CuratorApprovalArtifact,
  apiKey: string | undefined,
): Promise<CuratorPartitionResponse[]> {
  if (!apiKey?.trim()) throw new Error("OPENAI_API_KEY is required for approved curator dispatch");
  assertCuratorApproval(manifest, approval);
  const perCallCap = manifest.partitions.length === 0
    ? 0
    : manifest.maximumSpendUsd / manifest.partitions.length;
  const cells = manifest.partitions.map((partition, index) => ({
    cellId: partition.partitionId.replace(/[^A-Za-z0-9._-]/gu, "-"),
    ordinal: index + 1,
    actorId: partition.actorId,
    lineage: "",
    requestedServiceTier: "flex" as const,
    maxCostUsd: perCallCap,
  }));
  const broker = new PromptThreadProviderBroker(cells, manifest.maximumSpendUsd, {
    model: manifest.model,
    requestKind: "curator",
  });
  const providerDispatch = createPromptThreadOpenAIDispatch(apiKey);
  const responses: CuratorPartitionResponse[] = [];
  const runId = `curator-${hashCanonicalJson(manifest).slice("sha256:".length, 25)}`;
  const recovery = await recoverOrInvalidateRun(workspace, runId);
  if (recovery.lifecycle !== "running") {
    throw new Error(`Curator run is ${recovery.lifecycle}: ${recovery.reasonCode ?? "unusable"}`);
  }
  await withRunMutationLock(workspace, runId, async (lock) => {
    for (let index = 0; index < manifest.partitions.length; index += 1) {
      const partition = manifest.partitions[index]!;
      const brokerRequest = {
        cellId: cells[index]!.cellId,
        model: manifest.model,
        request: curatorRequest(manifest, partition),
      };
      const saved = await readArtifactIfExists(
        workspace,
        `runs/${runId}/cells/${cells[index]!.cellId}/provider-result.json`,
      );
      let response: unknown;
      if (saved) {
        if (saved.kind !== "provider_result" || saved.status !== "completed") {
          throw new Error("Saved curator provider result is invalid");
        }
        const privateResponse = saved.privateResponse as Record<string, unknown>;
        response = privateResponse.response;
        const prepared = broker.prepare(brokerRequest);
        broker.recordComplete(prepared, response, 0);
      } else {
        const result = await broker.dispatch(
          lock,
          brokerRequest,
          providerDispatch,
        );
        response = result.response;
      }
      responses.push({
        partitionId: partition.partitionId,
        items: parseCuratorResponse(response),
      });
    }
  });
  return responses;
}

function curatorRequest(
  manifest: CuratorManifest,
  partition: CuratorManifest["partitions"][number],
): Record<string, unknown> {
  return {
    model: manifest.model,
    input: JSON.stringify({
      actorId: partition.actorId,
      context: partition.privateContext,
      items: partition.privateItems,
    }),
    instructions: [
      "Classify only the cited eligible history supplied here.",
      "Do not infer variant identity, cost, cache behavior, or a winner.",
      "Return every item you score using its exact sourceId.",
    ].join("\n"),
    max_output_tokens: 8_192,
    store: false,
    service_tier: "flex",
    text: {
      format: {
        type: "json_schema",
        name: "prompt_thread_evidence_card",
        strict: true,
        schema: manifest.outputSchema,
      },
    },
  };
}

function parseCuratorResponse(responseValue: unknown): PromptThreadEvidenceCitation[] {
  const response = responseValue as Record<string, unknown>;
  if (typeof response?.output_text !== "string") {
    throw new Error("Curator response has no complete structured output");
  }
  const decoded = JSON.parse(response.output_text) as {
    items?: PromptThreadEvidenceCitation[];
  };
  if (!Array.isArray(decoded.items)) {
    throw new Error("Curator response has invalid structured output");
  }
  return decoded.items;
}

async function writeArtifactResult(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  flags: ReadonlyMap<string, string>,
  command: PromptThreadLabCommand,
  defaultPath: string,
  artifact: unknown,
  metadata: Pick<PromptThreadLabResult, "lifecycle" | "markdown" | "nextActions">,
): Promise<PromptThreadLabResult> {
  const artifactPath = flags.get("output") ?? defaultPath;
  await withRunMutationLock(workspace, `evidence-${command}`, async (lock) => {
    await atomicWriteArtifact(lock, artifactPath, artifact as ArtifactEnvelope);
    if (metadata.markdown) {
      await atomicWritePrivateText(
        lock,
        artifactPath.replace(/\.json$/u, ".md"),
        metadata.markdown,
      );
    }
  });
  return {
    status: "ok",
    lifecycle: metadata.lifecycle,
    requiresHuman: false,
    artifactPath,
    artifactHash: hashCanonicalJson(artifact),
    ...(metadata.markdown ? { markdown: metadata.markdown } : {}),
    nextActions: metadata.nextActions,
    reservedSpendUsd: 0,
    settledSpendUsd: 0,
    completedCells: 0,
    outstandingCells: 0,
  };
}

function requireInteractiveConfirmation(
  isTTY: boolean,
  flags: ReadonlyMap<string, string>,
): PromptThreadLabResult | null {
  if (!isTTY) {
    return humanRequired("interactive_tty_required", "Run this human-only command from an interactive TTY.");
  }
  if (flags.get("confirm") !== "true") {
    return humanRequired("interactive_confirmation_required", "Review the rendered artifact, then rerun with --confirm.");
  }
  return null;
}

function humanRequired(errorCode: string, guidance: string): PromptThreadLabResult {
  return {
    status: "error",
    lifecycle: "error",
    errorCode,
    requiresHuman: true,
    guidance,
    nextActions: [],
    reservedSpendUsd: 0,
    settledSpendUsd: 0,
    completedCells: 0,
    outstandingCells: 0,
  };
}

function errorResult(error: unknown): PromptThreadLabResult {
  return {
    status: "error",
    lifecycle: "error",
    errorCode: "invalid_request",
    requiresHuman: false,
    guidance: error instanceof Error ? error.message : String(error),
    nextActions: [],
    reservedSpendUsd: 0,
    settledSpendUsd: 0,
    completedCells: 0,
    outstandingCells: 0,
  };
}

async function readFrozenCase(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  path: string,
): Promise<FrozenCaseArtifact> {
  const artifact = parseArtifact(await readArtifact(workspace, path));
  if (artifact.kind !== "frozen_case") throw new Error("Expected a frozen_case artifact");
  return artifact;
}

async function readCuratorManifest(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  path: string,
): Promise<CuratorManifest> {
  const artifact = parseArtifact(await readArtifact(workspace, path));
  if (artifact.kind !== "curator_manifest") throw new Error("Expected a curator_manifest artifact");
  return artifact as unknown as CuratorManifest;
}

async function readCuratorApproval(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  path: string,
): Promise<CuratorApprovalArtifact> {
  const artifact = parseArtifact(await readArtifact(workspace, path));
  if (artifact.kind !== "curator_approval") throw new Error("Expected a curator_approval artifact");
  return artifact;
}

async function readEvidenceDraft(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  path: string,
): Promise<PromptThreadEvidenceCard> {
  const artifact = parseArtifact(await readArtifact(workspace, path));
  if (artifact.kind !== "evidence_card_draft") throw new Error("Expected an evidence_card_draft artifact");
  return artifact as unknown as PromptThreadEvidenceCard;
}

async function readEvidenceApproval(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  path: string,
): Promise<EvidenceCardApprovalArtifact> {
  const artifact = parseArtifact(await readArtifact(workspace, path));
  if (artifact.kind !== "evidence_card_approval") {
    throw new Error("Expected an evidence_card_approval artifact");
  }
  return artifact;
}

async function readPanelManifest(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  path: string,
): Promise<PromptThreadPanelManifest> {
  const artifact = parseArtifact(await readArtifact(workspace, path));
  if (artifact.kind !== "run_manifest") throw new Error("Expected a run_manifest artifact");
  return artifact as unknown as PromptThreadPanelManifest;
}

async function readPaidApproval(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  path: string,
): Promise<PaidApprovalArtifact> {
  const artifact = parseArtifact(await readArtifact(workspace, path));
  if (artifact.kind !== "paid_approval") throw new Error("Expected a paid_approval artifact");
  return artifact;
}

async function readBlindPacket(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  path: string,
): Promise<BlindPacketArtifact> {
  const artifact = parseArtifact(await readArtifact(workspace, path));
  if (artifact.kind !== "blind_packet") throw new Error("Expected a blind_packet artifact");
  return artifact;
}

async function readUnblindingKey(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  path: string,
): Promise<UnblindingKeyArtifact> {
  const artifact = parseArtifact(await readArtifact(workspace, path));
  if (artifact.kind !== "unblinding_key") {
    throw new Error("Expected an unblinding_key artifact");
  }
  return artifact;
}

async function readUnblindedReview(
  workspace: Awaited<ReturnType<typeof createPrivateWorkspace>>,
  runId: string,
): Promise<PromptThreadUnblindedReview> {
  const artifact = parseArtifact(await readArtifact(
    workspace,
    `runs/${runId}/blind-decisions.json`,
  ));
  if (artifact.kind !== "blind_decisions") {
    throw new Error("Expected a blind_decisions artifact");
  }
  const privateValue = await readPrivateJson(
    workspace,
    `runs/${runId}/unblinded.json`,
  );
  if (
    !privateValue
    || typeof privateValue !== "object"
    || Array.isArray(privateValue)
    || !Array.isArray((privateValue as { revealedDecisions?: unknown }).revealedDecisions)
  ) {
    throw new Error("Expected complete private unblinding data");
  }
  const revealedDecisions = (
    privateValue as { revealedDecisions: unknown[] }
  ).revealedDecisions.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Invalid revealed blind decision");
    }
    const decision = candidate as Record<string, unknown>;
    if (
      typeof decision.pairToken !== "string"
      || typeof decision.choice !== "string"
    ) {
      throw new Error("Invalid revealed blind decision");
    }
    return {
      pairToken: decision.pairToken,
      choice: parseBlindChoice(decision.choice),
      preferredArm: parsePreferredArm(decision.preferredArm),
      ...(decision.reasons !== undefined && {
        reasons: parseDecisionReasons(decision.reasons),
      }),
    };
  });
  return {
    decisionsArtifact: artifact as BlindDecisionsArtifact,
    revealedDecisions,
  };
}

function parseCommand(argv: readonly string[]): {
  command: PromptThreadLabCommand;
  flags: Map<string, string>;
} {
  const [commandValue, ...arguments_] = argv;
  if (!isCommand(commandValue)) throw new Error("Expected a prompt-thread lab command");
  const flags = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const [name, inlineValue] = argument.slice(2).split("=", 2);
    if (!name) throw new Error(`Invalid flag: ${argument}`);
    if (name === "confirm") {
      flags.set(name, inlineValue ?? "true");
      continue;
    }
    const value = inlineValue ?? arguments_[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
    flags.set(name, value);
    if (inlineValue === undefined) index += 1;
  }
  return { command: commandValue, flags };
}

function isCommand(value: string | undefined): value is PromptThreadLabCommand {
  return value === "materialize"
    || value === "verify-source"
    || value === "manual-draft"
    || value === "curator-manifest"
    || value === "curator-approve"
    || value === "curate"
    || value === "apply-curator-response"
    || value === "freeze"
    || value === "panel-manifest"
    || value === "panel-approve"
    || value === "panel-init"
    || value === "panel-status"
    || value === "panel-run"
    || value === "panel-resume"
    || value === "blind-init"
    || value === "render-blind-packet"
    || value === "blind-status"
    || value === "record-blind-decision"
    || value === "unblind"
    || value === "report"
    || value === "purge";
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
  const value = flags.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function numberFlag(flags: ReadonlyMap<string, string>, name: string): number {
  const value = Number(requiredFlag(flags, name));
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number`);
  return value;
}

function parseJsonFlag<T>(flags: ReadonlyMap<string, string>, name: string): T {
  try {
    return JSON.parse(requiredFlag(flags, name)) as T;
  } catch {
    throw new Error(`--${name} must contain valid JSON`);
  }
}

function parseActorIds(value: string): readonly [string, string] {
  const actorIds = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (actorIds.length !== 2) throw new Error("--actor-ids requires exactly two IDs");
  return [actorIds[0]!, actorIds[1]!];
}

function parseZdrStatus(value: string): "enabled" | "disabled" | "unknown" {
  if (value === "enabled" || value === "disabled" || value === "unknown") return value;
  throw new Error("--zdr-status must be enabled, disabled, or unknown");
}

function parseVerdictScope(value: string): "full" | "cache_quality_only" {
  if (value === "full" || value === "cache_quality_only") return value;
  throw new Error("--verdict-scope must be full or cache_quality_only");
}

function parseSourceFidelityReceipt(value: unknown): PromptThreadFidelityReceipt {
  if (
    !value
    || typeof value !== "object"
    || (value as { version?: unknown }).version !== 1
    || (value as { status?: unknown }).status !== "matched"
    || typeof (value as { caseId?: unknown }).caseId !== "string"
    || !Number.isInteger((value as { turnCount?: unknown }).turnCount)
    || (value as { sourceMutation?: unknown }).sourceMutation !== false
    || (value as { canonicalizerId?: unknown }).canonicalizerId !== CANONICALIZER_ID
    || (value as { canonicalizerVersion?: unknown }).canonicalizerVersion
      !== CANONICALIZER_VERSION
    || !isStringArray((value as { comparedLanes?: unknown }).comparedLanes)
    || !isStringArray(
      (value as { transportOnlyExclusions?: unknown }).transportOnlyExclusions,
    )
    || !sameStrings(
      (value as { comparedLanes: string[] }).comparedLanes,
      PROMPT_THREAD_FIDELITY_LANES,
    )
    || !sameStrings(
      (value as { transportOnlyExclusions: string[] }).transportOnlyExclusions,
      PROMPT_THREAD_TRANSPORT_ONLY_EXCLUSIONS,
    )
  ) {
    throw new Error("Source-fidelity receipt is invalid or unmatched");
  }
  return value as PromptThreadFidelityReceipt;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function sameStrings(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function parseBlindChoice(value: string): BlindChoice {
  if (
    value === "A"
    || value === "B"
    || value === "no_preference"
    || value === "insufficient_evidence"
  ) {
    return value;
  }
  throw new Error("--choice must be A, B, no_preference, or insufficient_evidence");
}

function parsePreferredArm(value: unknown): "baseline" | "candidate" | null {
  if (value === null || value === "baseline" || value === "candidate") {
    return value;
  }
  throw new Error("Revealed blind decision has an invalid preferred arm");
}

function parseDecisionReasons(
  value: unknown,
): NonNullable<PromptThreadUnblindedReview["revealedDecisions"][number]["reasons"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Revealed blind decision reasons must be an object");
  }
  const reasons: BlindDecisionReasons = {};
  for (const key of ["strategy", "coherence", "evidenceUse", "watchability"] as const) {
    const reason = (value as Record<string, unknown>)[key];
    if (reason !== undefined) {
      if (typeof reason !== "string") {
        throw new Error(`Revealed blind decision reason ${key} must be a string`);
      }
      reasons[key] = reason;
    }
  }
  return reasons;
}

function packetPairTokens(packet: BlindPacketArtifact): string[] {
  return packet.pairs.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Blind packet contains an invalid pair");
    }
    const pairToken = (candidate as Record<string, unknown>).pairToken;
    if (typeof pairToken !== "string") {
      throw new Error("Blind packet pair has no token");
    }
    return pairToken;
  });
}

if (import.meta.main) {
  const result = await runPromptThreadLabCli(process.argv.slice(2));
  console.log(JSON.stringify(result));
  process.exit(result.status === "ok" ? 0 : 2);
}
