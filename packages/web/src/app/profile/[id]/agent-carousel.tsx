"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { ProfileArtwork } from "@/app/agents/[id]/profile-artwork";
import { AgentProfileLink } from "@/components/agent-profile-link";
import type { PublicRosterAgent } from "@/lib/api";
import profileStyles from "@/components/public-profile.module.css";
import styles from "./public-player-profile.module.css";

const SLIDE_DURATION_MS = 6500;
const SWIPE_DISTANCE = 36;
const TAP_DISTANCE = 8;

export function AgentCarousel({ agents }: { agents: PublicRosterAgent[] }) {
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [touching, setTouching] = useState(false);
  const pendingMove = useRef<{ index: number; automatic: boolean } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressTap = useRef(false);
  const count = agents.length;
  const activeIndex = count ? active % count : 0;
  const agent = agents[activeIndex];
  const previous = (activeIndex + count - 1) % count;
  const next = (activeIndex + 1) % count;
  const rotating = autoplay && visible && !hovered && !focused && !touching && count > 1;

  const requestMove = useCallback((index: number, automatic: boolean) => {
    // Read readiness from the mounted image so a remounted slide waits for its own decode.
    if (stage.current?.querySelector(`[data-slide-index="${index}"] img[data-artwork-settled]`)) {
      pendingMove.current = null;
      setActive(index);
    } else {
      pendingMove.current = { index, automatic };
    }
  }, []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setAutoplay(!motion.matches);
    const updateVisibility = () => setVisible(!document.hidden);
    updateMotion();
    updateVisibility();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      motion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => {
      if (!touch.current && !pendingMove.current) requestMove(next, true);
    }, SLIDE_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
      if (pendingMove.current?.automatic) pendingMove.current = null;
    };
  }, [next, requestMove, rotating]);

  if (!agent) return null;
  const { competition, werewolfRecord } = agent;
  const werewolfGames = werewolfRecord.wins + werewolfRecord.losses + werewolfRecord.draws;
  // Keep each visible agent on one keyed element as their position changes.
  const slides = [{ index: activeIndex, position: "current" }];
  if (count > 1) slides.push({ index: next, position: "next" });
  if (count > 2) slides.push({ index: previous, position: "previous" });
  if (count > 3) slides.push({ index: (activeIndex + 2) % count, position: count === 4 ? "parked" : "ahead" });
  if (count > 4) slides.push({ index: (activeIndex + count - 2) % count, position: "behind" });
  slides.sort((left, right) => left.index - right.index);

  function move(direction: number) {
    requestMove(direction < 0 ? previous : next, false);
  }

  function toggleAutoplay() {
    setAutoplay(!autoplay);
    if (!autoplay) setFocused(false);
  }

  function startTouch(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" || count < 2) return;
    if (!event.isPrimary) {
      if (touch.current) cancelTouch();
      return;
    }
    touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    suppressTap.current = false;
    setTouching(true);
  }

  function cancelTouch() {
    touch.current = null;
    suppressTap.current = true;
    setTouching(false);
  }

  function finishTouch(event: PointerEvent<HTMLDivElement>) {
    const start = touch.current;
    if (start?.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    cancelTouch();
    suppressTap.current = Math.hypot(dx, dy) > TAP_DISTANCE;
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
      setAutoplay(false);
      move(dx < 0 ? 1 : -1);
    }
  }

  const playbackLabel = autoplay ? "Pause carousel" : "Play carousel";
  return (
    <section
      aria-label="Agents in the spotlight"
      aria-roledescription="carousel"
      className={styles.carousel}
      onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div
        ref={stage}
        className={`${profileStyles.stage} ${styles.stage}`}
        onPointerDown={startTouch}
        onPointerUp={finishTouch}
        onPointerCancel={event => { if (touch.current?.id === event.pointerId) cancelTouch(); }}
      >
        {slides.map(({ index, position }) => {
          const entry = agents[index]!;
          const neighbor = position === "next" || position === "previous";
          return (
            <div key={entry.profileHref ?? entry.name} className={styles.slide} data-position={position} data-slide-index={index} aria-hidden="true">
              <ProfileArtwork {...entry} decorative fetchPriority={position === "current" ? "high" : neighbor ? "auto" : "low"} onSettled={image => {
                image.dataset.artworkSettled = "";
                const pending = pendingMove.current;
                if (pending?.index === index && (!pending.automatic || (rotating && !touch.current))) {
                  pendingMove.current = null;
                  setActive(index);
                }
              }} />
            </div>
          );
        })}
        {count > 1 && (
          <button
            type="button"
            className={styles.touchSurface}
            aria-label={playbackLabel}
            onClick={event => {
              if (event.detail === 0 || !suppressTap.current) toggleAutoplay();
            }}
          />
        )}
      </div>
      <div className={styles.caption}>
        <div className="min-w-0" aria-live={rotating ? "off" : "polite"} aria-atomic="true">
          <h2 className={styles.agentName}>
            <AgentProfileLink href={agent.profileHref} className="hover:underline focus-visible:underline">
              {agent.name}
            </AgentProfileLink>
          </h2>
          {agent.role && <p className="mt-1 text-sm text-text-secondary">{agent.role.label}</p>}
          {competition.gamesPlayed > 0 && <p className="mt-1 text-xs text-text-secondary">{competition.wins} of {competition.gamesPlayed} rated Influence games won</p>}
          {werewolfGames > 0 && <p className="mt-1 text-xs text-text-secondary">{werewolfRecord.wins} of {werewolfGames} won in this architect’s recent Werewolf games</p>}
        </div>
        {count > 1 && (
          <div className={styles.controls}>
            <button type="button" aria-label="Previous agent" onClick={() => move(-1)}>←</button>
            <button type="button" aria-label="Next agent" onClick={() => move(1)}>→</button>
            <button type="button" className={styles.playbackButton} aria-label={playbackLabel} onClick={toggleAutoplay}>
              {autoplay ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M4 3h2.5v10H4zm5.5 0H12v10H9.5z" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M5 2.5v11L13 8z" />
                </svg>
              )}
            </button>
            <span className={styles.count} aria-label={`Agent ${activeIndex + 1} of ${count}`}>{activeIndex + 1} / {count}</span>
          </div>
        )}
      </div>
    </section>
  );
}
