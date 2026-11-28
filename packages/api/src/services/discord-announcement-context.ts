import { gameHref, gameReplayHref } from "@influence/engine/game-links";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  claimDiscordAnnouncementLease, completeDiscordAnnouncement, readEligibleDiscordAnnouncementGame,
  suppressDiscordAnnouncementClaim, type DiscordAnnouncementClaim,
} from "./discord-announcement-jobs.js";
import { readHouseGameResultsInTransaction } from "./house-game-results.js";

const publicOrigin = "https://thehouse.game";
const maxTurningPoints = 3;

/** Public display labels are input data, and only a bounded selection reaches the writer. */
function label(value: string) {
  return value.slice(0, 160);
}

async function readAnnouncementContext(db: DrizzleDB, claim: DiscordAnnouncementClaim) {
  return db.transaction(async tx => {
    const game = await readEligibleDiscordAnnouncementGame(tx, claim);
    if (!game) return { status: "suppressed" } as const;

    const basePath = game.gameKind === "werewolf" ? gameReplayHref(game.slug, undefined, "mystery")
      : claim.kind === "start" ? gameHref(game.slug) : gameReplayHref(game.slug);
    const url = publicOrigin + basePath;
    const [season] = game.seasonId ? await tx.select({ name: schema.seasons.name }).from(schema.seasons)
      .where(eq(schema.seasons.id, game.seasonId)) : [];
    const facts = { gameKind: game.gameKind, season: season ? label(season.name) : null };
    if (claim.kind === "start") return { status: "ready", url, facts } as const;

    const result = await readHouseGameResultsInTransaction(tx, game.id);
    if (!result.ok) return { status: "unavailable" } as const;
    if (result.gameKind === "influence") {
      const { summary, eliminationOrder, jury } = result.results;
      if (!summary.winner) return { status: "unavailable" } as const;
      const outcome = {
        winner: label(summary.winner.name),
        juryVotes: jury.voteCounts.map(({ finalist, votes }) => ({ finalist: label(finalist.name), votes })),
      };
      const turningPoints = eliminationOrder.slice(-maxTurningPoints).map(({ round, player, source, method }) => ({
        kind: "elimination",
        round,
        player: label(player.name),
        source,
        method: method ? label(method) : null,
      }));
      return { status: "ready", url, facts: { ...facts, outcome, turningPoints } } as const;
    }

    const playerNames = new Map(result.results.players.map(player => [player.id, label(player.name)]));
    const outcome = { faction: result.results.outcome.faction, reason: result.results.outcome.reason };
    const turningPoints = result.results.recap.map(point => {
      const ids = point.kind === "night" ? [point.result.killedId, point.result.snipe?.killedId] : [point.result.eliminatedId];
      return { kind: point.kind, day: point.day,
        eliminated: ids.flatMap(id => {
          const name = id ? playerNames.get(id) : undefined;
          return name ? [name] : [];
        }) };
    }).filter(point => point.eliminated.length > 0).slice(-maxTurningPoints);
    return { status: "ready", url, facts: { ...facts, outcome, turningPoints } } as const;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function claimDiscordAnnouncement(db: DrizzleDB, channelId: string) {
  const claim = await claimDiscordAnnouncementLease(db, channelId);
  if (!claim) return null;

  let snapshot;
  try {
    snapshot = await readAnnouncementContext(db, claim);
  } catch (error) {
    await completeDiscordAnnouncement(db, { ...claim, outcome: "retry" });
    throw error;
  }
  if (snapshot.status === "suppressed") {
    await suppressDiscordAnnouncementClaim(db, claim);
    return null;
  }
  if (snapshot.status === "unavailable") {
    await completeDiscordAnnouncement(db, { ...claim, outcome: "failed" });
    console.warn(JSON.stringify({ event: "discord_announcement_recap_unavailable", jobId: claim.id }));
    return null;
  }
  const { gameId: _gameId, ...job } = claim;
  return { ...job, url: snapshot.url, facts: snapshot.facts };
}
