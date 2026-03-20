/**
 * Mock agent for deterministic testing — no LLM calls.
 * Uses simple scripted strategies to validate game mechanics.
 */

import type { IAgent, PhaseContext } from "../game-runner";
import type { UUID, PowerAction } from "../types";

/** Assert a value is defined — throws in tests if assumption is violated */
function defined<T>(value: T | undefined, msg = "Expected value to be defined"): T {
  if (value === undefined) throw new Error(msg);
  return value;
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

  async getIntroduction(_ctx: PhaseContext): Promise<string> {
    return `Hello, I'm ${this.name}. I'm here to play strategically and win!`;
  }

  async getLobbyMessage(ctx: PhaseContext): Promise<string> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    const target = others[ctx.round % others.length];
    return `Round ${ctx.round}: I think ${target?.name ?? "everyone"} is playing well. Let's keep things interesting!`;
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

  async requestRoom(ctx: PhaseContext): Promise<UUID | null> {
    // Pair agents by position: 0↔1, 2↔3, 4↔5, etc. (creates mutual matches)
    const myIndex = ctx.alivePlayers.findIndex((p) => p.id === this.id);
    const partnerIndex = myIndex % 2 === 0 ? myIndex + 1 : myIndex - 1;
    const partner = ctx.alivePlayers[partnerIndex];
    if (partner && partner.id !== this.id) return partner.id;
    // Fallback to first other player
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    return others[0]?.id ?? null;
  }

  async sendRoomMessage(_ctx: PhaseContext, partnerName: string, conversationHistory?: Array<{ from: string; text: string }>): Promise<string | null> {
    // Send one message, then pass on subsequent turns
    const alreadySpoke = conversationHistory?.some((m) => m.from === this.name) ?? false;
    if (alreadySpoke) return null;
    return `Hey ${partnerName}, want to work together? Let's not target each other.`;
  }

  async getRumorMessage(ctx: PhaseContext): Promise<string> {
    return `Round ${ctx.round} rumor from ${this.name}: Keep your friends close!`;
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

  async getLastMessage(_ctx: PhaseContext): Promise<string> {
    return `${this.name} here — well played, everyone. See you on the other side.`;
  }

  async getDiaryEntry(_ctx: PhaseContext, question: string, _sessionHistory?: Array<{ question: string; answer: string }>): Promise<string> {
    return `[Diary Room] The House asked: "${question}" — My thoughts: staying the course, watching the others carefully. Trust is earned, not given.`;
  }

  // ---------------------------------------------------------------------------
  // Endgame methods
  // ---------------------------------------------------------------------------

  async getPlea(_ctx: PhaseContext): Promise<string> {
    return `I, ${this.name}, have played with integrity. I deserve to stay because I've been loyal to my alliances and made strategic moves when it counted.`;
  }

  async getEndgameEliminationVote(ctx: PhaseContext): Promise<UUID> {
    if (this.eliminationTarget) return this.eliminationTarget;
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    // Vote for the last player in the list
    return others[others.length - 1]?.id ?? this.id;
  }

  async getAccusation(ctx: PhaseContext): Promise<{ targetId: UUID; text: string }> {
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
    };
  }

  async getDefense(_ctx: PhaseContext, accusation: string, accuserName: string): Promise<string> {
    return `${accuserName} accuses me, but I have played honestly. Their claims are baseless. I've been a reliable ally throughout this game.`;
  }

  async getOpeningStatement(_ctx: PhaseContext): Promise<string> {
    return `Members of the jury, I am ${this.name}. I played this game with strategy and heart. I built genuine alliances and made tough decisions when they mattered most. I ask for your vote because I earned my place here.`;
  }

  async getJuryQuestion(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<{ targetFinalistId: UUID; question: string }> {
    // Always ask the first finalist
    return {
      targetFinalistId: finalistIds[0],
      question: "What was the single most important move you made in this game, and why?",
    };
  }

  async getJuryAnswer(_ctx: PhaseContext, _question: string, _jurorName: string): Promise<string> {
    return `That's a great question. My most important move was building trust early and staying true to my word. That's what got me to the final two.`;
  }

  async getClosingArgument(_ctx: PhaseContext): Promise<string> {
    return `In closing, I played the best game I could. I was strategic but honest, and I never forgot that this is about people, not just moves. Vote for me.`;
  }

  async getJuryVote(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<UUID> {
    if (this.juryVoteTarget) return this.juryVoteTarget;
    // Vote for the first finalist
    return finalistIds[0];
  }
}
