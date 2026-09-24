/** Curated creation ingredients shared by the agent editor and generation API. */
export const AGENT_CREATION_TRAIT_GROUPS = [
  {
    id: "form",
    label: "Character form",
    traits: [
      { id: "anthropomorphic", label: "Anthropomorphic", instruction: "Give the character an expressive, person-like body while honoring any chosen animal or creature form." },
      { id: "furry", label: "Furry", instruction: "Design a distinctive furred anthropomorphic character with expressive animal features, not a human in a costume." },
      { id: "cat", label: "Cat", instruction: "Make the character unmistakably feline, with expressive person-like qualities; do not default to a human appearance." },
      { id: "dog", label: "Dog", instruction: "Make the character unmistakably canine, with expressive person-like qualities; do not default to a human appearance." },
      { id: "dragon", label: "Dragon", instruction: "Make the character unmistakably draconic, with memorable dragon features and a non-human silhouette." },
      { id: "mythic", label: "Mythic beast", instruction: "Choose a distinctive mythic creature form and make its non-human features clear." },
      { id: "alien", label: "Alien", instruction: "Give the character a clearly non-human extraterrestrial form." },
      { id: "robot", label: "Robot", instruction: "Make the character a distinctive robot or synthetic being, not a human in a costume." },
      { id: "living-object", label: "Living object", instruction: "Make the character an expressive living object or unusual personified thing." },
    ],
  },
  {
    id: "vibe",
    label: "Vibe",
    traits: [
      { id: "heroic", label: "Heroic", instruction: "Give the character a brave, generous streak and a clear heroic impulse." },
      { id: "sneaky", label: "Sneaky", instruction: "Make the character observant, sly, and fond of clever misdirection." },
      { id: "brilliant", label: "Brilliant", instruction: "Make the character exceptionally clever, with a distinctive way of showing their intelligence." },
      { id: "flirty", label: "Flirty", instruction: "Give the character playful, consensual flirtatious charm without making it their only trait." },
      { id: "chaotic", label: "Chaotic", instruction: "Make the character unpredictable and entertaining while still capable of meaningful choices." },
      { id: "mysterious", label: "Mysterious", instruction: "Give the character an intriguing, guarded quality with motives that unfold through play." },
      { id: "gentle-giant", label: "Gentle giant", instruction: "Pair an imposing presence with surprising warmth and tenderness." },
      { id: "villain-standards", label: "Villain with standards", instruction: "Give the character theatrical villain energy and a personal code they will not break." },
    ],
  },
  {
    id: "scene",
    label: "Scene & interests",
    traits: [
      { id: "gamer", label: "Gamer", instruction: "Make gaming a real interest that shapes the character's references or habits." },
      { id: "hacker", label: "Hacker", instruction: "Give the character a clever maker or hacker sensibility without turning them into a technical stereotype." },
      { id: "streamer", label: "Streamer", instruction: "Give the character an energetic creator or streamer background and a sense of audience." },
      { id: "cosplayer", label: "Cosplayer", instruction: "Make the character a passionate cosplayer who loves transformation, craft, or fandom." },
      { id: "inventor", label: "Inventor", instruction: "Give the character an inventive streak and a habit of making unexpected things." },
      { id: "musician", label: "Musician", instruction: "Make music central to the character's life, taste, or self-expression." },
      { id: "cryptid-blogger", label: "Cryptid blogger", instruction: "Make the character an eccentric investigator of strange creatures and unexplained events." },
      { id: "space-mechanic", label: "Space mechanic", instruction: "Give the character a practical, hands-on space mechanic background." },
    ],
  },
  {
    id: "style",
    label: "Visual flavor",
    traits: [
      { id: "neon-noir", label: "Neon noir", instruction: "Use a bold neon-noir visual palette and moody, high-contrast details." },
      { id: "retro-arcade", label: "Retro arcade", instruction: "Use playful retro arcade colors, graphics, or styling." },
      { id: "solarpunk", label: "Solarpunk", instruction: "Use optimistic solarpunk materials, greenery, and future-craft details." },
      { id: "storybook", label: "Storybook", instruction: "Give the design a whimsical storybook quality with tactile details." },
      { id: "maximalist", label: "Maximalist", instruction: "Favor expressive maximalist color, pattern, and accessories while keeping the design coherent." },
      { id: "cozy-weird", label: "Cozy weird", instruction: "Mix cozy, soft details with one or two delightfully strange visual choices." },
      { id: "scrappy-diy", label: "Scrappy DIY", instruction: "Use handmade, repaired, customized details that feel personal and resourceful." },
    ],
  },
  {
    id: "roots",
    label: "Life roots",
    traits: [
      { id: "multicultural", label: "Multicultural roots", instruction: "Give the character a thoughtful multicultural upbringing without reducing cultures to costume or stereotype; do not invent a specific ethnicity, religion, or sacred custom unless the user names one." },
      { id: "multilingual", label: "Multilingual", instruction: "Make the character multilingual and let language experience inform their life naturally." },
      { id: "bicultural", label: "Bicultural", instruction: "Give the character a nuanced bicultural upbringing without inventing named cultures, ethnicities, religions, or sacred customs the user did not specify." },
      { id: "diaspora-raised", label: "Diaspora-raised", instruction: "Give the character a nuanced diaspora experience without assuming a specific ethnicity or using culture as costume." },
      { id: "global-city", label: "Global-city kid", instruction: "Give the character a background shaped by a culturally diverse global city." },
    ],
  },
  {
    id: "background",
    label: "Background & upbringing",
    traits: [
      { id: "aristocrat", label: "Aristocrat", instruction: "Give the character an aristocratic family background, with specific expectations or obligations; do not assume this makes them arrogant." },
      { id: "trust-fund-kid", label: "Trust-fund kid", instruction: "Give the character family wealth and financial security as part of their history, without reducing them to a spoiled stereotype." },
      { id: "suburban", label: "Suburban upbringing", instruction: "Shape the character's upbringing around suburban life, while making their particular family and community feel distinct." },
      { id: "small-town", label: "Small-town", instruction: "Give the character a small-town upbringing and specific ties to that community, without assuming they are sheltered." },
      { id: "rural", label: "Rural upbringing", instruction: "Give the character a rural upbringing with grounded, specific experience, without making it a caricature." },
      { id: "working-class", label: "Working-class", instruction: "Give the character a working-class background that shapes their lived experience without defining their whole personality." },
      { id: "raised-by-grandparents", label: "Raised by grandparents", instruction: "Make being raised by grandparents a meaningful part of the character's family story." },
      { id: "military-family", label: "Military family", instruction: "Give the character a military-family upbringing with personal, specific effects on their life." },
      { id: "boarding-school", label: "Boarding-school kid", instruction: "Give the character a boarding-school background with particular friendships, habits, or stories." },
    ],
  },
] as const;

