/**
 * Mock agent for deterministic testing — no LLM calls.
 * Uses simple scripted strategies to validate game mechanics.
 */

import type { AgentResponse, IAgent, PhaseContext, PowerLobbyExposure } from "../game-runner";
import type { UUID, PowerAction } from "../types";

/** Assert a value is defined — throws in tests if assumption is violated */
function defined<T>(value: T | undefined, msg = "Expected value to be defined"): T {
  if (value === undefined) throw new Error(msg);
  return value;
}

/** Helper to wrap a message string into an AgentResponse */
function respond(message: string, thinking = ""): AgentResponse {
  return { thinking, message };
}

export class MockAgent implements IAgent {
  readonly id: UUID;
  readonly name: string;

  /** Optional override for endgame elimination vote target */
  eliminationTarget?: UUID;
  /** Optional override for accusation target */
  accusationTarget?: UUID;
  /** Optional override for jury vote target */
  juryVoteTarget?: UUID;

  constructor(id: UUID, name: string) {
    this.id = id;
    this.name = name;
  }

  onGameStart(_gameId: UUID, _allPlayers: Array<{ id: UUID; name: string }>): void {}

  async onPhaseStart(_ctx: PhaseContext): Promise<void> {}

  async getIntroduction(_ctx: PhaseContext): Promise<AgentResponse> {
    return respond(`Hello, I'm ${this.name}. I'm here to play strategically and win!`, `Introducing myself as ${this.name}`);
  }

