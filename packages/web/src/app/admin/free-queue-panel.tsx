"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PermissionGate } from "@/components/admin-gate";
import {
  getAdminFreeQueue,
  drawFreeQueueGame,
  removeAdminFreeQueueEntry,
  startFreeQueueGame,
  type AdminFreeQueueStatus,
} from "@/lib/api";

export function FreeQueuePanel() {
  const [data, setData] = useState<AdminFreeQueueStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [startedGame, setStartedGame] = useState<{ id: string; slug: string } | null>(null);
  const drawRequestKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getAdminFreeQueue());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the free queue.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function remove(userId: string) {
    setRemoving(userId);
    setError(null);
    try {
      await removeAdminFreeQueueEntry(userId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that entry.");
    } finally {
      setRemoving(null);
    }
  }

  async function runQueue() {
    if (!data) return;
    setRunning(true);
    setError(null);
    setStartedGame(null);
    let game = data.waitingGame;
    try {
      if (!game) {
        drawRequestKey.current ??= `daily-free:admin:${crypto.randomUUID()}`;
        setRunStatus("Drawing queue…");
        const draw = await drawFreeQueueGame(drawRequestKey.current);
        if (!draw.drawn && !draw.gameId) {
          drawRequestKey.current = null;
          setRunStatus(draw.reason);
          await load();
          return;
        }
        game = { id: draw.gameId, slug: draw.gameSlug, status: "waiting" };
      }

      setRunStatus("Starting game…");
      const started = await startFreeQueueGame(game.id);
      drawRequestKey.current = null;
      setStartedGame({ id: started.gameId, slug: started.gameSlug });
      setRunStatus("Game started.");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not run the free queue.";
      await load();
      setError(message);
      setRunStatus(game ? "The waiting game is ready to retry." : null);
    } finally {
      setRunning(false);
    }
  }

  if (!data && !error) return <p className="influence-copy-muted text-sm">Loading queue…</p>;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Daily Free queue</h2>
        <p className="mt-1 text-sm text-white/50">The standing entries available for tonight&apos;s draw.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-300">
          {error} <button type="button" onClick={() => void load()} className="ml-2 underline">Retry</button>
        </div>
      )}

      {data && (
        <>
          <PermissionGate permission="schedule_free_game">
            <div className="influence-panel flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
              <div>
                <div className="text-sm font-medium text-white">
                  {data.waitingGame ? "A drawn game is waiting to start." : "Create and start a game from the eligible queue."}
                </div>
                {runStatus && <div className="mt-1 text-xs text-white/50">{runStatus}</div>}
                {startedGame && (
                  <Link href={`/games/${startedGame.slug}`} className="mt-1 inline-block text-xs text-indigo-300 hover:underline">
                    View {startedGame.slug}
                  </Link>
                )}
              </div>
              <button
                type="button"
                disabled={running || (!data.waitingGame && data.eligibleCount < 2)}
                onClick={() => void runQueue()}
                className="influence-button-primary rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? (runStatus ?? "Working…") : data.waitingGame ? "Retry start" : "Run queue now"}
              </button>
            </div>
          </PermissionGate>

          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Eligible tonight" value={String(data.eligibleCount)} />
            <Metric label="Human seats" value={String(data.availableHumanSeats)} />
            <Metric
              label="Longest wait"
              value={data.longestWaitSince ? new Date(data.longestWaitSince).toLocaleDateString() : "—"}
            />
          </div>

          {data.entries.length === 0 ? (
            <div className="influence-panel rounded-xl p-8 text-center text-sm text-white/50">No standing entries.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/40">
                  <tr>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Owner</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Last game</th>
                    <th className="px-4 py-3">Misses</th>
                    <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {data.entries.map((entry) => (
                    <tr key={entry.userId}>
                      <td className="px-4 py-3 font-medium text-white">{entry.agentName}</td>
                      <td className="px-4 py-3 text-white/70">
                        <div>{entry.ownerLabel}</div>
                        <div className="font-mono text-[11px] text-white/35">{entry.userId}</div>
                      </td>
                      <td className="px-4 py-3 text-white/70">
                        {entry.activeGame ? (
                          <Link href={`/games/${entry.activeGame.slug}`} className="text-indigo-300 hover:underline">In game</Link>
                        ) : "Eligible"}
                      </td>
                      <td className="px-4 py-3 text-white/70">
                        {entry.lastGame ? (
                          <Link href={`/games/${entry.lastGame.slug}`} className="hover:underline">
                            {new Date(entry.lastGame.createdAt).toLocaleDateString()}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-white/70">{entry.consecutiveMisses}</td>
                      <td className="px-4 py-3 text-right">
                        <PermissionGate permission="schedule_free_game">
                          <button
                            type="button"
                            disabled={removing === entry.userId}
                            onClick={() => void remove(entry.userId)}
                            className="influence-button-danger rounded-lg px-3 py-1.5 text-xs"
                          >
                            {removing === entry.userId ? "Removing…" : "Remove"}
                          </button>
                        </PermissionGate>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="influence-panel rounded-xl p-4">
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}