export type AgentCreationTraitId = (typeof AGENT_CREATION_TRAIT_GROUPS)[number]["traits"][number]["id"];
export type AgentCreationTrait = (typeof AGENT_CREATION_TRAIT_GROUPS)[number]["traits"][number];

export function agentCreationTraitsForGroup(groupId: string): readonly AgentCreationTrait[] {
  const group = AGENT_CREATION_TRAIT_GROUPS.find((candidate) => candidate.id === groupId);
  return (group?.traits ?? []) as readonly AgentCreationTrait[];
}

export const ALL_AGENT_CREATION_TRAITS: readonly AgentCreationTrait[] = AGENT_CREATION_TRAIT_GROUPS
  .reduce<AgentCreationTrait[]>((all, group) => [...all, ...(group.traits as readonly AgentCreationTrait[])], []);

const TRAIT_BY_ID = new Map(
  AGENT_CREATION_TRAIT_GROUPS.flatMap((group) => group.traits.map((trait) => [trait.id, trait] as const)),
);

export function isAgentCreationTraitId(value: unknown): value is AgentCreationTraitId {
  return typeof value === "string" && TRAIT_BY_ID.has(value as AgentCreationTraitId);
}

export function describeAgentCreationTraits(ids: readonly AgentCreationTraitId[]): string[] {
  return ids.map((id) => {
    const trait = TRAIT_BY_ID.get(id);
    if (!trait) throw new Error(`Unknown agent creation trait: ${id}`);
    return `- ${trait.label}: ${trait.instruction}`;
  });
}
