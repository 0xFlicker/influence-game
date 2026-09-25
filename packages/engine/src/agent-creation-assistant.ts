/** The assistant selects commands; the application owns every transition and reply. */
export const CREATION_COMMANDS = {
  character: ["revise_character", "clarify", "end_abuse", "end_fatigue"],
  review: ["accept_character", "revise_character", "clarify", "end_abuse", "end_fatigue"],
  appearance: ["generate_appearance", "clarify", "end_abuse", "end_fatigue"],
  portrait: ["revise_appearance", "clarify", "end_abuse", "end_fatigue"],
} as const;
export type CreationStage = keyof typeof CREATION_COMMANDS;
export type CreationCommand = (typeof CREATION_COMMANDS)[CreationStage][number];
export function isCreationStage(value: unknown): value is CreationStage {
  return typeof value === "string" && Object.hasOwn(CREATION_COMMANDS, value);
}
export function creationCommandSchema(stage: CreationStage) {
  return { type: "object", additionalProperties: false, properties: {
    command: { type: "string", enum: [...CREATION_COMMANDS[stage]] },
  }, required: ["command"] };
}
export function decodeCreationCommand(content: string, stage: CreationStage): CreationCommand {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 1 || !("command" in value)
    || typeof value.command !== "string"
    || !(CREATION_COMMANDS[stage] as readonly string[]).includes(value.command)) {
    throw new Error("Invalid creation assistant command");
  }
  return value.command as CreationCommand;
}

export const CHARACTER_FIELDS = ["name", "personaKey", "gender", "personality", "backstory", "strategyStyle", "performanceInstructions", "visualDesign"] as const;
export type CharacterField = typeof CHARACTER_FIELDS[number];
export const VISUAL_FIELDS: CharacterField[] = ["performanceInstructions", "visualDesign"];
export type CharacterDraftContext = Record<CharacterField, string> & { hasFullBody: boolean };
export type CharacterEditCommand = { tool: "update_character" | "update_visuals"; fields: CharacterField[] } | { tool: "clarify"; message: string };
export function characterEditFields(profile: Partial<Record<CharacterField, string | null>>, selected: CharacterField[]): CharacterField[] {
  return CHARACTER_FIELDS.filter(field => selected.includes(field) || !profile[field]?.trim());
}
export function decodeCharacterEditTool(name: string, args: string): CharacterEditCommand {
  const value: unknown = JSON.parse(args);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid character edit tool");
  if (name === "update_visuals" && Object.keys(value).length === 0) return { tool: name, fields: [...VISUAL_FIELDS] };
  if (name === "clarify" && Object.keys(value).length === 1 && "message" in value && typeof value.message === "string" && value.message.trim() && value.message.length <= 1000) return { tool: name, message: value.message };
  if (name === "update_character" && Object.keys(value).length === 1 && "fields" in value && Array.isArray(value.fields) && value.fields.length > 0 && value.fields.length <= CHARACTER_FIELDS.length && new Set(value.fields).size === value.fields.length && value.fields.every(field => CHARACTER_FIELDS.includes(field))) return { tool: name, fields: value.fields };
  throw new Error("Invalid character edit tool");
}
