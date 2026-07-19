"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuthenticatedPublicIdentity } from "@/app/providers";
import { useAuth } from "@/hooks/use-auth";
import {
  getAuthToken,
  getFreeQueueStatus,
  getPlayerGames,
  listAgents,
  listGames,
  type FreeQueueStatus,
  type GameSummary,
  type PlayerGameResult,
  type SavedAgent,
} from "@/lib/api";
import {
  ACTIVE_GAME,
  HOUSE_VENUE,
} from "@/lib/product-identity";
import {
  buildDashboardMissionControl,
  type DashboardPrimaryAction,
} from "./dashboard-mission-control";
import { DashboardAgentBench, DashboardRecentResult } from "./dashboard-agent-bench";
import { DashboardGamePreview } from "./dashboard-game-preview";
import { JoinGameModal } from "./join-game-modal";
import { MissionControlOverview } from "./mission-control-overview";

export function McpSetupCard({ hasHistory }: { hasHistory: boolean }) {
  return (
    <section className="influence-panel rounded-xl p-4 sm:p-5 lg:p-6" data-testid="dashboard-mcp-setup-card">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="influence-section-title">Games MCP</p>
          <h2 className="mt-2 text-lg font-semibold text-text-primary">
            Connect {HOUSE_VENUE.name} to your {ACTIVE_GAME.name} games
          </h2>
          <p className="influence-copy mt-2 max-w-2xl text-sm leading-6">
            {hasHistory
              ? "Use your Influence history from an AI coding client without granting maintainer access or internal inspection."
              : "Join or complete an Influence game, then let an AI coding client read the games tied to your account."}
          </p>
        </div>
        <Link
          href="/get-mcp"
          className="influence-button-secondary rounded-lg px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] md:shrink-0"
        >
          Connect MCP
        </Link>
      </div>
    </section>
  );
}

export function DashboardContent() {
  const { account, authenticated, openSignIn } = useAuth();
  const publicIdentity = useAuthenticatedPublicIdentity();
  const [joinTarget, setJoinTarget] = useState<{ game: GameSummary } | null>(null);

  const [history, setHistory] = useState<PlayerGameResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [games, setGames] = useState<GameSummary[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesError, setGamesError] = useState<string | null>(null);

  const [queueStatus, setQueueStatus] = useState<FreeQueueStatus | null>(null);

  const fetchHistory = useCallback(() => {
    if (!authenticated || !getAuthToken()) {
      setHistoryLoading(false);
      return;
    }

    setHistoryError(null);
    getPlayerGames()
      .then(setHistory)
      .catch((err) => {
        console.warn("[DashboardContent] Failed to load game history:", err);
        setHistoryError("Failed to load game history.");
      })
      .finally(() => setHistoryLoading(false));
  }, [authenticated]);

  const fetchAgents = useCallback(() => {
    if (!authenticated || !getAuthToken()) {
      setAgentsLoading(false);
      return;
    }

    setAgentsError(null);
    listAgents()
      .then(setAgents)
      .catch((err) => {
        console.warn("[DashboardContent] Failed to load agents:", err);
        setAgentsError("Failed to load agents.");
      })
      .finally(() => setAgentsLoading(false));
  }, [authenticated]);

  const fetchGames = useCallback(() => {
    setGamesError(null);
    listGames()
      .then(setGames)
      .catch((err) => {
        console.warn("[DashboardContent] Failed to load games:", err);
        setGamesError(err instanceof Error ? err.message : "Failed to load games.");
      })
      .finally(() => setGamesLoading(false));
  }, []);

  const fetchQueueStatus = useCallback(() => {
    if (!authenticated || !getAuthToken()) {
      setQueueStatus(null);
      return;
    }

    getFreeQueueStatus()
      .then(setQueueStatus)
      .catch((err) => {
        console.warn("[DashboardContent] Failed to load free queue status:", err);
        setQueueStatus(null);
      });
  }, [authenticated]);

  useEffect(() => {
    const initialFetch = window.setTimeout(fetchGames, 0);
    const interval = window.setInterval(fetchGames, 10000);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(interval);
    };
  }, [fetchGames]);

  useEffect(() => {
    if (!authenticated) {
      const reset = window.setTimeout(() => {
        setHistory([]);
        setAgents([]);
        setHistoryLoading(false);
        setAgentsLoading(false);
        setQueueStatus(null);
      }, 0);
      return () => window.clearTimeout(reset);
    }

    const initialFetch = window.setTimeout(() => {
      fetchHistory();
      fetchAgents();
      fetchQueueStatus();
    }, 0);

    function handleSessionReady() {
      fetchHistory();
      fetchAgents();
      fetchQueueStatus();
    }
    function handleQueueChanged() {
      fetchQueueStatus();
    }

    window.addEventListener("auth:session-ready", handleSessionReady);
    window.addEventListener("free-queue:changed", handleQueueChanged);
    return () => {
      window.clearTimeout(initialFetch);
      window.removeEventListener("auth:session-ready", handleSessionReady);
      window.removeEventListener("free-queue:changed", handleQueueChanged);
    };
  }, [authenticated, fetchAgents, fetchHistory, fetchQueueStatus]);

  const control = useMemo(
    () =>
      buildDashboardMissionControl({
        agents,
        games,
        history,
        queueStatus,
      }),
    [agents, games, history, queueStatus],
  );

  const loading = historyLoading || agentsLoading || gamesLoading;
  const errors = [historyError, agentsError, gamesError].filter((error): error is string => Boolean(error));

  function handleJoinClick(game: GameSummary) {
    if (!authenticated) {
      openSignIn();
      return;
    }
    setJoinTarget({ game });
  }

  function handlePrimaryAction(action: DashboardPrimaryAction) {
    if (action.kind === "join" && action.game) {
      handleJoinClick(action.game);
    }
  }

  function handleJoinSuccess() {
    setJoinTarget(null);
    fetchGames();
    fetchHistory();
  }

  return (
    <>
      {joinTarget && (
        <JoinGameModal
          game={joinTarget.game}
          onClose={() => setJoinTarget(null)}
          onSuccess={handleJoinSuccess}
        />
      )}

      <div className="space-y-5">
        <McpSetupCard hasHistory={control.stats.gamesPlayed > 0} />

        <MissionControlOverview
          control={control}
          user={account}
          loading={loading}
          errors={errors}
          onJoinPrimary={handlePrimaryAction}
          publicIdentity={publicIdentity}
        />

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
          <DashboardGamePreview
            games={control.gamePreview}
            queueSummary={control.queueSummary}
            loading={gamesLoading}
            error={gamesError}
            onJoin={handleJoinClick}
          />

          <div className="min-w-0 space-y-5">
            <DashboardRecentResult
              result={control.latestResult}
              loading={historyLoading}
              error={historyError}
            />
            <DashboardAgentBench
              agents={control.agentPreview}
              loading={agentsLoading}
              error={agentsError}
            />
          </div>
        </div>
      </div>
    </>
  );
}
