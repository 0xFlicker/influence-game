import { describe, expect, it } from "bun:test";
import {
  HOUSE_LONG_FORM_SUMMARY_SCHEMA,
  decodeAcceptedHouseLongForm,
  decodeHouseLongFormProvider,
} from "../house-long-form";
import type { HouseGameplaySummaryContext } from "../game-runner.types";
import { Phase } from "../types";

function context(): HouseGameplaySummaryContext {
  return {
    gameId: "game-1",
    round: 3,
    phase: Phase.COUNCIL,
    kind: "long-form",
    coveredWindow: {
      fromRound: 1,
      toRound: 3,
      fromPhase: Phase.INTRODUCTION,
      toPhase: Phase.COUNCIL,
    },
    narrationContext: {
      version: 2,
      boundary: {
        version: 2,
        id: "house-beat/v2:3:council:40:80",
        gameId: "game-1",
        actorCoordinate: "council",
        round: 3,
        phase: Phase.COUNCIL,
        beatClass: "milestone",
        canonicalHead: 40,
        dialogueHead: 80,
      },
      material: true,
      playerNamesById: {},
      canonicalEvents: [],
      projection: null,
      publicDialogue: [],
      privateDialogueAndDecisions: [],
      diaryEntries: [],
    },
    recentPublicBeats: [],
    privateNarrativeNotebook: "The voting bloc is starting to fracture.",
  };
}

describe("House-authored long-form output", () => {
  it("preserves authored prose while adding engine-owned boundary metadata", () => {
    const summary = "  Atlas thinks he controls the room. He doesn't.  ";
    const decoded = decodeHouseLongFormProvider({ summary, thinking: null }, context());

    expect(decoded).toEqual({
      status: "valid",
      value: {
        summary,
        kind: "long-form",
        coveredWindow: context().coveredWindow,
      },
    });
  });

  it("rejects receipt-backed claims and every other extra provider field", () => {
    const decoded = decodeHouseLongFormProvider({
      summary: "A producer catch-up.",
      thinking: null,
      claims: [{ sourceAlias: "P-1", kind: "round_outcome" }],
    }, context());

    expect(decoded.status).toBe("invalid");
    expect(JSON.stringify(HOUSE_LONG_FORM_SUMMARY_SCHEMA)).not.toMatch(/sourceAlias|claims|receipt/);
  });

  it("rejects empty prose and control characters without rewriting", () => {
    expect(decodeHouseLongFormProvider({ summary: "   ", thinking: null }, context()).status)
      .toBe("invalid");
    expect(decodeHouseLongFormProvider({ summary: "bad\u0007copy", thinking: null }, context()).status)
      .toBe("invalid");
  });

  it("rejects stale or model-authored engine metadata on accepted replay", () => {
    const accepted = decodeAcceptedHouseLongForm({
      summary: "A producer catch-up.",
      kind: "round",
      coveredWindow: context().coveredWindow,
    }, context());
    expect(accepted.status).toBe("invalid");
  });
});
