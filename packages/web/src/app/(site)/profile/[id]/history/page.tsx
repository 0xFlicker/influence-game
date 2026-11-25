import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ParticipationFilter } from "@influence/engine/house-participation";
import { Nav } from "@/components/nav";
import { ParticipationRows, participationFilters } from "@/components/participation-history";
import { playerProfileHref } from "@/lib/player-profile-links";
import { getServerPublicPlayerHistory, ServerApiError } from "@/lib/server-api";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ game?: string; cursor?: string }>;
};

const getHistory = cache(async (identifier: string, game: ParticipationFilter, cursor?: string) => {
  try {
    return await getServerPublicPlayerHistory(identifier, game, cursor);
  } catch (error) {
    if (error instanceof ServerApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
});

async function read({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const game: ParticipationFilter = query.game === "werewolf" || query.game === "influence" ? query.game : "all";
  const page = await getHistory(id, game, typeof query.cursor === "string" ? query.cursor : undefined);
  return { page, game, profileHref: playerProfileHref(page.identity) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { page, profileHref } = await read(props);
  return {
    title: `${page.identity.displayName}'s game history | The House`,
    alternates: { canonical: `${profileHref}/history` },
  };
}

export default async function PublicPlayerHistoryPage(props: Props) {
  const { page, game, profileHref } = await read(props);
  const historyHref = `${profileHref}/history`;

  function href(kind: ParticipationFilter, cursor?: string) {
    const query = new URLSearchParams();
    if (kind !== "all") query.set("game", kind);
    if (cursor) query.set("cursor", cursor);
    return query.size ? `${historyHref}?${query}` : historyHref;
  }

  return (
    <div className="flex min-h-dvh min-w-0 flex-col">
      <Nav />
      <main className="mx-auto w-full min-w-0 max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12 [&_.influence-copy-muted]:text-text-secondary">
        <Link href={profileHref} className="influence-link break-words text-sm font-medium">← {page.identity.displayName}</Link>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-text-primary sm:text-5xl">Game history</h1>
        <p className="mt-3 text-sm text-text-secondary">Completed public games. Contains spoilers.</p>
        <nav aria-label="History game type" className="mt-6 flex flex-wrap gap-2">
          {participationFilters.map(filter => (
            <Link key={filter.kind} href={href(filter.kind)} aria-current={filter.kind === game ? "page" : undefined}
              className="influence-button-secondary inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 aria-[current=page]:border-[rgb(var(--accent-rgb)/.65)] aria-[current=page]:bg-[rgb(var(--accent-rgb)/.16)]">
              {filter.label}
            </Link>
          ))}
        </nav>
        <ParticipationRows entries={page.items} />
        {page.nextCursor && (
          <Link href={href(game, page.nextCursor)} className="influence-button-secondary mt-5 inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium">
            Older games →
          </Link>
        )}
      </main>
    </div>
  );
}
