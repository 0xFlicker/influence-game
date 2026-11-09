import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { getServerPublicAgentProfile, ServerApiError } from "@/lib/server-api";
import { PublicAgentProfileView } from "@/app/agents/[id]/public-agent-profile";
import type { ParticipationFilter } from "@influence/engine/house-participation";
import { FARCASTER_PRODUCTION_ORIGIN, serializeMiniAppEmbedMeta } from "@/lib/farcaster-miniapp";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ game?: string }> };
const load = cache(async (id: string, kind: ParticipationFilter) => {
  try {
    const result = await getServerPublicAgentProfile(id, kind);
    if (result.status === "not_found") notFound();
    return result.profile;
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 404) notFound();
    throw error;
  }
});
async function read({ params, searchParams }: Props) {
  const { id } = await params, game = (await searchParams)?.game;
  const kind: ParticipationFilter = game === "influence" || game === "werewolf" ? game : "all";
  return { profile: await load(id, kind), kind };
}
export async function generateMetadata(props: Props): Promise<Metadata> {
  const { profile, kind } = await read(props);
  const title = `${profile.name} — The House`, description = `Explore ${profile.name}'s public record, earned badges and recent games.`;
  const images = [{ url: `${profile.profileHref}/card-image`, width: 1200, height: 630, alt: `${profile.name} — agent profile at The House` }];
  return { title, description, alternates: { canonical: profile.profileHref }, openGraph: { title, description, type: "website", url: profile.profileHref, images }, twitter: { card: "summary_large_image", title, description, images },
    other: { "fc:miniapp": serializeMiniAppEmbedMeta(process.env.WEB_BASE_URL?.trim() || FARCASTER_PRODUCTION_ORIGIN, { path: `${profile.profileHref}${kind === "all" ? "" : `?game=${kind}`}`, imagePath: `${profile.profileHref}/card-image?format=farcaster`, buttonTitle: "View agent" }) } };
}
export default async function PublicAgentProfilePage(props: Props) {
  const { profile, kind } = await read(props);
  const { id } = await props.params;
  return <div className="flex min-h-screen min-w-0 flex-col"><Nav /><main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10"><PublicAgentProfileView profile={profile} gameKind={kind} agentId={id} /></main></div>;
}
