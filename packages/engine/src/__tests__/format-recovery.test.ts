import { describe, expect, test } from "bun:test";
import { GameRunner } from "../game-runner";
import { GameState } from "../game-state";
import {
  buildFormatKernelStateForResume,
  formatManifestFromCanonicalEvents,
  validateFormatResumePrerequisites,
} from "../format-recovery";
import type { GameConfig } from "../types";
import { Phase, type UUID } from "../types";
import { MockAgent } from "./mock-agent";

const PLAYERS = [
  { id: "atlas" as UUID, name: "Atlas" },
  { id: "echo" as UUID, name: "Echo" },
  { id: "mira" as UUID, name: "Mira" },
  { id: "nyx" as UUID, name: "Nyx" },
  { id: "rune" as UUID, name: "Rune" },
  { id: "sol" as UUID, name: "Sol" },
];

function buildState(params: {
  empoweredId?: UUID;
  menu?: [string, string];
  selected?: string;
  formatMingleAllocation?: boolean;
  ballot?: boolean;
  priorRoundSelected?: string;
}): GameState {
  let tick = 0;
  const state = new GameState(PLAYERS, {
    gameId: "format-recovery-fixture",
    now: () => 1_720_000_000_000 + tick++,
  });

  if (params.priorRoundSelected) {
    state.startRound();
    state.setEmpowered("atlas");
    state.recordFormatMenu("atlas", ["vote_bomb", "save_or_eliminate"]);
    state.recordFormatSelected(
      "atlas",
      params.priorRoundSelected as "vote_bomb" | "save_or_eliminate" | "safety_bounce",
    );
  }

  state.startRound();
  const empowered = params.empoweredId ?? "atlas";
  state.setEmpowered(empowered);

  if (params.menu) {
    state.recordFormatMenu(empowered, params.menu as ["vote_bomb", "safety_bounce"]);
  }
  if (params.selected) {
    state.recordFormatSelected(
      empowered,
      params.selected as "vote_bomb" | "save_or_eliminate" | "safety_bounce",
    );
  }
  if (params.formatMingleAllocation) {
    state.recordRoomAllocations(
      [{ roomId: 1, round: state.round, beat: 1, playerIds: state.getAlivePlayerIds() }],
      [],
      [],
      Phase.FORMAT_MINGLE,
    );
  }
  if (params.ballot) {
    state.recordFormatBallot({
      formatId: (params.selected ?? "vote_bomb") as "vote_bomb",
      voterId: "echo",
      targetId: "mira",
    });
  }

  return state;
}

