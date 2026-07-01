import { GameState } from "../game-state";
import type { CanonicalGameEvent } from "../canonical-events";
import type { RoundResult } from "../types";

export const EDGE_SMOKE_DUSK_GAME_ID = "edge-smoke-dusk";

export const EDGE_SMOKE_DUSK_PLAYERS = {
  lilith: { id: "lilith-voss", name: "Lilith Voss" },
  kestrel: { id: "kestrel", name: "Kestrel" },
  shadowtech: { id: "shadowtech", name: "Shadowtech" },
  nova: { id: "nova", name: "Nova" },
  ember: { id: "ember-vale", name: "Ember Vale" },
  ash: { id: "ash-calder", name: "Ash Calder" },
  willow: { id: "willow-park", name: "Willow Park" },
  rook: { id: "rook-vale", name: "Rook Vale" },
  june: { id: "june-sol", name: "June Sol" },
} as const;

export const EDGE_SMOKE_DUSK_EXPECTED = {
  slug: "edge-smoke-dusk",
  winnerId: EDGE_SMOKE_DUSK_PLAYERS.lilith.id,
  winnerName: EDGE_SMOKE_DUSK_PLAYERS.lilith.name,
  runnerUpId: EDGE_SMOKE_DUSK_PLAYERS.kestrel.id,
  runnerUpName: EDGE_SMOKE_DUSK_PLAYERS.kestrel.name,
  roundsPlayed: 8,
  finalVote: {
    [EDGE_SMOKE_DUSK_PLAYERS.lilith.id]: 4,
    [EDGE_SMOKE_DUSK_PLAYERS.kestrel.id]: 3,
  },
  bootOrder: [
    EDGE_SMOKE_DUSK_PLAYERS.ash.id,
    EDGE_SMOKE_DUSK_PLAYERS.willow.id,
    EDGE_SMOKE_DUSK_PLAYERS.rook.id,
    EDGE_SMOKE_DUSK_PLAYERS.june.id,
    EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id,
    EDGE_SMOKE_DUSK_PLAYERS.nova.id,
    EDGE_SMOKE_DUSK_PLAYERS.ember.id,
    EDGE_SMOKE_DUSK_PLAYERS.kestrel.id,
  ],
  lilithJuryVotes: [
    EDGE_SMOKE_DUSK_PLAYERS.ash.id,
    EDGE_SMOKE_DUSK_PLAYERS.willow.id,
    EDGE_SMOKE_DUSK_PLAYERS.rook.id,
    EDGE_SMOKE_DUSK_PLAYERS.june.id,
  ],
  nonLilithFinalVotePlayers: [
    EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id,
    EDGE_SMOKE_DUSK_PLAYERS.nova.id,
    EDGE_SMOKE_DUSK_PLAYERS.ember.id,
  ],
} as const;

type EdgePlayerId = typeof EDGE_SMOKE_DUSK_PLAYERS[keyof typeof EDGE_SMOKE_DUSK_PLAYERS]["id"];

interface StandardRoundSpec {
  empowerVotes: Partial<Record<EdgePlayerId, EdgePlayerId>>;
  exposeVotes: Partial<Record<EdgePlayerId, EdgePlayerId>>;
  councilVotes: Partial<Record<EdgePlayerId, EdgePlayerId>>;
}

