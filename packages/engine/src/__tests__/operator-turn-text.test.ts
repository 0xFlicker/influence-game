import { describe, expect, test } from "bun:test";
import {
  formatAllianceActionOperatorText,
  formatMingleIntentOperatorText,
  formatMingleRoomAssignmentOperatorText,
  formatMingleTurnOperatorText,
  formatStrategicReflectionOperatorText,
} from "../operator-turn-text";
import { formatAgentTurnTrace } from "../simulate";
import type { AgentTurnEvent } from "../game-runner.types";
import { Phase } from "../types";

describe("operator turn text", () => {
  test("mingle intent includes lens, seeks, and target", () => {
    const text = formatMingleIntentOperatorText("Echo", {
      seekPlayers: ["Sage", "Kael"],
      avoidPlayers: ["Lyra"],
      preferredRoomSize: "small_group",
      purpose: "Map the bridge without overcommitting.",
      provisionalTarget: null,
      noTargetReason: "Still reading coalition shape",
      openingAsk: "Who feels durable after Atlas left?",
      strategicLens: "coalition_geometry",
      strategicLensRationale: "Need shape before vote math.",
    });
    expect(text).toContain("Echo intent:");
    expect(text).toContain("lens=coalition_geometry");
    expect(text).toContain("size=small_group");
    expect(text).toContain("seek=Sage,Kael");
    expect(text).toContain("avoid=Lyra");
    expect(text).toContain("target=none");
    expect(text).toContain("ask=");
    expect(text).toContain("purpose=");
  });

  test("room assignment names roommates and source", () => {
    const text = formatMingleRoomAssignmentOperatorText({
      playerName: "Echo",
      assignedRoomId: 2,
      assignmentSource: "house",
      roommateNames: ["Sage", "Finn"],
    });
    expect(text).toBe("Echo → room 2 (house) with Sage, Finn");
  });

  test("mingle turn shows no_reply and next movement", () => {
    const text = formatMingleTurnOperatorText({
      playerName: "Echo",
      roomId: 1,
      message: null,
      messageSent: false,
      toRoomId: 3,
      moved: true,
      gotoRoomId: 3,
      gotoPlayerName: null,
      gotoStatus: "applied",
    });
    expect(text).toBe("Echo room 1: no_reply | next→room 3");
  });

  test("alliance propose names the roster", () => {
    const text = formatAllianceActionOperatorText(
      "Sage",
      {
        action: "propose",
        name: "The Plain Names",
        memberNames: ["Sage", "Kael", "Echo"],
        purpose: "Calm bridge",
      },
      "recorded",
      { shortId: "36a7c377" },
    );
    expect(text).toContain('Sage alliance propose "The Plain Names" #36a7c377');
    expect(text).toContain("members=Sage,Kael,Echo");
    expect(text).toContain("→ recorded");
  });

  test("alliance accept uses name, short id, and members instead of raw lineage", () => {
    const text = formatAllianceActionOperatorText(
      "Vera",
      {
        action: "accept",
        lineageId: "36a7c377-aaaa-bbbb-cccc-dddddddddddd",
      },
      "recorded",
      {
        allianceName: "The Non-Theater Reasoning Pact",
        memberNames: ["Kael", "Vera", "Rune", "Echo", "Lyra"],
        shortId: "36a7c377",
      },
    );
    expect(text).toBe(
      'Vera alliance accept "The Non-Theater Reasoning Pact" #36a7c377 members=Kael,Vera,Rune,Echo,Lyra → recorded',
    );
    expect(text).not.toContain("lineage=");
  });

  test("strategic reflection includes lens allies threats plan", () => {
    const text = formatStrategicReflectionOperatorText({
      playerName: "Finn",
      strategicLens: "vote_math",
      allies: ["Sage"],
      threats: ["Lyra"],
      plan: "Hold the center and re-check sealed ballot targets.",
    });
    expect(text).toContain("Finn reflection: lens=vote_math");
    expect(text).toContain("allies=Sage");
    expect(text).toContain("threats=Lyra");
    expect(text).toContain("plan=");
  });

  test("chatty prints operator text even without thinking", () => {
    const event: AgentTurnEvent = {
      type: "agent_turn",
      round: 2,
      phase: Phase.FORMAT_MINGLE,
      timestamp: 1,
      action: "mingle-intent",
      actor: { id: "echo-id", name: "Echo", role: "player" },
      visibility: "private",
      response: {
        seekPlayers: ["Sage"],
        avoidPlayers: [],
        preferredRoomSize: "pair",
        purpose: "Test bridge",
        provisionalTarget: "Lyra",
        noTargetReason: null,
        openingAsk: "Where is the heat?",
        strategicLens: "vote_math",
        strategicLensRationale: "Sealed board",
      },
      text: "Echo intent: lens=vote_math | size=pair | seek=Sage | avoid=none | target=Lyra | ask=Where is the heat? | purpose=Test bridge",
    };
    const formatted = formatAgentTurnTrace(event);
    expect(formatted).toContain("[trace:mingle-intent]");
    expect(formatted).toContain("Echo intent: lens=vote_math");
    expect(formatted).not.toContain("thinking:");
  });
});
