import type { WerewolfItemId, WerewolfRole } from "./types";

export interface WerewolfItemDefinition {
  id: WerewolfItemId;
  name: string;
  description: string;
}

/** Short-id item catalog. Ownership is a set of these ids per player. */
export const WEREWOLF_ITEMS: Readonly<Record<WerewolfItemId, WerewolfItemDefinition>> = {
  snipe: {
    id: "snipe",
    name: "Snipe",
    description: "Single-use. At night, remove one other living player from the game. Doctor protection does not block a snipe.",
  },
};

export const WEREWOLF_ITEM_IDS = Object.keys(WEREWOLF_ITEMS) as WerewolfItemId[];

export function isWerewolfItemId(value: unknown): value is WerewolfItemId {
  return typeof value === "string" && Object.hasOwn(WEREWOLF_ITEMS, value);
}

/** Items granted at game start for a role. Only the Hunter receives an item in this set. */
export function werewolfRoleItems(role: WerewolfRole): WerewolfItemId[] {
  return role === "hunter" ? ["snipe"] : [];
}

export function initialWerewolfItems(
  players: readonly { id: string }[],
  roles: Readonly<Record<string, WerewolfRole>>,
  itemsEnabled: boolean,
): Record<string, WerewolfItemId[]> {
  return Object.fromEntries(players.map((player) => [
    player.id,
    itemsEnabled ? [...new Set(werewolfRoleItems(roles[player.id]!))] : [],
  ]));
}

export function werewolfItemCatalog(itemsEnabled: boolean): WerewolfItemDefinition[] {
  return itemsEnabled ? WEREWOLF_ITEM_IDS.map((id) => ({ ...WEREWOLF_ITEMS[id] })) : [];
}
