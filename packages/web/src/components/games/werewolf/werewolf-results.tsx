"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { werewolfOutcomeReason, werewolfOutcomeTitle, type WerewolfResultRecap } from "@influence/engine/werewolf/results-contract";
import { ApiError, getHouseGameResults, resolveApiUrl } from "@/lib/api";
import { gameHref, gameReplayHref, werewolfMomentHref } from "@/lib/game-links";
import { GameBanner } from "@/components/game-banner";
import { ResultsHeader } from "../results-header";
import styles from "./werewolf-results.module.css";

export function WerewolfResultsPage({slug}: {slug: string}) {
  const query = useQuery({queryKey: ["house-results", slug], queryFn: ({signal}) => getHouseGameResults(slug, signal), retry: false});
  // A denied refresh must remove already-rendered final facts and images.
  if (query.error) {
    const incomplete = query.error instanceof ApiError && query.error.payload?.status === "not_completed";
    return <section className="space-y-5 py-8"><Link href={gameHref(slug)}>← Back to game</Link>
      <h1 className="text-3xl">{incomplete ? "Results are not ready" : "Could not open results"}</h1>
      <p role="alert" className="text-white/70">{query.error.message}</p>
      {!incomplete && <button className="influence-button-secondary rounded-lg px-4 py-2 text-sm" onClick={() => void query.refetch()}>Try again</button>}
    </section>;
  }
  if (!query.data) return <p role="status" className="py-12 text-white/70">Loading results…</p>;
  if (query.data.gameKind !== "werewolf") return <p role="alert">This page could not load the correct game results.</p>;
  const {game, results} = query.data;
  const names = new Map(results.players.map(player => [player.id, player.name]));
  const name = (id: string) => names.get(id) ?? "Unknown player";
  const days = [...new Set(results.recap.map(item => item.day))];
  const players = [...results.players].sort((a,b) => Number(b.won) - Number(a.won));
  return <article className={styles.results} data-testid="werewolf-results">
    <Link className="text-sm text-white/65" href={gameHref(slug)}>← Back to game</Link>
    <GameBanner gameId={game.id} />
    <ResultsHeader title={werewolfOutcomeTitle(results.outcome)} description={<><p>{werewolfOutcomeReason(results.outcome)}</p><p className="mt-2 text-white/55">{game.slug} · Day {results.day} · {results.players.length} players</p></>}
      actions={<><Link className="influence-button-primary rounded-lg px-4 py-2 text-sm" href={gameReplayHref(slug)}>Watch from the beginning</Link><Link className="influence-button-secondary rounded-lg px-4 py-2 text-sm" href={werewolfMomentHref(slug,"omniscient",results.source.cursor)}>Watch the ending · Omniscient</Link></>} />
    <div className={styles.layout}>
      <nav className={styles.index} aria-label="Results sections"><a href="#cast">Cast</a><a href="#recap">Recap</a>{days.map(day => <a className={styles.dayLink} key={day} href={`#day-${day}`}>Night & day {day}</a>)}</nav>
      <div className="min-w-0 space-y-10">
        <section id="cast" className={styles.section} aria-labelledby="cast-title"><h2 id="cast-title" className="mb-5 text-2xl font-semibold">The cast</h2>
          <ul className={styles.cast}>{players.map(player => <li key={player.id} className={styles.player} data-winner={player.won || undefined}>
            <Portrait src={player.avatarUrl} name={player.name} />
            <div className="min-w-0"><h3 className="break-words font-semibold text-white">{player.name}</h3><p className="mt-1 text-sm capitalize text-white/65">{player.role} · {player.faction === "wolves" ? "Wolf pack" : "Village"}</p>
              <p className="mt-2 text-sm"><span className={player.won ? "text-amber-200" : "text-white/65"}>{player.won ? "Winner" : results.outcome.faction === null ? "Draw" : "Defeated"}</span><span className="text-white/45"> · </span><span className="text-white/75">{player.alive ? "Survived" : `Eliminated ${player.elimination?.kind === "night" ? "night" : "day"} ${player.elimination?.day}`}</span></p>
              {player.elimination && <Link className={styles.evidence} href={werewolfMomentHref(slug,"omniscient",player.elimination.source.cursor)}>Watch elimination · Omniscient ↗</Link>}
            </div>
          </li>)}</ul>
        </section>
        <section id="recap" className={styles.section} aria-labelledby="recap-title"><h2 id="recap-title" className="text-2xl font-semibold">How the game unfolded</h2><p className="mb-5 mt-2 text-sm text-white/60">Recorded outcomes and ballots. Open a moment to see the details.</p>
          <div className="space-y-8">{days.map(day => <details className={styles.section} id={`day-${day}`} key={day} open={day === days[0]}><summary className="mb-3 cursor-pointer text-sm uppercase tracking-widest text-white/70">Night & day {day}</summary>
            <div className="space-y-3">{results.recap.filter(item => item.day === day).map(item => <RecapItem key={item.id} item={item} name={name} slug={slug} />)}</div>
          </details>)}</div>
        </section>
      </div>
    </div>
  </article>;
}

