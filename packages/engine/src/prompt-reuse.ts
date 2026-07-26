import { createHash } from "crypto";
import type {
  PrivateDecisionTraceMessage,
  PromptReuseReceipt,
  RecallPlanReceipt,
  RecallPromptClass,
} from "./game-runner.types";
import { toStructuralRecallPlanReceipt } from "./context-recall-plan";

const HASH_VERSION = "prompt-reuse-v1";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function characters(value: unknown): number { try { return typeof value === "string" ? value.length : JSON.stringify(value).length; } catch { return 0; } }
function classify(role: string, index: number): "instructions" | "context" | "conversation" | "tool" | "unknown" {
  if (role === "system" || role === "developer") return "instructions";
  if (role === "tool") return "tool";
  if (role === "user" && index === 0) return "context";
  if (role === "user" || role === "assistant") return "conversation";
  return "unknown";
}
function volatility(kind: ReturnType<typeof classify>): "stable" | "rolling" | "volatile" {
  return kind === "instructions" ? "stable" : kind === "context" ? "rolling" : "volatile";
}

/** Structural-only request comparison; hashes/counts only, never payload mutation. */
export class PromptReuseCollector {
  private readonly previousByLane = new Map<string, PromptReuseReceipt>();
  observe(messages: readonly PrivateDecisionTraceMessage[], params: { lane: string; requestShape: string; usage?: PromptReuseReceipt["usage"] }): PromptReuseReceipt {
    const blocks = messages.map((message, index) => {
      const kind = classify(message.role, index); const count = characters(message.content);
      return { id: `m${index}:${message.role}`, class: kind, volatility: volatility(kind), canonicalHash: hash([HASH_VERSION, message.role, message.content]), rollingHash: hash([HASH_VERSION, messages.slice(0, index + 1).map((item) => [item.role, item.content])]), characters: count, tokenEstimate: Math.ceil(count / 4) } as const;
    });
    const previous = this.previousByLane.get(params.lane); let reusableCharacters = 0; let reusableTokenEstimate = 0; let firstBreak: string | undefined;
    if (previous) {
      for (let index = 0; index < blocks.length; index += 1) { const prior = previous.blocks[index]; const current = blocks[index]; if (!current || !prior || prior.canonicalHash !== current.canonicalHash) { firstBreak = current?.id ?? "request_shape"; break; } reusableCharacters += current.characters; reusableTokenEstimate += current.tokenEstimate; }
      if (!firstBreak && blocks.length !== previous.blocks.length) firstBreak = "request_shape";
    }
    const receipt: PromptReuseReceipt = { version: 1, lane: hash(["lane", params.lane]).slice(0, 24), requestShape: params.requestShape, blocks, characterEstimate: blocks.reduce((sum, block) => sum + block.characters, 0), tokenEstimate: blocks.reduce((sum, block) => sum + block.tokenEstimate, 0), comparable: Boolean(previous), reusableCharacters, reusableTokenEstimate, ...(firstBreak && { firstBreak }), ...(params.usage && { usage: params.usage }) };
    this.previousByLane.set(params.lane, receipt); return receipt;
  }
}

/** Aggregate safe enough for simulation artifacts and durable rollups. */
export class PromptReuseAggregate {
  private requestCount = 0; private comparableCount = 0; private reusableCharacters = 0; private reusableTokenEstimate = 0;
  private readonly firstBreaks = new Map<string, number>();
  add(receipt: PromptReuseReceipt | undefined): void {
    if (!receipt) return; this.requestCount += 1;
    if (receipt.comparable) this.comparableCount += 1;
    this.reusableCharacters += receipt.reusableCharacters; this.reusableTokenEstimate += receipt.reusableTokenEstimate;
    if (receipt.firstBreak) this.firstBreaks.set(receipt.firstBreak, (this.firstBreaks.get(receipt.firstBreak) ?? 0) + 1);
  }
  snapshot() { return { version: 1 as const, requestCount: this.requestCount, comparableCount: this.comparableCount, reusableCharacters: this.reusableCharacters, reusableTokenEstimate: this.reusableTokenEstimate, firstBreaks: Object.fromEntries(this.firstBreaks), coverage: "partial_structural_receipts" as const }; }
}

/**
 * Safe structural aggregate of Recall Plan receipts for simulation artifacts (U5 / R16–R17).
 *
 * This is the only promotion-safe evaluation rollup written beside a game run.
 * Full simulation JSON / private-trace files remain producer artifacts and must
 * not be used as the R13 promotion input.
 *
 * Never retains dialogue, names, entry IDs, rejected counts, prompt payloads,
 * thinking, or reasoning context.
 */
