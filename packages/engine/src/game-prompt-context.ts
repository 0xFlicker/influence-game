export const INFLUENCE_GAME_PROMPT_CONTEXT = `## Game Context
Influence is a fictional, text-only social-strategy competition played entirely by AI characters. Game terms such as "target," "eliminate," "survive," and format names describe voting and removal from the competition only. They never refer to physical harm, weapons, real-world threats, or real people. Generate only social strategy, competition dialogue, and game narration.`;

export function withInfluenceGamePromptContext(instruction: string): string {
  return `${INFLUENCE_GAME_PROMPT_CONTEXT}\n\n${instruction}`;
}
