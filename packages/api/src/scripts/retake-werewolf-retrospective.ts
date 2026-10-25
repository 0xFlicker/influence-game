import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {resolve, join, dirname} from "node:path";
import {eq, or} from "drizzle-orm";
import {createLlmProviderRuntimesFromEnv, executeModelInvocation, prepareRetrospectiveInvocation, ProviderExecutionCoordinator, withLocalTaskBudget, Phase,
  type ProviderAttemptIntent, type ProviderAttemptRecord} from "@influence/engine";
import {resolveProviderManifest} from "@influence/engine/model-catalog";
import {resolveCliApiSession} from "@influence/engine/cli-api-session";
import {closeDB, createDB, schema} from "../db/index.js";
import {prepareRetrospectiveRetake, queueRetrospectiveRetake, type RetrospectiveRetakeDocument} from "../services/retrospective-retakes.js";
import {retryAudioTrack, runAudioTrack} from "../services/audio-tracks.js";

/** Keep editorial evidence durable while honoring an operator's optional shared spending ceiling. */
export function createRetakeCoordinator(
  journal: Array<{intent: ProviderAttemptIntent; terminal?: ProviderAttemptRecord}>,
  save: () => Promise<void>,
  env: NodeJS.ProcessEnv = process.env,
) {
  return new ProviderExecutionCoordinator({hooks: withLocalTaskBudget({
    async onReserve(intent) {journal.push({intent}); await save();},
    async onTerminal(record) {
      const attempt = journal.find(attempt => attempt.intent.attemptId === record.attemptId);
      if (!attempt) throw new Error("Unreserved retake attempt");
      attempt.terminal = record; await save();
      return {acceptedAttemptId: record.acceptedValue === undefined ? undefined : record.attemptId};
    },
  }, env)});
}

