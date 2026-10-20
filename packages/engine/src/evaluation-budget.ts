import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProviderAttemptIntent, ProviderAttemptRecord, ProviderExecutionHooks } from "./provider-execution";

const ledgerQueues = new Map<string, Promise<void>>();

const MILLION = 1_000_000;
const INPUT_FRAMING_TOKEN_RESERVE = 16_384;
const PRICES: Record<string, { input: number; output: number }> = {
  "openai:gpt-6-luna": { input: 0.25, output: 0.75 }, // long-context cache-write tier, no cache discount
  "meta-muse:muse-spark-1.3-contributor": { input: 0.10, output: 0.20 },
  // Twice Katana's published $1.38/$2.75 rates (2026-10-19), with no cache discount.
  // https://kat.imgnai.com/llms.txt — one authorized small Grok evaluation.
  "katana:grok-4-3": { input: 2.76, output: 5.50 },
};
type Entry = { attemptId: string; catalogId: string; reservedUsd: number; framingAdjustmentUsd?: number; usageEstimateUsd: number | null; providerActualUsd: number | null; status: "reserved" | "settled" };
type Ledger = { version: 1; capUsd: number; framingReserveTokens?: number; entries: Entry[] };

function outputLimit(body: unknown): number {
  if (!body || typeof body !== "object") throw new Error("Budget guard cannot inspect provider request body");
  const record = body as Record<string, unknown>;
  for (const key of ["max_output_tokens", "max_completion_tokens", "max_tokens"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  }
  throw new Error("Budget guard requires an explicit provider output-token limit");
}

function reserveFor(intent: ProviderAttemptIntent): { catalogId: string; usd: number } {
  const request = intent.preparedRequest;
  const catalogId = request.catalogId;
  if (!catalogId || !PRICES[catalogId]) throw new Error(`Budget guard rejects unpriced provider ${catalogId ?? request.model}`);
  const price = PRICES[catalogId]!;
  const inputTokens = Buffer.byteLength(JSON.stringify(request.body), "utf8") + INPUT_FRAMING_TOKEN_RESERVE;
  const outputTokens = outputLimit(request.body);
  return { catalogId, usd: inputTokens * price.input / MILLION + outputTokens * price.output / MILLION };
}

/** A serialized, append-only spend guard. Unknown terminal outcomes retain their full reservation. */
export class EvaluationBudget {
  private readonly lockPath: string;
  constructor(private readonly path: string, private readonly capUsd: number) {
    if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error("Evaluation budget must be a positive USD amount");
    this.lockPath = `${path}.lock`;
  }

  hooks(base: ProviderExecutionHooks): ProviderExecutionHooks {
    return {
      ...base,
      onReserve: async intent => {
        const reservation = reserveFor(intent);
        await this.withLedger(async ledger => {
          if (ledger.capUsd !== this.capUsd) throw new Error(`Budget ledger cap mismatch (${ledger.capUsd} vs ${this.capUsd})`);
          if (ledger.entries.some(entry => entry.attemptId === intent.attemptId)) return;
          const committed = ledger.entries.reduce((sum, entry) => sum + committedUsd(entry), 0);
          if (committed + reservation.usd > ledger.capUsd + 1e-12) throw new Error(`Evaluation budget exhausted: $${committed.toFixed(6)} committed; $${reservation.usd.toFixed(6)} required; $${ledger.capUsd.toFixed(2)} cap`);
          ledger.entries.push({ attemptId: intent.attemptId, catalogId: reservation.catalogId, reservedUsd: reservation.usd,
            framingAdjustmentUsd: 0, usageEstimateUsd: null, providerActualUsd: null, status: "reserved" });
        });
        await base.onReserve?.(intent);
      },
      onTerminal: async record => {
        const receipt = await base.onTerminal?.(record);
        await this.settle(record);
        return receipt;
      },
    };
  }

  private async settle(record: ProviderAttemptRecord): Promise<void> {
    await this.withLedger(async ledger => {
      const entry = ledger.entries.find(item => item.attemptId === record.attemptId);
      if (!entry || entry.status === "settled") return;
      const accounting = record.accounting;
      const usage = accounting?.usage;
      if (accounting?.actualCostMicrousd !== undefined) {
        if (!Number.isSafeInteger(accounting.actualCostMicrousd) || accounting.actualCostMicrousd < 0) throw new Error("Invalid provider actual cost in evaluation ledger");
        entry.providerActualUsd = accounting.actualCostMicrousd / 1_000_000;
      }
      if (usage && [usage.promptTokens, usage.completionTokens, usage.reasoningTokens].some(value => value !== undefined && (!Number.isFinite(value) || value < 0))) {
        throw new Error("Invalid provider token usage in evaluation ledger");
      }
      if (!usage || usage.promptTokens === undefined || usage.completionTokens === undefined) {
        if (entry.providerActualUsd !== null) entry.status = "settled";
        return;
      }
      const rates = PRICES[entry.catalogId]!;
      const input = usage.promptTokens;
      const output = Math.max(usage.completionTokens, usage.reasoningTokens ?? 0);
      entry.usageEstimateUsd = input * rates.input / MILLION + output * rates.output / MILLION;
      entry.status = "settled";
    });
  }

  private async withLedger(mutate: (ledger: Ledger) => void | Promise<void>): Promise<void> {
    const preceding = ledgerQueues.get(this.path) ?? Promise.resolve();
    const pending = preceding.then(() => this.writeLedger(mutate));
    // Serialize parallel decisions within the API worker; the file lock still
    // rejects independent workers sharing a ledger accidentally.
    const settled = pending.then(() => {}, () => {});
    ledgerQueues.set(this.path, settled);
    try { await pending; }
    finally { if (ledgerQueues.get(this.path) === settled) ledgerQueues.delete(this.path); }
  }

  private async writeLedger(mutate: (ledger: Ledger) => void | Promise<void>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    let lock;
    try { lock = await open(this.lockPath, "wx"); }
    catch { throw new Error(`Budget ledger is locked; refusing concurrent or ambiguous run: ${this.lockPath}`); }
    try {
      let ledger: Ledger;
      try { ledger = JSON.parse(await readFile(this.path, "utf8")) as Ledger; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Cannot read budget ledger: ${String(error)}`);
        ledger = { version: 1, capUsd: this.capUsd, framingReserveTokens: INPUT_FRAMING_TOKEN_RESERVE, entries: [] };
      }
      if (ledger.version !== 1 || !Array.isArray(ledger.entries) || !Number.isFinite(ledger.capUsd)) throw new Error("Invalid evaluation budget ledger");
      if (ledger.entries.some(entry => typeof entry.attemptId !== "string" || !Number.isFinite(entry.reservedUsd) || entry.reservedUsd < 0
        || entry.usageEstimateUsd !== null && (!Number.isFinite(entry.usageEstimateUsd) || entry.usageEstimateUsd < 0)
        || entry.providerActualUsd !== null && (!Number.isFinite(entry.providerActualUsd) || entry.providerActualUsd < 0)
        || entry.status !== "reserved" && entry.status !== "settled")) {
        throw new Error("Invalid evaluation budget ledger entry");
      }
      const previousFraming = ledger.framingReserveTokens ?? 1_024;
      if (!Number.isSafeInteger(previousFraming) || previousFraming < 0 || previousFraming > INPUT_FRAMING_TOKEN_RESERVE) {
        throw new Error("Invalid evaluation budget framing reserve version");
      }
      if (previousFraming < INPUT_FRAMING_TOKEN_RESERVE) {
        const delta = INPUT_FRAMING_TOKEN_RESERVE - previousFraming;
        for (const entry of ledger.entries) {
          const rates = PRICES[entry.catalogId];
          if (!rates) throw new Error(`Cannot migrate budget reservation for unpriced model ${entry.catalogId}`);
          const adjustment = delta * rates.input / MILLION;
          entry.reservedUsd += adjustment;
          entry.framingAdjustmentUsd = (entry.framingAdjustmentUsd ?? 0) + adjustment;
        }
        ledger.framingReserveTokens = INPUT_FRAMING_TOKEN_RESERVE;
      }
      await mutate(ledger);
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(ledger, null, 2), { mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      await lock.close();
      await unlink(this.lockPath);
    }
  }
}

function committedUsd(entry: Entry): number {
  return entry.status === "reserved" ? entry.reservedUsd
    : Math.max(entry.reservedUsd, entry.usageEstimateUsd ?? 0, entry.providerActualUsd ?? 0);
}

/** Operator-supplied local API evaluation cap; no client may select a ledger path. */
export function withEvaluationBudget(base: ProviderExecutionHooks, env: Record<string, string | undefined>, game: "WEREWOLF" | "INFLUENCE" = "WEREWOLF"): ProviderExecutionHooks {
  const path = env[`${game}_EVALUATION_BUDGET_LEDGER`];
  const cap = env[`${game}_EVALUATION_BUDGET_USD`];
  if (path === undefined && cap === undefined) return base;
  if (!path?.trim() || !cap?.trim()) throw new Error(`Set both ${game}_EVALUATION_BUDGET_LEDGER and ${game}_EVALUATION_BUDGET_USD`);
  if (env.NODE_ENV === "production") throw new Error("Local evaluation ledgers cannot be used in production");
  return new EvaluationBudget(path, Number(cap)).hooks(base);
}
