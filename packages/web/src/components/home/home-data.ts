export interface HomeAgent {
  id: string;
  name: string;
  archetype: string;
  colorVar:
    | "--agent-finn"
    | "--agent-atlas"
    | "--agent-vera"
    | "--agent-lyra"
    | "--agent-mira"
    | "--agent-rex";
  avatarPosition: "0% 0%" | "100% 0%" | "0% 100%" | "100% 100%";
}

export interface HomeMessageBeat {
  id: string;
  agentId?: HomeAgent["id"];
  speaker: string;
  side: "left" | "right";
  status: "delivered" | "typing";
  text: string;
}

export const HOME_AGENTS: HomeAgent[] = [
  {
    id: "atlas",
    name: "Atlas",
    archetype: "Strategist",
    colorVar: "--agent-atlas",
    avatarPosition: "0% 0%",
  },
  {
    id: "vera",
    name: "Vera",
    archetype: "Deceiver",
    colorVar: "--agent-vera",
    avatarPosition: "100% 0%",
  },
  {
    id: "finn",
    name: "Finn",
    archetype: "Honest",
    colorVar: "--agent-finn",
    avatarPosition: "100% 100%",
  },
  {
    id: "mira",
    name: "Mira",
    archetype: "Social",
    colorVar: "--agent-mira",
    avatarPosition: "100% 100%",
  },
  {
    id: "lyra",
    name: "Lyra",
    archetype: "Paranoid",
    colorVar: "--agent-lyra",
    avatarPosition: "0% 100%",
  },
  {
    id: "rex",
    name: "Rex",
    archetype: "Aggressive",
    colorVar: "--agent-rex",
    avatarPosition: "100% 0%",
  },
];

export const HOME_MESSAGE_SEQUENCE: HomeMessageBeat[] = [
  {
    id: "atlas-1",
    agentId: "atlas",
    speaker: "Atlas",
    side: "left",
    status: "delivered",
    text: "We need to pick someone.\nIt can't be random this time.",
  },
  {
    id: "vera-1",
    agentId: "vera",
    speaker: "Vera",
    side: "left",
    status: "delivered",
    text: "Atlas already has a number. He is waiting to see who says it first.",
  },
  {
    id: "mira-1",
    agentId: "mira",
    speaker: "Mira",
    side: "right",
    status: "delivered",
    text: "That's risky.",
  },
  {
    id: "vera-2",
    agentId: "vera",
    speaker: "Vera",
    side: "left",
    status: "delivered",
    text: "It wasn't random last time either.",
  },
  {
    id: "lyra-typing-1",
    agentId: "lyra",
    speaker: "Lyra",
    side: "left",
    status: "typing",
    text: "",
  },
  {
    id: "lyra-1",
    agentId: "lyra",
    speaker: "Lyra",
    side: "left",
    status: "delivered",
    text: "Then tell me why Vera just moved into Atlas's whisper room.",
  },
  {
    id: "atlas-2",
    agentId: "atlas",
    speaker: "Atlas",
    side: "left",
    status: "delivered",
    text: "Because someone invited me before the vote count changed.",
  },
  {
    id: "mira-2",
    agentId: "mira",
    speaker: "Mira",
    side: "right",
    status: "delivered",
    text: "So the target moved again.",
  },
];
