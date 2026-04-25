"use client";

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { HOME_AGENTS, HOME_MESSAGE_SEQUENCE, type HomeAgent } from "./home-data";

const SEQUENCE_INTERVAL_MS = 1400;
const MAX_RENDERED_BEATS = 8;

function findAgent(agentId: string): HomeAgent {
  const agent = HOME_AGENTS.find((entry) => entry.id === agentId);

  if (!agent) {
    throw new Error(`Unknown home agent: ${agentId}`);
  }

  return agent;
}

export function MessageSequence() {
  const [cursor, setCursor] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setCursor((current) => current + 1);
    }, SEQUENCE_INTERVAL_MS);

    return () => clearTimeout(timeoutId);
  }, [cursor]);

  const visibleBeats = useMemo(() => {
    const renderedCount = Math.min(cursor, MAX_RENDERED_BEATS);
    const firstIndex = cursor - renderedCount;

    return Array.from({ length: renderedCount }, (_, offset) => {
      const absoluteIndex = firstIndex + offset;
      const beatIndex = absoluteIndex % HOME_MESSAGE_SEQUENCE.length;
      const beat = HOME_MESSAGE_SEQUENCE[beatIndex];

      if (!beat) {
        throw new Error(`Unknown home message beat: ${beatIndex}`);
      }

      return {
        absoluteIndex,
        beat,
        key: `${beat.id}-${absoluteIndex}`,
      };
    }).filter(({ beat, absoluteIndex }) => {
      const isNewest = absoluteIndex === cursor - 1;

      return beat.status !== "typing" || isNewest;
    });
  }, [cursor]);

  useEffect(() => {
    const scrollNode = scrollRef.current;

    if (!scrollNode) return;

    const frameId = window.requestAnimationFrame(() => {
      scrollNode.scrollTo({
        top: scrollNode.scrollHeight,
        behavior: cursor > 2 ? "smooth" : "auto",
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [cursor, visibleBeats.length]);

  return (
    <div ref={scrollRef} className="home-message-scroll" aria-live="polite">
      <div className="home-message-stack">
        {visibleBeats.map(({ absoluteIndex, beat, key }) => {
          const agent = beat.agentId ? findAgent(beat.agentId) : null;
          const isTyping = beat.status === "typing" && absoluteIndex === cursor - 1;
          const isRight = beat.side === "right";
          const isNewest = absoluteIndex === cursor - 1;

          return (
            <article
              key={key}
              className="home-message-row"
              data-side={beat.side}
              data-entering={isNewest ? "true" : undefined}
              style={
                {
                  "--home-agent-rgb": agent ? `var(${agent.colorVar})` : "var(--brand-light)",
                  "--home-avatar-position": agent?.avatarPosition ?? "100% 100%",
                } as React.CSSProperties
              }
            >
              <div
                className="home-message-card rounded-lg p-4 sm:p-5"
                data-side={beat.side}
                data-status={beat.status}
              >
                <div className={`flex items-start gap-3 ${isRight ? "justify-end" : ""}`}>
                  {!isRight && agent ? (
                    <div className="home-message-avatar" aria-hidden="true" />
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

                  {isRight && agent ? (
                    <div className="home-message-avatar" aria-hidden="true" />
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
