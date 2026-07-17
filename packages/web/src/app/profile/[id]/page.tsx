import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import type { PublicPlayerProfile } from "@/lib/api";
import { playerProfileHref } from "@/lib/player-profile-links";
import {
  getServerPublicPlayerProfile,
  ServerApiError,
} from "@/lib/server-api";
import { PublicPlayerProfileView } from "./public-player-profile";

interface Props {
  params: Promise<{ id: string }>;
}

const getCachedPublicPlayerProfile = cache(async (identifier: string) => (
  getServerPublicPlayerProfile(identifier)
));

async function getProfileOrNotFound(
  identifier: string,
): Promise<PublicPlayerProfile> {
  try {
    const envelope = await getCachedPublicPlayerProfile(identifier);
    if (envelope.status === "not_found") notFound();
    return envelope.profile;
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const profile = await getProfileOrNotFound(id);
  const canonical = playerProfileHref(profile.identity);
  const title = `${profile.identity.displayName} — Influence`;
  const description =
    `View ${profile.identity.displayName}'s current season standing, career record, recent results, and agent roster on Influence.`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function PublicPlayerProfilePage({ params }: Props) {
  const { id } = await params;
  const profile = await getProfileOrNotFound(id);

  return (
    <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden">
      <Nav />
      <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <PublicPlayerProfileView profile={profile} />
      </main>
    </div>
  );
}
