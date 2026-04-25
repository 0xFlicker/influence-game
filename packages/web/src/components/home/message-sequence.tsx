"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { HOME_AGENTS, HOME_MESSAGE_SEQUENCE, type HomeAgent } from "./home-data";

const SEQUENCE_INTERVAL_MS = 1400;
const LOOP_HOLD_MS = 2200;

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function findAgent(agentId: string): HomeAgent {
  const agent = HOME_AGENTS.find((entry) => entry.id === agentId);

  if (!agent) {
    throw new Error(`Unknown home agent: ${agentId}`);
  }

  return agent;
}

export function MessageSequence() {
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    const lastIndex = HOME_MESSAGE_SEQUENCE.length;
    const delay = visibleCount >= lastIndex ? LOOP_HOLD_MS : SEQUENCE_INTERVAL_MS;

    const timeoutId = setTimeout(() => {
      setVisibleCount((current) => (current >= lastIndex ? 1 : current + 1));
    }, delay);

    return () => clearTimeout(timeoutId);
  }, [visibleCount]);

  return (
    <div className="space-y-3">
      {HOME_MESSAGE_SEQUENCE.slice(0, visibleCount).map((beat, index) => {
        const agent = beat.agentId ? findAgent(beat.agentId) : null;
        const isTyping = beat.status === "typing" && index === visibleCount - 1;
        const isRight = beat.side === "right";
        const isNewest = index === visibleCount - 1;

        return (
          <article
            key={beat.id}
            className="home-message-row"
            data-side={beat.side}
            data-entering={isNewest ? "true" : undefined}
            style={
              {
                "--home-agent-rgb": agent ? `var(${agent.colorVar})` : "var(--brand-light)",
              } as React.CSSProperties
            }
          >
            <div className="home-message-card rounded-lg p-4 sm:p-5" data-side={beat.side}>
              <div className={`flex items-start gap-3 ${isRight ? "justify-end" : ""}`}>
                {!isRight && agent ? (
                  <div className="home-message-avatar">
                    <span>{initials(agent.name)}</span>
                  </div>
                ) : null}

                <div className={`min-w-0 ${isRight ? "home-message-content-right" : "flex-1"}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-sm font-semibold text-text-primary">
                      {beat.speaker}
                    </h3>
                    {agent ? (
                      <span className="text-[11px] uppercase tracking-[0.18em] text-text-secondary/80">
                        {agent.archetype}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-text-secondary/75">
                      {beat.label}
                    </span>
                  </div>

                  <div className="mt-3">
                    {isTyping ? (
                      <div className="home-typing-indicator" aria-label={`${beat.speaker} is typing`}>
                        <span />
                        <span />
                        <span />
                      </div>
                    ) : (
                      <p className="max-w-xl whitespace-pre-line text-sm leading-6 text-text-primary/92 sm:text-[15px]">
                        {beat.text}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