describe("validateFormatResumePrerequisites", () => {
  test("accepts menu-less one-format selection and hydrates it as locked", () => {
    const state = new GameState(PLAYERS, {
      gameId: "one-format-recovery",
      formatManifest: ["vote_bomb"],
    });
    state.startRound();
    state.setEmpowered("atlas");
    state.recordFormatSelected("atlas", "vote_bomb");

    expect(validateFormatResumePrerequisites("format_pick", state.getCanonicalEvents())).toBeNull();
    expect(validateFormatResumePrerequisites("format_mingle", state.getCanonicalEvents())).toBeNull();
    const hydrated = buildFormatKernelStateForResume({
      actorCoordinate: "format_mingle",
      canonicalEvents: state.getCanonicalEvents(),
      getPlayerName: (id) => state.getPlayerName(id),
    });
    expect(hydrated.offeredFormats).toBeNull();
    expect(hydrated.selectedFormat).toBe("vote_bomb");
    expect(hydrated.pressure?.offeredFormats).toEqual(["vote_bomb"]);
  });

  test("uses the original trio for historical starts and rejects corrupt persisted ids", () => {
    const current = new GameState(PLAYERS, { gameId: "manifest-recovery" }).getCanonicalEvents();
    const start = current[0];
    if (!start || start.type !== "game.roster_initialized") throw new Error("expected roster");
    const historical = [{
      ...start,
      payload: { players: start.payload.players },
    }];
    expect(formatManifestFromCanonicalEvents(historical)).toEqual([
      "save_or_eliminate",
      "vote_bomb",
      "safety_bounce",
    ]);

    const corrupt = [{
      ...start,
      payload: { ...start.payload, formatManifest: ["unknown_format"] },
    }] as unknown as Parameters<typeof formatManifestFromCanonicalEvents>[0];
    expect(() => formatManifestFromCanonicalEvents(corrupt)).toThrow("registered");
    expect(() => GameState.fromCanonicalEvents(corrupt)).toThrow("registered");
  });

  test("defensively freezes the admitted manifest from later input mutation", () => {
    const requested = ["vote_bomb"] as Array<"vote_bomb" | "safety_bounce">;
    const state = new GameState(PLAYERS, {
      gameId: "frozen-manifest",
      formatManifest: requested,
    });
    requested.push("safety_bounce");

    expect(state.formatManifest).toEqual(["vote_bomb"]);
    expect(formatManifestFromCanonicalEvents(state.getCanonicalEvents())).toEqual(["vote_bomb"]);
  });

  test("format_menu accepts empowered-only prefix and rejects early menu facts", () => {
    const ok = buildState({});
    expect(validateFormatResumePrerequisites("format_menu", ok.getCanonicalEvents())).toBeNull();

    const withMenu = buildState({ menu: ["vote_bomb", "safety_bounce"] });
    expect(validateFormatResumePrerequisites("format_menu", withMenu.getCanonicalEvents())).toBe(
      "format_menu_unexpected_menu_offered",
    );
  });

  test("format_pick requires exactly one current-round menu matching empowered", () => {
    const ok = buildState({ menu: ["vote_bomb", "safety_bounce"] });
    expect(validateFormatResumePrerequisites("format_pick", ok.getCanonicalEvents())).toBeNull();

    const missing = buildState({});
    expect(validateFormatResumePrerequisites("format_pick", missing.getCanonicalEvents())).toBe(
      "format_pick_missing_menu_offered",
    );

    const selectedEarly = buildState({
      menu: ["vote_bomb", "safety_bounce"],
      selected: "safety_bounce",
    });
    expect(
      validateFormatResumePrerequisites("format_pick", selectedEarly.getCanonicalEvents()),
    ).toBe("format_pick_unexpected_format_selected");
  });

  test("rejects a registered offered format outside the frozen manifest", () => {
    const state = new GameState(PLAYERS, {
      gameId: "format-recovery-menu-outside-manifest",
      formatManifest: ["vote_bomb", "save_or_eliminate"],
    });
    state.startRound();
    state.setEmpowered("atlas");
    state.recordFormatMenu("atlas", ["vote_bomb", "majority_elimination"]);

    expect(
      validateFormatResumePrerequisites("format_pick", state.getCanonicalEvents()),
    ).toBe("format_pick_offered_format_outside_manifest");
  });

  test("format_mingle and format_resolve require coherent selection and reject later facts", () => {
    const mingleOk = buildState({
      menu: ["vote_bomb", "safety_bounce"],
      selected: "safety_bounce",
    });
    expect(
      validateFormatResumePrerequisites("format_mingle", mingleOk.getCanonicalEvents()),
    ).toBeNull();

    const resolveOk = buildState({
      menu: ["vote_bomb", "safety_bounce"],
      selected: "safety_bounce",
      formatMingleAllocation: true,
    });
    expect(
      validateFormatResumePrerequisites("format_resolve", resolveOk.getCanonicalEvents()),
    ).toBeNull();

    const unoffered = buildState({
      menu: ["vote_bomb", "save_or_eliminate"],
      selected: "safety_bounce",
    });
    expect(
      validateFormatResumePrerequisites("format_mingle", unoffered.getCanonicalEvents()),
    ).toBe("format_mingle_selection_not_in_menu");

    const missingAllocation = buildState({
      menu: ["vote_bomb", "safety_bounce"],
      selected: "safety_bounce",
    });
    expect(
      validateFormatResumePrerequisites("format_resolve", missingAllocation.getCanonicalEvents()),
    ).toBe("format_resolve_missing_format_mingle_allocation");

    const withBallot = buildState({
      menu: ["vote_bomb", "safety_bounce"],
      selected: "safety_bounce",
      formatMingleAllocation: true,
      ballot: true,
    });
    expect(
      validateFormatResumePrerequisites("format_resolve", withBallot.getCanonicalEvents()),
    ).toBe("format_resolve_unexpected_resolution_facts");
  });

  test("rejects menu empowered mismatch against current-round empower", () => {
    let tick = 0;
    const state = new GameState(PLAYERS, {
      gameId: "format-recovery-mismatch",
      now: () => 1_720_000_000_000 + tick++,
    });
    state.startRound();
    state.setEmpowered("atlas");
    state.recordFormatMenu("echo", ["vote_bomb", "safety_bounce"]);
    expect(
      validateFormatResumePrerequisites("format_pick", state.getCanonicalEvents()),
    ).toBe("format_pick_menu_empowered_mismatch");
  });
});

