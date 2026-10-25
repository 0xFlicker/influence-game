#!/usr/bin/env bun
/** Local API runbook. Mutations are explicit; no retry or automatic paid dispatch. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { resolveCliApiSession } from "../packages/engine/src/cli-api-session";
import { normalizeGameModelRouting, normalizeModelPreference, type GameModelRouting, type ModelPreference } from "../packages/engine/src/game-model-routing";
import { updateLocalTaskLedger, type LocalTaskLedger } from "../packages/engine/src/local-task-budget";
import { loadProductionReplaySource } from "../packages/web/src/lib/replay-export/production-source";

const MODELS = {
  "GPT Sol": "openai:gpt-6.1-sol", "Claude Sonnet": "katana:claude-sonnet-4-6",
  "Claude Haiku": "katana:claude-haiku-4-5", "Gemini Pro": "katana:gemini-3-1-pro-preview",
  "Meta Spark": "meta-muse:muse-spark-1.3-contributor", "Kimi K3": "katana:kimi-k3",
  "DeepSeek Flash": "katana:deepseek-v4-flash", "Grok 4.6": "katana:grok-4-6",
} as const;
type Kind = "werewolf" | "influence";
type JsonObject = Record<string, unknown>;
interface Profile { id: string; name: string; modelPreference: ModelPreference; avatarUrl: string; fullBodyReferenceUrl: string }
interface Game { id: string; slug: string; prepared: boolean; started?: boolean; roster: Profile[]; requested: JsonObject }
interface Manifest { version: 1; api: string; web: string; games: Partial<Record<Kind, Game>>; pending?: { id: string; method: string; path: string; at: string } }
interface Routing { policy: GameModelRouting; frozen: boolean; seats: { id: string; name: string; agentProfileId: string | null }[] }

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as JsonObject;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${label}`);
  return value;
}
function origin(value: string): string {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.protocol !== "http:" || url.username || url.password || url.pathname !== "/") throw new Error("Only loopback HTTP origins are permitted");
  return url.origin;
}
async function save(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    kind: { type: "string" }, "api-url": { type: "string", default: "http://127.0.0.1:3000" },
    "web-url": { type: "string", default: "http://localhost:3001" },
    out: { type: "string", default: resolve(import.meta.dir, "../../evidence/games") },
    ledger: { type: "string", default: resolve(import.meta.dir, "../../evidence/spend-ledger.json") },
    "allow-paid-start": { type: "boolean", default: false }, help: { type: "boolean", default: false },
  } });
  if (values.help || !positionals[0]) {
    console.log("Commands: profiles | prepare --kind werewolf|influence | start --kind KIND --allow-paid-start | status | evidence --kind KIND\nOptional --api-url, --web-url, --out, --ledger. Prepare creates waiting games only. Start can spend provider credits. No command retries uncertain mutations. Evidence includes private accepted thinking; keep output local."); return;
  }
  if (positionals.length !== 1 || !["profiles", "prepare", "start", "status", "evidence"].includes(positionals[0])) throw new Error("Unknown command; use --help");
  const command = positionals[0], api = origin(values["api-url"]!), web = origin(values["web-url"]!);
  const out = resolve(values.out!), manifestPath = resolve(out, "manifest.json"), ledgerPath = resolve(values.ledger!);
  if (values.kind !== undefined && !["werewolf", "influence"].includes(values.kind)) throw new Error("Choose --kind werewolf or influence");
  const kind = values.kind as Kind | undefined;
  if (["prepare", "start", "evidence"].includes(command) && !kind) throw new Error("This command requires --kind");
  if (command === "start" && !values["allow-paid-start"]) throw new Error("Starting can incur provider charges; supply --allow-paid-start only after admission by the budget owner");
  await mkdir(out, { recursive: true, mode: 0o700 });
  let manifest: Manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; manifest = { version: 1, api, web, games: {} }; }
  if (manifest.version !== 1 || manifest.api !== api || manifest.web !== web) throw new Error("Manifest belongs to another environment");
  if (manifest.pending && ["prepare", "start"].includes(command)) throw new Error(`Uncertain prior mutation ${manifest.pending.method} ${manifest.pending.path}; inspect the API and saved receipt before repairing manifest.pending. Never blindly repeat it.`);
  const token = await resolveCliApiSession({ apiOrigin: api, webOrigin: web, requiredRoles: ["producer", "sysop"],
    requiredPermissions: ["create_game", "fill_game", "start_game"],
    openBrowser: async () => { throw new Error("No valid cached local session. Use the normal CLI browser login separately; this harness never creates credentials."); } });
  async function read<T = JsonObject>(path: string): Promise<T> {
    const response = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`GET ${path.split("?")[0]} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    return response.json() as Promise<T>;
  }
  async function mutate<T>(path: string, body?: unknown, method = "POST", onSuccess?: (result: T) => void): Promise<T> {
    if (manifest.pending) throw new Error("A prior mutation remains uncertain");
    const id = randomUUID();
    manifest.pending = { id, method, path, at: new Date().toISOString() };
    await save(resolve(out, `intent-${id}.json`), { ...manifest.pending, body });
    await save(manifestPath, manifest);
    const response = await fetch(`${api}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(120_000) });
    const text = await response.text();
    await save(resolve(out, `receipt-${id}.json`), { status: response.status, path, response: text });
    if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}); saved receipt and pending intent. Inspect before retrying.`);
    const result = JSON.parse(text) as T;
    onSuccess?.(result);
    delete manifest.pending;
    await save(manifestPath, manifest);
    return result;
  }
  async function profiles(): Promise<Profile[]> {
    const rows = await read<unknown>("/api/agent-profiles");
    if (!Array.isArray(rows)) throw new Error("Invalid profile listing");
    return Object.entries(MODELS).map(([name, catalogId]) => {
      const matching = rows.map(row => object(row, "profile")).filter(row => row.name === name);
      if (matching.length !== 1) throw new Error(`Expected exactly one owned ${name}, found ${matching.length}`);
      const row = matching[0]!, preference = normalizeModelPreference(row.modelPreference);
      if (preference === "default" || preference.catalogId !== catalogId) throw new Error(`${name} preference changed; review the roster before dispatch`);
      return { id: string(row.id, "profile id"), name, modelPreference: preference,
        avatarUrl: string(row.avatarUrl, `${name} portrait`), fullBodyReferenceUrl: string(row.fullBodyReferenceUrl, `${name} full body`) };
    });
  }
  async function inspect(game: Game) { return read<{ game: { config: string; status: string; gameKind: string } }>(`/api/admin/export-game/${game.id}`); }
  async function routing(game: Game) { return read<Routing>(`/api/model-routing/games/${game.id}`); }
  async function checkLedger(id?: string) {
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as LocalTaskLedger;
    if (ledger.version !== 1 || ledger.limits.openaiUsd > 15 || ledger.limits.katanaCredits > 10000 || ledger.limits.xaiUsd > 15) throw new Error("Ledger exceeds authorized ceilings or is invalid");
    if (id && !ledger.allowedGameIds.includes(id)) throw new Error("Game is not registered in the shared budget ledger");
    for (const currency of ["openaiUsd", "katanaCredits", "xaiUsd"] as const) {
      const committed = ledger.prior[currency] + ledger.entries.filter(entry => entry.currency === currency).reduce((sum, entry) => sum + entry.charged, 0);
      if (!Number.isFinite(committed) || committed >= ledger.limits[currency]) throw new Error(`No ${currency} headroom remains`);
    }
  }
  if (command === "profiles") {
    const roster = await profiles(); await save(resolve(out, "roster.json"), roster);
    console.log(JSON.stringify(roster.map(({ id, name, modelPreference }) => ({ id, name, modelPreference })), null, 2)); return;
  }
  if (command === "prepare") {
    await checkLedger();
    if (manifest.games[kind!]) throw new Error("This kind already has a saved game; inspect it instead of creating a duplicate");
    const roster = await profiles();
    const policy = normalizeGameModelRouting({ version: 1, defaultManifest: [{ catalogId: "openai:gpt-6-luna", reasoningPolicy: "action-policy" }],
      houseManifest: [{ catalogId: "openai:gpt-6-luna", reasoningPolicy: "action-policy" }], defaultModelMaxFallbackCalls: 24, excludedCatalogIds: [], overrides: {} });
    const requested = kind === "werewolf"
      ? { preset: "two_wolves", setup: { playerCount: 8, wolves: 2, seer: true, doctor: true }, maxDays: 10, visibility: "public", audioMode: true, visualMode: false, modelRouting: policy }
      : { playerCount: 8, visibility: "public", audioMode: true, visualMode: false, modelRouting: policy };
    await mutate<{ id: string; slug: string }>(kind === "werewolf" ? "/api/werewolf/lobbies" : "/api/games", requested, "POST", created => {
      manifest.games[kind!] = { id: string(created.id, "created game id"), slug: string(created.slug, "created slug"), prepared: false, roster, requested };
    });
    const game = manifest.games[kind!]!;
    await updateLocalTaskLedger(ledgerPath, ledger => { if (!ledger.allowedGameIds.includes(game.id)) ledger.allowedGameIds.push(game.id); });
    const exported = await inspect(game), config = object(JSON.parse(exported.game.config), "frozen config");
    if (exported.game.status !== "waiting" || config.audioMode !== true || kind === "werewolf" && config.rulesVersion !== 11) throw new Error("API did not preserve Audio Mode / Werewolf v11. The saved game remains waiting; upgrade the API before proceeding.");
    const root = kind === "werewolf" ? `/api/werewolf/${game.id}` : `/api/games/${game.id}`;
    for (const profile of roster) await mutate(`${root}/join`, { agentProfileId: profile.id });
    const assigned = await routing(game);
    if (assigned.frozen || assigned.seats.length !== 8) throw new Error("Cast must contain exactly eight waiting seats");
    const overrides: Record<string, ModelPreference> = {};
    for (const profile of roster) {
      const seats = assigned.seats.filter(seat => seat.agentProfileId === profile.id);
      if (seats.length !== 1) throw new Error(`Cast mismatch for ${profile.name}`);
      overrides[seats[0]!.id] = profile.modelPreference;
    }
    await mutate(`/api/model-routing/games/${game.id}`, { ...policy, overrides }, "PUT");
    await save(resolve(out, `${kind}-waiting-config.json`), await inspect(game));
    await save(resolve(out, `${kind}-assignments.json`), await routing(game));
    game.prepared = true; await save(manifestPath, manifest);
    console.log(JSON.stringify({ kind, id: game.id, slug: game.slug, status: "waiting", audioMode: true, cast: roster.map(p => p.name), viewer: `${web}/games/${game.slug}`, ledger: ledgerPath })); return;
  }
  if (command === "start") {
    const game = manifest.games[kind!];
    if (!game?.prepared) throw new Error("Prepare and inspect this game first");
    await checkLedger(game.id);
    const exported = await inspect(game), config = object(JSON.parse(exported.game.config), "frozen config");
    if (game.started || exported.game.status !== "waiting") throw new Error("Game already started or not waiting; inspect its state instead of redispatching start");
    if (config.audioMode !== true) throw new Error("Audio Mode is not enabled");
    await mutate(`${kind === "werewolf" ? "/api/werewolf" : "/api/games"}/${game.id}/start`);
    game.started = true; await save(manifestPath, manifest);
    console.log(JSON.stringify({ kind, id: game.id, slug: game.slug, startAccepted: true, viewer: `${web}/games/${game.slug}` })); return;
  }
  const selected = Object.entries(manifest.games).filter(([key]) => !kind || key === kind) as [Kind, Game][];
  if (!selected.length) throw new Error("No prepared game in this manifest");
  for (const [gameKind, game] of selected) {
    const exported = await inspect(game), routes = await routing(game);
    const summary = { kind: gameKind, id: game.id, slug: game.slug, status: exported.game.status, frozen: routes.frozen, viewer: `${web}/games/${game.slug}` };
    if (command === "status") { console.log(JSON.stringify(summary)); continue; }
    const directory = resolve(out, `${gameKind}-${new Date().toISOString().replaceAll(":", "-")}`); await mkdir(directory, { mode: 0o700 });
    await save(resolve(directory, "game-export.json"), exported);
    await save(resolve(directory, "routing.json"), routes);
    await save(resolve(directory, "costs.json"), await read(`/api/admin/games/${game.id}/costs`));
    await save(resolve(directory, "audio-preview.json"), await read(`/api/admin/production/games/${game.id}/audio`));
    const audience = gameKind === "werewolf" ? "omniscient" : "public";
    const audio = await read(`/api/admin/production/games/${game.id}/audio/manifest?audience=${audience}&thinking=on`);
    await save(resolve(directory, "audio-manifest.json"), audio);
    if (["completed", "suspended"].includes(exported.game.status)) {
      const source = await loadProductionReplaySource(read, { gameId: game.id, gameKind, audience, thinking: true });
      await save(resolve(directory, "production-source.json"), source);
    }
    console.log(JSON.stringify({ ...summary, evidence: directory, note: "Private accepted thinking retained; full raw provider evidence remains in canonical API journal and bucket storage." }));
  }
}
if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : "Local E2E harness failed"); process.exitCode = 1; });
