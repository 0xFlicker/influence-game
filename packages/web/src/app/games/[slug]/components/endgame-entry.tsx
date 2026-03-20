"use client";

import { useState, useEffect, useRef } from "react";
import { ENDGAME_CONFIG } from "./constants";
import type { EndgameScreenState } from "./types";

export function EndgameEntryScreen({
  endgame,
  onDismiss,
}: {
  endgame: EndgameScreenState;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [jurorsVisible, setJurorsVisible] = useState(0);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const fadeIn = setTimeout(() => setVisible(true), 16);
    const fadeOut = setTimeout(() => setVisible(false), 4500);
    const dismiss = setTimeout(() => onDismissRef.current(), 4800);
    return () => {
      clearTimeout(fadeIn);
      clearTimeout(fadeOut);
      clearTimeout(dismiss);
    };
  }, []);

  // Stagger jury icons for Judgment
  useEffect(() => {
    if (endgame.stage !== "judgment" || !endgame.jurors?.length) return;
    const total = endgame.jurors.length;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setJurorsVisible(i);
      if (i >= total) clearInterval(id);
    }, 300);
    return () => clearInterval(id);
  }, [endgame.stage, endgame.jurors]);

  const cfg = ENDGAME_CONFIG[endgame.stage];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.97)",
        transition: "opacity 400ms ease-in-out, transform 400ms ease-in-out",
        pointerEvents: "none",
      }}
    >
      <div className="text-center px-8 max-w-2xl w-full">
        <p className="text-white/20 text-sm tracking-[0.4em] uppercase mb-8">◆ ◆ ◆</p>
        <h1
          className={`text-3xl md:text-4xl font-bold tracking-widest uppercase mb-8 ${cfg.color}`}
        >
          ◆&nbsp;&nbsp;{cfg.title}&nbsp;&nbsp;◆
        </h1>

        {/* Reckoning / Tribunal: body copy with staggered fade-in */}
        {endgame.stage !== "judgment" && (
          <div className="space-y-1 mb-8">
            {cfg.body.map((line, i) =>
              line ? (
                <p
                  key={i}
                  className="text-white/55 text-base md:text-lg leading-relaxed"
                  style={{
                    opacity: visible ? 1 : 0,
                    transition: `opacity 400ms ease-in-out ${i * 120 + 200}ms`,
                  }}
                >
                  {line}
                </p>
              ) : (
                <div key={i} className="h-3" />
              ),
            )}
          </div>
        )}

        {/* Judgment: finalist names + jury roster */}
        {endgame.stage === "judgment" && endgame.finalists && (
          <>
            <div className="flex items-center justify-center gap-12 mb-8">
              {endgame.finalists.map((name, i) => (
                <div
                  key={name}
                  className="text-center"
                  style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateY(0)" : "translateY(8px)",
                    transition: `opacity 400ms ease-out ${i * 300 + 200}ms, transform 400ms ease-out ${i * 300 + 200}ms`,
                  }}
                >
                  <p className="text-amber-300 text-2xl md:text-3xl font-bold tracking-wide">
                    {name}
                  </p>
                  <p className="text-white/30 text-xs mt-1 uppercase tracking-wider">Finalist</p>
                </div>
              ))}
            </div>
            <p
              className="text-white/40 text-sm italic mb-5"
              style={{
                opacity: visible ? 1 : 0,
                transition: "opacity 400ms ease-in-out 900ms",
              }}
            >
              The jury casts their final verdict.
            </p>
            {endgame.jurors && endgame.jurors.length > 0 && (
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <span className="text-white/20 text-xs mr-1 uppercase tracking-wider">Jury:</span>
                {endgame.jurors.map((name, i) => (
                  <span
                    key={name}
                    className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10"
                    style={{
                      opacity: i < jurorsVisible ? 1 : 0,
                      transform: i < jurorsVisible ? "scale(1)" : "scale(0.85)",
                      transition: "opacity 300ms ease-out, transform 300ms ease-out",
                    }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
