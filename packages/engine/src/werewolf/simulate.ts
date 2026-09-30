/**
 * Local Werewolf evaluation. Defaults to scripted, provider-free contestants.
 * --model-catalog explicitly opts into configured inference; --chatty prints
 * private structured decisions. The output ledger is private, not a viewer DTO.
 * House characters use frozen Werewolf archetype strategies, not Influence notes.
 * Seer/Doctor coaching supplements those notes. Keep the normal day cap when
 * evaluating concealment, prior-result disclosure, and protection over time.
 * Every player gets Seer timing from completed public nights, not hidden results.
 * Daytime players are prompted to pass rather than repeat or merely agree;
 * count voluntary passes separately from provider-unavailable fallbacks.
 * Earlier threads end with sealed target-or-abstain majority checkpoints. The final
 * thread uses mandatory-target plurality: unique most votes wins; ties spare everyone.
 * Reports distinguish vote modes; provider failures are marked unavailable abstentions.
 * A separate final task quotes the opener for recipients, or the prior respondent
 * for opener answers, identifying the next possible speaker. The seeded opening ring
 * persists across nights. Openers select 0–3 recipients; the rest follow in fixed random
 * order. Each spoken reply offers an opener answer; passes advance directly.
 * Original contributions print immediately; --transcript adds production notes
 * and turn coordinates. No House rewrite, extra speech-planning call, or gaze.
 * Pack proposals precede sealed ballots: three attempts, unanimous target, or no
 * attack. Nightly initiative is seeded and alternates after failed ballots.
 * Sealed daytime ballots run concurrently. The API reporter shows accepted-decision
 * counts as live spectator telemetry, separate from public history and player context.
 * Choices and private reasoning stay sealed until the full checkpoint resolves.
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
import { werewolfReportEntry } from "./report";
import { WerewolfModelAgent } from "./agent";
import { projectWerewolfView } from "./observation";
import { applyWerewolfEvent, replayWerewolf, startWerewolf, werewolfConfig, WEREWOLF_PRESETS } from "./rules";
import { runWerewolf, werewolfFallback, type WerewolfAgent } from "./runner";

const { values } = parseArgs({ options: {
  preset: { type: "string", default: "one_wolf" }, seed: { type: "string", default: "werewolf-evaluation-1" },
  "max-days": { type: "string", default: "10" }, "model-catalog": { type: "string" },
  out: { type: "string" }, transcript: { type: "boolean", default: false },
  audience: { type: "string", default: "mystery" }, chatty: { type: "boolean", default: false },
} });
if (values.preset !== "one_wolf" && values.preset !== "two_wolves") throw new Error("--preset must be one_wolf or two_wolves");
if (values.audience !== "mystery" && values.audience !== "omniscient") throw new Error("Invalid --audience");
const audience = values.audience;
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
let delegate: WerewolfAgent = { async decide({ request }) {
  const state = replayWerewolf(events);
  if (request.action === "vote" && request.voteMode === "plurality") return {
    kind: "target", targetId: state.aliveIds[(state.aliveIds.indexOf(request.actorId) + 1) % state.aliveIds.length]!, thinking: "Scripted cyclic ballot",
  };
  return werewolfFallback(state, request);
} };
if (values["model-catalog"]) {
  const manifest = resolveProviderManifest(normalizeProviderManifest([{ catalogId: values["model-catalog"], reasoningPolicy: "low" }]));
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
let cursor = 0;
const report = () => {
  const view = projectWerewolfView(replayWerewolf(events), audience);
  for (const entry of view.entries.slice(cursor)) {
    const line = werewolfReportEntry(entry, view, values.transcript);
    if (line !== null) console.log(line);
  }
  cursor = view.cursor;
};
report();
const state = await runWerewolf({ read: async () => structuredClone(events), append: async (event) => {
  applyWerewolfEvent(replayWerewolf(events), event); events.push(event); await persist(); report();
} }, agent, undefined);
console.log(`Completed: ${state.outcome?.faction ?? "draw"}`);
console.log(`Private canonical log: ${output}`);
