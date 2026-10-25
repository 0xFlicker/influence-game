import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveLocalTaskAudio, withLocalTaskBudget, type LocalTaskLedger } from "../local-task-budget";
import type { ProviderAttemptIntent } from "../provider-execution";

async function fixture(run: (path: string, env: NodeJS.ProcessEnv) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "local-task-budget-")), path = join(dir, "ledger.json");
  const ledger: LocalTaskLedger = { version: 1, limits: { openaiUsd: 15, katanaCredits: 10000, xaiUsd: 15 }, prior: { openaiUsd: 0, katanaCredits: 0, xaiUsd: 0 }, allowedGameIds: ["g"], entries: [] };
  await writeFile(path, JSON.stringify(ledger));
  try { await run(path, { INFLUENCE_LOCAL_TASK_BUDGET: path }); } finally { await rm(dir, { recursive: true, force: true }); }
}
function intent(id: string, catalogId = "openai:gpt-6.1-sol"): ProviderAttemptIntent {
  return { attemptId: id, attemptOrdinal: 1, startedAt: new Date().toISOString(),
    coordinate: { gameId: "g", ownerEpoch: "e", actor: { id: "p", name: "P", role: "player" }, action: "werewolf.discuss", round: 1,
      semantic: { version: 1, kind: "werewolf_action", eventSequence: 1 } },
    preparedRequest: { transport: "openai.responses", providerProfileId: "openai", catalogId, model: catalogId.split(":")[1]!, body: { input: "hello", max_output_tokens: 8192 } } };
}
test("all eight cast models reserve into one ledger with separate currencies", () => fixture(async (path,env) => {
  const hooks = withLocalTaskBudget({},env);
  for(const [i,id] of ["openai:gpt-6.1-sol","katana:claude-sonnet-4-6","katana:claude-haiku-4-5","katana:gemini-3-1-pro-preview","katana:glm-5-3-flash-private","katana:kimi-k3","katana:deepseek-v4-flash","katana:grok-4-6"].entries()) await hooks.onReserve!(intent(String(i),id));
  const ledger = JSON.parse(await readFile(path,"utf8")) as LocalTaskLedger;
  expect(ledger.entries).toHaveLength(8);
  expect(ledger.entries.filter(e=>e.currency === "katanaCredits")).toHaveLength(7);
}));
test("blocks unapproved games and unknown models before underlying journal", () => fixture(async (_path,env) => {
  let calls = 0; const hooks = withLocalTaskBudget({onReserve:()=>{calls++;}},env);
  const other = intent("other"); other.coordinate.gameId = "outside";
  await expect(hooks.onReserve!(other)).rejects.toThrow("outside");
  await expect(hooks.onReserve!(intent("unknown","openai:unknown"))).rejects.toThrow("unpriced");
  await expect(hooks.onReserve!(intent("meta","meta-muse:muse-spark-1.3-contributor"))).rejects.toThrow("rejects provider");
  expect(calls).toBe(0);
}));
test("audio retries and parallel reservations cannot exceed shared allowance", () => fixture(async(path,env)=>{
  const results=await Promise.allSettled([reserveLocalTaskAudio("a","a".repeat(300000),"g",env),reserveLocalTaskAudio("b","a".repeat(300000),"g",env)]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  const ledger=JSON.parse(await readFile(path,"utf8")) as LocalTaskLedger;
  expect(ledger.entries[0]!.charged).toBe(9);
}));
test("audio cannot spend for unrelated queued games", () => fixture(async(_path,env)=>{
  await expect(reserveLocalTaskAudio("old-track", "hello", "unrelated", env)).rejects.toThrow("outside");
}));
test("failed evidence persistence retains the entire reservation", () => fixture(async(path,env)=>{
  const hooks=withLocalTaskBudget({onTerminal:()=>{throw Error("storage failed");}},env), request=intent("a");
  await hooks.onReserve!(request);
  await expect(hooks.onTerminal!({...request,completedAt:new Date().toISOString(),latencyMs:1,outcome:{kind:"usable"},disposition:"accepted",accounting:{usage:{promptTokens:5,completionTokens:10}}})).rejects.toThrow("storage failed");
  expect(JSON.parse(await readFile(path,"utf8")).entries[0].state).toBe("reserved");
}));
test("incomplete usage retains larger native charges", () => fixture(async(path,env)=>{
  const hooks=withLocalTaskBudget({},env),request=intent("native","katana:deepseek-v4-flash");
  await hooks.onReserve!(request);
  await hooks.onTerminal!({...request,completedAt:new Date().toISOString(),latencyMs:1,outcome:{kind:"usable"},disposition:"accepted",accounting:{usage:{},actualCostMicrousd:520000,providerNativeUnit:"katana_credit",providerNativeAmount:"100"}});
  const entry=JSON.parse(await readFile(path,"utf8")).entries[0];
  expect(entry.charged).toBeGreaterThanOrEqual(100);
  expect(entry.state).toBe("reserved");
}));
