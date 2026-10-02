#!/usr/bin/env bun
/**
 * Launch/watch API-backed Werewolf and render a text report without extra model calls.
 * Defaults to a six-player match with a ten-day safety cap and a saved live report.
 * Original contributions print as accepted. --transcript adds production notes
 * and turn coordinates. Openings select up to three ordered recipients.
 * No House rewrite or separate should-speak calls; readback adds no inference.
 * Omniscient labels every speaker with their role; Mystery hides dialogue roles.
 * Omniscient also reports each resolved pack ballot and disagreement/no-attack outcome.
 * The API owns inference, durable events and role secrecy.
 * Sealed daytime ballots run concurrently. The API reporter shows accepted-decision
 * counts as live spectator telemetry, separate from public history and player context.
 * Choices and private reasoning stay sealed until the full checkpoint resolves.
 * No `as any`, Influence House calls, or prose parsing.
 */
import { parseArgs } from "node:util";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { apiFetch, authHeaders, resolveSessionToken } from "../api-simulation-client";
import { DEFAULT_MODEL_CATALOG_ID, normalizeProviderManifest, resolveProviderManifest } from "../model-catalog";
import { requireSafeHttpBaseUrl } from "../game-mcp/oauth";
import { WEREWOLF_PRESETS, werewolfConfig } from "./rules";
import type { WerewolfAudience, WerewolfView, WerewolfVoteProgress } from "./observation";
import { werewolfReportEntry } from "./report";

export function parseWerewolfApiArgs(argv: string[], env: Record<string, string | undefined> = process.env) {
  const { values } = parseArgs({ args: argv, options: {
    "api-url": { type: "string", default: env.INFLUENCE_API_BASE_URL ?? "http://127.0.0.1:3000" },
    "web-url": { type: "string", default: "http://localhost:3001" },
    preset: { type: "string", default: "one_wolf" }, "max-days": { type: "string", default: "10" },
    "model-catalog": { type: "string", default: DEFAULT_MODEL_CATALOG_ID },
    "reasoning-policy": { type: "string", default: "low" },
    agent: { type: "string", multiple: true, default: [] },
    game: { type: "string" }, audience: { type: "string", default: "mystery" },
    transcript: { type: "boolean", default: false }, out: { type: "string" },
    "timeout-seconds": { type: "string", default: "1800" }, help: { type: "boolean", short: "h" },
  } });
  const apiUrl = requireSafeHttpBaseUrl(values["api-url"], "--api-url");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(apiUrl.hostname)) throw new Error("This local CLI requires a loopback --api-url.");
  const webUrl = requireSafeHttpBaseUrl(values["web-url"], "--web-url");
  if (values.preset !== "one_wolf" && values.preset !== "two_wolves") throw new Error("Choose --preset one_wolf or two_wolves");
  const config = werewolfConfig(values.preset, Number(values["max-days"]));
  if (values.agent.length > WEREWOLF_PRESETS[config.preset].players || values.agent.some(id => !id.trim()) || new Set(values.agent).size !== values.agent.length) throw new Error("Choose distinct --agent profile IDs within the preset's seat limit.");
  if (values.audience !== "mystery" && values.audience !== "omniscient") throw new Error("Choose --audience mystery or omniscient");
  if (values.game !== undefined && !values.game.trim()) throw new Error("--game requires an ID or slug");
  const timeoutMs = Number(values["timeout-seconds"]) * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) throw new Error("--timeout-seconds must be a positive number of at least one second");
  const providerManifest = normalizeProviderManifest([{ catalogId: values["model-catalog"], reasoningPolicy: values["reasoning-policy"] }]);
  resolveProviderManifest(providerManifest);
  return { apiUrl: apiUrl.origin, webUrl: webUrl.origin, preset: config.preset, maxDays: config.maxDays,
    agentProfileIds: values.agent, providerManifest, game: values.game, audience: values.audience as WerewolfAudience,
    transcript: values.transcript, out: values.out, timeoutMs, help: Boolean(values.help) };
}

interface ApiView { slug: string; status: string; view: WerewolfView; voteProgress: WerewolfVoteProgress | null }