/** Explicit local operator command. No application-startup or scheduled generation. */
async function main() {
  const [mode, game, actor, catalogOrDirectory, destination, ...extra] = process.argv.slice(2);
  if (!mode || !["preview", "generate", "queue", "run"].includes(mode) || !game || extra.length
    || mode === "preview" && (!actor || catalogOrDirectory || destination)
    || mode === "generate" && (!actor || !catalogOrDirectory || !destination)
    || mode === "queue" && (!actor || catalogOrDirectory || destination)
    || mode === "run" && (actor || catalogOrDirectory || destination)) {
    throw new Error("Usage: preview GAME ACTOR | generate GAME ACTOR CATALOG_ID NEW_DIRECTORY | queue GAME DIRECTORY | run TRACK_ID");
  }
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)) throw new Error("This operator command requires an explicit localhost DATABASE_URL");
  const db = createDB();
  try {
    const token = await resolveCliApiSession({apiOrigin: "http://127.0.0.1:3000", webOrigin: "http://localhost:3001", requiredRoles: ["producer", "sysop"]});
    const auth = await fetch("http://127.0.0.1:3000/api/auth/me", {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(10000)});
    if (!auth.ok) throw new Error("Local operator session is unavailable");
    const user = await auth.json() as {id?: string; user?: {id?: string}; roles?: string[]};
    const userId = user.id ?? user.user?.id;
    if (!userId || !user.roles?.some(role => role === "producer" || role === "sysop")) throw new Error("Current Producer/Sysop session required");
    if (mode === "run") {
      const [retake] = await db.select().from(schema.productionRetrospectiveRetakes).where(eq(schema.productionRetrospectiveRetakes.trackId, game));
      if (!retake) throw new Error("Expected a retrospective retake track");
      const [pending] = await db.select().from(schema.gameAudioTracks).where(eq(schema.gameAudioTracks.id, game));
      if (pending?.status === "failed") await retryAudioTrack(db, retake.gameId, game);
      await runAudioTrack(db, undefined, undefined, game);
      const [track] = await db.select().from(schema.gameAudioTracks).where(eq(schema.gameAudioTracks.id, game));
      console.log(JSON.stringify({trackId: game, status: track?.status, error: track?.error}));
      if (track?.status !== "ready") process.exitCode = 1;
      return;
    }
    const [entry] = await db.select().from(schema.games).where(or(eq(schema.games.id, game), eq(schema.games.slug, game)));
    if (!entry) throw new Error("Game not found");
    if (mode === "queue") {
      const directory = resolve(actor!);
      const saved = JSON.parse(await readFile(join(directory, "source.json"), "utf8")) as {gameId: string; actorId: string; previewHash: string};
      const document = JSON.parse(await readFile(join(directory, "retake.json"), "utf8")) as RetrospectiveRetakeDocument;
      if (saved.gameId !== entry.id) throw new Error("Retake belongs to a different game");
      const receipt = await queueRetrospectiveRetake(db, {...saved, document, userId});
      await writeFile(join(directory, "queue-receipt.json"), JSON.stringify(receipt, null, 2), {flag: "wx", mode: 0o600});
      console.log(JSON.stringify(receipt));
      return;
    }
    const state = await prepareRetrospectiveRetake(db, entry.id, actor!);
    if (mode === "preview") {
      console.log(JSON.stringify({gameId: state.gameId, actorId: state.actorId, name: state.context.self.name, original: state.original.payload.speech,
        originalEventSequence: state.original.sequence, predecessorTrackId: state.track.id, previewHash: state.previewHash}));
      return;
    }
    const runtimes = createLlmProviderRuntimesFromEnv(resolveProviderManifest([{catalogId: catalogOrDirectory!, reasoningPolicy: "action-policy"}]), process.env, {timeout: 120000, maxRetries: 0});
    if (!runtimes?.length) throw new Error("Requested model is unavailable");
    const directory = resolve(destination!);
    await mkdir(dirname(directory), {recursive: true});
    await mkdir(directory, {mode: 0o700}); // Never reuse a generation directory or repeat an ambiguous paid call.
    await writeFile(join(directory, "source.json"), JSON.stringify({gameId: state.gameId, actorId: state.actorId, previewHash: state.previewHash,
      original: state.original, context: state.context}, null, 2), {flag: "wx", mode: 0o600});
    const journal: Array<{intent: ProviderAttemptIntent; terminal?: ProviderAttemptRecord}> = [];
    const save = async () => {
      await writeFile(join(directory, "journal.tmp"), JSON.stringify(journal, null, 2), {mode: 0o600});
      await rename(join(directory, "journal.tmp"), join(directory, "journal.json"));
    };
    await save();
    const coordinator = createRetakeCoordinator(journal, save);
    const prepared = prepareRetrospectiveInvocation(state.context, runtimes);
    const result = await executeModelInvocation({
      call: coordinator.startCall({gameId: entry.id, actor: {id: state.actorId, name: state.context.self.name, role: "player"}, action: "retrospective-retake",
        semantic: {version: 1, kind: "phase_call", phase: Phase.RETROSPECTIVE, round: 0, canonicalEventSequence: state.original.sequence, callSlot: 1}}),
      runtimes, invocation: {...prepared.invocation, messages: [...prepared.invocation.messages, {role: "system", content: "Record a fresh English-language take of your final statement from the frozen account above. This is an editorial retake after the episode ended. Your original character, knowledge boundaries and the canonical outcome are unchanged. Do not mention this recording instruction in the speech."}]},
      maxAttempts: 2, requestSignalFactory: () => AbortSignal.timeout(120000),
      validate: (_outcome, value) => value ? {status: "usable", value} : {status: "unusable", kind: "undecodable_structured_output", message: "Missing retrospective statement"},
    });
    const document: RetrospectiveRetakeDocument = {version: 1, context: state.context, catalogId: catalogOrDirectory!, speech: result.value.speech, evidence: journal};
    await writeFile(join(directory, "retake.json"), JSON.stringify(document, null, 2), {flag: "wx", mode: 0o600});
    console.log(JSON.stringify({directory, speech: document.speech, attempts: journal.length}));
  } finally {await closeDB();}
}
if (import.meta.main) await main();
