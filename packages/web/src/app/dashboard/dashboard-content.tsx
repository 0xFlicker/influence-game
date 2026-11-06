"use client";
import { DashboardHistory } from "./dashboard-history";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthenticatedPublicIdentity } from "@/app/providers";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import {
  getAuthToken,
  getFreeQueueStatus,
  getPlayerGamesPage,
  listAgents,
  joinFreeQueue,
  type FreeQueueStatus,
  type GameSummary,
  type PlayerGameResult,
  type SavedAgent,
} from "@/lib/api";
import { HOUSE_VENUE } from "@/lib/product-identity";
import {
  buildDashboardMissionControl,
  type DashboardPrimaryAction,
} from "./dashboard-mission-control";
import { DashboardAgentBench, DashboardRecentResult } from "./dashboard-agent-bench";
import { DashboardGamePreview } from "./dashboard-game-preview";
import { JoinGameModal } from "./join-game-modal";
import { MissionControlOverview } from "./mission-control-overview";
import { DashboardQueueEntry } from "./dashboard-queue-entry";
import { OwnerLearningActivation } from "./agents/[id]/review/owner-learning-activation";
import type { ParticipationFilter } from "@influence/engine/house-participation";
import { listDashboardGames } from "./dashboard-game-request";

export function McpSetupCard({ hasHistory }: { hasHistory: boolean }) {
  return (
    <section className="influence-panel rounded-xl p-4 sm:p-5 lg:p-6" data-testid="dashboard-mcp-setup-card">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="influence-section-title">Games MCP</p>
          <h2 className="mt-2 text-lg font-semibold text-text-primary">
            Connect {HOUSE_VENUE.name} to your Chatbot or AI Agent
          </h2>
          <p className="influence-copy mt-2 max-w-2xl text-sm leading-6">
            {hasHistory
              ? "Use your House game history from an AI coding client without granting maintainer access or internal inspection."
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { account, authenticated } = useAuth();
  const publicIdentity = useAuthenticatedPublicIdentity();
  const { hasPermission } = usePermissions();
  const [joinTarget, setJoinTarget] = useState<{ game: GameSummary } | null>(null);

  const [history, setHistory] = useState<PlayerGameResult[]>([]);
  const [overviewHistory, setOverviewHistory] = useState<PlayerGameResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyKind, setHistoryKind] = useState<ParticipationFilter>("all");
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyMoreLoading, setHistoryMoreLoading] = useState(false);
  const [historyMoreError, setHistoryMoreError] = useState<string | null>(null);
  const historyRequest = useRef(0);
  const historyKindRef = useRef<ParticipationFilter>("all");
  const historyCursorRef = useRef<string | null>(null);
  const historyMoreInFlight = useRef(false);
  const invalidateHistoryRequest = useCallback(() => { ++historyRequest.current; }, []);

  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [games, setGames] = useState<GameSummary[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const gamesRequest = useRef(0);
  const invalidateGamesRequest = useCallback(() => { ++gamesRequest.current; }, []);

  const [queueStatus, setQueueStatus] = useState<FreeQueueStatus | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const queueRequest = useRef(0);
  const invalidateQueueRequest = useCallback(() => { ++queueRequest.current; }, []);
  const requestedJoinGameId = searchParams.get("joinGameId");

  const fetchHistory = useCallback((kind: ParticipationFilter = historyKindRef.current) => {
    const request = ++historyRequest.current;
    historyKindRef.current = kind;
    historyCursorRef.current = null;
    historyMoreInFlight.current = false;
    setHistoryKind(kind);
    setHistoryCursor(null);
    setHistoryMoreLoading(false);
    if (!authenticated || !getAuthToken()) {
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    setHistory([]);
    setHistoryMoreError(null);
    setHistoryError(null);
    void (async () => {
      try {
        const page = await getPlayerGamesPage(undefined, 20, kind);
        if (request !== historyRequest.current) return;
        setHistory(page.items);
        if (kind === "all") setOverviewHistory(page.items);
        historyCursorRef.current = page.nextCursor;
        setHistoryCursor(page.nextCursor);
      } catch (err) {
        if (request !== historyRequest.current) return;
        console.warn("[DashboardContent] Failed to load game history:", err);
        setHistoryError("Failed to load game history.");
      } finally { if (request === historyRequest.current) setHistoryLoading(false); }
    })();
  }, [authenticated]);

  const loadOlderHistory = useCallback(() => {
    const cursor = historyCursorRef.current;
    if (!authenticated || !cursor || historyMoreInFlight.current) return;
    const request = historyRequest.current;
    const kind = historyKindRef.current;
    historyMoreInFlight.current = true;
    setHistoryMoreLoading(true);
    setHistoryMoreError(null);
    void getPlayerGamesPage(cursor, 20, kind).then(page => {
      if (request !== historyRequest.current) return;
      if (page.nextCursor === cursor) throw new Error("History cursor did not advance");
      setHistory(previous => [...previous, ...page.items]);
      historyCursorRef.current = page.nextCursor;
      setHistoryCursor(page.nextCursor);
    }).catch(() => {
      if (request === historyRequest.current) setHistoryMoreError("Could not load older games.");
    }).finally(() => {
      if (request === historyRequest.current) { historyMoreInFlight.current = false; setHistoryMoreLoading(false); }
    });
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
    const request = gamesRequest.current;
    setGamesError(null);
    listDashboardGames(requestedJoinGameId)
      .then(data => { if (request === gamesRequest.current) setGames(data); })
      .catch((err) => {
        if (request !== gamesRequest.current) return;
        console.warn("[DashboardContent] Failed to load games:", err);
        setGamesError(err instanceof Error ? err.message : "Failed to load games.");
      })
      .finally(() => { if (request === gamesRequest.current) setGamesLoading(false); });
  }, [requestedJoinGameId]);

  const fetchQueueStatus = useCallback(() => {
    const request = ++queueRequest.current;
    if (!authenticated || !getAuthToken()) {
      setQueueStatus(null);
      setQueueLoading(false);
      return;
    }
    setQueueLoading(true);
    setQueueError(null);
    getFreeQueueStatus()
      .then(status => { if (request === queueRequest.current) setQueueStatus(status); })
      .catch((err) => {
        console.warn("[DashboardContent] Failed to load free queue status:", err);
        if (request === queueRequest.current) { setQueueStatus(null); setQueueError("Could not load queue status."); }
      })
      .finally(() => { if (request === queueRequest.current) setQueueLoading(false); });
  }, [authenticated]);

  async function handleQueueJoin(agentId: string) {
    await joinFreeQueue(agentId);
    window.dispatchEvent(new Event("free-queue:changed"));
  }

  useEffect(() => {
    const initialFetch = window.setTimeout(fetchGames, 0);
    const interval = window.setInterval(fetchGames, 10000);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(interval);
      invalidateGamesRequest();
    };
  }, [fetchGames, invalidateGamesRequest]);

  useEffect(() => {
    if (!authenticated) {
      historyKindRef.current = "all";
      historyCursorRef.current = null;
      historyMoreInFlight.current = false;
      const reset = window.setTimeout(() => {
        setHistory([]);
        setOverviewHistory([]);
        setHistoryKind("all");
        setHistoryCursor(null);
        setHistoryMoreLoading(false);
        setHistoryMoreError(null);
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
      // A new session may belong to a different account; never retain the
      // previous account's recent result while its replacement is loading.
      setOverviewHistory([]);
      fetchHistory("all");
      fetchAgents();
      fetchQueueStatus();
    }
    function handleQueueChanged() {
      fetchQueueStatus();
    }

    window.addEventListener("auth:session-ready", handleSessionReady);
    window.addEventListener("free-queue:changed", handleQueueChanged);
    return () => {
      invalidateHistoryRequest();
      invalidateQueueRequest();
      window.clearTimeout(initialFetch);
      window.removeEventListener("auth:session-ready", handleSessionReady);
      window.removeEventListener("free-queue:changed", handleQueueChanged);
    };
  }, [authenticated, fetchAgents, fetchHistory, fetchQueueStatus, invalidateHistoryRequest, invalidateQueueRequest]);

  const control = useMemo(
    () =>
      buildDashboardMissionControl({
        agents,
        games,
        history: overviewHistory,
        queueStatus,
      }),
    [agents, games, overviewHistory, queueStatus],
  );
  const requestedJoinTarget = useMemo(() => {
    if (!requestedJoinGameId) return null;
    const requestedGame = games.find((game) => game.id === requestedJoinGameId);
    return requestedGame ? { game: requestedGame } : null;
  }, [games, requestedJoinGameId]);

  const loading = historyLoading || agentsLoading || gamesLoading;
  const errors = [historyError, agentsError, gamesError].filter((error): error is string => Boolean(error));

  function handleJoinClick(game: GameSummary) {
    if (!authenticated) {
      router.push(`/agents/create?flow=join_game&gameId=${encodeURIComponent(game.id)}`);
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
    if (requestedJoinGameId) router.replace("/dashboard");
    fetchGames();
    fetchHistory();
  }

  function handleJoinClose() {
    setJoinTarget(null);
    if (requestedJoinGameId) router.replace("/dashboard");
  }

  const activeJoinTarget = joinTarget ?? requestedJoinTarget;

  return (
    <>
      {activeJoinTarget && (
        <JoinGameModal
          game={activeJoinTarget.game}
          onClose={handleJoinClose}
          onSuccess={handleJoinSuccess}
        />
      )}

      <div className="space-y-5">
        <OwnerLearningActivation enabled={authenticated} />
        <MissionControlOverview
          control={control}
          user={account}
          loading={loading}
          errors={errors}
          onJoinPrimary={handlePrimaryAction}
          publicIdentity={publicIdentity}
          canCreateGame={hasPermission("create_game")}
          queueEntry={<DashboardQueueEntry status={queueStatus} agents={agents} loading={queueLoading || agentsLoading} error={queueError ?? agentsError} onJoin={handleQueueJoin} onRetry={() => { fetchQueueStatus(); fetchAgents(); }} />}
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
        <DashboardHistory entries={history} loading={historyLoading} error={historyError} kind={historyKind} onKindChange={fetchHistory} hasMore={historyCursor !== null} moreLoading={historyMoreLoading} moreError={historyMoreError} onLoadMore={loadOlderHistory}/>
        <McpSetupCard hasHistory={overviewHistory.length > 0} />
      </div>
    </>
  );
}
