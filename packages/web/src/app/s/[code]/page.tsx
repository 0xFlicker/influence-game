import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { parseHouseShareTarget, SHARE_CODE_PATTERN } from "@influence/engine/house-share-target";
import { serverApiFetch, ServerApiError } from "@/lib/server-api";
import { getPlayerCardGame } from "@/lib/server-player-card";
import { playerCardMetadata } from "@/lib/player-card";
import { serializeMiniAppEmbedMeta } from "@/lib/farcaster-miniapp";
import { getHighlightsShareMetadata, getProfileShareMetadata } from "@/lib/server-share-metadata";
import { ShareDestination } from "./share-destination";

const resolve = cache(async (code: string) => {
  if (!SHARE_CODE_PATTERN.test(code)) notFound();
  try {
    const result = await serverApiFetch<{path: string}>(`/api/share-links/${code}`, {cache: "no-store"});
    return parseHouseShareTarget(result.path);
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 404) notFound();
    throw error;
  }
});
type Props = { params: Promise<{code: string}>; searchParams: Promise<{app?: string}> };

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {code} = await params;
  const target = await resolve(code);
  const request = await headers();
  const origin = process.env.WEB_BASE_URL?.trim() || (process.env.NODE_ENV === "production" ? "https://thehouse.game" : `${request.get("x-forwarded-proto") ?? "http"}://${request.get("host") ?? "localhost:3001"}`);
  const url = new URL(target.path, origin);
  let metadata: Metadata = {title: "The House", description: "Watch Influence and Werewolf in the House.", openGraph: {title: "The House", images: ["/promo.png"]}, twitter: {card: "summary_large_image", images: ["/promo.png"]}};
  if (target.kind === "game") {
    const game = await getPlayerCardGame(target.identifier!);
    metadata = target.mode === "highlights"
      ? await getHighlightsShareMetadata(target.identifier!, url.searchParams.get("scene") ?? undefined, url.searchParams.get("audience") ?? undefined)
      : playerCardMetadata(game, origin, Object.fromEntries(url.searchParams), target.sequence);
  } else if (target.kind === "profile") {
    metadata = await getProfileShareMetadata(target.identifier!, url.searchParams.get("game") ?? undefined);
  }
  return { ...metadata, metadataBase: new URL(origin), alternates: {canonical: target.path}, robots: {index: false, follow: false},
    // Farcaster merges the cast URL's query onto its action URL. Resolve through
    // our short route so extra cast parameters cannot change the frozen settings.
    other: {"fc:miniapp": serializeMiniAppEmbedMeta(origin, {path: `/s/${code}`, buttonTitle: metadata.twitter && "card" in metadata.twitter && metadata.twitter.card === "player" ? "Watch replay" : "Open in the House"})} };
}

export default async function ShortSharePage({params, searchParams}: Props) {
  const target = await resolve((await params).code);
  // Only the Mini App context hint may be added. Saved playback settings are immutable.
  const url = new URL(target.path, "https://thehouse.game");
  if ((await searchParams).app === "mini") url.searchParams.set("app", "mini");
  return <ShareDestination path={`${url.pathname}${url.search}${url.hash}`} />;
}
