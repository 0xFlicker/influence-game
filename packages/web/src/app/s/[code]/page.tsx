import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isSignupCampaignLanding, parseHouseShareTarget, SHARE_CODE_PATTERN, type HouseShareTarget } from "@influence/engine/house-share-target";
import { copyCampaignQuery } from "@/lib/campaign-attribution";
import { serverApiFetch, ServerApiError } from "@/lib/server-api";
import { getServerGameMetadata, getServerPublicAgentCard } from "@/lib/server-api";
import { playerCardMetadata, resultsCardMetadata } from "@/lib/player-card";
import { serializeMiniAppEmbedMeta } from "@/lib/farcaster-miniapp";
import { agentShareMetadata, getHighlightsShareMetadata, getProfileShareMetadata } from "@/lib/server-share-metadata";
import { ShareDestination } from "./share-destination";

type ResolvedShare = { target: HouseShareTarget; openTicket?: string; signupCampaign?: boolean };

const resolve = cache(async (code: string): Promise<ResolvedShare> => {
  if (!SHARE_CODE_PATTERN.test(code)) notFound();
  try {
    const result = await serverApiFetch<{path: string; openTicket?: string; signupCampaign?: boolean}>(`/api/share-links/${code}`, {cache: "no-store"});
    if (result.signupCampaign) {
      if (!isSignupCampaignLanding(result.path)) notFound();
      return { target: { path: result.path, kind: "page" }, signupCampaign: true };
    }
    return { target: parseHouseShareTarget(result.path), openTicket: result.openTicket };
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 404) notFound();
    throw error;
  }
});
type Props = { params: Promise<{code: string}>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {code} = await params;
  const { target } = await resolve(code);
  const request = await headers();
  const origin = process.env.WEB_BASE_URL?.trim() || (process.env.NODE_ENV === "production" ? "https://thehouse.game" : `${request.get("x-forwarded-proto") ?? "http"}://${request.get("host") ?? "localhost:3001"}`);
  const url = new URL(target.path, origin);
  const houseDescription = "Watch Influence and Werewolf in the House.";
  let metadata: Metadata = {title: "The House", description: houseDescription, openGraph: {title: "The House", description: houseDescription, images: ["/social/house-og.png"]}, twitter: {card: "summary_large_image", title: "The House", description: houseDescription, images: ["/social/house-og.png"]}};
  if (target.kind === "game") {
    if (target.mode === "highlights") {
      metadata = await getHighlightsShareMetadata(target.identifier!, url.searchParams.get("scene") ?? undefined, url.searchParams.get("audience") ?? undefined);
    } else {
      const game = await getServerGameMetadata(target.identifier!);
      metadata = target.mode === "results"
        ? resultsCardMetadata(game, origin)
        : playerCardMetadata(game, origin, Object.fromEntries(url.searchParams), target.sequence);
    }
  } else if (target.kind === "profile") {
    metadata = await getProfileShareMetadata(target.identifier!, url.searchParams.get("game") ?? undefined);
  } else if (target.kind === "agent") {
    try {
      const agent = await getServerPublicAgentCard(target.identifier!);
      metadata = agentShareMetadata(agent.profile);
    } catch (error) {
      if (error instanceof ServerApiError && error.status === 404) notFound();
      throw error;
    }
  }
  const imagePath = target.kind === "profile" || target.kind === "agent"
    ? `${url.pathname}/card-image?format=farcaster`
    : target.kind === "game" && target.mode !== "highlights"
      ? `/games/${encodeURIComponent(target.identifier!)}/card-image?format=farcaster`
      : undefined;
  return { ...metadata, metadataBase: new URL(origin), alternates: {canonical: target.path}, robots: {index: false, follow: false},
    // Farcaster merges the cast URL's query onto its action URL. Resolve through
    // our short route so extra cast parameters cannot change the frozen settings.
    other: {"fc:miniapp": serializeMiniAppEmbedMeta(origin, {path: `/s/${code}`, imagePath, buttonTitle: target.kind === "agent" ? "View agent" : target.mode === "results" ? "View results" : metadata.twitter && "card" in metadata.twitter && metadata.twitter.card === "player" ? "Watch replay" : "Open in the House"})} };
}

export default async function ShortSharePage({params, searchParams}: Props) {
  const { code } = await params;
  const { target, openTicket, signupCampaign } = await resolve(code);
  const query = await searchParams;
  const url = new URL(target.path, "https://thehouse.game");
  if (query.app === "mini") url.searchParams.set("app", "mini");
  if (signupCampaign) {
    // Ad query parameters are only forwarded on campaign links. Ordinary shares
    // continue to ignore caller-supplied parameters except for the Mini App hint.
    copyCampaignQuery(query, url.searchParams);
    url.hash = `signup_campaign=${code}`;
  }
  return <ShareDestination path={`${url.pathname}${url.search}${url.hash}`} openTicket={openTicket} />;
}
