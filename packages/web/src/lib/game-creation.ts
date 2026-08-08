export const CREATE_GAME_PLAYER_COUNTS = [6, 8, 10, 12] as const;

export type CreateGamePlayerCount = (typeof CREATE_GAME_PLAYER_COUNTS)[number];
