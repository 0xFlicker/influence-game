"use client";

import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { GameSiteEntry } from "./game-site-entry";
import { ApiError, type GameDetail, type GameWatchReplayFrame, type TranscriptEntry } from "@/lib/api";
import { getGameEntry, type GameEntryIdentity } from "@/lib/game-entry";
import { parseReplayAudience, parseReplayCursor } from "@/lib/game-links";

const WerewolfEntry = dynamic(() => import("./werewolf/werewolf-entry").then(m => m.WerewolfEntry));
const EpisodeLanding = dynamic(() => import("@/app/games/episode-landing").then(m => m.EpisodeLanding));
const GameViewer = dynamic(() => import("@/app/games/[slug]/game-viewer").then(m => m.GameViewer));
const Highlights = dynamic(() => import("@/app/games/[slug]/highlights/house-highlights-client").then(m => m.HouseHighlightsClient));

export interface HouseGameEntryProps {
  slug: string;
  mode: "entry" | "replay" | "results" | "highlights";
  identity?: GameEntryIdentity;
  initialStatus?: number;
  initialGame?: GameDetail;
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
    return <GameSiteEntry>{query.error ? (
      <div role="alert">
        <h1>{query.error instanceof ApiError && query.error.status === 404
          ? "Game not found" : "Could not open this game"}</h1>
        <button onClick={() => void query.refetch()}>Try again</button>
      </div>
    ) : <p role="status">Opening the House…</p>}</GameSiteEntry>;
  }

  if (identity.gameKind === "werewolf") {
    if (props.mode === "results" || props.mode === "highlights" || props.startSequence !== undefined) {
      return <GameSiteEntry><h1>Game page not found</h1></GameSiteEntry>;
    }
    const audience = parseReplayAudience(props.audience);
    const cursor = parseReplayCursor(props.cursor);
    if (audience === "invalid" || cursor === "invalid" || (cursor !== undefined && audience === undefined)) {
      return <GameSiteEntry><p role="alert">Invalid replay link. Choose Mystery or Omniscient from the game page.</p></GameSiteEntry>;
    }
    const content = <WerewolfEntry slug={identity.slug} audience={audience}
      replay={props.mode === "replay"} startCursor={cursor} />;
    return props.mode === "replay" && audience ? content : <GameSiteEntry>{content}</GameSiteEntry>;
  }

  if (props.mode === "entry") {
    return <GameSiteEntry><EpisodeLanding key={identity.id} slug={identity.slug} initialGame={props.initialGame} /></GameSiteEntry>;
  }
  if (props.mode === "highlights") {
    return <GameSiteEntry><Highlights gameSlug={identity.slug} selectedSceneId={props.scene ?? null} /></GameSiteEntry>;
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
