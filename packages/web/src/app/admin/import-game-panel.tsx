"use client";

import { useState, useCallback } from "react";
import {
  listRemoteGames,
  importGame,
  type RemoteGame,
  type ImportGameResult,
} from "@/lib/api";
import { useRuntimeConfig } from "@/lib/runtime-config";

type ImportStatus = "idle" | "importing" | "success" | "error";

interface ImportEntry {
  slug: string;
  status: ImportStatus;
  result?: ImportGameResult;
  error?: string;
}

export function ImportGamePanel() {
  const config = useRuntimeConfig();
  const [sourceUrl, setSourceUrl] = useState(config.SOURCE_ENV_URL || "");
  const [games, setGames] = useState<RemoteGame[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imports, setImports] = useState<ImportEntry[]>([]);

  // Update sourceUrl when runtime config loads
  const [initialized, setInitialized] = useState(false);
  if (!initialized && config.ready && config.SOURCE_ENV_URL && !sourceUrl) {
    setSourceUrl(config.SOURCE_ENV_URL);
    setInitialized(true);
  }

  const handleBrowse = useCallback(async () => {
    if (!sourceUrl.trim()) return;
    setError(null);
    setLoading(true);
    setGames([]);
    setSelected(new Set());
    try {
      const result = await listRemoteGames(sourceUrl.trim());
      setGames(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch remote games",
      );
    } finally {
      setLoading(false);
    }
  }, [sourceUrl]);

  const toggleSelect = useCallback((slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === games.length) return new Set();
      return new Set(games.map((g) => g.slug));
    });
  }, [games]);

  const handleImport = useCallback(async () => {
    if (selected.size === 0 || !sourceUrl.trim()) return;

    const entries: ImportEntry[] = Array.from(selected).map((slug) => ({
      slug,
      status: "importing" as ImportStatus,
    }));
    setImports(entries);

    for (let i = 0; i < entries.length; i++) {
      try {
        const result = await importGame(sourceUrl.trim(), entries[i].slug);
        entries[i] = { ...entries[i], status: "success", result };
      } catch (err) {
        entries[i] = {
          ...entries[i],
          status: "error",
          error:
            err instanceof Error ? err.message : "Import failed",
        };
      }
      setImports([...entries]);
    }
  }, [selected, sourceUrl]);

  const importing = imports.some((e) => e.status === "importing");

  return (
    <div className="space-y-6">
      {/* Source URL input */}
      <div>
        <label className="block text-sm text-white/60 mb-2">
          Source Environment URL
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://staging.example.com"
            className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleBrowse}
            disabled={loading || !sourceUrl.trim()}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white transition-colors"
          >
            {loading ? "Loading..." : "Browse"}
          </button>
        </div>
        {config.SOURCE_ENV_URL && (
          <p className="text-xs text-white/30 mt-1">
            Default: {config.SOURCE_ENV_URL}
          </p>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Game list */}
      {games.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-white/80">
              Remote Games ({games.length})
            </h3>
            <div className="flex gap-2">
              <button
                onClick={toggleAll}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                {selected.size === games.length ? "Deselect All" : "Select All"}
              </button>
              <button
                onClick={handleImport}
                disabled={selected.size === 0 || importing}
                className="px-3 py-1 text-sm font-medium bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white transition-colors"
              >
                {importing
                  ? "Importing..."
                  : `Import Selected (${selected.size})`}
              </button>
            </div>
          </div>
          <div className="border border-white/10 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/50 text-left">
                  <th className="p-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === games.length}
                      onChange={toggleAll}
                      className="accent-indigo-500"
                    />
                  </th>
                  <th className="p-3">Slug</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Players</th>
                  <th className="p-3">Rounds</th>
                  <th className="p-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game) => (
                  <tr
                    key={game.slug}
                    className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                    onClick={() => toggleSelect(game.slug)}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(game.slug)}
                        onChange={() => toggleSelect(game.slug)}
                        className="accent-indigo-500"
                      />
                    </td>
                    <td className="p-3 text-white font-mono">{game.slug}</td>
                    <td className="p-3">
                      <StatusBadge status={game.status} />
                    </td>
                    <td className="p-3 text-white/70">{game.playerCount}</td>
                    <td className="p-3 text-white/70">
                      {game.currentRound}/{game.maxRounds}
                    </td>
                    <td className="p-3 text-white/50">
                      {new Date(game.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import history */}
      {imports.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-white/80 mb-3">
            Import Results
          </h3>
          <div className="space-y-2">
            {imports.map((entry) => (
              <div
                key={entry.slug}
                className={`flex items-center justify-between p-3 rounded border ${
                  entry.status === "success"
                    ? "border-green-500/30 bg-green-500/10"
                    : entry.status === "error"
                      ? "border-red-500/30 bg-red-500/10"
                      : "border-white/10 bg-white/5"
                }`}
              >
                <span className="font-mono text-sm text-white">
                  {entry.slug}
                </span>
                <span className="text-sm">
                  {entry.status === "importing" && (
                    <span className="text-yellow-400">Importing...</span>
                  )}
                  {entry.status === "success" && entry.result && (
                    <a
                      href={`/games/${entry.result.slug}`}
                      className="text-green-400 hover:text-green-300 underline"
                    >
                      Imported → Game #{entry.result.gameNumber}
                    </a>
                  )}
                  {entry.status === "error" && (
                    <span className="text-red-400">{entry.error}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && games.length === 0 && !error && (
        <div className="text-center py-12 text-white/30 text-sm">
          Enter a source environment URL and click Browse to see available games.
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    waiting: "bg-yellow-500/20 text-yellow-400",
    in_progress: "bg-blue-500/20 text-blue-400",
    completed: "bg-green-500/20 text-green-400",
    cancelled: "bg-red-500/20 text-red-400",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs ${colors[status] ?? "bg-white/10 text-white/50"}`}
    >
      {status}
    </span>
  );
}
