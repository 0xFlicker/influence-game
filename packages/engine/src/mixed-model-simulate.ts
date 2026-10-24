#!/usr/bin/env bun
/** Local API only. --preview never authenticates or calls a provider/API. */
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeGameModelRouting, normalizeModelPreference, sealGameModelRouting, type GameModelRouting, type ModelPreference } from "./game-model-routing";
import { DEFAULT_MODEL_CATALOG_ID, normalizeProviderManifest, parseProviderManifestEntry } from "./model-catalog";
import { modelRouteMetadata } from "./model-route-metadata";
import { apiFetch, authHeaders } from "./api-simulation-client";
import { resolveCliApiSession } from "./cli-api-session";

export interface SimulationRoster { seats: Array<{ id: string; agentProfileId?: string; preference: ModelPreference }>; policy: GameModelRouting }
export function previewModelRoster(roster: SimulationRoster, players: number) {
  if (roster.seats.length !== players) throw new Error(`Expected exactly ${players} seat models; received ${roster.seats.length}`);
  const policy = normalizeGameModelRouting(roster.policy);
  const sealed = sealGameModelRouting(policy, roster.seats);
  return { policy: sealed, routes: [...new Set([...sealed.houseManifest, ...Object.values(sealed.contestants!).flat()].map(entry => entry.catalogId))].map(catalogId => ({ catalogId, ...modelRouteMetadata(catalogId) })) };
}

async function main() {
  const { values } = parseArgs({ options: {
    game: { type: "string", default: "werewolf" }, players: { type: "string", default: "8" }, models: { type: "string" }, roster: { type: "string" },
    "provider-entry": { type: "string", multiple: true }, "house-entry": { type: "string", multiple: true },
    preview: { type: "boolean", default: false }, report: { type: "string" },
    "api-url": { type: "string", default: "http://127.0.0.1:3000" }, "web-url": { type: "string", default: "http://localhost:3001" },
    out: { type: "string", default: resolve(import.meta.dir, "../docs/simulations") },
  } });
  const players = Number(values.players);
  if (!Number.isInteger(players) || players < 6 || players > 12) throw new Error("Choose 6–12 seats");
  if (values.game !== "werewolf" && values.game !== "influence") throw new Error("Choose influence or werewolf");
  const api = new URL(values["api-url"]!);
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(api.hostname) || !["http:", "https:"].includes(api.protocol)) throw new Error("Simulations must use the localhost API");
  const session = async () => resolveCliApiSession({ apiOrigin: api.origin, webOrigin: values["web-url"]!, requiredPermissions: ["create_game", "fill_game", "start_game"] });
  if (values.report && values.preview) throw new Error("--preview cannot be combined with --report");
  if (values.report) {
    const token = await session();
    const report = JSON.stringify(await apiFetch(api.origin, `/api/model-routing/games/${encodeURIComponent(values.report)}`, { headers: authHeaders(token) }), null, 2);
    await mkdir(values.out!, { recursive: true });
    const reportPath = resolve(values.out!, `routing-report-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
    await writeFile(reportPath, report, { flag: "wx" });
    console.log(report); console.log(`Saved ${reportPath}`); return;
  }
  if (Boolean(values.models) === Boolean(values.roster)) throw new Error("Supply either --models (one provider:model per seat) or --roster JSON");
  const defaultManifest = normalizeProviderManifest(values["provider-entry"]?.map(parseProviderManifestEntry) ?? [{ catalogId: DEFAULT_MODEL_CATALOG_ID }]);
  const houseManifest = normalizeProviderManifest(values["house-entry"]?.map(parseProviderManifestEntry) ?? defaultManifest);
  const roster: SimulationRoster = values.roster ? JSON.parse(await readFile(values.roster, "utf8")) : {
    seats: values.models!.split(",").map((catalogId, index) => ({ id: `seat-${index + 1}`, preference: normalizeModelPreference(catalogId.trim() === "default" ? "default" : { catalogId: catalogId.trim() }) })),
    policy: { version: 1, defaultManifest, houseManifest, excludedCatalogIds: [], overrides: {} },
  };
  const preview = previewModelRoster(roster, players);
  console.log(JSON.stringify(preview, null, 2));
  if (values.preview) return;
  const token = await session();
  const headers = authHeaders(token);
  const runDir = resolve(values.out!, `mixed-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`);
  await mkdir(runDir, { recursive: true });
  await writeFile(resolve(runDir, "requested.json"), JSON.stringify({ game: values.game, roster, preview }, null, 2), { flag: "wx" });
  const werewolf = values.game === "werewolf";
  const game = await apiFetch<{ id: string; slug: string }>(api.origin, werewolf ? "/api/werewolf/lobbies" : "/api/games", {
    method: "POST", headers, body: JSON.stringify(werewolf
      ? { preset: "two_wolves", setup: { playerCount: players, wolves: 2, seer: true, doctor: true }, maxDays: 10, visibility: "unlisted", modelRouting: roster.policy }
      : { playerCount: players, visibility: "unlisted", modelRouting: roster.policy }),
  });
  await writeFile(resolve(runDir, "game.json"), JSON.stringify(game, null, 2), { flag: "wx" });
  const root = werewolf ? `/api/werewolf/${game.id}` : `/api/games/${game.id}`;
  for (const seat of roster.seats.filter(seat => seat.agentProfileId)) await apiFetch(api.origin, `${root}/join`, { method: "POST", headers, body: JSON.stringify({ agentProfileId: seat.agentProfileId }) });
  await apiFetch(api.origin, `${root}/fill`, { method: "POST", headers });
  const assigned = await apiFetch<{ policy: GameModelRouting; seats: Array<{ id: string; agentProfileId: string | null }> }>(api.origin, `/api/model-routing/games/${game.id}`, { headers });
  if (assigned.seats.length !== roster.seats.length) throw new Error("API cast size differs from requested roster; game remains waiting");
  const unused = [...assigned.seats].sort((a, b) => a.id.localeCompare(b.id));
  const overrides: Record<string, ModelPreference> = {};
  for (const seat of roster.seats) {
    const index = seat.agentProfileId ? unused.findIndex(candidate => candidate.agentProfileId === seat.agentProfileId) : unused.findIndex(candidate => !candidate.agentProfileId);
    if (index < 0) throw new Error(`No API cast match for ${seat.id}; game remains waiting`);
    overrides[unused.splice(index, 1)[0]!.id] = roster.policy.overrides[seat.id] ?? seat.preference;
  }
  const policy = { ...roster.policy, overrides };
  await apiFetch(api.origin, `/api/model-routing/games/${game.id}`, { method: "PUT", headers, body: JSON.stringify(policy) });
  await writeFile(resolve(runDir, "assignments.json"), JSON.stringify({ game, policy }, null, 2), { flag: "wx" });
  await apiFetch(api.origin, `${root}/start`, { method: "POST", headers });
  console.log(`Started ${game.id}. Evidence directory: ${runDir}\nRead results with --report ${game.id}; replay at ${values["web-url"]}/games/${game.slug}`);
}
if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
