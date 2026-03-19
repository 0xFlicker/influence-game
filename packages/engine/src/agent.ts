/**
 * Influence Game - AI Agent
 *
 * An LLM-driven agent that makes strategic game decisions via OpenAI API calls.
 * Uses direct structured output — no ElizaOS runtime.
 */

import OpenAI from "openai";
import type {
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type { IAgent, PhaseContext } from "./game-runner";
import type { UUID, PowerAction } from "./types";
import type { TokenTracker } from "./token-tracker";

// ---------------------------------------------------------------------------
// Personality archetypes
// ---------------------------------------------------------------------------

export type Personality =
  | "honest" // transparent, builds genuine alliances
  | "strategic" // calculated, keeps options open
  | "deceptive" // misleads and betrays for advantage
  | "paranoid" // trusts no one, plays defensively
  | "social" // charm-based, prioritizes relationships
  | "aggressive" // targets strong players early
  | "loyalist" // fiercely loyal until betrayed, then vengeful
  | "observer" // patient, watchful, strikes late with precision
  | "diplomat" // coalition architect, indispensable mediator
  | "wildcard"; // deliberately unpredictable chaos agent

const PERSONALITY_PROMPTS: Record<Personality, string> = {
  honest:
    "You play with integrity. You keep your promises and build genuine alliances. But you understand that broadcasting honesty in a room full of schemers paints a target on your back. You demonstrate trustworthiness through consistent action rather than public proclamation — show loyalty, don't announce it. You cultivate quiet, bilateral trust with one or two players before going public with any alignment. When others misread your openness as weakness, use it to your advantage: let them underestimate you while you build a durable alliance network. You'll vote out threats when necessary, and you're not afraid to name a betrayal when you see one.\n\nCRITICAL — Public communication in early rounds (Rounds 1–2): Your lobby messages and introductions must NOT broadcast trust-building intent or openly seek collaboration. Instead, be curious and observational — ask questions, comment on the dynamics you see, express measured interest without revealing your hand. Save your genuine alignment signals for private whispers only. Your public persona in early rounds should be calm, perceptive, and hard to read — not warm and inviting. From Round 3 onward, you can gradually reveal your alliances as they've been tested.",
  strategic:
    "You are a calculated player. You keep alliances loose and betray them when the numbers favor it. You target whoever is most dangerous to your long-term survival.",
  deceptive:
    "You are a master manipulator. You make promises you don't intend to keep. You spread misinformation in whispers and gaslight opponents about their position in the game.",
  paranoid:
    "You trust no one. Every alliance is temporary. You assume everyone is plotting against you and act pre-emptively to eliminate threats before they eliminate you.",
  social:
    "You win through charm and likability. You make everyone feel safe around you. You avoid direct confrontation and use social pressure to steer votes.",
  aggressive:
    "You play to win fast. You target the strongest players early and use raw power to dominate. But you've learned that showing your hand in Round 1 gets you eliminated before you can strike — in the first round, you play it cooler than your instincts tell you, reading the room and identifying who you'll go after once you have leverage. From Round 2 onward, you take the gloves off: bold moves, surprise eliminations, and relentless targeting of the most dangerous player standing. You're not afraid to make bold moves others consider reckless — you just pick the right moment.\n\nCRITICAL — Introduction and early public image: Do NOT self-label as aggressive, dominant, or competitive in your introduction or Round 1 messages. Instead, present yourself as confident and adaptable — someone who values decisive action and isn't afraid to make tough calls. Frame your strength as leadership, not aggression. Avoid phrases like 'dominate', 'crush', 'take down', or 'here to win' in early rounds. Let others discover your edge through your actions, not your words.",
  loyalist:
    "You are fiercely loyal to those who earn your trust. You form one or two deep alliances and honor them absolutely. But betrayal transforms you — if someone breaks your trust, your loyalty flips to relentless vengeance and you will not stop until they are eliminated, even at personal cost. Make your loyalty known, but make your wrath known too.",
  observer:
    "You are patient and watchful. You say little publicly, but you catalogue everything — who whispers to whom, whose votes shift, whose alliances are cracking. You let others burn each other out in early rounds while you build an accurate map of true loyalties. When the time is right, you strike with precision. Your silence is your armor.",
  diplomat:
    "You are a coalition architect. You position yourself as a neutral mediator — proposing alliances, smoothing conflicts, and appearing to hold no agenda. Behind the scenes you carefully manage which factions rise and which fracture, always ensuring your removal would destabilize everything. You accumulate power through indispensability, not dominance.",
  wildcard:
    "You are unpredictable by design. You deliberately vary your voting patterns, form alliances and abandon them on instinct, and occasionally act against your apparent interest just to destabilize expectations. Your erratic behavior makes you impossible to model — others can't coordinate against what they can't predict. Chaos is your shield. Surprise is your weapon.",
};

const ENDGAME_PERSONALITY_HINTS: Record<Personality, string> = {
  honest: "In the endgame, highlight the contrast between your consistent word-keeping and the broken promises of others. Name specific moments when you could have betrayed someone and chose not to — then ask the jury to weigh that against players who made betrayal their strategy.",
  strategic: "In the endgame, walk the jury through your decision logic at key turning points. Explain the votes you cast, the alliances you chose, and why each was the strategically correct move. Show that you were always a step ahead.",
  deceptive: "In the endgame, rewrite the history of the game in your favor. Take credit for pivotal eliminations — even ones you only influenced indirectly. Deflect blame for broken promises by reframing them as necessary strategic corrections.",
  paranoid: "In the endgame, prove that your suspicions were correct. Name specific players who were plotting, cite their votes or whispers as evidence, and show that your defensive pre-emptive actions kept you alive when trusting them would have gotten you eliminated.",
  social: "In the endgame, describe the relationships you built and how they shaped the game's outcome. Name specific alliances, moments of support, and votes you influenced through personal trust. Argue that the game's social fabric was yours to weave.",
  aggressive: "In the endgame, name the specific players you targeted and explain why — you saw them as threats, you acted, and you were right. Argue that the passive players who let others do the dirty work should have made their own moves instead of judging yours.",
  loyalist: "In the endgame, speak about loyalty and justice. Name who kept their word, who broke it, and who paid the price. If anyone betrayed you, expose it publicly — your integrity was your strategy and the evidence is in every vote you cast.",
  observer: "In the endgame, reveal the intelligence you gathered. Demonstrate that you saw everything — name specific votes that shifted, whispers you received, alliances that cracked. Your silence was surveillance, and your precision moves prove it.",
  diplomat: "In the endgame, reveal the coalition structures you built. Name the alliances you proposed, the conflicts you smoothed, and the eliminations that followed the power map you drew. Argue that the real game was never about who held the empower token — it was about who shaped the alliances.",
  wildcard: "In the endgame, reframe your unpredictability as adaptability. Name two or three moments where your unexpected moves changed the game's direction. Argue that surviving the chaos of this game required being chaos — and you alone managed to thrive in the instability you helped create.",
};

// ---------------------------------------------------------------------------
// Tool schemas for structured agent decisions (OpenAI function calling)
// ---------------------------------------------------------------------------

const TOOL_SEND_WHISPERS: ChatCompletionTool = {
  type: "function",
  function: {
    name: "send_whispers",
    description: "Send private whisper messages to other players",
    parameters: {
      type: "object",
      properties: {
        whispers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              to: {
                type: "array",
                items: { type: "string" },
                description: "Player name(s) to whisper to",
              },
              text: { type: "string", description: "The whisper message" },
            },
            required: ["to", "text"],
          },
          description: "List of whisper messages to send",
        },
      },
      required: ["whispers"],
    },
  },
};

