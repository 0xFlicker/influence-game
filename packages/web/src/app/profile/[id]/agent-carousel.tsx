"use client";

import { useEffect, useState } from "react";
import { ProfileArtwork } from "@/app/agents/[id]/profile-artwork";
import { AgentProfileLink } from "@/components/agent-profile-link";
import type { PublicRosterAgent } from "@/lib/api";
import profileStyles from "@/components/public-profile.module.css";
import styles from "./public-player-profile.module.css";

const SLIDE_DURATION_MS = 6500;

export function AgentCarousel({ agents }: { agents: PublicRosterAgent[] }) {
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const count = agents.length;
  const activeIndex = count ? active % count : 0;
  const agent = agents[activeIndex];
  const rotating = autoplay && visible && !hovered && !focused && count > 1;

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
    const timer = window.setTimeout(() => setActive((activeIndex + 1) % count), SLIDE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, count, rotating]);

  if (!agent) return null;
  const { competition, werewolfRecord } = agent;
  const werewolfGames = werewolfRecord.wins + werewolfRecord.losses + werewolfRecord.draws;

  function move(direction: number) {
    setActive(index => (index + direction + count) % count);
  }

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
      <div className={`${profileStyles.stage} ${styles.stage}`} aria-hidden="true">
        {agents.map((entry, index) => {
          const offset = (index - activeIndex + count) % count;
          const position = offset === 0 ? "current"
            : offset === 1 ? "next"
            : offset === count - 1 ? "previous"
            : "offstage";
          return (
            <div key={entry.profileHref ?? entry.name} className={styles.slide} data-position={position}>
              <ProfileArtwork {...entry} decorative />
            </div>
          );
        })}
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
            <button type="button" aria-label={autoplay ? "Pause carousel" : "Play carousel"} onClick={() => {
              setAutoplay(!autoplay);
              if (!autoplay) setFocused(false);
            }}>
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
