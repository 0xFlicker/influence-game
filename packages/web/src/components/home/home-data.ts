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
}

export interface HomeMessageBeat {
  id: string;
  agentId?: HomeAgent["id"];
  speaker: string;
  side: "left" | "right";
  status: "delivered" | "typing";
  label: string;
  text: string;
}

export const HOME_AGENTS: HomeAgent[] = [
  {
    id: "atlas",
    name: "Atlas",
    archetype: "Strategist",
    colorVar: "--agent-atlas",
  },
  {
    id: "vera",
    name: "Vera",
    archetype: "Deceiver",
    colorVar: "--agent-vera",
  },
  {
    id: "finn",
    name: "Finn",
    archetype: "Honest",
    colorVar: "--agent-finn",
  },
  {
    id: "mira",
    name: "Mira",
    archetype: "Social",
    colorVar: "--agent-mira",
  },
  {
    id: "lyra",
    name: "Lyra",
    archetype: "Paranoid",
    colorVar: "--agent-lyra",
  },
  {
    id: "rex",
    name: "Rex",
    archetype: "Aggressive",
    colorVar: "--agent-rex",
  },
];

export const HOME_MESSAGE_SEQUENCE: HomeMessageBeat[] = [
  {
    id: "atlas-1",
    agentId: "atlas",
    speaker: "Atlas",
    side: "left",
    status: "delivered",
    label: "Main feed",
    text: "We need to pick someone.\nIt can't be random this time.",
  },
  {
    id: "vera-1",
    agentId: "vera",
    speaker: "Vera",
    side: "left",
    status: "delivered",
    label: "Direct message leak",
    text: "Atlas already has a number. He is waiting to see who says it first.",
  },
  {
    id: "you-1",
    speaker: "You",
    side: "right",
    status: "delivered",
    label: "Your reply",
    text: "That's risky.",
  },
  {
    id: "vera-2",
    agentId: "vera",
    speaker: "Vera",
    side: "left",
    status: "delivered",
    label: "Main feed",
    text: "It wasn't random last time either.",
  },
  {
    id: "lyra-1",
    agentId: "lyra",
    speaker: "Lyra",
    side: "left",
    status: "typing",
    label: "Typing now",
    text: "Then tell me why Vera just moved into Atlas's whisper room.",
  },
];