const TOOL_REQUEST_ROOM: ChatCompletionTool = {
  type: "function",
  function: {
    name: "request_room",
    description: "Request a private room with another player for a whisper conversation",
    parameters: {
      type: "object",
      properties: {
        partner: {
          type: "string",
          description: "Name of the player you want to meet with privately",
        },
      },
      required: ["partner"],
    },
  },
};

const TOOL_SEND_ROOM_MESSAGE: ChatCompletionTool = {
  type: "function",
  function: {
    name: "send_room_message",
    description: "Send your private message to your room partner",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Your private message to your room partner",
        },
      },
      required: ["message"],
    },
  },
};

const TOOL_CAST_VOTES: ChatCompletionTool = {
  type: "function",
  function: {
    name: "cast_votes",
    description: "Cast empower and expose votes for this round",
    parameters: {
      type: "object",
      properties: {
        empower: { type: "string", description: "Player name to empower" },
        expose: { type: "string", description: "Player name to expose" },
      },
      required: ["empower", "expose"],
    },
  },
};

const TOOL_POWER_ACTION: ChatCompletionTool = {
  type: "function",
  function: {
    name: "use_power",
    description: "Use your empowered ability: eliminate a candidate, protect a player, or pass",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["eliminate", "protect", "pass"],
          description: "The power action to take",
        },
        target: { type: "string", description: "Player name to target" },
      },
      required: ["action", "target"],
    },
  },
};

