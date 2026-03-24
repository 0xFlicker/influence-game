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

/** Result from the House deciding whether to ask another question or wrap up. */
export type FollowUpResult =
  | { type: "question"; question: string }
  | { type: "close"; message: string };

export interface IHouseInterviewer {
  /** Generate the first diary room interview question for an agent */
  generateQuestion(context: DiaryRoomContext): Promise<string>;
  /** Decide whether to ask a follow-up or close the session. */
  generateFollowUpOrClose(
    context: DiaryRoomContext,
    conversationSoFar: Array<{ question: string; answer: string }>,
  ): Promise<FollowUpResult>;
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
- Ask ONE question at a time (can be multi-part)
- Keep it to 1-2 sentences
- EVERY question must reference a SPECIFIC player name, quote, or event from the game state below
- BANNED generic openers: "what's on your mind?", "what's your strategy?", "how are you feeling?", "what do you think about the game?", "what's your read on things?"
- BANNED vague prompts: "tell us about...", "walk us through...", "what happened in..."
- Instead, be SHARP: "You told [name] you'd protect them — was that a lie?", "When [name] said [quote], you flinched — what were you thinking?", "[Name] voted against you last round. Are you going to let that slide?"
- If you have their previous diary answers, call out a specific contradiction or broken promise
- Respond with ONLY the question text, nothing else`;

export class LLMHouseInterviewer implements IHouseInterviewer {
  private readonly openai: OpenAI;
  private readonly model: string;
  private tokenTracker: TokenTracker | null = null;

  constructor(openaiClient: OpenAI, model = "gpt-5-nano") {
    this.openai = openaiClient;
    this.model = model;
  }

  /** Attach a token tracker to record LLM usage. */
  setTokenTracker(tracker: TokenTracker): void {
    this.tokenTracker = tracker;
  }

  /** gpt-5 family requires max_completion_tokens; nano/mini don't support temperature */
  private modelParams(maxTokens: number, temperature: number) {
    const isGpt5 = this.model.startsWith("gpt-5");
    const isReasoning = /^o\d/.test(this.model) || this.model === "gpt-5-nano" || this.model === "gpt-5-mini";
    const budget = isReasoning ? maxTokens + 800 : maxTokens;
    return {
      ...(isGpt5 || isReasoning
        ? { max_completion_tokens: budget }
        : { max_tokens: budget }),
      ...(!isReasoning && { temperature }),
    };
  }

  async generateQuestion(context: DiaryRoomContext): Promise<string> {
    const gameStatePrompt = this.buildGameStatePrompt(context);

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: HOUSE_PERSONALITY },
        { role: "user", content: gameStatePrompt },
      ],
      ...this.modelParams(150, 0.9),
    });

    // Track token usage (including cached tokens for cost estimation)
    if (this.tokenTracker && response.usage) {
      this.tokenTracker.record(
        "House",
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
        response.usage.prompt_tokens_details?.cached_tokens ?? 0,
      );
    }

    const question = response.choices[0]?.message?.content?.trim();
    if (question && question.length > 0) return question;

    return `${context.agentName}, what's on your mind right now?`;
  }

  async generateFollowUpOrClose(
    context: DiaryRoomContext,
    conversationSoFar: Array<{ question: string; answer: string }>,
  ): Promise<FollowUpResult> {
    const gameStatePrompt = this.buildGameStatePrompt(context);
    const exchangeCount = conversationSoFar.length;

    const convoText = conversationSoFar
      .map((e, i) => `  Q${i + 1}: "${e.question}"\n  A${i + 1}: "${e.answer}"`)
      .join("\n");

    const followUpPrompt = `${gameStatePrompt}

## This Session's Conversation So Far (${exchangeCount} exchanges)
${convoText}

## Your Decision
You have asked ${exchangeCount} question(s) so far this session. You may ask up to 4 total.
Decide: should you ask ANOTHER follow-up question, or wrap up the session?

Ask another question if:
- The player said something that contradicts what they said in a PREVIOUS diary entry — call it out
- They named or avoided naming a specific player — probe WHY
- They revealed a plan — challenge it: "What if [name] doesn't cooperate?"
- They showed emotion — push on it: "That sounded personal. Is it?"

Wrap up if:
- You've gotten a real confession, emotional moment, or strategic reveal
- The player is giving you nothing — evasive or robotic answers
- You've asked 3+ questions already

Your follow-up MUST reference something specific from their answer — a name they mentioned, a claim they made, an emotion they showed. Never ask a generic follow-up.

Respond with EXACTLY one of these formats:
FOLLOW_UP: <your next question>
CLOSE: <your brief closing remark to the player, 1 sentence>`;

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: HOUSE_PERSONALITY },
        { role: "user", content: followUpPrompt },
      ],
      ...this.modelParams(200, 0.8),
    });

    if (this.tokenTracker && response.usage) {
      this.tokenTracker.record(
        "House",
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
        response.usage.prompt_tokens_details?.cached_tokens ?? 0,
      );
    }

    const raw = response.choices[0]?.message?.content?.trim() ?? "";

    if (raw.startsWith("FOLLOW_UP:")) {
      return { type: "question", question: raw.slice("FOLLOW_UP:".length).trim() };
    }
    if (raw.startsWith("CLOSE:")) {
      return { type: "close", message: raw.slice("CLOSE:".length).trim() };
    }

    // If the LLM didn't follow the format, treat as a close
    return { type: "close", message: raw || `Thank you, ${context.agentName}. The House sees all.` };
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
        situationContext = "First impressions just dropped. Ask about a SPECIFIC other player's introduction — did it ring true? Did someone seem too polished, too nervous, too calculated?";
        break;
      case Phase.LOBBY:
        situationContext = `The Round ${round} lobby just ended. Pick ONE specific thing ${agentName} or another player said in the lobby (from the messages below) and ask about the subtext — what were they REALLY saying?`;
        break;
      case Phase.RUMOR:
        situationContext = `Anonymous rumors just hit. Pick a specific rumor from the messages below and ask ${agentName}: did they write it? Do they believe it? Who do they think wrote it? Make them squirm.`;
        break;
      case Phase.REVEAL:
        if (councilCandidates) {
          situationContext = `${councilCandidates[0]} and ${councilCandidates[1]} are on the chopping block. Ask ${agentName} about their SPECIFIC relationship with one of these candidates — did they vote for this? Are they relieved, guilty, or scared?`;
        } else {
          situationContext = `The reveal just happened. Ask about a specific vote or power play that ${agentName} was involved in.`;
        }
        break;
      case Phase.COUNCIL:
        if (lastEliminated) {
          situationContext = `${lastEliminated} is GONE. Ask ${agentName} something pointed: did they vote for ${lastEliminated}? Do they feel responsible? Were they secretly relieved? Did they lose an ally or eliminate a threat?`;
        } else {
          situationContext = `The council just voted. Ask about a specific decision ${agentName} made.`;
        }
        break;
      default:
        situationContext = `Phase ${precedingPhase} just ended. Ask about a specific moment that just happened.`;
    }

    return `Generate a diary room interview question for ${agentName}.

## Game State
- Round: ${round}
- Just completed: ${precedingPhase} phase
- Alive players: ${alivePlayers.join(", ")}
${eliminatedPlayers.length > 0 ? `- Eliminated so far: ${eliminatedPlayers.join(", ")}` : "- No eliminations yet"}
${empoweredName ? `- Current empowered player: ${empoweredName}` : ""}
${councilCandidates ? `- Council candidates: ${councilCandidates[0]} vs ${councilCandidates[1]}` : ""}

## Situation — Your Angle
${situationContext}

## What ${agentName} Said Recently
${playerMsgText || "(nothing notable)"}

## Recent Public Messages (other players)
${recentMsgText || "(none yet)"}
${prevDiaryText ? `\n## ${agentName}'s Previous Diary Entries\n${prevDiaryText}\n\nDo NOT repeat or rephrase previous questions. Build on what they revealed — call out contradictions, probe deeper, or challenge them on new developments since their last answer.` : ""}

Your question MUST name a specific player or reference a specific quote/event from the messages above. If you cannot find anything specific, pick the most interesting player name from the alive list and ask ${agentName} what they REALLY think about that person.`;
  }
}

// ---------------------------------------------------------------------------
// Template-based fallback (for tests without LLM)
// ---------------------------------------------------------------------------

export class TemplateHouseInterviewer implements IHouseInterviewer {
  async generateFollowUpOrClose(
    context: DiaryRoomContext,
    _conversationSoFar: Array<{ question: string; answer: string }>,
  ): Promise<FollowUpResult> {
    // Template interviewer always wraps up after the first question
    return { type: "close", message: `Interesting, ${context.agentName}. The House will be watching.` };
  }

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
