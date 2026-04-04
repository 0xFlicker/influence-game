"use client";

import { useEffect } from "react";
import type { TranscriptEntry, GamePlayer, PhaseKey } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import { Typewriter } from "@/components/typewriter";
import {
  parseVoteMsg,
  parseEmpowered,
  parseCouncilVoteMsg,
  parsePowerAction,
  parseJuryVoteMsg,
  parseJuryTally,
  parseWinnerAnnouncement,
  parseJuryQuestion,
  parseJuryAnswer,
  parseEliminationVote,
  parseReVoteMsg,
  parseEmpowerTied,
  parseReVoteResolved,
  parseWheelDecides,
  isParseableStructuredMsg,
} from "./message-parsing";
import type { SpectacleMessagePhase } from "./types";

export function VoteTallyOverlay({
  sceneMessages,
  upToIndex,
  players,
  scenePhase,
}: {
  sceneMessages: TranscriptEntry[];
  upToIndex: number;
  players: GamePlayer[];
  scenePhase: PhaseKey;
}) {
  const visible = sceneMessages.slice(0, upToIndex + 1);

  // Parse tallies based on phase type
  if (scenePhase === "VOTE") {
    const empowerCounts = new Map<string, number>();
    const exposeCounts = new Map<string, number>();
    let hasTie = false;

    // Determine all participants from the full scene (stable layout across reveals)
    const roundParticipants = new Set<string>();
    for (const msg of sceneMessages) {
      const vote = parseVoteMsg(msg.text);
      if (vote) {
        roundParticipants.add(vote.voter);
        roundParticipants.add(vote.empower);
        roundParticipants.add(vote.expose);
      }
    }

    // Accumulate counts from only the revealed (visible) messages
    for (const msg of visible) {
      const vote = parseVoteMsg(msg.text);
      if (vote) {
        empowerCounts.set(vote.empower, (empowerCounts.get(vote.empower) ?? 0) + 1);
        exposeCounts.set(vote.expose, (exposeCounts.get(vote.expose) ?? 0) + 1);
      }
      if (parseEmpowerTied(msg.text)) hasTie = true;
    }
    const hasVotes = empowerCounts.size > 0 || exposeCounts.size > 0;
    if (!hasVotes) return null;

    const sorted = players
      .filter((p) => roundParticipants.has(p.name))
      .map((p) => ({
        player: p,
        empower: empowerCounts.get(p.name) ?? 0,
        expose: exposeCounts.get(p.name) ?? 0,
      }))
      .sort((a, b) => b.expose - a.expose);
    const maxExpose = Math.max(...sorted.map((s) => s.expose), 0);
    const maxEmpower = Math.max(...sorted.map((s) => s.empower), 0);
    const empowerTiedCount = maxEmpower > 0 ? sorted.filter((s) => s.empower === maxEmpower).length : 0;
    const showEmpowerTie = hasTie && empowerTiedCount > 1;

    return (
      <div className="mt-8 max-w-sm mx-auto animate-[fadePure_0.4s_ease-out]">
        <p className={`text-[10px] uppercase tracking-[0.3em] text-center mb-3 ${showEmpowerTie ? "text-yellow-400/60" : "text-white/20"}`}>
          {showEmpowerTie ? "Vote Tally — Tied!" : "Vote Tally"}
        </p>
        <div className="space-y-1">
          {sorted.map(({ player, empower, expose }) => {
            const isEmpowerLeader = showEmpowerTie && empower === maxEmpower;
            return (
              <div
                key={player.id}
                className={`flex items-center gap-2 py-1.5 px-3 rounded-lg transition-all duration-500 ${
                  isEmpowerLeader
                    ? "bg-yellow-900/20 border border-yellow-500/30"
                    : expose > 0 && expose === maxExpose
                      ? "bg-red-900/25 border border-red-500/25"
                      : "bg-white/[0.02]"
                }`}
              >
                <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />
                <span className="text-xs text-white/60 flex-1">{player.name}</span>
                {empower > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    isEmpowerLeader ? "text-yellow-300 bg-yellow-900/40 font-bold animate-pulse" : "text-amber-400 bg-amber-900/25"
                  }`}>
                    👑 {empower}
                  </span>
                )}
                {expose > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    expose === maxExpose ? "text-red-300 bg-red-900/40 font-bold" : "text-red-400/70 bg-red-900/20"
                  }`}>
                    ⚡ {expose}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (scenePhase === "COUNCIL") {
    const voteCounts = new Map<string, number>();
    for (const msg of visible) {
      const vote = parseCouncilVoteMsg(msg.text);
      if (vote) {
        voteCounts.set(vote.target, (voteCounts.get(vote.target) ?? 0) + 1);
      }
    }
    if (voteCounts.size === 0) return null;

    const sorted = Array.from(voteCounts.entries())
      .sort((a, b) => b[1] - a[1]);
    const maxVotes = sorted[0]?.[1] ?? 0;

    return (
      <div className="mt-8 max-w-sm mx-auto animate-[fadePure_0.4s_ease-out]">
        <p className="text-[10px] uppercase tracking-[0.3em] text-red-400/40 text-center mb-3">Council Vote</p>
        <div className="space-y-1">
          {sorted.map(([name, count]) => {
            const player = players.find((p) => p.name === name);
            return (
              <div
                key={name}
                className={`flex items-center gap-2 py-1.5 px-3 rounded-lg transition-all duration-500 ${
                  count > 0 && count === maxVotes
                    ? "bg-red-900/25 border border-red-500/25"
                    : "bg-white/[0.02]"
                }`}
              >
                {player && <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />}
                <span className="text-xs text-white/60 flex-1">{name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  count === maxVotes ? "text-red-300 bg-red-900/40 font-bold" : "text-red-400/70 bg-red-900/20"
                }`}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (scenePhase === "JURY_VOTE") {
    const juryCounts = new Map<string, number>();
    for (const msg of visible) {
      const vote = parseJuryVoteMsg(msg.text);
      if (vote) {
        juryCounts.set(vote.target, (juryCounts.get(vote.target) ?? 0) + 1);
      }
      const tally = parseJuryTally(msg.text);
      if (tally) {
        juryCounts.set(tally.candidate, tally.votes);
      }
    }
    if (juryCounts.size === 0) return null;

    return (
      <div className="mt-8 max-w-sm mx-auto animate-[fadePure_0.4s_ease-out]">
        <p className="text-[10px] uppercase tracking-[0.3em] text-amber-400/40 text-center mb-3">Jury Verdict</p>
        <div className="flex items-center justify-center gap-12">
          {Array.from(juryCounts.entries()).map(([name, count]) => {
            const player = players.find((p) => p.name === name);
            return (
              <div key={name} className="text-center">
                {player && <div className="mb-1 flex justify-center"><AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="10" /></div>}
                <p className="text-sm text-white/70 font-semibold">{name}</p>
                <p className="text-3xl font-bold text-amber-400 mt-1">{count}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Reckoning/Tribunal elimination votes
  if (scenePhase === "PLEA" || scenePhase === "ACCUSATION" || scenePhase === "DEFENSE") return null;

  // Fallback: try to parse elimination votes
  const elimCounts = new Map<string, number>();
  for (const msg of visible) {
    const vote = parseEliminationVote(msg.text);
    if (vote) {
      elimCounts.set(vote.target, (elimCounts.get(vote.target) ?? 0) + 1);
    }
  }
  if (elimCounts.size === 0) return null;

  const sortedElim = Array.from(elimCounts.entries())
    .sort((a, b) => b[1] - a[1]);
  const maxElim = sortedElim[0]?.[1] ?? 0;

  return (
    <div className="mt-8 max-w-sm mx-auto animate-[fadePure_0.4s_ease-out]">
      <p className="text-[10px] uppercase tracking-[0.3em] text-red-400/40 text-center mb-3">Elimination Vote</p>
      <div className="space-y-1">
        {sortedElim.map(([name, count]) => {
          const player = players.find((p) => p.name === name);
          return (
            <div
              key={name}
              className={`flex items-center gap-2 py-1.5 px-3 rounded-lg transition-all duration-500 ${
                count > 0 && count === maxElim
                  ? "bg-red-900/25 border border-red-500/25"
                  : "bg-white/[0.02]"
              }`}
            >
              {player && <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />}
              <span className="text-xs text-white/60 flex-1">{name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                count === maxElim ? "text-red-300 bg-red-900/40 font-bold" : "text-red-400/70 bg-red-900/20"
              }`}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StyledVoteCard({
  text,
  players,
  voterRumor,
}: {
  text: string;
  players: GamePlayer[];
  voterRumor?: string;
}) {
  const vote = parseVoteMsg(text);
  if (vote) {
    const voterPlayer = players.find((p) => p.name === vote.voter);
    const empowerPlayer = players.find((p) => p.name === vote.empower);
    const exposePlayer = players.find((p) => p.name === vote.expose);
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          {voterPlayer && <AgentAvatar avatarUrl={voterPlayer.avatarUrl} persona={voterPlayer.persona} name={voterPlayer.name} size="10" />}
          <span className="text-lg font-semibold text-white/70">{vote.voter}</span>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl px-8 py-6 inline-block max-w-md">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-amber-400 text-sm uppercase tracking-wider w-20 text-right">Empower</span>
              <span className="text-xl">👑</span>
              {empowerPlayer && <AgentAvatar avatarUrl={empowerPlayer.avatarUrl} persona={empowerPlayer.persona} name={empowerPlayer.name} size="6" />}
              <span className="text-lg font-semibold text-amber-300">{vote.empower}</span>
            </div>
            <div className="border-t border-white/5" />
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-sm uppercase tracking-wider w-20 text-right">Expose</span>
              <span className="text-xl">⚡</span>
              {exposePlayer && <AgentAvatar avatarUrl={exposePlayer.avatarUrl} persona={exposePlayer.persona} name={exposePlayer.name} size="6" />}
              <span className="text-lg font-semibold text-red-300">{vote.expose}</span>
            </div>
            {voterRumor && (
              <>
                <div className="border-t border-purple-500/10" />
                <div className="text-left">
                  <p className="text-[10px] text-purple-400/50 uppercase tracking-wider mb-1">Their Rumor</p>
                  <p className="text-xs text-purple-300/60 italic leading-relaxed">{voterRumor}</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const reVote = parseReVoteMsg(text);
  if (reVote) {
    const voterPlayer = players.find((p) => p.name === reVote.voter);
    const empowerPlayer = players.find((p) => p.name === reVote.empower);
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          {voterPlayer && <AgentAvatar avatarUrl={voterPlayer.avatarUrl} persona={voterPlayer.persona} name={voterPlayer.name} size="10" />}
          <span className="text-lg font-semibold text-white/70">{reVote.voter}</span>
          <span className="text-xs text-yellow-400/50 uppercase tracking-wider">(re-vote)</span>
        </div>
        <div className="bg-yellow-900/10 border border-yellow-500/15 rounded-2xl px-8 py-6 inline-block">
          <p className="text-xs text-yellow-400/50 uppercase tracking-wider mb-2">Empower</p>
          <div className="flex items-center justify-center gap-3">
            <span className="text-xl">👑</span>
            {empowerPlayer && <AgentAvatar avatarUrl={empowerPlayer.avatarUrl} persona={empowerPlayer.persona} name={empowerPlayer.name} size="10" />}
            <span className="text-2xl font-bold text-yellow-300">{reVote.empower}</span>
          </div>
        </div>
      </div>
    );
  }

  const councilVote = parseCouncilVoteMsg(text);
  if (councilVote) {
    const voterPlayer = players.find((p) => p.name === councilVote.voter);
    const targetPlayer = players.find((p) => p.name === councilVote.target);
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          {voterPlayer && <AgentAvatar avatarUrl={voterPlayer.avatarUrl} persona={voterPlayer.persona} name={voterPlayer.name} size="10" />}
          <span className="text-lg font-semibold text-white/70">{councilVote.voter}</span>
        </div>
        <div className="bg-red-900/10 border border-red-500/15 rounded-2xl px-8 py-6 inline-block">
          <p className="text-xs text-red-400/50 uppercase tracking-wider mb-2">Votes to eliminate</p>
          <div className="flex items-center justify-center gap-3">
            {targetPlayer && <AgentAvatar avatarUrl={targetPlayer.avatarUrl} persona={targetPlayer.persona} name={targetPlayer.name} size="10" />}
            <span className="text-2xl font-bold text-red-300">{councilVote.target}</span>
          </div>
        </div>
      </div>
    );
  }

  const juryVote = parseJuryVoteMsg(text);
  if (juryVote) {
    const jurorPlayer = players.find((p) => p.name === juryVote.juror);
    const targetPlayer = players.find((p) => p.name === juryVote.target);
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          {jurorPlayer && <AgentAvatar avatarUrl={jurorPlayer.avatarUrl} persona={jurorPlayer.persona} name={jurorPlayer.name} size="10" />}
          <span className="text-lg font-semibold text-white/50">{juryVote.juror}</span>
          <span className="text-xs text-white/25 uppercase tracking-wider">(juror)</span>
        </div>
        <div className="bg-amber-900/10 border border-amber-500/15 rounded-2xl px-8 py-6 inline-block">
          <p className="text-xs text-amber-400/50 uppercase tracking-wider mb-2">Votes for</p>
          <div className="flex items-center justify-center gap-3">
            {targetPlayer && <AgentAvatar avatarUrl={targetPlayer.avatarUrl} persona={targetPlayer.persona} name={targetPlayer.name} size="10" />}
            <span className="text-2xl font-bold text-amber-300">{juryVote.target}</span>
          </div>
        </div>
      </div>
    );
  }

  const powerAction = parsePowerAction(text);
  if (powerAction) {
    const agentPlayer = players.find((p) => p.name === powerAction.agent);
    const targetPlayer = players.find((p) => p.name === powerAction.target);
    const isProtect = powerAction.action === "protect";
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          <span className="text-2xl">👑</span>
          {agentPlayer && <AgentAvatar avatarUrl={agentPlayer.avatarUrl} persona={agentPlayer.persona} name={agentPlayer.name} size="10" />}
          <span className="text-lg font-semibold text-amber-300">{powerAction.agent}</span>
        </div>
        <div className={`${isProtect ? "bg-blue-900/10 border-blue-500/15" : "bg-red-900/15 border-red-500/20"} border rounded-2xl px-8 py-6 inline-block`}>
          <p className={`text-xs uppercase tracking-wider mb-2 ${isProtect ? "text-blue-400/50" : "text-red-400/60"}`}>
            {isProtect ? "Protects" : "Eliminates"}
          </p>
          <div className="flex items-center justify-center gap-3">
            <span className="text-2xl">{isProtect ? "🛡" : "💀"}</span>
            {targetPlayer && <AgentAvatar avatarUrl={targetPlayer.avatarUrl} persona={targetPlayer.persona} name={targetPlayer.name} size="10" />}
            <span className={`text-2xl font-bold ${isProtect ? "text-blue-300" : "text-red-300"}`}>
              {powerAction.target}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const tied = parseEmpowerTied(text);
  if (tied) {
    return (
      <div className="text-center animate-[fadeIn_0.5s_ease-out]">
        <p className="text-xs text-yellow-400/60 uppercase tracking-[0.4em] mb-2 animate-pulse">◆ TIE ◆</p>
        <p className="text-lg font-bold text-yellow-300 mb-4">Empower Vote Tied!</p>
        <div className="flex items-center justify-center gap-4 flex-wrap mb-4">
          {tied.names.map((name) => {
            const p = players.find((pl) => pl.name === name);
            return (
              <div key={name} className="text-center">
                {p && <div className="mb-1 flex justify-center"><AgentAvatar avatarUrl={p.avatarUrl} persona={p.persona} name={p.name} size="10" /></div>}
                <p className="text-sm font-semibold text-yellow-200">{name}</p>
              </div>
            );
          })}
        </div>
        <div className="bg-yellow-900/15 border border-yellow-500/20 rounded-xl px-6 py-3 inline-block">
          <p className="text-xs text-yellow-400/70 uppercase tracking-wider">Re-vote required</p>
        </div>
      </div>
    );
  }

  const reVoteResolved = parseReVoteResolved(text);
  if (reVoteResolved) {
    const resolvedPlayer = players.find((p) => p.name === reVoteResolved.name);
    return (
      <div className="text-center animate-[fadeIn_0.5s_ease-out]">
        <p className="text-xs text-emerald-400/50 uppercase tracking-[0.3em] mb-4">◆ RE-VOTE RESOLVED ◆</p>
        <div className="flex items-center justify-center gap-4">
          <span className="text-4xl">👑</span>
          {resolvedPlayer && <AgentAvatar avatarUrl={resolvedPlayer.avatarUrl} persona={resolvedPlayer.persona} name={resolvedPlayer.name} size="12" />}
        </div>
        <p className="text-2xl font-bold text-emerald-300 mt-4 tracking-wide">{reVoteResolved.name}</p>
        <p className="text-xs text-emerald-400/30 mt-2 uppercase tracking-wider">
          wins the re-vote
        </p>
      </div>
    );
  }

  const wheel = parseWheelDecides(text);
  if (wheel) {
    const wheelPlayer = players.find((p) => p.name === wheel.name);
    return (
      <div className="text-center animate-[fadeIn_0.5s_ease-out]">
        <p className="text-xs text-purple-400/60 uppercase tracking-[0.4em] mb-2 animate-pulse">◆ THE WHEEL ◆</p>
        <p className="text-sm text-purple-300/50 mb-4">Re-vote still tied — fate decides!</p>
        <div className="relative inline-block mb-4">
          <div className="absolute inset-0 rounded-full bg-purple-500/20 animate-ping" />
          <div className="relative flex items-center justify-center gap-4">
            <span className="text-5xl animate-[spin_1s_ease-out]">🎡</span>
            {wheelPlayer && <AgentAvatar avatarUrl={wheelPlayer.avatarUrl} persona={wheelPlayer.persona} name={wheelPlayer.name} size="12" />}
          </div>
        </div>
        <p className="text-2xl font-bold text-purple-300 mt-4 tracking-wide">{wheel.name}</p>
        <p className="text-xs text-purple-400/30 mt-2 uppercase tracking-wider">
          chosen by the wheel
        </p>
      </div>
    );
  }

  const empowered = parseEmpowered(text);
  if (empowered) {
    const empPlayer = players.find((p) => p.name === empowered.name);
    return (
      <div className="text-center animate-[fadeIn_0.5s_ease-out]">
        <p className="text-xs text-amber-400/40 uppercase tracking-[0.3em] mb-4">◆ EMPOWERED ◆</p>
        <div className="flex items-center justify-center gap-4">
          <span className="text-4xl">👑</span>
          {empPlayer && <AgentAvatar avatarUrl={empPlayer.avatarUrl} persona={empPlayer.persona} name={empPlayer.name} size="16" />}
        </div>
        <p className="text-3xl font-bold text-amber-300 mt-4 tracking-wide">{empowered.name}</p>
        <p className="text-xs text-amber-400/30 mt-2 uppercase tracking-wider">
          holds the power token
        </p>
      </div>
    );
  }

  const winner = parseWinnerAnnouncement(text);
  if (winner) {
    const winPlayer = players.find((p) => p.name === winner.winner);
    return (
      <div className="text-center animate-[fadeIn_0.5s_ease-out]">
        <p className="text-xs text-amber-400/40 uppercase tracking-[0.4em] mb-6">◆ ◆ ◆</p>
        <p className="text-sm text-white/30 uppercase tracking-[0.3em] mb-4">THE WINNER IS</p>
        <div className="flex items-center justify-center gap-4 mb-4">
          {winPlayer && <AgentAvatar avatarUrl={winPlayer.avatarUrl} persona={winPlayer.persona} name={winPlayer.name} size="16" />}
        </div>
        <p className="text-4xl md:text-5xl font-bold text-amber-300 tracking-wide">{winner.winner}</p>
        <p className="text-xs text-amber-400/30 mt-4 uppercase tracking-[0.4em]">◆ ◆ ◆</p>
      </div>
    );
  }

  const elimVote = parseEliminationVote(text);
  if (elimVote) {
    const voterPlayer = players.find((p) => p.name === elimVote.voter);
    const targetPlayer = players.find((p) => p.name === elimVote.target);
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          {voterPlayer && <AgentAvatar avatarUrl={voterPlayer.avatarUrl} persona={voterPlayer.persona} name={voterPlayer.name} size="10" />}
          <span className="text-lg font-semibold text-white/70">{elimVote.voter}</span>
        </div>
        <div className="bg-red-900/10 border border-red-500/15 rounded-2xl px-8 py-6 inline-block">
          <p className="text-xs text-red-400/50 uppercase tracking-wider mb-2">Votes to eliminate</p>
          <div className="flex items-center justify-center gap-3">
            {targetPlayer && <AgentAvatar avatarUrl={targetPlayer.avatarUrl} persona={targetPlayer.persona} name={targetPlayer.name} size="10" />}
            <span className="text-2xl font-bold text-red-300">{elimVote.target}</span>
          </div>
        </div>
      </div>
    );
  }

  // Not a parseable vote — return null to use default rendering
  return null;
}

export function JuryQuestionFrame({
  message,
  players,
  messagePhase,
  onRevealComplete,
}: {
  message: TranscriptEntry;
  players: GamePlayer[];
  messagePhase: SpectacleMessagePhase;
  onRevealComplete: () => void;
}) {
  const question = parseJuryQuestion(message.text);
  const answer = parseJuryAnswer(message.text);

  if (question) {
    const fromPlayer = message.fromPlayerId
      ? players.find((p) => p.id === message.fromPlayerId) ?? players.find((p) => p.name === message.fromPlayerId)
      : null;
    const finalistPlayer = players.find((p) => p.name === question.finalist);
    const fromName = message.fromPlayerName ?? fromPlayer?.name ?? message.fromPlayerId ?? "Juror";

    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        {/* Juror → Finalist framing */}
        <div className="flex items-center justify-center gap-6 mb-8">
          <div className="text-center">
            {fromPlayer && <div className="mb-1 flex justify-center"><AgentAvatar avatarUrl={fromPlayer.avatarUrl} persona={fromPlayer.persona} name={fromPlayer.name} size="10" /></div>}
            <span className="text-sm text-white/50">{fromName}</span>
            <span className="text-[10px] text-white/25 block uppercase">juror</span>
          </div>
          <span className="text-white/15 text-lg">→</span>
          <div className="text-center">
            {finalistPlayer && <div className="mb-1 flex justify-center"><AgentAvatar avatarUrl={finalistPlayer.avatarUrl} persona={finalistPlayer.persona} name={finalistPlayer.name} size="10" /></div>}
            <span className="text-sm text-white/70 font-semibold">{question.finalist}</span>
            <span className="text-[10px] text-white/25 block uppercase">finalist</span>
          </div>
        </div>
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-8 py-6 inline-block max-w-xl text-left">
          <p className="text-lg leading-relaxed text-white/70 italic">
            {messagePhase === "revealing" ? (
              <Typewriter text={question.question} rate="spectacle" onComplete={onRevealComplete} />
            ) : question.question}
          </p>
        </div>
      </div>
    );
  }

  if (answer) {
    const fromPlayer = message.fromPlayerId
      ? players.find((p) => p.id === message.fromPlayerId) ?? players.find((p) => p.name === message.fromPlayerId)
      : null;
    const fromName = message.fromPlayerName ?? fromPlayer?.name ?? message.fromPlayerId ?? "Finalist";

    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-8">
          {fromPlayer && <AgentAvatar avatarUrl={fromPlayer.avatarUrl} persona={fromPlayer.persona} name={fromPlayer.name} size="12" />}
          <span className="text-xl font-semibold text-white/80">{fromName}</span>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl px-8 py-6 inline-block max-w-xl text-left">
          <p className="text-xl leading-relaxed text-white/80">
            {messagePhase === "revealing" ? (
              <Typewriter text={answer.answer} rate="spectacle" onComplete={onRevealComplete} />
            ) : answer.answer}
          </p>
        </div>
      </div>
    );
  }

  return null;
}

export function SpectacleMessageContent({
  message,
  scene,
  players,
  messagePhase,
  onRevealComplete,
  isSystemMessage,
  isElimination,
  currentPlayer,
  currentPlayerName,
  speedMultiplier = 1,
  rumorMessages = [],
}: {
  message: TranscriptEntry;
  scene: { phase: PhaseKey };
  players: GamePlayer[];
  messagePhase: SpectacleMessagePhase;
  onRevealComplete: () => void;
  isSystemMessage: boolean;
  isElimination: boolean;
  currentPlayer: GamePlayer | null | undefined;
  currentPlayerName: string;
  speedMultiplier?: number;
  rumorMessages?: TranscriptEntry[];
}) {
  // For parseable structured messages, skip typewriter and jump to "done"
  const parseable = isParseableStructuredMsg(message.text);
  useEffect(() => {
    if (messagePhase === "revealing" && parseable) {
      onRevealComplete();
    }
  }, [messagePhase, parseable, onRevealComplete]);

  // Jury question/answer — intimate framing
  if (scene.phase === "JURY_QUESTIONS") {
    const isJuryMsg = parseJuryQuestion(message.text) || parseJuryAnswer(message.text);
    if (isJuryMsg) {
      return (
        <JuryQuestionFrame
          message={message}
          players={players}
          messagePhase={messagePhase}
          onRevealComplete={onRevealComplete}
        />
      );
    }
  }

  // Styled vote/power card — shown when parseable and done
  if (parseable) {
    // Resolve voter's rumor from the same round (for vote reveal)
    const vote = parseVoteMsg(message.text);
    const voterName = vote?.voter;
    const voterPlayer = voterName ? players.find((p) => p.name === voterName) : null;
    const voterRumor = voterPlayer
      ? rumorMessages.find((m) => m.fromPlayerId === voterPlayer.id || m.fromPlayerId === voterPlayer.name)?.text
      : undefined;

    return (
      <StyledVoteCard text={message.text} players={players} voterRumor={voterRumor} />
    );
  }

  // Thinking — styled inline with indigo treatment (matches MessageBubble)
  if (message.scope === "thinking") {
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          {currentPlayer ? (
            <AgentAvatar avatarUrl={currentPlayer.avatarUrl} persona={currentPlayer.persona} name={currentPlayer.name} size="10" />
          ) : null}
          <span className="text-lg font-semibold text-indigo-300/70">{currentPlayerName}</span>
          <span className="text-xs text-indigo-400/60 uppercase tracking-wider">thinking</span>
        </div>
        <div className="bg-indigo-950/30 border border-indigo-500/20 rounded-2xl px-8 py-6 inline-block max-w-xl text-left">
          <p className="text-lg md:text-xl leading-relaxed text-indigo-200/60 italic">
            {messagePhase === "revealing" ? (
              <Typewriter text={message.text} rate="spectacle" onComplete={onRevealComplete} speedrun={false} speedMultiplier={speedMultiplier} />
            ) : message.text}
          </p>
        </div>
      </div>
    );
  }

  // Default text rendering
  const isAnonymousRumor = message.phase === "RUMOR" && message.scope === "public";
  return (
    <div className="text-center animate-[fadeIn_0.3s_ease-out]">
      {!isSystemMessage && (
        <div className="flex items-center justify-center gap-3 mb-8">
          {isAnonymousRumor ? (
            <span className="w-10 h-10 rounded-full bg-purple-900/40 flex items-center justify-center text-xl">🗣</span>
          ) : currentPlayer ? (
            <AgentAvatar avatarUrl={currentPlayer.avatarUrl} persona={currentPlayer.persona} name={currentPlayer.name} size="10" />
          ) : null}
          <span className={`text-lg font-semibold ${isAnonymousRumor ? "text-purple-300/70 italic" : "text-white/70"}`}>{currentPlayerName}</span>
          {isAnonymousRumor && (
            <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">rumor</span>
          )}
          {message.scope === "whisper" && (
            <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">whisper</span>
          )}
        </div>
      )}
      {isElimination ? (
        <p className="text-2xl md:text-3xl font-bold text-red-400 tracking-wider">
          {messagePhase === "revealing" ? (
            <Typewriter text={message.text} rate="house" onComplete={onRevealComplete} speedMultiplier={speedMultiplier} />
          ) : message.text}
        </p>
      ) : isSystemMessage ? (
        <p className="text-base md:text-lg text-white/40 italic leading-relaxed">
          {messagePhase === "revealing" ? (
            <Typewriter text={message.text} rate="house" onComplete={onRevealComplete} speedMultiplier={speedMultiplier} />
          ) : message.text}
        </p>
      ) : (
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl px-8 py-6 inline-block max-w-xl text-left">
          <p className="text-lg md:text-xl leading-relaxed text-white/80">
            {messagePhase === "revealing" ? (
              <Typewriter text={message.text} rate="spectacle" onComplete={onRevealComplete} speedrun={false} speedMultiplier={speedMultiplier} />
            ) : message.text}
          </p>
        </div>
      )}
    </div>
  );
}
