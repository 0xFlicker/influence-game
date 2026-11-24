"use client";

import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { GameSiteEntry } from "./game-site-entry";
import { GameEntryLoading, GameEntrySkeleton } from "./game-entry-loading";
import { ApiError, type GameDetail, type GameWatchReplayFrame, type TranscriptEntry } from "@/lib/api";
import { getGameEntry, type GameEntryIdentity } from "@/lib/game-entry";
import { parseReplayAudience, parseReplayCursor } from "@/lib/game-links";
import type { WerewolfLobbyData } from "@/lib/werewolf-api";

const WerewolfResults = dynamic(() => import("./werewolf/werewolf-results").then(m => m.WerewolfResultsPage), { loading: () => <GameEntrySkeleton results /> });
const WerewolfEntry = dynamic(() => import("./werewolf/werewolf-entry").then(m => m.WerewolfEntry), { loading: () => <GameEntryLoading /> });
const EpisodeLanding = dynamic(() => import("@/app/games/episode-landing").then(m => m.EpisodeLanding), { loading: () => <GameEntryLoading /> });
const InfluenceResults = dynamic(() => import("@/app/games/[slug]/components/influence-results-entry").then(m => m.InfluenceResultsEntry), { loading: () => <GameEntrySkeleton results /> });
const GameViewer = dynamic(() => import("@/app/games/[slug]/game-viewer").then(m => m.GameViewer));
const Highlights = dynamic(() => import("@/app/games/[slug]/highlights/house-cuts-client").then(m => m.HouseCutsClient));

export interface HouseGameEntryProps {
  slug: string;
  mode: "entry" | "replay" | "results" | "highlights";
  identity?: GameEntryIdentity;
  initialStatus?: number;
  initialGame?: GameDetail;
  initialWerewolfLobby?: WerewolfLobbyData;
  initialMessages?: TranscriptEntry[];
  initialReplayFrames?: GameWatchReplayFrame[];
  audience?: string | string[];
  cursor?: string | string[];
  startSequence?: number;
  scene?: string;
}

export function HouseGameEntry(props: HouseGameEntryProps) {
  const query = useQuery({
    queryKey: ["house-entry", props.slug],
    queryFn: ({ signal }) => getGameEntry(props.slug, signal),
    initialData: props.identity,
    enabled: !props.identity,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const identity = query.data;
  if (!identity) {
    if (!query.error) return <GameEntryLoading results={props.mode === "results"} />;
    return <GameSiteEntry>
      <div role="alert">
        <h1>{query.error instanceof ApiError && query.error.status === 404
          ? "Game not found" : "Could not open this game"}</h1>
        <button onClick={() => void query.refetch()}>Try again</button>
      </div>
    </GameSiteEntry>;
  }

  if (props.mode === "highlights") return <GameSiteEntry><Highlights slug={identity.slug} selectedId={props.scene} audience={Array.isArray(props.audience) ? props.audience[0] : props.audience} /></GameSiteEntry>;
  if (identity.gameKind === "werewolf") {
    if (props.startSequence !== undefined) {
      return <GameSiteEntry><h1>Game page not found</h1></GameSiteEntry>;
    }
    if (props.mode === "results") return <GameSiteEntry><WerewolfResults key={identity.id} slug={identity.slug} /></GameSiteEntry>;
    const audience = parseReplayAudience(props.audience);
    const cursor = parseReplayCursor(props.cursor);
    if (audience === "invalid" || cursor === "invalid" || (cursor !== undefined && audience === undefined)) {
      return <GameSiteEntry><p role="alert">Invalid replay link. Choose Mystery or Omniscient from the game page.</p></GameSiteEntry>;
    }
    return <WerewolfEntry slug={identity.slug} audience={audience}
      replay={props.mode === "replay"} startCursor={cursor} initialGame={props.initialWerewolfLobby} />;
  }

  if (props.mode === "entry") {
    return <EpisodeLanding key={identity.id} slug={identity.slug} initialGame={props.initialGame} />;
  }
  if (props.mode === "results") {
    return <GameSiteEntry><InfluenceResults key={identity.id} slug={identity.slug} initialGame={props.initialGame} /></GameSiteEntry>;
  }
  return <GameViewer
    key={identity.id}
    gameId={identity.slug}
    completedMode={props.mode}
    initialGame={props.initialGame}
    initialMessages={props.initialMessages}
    initialReplayFrames={props.initialReplayFrames}
    startSequence={props.startSequence}
  />;
}
