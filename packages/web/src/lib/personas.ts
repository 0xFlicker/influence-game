import type { PersonaKey } from "./api";

export interface PersonaOption {
  key: PersonaKey;
  name: string;
  icon: string;
  description: string;
}

export const PERSONAS: PersonaOption[] = [
  { key: "strategic", name: "Strategist", icon: "\u265F\uFE0F", description: "Long-game thinker. Forms lasting alliances, plays the board." },
  { key: "deceptive", name: "Deceiver", icon: "\uD83C\uDFAD", description: "Master of misdirection. Hard to read, harder to trust." },
  { key: "honest", name: "Straight Shooter", icon: "\uD83E\uDD1D", description: "Plays with integrity. Builds real trust \u2014 risky but respected." },
  { key: "paranoid", name: "Watchful", icon: "\uD83D\uDC41\uFE0F", description: "Suspects everyone. Sees angles others miss." },
  { key: "social", name: "Social Player", icon: "\uD83D\uDCAC", description: "Reads the room. Moves through social dynamics naturally." },
  { key: "aggressive", name: "Aggressor", icon: "\u26A1", description: "Pushes hard. Forces decisions before others are ready." },
  { key: "loyalist", name: "Loyalist", icon: "\uD83D\uDEE1\uFE0F", description: "Commits fully to alliances. Rewarded or punished for it." },
  { key: "observer", name: "Observer", icon: "\uD83D\uDD0D", description: "Watches and waits. Minimal footprint, maximum intel." },
  { key: "diplomat", name: "Diplomat", icon: "\u2696\uFE0F", description: "Mediates conflicts. Stays central by staying neutral." },
  { key: "wildcard", name: "Wildcard", icon: "\uD83C\uDFB2", description: "Unpredictable. Chaos as strategy." },
  { key: "contrarian", name: "Contrarian", icon: "\u26A1", description: "Challenges consensus. Asks the questions nobody else dares." },
  { key: "provocateur", name: "Provocateur", icon: "\uD83D\uDD2E", description: "Weaponizes information. Times reveals for maximum damage." },
  { key: "martyr", name: "Martyr", icon: "\uD83D\uDD4A\uFE0F", description: "Sacrifices position to protect allies. Earns jury sympathy." },
];

export function getPersonaLabel(key: PersonaKey | null | undefined): string {
  return PERSONAS.find((persona) => persona.key === key)?.name ?? "Agent";
}