  async getLobbyMessage(ctx: PhaseContext): Promise<AgentResponse> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    const target = others[ctx.round % others.length];
    return respond(
      `Round ${ctx.round}: I think ${target?.name ?? "everyone"} is playing well. Let's keep things interesting!`,
      `Lobby strategy: stay social, mention ${target?.name ?? "everyone"}`,
    );
  }

  async getWhispers(
    ctx: PhaseContext,
  ): Promise<Array<{ to: UUID[]; text: string }>> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    if (others.length === 0) return [];

    // Whisper to first available player
    const target = defined(others[0], "Expected at least one other player to whisper to");
    return [
      {
        to: [target.id],
        text: `Hey ${target.name}, want to work together? Let's not target each other.`,
      },
    ];
  }

  async chooseWhisperRoom(ctx: PhaseContext): Promise<number | null> {
    const roomCount = ctx.roomCount ?? 1;
    if (roomCount < 1) return null;
    const myIndex = ctx.alivePlayers.findIndex((p) => p.id === this.id);
    return (myIndex % roomCount) + 1;
  }

  async sendRoomMessage(_ctx: PhaseContext, roomMates: string[], conversationHistory?: Array<{ from: string; text: string }>): Promise<AgentResponse | null> {
    // Send one message, then pass on subsequent turns
    const alreadySpoke = conversationHistory?.some((m) => m.from === this.name) ?? false;
    if (alreadySpoke) return null;
    const others = roomMates.filter((name) => name !== this.name);
    if (others.length === 0) return null;
    return respond(
      `${others.join(", ")}, let's compare notes before the vote.`,
      `Open-room group whisper to ${others.join(", ")}`,
    );
  }

  async getRumorMessage(ctx: PhaseContext): Promise<AgentResponse> {
    return respond(
      `Round ${ctx.round} rumor from ${this.name}: Keep your friends close!`,
      `Spreading a general rumor`,
    );
  }

  async getVotes(
    ctx: PhaseContext,
  ): Promise<{ empowerTarget: UUID; exposeTarget: UUID }> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    if (others.length === 0) {
      return { empowerTarget: this.id, exposeTarget: this.id };
    }

    // Always empower the first other player, expose the last
    const empowerTarget = defined(others[0], "Expected at least one other player to empower").id;
    const exposeTarget = defined(others[others.length - 1], "Expected at least one other player to expose").id;
    return { empowerTarget, exposeTarget };
  }

  async getPowerLobbyMessage(
    ctx: PhaseContext,
    candidates: [UUID, UUID],
    exposePressure: PowerLobbyExposure[],
  ): Promise<AgentResponse> {
    const empoweredName = ctx.alivePlayers.find((p) => p.id === ctx.empoweredId)?.name ?? "the empowered player";
    const candidateNames = candidates.map(
      (id) => ctx.alivePlayers.find((p) => p.id === id)?.name ?? id,
    );
    const topPressure = exposePressure[0]?.name ?? candidateNames[0] ?? "the exposed players";
    const role = candidates.includes(this.id) ? "I need to redirect the vote" : `look closely at ${topPressure}`;
    return respond(
      `${empoweredName}, this power choice matters. ${role}; ${candidateNames.join(" and ")} should both answer for the expose vote.`,
      `Power lobby: address ${empoweredName} and candidates ${candidateNames.join(", ")}`,
    );
  }

  async getPowerAction(
    ctx: PhaseContext,
    candidates: [UUID, UUID],
  ): Promise<PowerAction> {
    // Always pass to council (simplest action)
    return { action: "pass", target: candidates[0] };
  }

  async getCouncilVote(ctx: PhaseContext, candidates: [UUID, UUID]): Promise<UUID> {
    // Always vote for the first candidate
    return candidates[0];
  }

  async getLastMessage(_ctx: PhaseContext): Promise<AgentResponse> {
    return respond(
      `${this.name} here — well played, everyone. See you on the other side.`,
      `Preparing my final words`,
    );
  }

  async getDiaryEntry(_ctx: PhaseContext, question: string, _sessionHistory?: Array<{ question: string; answer: string }>): Promise<AgentResponse> {
    return respond(
      `[Diary Room] The House asked: "${question}" — My thoughts: staying the course, watching the others carefully. Trust is earned, not given.`,
      `Reflecting on the question: ${question}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Endgame methods
  // ---------------------------------------------------------------------------

  async getPlea(_ctx: PhaseContext): Promise<AgentResponse> {
    return respond(
      `I, ${this.name}, have played with integrity. I deserve to stay because I've been loyal to my alliances and made strategic moves when it counted.`,
      `Making my plea to survive`,
    );
  }

  async getEndgameEliminationVote(ctx: PhaseContext): Promise<UUID> {
    if (this.eliminationTarget) return this.eliminationTarget;
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    // Vote for the last player in the list
    return others[others.length - 1]?.id ?? this.id;
  }

  async getAccusation(ctx: PhaseContext): Promise<{ targetId: UUID; text: string; thinking?: string }> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    const target = defined(
      this.accusationTarget
        ? others.find((p) => p.id === this.accusationTarget) ?? others[0]
        : others[0],
      "Expected at least one other player to accuse",
    );
    return {
      targetId: target.id,
      text: `I accuse ${target.name} of playing a deceptive game. They can't be trusted.`,
      thinking: `Targeting ${target.name} for accusation`,
    };
  }

  async getDefense(_ctx: PhaseContext, accusation: string, accuserName: string): Promise<AgentResponse> {
    return respond(
      `${accuserName} accuses me, but I have played honestly. Their claims are baseless. I've been a reliable ally throughout this game.`,
      `Defending against ${accuserName}'s accusation`,
    );
  }

  async getOpeningStatement(_ctx: PhaseContext): Promise<AgentResponse> {
    return respond(
      `Members of the jury, I am ${this.name}. I played this game with strategy and heart. I built genuine alliances and made tough decisions when they mattered most. I ask for your vote because I earned my place here.`,
      `Making my opening statement to the jury`,
    );
  }

  async getJuryQuestion(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<{ targetFinalistId: UUID; question: string; thinking?: string }> {
    // Always ask the first finalist
    return {
      targetFinalistId: finalistIds[0],
      question: "What was the single most important move you made in this game, and why?",
      thinking: "Asking about their key strategic move",
    };
  }

  async getJuryAnswer(_ctx: PhaseContext, _question: string, _jurorName: string): Promise<AgentResponse> {
    return respond(
      `That's a great question. My most important move was building trust early and staying true to my word. That's what got me to the final two.`,
      `Answering the jury question`,
    );
  }

  async getClosingArgument(_ctx: PhaseContext): Promise<AgentResponse> {
    return respond(
      `In closing, I played the best game I could. I was strategic but honest, and I never forgot that this is about people, not just moves. Vote for me.`,
      `Making my final argument`,
    );
  }

  async getJuryVote(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<UUID> {
    if (this.juryVoteTarget) return this.juryVoteTarget;
    // Vote for the first finalist
    return finalistIds[0];
  }

  // Memory methods (no-ops for mock)
  updateAlly(_playerName: string): void { /* no-op */ }
  updateThreat(_playerName: string): void { /* no-op */ }
  addNote(_playerName: string, _note: string): void { /* no-op */ }
  removeFromMemory(_playerName: string): void { /* no-op */ }
}