export async function runWerewolfApiSimulation(args: ReturnType<typeof parseWerewolfApiArgs>, options: {
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
} = {}) {
  const log = options.log ?? console.log;
  const sleep = options.sleep ?? Bun.sleep;
  const now = options.now ?? Date.now;
  const report: string[] = [];
  const emit = (line: string) => { report.push(line); log(line); };
  const outputPath = args.out ? resolve(args.out) : resolve(import.meta.dir, "../../docs/simulations", `werewolf-api-${new Date(now()).toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}.txt`);
  await mkdir(dirname(outputPath), { recursive: true });
  // Verify reporting is writable before creating a paid game. Never overwrite a run.
  await writeFile(outputPath, "", { flag: "wx", mode: 0o600 });
  let written = 0;
  const flush = async () => {
    if (written === report.length) return;
    await appendFile(outputPath, `${report.slice(written).join("\n")}\n`);
    written = report.length;
  };
  emit(`Report: ${outputPath}`);
  emit(`Opened: ${new Date(now()).toISOString()} · ${args.audience === "mystery" ? "Mystery — roles hidden until the ending" : "Omniscient — role spoilers included"}`);
  await flush();
  let game = args.game;
  let creationRequested = false;
  let watchUrl: string | undefined;
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const resume = (id: string) => `bun run simulate:werewolf:api --game ${quote(id)} --api-url ${quote(args.apiUrl)} --web-url ${quote(args.webUrl)} --audience ${args.audience}${args.transcript ? " --transcript" : ""}`;
  try {
    if (!game) {
      const token = await resolveSessionToken(args.apiUrl, ["create_game", "start_game"]);
      creationRequested = true;
      const created = await apiFetch<{ id: string; slug: string }>(args.apiUrl, "/api/werewolf", {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ preset: args.preset, agentProfileIds: args.agentProfileIds, providerManifest: args.providerManifest, maxDays: args.maxDays }),
      });
      game = created.id;
      if (!game || !created.slug) throw new Error("Invalid Werewolf creation response; check /games?game=werewolf before launching again.");
      watchUrl = new URL(`/games/${encodeURIComponent(created.slug)}/replay?audience=${args.audience}`, args.webUrl).href;
      emit(`Started ${created.slug}: ${WEREWOLF_PRESETS[args.preset].players} players, up to ${args.maxDays} days.`);
      emit(`Model: ${args.providerManifest.map((selection) => `${selection.catalogId} (${selection.reasoningPolicy})`).join(", ")}.`);
      emit(`Watch: ${watchUrl}`);
      emit(`Resume report: ${resume(game)}`);
      emit("Text reporting makes no model calls. Each accepted player contribution is displayed unchanged; there is no House rewrite.");
      // Persist identity before the first read, including when that read fails.
      await flush();
    }
    let cursor = 0;
    let rosterPrinted = false;
    let lastProgressAt = now();
    let lastWaitingAt = now();
    let voteKey: string | null = null;
    let voteStartedAt = now();
    let lastVoteReady = -1;
    const alive = new Set<string>();
    const deadline = now() + args.timeoutMs;
    while (now() < deadline) {
      const detail = await apiFetch<ApiView>(args.apiUrl, `/api/werewolf/${encodeURIComponent(game)}?audience=${args.audience}`);
      const view = detail.view;
      if (!view || view.audience !== args.audience || !Array.isArray(view.entries) || view.cursor !== view.entries.length || view.cursor < cursor) throw new Error("Invalid Werewolf audience timeline");
      if (!rosterPrinted) {
        if (!watchUrl) emit(`Watch: ${new URL(`/games/${encodeURIComponent(detail.slug)}/replay?audience=${args.audience}`, args.webUrl).href}`);
        emit(`Cast (${args.audience}): ${view.players.map(player => `${player.name}${args.audience === "omniscient" && player.role ? ` [${player.role}]` : ""}`).join(", ")}`);
        emit("Village wins by eliminating every wolf. Wolves win when they equal or outnumber everyone else.");
        emit("After each thread, everyone votes for a target or abstains to hear more. A strict majority of all living players eliminates the target and ends the day; otherwise discussion continues. The final ballot requires a target: unique most votes wins; a tie means no village elimination.");
        emit("Each night the pack has three proposal/ballot attempts to agree unanimously. Three disagreements mean no attack.");
        emit("Discussion: persistent round-robin openers, at most one opening each per day. Up to three invited recipients reply first, then the rest in a fixed random order. The opener may answer each spoken reply; passes advance the queue.");
        for (const player of view.players) alive.add(player.id);
        rosterPrinted = true;
      }
      for (const entry of view.entries.slice(cursor)) {
        const line = werewolfReportEntry(entry, view, args.transcript);
        if (line !== null) emit(line);
        if (entry.kind === "night" || entry.kind === "vote") {
          const eliminated = entry.kind === "night" ? entry.killedId : entry.result.eliminatedId;
          if (eliminated) alive.delete(eliminated);
          emit(`  Alive (${alive.size}): ${view.players.filter((player) => alive.has(player.id)).map((player) => player.name).join(", ")}.`);
        }
        if (entry.kind === "result") emit(`Roles revealed: ${view.players.map((player) => `${player.name} — ${player.role ?? "unknown"}${alive.has(player.id) ? "" : " (dead)"}`).join("; ")}.`);
      }
      if (view.cursor > cursor) lastProgressAt = lastWaitingAt = now();
      const progress = detail.voteProgress;
      if (progress && detail.status === "in_progress") {
        if (progress.kind !== "day_vote" || view.phase !== "vote" || progress.day !== view.day
          || progress.thread !== view.discussion?.thread || progress.total !== view.players.filter(player => player.alive).length
          || !Number.isInteger(progress.ready) || progress.ready < 0 || progress.ready > progress.total
          || progress.voteMode !== (view.discussion?.thread === view.discussion?.totalThreads ? "plurality" : "majority")
          || progress.requiredVotes !== (progress.voteMode === "majority" ? Math.floor(progress.total / 2) + 1 : null)) throw new Error("Invalid Werewolf vote progress");
        const key = `${progress.day}:${progress.thread}`;
        if (key !== voteKey) {
          voteKey = key; voteStartedAt = now(); lastVoteReady = -1;
          emit(`[Vote] Day ${progress.day} · after thread ${progress.thread} — ${progress.voteMode === "plurality" ? `Final ballot from ${progress.total} living players: unique most votes wins; ties spare everyone.` : `${progress.requiredVotes} matching votes needed from ${progress.total} living players.`} Choices reveal together; no public speech during voting.`);
        }
        if (progress.ready !== lastVoteReady || now() - lastWaitingAt >= 30_000) {
          emit(`[Voting ${Math.floor((now() - voteStartedAt) / 1000)}s] Day ${progress.day} · thread ${progress.thread} — ${progress.ready}/${progress.total} decisions ready. ${progress.ready === progress.total ? "All decisions ready; committing ballots and resolving." : `Waiting for ${progress.total - progress.ready}; ballots sealed.`}`);
          lastVoteReady = progress.ready;
          lastWaitingAt = now();
        }
      } else if (view.cursor === cursor && now() - lastWaitingAt >= 30_000 && detail.status === "in_progress") {
        const phase = view.phase === "day" && view.discussion ? `Day ${view.day}, thread ${view.discussion.thread}/${view.discussion.totalThreads}, ${view.discussion.stage}`
          : view.phase === "night" ? `Night ${view.day}` : view.phase === "introduction" ? "Introductions" : `Day ${view.day}, ${view.phase}`;
        emit(`[Waiting ${Math.floor((now() - lastProgressAt) / 1000)}s] ${phase} — no new public update yet.`);
        lastWaitingAt = now();
      }
      if (!progress) voteKey = null;
      cursor = view.cursor;
      await flush();
      if (detail.status === "completed") return { gameId: view.gameId, status: detail.status, outputPath, report: report.join("\n") };
      if (detail.status !== "in_progress") throw new Error(`Game ${game} stopped: ${detail.status}. No new game was launched.`);
      await sleep(Math.min(3000, Math.max(0, deadline - now())));
    }
    throw new Error(`Stopped waiting; game ${game} continues on the server. Resume: ${resume(game)}`);
  } catch (error) {
    emit(`Report stopped: ${error instanceof Error ? error.message : String(error)}`);
    if (game) emit(`Resume report: ${resume(game)}`);
    else if (creationRequested) emit(`Check ${args.webUrl}/games?game=werewolf before launching again; the creation request may have reached the server.`);
    await flush();
    throw error;
  }
}

