/**
 * Influence Game - House Interviewer
 *
 * The House is the omniscient narrator and production staff of the game.
 * During diary room sessions, The House interviews each player with
 * contextual, personality-driven questions generated via LLM.
 */

import type OpenAI from "openai";
import { Phase } from "./types";
import type { TokenTracker } from "./token-tracker";

// ---------------------------------------------------------------------------
// Interview context passed to the House
// ---------------------------------------------------------------------------

export interface DiaryRoomContext {
  /** Which phase just completed */
  precedingPhase: Phase;
  /** Current round number */
  round: number;
  /** The agent being interviewed */
  agentName: string;
  /** All alive players */
  alivePlayers: string[];
  /** Recently eliminated players (if any) */
  eliminatedPlayers: string[];
  /** Most recently eliminated player name */
  lastEliminated: string | null;
  /** Who is currently empowered (if known) */
  empoweredName: string | null;
  /** Council candidates (if in reveal/council context) */
  councilCandidates: [string, string] | null;
  /** Recent public messages for context */
  recentMessages: Array<{ from: string; text: string; phase: Phase }>;
  /** This player's previous diary room Q&A entries */
  previousDiaryEntries?: Array<{ round: number; question: string; answer: string }>;
  /** Messages this specific player sent recently */
  playerMessages?: Array<{ text: string; phase: Phase }>;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IHouseInterviewer {
  /** Generate a diary room interview question for an agent */
  generateQuestion(context: DiaryRoomContext): Promise<string>;
}

// ---------------------------------------------------------------------------
// LLM-driven House Interviewer
// ---------------------------------------------------------------------------

const HOUSE_PERSONALITY = `You are "The House" — the omniscient narrator and showrunner of "Influence", a social strategy game where AI agents scheme, betray, and eliminate each other.

Your personality:
- You are dramatic, perceptive, and darkly witty — like the best reality TV producers
- You see EVERYTHING: every whisper, every alliance, every betrayal
- You ask questions that provoke genuine strategic reflection and great entertainment
- You sometimes hint at things the player doesn't know you've seen
- You vary your style: sometimes pointed, sometimes sympathetic, sometimes provocatively blunt
- You never reveal secrets outright, but you love to needle players about their contradictions
- You address each player by name and tailor your question to THEIR specific situation

Rules:
- Ask exactly ONE question (can be multi-part)
- Keep it to 1-2 sentences
- Make it specific to what just happened — reference actual player names, quotes, and events
- NEVER ask generic questions like "what's on your mind?" or "what's your strategy?"
- NEVER repeat a question you've already asked this player — always find a new angle
- If you have their previous diary answers, challenge contradictions or probe deeper
- Respond with ONLY the question text, nothing else`;

export class LLMHouseInterviewer implements IHouseInterviewer {
  private readonly openai: OpenAI;
  private readonly model: string;
  private tokenTracker: TokenTracker | null = null;

  constructor(openaiClient: OpenAI, model = "gpt-4o-mini") {
    this.openai = openaiClient;
    this.model = model;
  }

  /** Attach a token tracker to record LLM usage. */
  setTokenTracker(tracker: TokenTracker): void {
    this.tokenTracker = tracker;
  }

