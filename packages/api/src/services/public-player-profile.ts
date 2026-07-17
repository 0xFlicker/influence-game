import type { DrizzleDB } from "../db/index.js";
import {
  getPublicPlayerCompetitionFacts,
  type PublicAgentPreview,
  type PublicCompetitionResult,
} from "./public-agent-preview.js";
import {
  resolvePublicPlayer,
  type PublicPlayerIdentityRef,
} from "./public-player-identity.js";
import { getCurrentPublicSeasonDashboard } from "./season-read-model.js";

export interface PublicPlayerProfile {
  identity: PublicPlayerIdentityRef;
  currentSeason: null | {
    season: {
      slug: string;
      name: string;
      status: "active" | "closing" | "final";
    };
    architectStanding: null | {
      rank: number;
      totalPointsHundredths: number;
      wins: number;
      contributions: Array<{
        agentName: string;
        sourcePoints: number;
        weightPercent: 100 | 50 | 25;
        weightedPointsHundredths: number;
      }>;
    };
    honors: {
      agentChampion: boolean;
      architectChampion: boolean;
    };
  };
  career: {
    rating: number;
    peakRating: number;
    gamesPlayed: number;
    wins: number;
    winRate: number;
  };
  recentResults: PublicCompetitionResult[];
  agents: PublicAgentPreview[];
}

export type PublicPlayerProfileEnvelope =
  | {
      schemaVersion: 1;
      status: "found";
      profile: PublicPlayerProfile;
    }
  | {
      schemaVersion: 1;
      status: "not_found";
    };

export const PUBLIC_PLAYER_NOT_FOUND = {
  schemaVersion: 1,
  status: "not_found",
} as const satisfies PublicPlayerProfileEnvelope;

export async function getPublicPlayerProfile(
  db: DrizzleDB,
  identifier: string,
): Promise<PublicPlayerProfileEnvelope> {
  const player = await resolvePublicPlayer(db, identifier);
  if (!player) return PUBLIC_PLAYER_NOT_FOUND;

  const [competition, currentSeasonDashboard] = await Promise.all([
    getPublicPlayerCompetitionFacts(db, player.internalUserId),
    getCurrentPublicSeasonDashboard(db),
  ]);
  const architectStanding = currentSeasonDashboard?.architectStandings
    .find((standing) => standing.owner?.publicId === player.identity.publicId) ?? null;
  const gamesPlayed = player.career.gamesPlayed;

  return {
    schemaVersion: 1,
    status: "found",
    profile: {
      identity: player.identity,
      currentSeason: currentSeasonDashboard
        ? {
            season: {
              slug: currentSeasonDashboard.season.slug,
              name: currentSeasonDashboard.season.name,
              status: currentSeasonDashboard.season.status,
            },
            architectStanding: architectStanding
              ? {
                  rank: architectStanding.rank,
                  totalPointsHundredths: architectStanding.totalPointsHundredths,
                  wins: architectStanding.wins,
                  contributions: architectStanding.contributions.map((contribution) => ({
                    agentName: contribution.agentName,
                    sourcePoints: contribution.sourcePoints,
                    weightPercent: contribution.weightPercent,
                    weightedPointsHundredths: contribution.weightedPointsHundredths,
                  })),
                }
              : null,
            honors: {
              agentChampion:
                currentSeasonDashboard.honors?.agentChampion.owner?.publicId
                  === player.identity.publicId,
              architectChampion:
                currentSeasonDashboard.honors?.architectChampion.owner?.publicId
                  === player.identity.publicId,
            },
          }
        : null,
      career: {
        rating: player.career.rating,
        peakRating: player.career.peakRating,
        gamesPlayed,
        wins: player.career.wins,
        winRate: gamesPlayed > 0 ? player.career.wins / gamesPlayed : 0,
      },
      recentResults: competition.recentResults,
      agents: competition.agents,
    },
  };
}
