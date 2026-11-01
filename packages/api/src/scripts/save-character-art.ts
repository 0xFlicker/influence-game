import { convertCharacterArt, assertCharacterArtConverted } from "./convert-character-art.js";
import { parseArgs } from "node:util";
import { runMigrations } from "../db/migrate.js";
import { createDB, closeDB } from "../db/index.js";
import { saveReadyCharacterArt } from "../services/character-art-save.js";

/** Save existing finished images as ordinary character art; no inference. */
async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { env: { type: "string" }, job: { type: "string" }, all: { type: "boolean" }, verify: { type: "boolean" } }, strict: true });
  if (!["local", "production", "staging"].includes(values.env ?? "") || [values.job, values.all, values.verify].filter(Boolean).length !== 1)
    throw new Error("Usage: save-character-art --env local|staging|production (--all | --job ID | --verify)");
  const url = process.env.DATABASE_URL ?? (values.env === "local" ? "postgresql://influence:influence@127.0.0.1:54320/influence_dev" : "");
  if (!url) throw new Error("An explicit database URL is required");
  if (values.env === "local" && !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Local artwork saves require a localhost database");
  if (values.env !== "local" && process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT !== (values.env === "production" ? "prod" : "staging"))
    throw new Error("Deployment environment does not match the selected artwork target");
  const db = createDB(url);
  try {
    if (values.verify) { await assertCharacterArtConverted(db); console.log("Character art conversion verified"); return; }
    await runMigrations(url);
    if (values.all) { console.log(JSON.stringify(await convertCharacterArt(db))); await assertCharacterArtConverted(db); return; }
    console.log(JSON.stringify({ jobId: values.job!, ...await saveReadyCharacterArt(db, values.job!) }));
  } finally { await closeDB(url); }
}

if (import.meta.main) await main();
