/**
 * Influence Game - Phase State Machine
 *
 * xstate v5 machine that sequences game phases.
 * The machine manages phase transitions; game logic (votes, elimination)
 * lives in GameState.
 */

import { assign, emit, setup } from "xstate";
import { Phase } from "./types";
import type { UUID, RoundResult } from "./types";

// ---------------------------------------------------------------------------
// Machine context
// ---------------------------------------------------------------------------

export interface PhaseMachineContext {
  gameId: UUID;
  round: number;
  alivePlayers: UUID[];
  maxRounds: number;
  /** Set during VOTE phase after tallying */
  empoweredId: UUID | null;
  /** Set during POWER/REVEAL phase */
  councilCandidates: [UUID, UUID] | null;
  /** Set if power action was auto-eliminate */
  autoEliminated: UUID | null;
  /** Set at end of round */
  lastEliminated: UUID | null;
  /** Reason game ended */
  gameOverReason: "winner" | "max_rounds" | null;
  winner: UUID | null;
}

// ---------------------------------------------------------------------------
// Machine input
// ---------------------------------------------------------------------------

export type PhaseMachineInput = {
  gameId: UUID;
  playerIds: UUID[];
  maxRounds: number;
};

// ---------------------------------------------------------------------------
// Machine events (from external actors into the machine)
// ---------------------------------------------------------------------------

export type PhaseMachineEvent =
  | { type: "PHASE_COMPLETE" } // signal that current phase logic is done
  | { type: "VOTES_TALLIED"; empoweredId: UUID }
  | {
      type: "CANDIDATES_DETERMINED";
      candidates: [UUID, UUID] | null;
      autoEliminated: UUID | null;
    }
  | { type: "PLAYER_ELIMINATED"; playerId: UUID }
  | { type: "UPDATE_ALIVE_PLAYERS"; aliveIds: UUID[] }
  | { type: "NEXT_ROUND" };

// ---------------------------------------------------------------------------
// Machine emitted events (to external observers)
// ---------------------------------------------------------------------------