export function createEdgeSmokeDuskEvents(gameId = EDGE_SMOKE_DUSK_GAME_ID): readonly CanonicalGameEvent[] {
  const state = new GameState(Object.values(EDGE_SMOKE_DUSK_PLAYERS), {
    gameId,
    now: fixedClock(),
  });
  const p = ids();

  playStandardRound(state, {
    empowerVotes: {
      [p.lilith]: p.shadowtech,
      [p.kestrel]: p.shadowtech,
      [p.shadowtech]: p.lilith,
      [p.nova]: p.shadowtech,
      [p.ember]: p.shadowtech,
      [p.ash]: p.kestrel,
      [p.willow]: p.shadowtech,
      [p.rook]: p.kestrel,
      [p.june]: p.lilith,
    },
    exposeVotes: {
      [p.lilith]: p.ash,
      [p.kestrel]: p.ash,
      [p.shadowtech]: p.willow,
      [p.nova]: p.ash,
      [p.ember]: p.willow,
      [p.ash]: p.willow,
      [p.willow]: p.ash,
      [p.rook]: p.ash,
      [p.june]: p.willow,
    },
    councilVotes: {
      [p.lilith]: p.ash,
      [p.kestrel]: p.ash,
      [p.shadowtech]: p.ash,
      [p.nova]: p.ash,
      [p.ember]: p.ash,
      [p.ash]: p.willow,
      [p.willow]: p.ash,
      [p.rook]: p.ash,
      [p.june]: p.ash,
    },
  });

  playStandardRound(state, {
    empowerVotes: {
      [p.lilith]: p.shadowtech,
      [p.kestrel]: p.shadowtech,
      [p.shadowtech]: p.lilith,
      [p.nova]: p.shadowtech,
      [p.ember]: p.shadowtech,
      [p.willow]: p.kestrel,
      [p.rook]: p.shadowtech,
      [p.june]: p.lilith,
    },
    exposeVotes: {
      [p.lilith]: p.willow,
      [p.kestrel]: p.willow,
      [p.shadowtech]: p.rook,
      [p.nova]: p.willow,
      [p.ember]: p.rook,
      [p.willow]: p.rook,
      [p.rook]: p.willow,
      [p.june]: p.willow,
    },
    councilVotes: {
      [p.lilith]: p.willow,
      [p.kestrel]: p.willow,
      [p.shadowtech]: p.willow,
      [p.nova]: p.willow,
      [p.ember]: p.willow,
      [p.willow]: p.rook,
      [p.rook]: p.willow,
      [p.june]: p.willow,
    },
  });

  playStandardRound(state, {
    empowerVotes: {
      [p.lilith]: p.shadowtech,
      [p.kestrel]: p.shadowtech,
      [p.shadowtech]: p.lilith,
      [p.nova]: p.shadowtech,
      [p.ember]: p.shadowtech,
      [p.rook]: p.shadowtech,
      [p.june]: p.lilith,
    },
    exposeVotes: {
      [p.lilith]: p.rook,
      [p.kestrel]: p.rook,
      [p.shadowtech]: p.june,
      [p.nova]: p.rook,
      [p.ember]: p.june,
      [p.rook]: p.june,
      [p.june]: p.rook,
    },
    councilVotes: {
      [p.lilith]: p.rook,
      [p.kestrel]: p.rook,
      [p.shadowtech]: p.rook,
      [p.nova]: p.rook,
      [p.ember]: p.rook,
      [p.rook]: p.june,
      [p.june]: p.rook,
    },
  });

  playStandardRound(state, {
    empowerVotes: {
      [p.lilith]: p.kestrel,
      [p.kestrel]: p.lilith,
      [p.shadowtech]: p.lilith,
      [p.nova]: p.lilith,
      [p.ember]: p.kestrel,
      [p.june]: p.lilith,
    },
    exposeVotes: {
      [p.lilith]: p.june,
      [p.kestrel]: p.june,
      [p.shadowtech]: p.ember,
      [p.nova]: p.june,
      [p.ember]: p.ember,
      [p.june]: p.june,
    },
    councilVotes: {
      [p.lilith]: p.june,
      [p.kestrel]: p.june,
      [p.shadowtech]: p.june,
      [p.nova]: p.june,
      [p.ember]: p.ember,
      [p.june]: p.ember,
    },
  });

  playStandardRound(state, {
    empowerVotes: {
      [p.lilith]: p.kestrel,
      [p.kestrel]: p.lilith,
      [p.shadowtech]: p.kestrel,
      [p.nova]: p.lilith,
      [p.ember]: p.lilith,
    },
    exposeVotes: {
      [p.lilith]: p.shadowtech,
      [p.kestrel]: p.shadowtech,
      [p.shadowtech]: p.nova,
      [p.nova]: p.shadowtech,
      [p.ember]: p.nova,
    },
    councilVotes: {
      [p.lilith]: p.shadowtech,
      [p.kestrel]: p.shadowtech,
      [p.shadowtech]: p.nova,
      [p.nova]: p.shadowtech,
      [p.ember]: p.shadowtech,
    },
  });

  state.startRound();
  state.setEndgameStage("reckoning");
  state.recordEndgameEliminationVote(p.lilith, p.nova);
  state.recordEndgameEliminationVote(p.kestrel, p.nova);
  state.recordEndgameEliminationVote(p.nova, p.lilith);
  state.recordEndgameEliminationVote(p.ember, p.nova);
  state.eliminatePlayer(state.tallyEndgameEliminationVotes());

  state.startRound();
  state.setEndgameStage("tribunal");
  state.recordEndgameEliminationVote(p.lilith, p.ember);
  state.recordEndgameEliminationVote(p.kestrel, p.ember);
  state.recordEndgameEliminationVote(p.ember, p.lilith);
  state.eliminatePlayer(state.tallyTribunalVotes());

  state.startRound();
  state.setEndgameStage("judgment");
  state.recordJuryVote(p.ash, p.lilith);
  state.recordJuryVote(p.willow, p.lilith);
  state.recordJuryVote(p.rook, p.lilith);
  state.recordJuryVote(p.june, p.lilith);
  state.recordJuryVote(p.shadowtech, p.kestrel);
  state.recordJuryVote(p.nova, p.kestrel);
  state.recordJuryVote(p.ember, p.kestrel);
  const { winnerId } = state.tallyJuryVotes();
  const loserId = [p.lilith, p.kestrel].find((id) => id !== winnerId);
  if (!loserId) throw new Error("Expected a losing finalist");
  state.eliminatePlayer(loserId);

  return state.getCanonicalEvents();
}

