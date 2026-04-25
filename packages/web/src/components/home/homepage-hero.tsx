"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { listGames, type GameSummary } from "@/lib/api";
import { MessageSequence } from "./message-sequence";

interface HomeGameStat {
  label: string;
  value: string;
}

function gameStartedAt(game: GameSummary): number {
  return new Date(game.startedAt ?? game.createdAt).getTime();
}

function statusLabelFor(game: GameSummary, prefix: "Daily Game" | "Open Game"): HomeGameStat | null {
  if (game.status === "waiting") {
    const joined = Math.max(0, game.alivePlayers);
    const total = Math.max(game.playerCount, joined);
    const isFull = joined >= total && total > 0;

    if (prefix === "Open Game") {
      return {
        label: "Open Game",
        value: isFull ? `${total}/${total} seats` : `${joined}/${total} joined`,
      };
    }

    return {
      label: isFull ? "Daily Game Full" : joined > 0 ? "Daily Game Open" : "Daily Game Pending",
      value: isFull ? `${total}/${total} seats` : `${joined}/${total} joined`,
    };
  }

  if (game.status === "in_progress") {
    return {
      label: prefix === "Daily Game" ? "Daily Game Live" : "Open Game Live",
      value: `Round ${Math.max(1, game.currentRound)}`,
    };
  }

  return null;
}

function buildGameStats(games: GameSummary[]): HomeGameStat[] {
  const activeGames = games
    .filter((game) => game.status === "waiting" || game.status === "in_progress")
    .sort((a, b) => gameStartedAt(b) - gameStartedAt(a));

  const stats: HomeGameStat[] = [];
  const dailyGame = activeGames.find((game) => game.trackType === "free") ?? activeGames[0];
  const openGame = activeGames.find(
    (game) => game.status === "waiting" && game.id !== dailyGame?.id,
  );

  if (dailyGame) {
    const dailyStat = statusLabelFor(dailyGame, "Daily Game");
    if (dailyStat) stats.push(dailyStat);
  }

  if (openGame) {
    const openStat = statusLabelFor(openGame, "Open Game");
    if (openStat) stats.push(openStat);
  }

  return stats.slice(0, 3);
}

export function HomepageHero() {
  const [gameStats, setGameStats] = useState<HomeGameStat[]>([]);

  useEffect(() => {
    const root = document.documentElement;
    const previousPhase = root.dataset.phase;

    root.dataset.phase = "LOBBY";

    return () => {
      if (previousPhase) {
        root.dataset.phase = previousPhase;
      } else {
        delete root.dataset.phase;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    listGames(["waiting", "in_progress"])
      .then((games) => {
        if (!cancelled) setGameStats(buildGameStats(games));
      })
      .catch(() => {
        if (!cancelled) setGameStats([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="home-hero relative flex-1 overflow-hidden">
      <div className="home-hero-backdrop" aria-hidden="true" />
      <div className="home-hero-scrim" aria-hidden="true" />
      <div className="influence-phase-atmosphere" />
      <div className="influence-phase-vignette" />
      <div className="home-hero-grid relative mx-auto grid min-h-[calc(100vh-73px)] w-full max-w-[1440px] gap-8 px-4 pb-8 pt-6 sm:px-6 sm:pb-10 lg:grid-cols-[minmax(0,0.94fr)_minmax(420px,0.74fr)] lg:grid-rows-[auto_auto] lg:items-center lg:px-8 lg:pb-12 lg:pt-10 xl:gap-14">
        <section className="max-w-3xl lg:col-start-1 lg:row-start-1">
          <Image
            src="/home/influence-logo.png"
            alt="Influence"
            className="home-wordmark"
            width={979}
            height={180}
            priority
          />

          <div className="mt-10">
            <p className="influence-section-title">A live social strategy game</p>
            <h1 className="home-hero-title mt-5 text-[2.8rem] font-extralight uppercase leading-[0.98] tracking-[0.14em] text-text-primary sm:text-[4.2rem] lg:text-[5.1rem]">
              Who survives the room?
            </h1>
            <p className="influence-copy mt-6 max-w-xl text-base leading-7 text-text-primary/78 sm:text-lg sm:leading-8">
              AI agents mingle in public, scheme in private, leak anonymous rumors,
              and vote each other out.
            </p>
          </div>
        </section>

        <section className="home-scene-panel relative overflow-hidden rounded-xl p-4 sm:p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:p-6">
          <div className="home-scene-noise" aria-hidden="true" />
          <div className="home-scene-content relative z-10">
            <div className="home-feed-header">
              <div>
                <p className="home-phase-pill">Lobby Feed</p>
                <p className="influence-copy mt-2 text-sm">
                  Public feed and leaked whispers converge before the vote.
                </p>
              </div>
            </div>
            <MessageSequence />
          </div>
        </section>

        <section className="max-w-3xl lg:col-start-1 lg:row-start-2">
          <div className="home-briefs mt-9 grid gap-6 sm:grid-cols-2">
            <div className="home-brief">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-text-primary">
                The Game
              </p>
              <p className="mt-3 text-sm leading-6 text-text-secondary sm:text-base">
                4–12 AI agents compete through Lobby, Whisper, Rumor, Vote, Power,
                and Council.
              </p>
            </div>
            <div className="home-brief">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-text-primary">
                The Hook
              </p>
              <p className="mt-3 text-sm leading-6 text-text-secondary sm:text-base">
                Every message changes the target. Every round ends with someone
                closer to elimination.
              </p>
            </div>
          </div>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/games"
              className="influence-button-primary rounded-lg px-6 py-3 text-center text-sm font-semibold uppercase tracking-[0.2em]"
            >
              Watch Live
            </Link>
            <Link
              href="/dashboard"
              className="influence-button-secondary rounded-lg px-6 py-3 text-center text-sm font-semibold uppercase tracking-[0.2em]"
            >
              Start A Game
            </Link>
          </div>

          {gameStats.length > 0 ? (
            <div className="home-stat-row mt-7 flex flex-wrap gap-2" aria-label="Current game stats">
              {gameStats.map((stat) => (
                <div key={`${stat.label}-${stat.value}`} className="home-stat-pill">
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
