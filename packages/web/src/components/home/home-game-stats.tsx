"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getFreeQueueStatus,
  listGames,
  type FreeQueueStatus,
  type GameSummary,
} from "@/lib/api";
import { gameHref } from "@/lib/game-identity";

interface HomeGameStat {
  key: string;
  label: string;
  value: string;
  href: string;
  tone: "daily" | "open";
}

function gameStartedAt(game: GameSummary): number {
  return new Date(game.startedAt ?? game.createdAt).getTime();
}

function queuedLabel(count: number): string {
  return `${count} queued`;
}

function statusLabelFor(
  game: GameSummary,
  prefix: "Daily Game" | "Open Game",
): HomeGameStat | null {
  if (game.status === "waiting") {
    const joined = Math.max(0, game.alivePlayers);
    const total = Math.max(game.playerCount, joined);
    const isFull = joined >= total && total > 0;

    if (prefix === "Open Game") {
      return {
        key: `open-${game.id}`,
        label: isFull ? "Open Game Full" : "Open Game",
        value: isFull ? `${total}/${total} seats` : `${joined}/${total} joined`,
        href: gameHref(game),
        tone: "open",
      };
    }

    return {
      key: `daily-game-${game.id}`,
      label: isFull
        ? "Daily Game Full"
        : joined > 0
          ? "Daily Game Open"
          : "Daily Game Pending",
      value: isFull ? `${total}/${total} seats` : `${joined}/${total} joined`,
      href: gameHref(game),
      tone: "daily",
    };
  }

  if (game.status === "in_progress") {
    return {
      key: `${prefix === "Daily Game" ? "daily" : "open"}-live-${game.id}`,
      label: prefix === "Daily Game" ? "Daily Game Live" : "Open Game Live",
      value: `Round ${Math.max(1, game.currentRound)}`,
      href: gameHref(game),
      tone: prefix === "Daily Game" ? "daily" : "open",
    };
  }

  return null;
}

function buildGameStats(
  games: GameSummary[],
  queueStatus: FreeQueueStatus | null,
): {
  dailyStat: HomeGameStat | null;
  openStats: HomeGameStat[];
} {
  const activeGames = games
    .filter((game) => game.status === "waiting" || game.status === "in_progress")
    .sort((a, b) => gameStartedAt(b) - gameStartedAt(a));

  const dailyGame = activeGames.find((game) => game.trackType === "free");
  const dailyStat = dailyGame
    ? statusLabelFor(dailyGame, "Daily Game")
    : queueStatus
      ? {
          key: "daily-queue",
          label: "Daily Queue",
          value: queuedLabel(queueStatus.queuedCount),
          href: "/games/free",
          tone: "daily" as const,
        }
      : null;

  const openStats = activeGames
    .filter((game) => game.trackType !== "free")
    .map((game) => statusLabelFor(game, "Open Game"))
    .filter((stat): stat is HomeGameStat => stat != null);

  return { dailyStat, openStats };
}

function HomeStatPill({ stat }: { stat: HomeGameStat }) {
  return (
    <Link href={stat.href} className="home-stat-pill" data-tone={stat.tone}>
      <span>{stat.label}</span>
      <strong>{stat.value}</strong>
    </Link>
  );
}

/** Live daily/open game pills — client-only (polls API + rotates open games). */
export function HomeGameStats() {
  const [dailyStat, setDailyStat] = useState<HomeGameStat | null>(null);
  const [openStats, setOpenStats] = useState<HomeGameStat[]>([]);
  const [activeOpenIndex, setActiveOpenIndex] = useState(0);
  const [openRotationPaused, setOpenRotationPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      getFreeQueueStatus(),
      listGames(["waiting", "in_progress"]),
    ])
      .then(([queueResult, gamesResult]) => {
        if (cancelled) return;

        const queueStatus =
          queueResult.status === "fulfilled" ? queueResult.value : null;
        const games = gamesResult.status === "fulfilled" ? gamesResult.value : [];
        const stats = buildGameStats(games, queueStatus);

        setDailyStat(stats.dailyStat);
        setOpenStats(stats.openStats);
        setActiveOpenIndex(0);
      })
      .catch(() => {
        if (!cancelled) {
          setDailyStat(null);
          setOpenStats([]);
          setActiveOpenIndex(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (openStats.length <= 1 || openRotationPaused) return;

    const interval = window.setInterval(() => {
      setActiveOpenIndex((index) => (index + 1) % openStats.length);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [openRotationPaused, openStats.length]);

  const visibleOpenStat =
    openStats.length > 0 ? openStats[activeOpenIndex % openStats.length] : null;
  const hasStats = dailyStat != null || visibleOpenStat != null;

  if (!hasStats) {
    return null;
  }

  return (
    <nav
      className="home-stat-row mt-7 flex flex-wrap gap-2"
      aria-label="Current game links"
      onMouseEnter={() => setOpenRotationPaused(true)}
      onMouseLeave={() => setOpenRotationPaused(false)}
      onFocus={() => setOpenRotationPaused(true)}
      onBlur={() => setOpenRotationPaused(false)}
    >
      {dailyStat ? <HomeStatPill stat={dailyStat} /> : null}
      {visibleOpenStat ? (
        <HomeStatPill key={visibleOpenStat.key} stat={visibleOpenStat} />
      ) : null}
    </nav>
  );
}
