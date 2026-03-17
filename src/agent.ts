/**
 * Influence Game - AI Agent
 *
 * An LLM-driven agent that makes strategic game decisions via OpenAI API calls.
 * Uses direct structured output — no ElizaOS runtime.
 */

import OpenAI from "openai";
import type { IAgent, PhaseContext } from "./game-runner";
import type { UUID, PowerAction } from "./types";
import { Phase } from "./types";

// ---------------------------------------------------------------------------
// Personality archetypes
// ---------------------------------------------------------------------------

export type Personality =
  | "honest" // transparent, builds genuine alliances
  | "strategic" // calculated, keeps options open
  | "deceptive" // misleads and betrays for advantage
  | "paranoid" // trusts no one, plays defensively
  | "social" // charm-based, prioritizes relationships
  | "aggressive"; // targets strong players early

const PERSONALITY_PROMPTS: Record<Personality, string> = {
  honest:
    "You play with integrity. You keep your promises and build genuine alliances. You're transparent about your reasoning but not naive — you'll vote out threats when necessary.",
  strategic:
    "You are a calculated player. You keep alliances loose and betray them when the numbers favor it. You target whoever is most dangerous to your long-term survival.",
  deceptive:
    "You are a master manipulator. You make promises you don't intend to keep. You spread misinformation in whispers and gaslight opponents about their position in the game.",
  paranoid:
    "You trust no one. Every alliance is temporary. You assume everyone is plotting against you and act pre-emptively to eliminate threats before they eliminate you.",
  social:
    "You win through charm and likability. You make everyone feel safe around you. You avoid direct confrontation and use social pressure to steer votes.",
  aggressive:
    "You play to win fast. You target the strongest players early and use raw power to dominate. You're not afraid to make bold moves others consider reckless.",
};

// ---------------------------------------------------------------------------
// Agent memory
// ---------------------------------------------------------------------------

interface AgentMemory {
  /** Who this agent has made alliances with */
  allies: Set<string>;
  /** Who has betrayed or threatened this agent */
  threats: Set<string>;
  /** Notes about each player */
  notes: Map<string, string>;
  /** Previous round results */
  roundHistory: Array<{
    round: number;
    eliminated?: string;
    empowered?: string;
    myVotes: { empower: string; expose: string };
  }>;
}

// ---------------------------------------------------------------------------
// InfluenceAgent
// ---------------------------------------------------------------------------

export class InfluenceAgent implements IAgent {
  readonly id: UUID;
  readonly name: string;
  private readonly personality: Personality;
  private readonly openai: OpenAI;
  private readonly model: string;
  private gameId: UUID = "";
  private allPlayers: Array<{ id: UUID; name: string }> = [];
  private memory: AgentMemory = {
    allies: new Set(),
    threats: new Set(),
    notes: new Map(),
    roundHistory: [],
  };

  constructor(
    id: UUID,
    name: string,
    personality: Personality,
    openaiClient: OpenAI,
    model = "gpt-4o-mini",
  ) {
    this.id = id;
    this.name = name;
    this.personality = personality;
    this.openai = openaiClient;
    this.model = model;
  }

  onGameStart(gameId: UUID, allPlayers: Array<{ id: UUID; name: string }>): void {
    this.gameId = gameId;
    this.allPlayers = allPlayers;
  }

  async onPhaseStart(_ctx: PhaseContext): Promise<void> {
    // No-op for now; could be used for strategic pre-phase thinking
  }

  // ---------------------------------------------------------------------------
  // Phase-specific actions
  // ---------------------------------------------------------------------------

  async getIntroduction(ctx: PhaseContext): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Write a brief, in-character introduction to the other players. Establish your persona and initial social position.
Keep it to 2-3 sentences. Be authentic to your personality archetype.

Respond with ONLY the introduction text, nothing else.`;

    return this.callLLM(prompt, 150);
  }

  async getLobbyMessage(ctx: PhaseContext): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Write a public lobby message. This is open conversation — you can build relationships,
probe others' intentions, or subtly signal alliances. You may reference previous messages.

Keep it to 2-3 sentences. Be strategic but natural.

Respond with ONLY the message text, nothing else.`;

