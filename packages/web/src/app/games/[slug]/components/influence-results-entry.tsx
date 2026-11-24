"use client";

import { useQuery } from "@tanstack/react-query";
import { GameEntrySkeleton } from "@/components/games/game-entry-loading";
import { getGame, type GameDetail } from "@/lib/api";
import { CompletedResultsReview } from "./completed-results-review";

export function InfluenceResultsEntry({ slug, initialGame }: { slug: string; initialGame?: GameDetail }) {
  const query = useQuery({
    queryKey: ["influence-results-game", slug],
    queryFn: ({ signal }) => getGame(slug, signal),
    initialData: initialGame,
    enabled: !initialGame,
    retry: false,
  });

  if (query.data) return <CompletedResultsReview gameId={query.data.slug} game={query.data} />;
  if (query.error) return <div role="alert" className="rounded-lg border border-red-900/40 bg-red-950/20 p-6 text-sm text-red-200/70">
    {query.error.message} <button onClick={() => void query.refetch()}>Try again</button>
  </div>;
  return <GameEntrySkeleton results />;
}
