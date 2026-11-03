"use client";
import {useState} from "react";
import {characterImageError} from "@/components/character/image-error";
import styles from "./empower-result-player.module.css";
import {AgentAvatar} from "@/components/agent-avatar";
import type { FormatEmpowerVoteReceipt, FormatPresentationRosterPlayer } from "./types";
import { VoteLedger } from "./vote-presentation";

export function FormatEmpowerVoteStage({
  compact = false,
  empoweredId,
  counts,
  roster,
  tiedPlayerIds = [],
  resolutionMethod,
  countedVotes,
  receipts,
}: {
  compact?: boolean;
  empoweredId: string | null;
  counts: Readonly<Record<string, number>>;
  roster: readonly FormatPresentationRosterPlayer[];
  tiedPlayerIds?: readonly string[];
  resolutionMethod?: "revote" | "wheel" | "manual";
  countedVotes?: readonly { voterId: string; targetId: string }[];
  receipts: readonly FormatEmpowerVoteReceipt[];
}) {
  const names = new Map(roster.map((player) => [player.id, player.name]));
  const isRevote = resolutionMethod === "revote" || resolutionMethod === "wheel";
  const orderedCounts = roster.filter((player) => player.id in counts);
  const hasRevoters = orderedCounts.some(player => !tiedPlayerIds.includes(player.id));
  const ledgerVotes = countedVotes ?? receipts.flatMap(receipt => {
    const targetId = isRevote ? receipt.revoteTargetId : receipt.targetId;
    return targetId ? [{ voterId: receipt.voterId, targetId }] : [];
  });

  if (compact) {
    const featuredIds = empoweredId ? [empoweredId] : tiedPlayerIds;
    const featured = roster.filter(player => featuredIds.includes(player.id));
    const otherVotes = Object.entries(counts).reduce((total, [id, count]) => total + (featuredIds.includes(id) ? 0 : count), 0);
    const sharedCount = !empoweredId && featured.every(player => counts[player.id] === counts[featured[0]?.id ?? ""]);
    return <section data-format-cue={empoweredId ? "empowered_tally" : "empowered_tie"} data-compact-empower aria-label="Empower result" className="flex min-h-0 flex-1 flex-col text-center">
      <h2 className="mb-2 shrink-0 text-sm font-semibold sm:text-base">{empoweredId ? `${playerName(empoweredId, names)} is Empowered` : `${featured.length}-way tie for Empower`}{sharedCount && <span className="font-normal text-amber-200"> · {counts[featured[0]!.id]} vote{counts[featured[0]!.id] === 1 ? "" : "s"} each</span>}</h2>
      <div aria-label="Result players" className="grid min-h-0 flex-1 gap-1" style={{gridTemplateColumns:`repeat(auto-fit, minmax(min(100%, 80px), 1fr))`,gridAutoRows:"minmax(28px, 1fr)"}}>
        {featured.map(player => <EmpowerResultPlayer key={player.id} player={player} votes={counts[player.id] ?? 0} sharedCount={sharedCount} />)}
      </div>
      {(otherVotes > 0 || resolutionMethod) && <p className="mt-1 shrink-0 text-xs text-white/60">{otherVotes > 0 ? `Other votes: ${otherVotes}` : ""}{resolutionMethod === "wheel" ? " · Wheel decision" : resolutionMethod === "revote" ? " · Runoff result" : resolutionMethod === "manual" ? " · Manual decision" : ""}</p>}
    </section>;
  }

  return (
    <section
      data-format-cue={empoweredId ? "empowered_tally" : "empowered_tie"}
      aria-labelledby="format-empowered-heading"
      className="mx-auto w-full max-w-2xl px-4 py-3"
    >
      <div className="text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-100/45">
          {isRevote ? "Empower revote" : "Standard vote"}
        </p>
        <h2
          id="format-empowered-heading"
          className="mt-2 text-2xl font-semibold text-white sm:text-3xl"
        >
          {empoweredId ? "Empowered tally" : "A tie for Empower"}
        </h2>
        <p className="mt-2 text-sm text-white/55">
          {empoweredId
            ? `${playerName(empoweredId, names)} is Empowered.`
            : `${tiedPlayerIds.map(id => playerName(id, names)).join(" · ")} are tied. ${hasRevoters ? "The other players revote between them." : "A tiebreak will decide who is Empowered."}`}
        </p>
        {resolutionMethod === "wheel" && <p className="mt-2 text-sm text-amber-200">The vote stayed tied. The wheel decided.</p>}
        {resolutionMethod === "manual" && <p className="mt-2 text-sm text-amber-200">Manual decision · Original vote totals shown.</p>}
      </div>

      <dl
        aria-label="Empowered vote totals"
        className="mt-5 flex flex-wrap justify-center gap-x-8 gap-y-4"
      >
        {orderedCounts.map((player) => {
          const isWinner = player.id === empoweredId;
          return (
            <div
              key={player.id}
              data-empower-total={player.id}
              data-empowered={isWinner ? "true" : "false"}
              className={`min-w-0 text-center ${isWinner || tiedPlayerIds.includes(player.id) ? "text-amber-200" : "text-white/70"}`}
            >
              <dt className="break-words text-xs font-medium text-white/75">
                {player.name}
              </dt>
              <dd className="mt-1 flex items-baseline justify-center gap-1 text-2xl font-semibold">
                {counts[player.id] ?? 0}
                <span className="text-[9px] uppercase tracking-[0.13em] text-white/35">
                  votes
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-3">
        <VoteLedger title={isRevote ? "Empower revote" : "Empower vote"} roster={roster}
          votes={ledgerVotes.map(vote => ({ ...vote, choice: "empower" as const }))}
          total={ledgerVotes.length} />
      </div>
    </section>
  );
}

function playerName(
  playerId: string,
  names: ReadonlyMap<string, string>,
): string {
  return names.get(playerId) ?? playerId;
}

function EmpowerResultPlayer({player, votes, sharedCount}: {player:FormatPresentationRosterPlayer; votes:number; sharedCount:boolean}) {
  const [missingBody, setMissingBody] = useState<string | null>(null);
  const body = player.fullBodyReferenceUrl && player.fullBodyReferenceUrl !== missingBody ? player.fullBodyReferenceUrl : null;
  return <div data-empower-total={player.id} title={`${player.name}: ${votes} vote${votes === 1 ? "" : "s"}`} className={styles.cell}>
    <div className={`${styles.content} ${body ? styles.withBody : ""}`}>
      {body && <div className={styles.art} data-empower-fullbody>
        {/* eslint-disable-next-line @next/next/no-img-element -- frozen character art, displayed without cropping */}
        <img src={body} alt={player.name} onError={event=>void characterImageError(event,()=>setMissingBody(body))} />
      </div>}
      <div className={styles.identity}>
        <div className={`shrink-0 ${styles.avatar}`}><AgentAvatar name={player.name} persona={player.persona ?? ""} personaKey={player.personaKey} avatarUrl={player.avatarUrl} size="6" /></div>
        <div className="min-w-0"><p className={styles.name}>{player.name}</p>{!sharedCount && <p className={styles.count}>{votes} vote{votes === 1 ? "" : "s"}</p>}</div>
      </div>
    </div>
  </div>;
}
