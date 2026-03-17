/**
 * Mock agent for deterministic testing — no LLM calls.
 * Uses simple scripted strategies to validate game mechanics.
 */

import type { IAgent, PhaseContext } from "../game-runner";
import type { UUID, PowerAction } from "../types";
import { createUUID } from "../game-state";

export class MockAgent implements IAgent {
  readonly id: UUID;
  readonly name: string;

  constructor(id: UUID, name: string) {
    this.id = id;
    this.name = name;
  }

  onGameStart(_gameId: UUID, _allPlayers: Array<{ id: UUID; name: string }>): void {}

  async onPhaseStart(_ctx: PhaseContext): Promise<void> {}

  async getIntroduction(ctx: PhaseContext): Promise<string> {
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
    const target = others[0];
    return [
      {
        to: [target.id],
        text: `Hey ${target.name}, want to work together? Let's not target each other.`,
      },
    ];
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
    const empowerTarget = others[0].id;
    const exposeTarget = others[others.length - 1].id;
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

  async getDiaryEntry(_ctx: PhaseContext): Promise<string> {
    return `Private thoughts: staying the course, watching the others carefully.`;
  }
}
