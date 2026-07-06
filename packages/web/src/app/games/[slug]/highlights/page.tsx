import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import { HouseHighlightsClient } from "./house-highlights-client";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  return {
    title: "House Highlights — Influence",
    description: `A receipt-backed House Highlights artifact for ${slug}.`,
  };
}

export default async function HouseHighlightsPage({ params }: Props) {
  const { slug } = await params;

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <HouseHighlightsClient gameSlug={slug} />
      </main>
    </div>
  );
}
