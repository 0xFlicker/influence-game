"use client";

import { useState } from "react";
import { ProfileArtwork } from "@/app/agents/[id]/profile-artwork";
import { AgentProfileLink } from "@/components/agent-profile-link";
import type { PublicRosterAgent } from "@/lib/api";
import styles from "./public-player-profile.module.css";

export function FeaturedAgents({ agents }: { agents: PublicRosterAgent[] }) {
  const [active, setActive] = useState(0);
  const agent = agents[active] ?? agents[0];
  if (!agent) return null;
  const { competition, werewolfRecord } = agent;
  const werewolfGames = werewolfRecord.wins + werewolfRecord.losses + werewolfRecord.draws;

  function move(direction: number) {
    setActive(index => (index + direction + agents.length) % agents.length);
  }

  return (
    <section aria-label="Featured agents" className={styles.feature}>
      <div key={agent.profileHref} className={styles.featureArt}>
        <ProfileArtwork {...agent} />
      </div>
      <div className="min-w-0 px-4 py-5 sm:px-6">
        <div aria-live="polite" aria-atomic="true">
          <p className="text-xs font-medium text-text-secondary">Featured agent</p>
          <h2 className="mt-1 break-words text-xl font-semibold leading-tight tracking-tight text-text-primary sm:text-2xl">
            <AgentProfileLink href={agent.profileHref} className="hover:underline focus-visible:underline">{agent.name}</AgentProfileLink>
          </h2>
          {agent.role && <p className="mt-1 text-sm text-text-secondary">{agent.role.label}</p>}
          {competition.gamesPlayed > 0 && <p className="mt-3 text-xs text-text-secondary">{competition.wins} of {competition.gamesPlayed} rated Influence games won</p>}
          {werewolfGames > 0 && <p className="mt-1 text-xs text-text-secondary">{werewolfRecord.wins} of {werewolfGames} won in this architect’s recent Werewolf games</p>}
        </div>
        {agents.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" aria-label="Previous agent" onClick={() => move(-1)} className={styles.carouselButton}>←</button>
            <button type="button" aria-label="Next agent" onClick={() => move(1)} className={styles.carouselButton}>→</button>
          </div>
        )}
      </div>
    </section>
  );
}
