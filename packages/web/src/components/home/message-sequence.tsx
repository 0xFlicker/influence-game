"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { HOME_AGENTS, HOME_MESSAGE_SEQUENCE, type HomeAgent } from "./home-data";

const SEQUENCE_INTERVAL_MS = 1400;
const TYPING_PREVIEW_MS = 620;
const MESSAGE_TEXT_HOLD_MS = SEQUENCE_INTERVAL_MS - TYPING_PREVIEW_MS;
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
  const [activePhase, setActivePhase] = useState<"typing" | "delivered">("typing");

  useEffect(() => {
    const activeBeatIndex = (cursor - 1) % HOME_MESSAGE_SEQUENCE.length;
    const activeBeat = HOME_MESSAGE_SEQUENCE[activeBeatIndex];

    if (!activeBeat) {
      throw new Error(`Unknown home message beat: ${activeBeatIndex}`);
    }

    const holdsTyping = activeBeat.status === "typing";
    const delay =
      activePhase === "typing"
        ? holdsTyping
          ? SEQUENCE_INTERVAL_MS
          : TYPING_PREVIEW_MS
        : MESSAGE_TEXT_HOLD_MS;

    const timeoutId = setTimeout(() => {
      if (activePhase === "typing" && !holdsTyping) {
        setActivePhase("delivered");
        return;
      }

      setCursor((current) => current + 1);
      setActivePhase("typing");
    }, delay);

    return () => clearTimeout(timeoutId);
  }, [activePhase, cursor]);

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

  return (
    <div className="home-message-stack" aria-live="polite">
      {visibleBeats.map(({ absoluteIndex, beat, key }) => {
        const agent = beat.agentId ? findAgent(beat.agentId) : null;
        const isNewest = absoluteIndex === cursor - 1;
        const isTyping = isNewest && activePhase === "typing";
        const isRight = beat.side === "right";

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
              data-status={isTyping ? "typing" : beat.status}
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
  );
}