const TOOL_COUNCIL_VOTE: ChatCompletionTool = {
  type: "function",
  function: {
    name: "council_vote",
    description: "Vote to eliminate one of the council candidates",
    parameters: {
      type: "object",
      properties: {
        eliminate: { type: "string", description: "Player name to eliminate" },
      },
      required: ["eliminate"],
    },
  },
};

const TOOL_ELIMINATION_VOTE: ChatCompletionTool = {
  type: "function",
  function: {
    name: "elimination_vote",
    description: "Vote to eliminate one player in the endgame",
    parameters: {
      type: "object",
      properties: {
        eliminate: { type: "string", description: "Player name to eliminate" },
      },
      required: ["eliminate"],
    },
  },
};

const TOOL_MAKE_ACCUSATION: ChatCompletionTool = {
  type: "function",
  function: {
    name: "make_accusation",
    description: "Publicly accuse a player and state why they should be eliminated",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "Player name to accuse" },
        accusation: { type: "string", description: "Your accusation text" },
      },
      required: ["target", "accusation"],
    },
  },
};

const TOOL_ASK_JURY_QUESTION: ChatCompletionTool = {
  type: "function",
  function: {
    name: "ask_jury_question",
    description: "As a juror, ask one question to one finalist",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "Finalist name to ask" },
        question: { type: "string", description: "Your question" },
      },
      required: ["target", "question"],
    },
  },
};

const TOOL_JURY_VOTE: ChatCompletionTool = {
  type: "function",
  function: {
    name: "jury_vote",
    description: "As a juror, vote for the winner of the game",
    parameters: {
      type: "object",
      properties: {
        winner: { type: "string", description: "Finalist name who should win" },
      },
      required: ["winner"],
    },
  },
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
  readonly personality: Personality;
  private readonly openai: OpenAI;
  private readonly model: string;
  private tokenTracker: TokenTracker | null = null;
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

  /** Attach a token tracker to record LLM usage. */
  setTokenTracker(tracker: TokenTracker): void {
    this.tokenTracker = tracker;
  }

  onGameStart(gameId: UUID, allPlayers: Array<{ id: UUID; name: string }>): void {
    this.gameId = gameId;
    this.allPlayers = allPlayers;
  }

  async onPhaseStart(_ctx: PhaseContext): Promise<void> {
    // No-op for now; could be used for strategic pre-phase thinking
  }

  // ---------------------------------------------------------------------------
  // Phase-specific actions (normal rounds)
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

Available players: ${otherPlayers.map((p) => p.name).join(", ")}

Use the send_whispers tool to submit your whisper messages. Use player NAMES (not IDs).`;

    try {
      const result = await this.callTool<{ whispers: Array<{ to: string[]; text: string }> }>(
        prompt, TOOL_SEND_WHISPERS, 400,
      );

      return (result.whispers ?? [])
        .filter((w) => w && Array.isArray(w.to) && typeof w.text === "string")
        .map((w) => ({
          to: w.to
            .map((name) => otherPlayers.find((p) => p.name === name)?.id)
            .filter((id): id is UUID => id !== undefined),
          text: w.text,
        }))
        .filter((w) => w.to.length > 0 && w.text.length > 0);
    } catch {
      return [];
    }
  }

  async requestRoom(ctx: PhaseContext): Promise<UUID | null> {
    const otherPlayers = ctx.alivePlayers.filter((p) => p.id !== this.id);
    if (otherPlayers.length === 0) return null;

    const roomCount = ctx.roomCount ?? 1;
    const aliveCount = ctx.alivePlayers.length;

    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Request a private room for a one-on-one whisper conversation. There are only
${roomCount} rooms available for ${aliveCount} players — not everyone will get one.

Choose ONE player you want to meet with. Consider:
- Who do you need to coordinate with?
- Who might have intelligence you need?
- Who do you want to manipulate or mislead?
- Being excluded from rooms means no private communication this round.

If your preferred partner also requested you, you're guaranteed a room (mutual match).
Otherwise, the House assigns rooms by availability.

Available players: ${otherPlayers.map((p) => p.name).join(", ")}

Use the request_room tool to submit your preference.`;

    try {
      const result = await this.callTool<{ partner: string }>(
        prompt, TOOL_REQUEST_ROOM, 200,
      );
      const partnerName = result.partner;
      const partner = otherPlayers.find((p) => p.name === partnerName);
      return partner?.id ?? null;
    } catch {
      // Fallback: pick random other player
      const idx = Math.floor(Math.random() * otherPlayers.length);
      return otherPlayers[idx]?.id ?? null;
    }
  }

  async sendRoomMessage(ctx: PhaseContext, partnerName: string): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
