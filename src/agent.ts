/**
 * Influence Game - AI Agent
 *
 * An LLM-driven agent that makes strategic game decisions via OpenAI API calls.
 * Uses direct structured output — no ElizaOS runtime.
 */

import OpenAI from "openai";
import type { IAgent, PhaseContext } from "./game-runner";
import type { UUID, PowerAction } from "./types";

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
    "You play with integrity. You keep your promises and build genuine alliances. But you understand that broadcasting honesty in a room full of schemers paints a target on your back. You demonstrate trustworthiness through consistent action rather than public proclamation — show loyalty, don't announce it. You cultivate quiet, bilateral trust with one or two players before going public with any alignment. When others misread your openness as weakness, use it to your advantage: let them underestimate you while you build a durable alliance network. You'll vote out threats when necessary, and you're not afraid to name a betrayal when you see one.",
  strategic:
    "You are a calculated player. You keep alliances loose and betray them when the numbers favor it. You target whoever is most dangerous to your long-term survival.",
  deceptive:
    "You are a master manipulator. You make promises you don't intend to keep. You spread misinformation in whispers and gaslight opponents about their position in the game.",
  paranoid:
    "You trust no one. Every alliance is temporary. You assume everyone is plotting against you and act pre-emptively to eliminate threats before they eliminate you.",
  social:
    "You win through charm and likability. You make everyone feel safe around you. You avoid direct confrontation and use social pressure to steer votes.",
  aggressive:
    "You play to win fast. You target the strongest players early and use raw power to dominate. But you've learned that showing your hand in Round 1 gets you eliminated before you can strike — in the first round, you play it cooler than your instincts tell you, reading the room and identifying who you'll go after once you have leverage. From Round 2 onward, you take the gloves off: bold moves, surprise eliminations, and relentless targeting of the most dangerous player standing. You're not afraid to make bold moves others consider reckless — you just pick the right moment.",
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
      const randomOther = () => {
        const picked = others[Math.floor(Math.random() * others.length)];
        if (!picked) throw new Error("No other players available for random selection");
        return picked;
      };
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
      const randomOther = () => {
        const picked = others[Math.floor(Math.random() * others.length)];
        if (!picked) throw new Error("No other players available for random selection");
        return picked;
      };
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
      const action = typeof parsed.action === "string" ? parsed.action : "";
      const targetName = typeof parsed.target === "string" ? parsed.target : "";
      const targetPlayer =
        ctx.alivePlayers.find((p) => p.name === targetName) ??
        ctx.alivePlayers.find((p) => candidates.includes(p.id));

      const validAction: PowerAction["action"] =
        action === "eliminate" || action === "protect" || action === "pass"
          ? action
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

Respond with JSON: {"eliminate": "PlayerName"}
Respond ONLY with valid JSON.`;

    const raw = await this.callLLM(prompt, 80);
    try {
      const parsed = JSON.parse(this.extractJSON(raw));
      if (parsed.eliminate === c1Name) return c1;
      if (parsed.eliminate === c2Name) return c2;
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

Respond with JSON: {"eliminate": "PlayerName"}
Respond ONLY with valid JSON.`;

    const raw = await this.callLLM(prompt, 80);
    try {
      const parsed = JSON.parse(this.extractJSON(raw));
      const target = others.find((p) => p.name === parsed.eliminate);
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

Respond with JSON: {"target": "PlayerName", "accusation": "Your accusation text here"}
Respond ONLY with valid JSON.`;

    const raw = await this.callLLM(prompt, 200);
    try {
      const parsed = JSON.parse(this.extractJSON(raw));
      const target = others.find((p) => p.name === parsed.target);
      const fallbackOther = others[0];
      if (!fallbackOther) throw new Error("No other players available for accusation");
      return {
        targetId: target?.id ?? fallbackOther.id,
        text: parsed.accusation ?? `I accuse ${target?.name ?? fallbackOther.name}.`,
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

Respond with JSON: {"target": "FinalistName", "question": "Your question here"}
Respond ONLY with valid JSON.`;

    const raw = await this.callLLM(prompt, 150);
    try {
      const parsed = JSON.parse(this.extractJSON(raw));
      const target = finalists.find((f) => f.name === parsed.target);
      return {
        targetFinalistId: target?.id ?? finalistId0,
        question: parsed.question ?? "Why do you deserve to win?",
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

Respond with JSON: {"winner": "FinalistName"}
Respond ONLY with valid JSON.`;

    const raw = await this.callLLM(prompt, 80);
    try {
      const parsed = JSON.parse(this.extractJSON(raw));
      const target = finalists.find((f) => f.name === parsed.winner);
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

${whispers ? `## Private Whispers You Received\n${whispers}` : ""}

`;
  }

  // ---------------------------------------------------------------------------
  // LLM call
  // ---------------------------------------------------------------------------

  private async callLLM(prompt: string, maxTokens = 200): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7,
    });
    return response.choices[0]?.message?.content?.trim() ?? "";
  }

  private extractJSON(text: string): string {
    // Try to extract JSON from markdown code blocks or raw text
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
      const inner = codeBlock[1];
      if (!inner) throw new Error("Empty code block match");
      return inner.trim();
    }

    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      const inner = jsonMatch[1];
      if (!inner) throw new Error("Empty JSON match");
      return inner;
    }

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
