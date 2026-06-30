export const HOUSE_VENUE = {
  name: "The House",
  domain: "thehouse.game",
} as const;

export const ACTIVE_GAME = {
  id: "influence",
  name: "Influence",
  badgeLabel: "Influence",
  rulesLabel: "Influence rules",
  queueLabel: "Influence queue",
} as const;

export const THE_HOUSE_PRESENTS_INFLUENCE = `${HOUSE_VENUE.name} presents ${ACTIVE_GAME.name}`;

