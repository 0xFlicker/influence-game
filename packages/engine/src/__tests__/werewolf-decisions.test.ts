import { expect, test } from "bun:test";
import { werewolfResultsFixture } from "../fixtures/werewolf-results";
import { projectWerewolfDecisions } from "../werewolf/decisions";
import { replayWerewolf } from "../werewolf/rules";

test("Mystery exposes only the selected player's resolved public ballots, even at the ending", async () => {
  const events = await werewolfResultsFixture("saved");
  const state = replayWerewolf(events);
  for (const player of state.players) {
    const full = projectWerewolfDecisions(events, "mystery", Infinity, player.id);
    expect(full.entries.length).toBeGreaterThan(0);
    expect(full.entries.every(entry => entry.actorId === player.id && entry.action === "vote")).toBe(true);
    expect(full.entries.some(entry => entry.targetId === null && !entry.unavailable)).toBe(true);
    expect(JSON.stringify(full)).not.toMatch(/SECRET|thinking|protect|investigate|attack/);
    for (const entry of full.entries) {
      expect(projectWerewolfDecisions(events, "mystery", entry.cursor - 1, player.id).entries)
        .toEqual(full.entries.filter(prior => prior.cursor < entry.cursor));
    }
  }
});

test("Omniscient resolves Doctor saves and Seer results without publishing pending actions", async () => {
  const events = await werewolfResultsFixture("saved");
  const state = replayWerewolf(events);
  const doctor = state.players.find(player => state.roles[player.id] === "doctor")!;
  const seer = state.players.find(player => state.roles[player.id] === "seer")!;
  const protection = projectWerewolfDecisions(events, "omniscient", Infinity, doctor.id).entries.find(entry => entry.action === "protect")!;
  expect(protection.targetId).toBe(doctor.id);
  expect(protection.result).toBe(`Protection saved ${doctor.name} from the pack.`);
  const investigation = projectWerewolfDecisions(events, "omniscient", Infinity, seer.id).entries.find(entry => entry.action === "investigate")!;
  expect(investigation.result).toBe(state.roles[investigation.targetId!] === "werewolf" ? "Found a werewolf." : "Not a werewolf.");
  for (const player of state.players) {
    const full = projectWerewolfDecisions(events, "omniscient", Infinity, player.id);
    for (const entry of full.entries) {
      expect(projectWerewolfDecisions(events, "omniscient", entry.cursor - 1, player.id).entries)
        .toEqual(full.entries.filter(prior => prior.cursor < entry.cursor));
    }
  }
});

test("pack attempts retain each wolf's own target, including a lone wolf", async () => {
  for (const scenario of ["disagreement", "village"] as const) {
    const events = await werewolfResultsFixture(scenario);
    const state = replayWerewolf(events);
    const wolves = state.players.filter(player => state.roles[player.id] === "werewolf");
    for (const wolf of wolves) {
      const attacks = projectWerewolfDecisions(events, "omniscient", Infinity, wolf.id).entries.filter(entry => entry.action === "attack");
      expect(attacks).toHaveLength(scenario === "disagreement" ? 3 : 1);
      expect(attacks.every(entry => entry.actorId === wolf.id && entry.targetId !== null)).toBe(true);
      expect(attacks.at(-1)!.result).toContain(scenario === "disagreement" ? "could not agree" : "agreed on");
    }
  }
});

test("unavailable ballots stay distinct from intentional Hear more votes", async () => {
  const events = await werewolfResultsFixture("unavailable");
  const state = replayWerewolf(events);
  const fallback = projectWerewolfDecisions(events, "mystery", Infinity, state.players[0]!.id);
  expect(fallback.entries.some(entry => entry.unavailable && entry.targetId === null)).toBe(true);
  const deliberate = projectWerewolfDecisions(events, "mystery", Infinity, state.players[1]!.id);
  expect(deliberate.entries.some(entry => !entry.unavailable && entry.targetId === null)).toBe(true);
});
