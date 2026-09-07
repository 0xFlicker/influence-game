import { describe, expect, it } from "bun:test";
import type { CanonicalGameEvent } from "../canonical-events";
import {
  projectTwoNamesRound,
  validateTwoNamesCanonicalPrefixes,
} from "../formats/two-names-events";
import { GameState } from "../game-state";

const PLAYERS = [
  { id: "atlas", name: "Atlas" },
  { id: "blair", name: "Blair" },
  { id: "cyra", name: "Cyra" },
  { id: "dax", name: "Dax" },
  { id: "echo", name: "Echo" },
];

function completedTiePrefix(): readonly CanonicalGameEvent[] {
  const state = new GameState(PLAYERS, {
    gameId: "two-names-prefix",
    formatManifest: ["two_names"],
  });
  state.startRound();
  state.setEmpowered("atlas");
  state.recordFormatSelected("atlas", "two_names");
  state.recordTwoNamesSetup({
    empoweredId: "atlas",
    initialNomineeIds: ["blair", "cyra"],
    overrideHolderId: "atlas",
  });
  state.recordTwoNamesMingleCompleted("initial_names", ["blair", "cyra"]);
  state.recordTwoNamesOverrideUsed({
    overrideHolderId: "atlas",
    removedNomineeId: "blair",
    empoweredId: "atlas",
    replacementNomineeId: "dax",
    finalistPlayerIds: ["dax", "cyra"],
  }, { override: [], replacement: [] });
  state.recordTwoNamesMingleCompleted("final_names", ["dax", "cyra"]);
  state.recordTwoNamesPlea({
    speakerId: "dax",
    ordinal: 0,
    status: "accepted",
    text: "Keep me.",
    absenceReason: null,
  });
  state.recordTwoNamesPlea({
    speakerId: "cyra",
    ordinal: 1,
    status: "absent",
    text: null,
    absenceReason: "provider_unavailable",
  });
  state.recordFormatBallot({ formatId: "two_names", voterId: "blair", targetId: "dax" });
  state.recordFormatBallot({ formatId: "two_names", voterId: "echo", targetId: "cyra" });
  state.recordFormatResolution({
    formatId: "two_names",
    empoweredId: "atlas",
    eliminatedId: "dax",
    resolutionKind: "auto",
    tiedPlayerIds: ["dax", "cyra"],
    tiebreakerId: "atlas",
    aggregate: {
      capability: "two_names",
      initialNomineeIds: ["blair", "cyra"],
      overrideHolderId: "atlas",
      overrideAction: "used",
      removedNomineeId: "blair",
      replacementNomineeId: "dax",
      finalistPlayerIds: ["dax", "cyra"],
      eligibleVoterIds: ["blair", "echo"],
      totals: { dax: 1, cyra: 1 },
    },
  });
  return state.getCanonicalEvents();
}

describe("Two Names canonical lifecycle", () => {
  it("accepts every committed partial prefix and projects the terminal story", () => {
    const events = completedTiePrefix();
    const atomicUseIndex = events.findIndex((event) => event.type === "format.two_names_override_used");
    for (let length = 1; length <= events.length; length += 1) {
      if (length === atomicUseIndex + 1) continue;
      expect(validateTwoNamesCanonicalPrefixes(events.slice(0, length))).toEqual({ ok: true, errors: [] });
    }

    expect(projectTwoNamesRound(events, 1, PLAYERS.map((player) => player.id))).toMatchObject({
      stage: "resolved",
      empoweredId: "atlas",
      overrideHolderId: "atlas",
      overrideAction: "used",
      initialNomineeIds: ["blair", "cyra"],
      finalistPlayerIds: ["dax", "cyra"],
      eligibleVoterIds: ["blair", "echo"],
      tiebreakerId: "atlas",
      eliminatedId: "dax",
    });
  });

  it("rejects an unpaired Override use", () => {
    const events = completedTiePrefix();
    const replacementIndex = events.findIndex(
      (event) => event.type === "format.two_names_replacement_named",
    );
    const invalid = events.slice(0, replacementIndex);
    expect(validateTwoNamesCanonicalPrefixes(invalid)).toMatchObject({ ok: false });
    expect(validateTwoNamesCanonicalPrefixes(invalid).errors[0]).toContain("atomic replacement");
  });

  it("rejects wrong plea order, ineligible ballots, and contradictory aggregates", () => {
    const events = completedTiePrefix();
    const pleaIndex = events.findIndex((event) => event.type === "format.two_names_plea_recorded");
    const wrongPlea = events.map((event, index) => index === pleaIndex && event.type === "format.two_names_plea_recorded"
      ? { ...event, payload: { ...event.payload, speakerId: "cyra" } }
      : event) as CanonicalGameEvent[];
    expect(validateTwoNamesCanonicalPrefixes(wrongPlea)).toMatchObject({ ok: false });

    const ballotIndex = events.findIndex((event) => event.type === "format.ballot_cast");
    const wrongBallot = events.map((event, index) => index === ballotIndex && event.type === "format.ballot_cast"
      ? { ...event, payload: { ...event.payload, voterId: "atlas" } }
      : event) as CanonicalGameEvent[];
    expect(validateTwoNamesCanonicalPrefixes(wrongBallot)).toMatchObject({ ok: false });

    const resolutionIndex = events.findIndex((event) => event.type === "format.resolved");
    const wrongAggregate = events.map((event, index) => index === resolutionIndex && event.type === "format.resolved" && event.payloadVersion === 2
      ? {
          ...event,
          payload: {
            ...event.payload,
            aggregate: event.payload.aggregate.capability === "two_names"
              ? { ...event.payload.aggregate, totals: { dax: 2, cyra: 0 } }
              : event.payload.aggregate,
          },
        }
      : event) as CanonicalGameEvent[];
    expect(validateTwoNamesCanonicalPrefixes(wrongAggregate)).toMatchObject({ ok: false });
  });
});
