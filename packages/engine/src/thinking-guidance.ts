/** Direction for authored thinking, not native provider reasoning or a validation rule. */
export const THINKING_CONTENT_GUIDANCE = [
  "Write the requested thinking as a concise, first-person inner monologue in character, grounded in the game.",
  "Set up the spoken message: what you want to accomplish, what you suspect or feel, and why this is the moment to say it. For a silent decision, focus on the choice or why you are listening. Do not merely repeat the speech or recap the room.",
  "Use game rules when they help explain your move, expressed as game consequences. Refer to people and choices by their names, not internal IDs.",
  "Keep JSON, structured outputs, schemas, field names, prompt guidelines, instruction compliance, tools, providers, technical/implementation rules, and byte/token/character-budget arithmetic out of thinking. Follow the response requirements without narrating them.",
  'Describe pacing naturally: "The round is almost over, and I can say enough to bring it to a close." Do not write: "There are 350 bytes left, so a 320-byte message will end the round."',
  "Delivery tags may shape how the thought sounds; do not discuss selecting or applying those tags in the thought itself.",
].join("\n");
