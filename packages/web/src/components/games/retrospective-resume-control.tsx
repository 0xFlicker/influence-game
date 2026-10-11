"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getGameRetrospective, resumeGameRetrospective } from "@/lib/api";

export function RetrospectiveResumeControl({ gameId, onResumed }: { gameId: string; onResumed(): void }) {
  const { account } = useAuth();
  const permitted = Boolean(account?.permissions.includes("resume_game_retrospective") && account.roles.some(role => ["admin", "sysop", "producer"].includes(role)));
  const query = useQuery({ queryKey: ["retrospective-recovery", gameId], queryFn: ({ signal }) => getGameRetrospective(gameId, signal), enabled: permitted, retry: false });
  const mutation = useMutation({ retry: false, mutationFn: async () => {
    const page = query.data;
    if (!page?.recovery) throw new Error("Refresh the paused retrospective before resuming.");
    return resumeGameRetrospective({ gameIdOrSlug: gameId, gameKind: page.gameKind, expectedHead: page.recovery.expectedHead,
      expectedFailureId: page.recovery.expectedFailureId, idempotencyKey: crypto.randomUUID() });
  }, onSuccess: onResumed, onError: async () => {
    const refreshed = await query.refetch();
    if (refreshed.data && refreshed.data.game.status !== "suspended") onResumed();
  } });
  if (!permitted) return null;
  return <div className="space-y-2 text-sm">
    <p className="text-white/60">Resuming can spend on the remaining required statements.</p>
    <button className="influence-button-secondary rounded-lg px-4 py-2 disabled:opacity-50" disabled={!query.data?.recovery || Boolean(query.error) || query.isFetching || mutation.isPending}
      onClick={() => mutation.mutate()}>{mutation.isPending ? "Resuming…" : "Resume retrospective"}</button>
    {query.error || mutation.error ? <p role="alert">{(mutation.error ?? query.error)?.message}</p> : null}
  </div>;
}