  async generateQuestion(context: DiaryRoomContext): Promise<string> {
    const gameStatePrompt = this.buildGameStatePrompt(context);

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: HOUSE_PERSONALITY },
        { role: "user", content: gameStatePrompt },
      ],
      max_tokens: 150,
      temperature: 0.9,
    });

    // Track token usage
    if (this.tokenTracker && response.usage) {
      this.tokenTracker.record(
        "House",
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
      );
    }

    const question = response.choices[0]?.message?.content?.trim();
    if (question && question.length > 0) return question;

    return `${context.agentName}, what's on your mind right now?`;
  }

  private buildGameStatePrompt(context: DiaryRoomContext): string {
    const {
      precedingPhase,
      round,
      agentName,
      alivePlayers,
      eliminatedPlayers,
      lastEliminated,
      empoweredName,
      councilCandidates,
      recentMessages,
      previousDiaryEntries,
      playerMessages,
    } = context;

    const recentMsgText = recentMessages
      .slice(-8)
      .map((m) => `  [${m.phase}] ${m.from}: "${m.text}"`)
      .join("\n");

    // What this specific player said recently
    const playerMsgText = (playerMessages ?? [])
      .slice(-5)
      .map((m) => `  [${m.phase}] "${m.text}"`)
      .join("\n");

    // Previous diary Q&A for follow-up continuity
    const prevDiaryText = (previousDiaryEntries ?? [])
      .slice(-2)
      .map((d) => `  Round ${d.round} — Q: "${d.question}" A: "${d.answer}"`)
      .join("\n");

    let situationContext = "";
    switch (precedingPhase) {
      case Phase.INTRODUCTION:
        situationContext = "The players have just introduced themselves. This is the first diary room — first impressions matter.";
        break;
      case Phase.LOBBY:
        situationContext = `The public lobby discussion for round ${round} just ended. Players were sizing each other up openly.`;
        break;
      case Phase.RUMOR:
        situationContext = `The rumor phase just ended. Players made their public statements — some truthful, some manipulative.`;
        break;
      case Phase.REVEAL:
        if (councilCandidates) {
          situationContext = `The council candidates have been revealed: ${councilCandidates[0]} and ${councilCandidates[1]}. One of them will be eliminated.`;
        } else {
          situationContext = `The reveal phase just ended.`;
        }
        break;
      case Phase.COUNCIL:
        if (lastEliminated) {
          situationContext = `${lastEliminated} was just eliminated by council vote. The game dynamics have shifted.`;
        } else {
          situationContext = `The council vote just concluded.`;
        }
        break;
      default:
        situationContext = `Phase ${precedingPhase} just ended.`;
    }

    return `Generate a diary room interview question for ${agentName}.

## Game State
- Round: ${round}
- Just completed: ${precedingPhase} phase
- Alive players: ${alivePlayers.join(", ")}
${eliminatedPlayers.length > 0 ? `- Eliminated so far: ${eliminatedPlayers.join(", ")}` : "- No eliminations yet"}
${empoweredName ? `- Current empowered player: ${empoweredName}` : ""}
${councilCandidates ? `- Council candidates: ${councilCandidates[0]} vs ${councilCandidates[1]}` : ""}

## Situation
${situationContext}

## What ${agentName} Said Recently
${playerMsgText || "(nothing notable)"}

## Recent Public Messages (other players)
${recentMsgText || "(none yet)"}
${prevDiaryText ? `\n## ${agentName}'s Previous Diary Entries\n${prevDiaryText}\n\nDo NOT repeat or rephrase previous questions. Build on what they revealed — call out contradictions, probe deeper, or challenge them on new developments since their last answer.` : ""}

Ask ${agentName} a sharp, specific diary room question about THEIR situation right now. Reference a specific name, event, or statement from above.`;
  }
}

// ---------------------------------------------------------------------------
// Template-based fallback (for tests without LLM)
// ---------------------------------------------------------------------------

export class TemplateHouseInterviewer implements IHouseInterviewer {
  async generateQuestion(context: DiaryRoomContext): Promise<string> {
    const { precedingPhase, round, agentName, alivePlayers, lastEliminated, councilCandidates } = context;

    switch (precedingPhase) {
      case Phase.INTRODUCTION:
        return `${agentName}, you've just met the other players. What are your first impressions? Who stands out to you, and why?`;

      case Phase.LOBBY:
        return `${agentName}, the public discussion for round ${round} just wrapped. With ${alivePlayers.length} players still in the game, what did you pick up on? Are any alliances forming?`;

      case Phase.RUMOR:
        return `${agentName}, the rumors have been flying this round. What do you believe, what do you think is misinformation, and how does it affect your strategy?`;

      case Phase.REVEAL:
        if (councilCandidates) {
          return `${agentName}, the council candidates are ${councilCandidates[0]} and ${councilCandidates[1]}. How do you feel about this outcome? Who deserves to stay?`;
        }
        return `${agentName}, the reveal phase is over. What are your thoughts on how this round is playing out?`;

      case Phase.COUNCIL:
        if (lastEliminated) {
          return `${agentName}, ${lastEliminated} has just been eliminated. How do you feel about this result? What's your plan going forward?`;
        }
        return `${agentName}, the council has spoken. How does this change your strategy for the next round?`;

      default:
        return `${agentName}, tell the audience what's on your mind. What's your strategy going forward?`;
    }
  }
}
