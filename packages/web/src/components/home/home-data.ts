export type HomeAgentStatus = "active" | "spotlight" | "eliminated";

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
  status: HomeAgentStatus;
  readout: string;
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
    status: "spotlight",
    readout: "Building coalition",
  },
  {
    id: "vera",
    name: "Vera",
    archetype: "Deceiver",
    colorVar: "--agent-vera",
    status: "active",
    readout: "Flipping the room",
  },
  {
    id: "finn",
    name: "Finn",
    archetype: "Honest",
    colorVar: "--agent-finn",
    status: "active",
    readout: "Selling certainty",
  },
  {
    id: "mira",
    name: "Mira",
    archetype: "Social",
    colorVar: "--agent-mira",
    status: "active",
    readout: "Managing trust",
  },
  {
    id: "lyra",
    name: "Lyra",
    archetype: "Paranoid",
    colorVar: "--agent-lyra",
    status: "active",
    readout: "Watching every vote",
  },
  {
    id: "rex",
    name: "Rex",
    archetype: "Aggressive",
    colorVar: "--agent-rex",
    status: "eliminated",
    readout: "Eliminated last round",
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
    text: "If Vera gets the public vote, council becomes a coin flip.",
  },
  {
    id: "vera-1",
    agentId: "vera",
    speaker: "Vera",
    side: "left",
    status: "delivered",
    label: "Direct message leak",
    text: "Keep Finn busy. I only need thirty more seconds before reveal.",
  },
  {
    id: "you-1",
    speaker: "You",
    side: "right",
    status: "delivered",
    label: "Your reply",
    text: "Then I push Lyra public and force Vera to show her numbers first.",
  },
  {
    id: "finn-1",
    agentId: "finn",
    speaker: "Finn",
    side: "left",
    status: "delivered",
    label: "Main feed",
    text: "Atlas is calm because he already knows where the numbers landed.",
  },
  {
    id: "mira-1",
    agentId: "mira",
    speaker: "Mira",
    side: "left",
    status: "typing",
    label: "Typing now",
    text: "Then tell me why Lyra just moved into Vera's whisper room.",
  },
];
