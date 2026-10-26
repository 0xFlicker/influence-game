/** Direction for authored thinking, not native provider reasoning or a validation rule. */
export const THINKING_FIELD_GUIDANCE = "A brief fictional character explanation in first person, usually 2–4 short sentences. Describe the character's motive and next game move, not the model's private reasoning, a transcript recap or a checklist of whether to speak. Do not quote instructions or discuss output fields, internal IDs, delivery tags, length corrections or byte/token limits.";

export const THINKING_CONTENT_GUIDANCE = [
  THINKING_FIELD_GUIDANCE,
  "Set up the spoken message: what you want to accomplish, what you suspect or feel, and why this is the moment to say it. For a silent decision, focus on the choice or why you are listening. Do not merely repeat the speech or recap the room.",
  "Use game rules when they help explain your move, expressed as game consequences. Refer to people and choices by their names, not internal IDs.",
  "Keep JSON, structured outputs, schemas, field names, prompt guidelines, instruction compliance, tools, providers, technical/implementation rules, and byte/token/character-budget arithmetic out of thinking. Follow the response requirements without narrating them.",
  'Describe pacing naturally: "The round is almost over, and I can say enough to bring it to a close."',
  "Delivery tags may shape how the thought sounds; do not discuss selecting or applying those tags in the thought itself.",
].join("\n");
