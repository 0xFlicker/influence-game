import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { modelRateCard } from "./model-route-metadata";
import type { ProviderAttemptIntent, ProviderAttemptRecord, ProviderExecutionHooks } from "./provider-execution";

type Currency = "openaiUsd" | "katanaCredits" | "xaiUsd" | "metaUsd";
type Entry = { id: string; currency: Currency; reserved: number; charged: number; state: "reserved" | "settled"; catalogId: string; gameId?: string; inputRate?: number; outputRate?: number };
export interface LocalTaskLedger { version: 1; limits: Record<Currency, number>; prior: Record<Currency, number>; allowedGameIds: string[]; entries: Entry[] }
const queues = new Map<string, Promise<void>>();
const CREDIT_USD = 0.0052;
const finite = (value: number) => Number.isFinite(value) && value >= 0;

export function localTaskBudgetPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const path = env.INFLUENCE_LOCAL_TASK_BUDGET;
  if (path && env.NODE_ENV === "production") throw new Error("Local task budget cannot run in production");
  return path ? resolve(path) : undefined;
}

export function localTaskBudgetIdentity(env: NodeJS.ProcessEnv = process.env): string | null {
  const path = localTaskBudgetPath(env);
  return path ? createHash("sha256").update(path).digest("hex") : null;
}

/** Cross-process lock, atomic replacement, and fail-closed persistence before dispatch. */
export async function updateLocalTaskLedger(path: string, mutate: (ledger: LocalTaskLedger) => void) {
  const previous = queues.get(path) ?? Promise.resolve();
  const pending = previous.then(async () => {
    await mkdir(dirname(path), { recursive: true });
    const lock = await open(`${path}.lock`, "wx");
    try {
      const ledger = JSON.parse(await readFile(path, "utf8")) as LocalTaskLedger;
      if (ledger.version !== 1 || !Array.isArray(ledger.entries) || !Array.isArray(ledger.allowedGameIds)) throw new Error("Invalid local task ledger");
      // Older ledgers authorize no Meta spending until explicitly allocated.
      ledger.limits.metaUsd ??= 0;
      ledger.prior.metaUsd ??= 0;
      for (const currency of ["openaiUsd", "katanaCredits", "xaiUsd", "metaUsd"] as const) {
        if (!finite(ledger.limits[currency]) || !finite(ledger.prior[currency])) throw new Error("Invalid task budget amount");
      }
      if (ledger.entries.some(e => !finite(e.reserved) || !finite(e.charged) || !(e.currency in ledger.limits))) throw new Error("Invalid task budget entry");
      mutate(ledger);
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(ledger, null, 2), { mode: 0o600 });
      await rename(temporary, path);
    } finally { await lock.close(); await unlink(`${path}.lock`); }
  });
  const settled = pending.then(() => {}, () => {});
  queues.set(path, settled);
  try { await pending; } finally { if (queues.get(path) === settled) queues.delete(path); }
}

async function reserve(path: string, entry: Entry) {
  await updateLocalTaskLedger(path, ledger => {
    if (entry.gameId && !ledger.allowedGameIds.includes(entry.gameId)) throw new Error("Game is outside the authorized local task budget");
    if (ledger.entries.some(e => e.id === entry.id)) return;
    const committed = ledger.prior[entry.currency] + ledger.entries.filter(e => e.currency === entry.currency).reduce((sum, e) => sum + e.charged, 0);
    if (committed + entry.reserved > ledger.limits[entry.currency]) throw new Error(`Local task ${entry.currency} allowance exhausted before dispatch`);
    ledger.entries.push(entry);
  });
}

