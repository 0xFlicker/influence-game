import { getPublicPostgameMedia } from "./postgame-media.js";
import { readWerewolfCastingPlayers } from "./werewolf-lobbies.js";
import type { DrizzleDB } from "../db/index.js";
import {
  gameHref,
  gameReplayHref,
  gameResultsHref,
  werewolfMomentHref,
  gameReplaySequenceHref,
} from "@influence/engine/game-links";
import {
  resolveHouseSpectatorGame,
  houseGameIdentity,
  HouseInspectionError,
  type HouseGame,
} from "./house-game-access.js";
import { loadHouseWerewolfHistory } from "./house-werewolf-inspection.js";
import { loadHouseInfluenceHistory } from "./house-influence-inspection.js";
import {
  encodeHouseCursor,
  decodeHouseCursor,
  assertHouseCursorHead,
  houseJsonBytes,
  HOUSE_PAGE_BYTES,
  type HouseCursor,
} from "./house-read-cursor.js";
import { readHouseGameResults } from "./house-game-results.js";
import { readWerewolfThinking } from "./werewolf-thinking.js";
import { getPublicWatchIntelligence } from "./public-watch-intelligence.js";

export interface HouseInspectionInput {
  gameIdOrSlug: string;
  audience?: "public" | "mystery" | "omniscient";
  view?: "current" | "replay";
  cursor?: string;
  limit?: number;
}
export interface HouseThinkingInput {
  gameIdOrSlug: string;
  audience: "public" | "omniscient";
  position: number[];
  actorId?: string;
  cursor?: string;
  limit?: number;
}
function audienceFor(
  game: HouseGame,
  value?: HouseInspectionInput["audience"],
) {
  const audience =
    value ?? (game.gameKind === "werewolf" ? "mystery" : "public");
  if (
    game.gameKind === "werewolf" ? audience === "public" : audience !== "public"
  )
    throw new HouseInspectionError(
      "invalid_input",
      "Audience does not belong to this game",
    );
  return audience;
}
function continuations(c: HouseCursor, active: boolean) {
  const more = c.after.some((n, i) => n < c.through[i]!);
  return {
    nextCursor: more ? encodeHouseCursor({ ...c, poll: false }) : null,
    pollCursor:
      !more && active ? encodeHouseCursor({ ...c, poll: true }) : null,
  };
}
function paging(
  input: HouseInspectionInput,
  game: HouseGame,
  audience: HouseCursor["audience"],
  head: number[],
) {
  const binding = {
    gameId: game.id,
    gameKind: game.gameKind,
    audience,
    lane: "history" as const,
    actorId: null,
  };
  const c = input.cursor
    ? decodeHouseCursor(input.cursor, binding)
    : {
        version: 1 as const,
        ...binding,
        after: head.map(() => 0),
        through: head,
        poll: false,
        cutoff: [],
      };
  assertHouseCursorHead(c, head);
  if (c.cutoff.length)
    throw new HouseInspectionError(
      "invalid_cursor",
      "History cursor cannot have a thinking cutoff",
    );
  if (c.poll) c.through = head;

  return c;
}
/** Whole-entry budget. The response is rebuilt at every prefix so its board cannot run ahead. */
function fitPage<T>(build: (count: number) => T, maximum: number): T {
  for (let count = maximum; count >= 0; count--) {
    const value = build(count);
    if (houseJsonBytes(value) <= HOUSE_PAGE_BYTES - 8192) {
      if (count === 0 && maximum > 0) break;
      return value;
    }
  }
  throw new HouseInspectionError(
    "entry_too_large",
    "A complete entry exceeds the response budget",
  );
}
export async function readHouseGame(
  db: DrizzleDB,
  input: HouseInspectionInput,
) {
  return db.transaction(
    async (tx) => {
      const game = await resolveHouseSpectatorGame(tx, input.gameIdOrSlug),
        audience = audienceFor(game, input.audience);
      if (input.cursor && input.view === "current")
        throw new HouseInspectionError(
          "invalid_input",
          "A cursor continues replay; it cannot request current view",
        );
      const view = input.cursor ? "replay" : (input.view ?? "current"),
        limit = input.limit ?? 10;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
        throw new HouseInspectionError(
          "invalid_input",
          "Limit must be between 1 and 20",
        );
      const base = {
        schemaVersion: 1 as const,
        game: houseGameIdentity(game),
        audience,
        view,
        contentTrust: "untrusted_game_authored" as const,
        trailer: game.status === "completed" ? { ...await getPublicPostgameMedia(tx, game.id), shareHref: gameHref(game.slug) } : null,
      };
      if (game.gameKind === "werewolf" && audience !== "public") {
        const casting = !game.startedAt
          ? (await readWerewolfCastingPlayers(tx, game.id)).map(
              ({ id, name, personaKey, available }) => ({
                id,
                name,
                personaKey,
                available,
              }),
            )
          : null;
        const frames = await loadHouseWerewolfHistory(tx, game, audience),
          c = paging(input, game, audience, [frames.length]);
        return fitPage(
          (count) => {
            const entries =
              view === "current"
                ? frames.slice(Math.max(0, frames.length - count))
                : frames.slice(
                    c.after[0],
                    Math.min(c.through[0]!, c.after[0]! + count),
                  );
            const after =
              view === "current"
                ? frames.length
                : (entries.at(-1)?.cursor ?? c.after[0]!);
            return {
              ...base,
              audience,
              gameKind: "werewolf" as const,
              position: { cursor: after },
              snapshot: frames[after - 1]?.snapshot ?? null,
              casting,
              entries,
              capabilities: {
                results: game.status === "completed",
                thinking: audience === "omniscient",
                manualReread:
                  game.status === "suspended" || game.status === "waiting",
              },
              ...continuations(
                { ...c, after: [after] },
                game.status === "in_progress",
              ),
              links: {
                replay: after
                  ? werewolfMomentHref(game.slug, audience, after)
                  : gameReplayHref(game.slug, undefined, audience),
                results:
                  game.status === "completed"
                    ? gameResultsHref(game.slug)
                    : null,
              },
            };
          },
          Math.min(limit, c.through[0]! - c.after[0]!),
        );
      }
      const { facts, dialogue } = await loadHouseInfluenceHistory(tx, game),
        c = paging(input, game, audience, [facts.length, dialogue.length]);
      return fitPage(
        (count) => {
          // Two independent lanes, alternating page allocation; no invented merged chronology.
          let f = c.after[0]!,
            d = c.after[1]!;
          for (let n = 0; n < count; n++) {
            if (f < c.through[0]! && (n % 2 === 0 || d >= c.through[1]!)) f++;
            else if (d < c.through[1]!) d++;
          }
          const factCount = f - c.after[0]!,
            dialogueCount = d - c.after[1]!;
          if (view === "current") {
            f = facts.length;
            d = dialogue.length;
          }
          const snapshot = facts[f - 1] ?? null;
          return {
            ...base,
            audience: "public" as const,
            gameKind: "influence" as const,
            position: {
              eventSequence: snapshot?.sequence ?? 0,
              transcriptSequence: dialogue[d - 1]?.entrySequence ?? null,
            },
            ordering:
              "Independent canonical and dialogue lanes; legacy dialogue ordering is approximate" as const,
            snapshot,
            facts: facts.slice(
              view === "current" ? f - factCount : c.after[0],
              f,
            ),
            dialogue: dialogue.slice(
              view === "current" ? d - dialogueCount : c.after[1],
              d,
            ),
            capabilities: {
              results: game.status === "completed",
              thinking: true,
              manualReread:
                game.status === "suspended" || game.status === "waiting",
            },
            ...continuations(
              { ...c, after: [f, d] },
              game.status === "in_progress",
            ),
            links: {
              replay: snapshot
                ? gameReplaySequenceHref(game.slug, snapshot.sequence)
                : gameReplayHref(game.slug),
              results:
                game.status === "completed" ? gameResultsHref(game.slug) : null,
            },
          };
        },
        Math.min(
          limit,
          c.through.reduce((n, h, i) => n + h - c.after[i]!, 0),
        ),
      );
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export async function readHouseInspectionResults(db: DrizzleDB, id: string) {
  const result = await readHouseGameResults(db, id);
  if (!result.ok)
    throw new HouseInspectionError(
      result.status === "not_found" ? "not_accessible" : result.status,
      result.error,
    );
  const value = {
    schemaVersion: 1 as const,
    gameKind: result.gameKind,
    result,
    href: gameResultsHref(result.game.slug),
    contentTrust: "untrusted_game_authored" as const,
  };
  if (houseJsonBytes(value) > 256 * 1024)
    throw new HouseInspectionError(
      "entry_too_large",
      "Complete results exceed the response budget",
    );
  return value;
}
export async function readHouseGameThinking(
  db: DrizzleDB,
  input: HouseThinkingInput,
) {
  return db.transaction(
    async (tx) => {
      const game = await resolveHouseSpectatorGame(tx, input.gameIdOrSlug),
        audience = audienceFor(game, input.audience);
      if (
        !input.position.length ||
        input.position.some((n) => !Number.isSafeInteger(n) || n < 0) ||
        !Number.isSafeInteger(input.limit ?? 10) ||
        (input.limit ?? 10) < 1 ||
        (input.limit ?? 10) > 20
      )
        throw new HouseInspectionError(
          "invalid_input",
          "Invalid thinking position or limit",
        );
      const base = {
        schemaVersion: 1 as const,
        game: houseGameIdentity(game),
        audience,
        contentTrust: "untrusted_game_authored" as const,
      };
      if (game.gameKind === "werewolf" && audience === "omniscient") {
        const frames = await loadHouseWerewolfHistory(tx, game, audience);
        if (input.position.length !== 1 || input.position[0]! > frames.length)
          throw new HouseInspectionError(
            "invalid_cursor",
            "Invalid thinking position",
          );
        const entries =
          input.position[0] === 0
            ? []
            : (
                await validatedWerewolfThinking(
                  tx,
                  game.id,
                  audience,
                  input.position[0]!,
                )
              ).entries.filter(
                (e) => !input.actorId || e.actorId === input.actorId,
              );
        const binding = {
          gameId: game.id,
          gameKind: game.gameKind,
          audience,
          lane: "thinking" as const,
          actorId: input.actorId ?? null,
        };
        const c = input.cursor
          ? decodeHouseCursor(input.cursor, binding)
          : {
              version: 1 as const,
              ...binding,
              after: [0],
              through: [entries.length],
              poll: false,
              cutoff: input.position,
            };
        assertHouseCursorHead(c, [entries.length]);
        if (
          c.poll ||
          JSON.stringify(c.cutoff) !== JSON.stringify(input.position)
        )
          throw new HouseInspectionError(
            "invalid_cursor",
            "Thinking cutoff changed",
          );
        return fitPage(
          (count) => {
            const page = entries.slice(
              c.after[0],
              Math.min(c.through[0]!, c.after[0]! + count),
            );
            return {
              ...base,
              audience,
              gameKind: "werewolf" as const,
              position: input.position,
              entries: page,
              availability: entries.length
                ? ("available" as const)
                : ("not_captured" as const),
              effectiveLimit: 20,
              nextCursor: continuations(
                { ...c, after: [c.after[0]! + page.length] },
                false,
              ).nextCursor,
            };
          },
          Math.min(input.limit ?? 10, c.through[0]! - c.after[0]!),
        );
      }
      if (game.gameKind !== "influence" || audience !== "public")
        throw new HouseInspectionError(
          "invalid_input",
          "Thinking requires Omniscient viewing",
        );
      if (input.cursor || input.position.length !== 2 || !input.actorId)
        throw new HouseInspectionError(
          "invalid_input",
          "Influence thinking requires an actor and canonical/transcript cutoff; it returns at most eight recent cards",
        );
      const { facts, dialogue } = await loadHouseInfluenceHistory(tx, game);
      const [sequence, transcript] = input.position;
      const frame =
        sequence === 0 ? null : facts.find((f) => f.sequence === sequence);
      if (
        (sequence !== 0 && !frame) ||
        (transcript !== 0 &&
          !dialogue.some((e) => e.entrySequence === transcript))
      )
        throw new HouseInspectionError(
          "invalid_cursor",
          "Invalid thinking position",
        );
      const result = await getPublicWatchIntelligence(tx, {
        gameIdOrSlug: game.id,
        actorPlayerId: input.actorId,
        throughEventSequence: sequence,
        throughTranscriptSequence: transcript,
        round: frame?.round ?? 0,
        phase: frame?.phase ?? "INIT",
        limit: Math.min(input.limit ?? 8, 8),
      });
      if (!result.ok)
        throw new HouseInspectionError(
          "unavailable",
          "Thinking is unavailable",
        );
      const value = {
        ...base,
        audience: "public" as const,
        gameKind: "influence" as const,
        position: input.position,
        entries: result.intelligence.thinking.cards,
        availability: result.intelligence.thinking.status,
        limitation: result.intelligence.thinking.reason ?? null,
        effectiveLimit: 8,
        nextCursor: null,
      };
      if (houseJsonBytes(value) > HOUSE_PAGE_BYTES - 8192)
        throw new HouseInspectionError(
          "entry_too_large",
          "Thinking exceeds the response budget",
        );
      return value;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function validatedWerewolfThinking(
  ...args: Parameters<typeof readWerewolfThinking>
) {
  try {
    return await readWerewolfThinking(...args);
  } catch {
    throw new HouseInspectionError(
      "unavailable",
      "Thinking evidence failed validation",
    );
  }
}