function Portrait({src,name}: {src: string; name: string}) {
  const [failed, setFailed] = useState(false);
  return <div className={styles.portrait}>{failed ? <span aria-label={`${name}, portrait unavailable`}>{name.slice(0,1)}</span> : <Image unoptimized width={56} height={56} src={resolveApiUrl(src)} alt={name} loading="lazy" onError={() => setFailed(true)} />}</div>;
}

function RecapItem({item,name,slug}: {item: WerewolfResultRecap; name: (id: string) => string; slug: string}) {
  const label = item.kind === "night" ? `Night ${item.day}` : item.result.voteMode === "plurality" ? `Day ${item.day} · Final vote` : `Day ${item.day} · Vote after thread ${item.result.thread}`;
  const outcome = item.kind === "night"
    ? item.result.killedId ? `${name(item.result.killedId)} was eliminated` : item.result.attackTargetId && item.result.attackTargetId === item.result.protectedId ? `${name(item.result.attackTargetId)} was protected` : item.noAttackReason === "no_agreement" ? "The pack did not agree. No attack." : "No attack. Nobody was eliminated."
    : item.result.eliminatedId ? `${name(item.result.eliminatedId)} was eliminated` : item.result.dayEnded ? Object.keys(item.result.totals).length ? "Final vote tied. Nobody was eliminated." : "No available votes. Nobody was eliminated." : "No majority. Discussion continued.";
  return <details id={item.id} className={styles.moment}>
    <summary><span className="text-xs text-white/55">{label}</span><span className="block pt-1 font-medium text-white">{outcome}</span></summary>
    <div className={styles.facts}>
      {item.kind === "night" ? <dl className={styles.nightFacts}>
        <dt>Pack target</dt><dd>{item.result.attackTargetId ? name(item.result.attackTargetId) : "No attack"}</dd>
        <dt>Doctor protection</dt><dd>{item.result.protectedId ? name(item.result.protectedId) : "None recorded"}</dd>
        <dt>Seer investigation</dt><dd>{item.result.investigation ? `${name(item.result.investigation.seerId)} investigated ${name(item.result.investigation.targetId)}: ${item.result.investigation.isWolf ? "wolf" : "not a wolf"}` : "None recorded"}</dd>
      </dl> : <>
        <p className="mb-4 text-sm text-white/70">{item.result.voteMode === "plurality" ? "Final vote: a unique highest tally eliminates. A tie eliminates nobody." : `Majority required: ${item.result.requiredVotes} of ${item.result.ballots.length} living players.`}</p>
        <div className="overflow-x-auto"><table className={styles.ballots}><caption className="sr-only">{label} ballots</caption><thead><tr><th>Player</th><th>Ballot</th></tr></thead><tbody>{item.result.ballots.map(ballot => <tr key={ballot.voterId}><td>{name(ballot.voterId)}</td><td>{ballot.targetId ? name(ballot.targetId) : ballot.unavailable ? "Abstain · unavailable" : "Abstain · hear more"}</td></tr>)}</tbody></table></div>
        <p className="mt-4 text-sm text-white/70">Tally: {Object.entries(item.result.totals).map(([id,total]) => `${name(id)} ${total}`).join(" · ") || "No votes for a player"}</p>
      </>}
      <Link className={styles.evidence} href={werewolfMomentHref(slug,"omniscient",item.source.cursor)}>Watch this moment · Omniscient ↗</Link>
    </div>
  </details>;
}