function playStandardRound(state: GameState, spec: StandardRoundSpec): void {
  state.startRound();
  for (const [voter, target] of typedEntries(spec.empowerVotes)) {
    const exposeTarget = spec.exposeVotes[voter];
    if (!exposeTarget) throw new Error(`Missing expose vote for ${voter}`);
    state.recordVote(voter, target, exposeTarget);
  }
  const { empowered } = state.tallyEmpowerVotes();
  state.setPowerAction({ action: "pass", target: empowered });
  const resolved = state.determineCandidates();
  if (!resolved.candidates) throw new Error("Expected Council candidates");
  for (const [voter, target] of typedEntries(spec.councilVotes)) {
    state.recordCouncilVote(voter, target);
  }
  const eliminated = state.tallyCouncilVotes(empowered);
  const result: RoundResult = {
    round: state.round,
    empoweredId: empowered,
    exposeScores: state.getExposeScores(),
    candidates: resolved.candidates,
    powerAction: "pass",
    powerTarget: empowered,
    eliminated,
  };
  state.eliminatePlayer(eliminated);
  state.recordRoundResult(result);
}

function ids(): { [K in keyof typeof EDGE_SMOKE_DUSK_PLAYERS]: typeof EDGE_SMOKE_DUSK_PLAYERS[K]["id"] } {
  return Object.fromEntries(
    Object.entries(EDGE_SMOKE_DUSK_PLAYERS).map(([key, player]) => [key, player.id]),
  ) as { [K in keyof typeof EDGE_SMOKE_DUSK_PLAYERS]: typeof EDGE_SMOKE_DUSK_PLAYERS[K]["id"] };
}

function typedEntries<T extends string>(
  record: Partial<Record<T, T>>,
): Array<[T, T]> {
  return Object.entries(record) as Array<[T, T]>;
}

function fixedClock(): () => number {
  let ticks = 0;
  return () => 1_720_100_000_000 + ticks++;
}
