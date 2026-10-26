import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveLocalTaskAudio, withLocalTaskBudget, updateLocalTaskLedger, type LocalTaskLedger } from "../local-task-budget";
import type { ProviderAttemptIntent } from "../provider-execution";
import { ProviderCircuitOpenError, ProviderCallBudgetExhaustedError, ProviderJournalEntryExhaustedError } from "../provider-execution";

async function fixture(run: (path: string, env: NodeJS.ProcessEnv) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "local-task-budget-")), path = join(dir, "ledger.json");
  const ledger: LocalTaskLedger = { version: 1, limits: { openaiUsd: 15, katanaCredits: 10000, xaiUsd: 15, metaUsd: 0, anthropicUsd: 0 }, prior: { openaiUsd: 0, katanaCredits: 0, xaiUsd: 0, metaUsd: 0, anthropicUsd: 0 }, allowedGameIds: ["g"], entries: [] };
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
  await expect(hooks.onReserve!(intent("xai","xai:grok-4.3"))).rejects.toThrow("total reasoning-token spending bound");
  await expect(hooks.onReserve!(intent("meta","meta-muse:muse-spark-1.3-contributor"))).rejects.toThrow("allowance exhausted");
  await expect(hooks.onReserve!(intent("other-meta","meta-muse:muse-wonder-1.0"))).rejects.toThrow("rejects provider");
  expect(calls).toBe(0);
}));
test("authorized Meta contributor spends only its separate bounded allocation", () => fixture(async(path,env)=>{
  const ledger=JSON.parse(await readFile(path,"utf8")) as LocalTaskLedger;
  ledger.limits.metaUsd=0.02;
  await writeFile(path,JSON.stringify(ledger));
  const hooks=withLocalTaskBudget({},env);
  await hooks.onReserve!(intent("meta","meta-muse:muse-spark-1.3-contributor"));
  const updated=JSON.parse(await readFile(path,"utf8")) as LocalTaskLedger;
  expect(updated.entries[0]!.currency).toBe("metaUsd");
  expect(updated.entries[0]!.charged).toBeLessThan(0.02);
  const large=intent("large","meta-muse:muse-spark-1.3-contributor");
  (large.preparedRequest.body as Record<string,unknown>).max_output_tokens=100_000;
  await expect(hooks.onReserve!(large)).rejects.toThrow("metaUsd allowance exhausted");
}));
test("audio retries and parallel reservations cannot exceed shared allowance", () => fixture(async(path,env)=>{
  const results=await Promise.allSettled([reserveLocalTaskAudio("a","a".repeat(300000),"g",env),reserveLocalTaskAudio("b","a".repeat(300000),"g",env)]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  const ledger=JSON.parse(await readFile(path,"utf8")) as LocalTaskLedger;
  expect(ledger.entries[0]!.charged).toBe(9);
}));

test("Anthropic reserves the higher prompt tier and cannot exceed its separate $5 ceiling", () => fixture(async (path, env) => {
  await updateLocalTaskLedger(path, ledger => { ledger.limits.anthropicUsd = 5; ledger.limits.openaiUsd = 0; });
  const hooks = withLocalTaskBudget({}, env);
  const request = intent("haiku", "anthropic:claude-haiku-5-5");
  request.preparedRequest.body = { messages: [{ role: "user", content: "hi" }], max_tokens: 8192 };
  await hooks.onReserve!(request);
  let ledger = JSON.parse(await readFile(path, "utf8")) as LocalTaskLedger;
  expect(ledger.entries[0]).toMatchObject({ currency: "anthropicUsd", inputRate: 1.25, outputRate: 5 });
  await hooks.onTerminal!({ ...request, completedAt: new Date().toISOString(), latencyMs: 1, outcome: {kind: "usable"}, disposition: "accepted",
    accounting: {usage: {promptTokens: 1000, completionTokens: 100, reasoningTokens: 90}} });
  ledger = JSON.parse(await readFile(path, "utf8")) as LocalTaskLedger;
  expect(ledger.entries[0]!.charged).toBeCloseTo(0.00175);
  const huge = intent("huge", "anthropic:claude-haiku-5-5");
  huge.preparedRequest.body = { max_tokens: 1_000_000 };
  await expect(hooks.onReserve!(huge)).rejects.toThrow("anthropicUsd allowance exhausted");
  await expect(hooks.onReserve!(intent("openai"))).rejects.toThrow("openaiUsd allowance exhausted");
}));
test("audio cannot spend for unrelated queued games", () => fixture(async(_path,env)=>{
  await expect(reserveLocalTaskAudio("old-track", "hello", "unrelated", env)).rejects.toThrow("outside");
}));
test("per-game audio allocations preserve the other game's budget", () => fixture(async(path,env)=>{
  await updateLocalTaskLedger(path,ledger=>{ledger.perGameLimits={g:{xaiUsd:0.001}};});
  await expect(reserveLocalTaskAudio("too-large","hello ".repeat(20),"g",env)).rejects.toThrow("Local game xaiUsd allowance exhausted");
  expect(JSON.parse(await readFile(path,"utf8")).entries).toHaveLength(0);
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

test("definitively rejected journal admissions retain zero-charge receipts", () => fixture(async (path, env) => {
  for (const [index, error] of [
    new ProviderCircuitOpenError("openai:gpt-6-luna", "entry:openai:gpt-6-luna", 1, false),
    new ProviderCallBudgetExhaustedError("openai:gpt-6-luna", 2, 2),
    new ProviderJournalEntryExhaustedError("openai:gpt-6-luna"),
  ].entries()) {
    const hooks = withLocalTaskBudget({ onReserve: () => { throw error; } }, env);
    await expect(hooks.onReserve!(intent(`rejected-${index}`))).rejects.toBe(error);
  }
  const ledger = JSON.parse(await readFile(path, "utf8")) as LocalTaskLedger;
  expect(ledger.entries).toHaveLength(3);
  expect(ledger.entries.every(entry => entry.state === "not_dispatched" && entry.charged === 0 && entry.reserved > 0)).toBe(true);
  // A retry must receive a new reservation; the zero-charge receipt cannot be reused.
  await expect(withLocalTaskBudget({}, env).onReserve!(intent("rejected-0"))).rejects.toThrow("new attempt ID");
}));

test("a rejected duplicate admission never refunds an uncertain prior dispatch", () => fixture(async (path, env) => {
  const request = intent("uncertain");
  await withLocalTaskBudget({}, env).onReserve!(request);
  const before = JSON.parse(await readFile(path, "utf8")) as LocalTaskLedger;
  const hooks = withLocalTaskBudget({ onReserve: () => { throw new Error("owner changed"); } }, env);
  await expect(hooks.onReserve!(request)).rejects.toThrow("owner changed");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(before);
}));

const budgetModule = new URL("../local-task-budget.ts", import.meta.url).pathname;

test("independent processes serialize reservations without losing updates or exceeding the allowance", () => fixture(async (path) => {
  await updateLocalTaskLedger(path, ledger => { ledger.limits.xaiUsd = 1; });
  const script = `
    import { reserveLocalTaskAudio, updateLocalTaskLedger } from ${JSON.stringify(budgetModule)};
    const [path, id] = process.argv.slice(1);
    await updateLocalTaskLedger(path, () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); });
    try { await reserveLocalTaskAudio(id, 'a'.repeat(10000), 'g', { INFLUENCE_LOCAL_TASK_BUDGET: path }); console.log('reserved'); }
    catch (error) { if (!error.message.includes('allowance exhausted')) throw error; console.log('exhausted'); }
  `;
  const children = Array.from({ length: 5 }, (_, i) => Bun.spawn([process.execPath, "-e", script, path, `process-${i}`], { stdout: "pipe", stderr: "pipe" }));
  try {
    const results = await Promise.all(children.map(async child => ({
      output: (await new Response(child.stdout).text()).trim(), stderr: await new Response(child.stderr).text(), exit: await child.exited,
    })));
    expect(results.every(result => result.exit === 0 && result.stderr === "")).toBe(true);
    expect(results.filter(result => result.output === "reserved")).toHaveLength(3);
    expect(results.filter(result => result.output === "exhausted")).toHaveLength(2);
    const ledger = JSON.parse(await readFile(path, "utf8")) as LocalTaskLedger;
    expect(ledger.entries).toHaveLength(3);
    expect(ledger.entries.reduce((total, entry) => total + entry.charged, 0)).toBeCloseTo(0.9);
  } finally { for (const child of children) child.kill(); await Promise.all(children.map(child => child.exited)); }
}), 15_000);

test("crashed lock owners recover without releasing uncertain charge reservations", () => fixture(async (path, env) => {
  await reserveLocalTaskAudio("uncertain-audio", "hello", "g", env);
  const before = JSON.parse(await readFile(path, "utf8")) as LocalTaskLedger;
  const script = `
    import { writeSync } from 'node:fs';
    import { updateLocalTaskLedger } from ${JSON.stringify(budgetModule)};
    await updateLocalTaskLedger(process.argv[1], () => { writeSync(1, 'locked'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000); });
  `;
  const child = Bun.spawn([process.execPath, "-e", script, path], { stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader();
    const message = await reader.read();
    expect(new TextDecoder().decode(message.value)).toBe("locked");
    reader.releaseLock();
    child.kill("SIGKILL");
    await child.exited;
    // Advance only the dead lock's age, avoiding a ten-second test sleep.
    const expired = new Date(Date.now() - 11_000);
    await utimes(`${path}.lock`, expired, expired);
    await reserveLocalTaskAudio("after-crash", "hello", "g", env);
    const ledger = JSON.parse(await readFile(path, "utf8")) as LocalTaskLedger;
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries[0]).toEqual(before.entries[0]);
    expect(ledger.entries.every(entry => entry.state === "reserved" && entry.charged > 0)).toBe(true);
  } finally { child.kill(); await child.exited; }
}), 15_000);
