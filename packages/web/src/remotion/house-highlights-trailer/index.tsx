import { Composition, registerRoot } from "remotion";
import {
  HOUSE_HIGHLIGHTS_TRAILER_FPS,
  HOUSE_HIGHLIGHTS_TRAILER_HEIGHT,
  HOUSE_HIGHLIGHTS_TRAILER_WIDTH,
  type HouseHighlightsTrailerManifest,
} from "../../app/games/[slug]/components/house-highlights-trailer-model";
import {
  HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE,
  HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION,
} from "@influence/engine";
import {
  HouseHighlightsTrailerComposition,
  type HouseHighlightsTrailerCompositionProps,
} from "./composition";
import { HOUSE_HIGHLIGHTS_TRAILER_COMPOSITION_ID } from "./constants";

export { HOUSE_HIGHLIGHTS_TRAILER_COMPOSITION_ID };

registerRoot(function RemotionRoot() {
  return (
    <Composition
      id={HOUSE_HIGHLIGHTS_TRAILER_COMPOSITION_ID}
      component={HouseHighlightsTrailerComposition}
      fps={HOUSE_HIGHLIGHTS_TRAILER_FPS}
      width={HOUSE_HIGHLIGHTS_TRAILER_WIDTH}
      height={HOUSE_HIGHLIGHTS_TRAILER_HEIGHT}
      durationInFrames={demoManifest.cueSheet.totalFrames}
      defaultProps={{ manifest: demoManifest }}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.manifest.cueSheet.totalFrames,
        fps: props.manifest.frameRate,
        width: props.manifest.width,
        height: props.manifest.height,
      })}
    />
  );
});

const demoManifest: HouseHighlightsTrailerCompositionProps["manifest"] = {
  schemaVersion: 1,
  mediaType: HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE,
  timingContractVersion: HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION,
  game: {
    id: "demo",
    slug: "demo",
    status: "completed",
  },
  frameRate: HOUSE_HIGHLIGHTS_TRAILER_FPS,
  width: HOUSE_HIGHLIGHTS_TRAILER_WIDTH,
  height: HOUSE_HIGHLIGHTS_TRAILER_HEIGHT,
  cast: [
    agent("alice", "Alice", "/avatars/personas/strategic.png", 1, "winner"),
    agent("bob", "Bob", "/avatars/personas/loyalist.png", 2, "finalist"),
  ],
  scenelets: [
    {
      id: "demo-scene",
      title: "Alice turned the final vote",
      visualType: "jury_judgment",
      backgroundImage: "/house-highlights/generated/jury-judgment.jpg",
      backdropCategory: "jury_wall",
      primaryAgents: [agent("alice", "Alice", "/avatars/personas/strategic.png", 1, "winner")],
      secondaryAgents: [agent("bob", "Bob", "/avatars/personas/loyalist.png", 2, "finalist")],
      outcome: "Alice won the final vote.",
      facts: [{
        id: "demo-fact",
        kind: "jury_outcome",
        text: "Alice won the final vote 2-0.",
        agentIds: ["alice"],
      }],
    },
  ],
  finalVote: {
    finalists: [
      agent("alice", "Alice", "/avatars/personas/strategic.png", 1, "winner"),
      agent("bob", "Bob", "/avatars/personas/loyalist.png", 2, "finalist"),
    ],
    groups: [
      {
        finalist: agent("alice", "Alice", "/avatars/personas/strategic.png", 1, "winner"),
        votes: 2,
        jurors: [
          agent("cara", "Cara", "/avatars/personas/social.png", 3, "eliminated"),
          agent("dax", "Dax", "/avatars/personas/observer.png", 4, "eliminated"),
        ],
      },
      {
        finalist: agent("bob", "Bob", "/avatars/personas/loyalist.png", 2, "finalist"),
        votes: 0,
        jurors: [],
      },
    ],
    voteLabel: "2-0",
    winner: agent("alice", "Alice", "/avatars/personas/strategic.png", 1, "winner"),
  },
  playerResults: [
    {
      agent: agent("bob", "Bob", "/avatars/personas/loyalist.png", 2, "finalist"),
      placementLabel: "2nd",
      tags: ["Runner-up", "Reached final"],
    },
    {
      agent: agent("alice", "Alice", "/avatars/personas/strategic.png", 1, "winner"),
      placementLabel: "1st",
      tags: ["Winner", "Won final vote 2-0"],
    },
  ],
  cueSheet: {
    schemaVersion: 1,
    timingContractVersion: HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION,
    frameRate: HOUSE_HIGHLIGHTS_TRAILER_FPS,
    totalFrames: 648,
    totalDurationSeconds: 21.6,
    segments: [
      cue("cast_roster", "cast_roster", "Cast roster", 0, 150),
      cue("scenelet:demo-scene", "scenelet", "Alice turned the final vote", 150, 270),
      cue("final_vote", "final_vote", "Final vote", 270, 420),
      cue("winner", "winner", "Winner reveal", 420, 540),
      cue("player_result:bob", "player_result", "Bob", 540, 594),
      cue("player_result:alice", "player_result", "Alice", 594, 648),
    ],
    markers: {
      finalVoteRevealSeconds: 9,
      winnerRevealSeconds: 14,
    },
  },
} satisfies HouseHighlightsTrailerManifest;

function agent(
  id: string,
  name: string,
  avatarUrl: string,
  placement: number,
  status: "winner" | "finalist" | "eliminated",
) {
  return {
    id,
    name,
    initials: name.slice(0, 1).toUpperCase(),
    avatarUrl,
    placement,
    status,
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
    startSeconds: startFrame / HOUSE_HIGHLIGHTS_TRAILER_FPS,
    endSeconds: endFrame / HOUSE_HIGHLIGHTS_TRAILER_FPS,
    durationSeconds: (endFrame - startFrame) / HOUSE_HIGHLIGHTS_TRAILER_FPS,
  };
}
