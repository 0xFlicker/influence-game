/** Opt-in paid render probe. Retains local DB/bucket evidence and a private filesystem export. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDB, closeDB, schema } from "../db/index.js";
import { HOUSE_CAST } from "@influence/engine/house-personas";
import { HOUSE_BODY_ART } from "@influence/engine/house-character-art";
import { planWerewolfScene } from "../services/werewolf-scene-plan.js";
import { resolveCharacterVariants } from "../services/visual-character-variants.js";
import type { WerewolfScenePurpose } from "@influence/engine/werewolf/visual-scenes";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
import { VISUAL_HOUSE_STYLE, VISUAL_ROOMS } from "@influence/engine/visual-mode";
import { prepareVisualScene, storeVisualArtifact, readVisualArtifact } from "../services/visual-scene-store.js";
import { renderVisualSceneBestEffort } from "../services/visual-best-effort.js";
import { readVisualRenderAccounting, renderDurableVisualImage } from "../services/visual-render-journal.js";

const purpose = process.argv[3]?.startsWith("werewolf-") ? process.argv[3].slice(9) as WerewolfScenePurpose : null;
if (purpose && !["village", "pack", "hunt"].includes(purpose)) throw new Error("Invalid Werewolf scene purpose");
const size = Number(process.argv[2]);
const directory = process.env.VISUAL_PROBE_DIRECTORY;
const allowedSizes = purpose ? { village: [8], pack: [2], hunt: [3] }[purpose] : [9, 10, 12, 14];
if (!allowedSizes.includes(size) || !directory || process.env.VISUAL_PROBE_AUTHORIZED !== "15") throw new Error("Set VISUAL_PROBE_AUTHORIZED=15 and VISUAL_PROBE_DIRECTORY, then pass 9/10/12/14, or 8 werewolf-village, 2 werewolf-pack, 3 werewolf-hunt");
for (const value of [process.env.DATABASE_URL, process.env.LINODE_PRIVATE_CONTENT_ENDPOINT]) {
  if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname)) throw new Error("Probe requires localhost DB and object storage");
}
await mkdir(directory, { recursive: true, mode: 0o700 });
const ledgerPath = resolve(directory, "budget.json");
let reserved = 0;
try { reserved = JSON.parse(await readFile(ledgerPath, "utf8")).reservedUsd; }
catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
if (!Number.isFinite(reserved) || reserved < 0) throw new Error("Invalid probe budget ledger");
const previousReserved = reserved;
const id = randomUUID(), out = resolve(directory, `${purpose ?? size}-${id}`);
await mkdir(out, { mode: 0o700 });
const nativeFetch = globalThis.fetch;
let requestNumber = 0;
globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
  const address = String(url);
  if (!address.startsWith("https://api.openai.com/v1/")) {
    if (address.includes("api.x.ai")) throw new Error("Probe authorizes OpenAI only");
    return nativeFetch(url, init);
  }
  // Conservative ceilings for the fixed medium image size and 5,000-token verifier.
  const ceiling = address.includes("/images/") ? 1 : .25;
  if (reserved + ceiling > 15) throw new Error("Probe budget exhausted before provider dispatch");
  reserved += ceiling;
  await writeFile(ledgerPath, JSON.stringify({ budgetUsd: 15, reservedUsd: reserved }), { mode: 0o600 });
  const prefix = resolve(out, `request-${++requestNumber}`);
  if (init?.body instanceof FormData) {
    const fields: Record<string, unknown> = {};
    let index = 0;
    for (const [key, entry] of init.body.entries()) {
      const value: unknown = entry;
      if (typeof value === "string") fields[key] = value;
      else if (value instanceof Blob) {
        const bytes = Buffer.from(await value.arrayBuffer()), file = `${prefix}-reference-${index++}.png`;
        await writeFile(file, bytes, { mode: 0o600 });
        fields[`reference-${index}`] = { file, sha256: createHash("sha256").update(bytes).digest("hex") };
      } else throw new Error("Unexpected multipart field");
    }
    await writeFile(`${prefix}.json`, JSON.stringify({ url: address, fields }), { mode: 0o600 });
  } else await writeFile(`${prefix}.json`, String(init?.body), { mode: 0o600 });
  const response = await nativeFetch(url, init);
  await writeFile(`${prefix}-response.json`, await response.clone().text(), { mode: 0o600 });
  return response;
}, { preconnect: nativeFetch.preconnect });
const db = createDB();
try {
  const slug = `panorama-probe-${purpose ?? size}-${id.slice(0, 8)}`;
  await db.insert(schema.games).values({ id, slug, gameKind: purpose ? "werewolf" : "influence", status: "waiting", config: JSON.stringify({ visualMode: true, visualFailurePolicy: "require_visuals" }) });
  await writeFile(resolve(out, "game.json"), JSON.stringify({ id, slug, size, purpose }), { mode: 0o600 });
  const publicRoot = resolve(import.meta.dir, "../../../web/public");
  const room = VISUAL_ROOMS.lobby;
  const background = process.argv[3] === "fresh-room" ? (await renderDurableVisualImage(db, {
    gameId: id, operationKey: `background:${room.id}:v${room.version}`, allowFallback: false,
    request: { operation: "create", background: "opaque", width: 1536, height: 864, references: [], prompt: `${VISUAL_HOUSE_STYLE}. Empty setting: ${room.name}. ${room.direction}. Wide room view, no people, no text. Preserve uncluttered conversational furniture sections with generous headroom: ${JSON.stringify(room.sections)}. This is a lived-in social strategy game house, not a clinical studio.` },
  })).image : await readFile(resolve(publicRoot, "visual/influence/rooms-v1/lobby.jpg"));
  const backgroundArtifactId = await storeVisualArtifact(db, id, background);
  await writeFile(resolve(out, "background.png"), await readVisualArtifact(db, id, backgroundArtifactId));
  const cast = await Promise.all(HOUSE_CAST.slice(0, size).map(async member => {
    const art = HOUSE_BODY_ART[member.personality];
    const bytes = await readFile(resolve(publicRoot, art.url.slice(1)));
    if (createHash("sha256").update(bytes).digest("hex") !== art.sha256) throw new Error("Reference hash mismatch");
    return { id: member.personality, name: member.name, referenceArtifactId: await storeVisualArtifact(db, id, bytes), performanceInstructions: "Natural attentive conversational posture" };
  }));
  const plan = purpose ? await resolveCharacterVariants(db, id, await planWerewolfScene(db, id, {
    purpose, roomId: purpose === "village" ? "lobby" : purpose === "pack" ? "mingle-1" : "mingle-2",
    boundarySequence: 0, day: 1, participantIds: cast.map(m => m.id),
    wolfIds: purpose === "village" ? [] : cast.slice(0, 2).map(m => m.id), targetId: purpose === "hunt" ? cast[2]!.id : null,
  }, cast)) : planVisualScene({ roomId: "lobby", backgroundArtifactId, cast });
  if (purpose) await writeFile(resolve(out, "background.png"), await readVisualArtifact(db, id, plan.backgroundArtifactId!));
  const scene = await prepareVisualScene(db, { gameId: id, boundarySequence: 0, plan });
  // One render per probe; a failed identity test must not spend on an identical retry.
  await db.update(schema.visualScenes).set({ repairBudgetUsed: true }).where(eq(schema.visualScenes.id, scene.id));
  const started = Date.now();
  const ready = await renderVisualSceneBestEffort(db, scene, async () => {}, undefined, false);
  const accounting = await readVisualRenderAccounting(db, id);
  await writeFile(resolve(out, "result.json"), JSON.stringify({ ready, elapsedMs: Date.now() - started, accounting }, null, 2), { mode: 0o600 });
  if (!accounting.unpricedAttempts && !accounting.pendingAttempts && !accounting.uncertainAttempts) {
    reserved = previousReserved + accounting.knownCostMicrousd / 1_000_000;
    await writeFile(ledgerPath, JSON.stringify({ budgetUsd: 15, reservedUsd: reserved, lastSettledGame: id }), { mode: 0o600 });
  }
  if (ready?.shots?.overview) await writeFile(resolve(out, "overview.png"), await readVisualArtifact(db, id, ready.shots.overview.imageArtifactId));
  for (const [index, shot] of (ready?.shots?.groups ?? []).entries()) await writeFile(resolve(out, `crop-${index + 1}.png`), await readVisualArtifact(db, id, shot.imageArtifactId));
  console.log(JSON.stringify({ gameId: id, directory: out, ready: !!ready, groups: ready?.shots?.groups.length, costMicrousd: accounting.knownCostMicrousd, reservedUsd: reserved }));
} finally { globalThis.fetch = nativeFetch; await closeDB(); }
