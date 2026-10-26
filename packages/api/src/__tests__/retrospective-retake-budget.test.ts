import {expect, test} from "bun:test";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Phase, type ProviderAttemptIntent, type ProviderAttemptRecord} from "@influence/engine";
import {createRetakeCoordinator} from "../scripts/retake-werewolf-retrospective.js";

type LedgerReceipt = {
  limits: {openaiUsd: number};
  entries: Array<{state: string; charged: number; reserved: number}>;
};

async function fixture(run: (input: {
  path: string;
  env: NodeJS.ProcessEnv;
  journal: Array<{intent: ProviderAttemptIntent; terminal?: ProviderAttemptRecord}>;
  save: () => Promise<void>;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "retake-budget-"));
  const path = join(directory, "ledger.json");
  const ledger = {version: 1, allowedGameIds: ["game"], entries: [],
    limits: {openaiUsd: 1, katanaCredits: 0, xaiUsd: 0, metaUsd: 0},
    prior: {openaiUsd: 0, katanaCredits: 0, xaiUsd: 0, metaUsd: 0}};
  const journal: Array<{intent: ProviderAttemptIntent; terminal?: ProviderAttemptRecord}> = [];
  await writeFile(path, JSON.stringify(ledger));
  try {
    await run({path, env: {INFLUENCE_LOCAL_TASK_BUDGET: path}, journal,
      save: () => writeFile(join(directory, "journal.json"), JSON.stringify(journal))});
  } finally {await rm(directory, {recursive: true, force: true});}
}

function call(coordinator: ReturnType<typeof createRetakeCoordinator>, dispatch: () => Promise<string>,
  gameId = "game", providerProfileId: "openai" | "meta-muse" = "openai") {
  const model = providerProfileId === "openai" ? "gpt-6-luna" : "muse-wonder-1.0";
  return coordinator.startCall({gameId, actor: {id: "actor", name: "Actor", role: "player"}, action: "retrospective-retake",
    semantic: {version: 1, kind: "phase_call", phase: Phase.RETROSPECTIVE, round: 0, canonicalEventSequence: 1, callSlot: 1}})
    .execute({maxAttempts: 1, preparedRequest: {transport: "fixture", providerProfileId,
      catalogId: `${providerProfileId}:${model}`, model, body: {input: "fixture", max_output_tokens: 100}},
    dispatch, validate: value => ({status: "usable", value}),
    accounting: () => ({usage: {promptTokens: 100, completionTokens: 10}})});
}

test.each(["unlisted game", "exhausted allowance", "unapproved provider"])("retake blocks %s before dispatch", reason => fixture(async ({path, env, journal, save}) => {
  if (reason === "exhausted allowance") {
    const ledger = JSON.parse(await readFile(path, "utf8")) as LedgerReceipt;
    ledger.limits.openaiUsd = 0;
    await writeFile(path, JSON.stringify(ledger));
  }
  let dispatches = 0;
  const result = call(createRetakeCoordinator(journal, save, env), async () => {dispatches++; return "speech";},
    reason === "unlisted game" ? "outside" : "game", reason === "unapproved provider" ? "meta-muse" : "openai");
  await expect(result).rejects.toThrow(reason === "unlisted game" ? "outside the authorized"
    : reason === "exhausted allowance" ? "allowance exhausted" : "rejects provider");
  expect(dispatches).toBe(0);
  expect(journal).toHaveLength(0);
  expect(JSON.parse(await readFile(path, "utf8")).entries).toHaveLength(0);
}));

test("retake reserves before dispatch and settles only after saving terminal evidence", () => fixture(async ({path, env, journal, save}) => {
  const coordinator = createRetakeCoordinator(journal, async () => {
    const ledger = JSON.parse(await readFile(path, "utf8")) as LedgerReceipt;
    expect(ledger.entries[0]?.state).toBe("reserved");
    await save();
  }, env);
  expect(await call(coordinator, async () => {
    expect(journal).toHaveLength(1);
    expect(journal[0]!.terminal).toBeUndefined();
    expect(JSON.parse(await readFile(path, "utf8")).entries[0].charged).toBeGreaterThan(0);
    return "accepted speech";
  })).toBe("accepted speech");
  const ledger = JSON.parse(await readFile(path, "utf8")) as LedgerReceipt;
  expect(ledger.entries[0]?.state).toBe("settled");
  expect(ledger.entries[0]!.charged).toBeGreaterThan(0);
  expect(ledger.entries[0]!.charged).toBeLessThan(ledger.entries[0]!.reserved);
  expect(journal[0]?.terminal?.acceptedValue).toBe("accepted speech");
}));

test("retake admission evidence failure prevents dispatch and releases only its new hold", () => fixture(async ({path, env, journal}) => {
  let dispatches = 0;
  const coordinator = createRetakeCoordinator(journal, async () => {throw new Error("journal write failed");}, env);
  await expect(call(coordinator, async () => {dispatches++; return "speech";})).rejects.toThrow("journal write failed");
  expect(dispatches).toBe(0);
  expect(JSON.parse(await readFile(path, "utf8")).entries[0]).toMatchObject({state: "not_dispatched", charged: 0});
}));

test("retake terminal evidence failure keeps its full hold after dispatch", () => fixture(async ({path, env, journal, save}) => {
  const coordinator = createRetakeCoordinator(journal, async () => {
    if (journal[0]?.terminal) throw new Error("terminal write failed");
    await save();
  }, env);
  await expect(call(coordinator, async () => "speech")).rejects.toThrow("terminal write failed");
  const ledger = JSON.parse(await readFile(path, "utf8")) as LedgerReceipt;
  expect(ledger.entries[0]?.state).toBe("reserved");
  expect(ledger.entries[0]!.charged).toBe(ledger.entries[0]!.reserved);
}));

test("retake transport uncertainty retains the charged reservation and failure evidence", () => fixture(async ({path, env, journal, save}) => {
  await expect(call(createRetakeCoordinator(journal, save, env), async () => {throw new TypeError("connection lost");})).rejects.toThrow();
  const ledger = JSON.parse(await readFile(path, "utf8")) as LedgerReceipt;
  expect(ledger.entries[0]?.state).toBe("reserved");
  expect(ledger.entries[0]!.charged).toBe(ledger.entries[0]!.reserved);
  expect(journal[0]?.terminal?.outcome.kind).toBe("transport_error");
}));

test("without the opt-in ledger retakes keep their explicit model choice and durable journal", () => fixture(async ({path, journal, save}) => {
  expect(await call(createRetakeCoordinator(journal, save, {}), async () => "speech", "outside", "meta-muse")).toBe("speech");
  expect(journal[0]?.terminal?.acceptedValue).toBe("speech");
  expect(JSON.parse(await readFile(path, "utf8")).entries).toHaveLength(0);
}));
