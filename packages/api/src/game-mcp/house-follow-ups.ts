import type {
  HouseInspectionInput,
  HouseThinkingInput,
} from "../services/house-game-inspection.js";
import type {
  HouseGameRead,
  HouseCatalogRead,
  HouseResultsRead,
  HouseThinkingRead,
} from "./house-contract-types.js";

export type HouseFollowUp =
  | { tool: "read_game"; arguments: HouseInspectionInput }
  | { tool: "read_game_thinking"; arguments: HouseThinkingInput }
  | { tool: "read_game_cuts"; arguments: { gameIdOrSlug: string; audience?: "public" | "mystery" | "omniscient" } }
  | { tool: "read_game_results"; arguments: { gameIdOrSlug: string } }
  | { tool: "get_rules"; arguments: { gameKind: "influence" | "werewolf" } };

/** Invoked only after the corresponding closed output schema has validated the value. */
export function houseFollowUps(name: string, value: unknown): HouseFollowUp[] {
  if (name === "list_games") {
    const result = value as HouseCatalogRead;
    // Producer inventory can contain Hidden games; it is not a spectator grant.
    return "games" in result && result.collection !== "producer"
      ? result.games.map((game) => ({
          tool: "read_game",
          arguments: { gameIdOrSlug: game.id, view: "replay" },
        }))
      : [];
  }
  if (name === "read_game") {
    const page = value as HouseGameRead;
    if (!("game" in page)) return [];
    const gameIdOrSlug = page.game.id;
    const followUps: HouseFollowUp[] = [
      { tool: "get_rules", arguments: { gameKind: page.gameKind } },
      {
        tool: "read_game",
        arguments: { gameIdOrSlug, audience: page.audience, view: "replay" },
      },
    ];
    const cursor = page.nextCursor ?? page.pollCursor;
    if (cursor)
      followUps.push({
        tool: "read_game",
        arguments: { gameIdOrSlug, audience: page.audience, cursor },
      });
    if (page.capabilities.manualReread)
      followUps.push({
        tool: "read_game",
        arguments: { gameIdOrSlug, audience: page.audience, view: "current" },
      });
    if (page.capabilities.results)
      followUps.push({ tool: "read_game_cuts", arguments: { gameIdOrSlug, audience: page.audience } }, {
        tool: "read_game_results",
        arguments: { gameIdOrSlug },
      });
    if (page.gameKind === "werewolf" && page.audience === "omniscient") {
      followUps.push({
        tool: "read_game_thinking",
        arguments: {
          gameIdOrSlug,
          audience: "omniscient",
          position: [page.position.cursor],
        },
      });
    } else if (page.gameKind === "influence") {
      for (const player of page.snapshot?.players ?? [])
        followUps.push({
          tool: "read_game_thinking",
          arguments: {
            gameIdOrSlug,
            audience: "public",
            actorId: player.id,
            position: [
              page.position.eventSequence,
              page.position.transcriptSequence ?? 0,
            ],
          },
        });
    }
    return followUps;
  }
  if (name === "read_game_results") {
    const result = value as HouseResultsRead;
    return "result" in result
      ? [
          {
            tool: "read_game",
            arguments: { gameIdOrSlug: result.result.game.id, view: "replay" },
          },
        ]
      : [];
  }
  // Thinking continuation also needs the caller's actor filter, so the server
  // supplies its validated input rather than reconstructing it from the prose.
  return [];
}
export function thinkingFollowUp(
  value: HouseThinkingRead,
  input: HouseThinkingInput,
): HouseFollowUp[] {
  return "nextCursor" in value && value.nextCursor
    ? [
        {
          tool: "read_game_thinking",
          arguments: { ...input, cursor: value.nextCursor },
        },
      ]
    : [];
}
