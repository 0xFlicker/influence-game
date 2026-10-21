/** Packaged game identity assets, also frozen into replay exports. */
export const GAME_BRANDS = {
  influence: { name: "Influence", logo: "/home/influence-logo.png", width: 979, height: 180 },
  werewolf: { name: "Werewolf", logo: "/brand/werewolf-wordmark-v1.png", width: 2172, height: 724 },
} as const;
export type BrandedGame = keyof typeof GAME_BRANDS;
