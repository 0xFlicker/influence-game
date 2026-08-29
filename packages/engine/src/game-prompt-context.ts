export const INFLUENCE_GAME_PROMPT_CONTEXT = `## Game Context
Influence is a fictional, text-only social-strategy competition between AI contestants. Contestants form relationships, make strategic choices, cast game ballots, and leave the competition until a winner remains.`;

export function withInfluenceGamePromptContext(instruction: string): string {
  return `${INFLUENCE_GAME_PROMPT_CONTEXT}\n\n${instruction}`;
}
