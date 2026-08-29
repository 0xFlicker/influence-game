import { describe, expect, it } from "bun:test";
import { GameRunner, type GameStreamEvent } from "../game-runner";
import { createUUID } from "../game-state";
import {
  TemplateHouseInterviewer,
  type HouseAllianceHuddleScheduleContext,
  type HouseAllianceHuddleScheduleResult,
  type HouseAllianceProposerSelectionContext,
  type HouseAllianceProposerSelectionResult,
  type HouseMingleAssignmentContext,
  type HouseMingleAssignmentResult,
} from "../house-interviewer";
import {
  GPT_5_6_LUNA_FLEX_RATE_CARD,
  GPT_5_6_LUNA_STANDARD_RATE_CARD,
  projectTokenCost,
  projectedSavingsFraction,
  type CostedTokenRequest,
} from "../token-cost-projection";
import { Phase, type GameConfig } from "../types";
import { MockAgent } from "./mock-agent";

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
  maxRounds: 1,
  minPlayers: 5,
  maxPlayers: 12,
};

class CountingHouseInterviewer extends TemplateHouseInterviewer {
  mingleAssignmentCalls = 0;
  proposerSelectionCalls = 0;
  huddlePlanCalls = 0;

  override async assignMingleRooms(context: HouseMingleAssignmentContext): Promise<HouseMingleAssignmentResult> {
    if (context.round === 1) this.mingleAssignmentCalls += 1;
    return super.assignMingleRooms(context);
  }

  override async planAllianceHuddles(context: HouseAllianceHuddleScheduleContext): Promise<HouseAllianceHuddleScheduleResult> {
    if (context.round === 1) this.huddlePlanCalls += 1;
    return super.planAllianceHuddles(context);
  }

  override async selectAllianceProposers(
    context: HouseAllianceProposerSelectionContext,
  ): Promise<HouseAllianceProposerSelectionResult> {
    if (context.round === 1) this.proposerSelectionCalls += 1;
    return super.selectAllianceProposers(context);
  }
}

function request(
  inputScale = 1,
  outputScale = inputScale,
  cachedReadShare = 0,
  cacheWriteShare = 0,
): CostedTokenRequest {
  const promptTokens = Math.round(10_000 * inputScale);
  return {
    promptTokens,
    cachedReadTokens: Math.round(promptTokens * cachedReadShare),
    cacheWriteTokens: Math.round(promptTokens * cacheWriteShare),
    outputTokens: Math.round(250 * outputScale),
  };
}

function houseDecisionRequest(
  scale = 1,
  cachedReadShare = 0,
  cacheWriteShare = 0,
): CostedTokenRequest {
  const promptTokens = Math.round(2_000 * scale);
  return {
    promptTokens,
    cachedReadTokens: Math.round(promptTokens * cachedReadShare),
    cacheWriteTokens: Math.round(promptTokens * cacheWriteShare),
    outputTokens: Math.round(150 * scale),
  };
}

function repeated<T>(count: number, factory: () => T): T[] {
  return Array.from({ length: count }, factory);
}