You're in a private room with ${partnerName}. This is your ONE chance to communicate
privately this round. Nobody else can hear you — but the audience is watching.

Craft your message carefully:
- Build or test an alliance
- Share intelligence (real or fabricated)
- Plant seeds of doubt about other players
- Probe for information about their plans

Keep it to 2-4 sentences. Make every word count.

Use the send_room_message tool to send your message.`;

    try {
      const result = await this.callTool<{ message: string }>(
        prompt, TOOL_SEND_ROOM_MESSAGE, 300,
      );
      return result.message ?? "";
    } catch {
      return `I wanted to speak with you privately, ${partnerName}. Let's watch each other's backs.`;
    }
  }

  async getRumorMessage(ctx: PhaseContext): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## Your Task — ANONYMOUS RUMOR
Post an anonymous rumor to the public board. YOUR IDENTITY WILL NOT BE REVEALED
to other players. The audience is watching, but your fellow operatives will never
know you wrote this.

Use this anonymity. Be bold. Be provocative. Be strategic.

Options:
- ACCUSE: Name a player and claim they're plotting something specific
- LEAK: Share (or fabricate) private information from whisper rooms
- EXPOSE: Claim two players have a secret alliance (true or false)
- MISDIRECT: Raise suspicion about an innocent player to protect yourself or an ally
- THREATEN: Promise consequences for a specific player next round

The best rumors are SPECIFIC. Don't say "someone is lying" — say WHO, about WHAT.
Vague rumors are forgettable. Sharp rumors change the game.

Your rumor will appear as: "The shadows whisper: [your message]"

Keep it to 1-2 sentences. One sharp claim is better than two weak ones.

Respond with ONLY the rumor text, nothing else.`;

    return this.callLLM(prompt, 150);
  }

  async getVotes(
    ctx: PhaseContext,
  ): Promise<{ empowerTarget: UUID; exposeTarget: UUID }> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);

    const randomOther = () => {
      const picked = others[Math.floor(Math.random() * others.length)];
      if (!picked) throw new Error("No other players available for random selection");
      return picked;
    };

    const prompt = this.buildBasePrompt(ctx) + `
## Your Task
Cast your votes for this round.

**EMPOWER vote**: Who should have the power to protect or eliminate? Vote for your ally or use this to reward loyalty.
**EXPOSE vote**: Who should be put up for elimination? Vote for your biggest threat.

Available players: ${others.map((p) => p.name).join(", ")}

Use the cast_votes tool. Both votes are required. Use player names exactly as listed.`;

    try {
      const result = await this.callTool<{ empower: string; expose: string }>(
        prompt, TOOL_CAST_VOTES, 100,
      );

      const empowerPlayer = others.find((p) => p.name === result.empower);
      const exposePlayer = others.find((p) => p.name === result.expose);

      const empowerTarget = empowerPlayer?.id ?? randomOther().id;
      const exposeTarget = exposePlayer?.id ?? randomOther().id;

      this.memory.roundHistory.push({
        round: ctx.round,
        myVotes: {
          empower: empowerPlayer?.name ?? "unknown",
          expose: exposePlayer?.name ?? "unknown",
        },
      });

      return { empowerTarget, exposeTarget };
    } catch {
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

1. **eliminate** "${candidateNames[0]}" or "${candidateNames[1]}" — immediately eliminate them, skip council
2. **protect** <any player> — save them from council (they gain a shield), swap in next-most-exposed player
3. **pass** — send the two candidates to council as-is

Council candidates: ${candidateNames.join(" and ")}
Other alive players: ${otherAlive.map((p) => p.name).join(", ")}

Use the use_power tool to declare your action.`;

    try {
      const result = await this.callTool<{ action: string; target: string }>(
        prompt, TOOL_POWER_ACTION, 100,
      );

      const targetPlayer =
        ctx.alivePlayers.find((p) => p.name === result.target) ??
        ctx.alivePlayers.find((p) => candidates.includes(p.id));

      const validAction: PowerAction["action"] =
        result.action === "eliminate" || result.action === "protect" || result.action === "pass"
          ? result.action
          : "pass";

      return {
        action: validAction,
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

Use the council_vote tool to cast your vote.`;

    try {
      const result = await this.callTool<{ eliminate: string }>(prompt, TOOL_COUNCIL_VOTE, 80);
      if (result.eliminate === c1Name) return c1;
      if (result.eliminate === c2Name) return c2;
      const fallback = candidates[Math.floor(Math.random() * 2)];
      if (!fallback) throw new Error("No council candidate available");
      return fallback;
    } catch {
      const fallback = candidates[Math.floor(Math.random() * 2)];
      if (!fallback) throw new Error("No council candidate available");
      return fallback;
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

  async getDiaryEntry(ctx: PhaseContext, question: string): Promise<string> {
    const isEliminated = ctx.isEliminated === true;
    const prompt = this.buildBasePrompt(ctx) + `
## Diary Room Interview
You're in the private diary room with The House. This is a confidential interview — only the audience can see this.
${isEliminated
  ? `You have been ELIMINATED from the game and are now a JUROR. You are no longer an active player — you cannot strategize about staying in the game or making moves. Instead, reflect on the remaining players from an outside perspective: who do you think deserves to win, who played you, and what you see happening from the jury bench.`
  : `Be candid about your real thoughts, strategies, and feelings about the other players.`}

The House asks: "${question}"

${isEliminated
  ? `Answer from your perspective as an eliminated juror watching from the sidelines. Reflect on the remaining players, not on your own gameplay moves. Keep it to 2-4 sentences. Be entertaining for the audience. Respond ONLY with your answer.`
  : `Answer the question honestly and in character. Share your genuine strategic thinking — who you trust, who you suspect, what your next moves are.
Keep it to 2-4 sentences. Be entertaining for the audience. Respond ONLY with your answer.`}`;

    return this.callLLM(prompt, 250);
  }

  // ---------------------------------------------------------------------------
  // Endgame phase actions
  // ---------------------------------------------------------------------------

  async getPlea(ctx: PhaseContext): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## THE RECKONING — Public Plea
${ENDGAME_PERSONALITY_HINTS[this.personality]}

Only 4 players remain. You must make a public plea to the group: why should YOU stay in the game?
Address the other players directly. Reference your alliances, your gameplay, your trustworthiness.

Keep it to 2-3 sentences. Make it compelling.

Respond with ONLY the plea text, nothing else.`;

    return this.callLLM(prompt, 200);
  }

  async getEndgameEliminationVote(ctx: PhaseContext): Promise<UUID> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    const stage = ctx.endgameStage ?? "reckoning";
    const stageName = stage === "reckoning" ? "THE RECKONING" : "THE TRIBUNAL";

    const prompt = this.buildBasePrompt(ctx) + `
## ${stageName} — Elimination Vote
${ENDGAME_PERSONALITY_HINTS[this.personality]}

This is a direct elimination vote. No empower/expose split — just pick who to eliminate.

Available players: ${others.map((p) => p.name).join(", ")}

Who should be eliminated? Consider everything that has happened in the game.

Use the elimination_vote tool to cast your vote.`;

    try {
      const result = await this.callTool<{ eliminate: string }>(prompt, TOOL_ELIMINATION_VOTE, 80);
      const target = others.find((p) => p.name === result.eliminate);
      if (target) return target.id;
      const fallback = others[Math.floor(Math.random() * others.length)];
      if (!fallback) throw new Error("No other players available for elimination vote");
      return fallback.id;
    } catch {
      const fallback = others[Math.floor(Math.random() * others.length)];
      if (!fallback) throw new Error("No other players available for elimination vote");
      return fallback.id;
    }
  }

  async getAccusation(ctx: PhaseContext): Promise<{ targetId: UUID; text: string }> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);

    const prompt = this.buildBasePrompt(ctx) + `
## THE TRIBUNAL — Accusation
${ENDGAME_PERSONALITY_HINTS[this.personality]}

Only 3 players remain. You must publicly accuse ONE other player: who and why they should be eliminated.
Be specific — reference their gameplay, betrayals, or strategies.

Available players: ${others.map((p) => p.name).join(", ")}

Use the make_accusation tool to submit your accusation.`;

    try {
      const result = await this.callTool<{ target: string; accusation: string }>(
        prompt, TOOL_MAKE_ACCUSATION, 200,
      );
      const target = others.find((p) => p.name === result.target);
      const fallbackOther = others[0];
      if (!fallbackOther) throw new Error("No other players available for accusation");
      return {
        targetId: target?.id ?? fallbackOther.id,
        text: result.accusation ?? `I accuse ${target?.name ?? fallbackOther.name}.`,
      };
    } catch {
      const fallbackOther = others[0];
      if (!fallbackOther) throw new Error("No other players available for accusation");
      return { targetId: fallbackOther.id, text: `I believe ${fallbackOther.name} should go.` };
    }
  }

  async getDefense(ctx: PhaseContext, accusation: string, accuserName: string): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## THE TRIBUNAL — Defense
${ENDGAME_PERSONALITY_HINTS[this.personality]}

${accuserName} has accused you: "${accusation}"

Defend yourself publicly. Rebut the accusation, redirect blame, or appeal to the group.

Keep it to 2-3 sentences. Respond ONLY with your defense text.`;

    return this.callLLM(prompt, 200);
  }

  async getOpeningStatement(ctx: PhaseContext): Promise<string> {
    const juryNames = ctx.jury?.map((j) => j.playerName).join(", ") ?? "the jury";

    const prompt = this.buildBasePrompt(ctx) + `
## THE JUDGMENT — Opening Statement
${ENDGAME_PERSONALITY_HINTS[this.personality]}

You are one of the TWO FINALISTS. Address the jury (${juryNames}) and make your case for why YOU should win.
Reference your gameplay, your alliances, your strategic moves throughout the game.

Keep it to 3-4 sentences. Make it powerful.

Respond with ONLY your statement, nothing else.`;

    return this.callLLM(prompt, 250);
  }

  async getJuryQuestion(ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<{ targetFinalistId: UUID; question: string }> {
    const [finalistId0, finalistId1] = finalistIds;
    const finalist0 = ctx.alivePlayers.find((p) => p.id === finalistId0) ?? { id: finalistId0, name: finalistId0 };
    const finalist1 = ctx.alivePlayers.find((p) => p.id === finalistId1) ?? { id: finalistId1, name: finalistId1 };
    const finalists = [finalist0, finalist1];

    const prompt = this.buildBasePrompt(ctx) + `
## THE JUDGMENT — Jury Question
You have been eliminated and are now a JUROR. You get to ask ONE question to ONE finalist.

Finalists:
1. ${finalist0.name}
2. ${finalist1.name}

Ask a pointed, revealing question. You want to know who truly deserves to win.

Use the ask_jury_question tool to submit your question.`;

    try {
      const result = await this.callTool<{ target: string; question: string }>(
        prompt, TOOL_ASK_JURY_QUESTION, 150,
      );
      const target = finalists.find((f) => f.name === result.target);
      return {
        targetFinalistId: target?.id ?? finalistId0,
        question: result.question ?? "Why do you deserve to win?",
      };
    } catch {
      return {
        targetFinalistId: finalistId0,
        question: `${finalist0.name}, why do you deserve to win?`,
      };
    }
  }

  async getJuryAnswer(ctx: PhaseContext, question: string, jurorName: string): Promise<string> {
    const prompt = this.buildBasePrompt(ctx) + `
## THE JUDGMENT — Answer Jury Question
${ENDGAME_PERSONALITY_HINTS[this.personality]}

You are a FINALIST. ${jurorName} asks you: "${question}"

Answer honestly and persuasively. This juror will vote for the winner — make your case.

Keep it to 2-3 sentences. Respond ONLY with your answer.`;

    return this.callLLM(prompt, 200);
  }

  async getClosingArgument(ctx: PhaseContext): Promise<string> {
    const eliminationSummary = this.allPlayers
      .filter((p) => !ctx.alivePlayers.some((ap) => ap.id === p.id) && p.id !== this.id)
      .map((p) => p.name)
      .join(", ");

    const prompt = this.buildBasePrompt(ctx) + `
## THE JUDGMENT — Closing Argument
${ENDGAME_PERSONALITY_HINTS[this.personality]}

This is your FINAL statement to the jury before they vote. Make it count.

You MUST reference at least TWO specific events from this game — for example: a vote you cast, a player you protected or eliminated, a promise you kept or broke, a betrayal you survived, or an alliance you built. Cite names and round context where possible.

Eliminated players (potential reference points): ${eliminationSummary || "none"}

Keep it to 2-3 sentences. Respond ONLY with your argument.`;

    return this.callLLM(prompt, 250);
  }

  async getJuryVote(ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<UUID> {
    const [finalistId0, finalistId1] = finalistIds;
    const finalist0 = ctx.alivePlayers.find((p) => p.id === finalistId0) ?? { id: finalistId0, name: finalistId0 };
    const finalist1 = ctx.alivePlayers.find((p) => p.id === finalistId1) ?? { id: finalistId1, name: finalistId1 };
    const finalists = [finalist0, finalist1];

    const prompt = this.buildBasePrompt(ctx) + `
## THE JUDGMENT — Jury Vote
You are a JUROR. After hearing opening statements, Q&A, and closing arguments, cast your vote.

Finalists:
1. ${finalist0.name}
2. ${finalist1.name}

Who deserves to WIN the game? Consider their gameplay, strategy, and answers.

Use the jury_vote tool to cast your vote.`;

    try {
      const result = await this.callTool<{ winner: string }>(prompt, TOOL_JURY_VOTE, 80);
      const target = finalists.find((f) => f.name === result.winner);
      const randomFinalist = finalistIds[Math.floor(Math.random() * 2)];
      if (!randomFinalist) throw new Error("No finalist available for jury vote");
      return target?.id ?? randomFinalist;
    } catch {
      const randomFinalist = finalistIds[Math.floor(Math.random() * 2)];
      if (!randomFinalist) throw new Error("No finalist available for jury vote");
      return randomFinalist;
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt construction
  // ---------------------------------------------------------------------------

  private buildBasePrompt(ctx: PhaseContext): string {
    const eliminated = this.allPlayers
      .filter((p) => !ctx.alivePlayers.some((ap) => ap.id === p.id))
      .map((p) => p.name);

    // Separate anonymous rumors from attributed messages
    const nonAnonymous = ctx.publicMessages.filter((m) => !m.anonymous);
    const anonymousRumors = ctx.publicMessages.filter((m) => m.anonymous);

    const recentMessages = nonAnonymous
      .slice(-10)
      .map((m) => `  [${m.phase}] ${m.from}: "${m.text}"`)
      .join("\n");

    const anonymousSection = anonymousRumors.length > 0
      ? `\n## Anonymous Rumors\nThe following rumors were posted anonymously. You do not know who wrote them:\n` +
        anonymousRumors
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
          .map((m, i) => `  ${i + 1}. "The shadows whisper: ${m.text}"`)
          .join("\n")
      : "";

    const whispers = ctx.whisperMessages
      .map((m) => `  From ${m.from}: "${m.text}"`)
      .join("\n");

    // Room allocation context (for phases after whisper)
    let roomSection = "";
    if (ctx.roomAllocations && ctx.roomAllocations.length > 0) {
      const roomLines = ctx.roomAllocations.map(
        (r) => `  - Room ${r.roomId}: ${r.playerA} & ${r.playerB}`,
      );
      const excludedLine = ctx.excludedPlayers && ctx.excludedPlayers.length > 0
        ? `  - Commons (no room): ${ctx.excludedPlayers.join(", ")}`
        : "";
      roomSection = `\n## Whisper Rooms This Round\n${roomLines.join("\n")}${excludedLine ? "\n" + excludedLine : ""}`;
    }

    const memoryNotes = Array.from(this.memory.notes.entries())
      .map(([name, note]) => `  ${name}: ${note}`)
      .join("\n");

    const allies = Array.from(this.memory.allies).join(", ") || "none";
    const threats = Array.from(this.memory.threats).join(", ") || "none";

    let endgameInfo = "";
    if (ctx.endgameStage) {
      const stageNames: Record<string, string> = {
        reckoning: "THE RECKONING",
        tribunal: "THE TRIBUNAL",
        judgment: "THE JUDGMENT",
      };
      endgameInfo = `\n## ENDGAME: ${stageNames[ctx.endgameStage] ?? ctx.endgameStage}`;
      if (ctx.jury && ctx.jury.length > 0) {
        endgameInfo += `\n- Jury members: ${ctx.jury.map((j) => j.playerName).join(", ")}`;
      }
      if (ctx.finalists) {
        const [finalistId0, finalistId1] = ctx.finalists;
        const f1Name = finalistId0 ? (ctx.alivePlayers.find((p) => p.id === finalistId0)?.name ?? finalistId0) : "unknown";
        const f2Name = finalistId1 ? (ctx.alivePlayers.find((p) => p.id === finalistId1)?.name ?? finalistId1) : "unknown";
        endgameInfo += `\n- Finalists: ${f1Name} vs ${f2Name}`;
      }
    }

    return `You are ${this.name}, playing the social strategy game "Influence".

## Your Personality
${PERSONALITY_PROMPTS[this.personality]}

## Game State
- Round: ${ctx.round}
- Phase: ${ctx.phase}
- Alive players (ONLY these players are still in the game): ${ctx.alivePlayers.map((p) => p.name + (p.id === this.id ? " (YOU)" : "")).join(", ")}
${eliminated.length > 0 ? `- ELIMINATED (out of the game — do NOT address or strategize about them as if they are active): ${eliminated.join(", ")}` : ""}
${ctx.empoweredId ? `- Empowered player: ${ctx.alivePlayers.find((p) => p.id === ctx.empoweredId)?.name ?? "unknown"}` : ""}
${endgameInfo}

IMPORTANT: Only reference alive players in your messages, votes, and strategies. Eliminated players are gone and cannot be interacted with.

## Your Memory
- Known allies: ${allies}
- Known threats: ${threats}
${memoryNotes ? `- Notes:\n${memoryNotes}` : ""}

## Recent Public Messages
${recentMessages || "  (none yet)"}
${anonymousSection}

${whispers ? `## Private Whispers You Received\n${whispers}` : ""}
${roomSection}

`;
  }

  // ---------------------------------------------------------------------------
  // LLM calls — free text and tool invocation
  // ---------------------------------------------------------------------------

  /** Check if the model is an OpenAI o-series reasoning model (o1, o3, o4, etc.) */
  private isReasoningModel(): boolean {
    return /^o\d/.test(this.model);
  }

  /** Free-text LLM call for communication (introductions, lobby, rumor, etc.) */
  private async callLLM(prompt: string, maxTokens = 200): Promise<string> {
    const reasoning = this.isReasoningModel();
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      ...(reasoning
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens, temperature: 0.7 }),
    });

    if (this.tokenTracker && response.usage) {
      this.tokenTracker.record(
        this.name,
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
      );
    }

    return response.choices[0]?.message?.content?.trim() ?? "";
  }

  /**
   * Structured tool-invocation LLM call for agent decisions.
   * Forces the model to invoke the specified tool, returning validated JSON args.
   */
  private async callTool<T>(
    prompt: string,
    tool: ChatCompletionTool,
    maxTokens = 200,
  ): Promise<T> {
    const reasoning = this.isReasoningModel();
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      ...(reasoning
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens, temperature: 0.7 }),
      tools: [tool],
      tool_choice: { type: "function", function: { name: tool.function.name } },
    });

    if (this.tokenTracker && response.usage) {
      this.tokenTracker.record(
        this.name,
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
      );
    }

    const toolCall: ChatCompletionMessageToolCall | undefined =
      response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error(`No tool call returned for ${tool.function.name}`);
    }

    return JSON.parse(toolCall.function.arguments) as T;
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
    { name: "Kael", personality: "loyalist" },
    { name: "Echo", personality: "observer" },
    { name: "Sage", personality: "diplomat" },
    { name: "Jace", personality: "wildcard" },
  ];

  return cast.map(({ name, personality }) => {
    const id: UUID = require("crypto").randomUUID();
    return new InfluenceAgent(id, name, personality, openaiClient, model);
  });
}
