import {
  hashCanonicalJson,
  parseArtifact,
  type ArtifactEnvelope,
  type CuratorApprovalArtifact,
  type FrozenCaseArtifact,
} from "@influence/prompt-lab-protocol";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
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
  createPromptThreadOpenAIClient,
  PromptThreadProviderBroker,
} from "../services/prompt-thread-provider-broker.js";
import {
  atomicWriteArtifact,
  atomicWriteJson,
  atomicWritePrivateText,
  createPrivateWorkspace,
  readArtifact,
  readArtifactIfExists,
  readPrivateJson,
  recoverOrInvalidateRun,
  withRunMutationLock,
} from "../services/prompt-thread-workspace.js";

type PromptThreadLabCommand =
  | "manual-draft"
  | "curator-manifest"
  | "curator-approve"
  | "curate"
  | "apply-curator-response"
  | "freeze";

export interface PromptThreadLabResult {
  status: "ok" | "error";
  lifecycle: "draft" | "approved" | "frozen" | "error";
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
}

const DEFAULT_PATHS = {
  manualDraft: "evidence/manual-draft.json",
  curatorManifest: "evidence/curator-manifest.json",
  curatorApproval: "evidence/curator-approval.json",
  curatorResponses: "evidence/curator-responses.json",
  curatorDraft: "evidence/curator-draft.json",
  evidenceApproval: "evidence/evidence-card-approval.json",
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
        nextActions: ["apply-curator-response"],
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

    const blocked = requireInteractiveConfirmation(dependencies.isTTY ?? Boolean(process.stdin.isTTY), flags);
    if (blocked) return blocked;
    const caseValue = await readFrozenCase(workspace, requiredFlag(flags, "case"));
    const draft = await readEvidenceDraft(workspace, requiredFlag(flags, "draft"));
    const approval = freezeEvidenceCard(caseValue, draft, requiredFlag(flags, "reviewer"), now);
    return writeArtifactResult(workspace, flags, "freeze", DEFAULT_PATHS.evidenceApproval, approval, {
      lifecycle: "frozen",
      nextActions: ["create-run"],
    });
  } catch (error) {
    return errorResult(error);
  }
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
  const client = createPromptThreadOpenAIClient(apiKey);
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
          (request) => client.responses.create(
            request as unknown as ResponseCreateParamsNonStreaming,
          ),
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
  return value === "manual-draft"
    || value === "curator-manifest"
    || value === "curator-approve"
    || value === "curate"
    || value === "apply-curator-response"
    || value === "freeze";
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

if (import.meta.main) {
  const result = await runPromptThreadLabCli(process.argv.slice(2));
  console.log(JSON.stringify(result));
  process.exit(result.status === "ok" ? 0 : 2);
}