export type PhaseMachineEmitted =
  | { type: "PHASE_STARTED"; phase: Phase; round: number; alivePlayers: UUID[] }
  | { type: "PHASE_ENDED"; phase: Phase; round: number }
  | { type: "GAME_OVER"; winner: UUID | null; reason: string; totalRounds: number };

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export function createPhaseMachine() {
  return setup({
    types: {
      context: {} as PhaseMachineContext,
      events: {} as PhaseMachineEvent,
      input: {} as PhaseMachineInput,
      emitted: {} as PhaseMachineEmitted,
    },
    actions: {
      emitPhaseStarted: emit(({ context, event: _event }, params: { phase: Phase }) => ({
        type: "PHASE_STARTED" as const,
        phase: params.phase,
        round: context.round,
        alivePlayers: context.alivePlayers,
      })),
      emitPhaseEnded: emit(({ context }, params: { phase: Phase }) => ({
        type: "PHASE_ENDED" as const,
        phase: params.phase,
        round: context.round,
      })),
      emitGameOver: emit(({ context }) => ({
        type: "GAME_OVER" as const,
        winner: context.winner,
        reason: context.gameOverReason ?? "unknown",
        totalRounds: context.round,
      })),
      incrementRound: assign({
        round: ({ context }) => context.round + 1,
      }),
      setEmpowered: assign({
        empoweredId: ({ event }) => {
          if (event.type !== "VOTES_TALLIED") return null;
          return event.empoweredId;
        },
      }),
      setCandidates: assign({
        councilCandidates: ({ event }) => {
          if (event.type !== "CANDIDATES_DETERMINED") return null;
          return event.candidates;
        },
        autoEliminated: ({ event }) => {
          if (event.type !== "CANDIDATES_DETERMINED") return null;
          return event.autoEliminated;
        },
      }),
      updateAlivePlayers: assign({
        alivePlayers: ({ event }) => {
          if (event.type !== "UPDATE_ALIVE_PLAYERS") return [];
          return event.aliveIds;
        },
      }),
      recordEliminated: assign({
        lastEliminated: ({ event }) => {
          if (event.type !== "PLAYER_ELIMINATED") return null;
          return event.playerId;
        },
      }),
      setWinner: assign({
        winner: ({ context }) => {
          if (context.alivePlayers.length === 1) return context.alivePlayers[0];
          return null;
        },
        gameOverReason: ({ context }) => {
          if (context.alivePlayers.length <= 1) return "winner";
          if (context.round >= context.maxRounds) return "max_rounds";
          return null;
        },
      }),
      resetRoundState: assign({
        empoweredId: null,
        councilCandidates: null,
        autoEliminated: null,
        lastEliminated: null,
      }),
    },
    guards: {
      gameIsOver: ({ context }) =>
        context.alivePlayers.length <= 1 || context.round >= context.maxRounds,
      hasEnoughPlayers: ({ context }) => context.alivePlayers.length >= 2,
      autoEliminateTriggered: ({ context }) => context.autoEliminated !== null,
    },
  }).createMachine({
    id: "influence-phase",
    context: ({ input }) => ({
      gameId: input.gameId,
      round: 0,
      alivePlayers: input.playerIds,
      maxRounds: input.maxRounds,
      empoweredId: null,
      councilCandidates: null,
      autoEliminated: null,
      lastEliminated: null,
      gameOverReason: null,
      winner: null,
    }),
    initial: "init",
    states: {
      init: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.INIT } }],
        on: {
          PHASE_COMPLETE: "introduction",
        },
      },

      introduction: {
        entry: [
          { type: "emitPhaseStarted", params: { phase: Phase.INTRODUCTION } },
        ],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.INTRODUCTION } }],
        on: {
          PHASE_COMPLETE: "lobby",
          UPDATE_ALIVE_PLAYERS: { actions: ["updateAlivePlayers"] },
        },
      },

      lobby: {
        entry: [
          "incrementRound",
          "resetRoundState",
          { type: "emitPhaseStarted", params: { phase: Phase.LOBBY } },
        ],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.LOBBY } }],
        on: {
          PHASE_COMPLETE: "whisper",
          UPDATE_ALIVE_PLAYERS: { actions: ["updateAlivePlayers"] },
        },
      },

      whisper: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.WHISPER } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.WHISPER } }],
        on: {
          PHASE_COMPLETE: "rumor",
        },
      },

      rumor: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.RUMOR } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.RUMOR } }],
        on: {
          PHASE_COMPLETE: "vote",
        },
      },

      vote: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.VOTE } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.VOTE } }],
        on: {
          VOTES_TALLIED: {
            actions: ["setEmpowered"],
          },
          PHASE_COMPLETE: "power",
        },
      },

      power: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.POWER } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.POWER } }],
        on: {
          CANDIDATES_DETERMINED: {
            actions: ["setCandidates"],
          },
          PLAYER_ELIMINATED: {
            actions: ["recordEliminated"],
          },
          UPDATE_ALIVE_PLAYERS: {
            actions: ["updateAlivePlayers"],
          },
          PHASE_COMPLETE: [
            // Auto-eliminate skips straight to checking game over
            {
              guard: "autoEliminateTriggered",
              target: "checkGameOver",
            },
            { target: "reveal" },
          ],
        },
      },

      reveal: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.REVEAL } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.REVEAL } }],
        on: {
          PHASE_COMPLETE: "council",
        },
      },

      council: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.COUNCIL } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.COUNCIL } }],
        on: {
          PLAYER_ELIMINATED: {
            actions: ["recordEliminated"],
          },
          UPDATE_ALIVE_PLAYERS: {
            actions: ["updateAlivePlayers"],
          },
          PHASE_COMPLETE: "checkGameOver",
        },
      },

      checkGameOver: {
        always: [
          {
            guard: "gameIsOver",
            target: "end",
            actions: ["setWinner"],
          },
          {
            target: "lobby",
          },
        ],
      },

      end: {
        type: "final",
        entry: ["emitGameOver"],
      },
    },
  });
}

export type PhaseMachine = ReturnType<typeof createPhaseMachine>;
