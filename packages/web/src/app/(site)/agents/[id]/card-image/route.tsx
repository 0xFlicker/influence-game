import { profileCardQueue, renderAgentCard } from "@/lib/profile-card";
import { getServerPublicAgentCard, ServerApiError } from "@/lib/server-api";
import { CardImageRenderOverloadedError } from "@/app/games/[slug]/highlights/card-image/card-image-render-queue";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const farcaster = new URL(request.url).searchParams.get("format") === "farcaster";
    return await profileCardQueue.run(crypto.randomUUID(), async () => {
      const id = (await params).id;
      const result = await getServerPublicAgentCard(id);
      const image = await renderAgentCard(result.profile, farcaster);
      const current = await getServerPublicAgentCard(id);
      const identity = (profile: typeof result.profile) => JSON.stringify({ name: profile.name, avatarUrl: profile.avatarUrl, profileHref: profile.profileHref, awards: profile.awards.map(award => [award.id, award.code, award.theme]) });
      if (identity(current.profile) !== identity(result.profile)) return new Response(null, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "1" } });
      return image;
    });
  } catch (error) {
    console.error("[AgentCard] Unable to render", error);
    return new Response(null, { status: error instanceof ServerApiError && error.status === 404 ? 404 : 503, headers: { "Cache-Control": "private, no-store", ...(error instanceof CardImageRenderOverloadedError ? { "Retry-After": "5" } : {}) } });
  }
}