export interface RecallPlanReceiptAggregateSnapshot {
  version: 1;
  /** Discriminator for the dedicated safe evaluation artifact. */
  coverage: "structural_recall_receipts";
  requestCount: number;
  byPromptClass: Partial<Record<RecallPromptClass, number>>;
  totalProtectedTokenEstimate: number;
  totalHotTokenEstimate: number;
  totalHistoryTokenEstimate: number;
  protectedOverflowCount: number;
  selectedLaneCounts: {
    protected: number;
    hot: number;
    history: number;
  };
  /** History source-class counts only — no rank text or entry IDs. */
  historySourceClassCounts: {
    public: number;
    mingle: number;
  };
  /**
   * Actor-authorized event-boundary rollup. Never a global transcript watermark.
   * maxAuthorizedEntrySequence is the max across receipts (structural sequence only).
   */
  eventBoundary: {
    maxAuthorizedEntrySequence: number | null;
    totalAuthorizedCandidateCount: number;
    totalProtectedRecordCount: number;
  };
}

export class RecallPlanReceiptAggregate {
  private requestCount = 0;
  private readonly byPromptClass = new Map<RecallPromptClass, number>();
  private totalProtectedTokenEstimate = 0;
  private totalHotTokenEstimate = 0;
  private totalHistoryTokenEstimate = 0;
  private protectedOverflowCount = 0;
  private selectedProtected = 0;
  private selectedHot = 0;
  private selectedHistory = 0;
  private historyPublic = 0;
  private historyMingle = 0;
  private maxAuthorizedEntrySequence: number | null = null;
  private totalAuthorizedCandidateCount = 0;
  private totalProtectedRecordCount = 0;

  add(receipt: RecallPlanReceipt | undefined): void {
    if (!receipt) return;
    const structural = toStructuralRecallPlanReceipt(receipt);
    this.requestCount += 1;
    this.byPromptClass.set(
      structural.promptClass,
      (this.byPromptClass.get(structural.promptClass) ?? 0) + 1,
    );
    this.totalProtectedTokenEstimate += structural.protectedTokenEstimate;
    this.totalHotTokenEstimate += structural.hotTokenEstimate;
    this.totalHistoryTokenEstimate += structural.historyTokenEstimate;
    if (structural.protectedOverflow) this.protectedOverflowCount += 1;
    this.selectedProtected += structural.selectedLaneCounts.protected;
    this.selectedHot += structural.selectedLaneCounts.hot;
    this.selectedHistory += structural.selectedLaneCounts.history;
    for (const slot of structural.selectedByRankSlot) {
      if (slot.sourceClass === "public") this.historyPublic += 1;
      else this.historyMingle += 1;
    }
    const seq = structural.eventBoundary.maxAuthorizedEntrySequence;
    if (seq !== null) {
      if (
        this.maxAuthorizedEntrySequence === null
        || seq > this.maxAuthorizedEntrySequence
      ) {
        this.maxAuthorizedEntrySequence = seq;
      }
    }
    this.totalAuthorizedCandidateCount += structural.eventBoundary.authorizedCandidateCount;
    this.totalProtectedRecordCount += structural.eventBoundary.protectedRecordCount;
  }

  snapshot(): RecallPlanReceiptAggregateSnapshot {
    const byPromptClass: Partial<Record<RecallPromptClass, number>> = {};
    for (const [promptClass, count] of this.byPromptClass) {
      byPromptClass[promptClass] = count;
    }
    return {
      version: 1,
      coverage: "structural_recall_receipts",
      requestCount: this.requestCount,
      byPromptClass,
      totalProtectedTokenEstimate: this.totalProtectedTokenEstimate,
      totalHotTokenEstimate: this.totalHotTokenEstimate,
      totalHistoryTokenEstimate: this.totalHistoryTokenEstimate,
      protectedOverflowCount: this.protectedOverflowCount,
      selectedLaneCounts: {
        protected: this.selectedProtected,
        hot: this.selectedHot,
        history: this.selectedHistory,
      },
      historySourceClassCounts: {
        public: this.historyPublic,
        mingle: this.historyMingle,
      },
      eventBoundary: {
        maxAuthorizedEntrySequence: this.maxAuthorizedEntrySequence,
        totalAuthorizedCandidateCount: this.totalAuthorizedCandidateCount,
        totalProtectedRecordCount: this.totalProtectedRecordCount,
      },
    };
  }
}