describe("buildFormatKernelStateForResume", () => {
  test("format_menu restores only anti-repeat history", () => {
    const state = buildState({
      priorRoundSelected: "vote_bomb",
    });
    const hydrated = buildFormatKernelStateForResume({
      actorCoordinate: "format_menu",
      canonicalEvents: state.getCanonicalEvents(),
      getPlayerName: (id) => state.getPlayerName(id),
    });
    expect(hydrated.offeredFormats).toBeNull();
    expect(hydrated.selectedFormat).toBeNull();
    expect(hydrated.pressure).toBeNull();
    expect(hydrated.lastSelectedFormat).toBe("vote_bomb");
  });

  test("format_pick hydrates offered pair and menu pressure", () => {
    const state = buildState({ menu: ["vote_bomb", "safety_bounce"] });
    const hydrated = buildFormatKernelStateForResume({
      actorCoordinate: "format_pick",
      canonicalEvents: state.getCanonicalEvents(),
      getPlayerName: (id) => state.getPlayerName(id),
    });
    expect(hydrated.offeredFormats).toEqual(["vote_bomb", "safety_bounce"]);
    expect(hydrated.selectedFormat).toBeNull();
    expect(hydrated.pressure?.offeredFormats).toEqual(["vote_bomb", "safety_bounce"]);
    expect(hydrated.pressure?.selectedFormat).toBeNull();
    expect(hydrated.pressure?.empoweredId).toBe("atlas");
    expect(hydrated.pressure?.empoweredName).toBe("Atlas");
  });

  test("format_mingle/format_resolve hydrate locked selection and pressure", () => {
    const state = buildState({
      menu: ["vote_bomb", "safety_bounce"],
      selected: "safety_bounce",
      formatMingleAllocation: true,
    });
    for (const coordinate of ["format_mingle", "format_resolve"] as const) {
      const hydrated = buildFormatKernelStateForResume({
        actorCoordinate: coordinate,
        canonicalEvents: state.getCanonicalEvents(),
        getPlayerName: (id) => state.getPlayerName(id),
      });
      expect(hydrated.offeredFormats).toEqual(["vote_bomb", "safety_bounce"]);
      expect(hydrated.selectedFormat).toBe("safety_bounce");
      expect(hydrated.lastSelectedFormat).toBe("safety_bounce");
      expect(hydrated.pressure?.selectedFormat).toBe("safety_bounce");
      expect(hydrated.pressure?.ruleSheetSummary).toContain("SAFE");
    }
  });
});

describe("multi-round format resume actor round catch-up", () => {
  test("format_resolve resume at round 2 with exact maxRounds does not invent round 3", async () => {
    let tick = 0;
    const state = new GameState(PLAYERS, {
      gameId: "format-recovery-multi-round",
      now: () => 1_720_000_000_000 + tick++,
    });

    // Round 1 complete through format selection + mingle allocation + resolution + elim.
    state.startRound();
    state.setEmpowered("atlas");
    state.recordFormatMenu("atlas", ["vote_bomb", "save_or_eliminate"]);
    state.recordFormatSelected("atlas", "vote_bomb");
    state.recordRoomAllocations(
      [{ roomId: 1, round: 1, beat: 1, playerIds: PLAYERS.map((p) => p.id) }],
      [],
      [],
      Phase.FORMAT_MINGLE,
    );
    state.recordFormatResolution({
      formatId: "vote_bomb",
      empoweredId: "atlas",
      eliminatedId: "sol",
      resolutionKind: "clear",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: null,
      voteBomb: {
        totals: { sol: 3, atlas: 0, echo: 1, mira: 1, nyx: 1, rune: 0 },
        zeroSafePlayerIds: ["atlas", "rune"],
      },
      safetyBounce: null,
    });
    state.eliminatePlayer("sol");

    // Round 2 through format_resolve entry (menu + selection + format mingle allocation only).
    state.startRound();
    state.setEmpowered("echo");
    state.recordFormatMenu("echo", ["vote_bomb", "safety_bounce"]);
    state.recordFormatSelected("echo", "safety_bounce");
    state.recordRoomAllocations(
      [{ roomId: 1, round: 2, beat: 1, playerIds: state.getAlivePlayerIds() }],
      [],
      [],
      Phase.FORMAT_MINGLE,
    );

    const events = state.getCanonicalEvents();
    expect(validateFormatResumePrerequisites("format_resolve", events)).toBeNull();
    expect(state.round).toBe(2);

    const agents = PLAYERS.filter((p) => p.id !== "sol").map(
      (player) => new MockAgent(player.id, player.name),
    );
    // Keep the eliminated player agent present for roster size if needed — runner agents
    // are the remaining cast for a resumed mid-game; include all original for map lookup.
    const allAgents = PLAYERS.map((player) => {
      const existing = agents.find((agent) => agent.id === player.id);
      return existing ?? new MockAgent(player.id, player.name);
    });

    const config: GameConfig = {
      maxRounds: 2,
      minPlayers: 4,
      maxPlayers: 12,
      timers: {
        introduction: 0,
        lobby: 0,
        mingle: 0,
        rumor: 0,
        vote: 0,
        power: 0,
        council: 0,
      },
    };

    const runner = new GameRunner(allAgents, config, undefined, {
      maxRoundsMode: "exact",
      gameId: "format-recovery-multi-round",
      resumeFrom: {
        kind: "phase_boundary",
        actorCoordinate: "format_resolve",
        canonicalEvents: events,
        lastEventSequence: events[events.length - 1]!.sequence,
        transcriptReplay: [],
        mingleInboxReplay: null,
      },
    });

    await runner.run();

    const completed = runner.getCanonicalEvents();
    const roundStarts = completed.filter((event) => event.type === "round.started");
    expect(roundStarts.map((event) => event.payload.round)).toEqual([1, 2]);
    expect(completed.some((event) =>
      event.type === "format.safety_bounce_started" && event.round === 2,
    )).toBeTrue();
    // Round-2 selection must not be duplicated after resume.
    expect(completed.filter((event) =>
      event.type === "format.selected" && event.round === 2,
    )).toHaveLength(1);
  }, 30000);
});
