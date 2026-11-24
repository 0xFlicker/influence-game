import { HouseGameRoute } from "@/app/games/[slug]/house-route";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { gameReplayHref, parseReplayAudience, parseReplayCursor, werewolfMomentHref } from "@/lib/game-links";
import {getPlayerCardMetadata} from "@/lib/server-player-card";
import type {ReplaySearch} from "@/lib/player-card";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<ReplaySearch>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  return getPlayerCardMetadata((await params).slug, searchParams ? await searchParams : {});
}

export default async function GameViewerPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const mode = Array.isArray(resolvedSearchParams.mode)
    ? resolvedSearchParams.mode[0]
    : resolvedSearchParams.mode;

  if (mode === "results") {
    redirect(`/games/${encodeURIComponent(slug)}/results`);
  }
  if (mode === "replay") {
    const audience = parseReplayAudience(resolvedSearchParams.audience);
    const cursor = parseReplayCursor(resolvedSearchParams.cursor);
    if (audience !== "invalid" && cursor !== "invalid" && (cursor === undefined || audience)) redirect(cursor !== undefined && audience ? werewolfMomentHref(slug,audience,cursor) : gameReplayHref(slug, undefined, audience));
  }

  return <HouseGameRoute slug={slug} mode={mode === "replay" ? "replay" : "entry"} audience={resolvedSearchParams.audience} cursor={resolvedSearchParams.cursor} />;
}
