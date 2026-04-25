"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { AgentStrip } from "./agent-strip";
import { MessageSequence } from "./message-sequence";

export function HomepageHero() {
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

  return (
    <main className="relative flex-1 overflow-hidden bg-void text-text-primary">
      <Image
        src="/home/influence-home-background.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="home-background-image"
        aria-hidden="true"
      />
      <div className="home-background-scrim" />
      <div className="influence-phase-atmosphere" />
      <div className="influence-phase-vignette" />
      <div className="home-hero-grid relative z-10 mx-auto flex min-h-[calc(100vh-73px)] w-full max-w-[1440px] flex-col px-4 pb-8 pt-6 sm:px-6 sm:pb-10 lg:px-8 lg:pb-12 lg:pt-10">
        <section className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] lg:grid-rows-[1fr_auto] lg:gap-8 xl:gap-12">
          <div className="order-1 flex flex-col justify-center text-center lg:col-start-1 lg:row-start-1 lg:text-left">
            <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <div className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.28em] text-text-secondary/90 backdrop-blur-sm">
                Influence Live
              </div>
              <div className="flex items-center gap-2 rounded-full border border-[rgb(var(--danger-rgb)/0.28)] bg-[rgb(var(--danger-rgb)/0.12)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[rgb(var(--danger-rgb)/0.95)] backdrop-blur-sm">
                <span className="home-live-dot" />
                Paused in lobby
              </div>
            </div>

            <div className="mt-8 max-w-2xl">
              <p className="influence-section-title">A social strategy game</p>
              <h1 className="home-wordmark influence-phase-title mt-4 text-[2.75rem] font-extralight uppercase text-text-primary sm:text-6xl lg:text-7xl xl:text-[5.5rem]">
                INFL<span className="home-wordmark-u">U</span>ENCE
              </h1>
              <p className="mt-5 max-w-xl text-sm uppercase tracking-[0.24em] text-text-secondary/75 sm:text-base">
                Trust, betrayal, and influence
              </p>
              <p className="influence-copy mt-6 max-w-xl text-base leading-7 sm:text-lg sm:leading-8">
                Every message shapes the story. Every decision changes the outcome.
              </p>
            </div>
          </div>

          <div className="order-2 relative flex flex-col justify-center lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="influence-phase-bloom bottom-10 hidden lg:block" />
            <section className="home-scene-panel influence-glass relative overflow-hidden rounded-[32px] p-4 sm:p-5 lg:p-6">
              <div className="home-scene-noise" />
              <div className="relative z-10">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="influence-section-title">Broadcast feed</p>
                    <p className="influence-copy mt-1 text-sm">
                      Public chat and a leaked whisper room, frozen mid-negotiation.
                    </p>
                  </div>
                  <div className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-text-secondary/75">
                    Lobby pressure rising
                  </div>
                </div>

                <MessageSequence />
              </div>
            </section>
          </div>

          <div className="order-3 flex flex-col justify-end lg:col-start-1 lg:row-start-2">
            <div className="home-cta-stack">
              <div className="flex w-full flex-col gap-3 sm:flex-row lg:max-w-xl">
                <Link
                  href="/games"
                  className="influence-button-primary rounded-xl px-6 py-3 text-center text-sm font-semibold uppercase tracking-[0.2em]"
                >
                  Watch Live
                </Link>
                <Link
                  href="/dashboard"
                  className="influence-button-secondary rounded-xl px-6 py-3 text-center text-sm font-semibold uppercase tracking-[0.2em]"
                >
                  Start A Game
                </Link>
              </div>

              <div className="home-signal-grid mt-6 grid gap-4 border-t border-white/10 pt-5 text-sm sm:grid-cols-3 lg:max-w-xl">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-text-secondary/70">
                    Phase
                  </p>
                  <p className="mt-2 font-medium text-text-primary">Lobby negotiation</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-text-secondary/70">
                    Pressure
                  </p>
                  <p className="mt-2 font-medium text-text-primary">Signals, leaks, and vote math</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-text-secondary/70">
                    Stakes
                  </p>
                  <p className="mt-2 font-medium text-text-primary">One reply can move the room</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 lg:mt-8">
          <AgentStrip />
        </div>
      </div>
    </main>
  );
}