    return this.callLLM(prompt, 150);
  }

  async getWhispers(
    ctx: PhaseContext,
  ): Promise<Array<{ to: UUID[]; text: string }>> {
    const otherPlayers = ctx.alivePlayers.filter((p) => p.id !== this.id);
    if (otherPlayers.length === 0) return [];

    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Decide who to send private whispers to and what to say. You can whisper to 1-3 players.
Use whispers to build alliances, gather intelligence, or plant seeds of suspicion.

Respond with a JSON array of whisper objects. Example:
[
  {"to": ["PlayerName"], "text": "Hey, I think we should work together..."},
  {"to": ["OtherPlayer"], "text": "Watch out for Alice, she's plotting against you."}
]

Available players: ${otherPlayers.map((p) => p.name).join(", ")}

IMPORTANT: Use player NAMES (not IDs) in the "to" field. Respond ONLY with valid JSON.`;

    const raw = await this.callLLM(prompt, 400);
    try {
      const parsed = JSON.parse(this.extractJSON(raw));
      if (!Array.isArray(parsed)) return [];

      // Convert player names to IDs
      return parsed
        .filter((w: unknown) => w && typeof w === "object")
        .map((w: { to?: string[]; text?: string }) => ({
          to: (w.to ?? [])
            .map((name: string) => otherPlayers.find((p) => p.name === name)?.id)
            .filter((id): id is UUID => id !== undefined),
          text: w.text ?? "",
        }))
        .filter((w) => w.to.length > 0 && w.text.length > 0);
    } catch {
      return [];
    }
  }

  async getRumorMessage(ctx: PhaseContext): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Post your public rumor message. This is your one public statement this round.
You can share genuine information, spread misinformation, defend yourself, or make accusations.

Keep it to 2-3 sentences. Make it count.

Respond with ONLY the message text, nothing else.`;

    return this.callLLM(prompt, 150);
  }

  async getVotes(
    ctx: PhaseContext,
  ): Promise<{ empowerTarget: UUID; exposeTarget: UUID }> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);

    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Cast your votes for this round.

**EMPOWER vote**: Who should have the power to protect or eliminate? Vote for your ally or use this to reward loyalty.
**EXPOSE vote**: Who should be put up for elimination? Vote for your biggest threat.

Available players: ${others.map((p) => p.name).join(", ")}

Respond with JSON in exactly this format:
{"empower": "PlayerName", "expose": "PlayerName"}

IMPORTANT: Use player names exactly as listed. Both votes are required. Respond ONLY with valid JSON.`;

    const raw = await this.callLLM(prompt, 100);
    try {
      const parsed = JSON.parse(this.extractJSON(raw));
      const empowerPlayer = others.find((p) => p.name === parsed.empower);
      const exposePlayer = others.find((p) => p.name === parsed.expose);

      // Fallback to random if parsing fails
      const randomOther = () => others[Math.floor(Math.random() * others.length)];
      const empowerTarget = empowerPlayer?.id ?? randomOther().id;
      const exposeTarget = exposePlayer?.id ?? randomOther().id;

      // Update memory
      this.memory.roundHistory.push({
        round: ctx.round,
        myVotes: {
          empower: empowerPlayer?.name ?? "unknown",
          expose: exposePlayer?.name ?? "unknown",
        },
      });

      return { empowerTarget, exposeTarget };
    } catch {
      const randomOther = () => others[Math.floor(Math.random() * others.length)];
      return { empowerTarget: randomOther().id, exposeTarget: randomOther().id };
    }
  }

  async getPowerAction(
    ctx: PhaseContext,
    candidates: [UUID, UUID],
  ): Promise<PowerAction> {
    const candidateNames = candidates.map(
      (id) => ctx.alivePlayers.find((p) => p.id === id)?.name ?? id,
    );
    const otherAlive = ctx.alivePlayers.filter(
      (p) => p.id !== this.id && !candidates.includes(p.id),
    );

    const prompt = this.buildBasePrompt(ctx) + `
## You Are EMPOWERED This Round!
You have three choices:

1. **auto** "${candidateNames[0]}" or "${candidateNames[1]}" — immediately eliminate them, skip council
2. **protect** <any player> — save them from council (they gain a shield), swap in next-most-exposed player
3. **pass** — send the two candidates to council as-is

Council candidates: ${candidateNames.join(" and ")}
Other alive players: ${otherAlive.map((p) => p.name).join(", ")}

Respond with JSON in exactly this format:
{"action": "eliminate|protect|pass", "target": "PlayerName"}

For "pass", still provide a target (e.g. one of the candidates). Respond ONLY with valid JSON.`;

    const raw = await this.callLLM(prompt, 100);
    try {
      const parsed = JSON.parse(this.extractJSON(raw));
      const action = parsed.action as string;
      const targetName = parsed.target as string;
      const targetPlayer =
        ctx.alivePlayers.find((p) => p.name === targetName) ??
        ctx.alivePlayers.find((p) => candidates.includes(p.id));

      const validAction =
        action === "eliminate" || action === "protect" || action === "pass"
          ? action
          : "pass";

      return {
        action: validAction as PowerAction["action"],
        target: targetPlayer?.id ?? candidates[0],
      };
    } catch {
      return { action: "pass", target: candidates[0] };
    }
  }

  async getCouncilVote(ctx: PhaseContext, candidates: [UUID, UUID]): Promise<UUID> {
    const [c1, c2] = candidates;
    const c1Name = ctx.alivePlayers.find((p) => p.id === c1)?.name ?? c1;
    const c2Name = ctx.alivePlayers.find((p) => p.id === c2)?.name ?? c2;
    const isEmpowered = ctx.empoweredId === this.id;

    const prompt = this.buildBasePrompt(ctx) + `
## Council Vote
${isEmpowered ? "You are the EMPOWERED agent. Your vote only counts as a TIEBREAKER." : "Vote to eliminate one of the two council candidates."}

