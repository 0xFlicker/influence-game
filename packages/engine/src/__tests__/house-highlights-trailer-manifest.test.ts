import { describe, expect, test } from "bun:test";
import {
  HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION,
  HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION,
  hashHouseHighlightsTrailerManifest,
  parseHouseHighlightsTrailerManifest,
  validateHouseHighlightsTrailerManifest,
  type HouseHighlightsTrailerManifest,
} from "../postgame-media/house-highlights-trailer-manifest";

describe("House Highlights trailer render-input manifest", () => {
  test("accepts one complete serializable versioned render-input snapshot", () => {
    const manifest = manifestFixture();

    expect(validateHouseHighlightsTrailerManifest(manifest)).toEqual({
      ok: true,
      errors: [],
    });
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    expect(manifest.schemaVersion).toBe(HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION);
    expect(manifest.timingContractVersion).toBe(
      HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION,
    );
    expect(parseHouseHighlightsTrailerManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  test("rejects missing required winner and cue timing data", () => {
    const manifest = manifestFixture();
    const invalid: unknown = {
      ...manifest,
      finalVote: {
        finalists: manifest.finalVote.finalists,
        groups: manifest.finalVote.groups,
        voteLabel: manifest.finalVote.voteLabel,
      },
      cueSheet: {
        ...manifest.cueSheet,
        markers: {
          finalVoteRevealSeconds: manifest.cueSheet.markers.finalVoteRevealSeconds,
        },
      },
    };

    const result = validateHouseHighlightsTrailerManifest(invalid);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("finalVote.winner must be an agent");
    expect(result.errors).toContain(
      "cueSheet.markers.winnerRevealSeconds must be a non-negative number",
    );
    expect(() => parseHouseHighlightsTrailerManifest(invalid)).toThrow(
      "Invalid House Highlights trailer manifest",
    );
  });

  test("produces a stable snapshot hash for equivalent key ordering", () => {
    const manifest = manifestFixture();
    const reordered: HouseHighlightsTrailerManifest = {
      timingContractVersion: manifest.timingContractVersion,
      cueSheet: manifest.cueSheet,
      playerResults: manifest.playerResults,
      finalVote: manifest.finalVote,
      scenelets: manifest.scenelets,
      cast: manifest.cast,
      height: manifest.height,
      width: manifest.width,
      frameRate: manifest.frameRate,
      game: manifest.game,
      mediaType: manifest.mediaType,
      schemaVersion: manifest.schemaVersion,
    };

    const hash = hashHouseHighlightsTrailerManifest(manifest);

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hashHouseHighlightsTrailerManifest(reordered)).toBe(hash);
    expect(hashHouseHighlightsTrailerManifest(structuredClone(manifest))).toBe(hash);
  });
});

function manifestFixture(): HouseHighlightsTrailerManifest {
  const winner = {
    id: "player-winner",
    name: "Mira Solari",
    initials: "MS",
    avatarUrl: "https://media.example.test/avatars/mira.png",
    placement: 1,
    status: "winner" as const,
  };
  const runnerUp = {
    id: "player-runner-up",
    name: "Orion Vale",
    initials: "OV",
    avatarUrl: "https://media.example.test/avatars/orion.png",
    placement: 2,
    status: "finalist" as const,
  };

  return {
    schemaVersion: 1,
    mediaType: "house_highlights_trailer",
    timingContractVersion: "house-highlights-trailer-timing-v1",
    game: {
      id: "game-house-highlights",
      slug: "vast-plum-bay",
      status: "completed",
    },
    frameRate: 30,
    width: 1920,
    height: 1080,
    cast: [winner, runnerUp],
    scenelets: [
      {
        id: "scene-final-five",
        title: "The vote that split the room",
        visualType: "vote_tableau",
        backgroundImage: "/house-highlights/generated/vote-tableau.webp",
        backdropCategory: "council",
        primaryAgents: [winner],
        secondaryAgents: [runnerUp],
        outcome: "Mira kept the deciding vote on her side.",
        facts: [
          {
            id: "fact-final-five-vote",
            kind: "vote_action",
            text: "Mira voted with the 3-2 majority.",
            agentIds: [winner.id, runnerUp.id],
          },
        ],
      },
    ],
    finalVote: {
      finalists: [winner, runnerUp],
      groups: [
        { finalist: winner, votes: 4, jurors: [runnerUp] },
        { finalist: runnerUp, votes: 3, jurors: [winner] },
      ],
      voteLabel: "4-3",
      winner,
    },
    playerResults: [
      {
        agent: winner,
        placementLabel: "Winner",
        tags: ["4 jury votes"],
      },
    ],
    cueSheet: {
      schemaVersion: 1,
      timingContractVersion: "house-highlights-trailer-timing-v1",
      frameRate: 30,
      totalFrames: 594,
      totalDurationSeconds: 19.8,
      segments: [
        cue("cast_roster", "cast_roster", "Cast roster", 0, 150),
        cue("scenelet:scene-final-five", "scenelet", "The vote that split the room", 150, 270),
        cue("final_vote", "final_vote", "Final vote", 270, 420),
        cue("winner", "winner", "Winner reveal", 420, 540),
        cue("player_result:player-winner", "player_result", "Mira Solari", 540, 594),
      ],
      markers: {
        finalVoteRevealSeconds: 9,
        winnerRevealSeconds: 14,
      },
    },
  };
}

function cue(
  id: string,
  kind: "cast_roster" | "scenelet" | "final_vote" | "winner" | "player_result",
  label: string,
  startFrame: number,
  endFrame: number,
) {
  return {
    id,
    kind,
    label,
    startFrame,
    endFrame,
    startSeconds: startFrame / 30,
    endSeconds: endFrame / 30,
    durationSeconds: (endFrame - startFrame) / 30,
  };
}
