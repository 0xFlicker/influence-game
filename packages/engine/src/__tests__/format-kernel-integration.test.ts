import { describe, expect, it } from "bun:test";
import { GameRunner } from "../game-runner";
import type { GameConfig } from "../types";
import { Phase } from "../types";
import { createUUID } from "../game-state";
import { MockAgent } from "./mock-agent";
import type { LaunchFormatId } from "../formats";
import type { PhaseContext } from "../game-runner";

const TEST_CONFIG: GameConfig = {
  timers: {
    introduction: 0,
    lobby: 0,
    mingle: 0,
    rumor: 0,
    vote: 0,
    power: 0,
    council: 0,
  },
  maxRounds: 3,
  minPlayers: 5,
  maxPlayers: 12,
};

describe("Format kernel integration (MockAgent)", () => {
  it("completes a short game using format menu/pick/mingle/resolve without Power or Council", async () => {
    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const formatMingleContexts: PhaseContext[] = [];
    for (const agent of agents) {
      const getMingleIntent = agent.getMingleIntent.bind(agent);
      agent.getMingleIntent = async (ctx) => {
        if (ctx.phase === Phase.FORMAT_MINGLE) formatMingleContexts.push(ctx);
        return getMingleIntent(ctx);
      };
    }
    // Force Vote Bomb for predictability on first pick
    const first = agents[0]!;
    first.pickRoundFormat = async (_ctx, offered) => ({
      formatId: offered.includes("vote_bomb") ? "vote_bomb" : offered[0],
      thinking: "force vote bomb when offered",
    });

    const runner = new GameRunner(agents, TEST_CONFIG);
    const result = await runner.run();

    expect(result.winner).toBeTruthy();
    expect(result.transcript.some((e) => e.phase === Phase.FORMAT_MENU)).toBe(true);
    expect(result.transcript.some((e) => e.phase === Phase.FORMAT_PICK)).toBe(true);
    expect(result.transcript.some((e) => e.phase === Phase.FORMAT_MINGLE)).toBe(true);
    expect(result.transcript.some((e) => e.phase === Phase.FORMAT_RESOLVE)).toBe(true);

    // Classic elimination engine should not appear on the default path
    const powerActions = result.transcript.filter(
      (e) => e.phase === Phase.POWER && typeof e.text === "string" && e.text.includes("power action"),
    );
    expect(powerActions).toHaveLength(0);

    const formatLocks = result.transcript.filter(
      (e) => e.scope === "system" && typeof e.text === "string" && e.text.startsWith("FORMAT LOCKED:"),
    );
    expect(formatLocks.length).toBeGreaterThan(0);

    const formatElines = result.transcript.filter(
      (e) => e.scope === "system" && typeof e.text === "string" && e.text.includes("Format ") && e.text.includes("eliminated"),
    );
    expect(formatElines.length).toBeGreaterThan(0);

    const formatMinglePressure = formatMingleContexts[0]?.formatPressure;
    expect(formatMinglePressure?.offeredFormats).toHaveLength(2);
    expect(formatMinglePressure?.selectedFormat).toBeTruthy();
    expect(formatMinglePressure?.ruleSheetSummary).toBeTruthy();
    expect(formatMinglePressure).not.toHaveProperty("targetId");
    expect(formatMinglePressure).not.toHaveProperty("ballots");
  });

  it("rotates offered formats across rounds via anti-repeat", async () => {
    const agents = ["A", "B", "C", "D", "E", "F"].map((name) => new MockAgent(createUUID(), name));
    const chosen: LaunchFormatId[] = [];
    for (const agent of agents) {
      agent.pickRoundFormat = async (_ctx, offered) => {
        const formatId = offered[0] as LaunchFormatId;
        chosen.push(formatId);
        return { formatId, thinking: "pick first" };
      };
    }

    const runner = new GameRunner(agents, { ...TEST_CONFIG, maxRounds: 4 });
    await runner.run();

    // At least two format picks should have occurred before endgame (6 -> 4 after 2 elims)
    expect(chosen.length).toBeGreaterThanOrEqual(2);
    // Hard anti-repeat: consecutive picks must differ when menu enforces non-last pair
    for (let i = 1; i < chosen.length; i++) {
      expect(chosen[i]).not.toBe(chosen[i - 1]);
    }
  });
});
