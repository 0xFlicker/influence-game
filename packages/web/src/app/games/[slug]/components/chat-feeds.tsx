"use client";

import { useEffect, useRef } from "react";
import type { TranscriptEntry, GamePlayer, PhaseKey } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import { MessageBubble } from "./message-bubble";
import { parseJuryQuestion, parseJuryAnswer } from "./message-parsing";

// ---------------------------------------------------------------------------
// Group Chat Feed — scrolling chat for INTRODUCTION / LOBBY phases (live mode)
// ---------------------------------------------------------------------------

export function GroupChatFeed({
  messages,
  players,
}: {
  messages: TranscriptEntry[];
  players: GamePlayer[];
  phase: PhaseKey;
}) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages.length]);

  return (
    <div
      ref={feedRef}
      className="influence-glass rounded-panel flex-1 overflow-y-auto p-4 md:p-6 min-h-[420px] max-h-[600px]"
    >
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-white/20 text-sm animate-pulse">Waiting for messages…</p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className="animate-[fadeIn_0.3s_ease-out]">
              <MessageBubble msg={msg} players={players} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jury DM View — DM-style layout for JURY_QUESTIONS phase (live mode)
// ---------------------------------------------------------------------------

export function JuryDMView({
  messages,
  players,
}: {
  messages: TranscriptEntry[];
  players: GamePlayer[];
}) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages.length]);

  return (
    <div
      ref={feedRef}
      className="influence-glass rounded-panel flex-1 overflow-y-auto p-4 md:p-6 min-h-[420px] max-h-[600px]"
    >
      <div className="text-center mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-amber-300/70 mb-1">
          Jury Questions
        </p>
      </div>
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-white/20 text-sm animate-pulse">Awaiting jury questions…</p>
        </div>
      ) : (
        <div className="space-y-3 max-w-lg mx-auto">
          {messages.map((msg) => {
            const question = parseJuryQuestion(msg.text);
            const answer = parseJuryAnswer(msg.text);
            const isQuestion = !!question;
            const isAnswer = !!answer;

            if (isQuestion) {
              const fromPlayer = msg.fromPlayerId
                ? players.find((p) => p.id === msg.fromPlayerId) ?? players.find((p) => p.name === msg.fromPlayerId)
                : null;
              const fromName = msg.fromPlayerName ?? fromPlayer?.name ?? "Juror";
              return (
                <div key={msg.id} className="flex gap-2 justify-start animate-[fadeIn_0.3s_ease-out]">
                  <div className="flex-shrink-0 mt-1">
                    {fromPlayer ? <AgentAvatar avatarUrl={fromPlayer.avatarUrl} persona={fromPlayer.persona} name={fromPlayer.name} size="8" /> : <span className="w-7 h-7 rounded-full bg-amber-900/30 flex items-center justify-center text-xs text-amber-300/60">?</span>}
                  </div>
                  <div className="max-w-[80%]">
                    <p className="text-[10px] text-amber-400/60 mb-0.5">{fromName} <span className="text-white/20">to {question.finalist}</span></p>
                    <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl rounded-tl-sm px-4 py-2.5">
                      <p className="text-sm text-white/70 leading-relaxed italic">{question.question}</p>
                    </div>
                  </div>
                </div>
              );
            }

            if (isAnswer) {
              const fromPlayer = msg.fromPlayerId
                ? players.find((p) => p.id === msg.fromPlayerId) ?? players.find((p) => p.name === msg.fromPlayerId)
                : null;
              const fromName = msg.fromPlayerName ?? fromPlayer?.name ?? "Finalist";
              return (
                <div key={msg.id} className="flex gap-2 justify-end animate-[fadeIn_0.3s_ease-out]">
                  <div className="max-w-[80%]">
                    <p className="text-[10px] text-amber-300/60 text-right mb-0.5">{fromName}</p>
                    <div className="bg-amber-900/20 border border-amber-700/20 rounded-2xl rounded-tr-sm px-4 py-2.5">
                      <p className="text-sm text-white/80 leading-relaxed">{answer.answer}</p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 mt-1">
                    {fromPlayer ? <AgentAvatar avatarUrl={fromPlayer.avatarUrl} persona={fromPlayer.persona} name={fromPlayer.name} size="8" /> : <span className="w-7 h-7 rounded-full bg-amber-900/30 flex items-center justify-center text-xs text-amber-300/60">?</span>}
                  </div>
                </div>
              );
            }

            // System or non-jury message
            return <MessageBubble key={msg.id} msg={msg} players={players} />;
          })}
        </div>
      )}
    </div>
  );
}
