import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadHouseCutSource } from "../services/house-cut-source.js";
import { closeDB, createDB } from "../db/index.js";
import { CUT_TRIAL_LIMITS, createCutTrialRuntimes, newCutTrialJournal, runCutTrial, cutTrialSpend, type CutTrialJournal } from "@influence/engine/house-cuts/trial";
import { planCutDiscovery } from "@influence/engine/house-cuts/editorial";
import { renderCutReview } from "@influence/engine/house-cuts/review-html";

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  game: { type: "string" }, audience: { type: "string" }, run: { type: "boolean", default: false },
  "budget-usd": { type: "string" }, output: { type: "string" }, origin: { type: "string", default: "http://localhost:3001" },
} });
if (!values.game || !["public", "mystery", "omniscient"].includes(values.audience ?? "")) throw new Error("Usage: --game SLUG --audience public|mystery|omniscient [--run --budget-usd N] [--output DIR] [--origin URL]");
const audience = values.audience as "public" | "mystery" | "omniscient";
const directory = resolve(values.output ?? `.renders/house-cuts/${encodeURIComponent(values.game)}/${audience}`);
const source = await loadHouseCutSource(createDB(), values.game, audience).finally(() => closeDB());
const plan = planCutDiscovery(source, CUT_TRIAL_LIMITS);
console.log(JSON.stringify({ game: source.game, audience, coverage: plan.coverage, calls: plan.windows.length }));
await mkdir(directory, { recursive: true });
if (!values.run) {
  await writeFile(resolve(directory, "source.json"), JSON.stringify(source, null, 2));
  console.log("Preflight only. No provider calls. Add --run and an explicitly approved --budget-usd to generate draft Cuts.");
} else {
  const budget = Number(values["budget-usd"]);
  const initial = newCutTrialJournal(source, budget);
  const lockPath = resolve(directory, "run.lock");
  const lock = await open(lockPath, "wx"); // Concurrent trials must never share a budget/journal.
  try {
    await lock.writeFile(String(process.pid));
    const journalPath = resolve(directory, "journal.json");
    let journal = initial;
    try { journal = JSON.parse(await readFile(journalPath, "utf8")) as CutTrialJournal; }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    if (journal.budgetUsd !== budget) throw new Error("Saved trial budget differs; use the originally approved budget");
    const save = async (value: CutTrialJournal) => {
      await writeFile(`${journalPath}.tmp`, JSON.stringify(value, null, 2));
      await rename(`${journalPath}.tmp`, journalPath);
    };
    await save(journal);
    await writeFile(resolve(directory, "source.json"), JSON.stringify(source, null, 2));
    const report = await runCutTrial({ source, journal, runtimes: createCutTrialRuntimes(), save, progress: console.log });
    await writeFile(resolve(directory, "review.json"), JSON.stringify({ report, selectedKeys: [], approval: "pending" }, null, 2));
    await writeFile(resolve(directory, "index.html"), renderCutReview([report], [[]], undefined, { showAllCandidates: true, replayOrigin: values.origin }));
    console.log(JSON.stringify({ review: resolve(directory, "index.html"), candidates: report.candidates.length,
      attempts: journal.attempts.length, accountedUsd: cutTrialSpend(journal), unknownCostAttempts: journal.attempts.filter(a => a.estimatedCostUsd == null).length,
      publication: "none; human review pending" }));
  } finally { await lock.close(); await unlink(lockPath); }
}