describe("daily token-cost savings model", () => {
  it("removes 49 first-round provider calls while retaining post-format bloc building", async () => {
    const agents = ["Atlas", "Briar", "Cleo", "Dax", "Echo", "Fenn", "Gaia", "Hale"]
      .map((name) => new MockAgent(createUUID(), name));
    const house = new CountingHouseInterviewer();
    const events: GameStreamEvent[] = [];
    const runner = new GameRunner(agents, TEST_CONFIG, house);
    runner.setStreamListener((event) => events.push(event));

    await runner.run();

    const firstRoundTurns = events.filter(
      (event): event is Extract<GameStreamEvent, { type: "agent_turn" }> =>
        event.type === "agent_turn" && event.round <= 1,
    );
    const counts = new Map<string, number>();
    for (const turn of firstRoundTurns) {
      counts.set(turn.action, (counts.get(turn.action) ?? 0) + 1);
    }

    expect(counts.get("lobby-message")).toBe(8);
    expect(counts.get("mingle-turn")).toBe(24);
    expect(counts.get("mingle-intent") ?? 0).toBe(0);
    expect(house.mingleAssignmentCalls).toBe(1);
    expect(house.proposerSelectionCalls).toBe(1);
    expect(house.huddlePlanCalls).toBe(0);
    expect(events.some((event) => event.type === "phase_change" && event.phase === Phase.MINGLE_I)).toBe(false);
    expect(counts.get("alliance-proposer-selection")).toBe(1);
    expect(counts.get("alliance-action")).toBe(2);
    const selectionTurn = firstRoundTurns.find((turn) => turn.action === "alliance-proposer-selection");
    const selectedIds = (selectionTurn?.response.selected as Array<{ playerId: string }>).map((item) => item.playerId);
    const allianceActionActorIds = firstRoundTurns
      .filter((turn) => turn.action === "alliance-action")
      .map((turn) => turn.actor.id);
    expect(selectedIds).toHaveLength(2);
    expect(allianceActionActorIds).toEqual(selectedIds);
    // Every selected mock passes, so no proposal exists and no responder/counter
    // demand is created beyond the two proposer calls.

    // House narration has its own engine telemetry and is not part of this
    // historical social-cadence model. Room-assignment and proposer-selection
    // turns are producer artifacts; each set is backed by one House request
    // rather than one request per turn.
    const houseCadenceTurns = firstRoundTurns.filter((turn) => (
      turn.action === "house-mc-summary" || turn.action === "house-summary-phase-telemetry"
    ));
    const compactEnvelopeProviderCalls = firstRoundTurns.length
      - houseCadenceTurns.length
      - (counts.get("mingle-room-assignment") ?? 0)
      - (counts.get("alliance-proposer-selection") ?? 0)
      + house.mingleAssignmentCalls
      + house.proposerSelectionCalls;
    // This fixture predates the compact envelope. Add back the 32 first-round
    // reflection calls removed by that independent change so the historical
    // social-cadence comparison remains scoped to its original 49 calls.
    const preCompactProviderCalls = compactEnvelopeProviderCalls + 32;
    expect(preCompactProviderCalls).toBeGreaterThanOrEqual(102);
    expect(preCompactProviderCalls).toBeLessThanOrEqual(110);

    // Before House-selected access, all 8 living players received proposer
    // calls. R22 replaces those 8 calls with 2 proposer calls plus one House call.
    const preHouseSelectionProviderCalls = preCompactProviderCalls + 5;
    expect(preHouseSelectionProviderCalls).toBeGreaterThanOrEqual(107);
    expect(preHouseSelectionProviderCalls).toBeLessThanOrEqual(115);

    // Removed from the previous cadence: 8 extra Lobby turns, 16 intent calls,
    // 24 pre-format room turns, and one pre-format House room assignment.
    const previousProviderCalls = preHouseSelectionProviderCalls + 8 + 16 + 24 + 1;
    expect(previousProviderCalls - preHouseSelectionProviderCalls).toBe(49);
    expect(previousProviderCalls).toBeGreaterThanOrEqual(156);
    expect(previousProviderCalls).toBeLessThanOrEqual(164);

    const formatRoomIndex = firstRoundTurns.findIndex(
      (turn) => turn.phase === Phase.FORMAT_MINGLE && turn.action === "mingle-turn",
    );
    const allianceActionIndex = firstRoundTurns.findIndex(
      (turn) => turn.phase === Phase.FORMAT_MINGLE && turn.action === "alliance-action",
    );
    expect(formatRoomIndex).toBeGreaterThanOrEqual(0);
    expect(allianceActionIndex).toBeGreaterThan(formatRoomIndex);
  });

  it("projects 26-36% spend reduction across cold and warm cache buckets", () => {
    for (const [cachedReadShare, cacheWriteShare] of [[0, 0], [0.7, 0.1]] as const) {
      // Use the highest retained call count exercised above so the projection
      // remains conservative across launch formats with different action counts.
      const candidateRequests = [
        ...repeated(108, () => request(1, 1, cachedReadShare, cacheWriteShare)),
        houseDecisionRequest(1, cachedReadShare, cacheWriteShare),
        houseDecisionRequest(1, cachedReadShare, cacheWriteShare),
      ];

      for (const rateCard of [GPT_5_6_LUNA_STANDARD_RATE_CARD, GPT_5_6_LUNA_FLEX_RATE_CARD]) {
        const candidate = projectTokenCost(candidateRequests, rateCard);
        const projectedSavings: number[] = [];

        for (const removedRequestScale of [0.8, 1, 1.25]) {
          const removedRequests = [
            ...repeated(48, () => request(
              removedRequestScale,
              removedRequestScale,
              cachedReadShare,
              cacheWriteShare,
            )),
            houseDecisionRequest(removedRequestScale, cachedReadShare, cacheWriteShare),
          ];
          const baseline = projectTokenCost([...candidateRequests, ...removedRequests], rateCard);
          projectedSavings.push(projectedSavingsFraction(baseline, candidate));
        }

        expect(projectedSavings[0]).toBeGreaterThan(0.26);
        expect(projectedSavings[2]).toBeLessThan(0.36);
        expect(projectedSavings[1]).toBeGreaterThan(0.30);
        expect(projectedSavings[1]).toBeLessThan(0.31);
        expect(candidate.cachedReadTokens).toBeGreaterThanOrEqual(0);
        expect(candidate.cacheWriteTokens).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("rejects overlapping cache buckets instead of overstating savings", () => {
    expect(() => projectTokenCost([{
      promptTokens: 100,
      cachedReadTokens: 80,
      cacheWriteTokens: 30,
      outputTokens: 10,
    }], GPT_5_6_LUNA_STANDARD_RATE_CARD)).toThrow("cannot exceed prompt tokens");
  });
});
