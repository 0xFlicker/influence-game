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

describe("format-kernel viewer fixture family", () => {
  it("covers every launch format, tie and clear outcomes, terminal prefixes, and malformed history", () => {
    expect(FORMAT_KERNEL_VIEWER_SCENARIO_IDS).toEqual([
      "save_or_eliminate_clear",
      "vote_bomb_clear",
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
      || !saveResolution.payload.saveOrEliminate
    ) {
      throw new Error("Save-or-Eliminate fixture is missing its resolution.");
    }
    expect(
      computeSaveOrEliminateNets(
        save.roster.map((player) => player.id),
        saveBallots,
      ),
    ).toEqual(saveResolution.payload.saveOrEliminate);
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
      || !bombResolution.payload.voteBomb
    ) {
      throw new Error("Vote Bomb fixture is missing its resolution.");
    }
    expect(
      computeVoteBombTallies(
        bomb.roster.map((player) => player.id),
        bombBallots,
      ),
    ).toMatchObject({
      totals: bombResolution.payload.voteBomb.totals,
      zeroSafeIds: bombResolution.payload.voteBomb.zeroSafePlayerIds,
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
});