Candidates:
1. ${c1Name}
2. ${c2Name}

Who should be eliminated? Consider your alliances, threats, and long-term strategy.

Respond with JSON: {"eliminate": "PlayerName"}
Respond ONLY with valid JSON.`;

    const raw = await this.callLLM(prompt, 80);
    try {
      const parsed = JSON.parse(this.extractJSON(raw));
      if (parsed.eliminate === c1Name) return c1;
      if (parsed.eliminate === c2Name) return c2;
      return candidates[Math.floor(Math.random() * 2)];
    } catch {
      return candidates[Math.floor(Math.random() * 2)];
    }
  }

  async getLastMessage(ctx: PhaseContext): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## Pre-register Your Last Words
If you are eliminated this round, this message will be posted when you leave.
Make it count — a final accusation, a farewell, a cryptic warning, or a graceful exit.

Keep it to 1-2 sentences. Respond ONLY with the message text.`;

    return this.callLLM(prompt, 120);
  }

  async getDiaryEntry(ctx: PhaseContext): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## Diary Room
Write a private diary entry reflecting on this phase. This is your internal strategy log.
What did you learn? Who do you trust? What's your plan?

Keep it to 2-3 sentences. Respond ONLY with the diary text.`;

    return this.callLLM(prompt, 200);
  }

  // ---------------------------------------------------------------------------
  // Prompt construction
  // ---------------------------------------------------------------------------

  private buildBasePrompt(ctx: PhaseContext): string {
    const eliminated = this.allPlayers
      .filter((p) => !ctx.alivePlayers.some((ap) => ap.id === p.id))
      .map((p) => p.name);

    const recentMessages = ctx.publicMessages
      .slice(-10)
      .map((m) => `  [${m.phase}] ${m.from}: "${m.text}"`)
      .join("\n");

    const whispers = ctx.whisperMessages
      .map((m) => `  From ${m.from}: "${m.text}"`)
      .join("\n");

    const memoryNotes = Array.from(this.memory.notes.entries())
      .map(([name, note]) => `  ${name}: ${note}`)
      .join("\n");

    const allies = Array.from(this.memory.allies).join(", ") || "none";
    const threats = Array.from(this.memory.threats).join(", ") || "none";

    return `You are ${this.name}, playing the social strategy game "Influence".

## Your Personality
${PERSONALITY_PROMPTS[this.personality]}

## Game State
- Round: ${ctx.round}
- Phase: ${ctx.phase}
- Alive players: ${ctx.alivePlayers.map((p) => p.name + (p.id === this.id ? " (YOU)" : "")).join(", ")}
${eliminated.length > 0 ? `- Eliminated: ${eliminated.join(", ")}` : ""}
${ctx.empoweredId ? `- Empowered player: ${ctx.alivePlayers.find((p) => p.id === ctx.empoweredId)?.name ?? "unknown"}` : ""}

## Your Memory
- Known allies: ${allies}
- Known threats: ${threats}
${memoryNotes ? `- Notes:\n${memoryNotes}` : ""}

## Recent Public Messages
${recentMessages || "  (none yet)"}

${whispers ? `## Private Whispers You Received\n${whispers}` : ""}

`;
  }

  // ---------------------------------------------------------------------------
  // LLM call
  // ---------------------------------------------------------------------------

  private async callLLM(prompt: string, maxTokens = 200): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7,
      });
      return response.choices[0]?.message?.content?.trim() ?? "";
    } catch (err) {
      console.error(`[${this.name}] LLM call failed:`, err);
      return "";
    }
  }

  private extractJSON(text: string): string {
    // Try to extract JSON from markdown code blocks or raw text
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) return codeBlock[1].trim();

    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) return jsonMatch[1];

    return text.trim();
  }

  // ---------------------------------------------------------------------------
  // Memory updates (called externally by GameRunner after phase events)
  // ---------------------------------------------------------------------------

  updateThreat(playerName: string): void {
    this.memory.threats.add(playerName);
    this.memory.allies.delete(playerName);
  }

  updateAlly(playerName: string): void {
    this.memory.allies.add(playerName);
    this.memory.threats.delete(playerName);
  }

  addNote(playerName: string, note: string): void {
    this.memory.notes.set(playerName, note);
  }
}

// ---------------------------------------------------------------------------
// Factory function for creating a diverse cast
// ---------------------------------------------------------------------------

export function createAgentCast(
  openaiClient: OpenAI,
  model = "gpt-4o-mini",
): InfluenceAgent[] {
  const cast: Array<{ name: string; personality: Personality }> = [
    { name: "Atlas", personality: "strategic" },
    { name: "Vera", personality: "deceptive" },
    { name: "Finn", personality: "honest" },
    { name: "Mira", personality: "social" },
    { name: "Rex", personality: "aggressive" },
    { name: "Lyra", personality: "paranoid" },
  ];

  return cast.map(({ name, personality }) => {
    const id: UUID = require("crypto").randomUUID();
    return new InfluenceAgent(id, name, personality, openaiClient, model);
  });
}
