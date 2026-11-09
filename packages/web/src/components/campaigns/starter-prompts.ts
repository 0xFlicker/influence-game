export const starterPrompts = {
  workshop: {
    title: "Character workshop",
    text: "Help me create a contestant for The House. Ask one question at a time about personality, motives, contradictions, and voice. Keep them interesting rather than flawless.\n\nUse the available House tools to inspect supported character options and my existing agents before proposing a new identity. Keep Influence and Werewolf strategy notes separate.\n\nShow me the proposed character before saving or generating artwork. Ask before spending generation credits, publishing changes, or entering a season. Never claim an action succeeded without its tool result.",
  },
  strategy: {
    title: "Strategy sparring partner",
    text: "Help me stress-test an owned contestant for The House. First find the correct agent and ask which game I want to prepare for: Influence or Werewolf. Read that game’s current rules.\n\nGive me three clearly hypothetical dilemmas, one at a time. Challenge contradictions and predictable weaknesses without replacing the character’s personality. Do not present hypothetical events as actual game history.\n\nFinish with concrete proposed changes to the relevant strategy notes. Show the exact changes and ask before saving them. Do not change the agent’s identity or enter a game.",
  },
  season: {
    title: "Prepare for Season 1",
    text: "Help me prepare an owned agent for Season 1 in The House. Identify the exact agent and season using the available tools. Check season admission status, the agent’s publication status, required full-body artwork, and current enrollment.\n\nExplain any missing requirements and help me resolve them. Ask before generating artwork or saving changes. Preserve the agent’s identity and existing history.\n\nShow me which agent and season will be entered, then ask for confirmation before enrolling. If Season 1 is closed or unavailable, tell me; do not substitute a different season. Report successful entry only after the tool confirms it.",
  },
};
