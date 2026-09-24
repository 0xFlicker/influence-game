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
