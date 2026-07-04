import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import { getPostgameHighlights, type HouseHighlightsResponse } from "@/lib/api";
import { gameHref } from "@/lib/game-links";
import { HouseHighlightsView } from "../components/house-highlights-view";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadHighlights(slug);
  if (result.ok) {
    return metadataForHighlights(result.response);
  }

  return {
    title: "House Highlights unavailable — Influence",
    description: "The House could not open this Highlights artifact.",
  };
}

export default async function HouseHighlightsPage({ params }: Props) {
  const { slug } = await params;
  const result = await loadHighlights(slug);

  if (result.ok) {
    const gameSlug = result.response.game.slug ?? result.response.game.id;

    return (
      <div className="min-h-screen">
        <Nav />
        <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
          <HouseHighlightsView response={result.response} gameSlug={gameSlug} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto flex min-h-[70vh] w-full max-w-3xl flex-col justify-center px-5 py-10 text-center">
        <div className="rounded-lg border border-red-300/20 bg-red-950/20 p-6">
          <div className="text-xs font-semibold uppercase text-red-100/55">
            House Highlights
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-white">
            The House could not open this cut.
          </h1>
          <p className="mt-3 text-sm leading-6 text-white/55">
            {result.error}
          </p>
          <div className="mt-5 flex justify-center">
            <Link
              href={gameHref(slug)}
              className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.1]"
            >
              Back to game
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function metadataForHighlights(response: HouseHighlightsResponse): Metadata {
  const highlights = response.highlights;
  const gameName = response.game.slug ?? response.game.id;
  const titleSubject = highlights.thesis ?? highlights.cut?.shareCaption ?? titleForState(highlights.state);
  const description = highlights.cut?.shareCaption ?? descriptionForState(highlights.state);

  return {
    title: `${titleSubject} — House Highlights — Influence`,
    description: `${gameName}: ${description}`,
  };
}

function titleForState(state: HouseHighlightsResponse["highlights"]["state"]): string {
  switch (state) {
    case "main_cut":
      return "House Cut";
    case "mini_highlight_pack":
      return "House Highlight Pack";
    case "no_cut":
      return "The House declined the cut";
    case "unsupported_ineligible":
      return "No V1 Highlights cut";
  }
}

function descriptionForState(state: HouseHighlightsResponse["highlights"]["state"]): string {
  switch (state) {
    case "main_cut":
      return "A receipt-backed House Cut from the completed game.";
    case "mini_highlight_pack":
      return "A receipt-backed pack of mini-highlights from the completed game.";
    case "no_cut":
      return "Alliance receipts existed, but no cold-viewer story cleared the V1 quality gate.";
    case "unsupported_ineligible":
      return "This completed game does not have the alliance receipts required for V1 Highlights.";
  }
}

async function loadHighlights(slug: string) {
  try {
    return {
      ok: true as const,
      response: await getPostgameHighlights(slug),
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Highlights are unavailable for this game.",
    };
  }
}
