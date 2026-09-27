/**
 * Local Werewolf evaluation. Defaults to scripted, provider-free contestants.
 * --model-catalog explicitly opts into configured inference; --chatty prints
 * private structured decisions. The output ledger is private, not a viewer DTO.
 * House characters use frozen Werewolf archetype strategies, not Influence notes.
 * Discussion uses six shared beats and four messages; null speech passes without
 * spending a message. Private decisions commit before each whole-beat reveal.
 * No `as any` and no Influence House calls: the rules own every transition.
 */
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createLlmProviderRuntimesFromEnv } from "../llm-client";
import { normalizeProviderManifest, resolveProviderManifest } from "../model-catalog";
import { getHousePersonaDetails, HOUSE_AGENT_NAMES } from "../house-personas";
import { defaultWerewolfStrategy } from "./strategy";
import { WerewolfModelAgent } from "./agent";
import { projectWerewolfView } from "./observation";
import { applyWerewolfEvent, replayWerewolf, startWerewolf, werewolfConfig, WEREWOLF_PRESETS } from "./rules";
import { runWerewolf, werewolfFallback, type WerewolfAgent } from "./runner";

const { values } = parseArgs({ options: {
  preset: { type: "string", default: "one_wolf" }, seed: { type: "string", default: "werewolf-evaluation-1" },
  "max-days": { type: "string", default: "10" }, "model-catalog": { type: "string" },
  out: { type: "string" }, chatty: { type: "boolean", default: false },
} });
if (values.preset !== "one_wolf" && values.preset !== "two_wolves") throw new Error("--preset must be one_wolf or two_wolves");
const config = werewolfConfig(values.preset, Number(values["max-days"]));
const count = WEREWOLF_PRESETS[config.preset].players;
const names = HOUSE_AGENT_NAMES.slice(0, count);
const archetypes = ["honest", "strategic", "deceptive", "paranoid", "social", "observer", "diplomat", "loyalist"] as const;
const players = names.map((name, i) => ({ id: `seat-${i + 1}`, name, personality: getHousePersonaDetails(archetypes[i]!).personalityBlurb, backstory: "", strategy: defaultWerewolfStrategy(archetypes[i]!), avatarUrl: null }));
const events = [startWerewolf(`werewolf-${randomUUID()}`, players, config, values.seed)];
const output = resolve(values.out ?? `docs/simulations/${events[0]!.gameId}.json`);
await mkdir(dirname(output), { recursive: true });
const persist = async () => { await writeFile(`${output}.tmp`, JSON.stringify(events, null, 2)); await rename(`${output}.tmp`, output); };
await persist();
let delegate: WerewolfAgent = { async decide({ request }) { return werewolfFallback(replayWerewolf(events), request); } };
if (values["model-catalog"]) {
  const manifest = resolveProviderManifest(normalizeProviderManifest([{ catalogId: values["model-catalog"] }]));
  const runtimes = createLlmProviderRuntimesFromEnv(manifest, process.env);
  if (!runtimes) throw new Error("The selected provider is not configured");
  delegate = new WerewolfModelAgent({ runtimes });
}
const agent: WerewolfAgent = { async decide(input) {
  const decision = await delegate.decide(input);
  if (values.chatty) console.log(JSON.stringify({ visibility: "private", day: input.observation.board.day,
    actionSlot: input.actionSlot, discussion: input.observation.board.discussion, request: input.request, decision }));
  return decision;
} };
const state = await runWerewolf({ read: async () => structuredClone(events), append: async (event) => {
  applyWerewolfEvent(replayWerewolf(events), event); events.push(event); await persist();
} }, agent);
console.log(JSON.stringify(projectWerewolfView(state, "mystery"), null, 2));
console.log(`Private canonical log: ${output}`);