function textReservation(intent: ProviderAttemptIntent): Entry {
  const catalogId = intent.preparedRequest.catalogId;
  const body = intent.preparedRequest.body as Record<string, unknown>;
  if (!catalogId || !body || typeof body !== "object") throw new Error("Task budget requires a catalog and bounded request");
  const provider = catalogId.split(":")[0];
  if (!["openai", "katana"].includes(provider!) && catalogId !== "meta-muse:muse-spark-1.3-contributor") throw new Error(`Task budget rejects provider ${provider}`);
  const card = modelRateCard(catalogId);
  if (!card) throw new Error(`Task budget rejects unpriced model ${catalogId}`);
  const rows = [card.rates, ...(card.rates.tiers ?? [])];
  // Twice the most expensive documented tier; no cache or Flex discount.
  const inputRate = 2 * Math.max(...rows.flatMap(r => [r.inputPer1M, r.cachedInputPer1M, r.cacheWriteInputPer1M ?? 0]));
  const outputRate = 2 * Math.max(...rows.map(r => r.outputPer1M));
  const output = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens;
  if (typeof output !== "number" || !Number.isSafeInteger(output) || output <= 0) throw new Error("Task budget requires an explicit output token limit");
  const input = Buffer.byteLength(JSON.stringify(body)) + 16_384;
  const usd = Math.max(card.minimumUsd ?? 0, (input * inputRate + output * outputRate) / 1_000_000) + (card.roundingUsd ?? 0);
  const currency = provider === "katana" ? "katanaCredits" : provider === "meta-muse" ? "metaUsd" : "openaiUsd";
  const amount = currency === "katanaCredits" ? Math.ceil(usd / CREDIT_USD * 10) / 10 : usd;
  return { id: intent.attemptId, currency, reserved: amount, charged: amount, state: "reserved", catalogId,
    gameId: intent.coordinate.gameId, inputRate, outputRate };
}

async function settleText(path: string, record: ProviderAttemptRecord) {
  await updateLocalTaskLedger(path, ledger => {
    const entry = ledger.entries.find(e => e.id === record.attemptId);
    if (!entry || entry.state === "settled") return;
    const accounting = record.accounting, usage = accounting?.usage;
    const actual = (accounting?.actualCostMicrousd ?? 0) / 1_000_000;
    if (!finite(actual)) throw new Error("Invalid task receipt");
    const native = entry.currency === "katanaCredits" && accounting?.providerNativeUnit === "katana_credit" ? Number(accounting.providerNativeAmount) : 0;
    if (!finite(native)) throw new Error("Invalid Katana credit receipt");
    if (!usage || usage.promptTokens === undefined || usage.completionTokens === undefined) {
      // Missing tokens never erase a known provider charge or release the reservation.
      entry.charged = Math.max(entry.charged, entry.currency === "katanaCredits" ? actual / CREDIT_USD : actual, native);
      return;
    }
    if (![usage.promptTokens, usage.completionTokens, usage.reasoningTokens ?? 0].every(finite)) throw new Error("Invalid task usage");
    const usd = (usage.promptTokens * entry.inputRate! + Math.max(usage.completionTokens, usage.reasoningTokens ?? 0) * entry.outputRate!) / 1_000_000;
    let charged = Math.max(usd, actual);
    if (entry.currency === "katanaCredits") {
      charged = Math.max(Math.ceil(charged / CREDIT_USD * 10) / 10 + 0.1, native);
    }
    entry.charged = charged;
    entry.state = "settled";
  });
}

export function withLocalTaskBudget(base: ProviderExecutionHooks, env: NodeJS.ProcessEnv = process.env): ProviderExecutionHooks {
  const path = localTaskBudgetPath(env);
  if (!path) return base;
  return { ...base,
    onReserve: async intent => { await reserve(path, textReservation(intent)); await base.onReserve?.(intent); },
    onTerminal: async record => { const result = await base.onTerminal?.(record); await settleText(path, record); return result; },
  };
}

/** Charge every TTS dispatch, including retries and uncertain responses, in full. */
export async function reserveLocalTaskAudio(id: string, text: string, gameId: string, env: NodeJS.ProcessEnv = process.env) {
  const path = localTaskBudgetPath(env);
  if (!path) return;
  // UTF-8 bytes conservatively cover character billing, including all delivery markup.
  const amount = Buffer.byteLength(text) * 30 / 1_000_000;
  await reserve(path, { id, gameId, catalogId: "xai:tts", currency: "xaiUsd", reserved: amount, charged: amount, state: "reserved" });
}
