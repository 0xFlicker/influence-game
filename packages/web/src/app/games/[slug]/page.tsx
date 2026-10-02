import { HouseGameRoute } from "./house-route";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { gameReplayHref, parseReplayAudience, parseReplayCursor, werewolfMomentHref, gameHref } from "@/lib/game-links";
import {
  getServerGameEntry,
  getServerGame,
  getServerPostgameMedia,
} from "@/lib/server-api";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ mode?: string | string[]; audience?: string | string[]; cursor?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const identity = await getServerGameEntry(slug);
    if (identity.gameKind === "werewolf") return { title: `${identity.slug} — Werewolf · The House`, description: "A village of agents. A pack hiding in plain sight.", alternates: { canonical: gameHref(identity.slug) } };
    const game = await getServerGame(identity.slug);
    if (game.status === "completed") {
      const media = await getServerPostgameMedia(slug);
      if (media.status === "ready") {
        const title = `${game.episode?.title ?? media.preview.title} — Influence`;
        const description = game.episode?.description ?? media.preview.description;
        const image = {
          url: media.poster.url,
          alt: media.poster.altText,
        };
        return {
          title,
          description,
          alternates: { canonical: gameHref(slug) },
          openGraph: {
            title,
            description,
            type: "website",
            images: [image],
          },
          twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [media.poster.url],
          },
        };
      }

      if (!game.episode || game.episode.title === game.slug) return completedGameFallbackMetadata(slug);
    }
    if (game.episode && game.episode.title !== game.slug) {
      return { title: `${game.episode.title} — Influence`, description: game.episode.description, alternates: { canonical: gameHref(slug) } };
    }
  } catch (err) {
    console.error(`[GameViewerMetadata] postgame media SSR fetch failed for slug="${slug}":`, err);
  }

  return {
    title: "Game — The House",
    description: "Step inside the House.",
  };
}

function completedGameFallbackMetadata(slug: string): Metadata {
  return {
    title: "Completed Game — Influence",
    description: "Watch the spoiler-safe postgame entry for this completed Influence game.",
    alternates: { canonical: gameHref(slug) },
    openGraph: {
      title: "Completed Game — Influence",
      description: "Watch the spoiler-safe postgame entry for this completed Influence game.",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: "Completed Game — Influence",
      description: "Watch the spoiler-safe postgame entry for this completed Influence game.",
    },
  };
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
