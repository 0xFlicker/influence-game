import { describe, expect, it } from "bun:test";
import {
  FORMAT_KERNEL_VIEWER_SCENARIO_IDS,
  createFormatKernelViewerScenario,
} from "../fixtures/format-kernel-viewer";
import {
  applyFormatTiebreak,
  computeSaveOrEliminateNets,
  resolveSaveOrEliminate,
} from "../formats/save-or-eliminate";
import {
  computeVoteBombTallies,
  resolveVoteBomb,
} from "../formats/vote-bomb";
import {
  computeMajorityEliminationTallies,
  resolveMajorityElimination,
} from "../formats/majority-elimination";

describe("format-kernel viewer fixture family", () => {
  it("covers every launch format, tie and clear outcomes, terminal prefixes, and malformed history", () => {
    expect(FORMAT_KERNEL_VIEWER_SCENARIO_IDS).toEqual([
      "save_or_eliminate_clear",
      "vote_bomb_clear",
      "majority_elimination_clear",
      "majority_elimination_tie",
      "safety_bounce_tie",
      "safety_bounce_sole_vulnerable",
      "terminal_menu",
      "terminal_selection",
      "terminal_classification",
      "terminal_sealed_ballot",
      "terminal_resolution",
      "malformed_selection",
      "malformed_duplicate_ballot",
      "malformed_safety_actor",
    ]);

    const scenarios = FORMAT_KERNEL_VIEWER_SCENARIO_IDS.map(
      createFormatKernelViewerScenario,
    );
    expect(scenarios.map((scenario) => scenario.expected.selectedFormatId))
      .toEqual(expect.arrayContaining([
        "save_or_eliminate",
        "vote_bomb",
        "majority_elimination",
        "safety_bounce",
      ]));
    expect(scenarios.some((scenario) => scenario.expected.resolutionKind === "clear"))
      .toBe(true);
    expect(scenarios.some((scenario) => scenario.expected.tiebreakerId !== null))
      .toBe(true);
    expect(scenarios.some((scenario) => scenario.expected.ballotPresentation === "not_applicable"))
      .toBe(true);
    expect(scenarios.some((scenario) => scenario.expected.status === "terminal"))
      .toBe(true);
    expect(scenarios.some((scenario) => scenario.expected.status === "malformed"))
      .toBe(true);
  });

  it("is deterministic and never persists presentation-only pointer candidates", () => {
    for (const scenarioId of FORMAT_KERNEL_VIEWER_SCENARIO_IDS) {
      const first = createFormatKernelViewerScenario(scenarioId);
      const second = createFormatKernelViewerScenario(scenarioId);
      expect(first).toEqual(second);
      expect(JSON.stringify(first)).not.toContain("pointerCandidateIds");
      expect(JSON.stringify(first)).not.toContain("ballotReveal");
    }
  });

  it("keeps clear Save-or-Eliminate and Vote Bomb payloads aligned with canonical rule math", () => {
    const save = createFormatKernelViewerScenario("save_or_eliminate_clear");
    const saveBallots = save.decisions.flatMap((decision) =>
      decision.type === "format.ballot_cast"
        && decision.payload.formatId === "save_or_eliminate"
        && decision.payload.polarity !== null
        ? [{
            voterId: decision.payload.voterId,
            targetId: decision.payload.targetId,
            polarity: decision.payload.polarity,
          }]
        : []
    );
    const saveResolution = save.decisions.find(
      (decision) => decision.type === "format.resolved",
    );
    if (
      !saveResolution
      || saveResolution.payload.formatId !== "save_or_eliminate"
      || saveResolution.payload.aggregate.capability !== "sealed_polarity"
    ) {
      throw new Error("Save-or-Eliminate fixture is missing its resolution.");
    }
    expect(
      computeSaveOrEliminateNets(
        save.roster.map((player) => player.id),
        saveBallots,
      ),
    ).toEqual({
      nets: saveResolution.payload.aggregate.nets,
      savesReceived: saveResolution.payload.aggregate.savesReceived,
      eliminateReceived: saveResolution.payload.aggregate.eliminateReceived,
    });
    const saveNatural = resolveSaveOrEliminate(
      save.roster.map((player) => player.id),
      saveBallots,
    );
    expect(saveNatural.kind).toBe("tie");
    expect(
      applyFormatTiebreak(
        saveNatural.tiedSet,
        saveResolution.payload.eliminatedId,
      ),
    ).toEqual({
      kind: "clear",
      eliminatedId: "lyra",
      tiedSet: ["lyra", "echo"],
    });

    const bomb = createFormatKernelViewerScenario("vote_bomb_clear");
    const bombBallots = bomb.decisions.flatMap((decision) =>
      decision.type === "format.ballot_cast"
        && decision.payload.formatId === "vote_bomb"
        ? [{
            voterId: decision.payload.voterId,
            targetId: decision.payload.targetId,
          }]
        : []
    );
    const bombResolution = bomb.decisions.find(
      (decision) => decision.type === "format.resolved",
    );
    if (
      !bombResolution
      || bombResolution.payload.formatId !== "vote_bomb"
      || bombResolution.payload.aggregate.capability !== "sealed_elim"
    ) {
      throw new Error("Vote Bomb fixture is missing its resolution.");
    }
    const bombAggregate = bombResolution.payload.aggregate;
    expect(
      computeVoteBombTallies(
        bomb.roster.map((player) => player.id),
        bombBallots,
      ),
    ).toMatchObject({
      totals: bombAggregate.totals,
      zeroSafeIds: bomb.roster
        .map((player) => player.id)
        .filter((id) => !bombAggregate.eligiblePlayerIds.includes(id)),
    });
    const bombNatural = resolveVoteBomb(
      bomb.roster.map((player) => player.id),
      bombBallots,
    );
    expect(bombNatural.kind).toBe("tie");
    expect(
      applyFormatTiebreak(
        bombNatural.tiedSet,
        bombResolution.payload.eliminatedId,
      ),
    ).toEqual({
      kind: "clear",
      eliminatedId: "echo",
      tiedSet: ["echo", "rex"],
    });
  });

  it("keeps Majority Elimination clear and tied-highest fixtures aligned with version-2 rule math", () => {
    for (const scenarioId of [
      "majority_elimination_clear",
      "majority_elimination_tie",
    ] as const) {
      const scenario = createFormatKernelViewerScenario(scenarioId);
      const ballots = scenario.decisions.flatMap((decision) =>
        decision.type === "format.ballot_cast"
          && decision.payload.formatId === "majority_elimination"
          ? [{
              voterId: decision.payload.voterId,
              targetId: decision.payload.targetId,
            }]
          : []
      );
      const resolution = scenario.decisions.find(
        (decision) => decision.type === "format.resolved",
      );
      if (
        !resolution
        || resolution.payload.formatId !== "majority_elimination"
        || resolution.payload.aggregate.capability !== "sealed_elim"
      ) {
        throw new Error("Majority Elimination fixture is missing its v2 aggregate.");
      }

      expect(
        computeMajorityEliminationTallies(
          scenario.roster.map((player) => player.id),
          ballots,
        ),
      ).toEqual({
        totals: resolution.payload.aggregate.totals,
        eligibleIds: resolution.payload.aggregate.eligiblePlayerIds,
      });
      const natural = resolveMajorityElimination(
        scenario.roster.map((player) => player.id),
        ballots,
      );
      if (scenarioId === "majority_elimination_clear") {
        expect(natural).toEqual({
          kind: "auto",
          eliminatedId: "lyra",
          tiedSet: ["lyra"],
          reason: "sole_highest",
        });
        expect(resolution.payload.tiebreakerId).toBeNull();
      } else {
        expect(natural).toEqual({
          kind: "tie",
          eliminatedId: null,
          tiedSet: ["lyra", "echo"],
        });
        expect(
          applyFormatTiebreak(
            natural.tiedSet,
            resolution.payload.eliminatedId,
          ),
        ).toEqual({
          kind: "clear",
          eliminatedId: "echo",
          tiedSet: ["lyra", "echo"],
        });
        expect(resolution.payload.tiebreakerId).toBe("atlas");
      }

      const serialized = JSON.stringify(scenario);
      expect(serialized).not.toContain("zeroSafePlayerIds");
      expect(serialized).not.toContain("vulnerablePlayerIds");
      expect(serialized).not.toContain("Power");
      expect(serialized).not.toContain("Council");
    }
  });
});