if (import.meta.main) {
  try {
    const args = parseWerewolfApiArgs(process.argv.slice(2));
    if (args.help) console.log(`Launch an API-backed Werewolf game with a saved follow-along report:
  bun run simulate:werewolf:api
For a short smoke test (may stop before a winner):
  bun run simulate:werewolf:api --max-days 2
For eight characters with two wolves, a Seer and a Doctor:
  bun run simulate:werewolf:api --preset two_wolves
Watch an existing game without creating or spending on another game:
  bun run simulate:werewolf:api --game ID_OR_SLUG --transcript --audience omniscient

Options: --api-url URL --web-url URL --model-catalog ID --reasoning-policy low|medium|high|action-policy
         --agent PROFILE_ID (repeatable) --out REPORT.txt --timeout-seconds 1800
         --preset one_wolf|two_wolves --max-days 1..20 --game ID_OR_SLUG
         --audience mystery|omniscient --transcript
Defaults: six House characters, one wolf, ten-day safety cap, ${DEFAULT_MODEL_CATALOG_ID}, low reasoning, Mystery.
Original speech, passes, ballots and results print as accepted. --transcript adds production notes and turn positions. Openers select up to three recipients and may answer each spoken reply. Waiting updates print every 30 seconds.
Omniscient labels every speaker with their role, including introductions and pack chat.
Reports auto-save under packages/engine/docs/simulations; --out selects a new file.
Existing files are never overwritten. There is no House rewrite. Reading the saved conversation adds no model calls.
Run bun run dev:api, bun run dev:game-worker and bun run dev:web in separate terminals.
Run bun run mcp:game:login once,
or set INFLUENCE_API_SESSION_TOKEN. The login account needs create_game and start_game.
Game inference is paid/configured on the server; reports add no model calls.
A day cap may end in a draw. Closing this CLI does not stop the server game.`);
    else await runWerewolfApiSimulation(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
