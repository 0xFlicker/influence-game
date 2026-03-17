/**
 * Influence Game - Phase State Machine
 *
 * xstate v5 machine that sequences game phases.
 * The machine manages phase transitions; game logic (votes, elimination)
 * lives in GameState.
 */

import { assign, emit, setup } from "xstate";
import { Phase } from "./types";
import type { UUID } from "./types";

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

  // --- Endgame fields ---
  /** Current endgame stage, or null during normal rounds */
  endgameStage: "reckoning" | "tribunal" | "judgment" | null;
  /** Eliminated players forming the jury */
  jury: Array<{ playerId: UUID; eliminatedRound: number }>;
  /** The two finalists in Judgment */
  finalists: [UUID, UUID] | null;
  /** Preserved from the last normal round for endgame tiebreakers */
  lastEmpoweredFromRegularRounds: UUID | null;
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
  | { type: "NEXT_ROUND" }
  | { type: "JURY_WINNER_DETERMINED"; winnerId: UUID };

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
      addToJury: assign({
        jury: ({ context, event }) => {
          if (event.type !== "PLAYER_ELIMINATED") return context.jury;
          return [...context.jury, { playerId: event.playerId, eliminatedRound: context.round }];
        },
      }),
      setWinner: assign({
        winner: ({ context }): UUID | null => {
          if (context.alivePlayers.length === 1) {
            const winner = context.alivePlayers[0];
            if (winner === undefined) throw new Error("Expected one alive player but array was empty");
            return winner;
          }
          return null;
        },
        gameOverReason: ({ context }) => {
          if (context.alivePlayers.length <= 1) return "winner";
          if (context.round >= context.maxRounds) return "max_rounds";
          return null;
        },
      }),
      setJuryWinner: assign({
        winner: ({ event }) => {
          if (event.type !== "JURY_WINNER_DETERMINED") return null;
          return event.winnerId;
        },
        gameOverReason: (): PhaseMachineContext["gameOverReason"] => "winner",
      }),
      resetRoundState: assign({
        empoweredId: null,
        councilCandidates: null,
        autoEliminated: null,
        lastEliminated: null,
      }),
      // --- Endgame stage transitions ---
      setReckoningStage: assign({
        endgameStage: (): PhaseMachineContext["endgameStage"] => "reckoning",
        lastEmpoweredFromRegularRounds: ({ context }) =>
          context.lastEmpoweredFromRegularRounds ?? context.empoweredId,
      }),
      setTribunalStage: assign({
        endgameStage: (): PhaseMachineContext["endgameStage"] => "tribunal",
      }),
      setJudgmentStage: assign({
        endgameStage: (): PhaseMachineContext["endgameStage"] => "judgment",
        finalists: ({ context }): [UUID, UUID] | null => {
          const alive = context.alivePlayers;
          if (alive.length === 2) {
            const first = alive[0];
            const second = alive[1];
            if (first === undefined || second === undefined) {
              throw new Error("Expected two alive players for finalists but array was shorter than expected");
            }
            return [first, second];
          }
          return null;
        },
      }),
    },
    guards: {
      gameIsOver: ({ context }) =>
        context.alivePlayers.length <= 1 || context.round >= context.maxRounds,
      hasEnoughPlayers: ({ context }) => context.alivePlayers.length >= 2,
      autoEliminateTriggered: ({ context }) => context.autoEliminated !== null,
      // --- Endgame guards ---
      reckoningTriggered: ({ context }) =>
        context.alivePlayers.length === 4 && context.endgameStage === null,
      tribunalTriggered: ({ context }) =>
        context.alivePlayers.length === 3,
      judgmentTriggered: ({ context }) =>
        context.alivePlayers.length === 2,
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
      // Endgame
      endgameStage: null,
      jury: [],
      finalists: null,
      lastEmpoweredFromRegularRounds: null,
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
            actions: ["recordEliminated", "addToJury"],
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
            actions: ["recordEliminated", "addToJury"],
          },
          UPDATE_ALIVE_PLAYERS: {
            actions: ["updateAlivePlayers"],
          },
          PHASE_COMPLETE: "checkGameOver",
        },
      },

      // =====================================================================
      // Game over check — branches into endgame or next normal round
      // =====================================================================

      checkGameOver: {
        always: [
          {
            guard: "gameIsOver",
            target: "end",
            actions: ["setWinner"],
          },
          {
            guard: "reckoningTriggered",
            target: "reckoning_lobby",
            actions: ["setReckoningStage"],
          },
          {
            guard: "tribunalTriggered",
            target: "tribunal_lobby",
            actions: ["setTribunalStage"],
          },
          {
            guard: "judgmentTriggered",
            target: "judgment_opening",
            actions: ["setJudgmentStage"],
          },
          {
            target: "lobby",
          },
        ],
      },

      // =====================================================================
      // THE RECKONING (4 -> 3 players)
      // =====================================================================

      reckoning_lobby: {
        entry: [
          "incrementRound",
          "resetRoundState",
          { type: "emitPhaseStarted", params: { phase: Phase.LOBBY } },
        ],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.LOBBY } }],
        on: {
          PHASE_COMPLETE: "reckoning_whisper",
          UPDATE_ALIVE_PLAYERS: { actions: ["updateAlivePlayers"] },
        },
      },

      reckoning_whisper: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.WHISPER } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.WHISPER } }],
        on: {
          PHASE_COMPLETE: "reckoning_plea",
        },
      },

      reckoning_plea: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.PLEA } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.PLEA } }],
        on: {
          PHASE_COMPLETE: "reckoning_vote",
        },
      },

      reckoning_vote: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.VOTE } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.VOTE } }],
        on: {
          PLAYER_ELIMINATED: {
            actions: ["recordEliminated", "addToJury"],
          },
          UPDATE_ALIVE_PLAYERS: {
            actions: ["updateAlivePlayers"],
          },
          PHASE_COMPLETE: "checkGameOver",
        },
      },

      // =====================================================================
      // THE TRIBUNAL (3 -> 2 players)
      // =====================================================================

      tribunal_lobby: {
        entry: [
          "incrementRound",
          "resetRoundState",
          { type: "emitPhaseStarted", params: { phase: Phase.LOBBY } },
        ],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.LOBBY } }],
        on: {
          PHASE_COMPLETE: "tribunal_accusation",
          UPDATE_ALIVE_PLAYERS: { actions: ["updateAlivePlayers"] },
        },
      },

      tribunal_accusation: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.ACCUSATION } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.ACCUSATION } }],
        on: {
          PHASE_COMPLETE: "tribunal_defense",
        },
      },

      tribunal_defense: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.DEFENSE } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.DEFENSE } }],
        on: {
          PHASE_COMPLETE: "tribunal_vote",
        },
      },

      tribunal_vote: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.VOTE } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.VOTE } }],
        on: {
          PLAYER_ELIMINATED: {
            actions: ["recordEliminated", "addToJury"],
          },
          UPDATE_ALIVE_PLAYERS: {
            actions: ["updateAlivePlayers"],
          },
          PHASE_COMPLETE: "checkGameOver",
        },
      },

      // =====================================================================
      // THE JUDGMENT (2 finalists -- Jury Finale)
      // =====================================================================

      judgment_opening: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.OPENING_STATEMENTS } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.OPENING_STATEMENTS } }],
        on: {
          PHASE_COMPLETE: "judgment_jury_questions",
        },
      },

      judgment_jury_questions: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.JURY_QUESTIONS } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.JURY_QUESTIONS } }],
        on: {
          PHASE_COMPLETE: "judgment_closing",
        },
      },

      judgment_closing: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.CLOSING_ARGUMENTS } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.CLOSING_ARGUMENTS } }],
        on: {
          PHASE_COMPLETE: "judgment_jury_vote",
        },
      },

      judgment_jury_vote: {
        entry: [{ type: "emitPhaseStarted", params: { phase: Phase.JURY_VOTE } }],
        exit: [{ type: "emitPhaseEnded", params: { phase: Phase.JURY_VOTE } }],
        on: {
          JURY_WINNER_DETERMINED: {
            actions: ["setJuryWinner"],
          },
          PHASE_COMPLETE: "end",
        },
      },

      // =====================================================================
      // End
      // =====================================================================

      end: {
        type: "final",
        entry: ["emitGameOver"],
      },
    },
  });
}

export type PhaseMachine = ReturnType<typeof createPhaseMachine>;
