"use client";
/* eslint-disable @next/next/no-img-element -- Frozen public character URLs retain their verified source and alpha channel. */
import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AgentProfileLink } from "@/components/agent-profile-link";
import { EmbeddedReplay } from "@/components/watch/embedded-replay";
import { resolveApiUrl } from "@/lib/api";
import type { ChampionshipView } from "@/lib/championship";
import styles from "./championship.module.css";

const InfluenceViewer = dynamic(() => import("@/app/games/[slug]/game-viewer").then(module => module.GameViewer), { loading: () => <p role="status">Loading the finale…</p> });
const eventLabels: Record<string, string> = { draft: "In preparation", preparing: "Preparing the field", locked: "Field confirmed", running: "Under way", paused: "Intermission", final: "Complete" };
const roles = { werewolf: "Werewolf", villager: "Villager", seer: "Seer", doctor: "Doctor" };
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
type Match = ChampionshipView["matches"][number];
export function featuredChampionshipMatch(matches: Match[]) {
  return matches.find(match => match.gameSlug && match.status === "running")
    ?? [...matches].reverse().find(match => match.gameSlug && match.status === "completed")
    ?? matches.find(match => match.status === "scheduled") ?? matches[0];
}
const number = (value: number) => String(value).padStart(2, "0");
export function ChampionshipEventView({ event }: { event: ChampionshipView }) {
  const [chosen, setChosen] = useState<number>();
  const [watching, setWatching] = useState(false);
  const [audience, setAudience] = useState<"mystery" | "omniscient">("mystery");
  const match = event.matches.find(item => item.ordinal === chosen) ?? featuredChampionshipMatch(event.matches);
  const next = event.matches.find(item => item.status === "scheduled");
  const completed = event.matches.filter(item => item.gameKind === "werewolf" && item.status === "completed").length;
  const names = new Map(event.entries.map(entry => [entry.agentId, entry.name]));
  const playable = Boolean(match?.gameSlug);
  return <div className={styles.event}>
    <header className={styles.masthead}>
      <div><Link className={styles.eyebrow} href={`/seasons?season=${encodeURIComponent(event.season.slug)}`}>{event.season.name} / The championship</Link>
        <h1>{event.name}</h1><p>Eight minds. Sixteen nights of Werewolf. One Influence finale.</p></div>
      <div className={styles.edition}><span>{eventLabels[event.status] ?? event.status}</span><strong>{number(completed)}<small> / 16</small></strong><span>Werewolf matches complete</span></div>
    </header>
    <nav className={styles.sections} aria-label="Championship sections"><a href="#championship-watch">Watch</a><a href="#championship-schedule">Schedule</a><a href="#championship-finalists">The final eight</a><a href="#championship-standings">Standings</a><a href="#championship-rules">Rules & role spoilers</a></nav>
    <section id="championship-watch" className={styles.broadcast} aria-label="Championship broadcast">
      <div className={styles.watchColumn}>
        <div className={styles.broadcastHeading}><span className={styles.eyebrow}>{match?.gameKind === "influence" ? "The Influence finale" : "Werewolf series"}</span><span>{match ? `Match ${number(match.ordinal)} · ${match.status}` : "Opening night awaits"}</span></div>
        <div className={styles.player} data-testid="championship-player">
          {watching && playable && match?.gameSlug ? match.gameKind === "influence" ? <InfluenceViewer key={match.gameSlug} gameId={match.gameSlug} completedMode="replay" contained /> : <EmbeddedReplay key={`${match.gameSlug}:${audience}`} contained audience={audience} game={{id:match.gameSlug, slug:match.gameSlug, title:`${event.name} · Match ${match.ordinal}`, gameKind:match.gameKind, status:match.status === "completed" ? "completed" : "in_progress"}} /> : <div className={styles.poster} data-game-kind={match?.gameKind ?? "werewolf"}>
            <span className={styles.eyebrow}>The House presents</span><h2>{match?.gameKind === "influence" ? <>One final<br /><em>act.</em></> : <>Trust is<br /><em>temporary.</em></>}</h2>
            <p>{match ? `${match.gameKind === "werewolf" ? "Werewolf" : "Influence"} · ${dateFormat.format(new Date(match.scheduledAt))} UTC` : "The opening date will be announced here."}</p>
            {playable ? <button className={styles.play} onClick={() => setWatching(true)}><span aria-hidden="true">▶</span> {match?.status === "completed" ? "Watch replay" : "Watch match"}</button> : <p className={styles.awaiting}>{match?.gameSlug ? <Link href={`/games/${match.gameSlug}`}>Open live game →</Link> : "The curtain rises when the match begins."}</p>}
          </div>}
        </div>
        <div className={styles.watchCaption}><span>{watching ? "You’re watching in the championship room." : "Choose a match. Take your seat."}</span><div className={styles.viewControl}>{match?.gameKind === "werewolf" && playable ? <label>View <select aria-label="Werewolf viewing mode" value={audience} onChange={e => setAudience(e.target.value as "mystery" | "omniscient")}><option value="mystery">Mystery · roles hidden</option><option value="omniscient">Omniscient · spoilers</option></select></label> : null}</div></div>
      </div>
      <aside className={styles.desk}>
        <p className={styles.eyebrow}>Next at the House</p><strong className={styles.nextNumber}>{next ? number(next.ordinal) : "✦"}</strong><h2>{next?.gameKind === "influence" ? "Influence finale" : next ? "Werewolf" : "The series is complete"}</h2><p>{next ? `${dateFormat.format(new Date(next.scheduledAt))} UTC` : "Explore the matches and meet the champions."}</p>
        <div className={styles.rule}><span>8 finalists</span><span>2 champions</span></div><p className={styles.deskNote}>Same field. Different allegiances.<br />One game a day at 00:00 UTC.</p>
        <a href="#championship-standings" className={styles.textLink}>Reveal series standings ↗</a>
      </aside>
    </section>
    <section id="championship-schedule" className={styles.schedule} aria-label="Match schedule"><div className={styles.sectionTitle}><h2>Sixteen nights. <em>One finale.</em></h2><span>All times UTC</span></div>
      <ol className={styles.matchStrip}>{event.matches.map(item => <li key={item.ordinal}><button aria-pressed={item.ordinal === match?.ordinal} className={item.gameKind === "influence" ? styles.finaleMatch : undefined} onClick={() => {setChosen(item.ordinal); setWatching(false);}}><span>{item.gameKind === "influence" ? "Influence" : "Night"}</span><strong>{item.gameKind === "influence" ? "Finale" : number(item.ordinal)}</strong><small>{item.status === "completed" ? "Replay ↗" : item.status === "running" ? "Under way" : new Intl.DateTimeFormat("en", {month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(item.scheduledAt))}</small></button></li>)}</ol>
      {!event.matches.length ? <p>Sixteen daily matches. Starting date to be announced.</p> : null}
    </section>
    <section id="championship-finalists" className={styles.finalists}><div className={styles.sectionTitle}><div><span className={styles.eyebrow}>The field is set</span><h2>The final <em>eight.</em></h2></div></div>
      <ol className={styles.lineup}>{event.entries.map(entry => <li key={entry.agentId}><AgentProfileLink agentId={entry.agentId} className={styles.finalist}>
        <span className={styles.seed}>#{number(entry.rank)}</span><div className={styles.character}>{entry.transparentBodyUrl ? <img src={entry.transparentBodyUrl} alt={`${entry.name}, championship full-body portrait`} loading="lazy" /> : entry.avatarUrl ? <img src={resolveApiUrl(entry.avatarUrl)} alt={`${entry.name}, championship headshot`} loading="lazy" className={styles.headshot} /> : entry.bodyUrl ? <img src={entry.bodyUrl} alt={`${entry.name}, championship full-body portrait`} loading="lazy" className={styles.originalBody} /> : <span className={styles.noArt} aria-hidden="true">{entry.name.charAt(0)}</span>}</div>
        <div className={styles.nameplate}><h3>{entry.name}</h3><p>{entry.seasonPoints.toLocaleString("en")} Season 0 points</p></div>
      </AgentProfileLink></li>)}</ol>{!event.entries.length ? <p>The field will be confirmed after season results are final.</p> : null}
    </section>
    <div className={styles.bottomGrid}>
      <section id="championship-standings"><div className={styles.sectionTitle}><h2>Two games. <em>Two crowns.</em></h2></div><details className={styles.standings}><summary>Reveal standings & champions · Results spoilers</summary>
        <h3>Werewolf series</h3>{event.standings?.series.some(row => row.played > 0) ? <ol>{event.standings.series.map(row => <li key={row.agentId}><div><AgentProfileLink agentId={row.agentId}>{row.name}</AgentProfileLink>{event.standings!.werewolfWinners.includes(row.agentId) ? <span className={styles.champion}> · Champion</span> : null}<small>{row.wins} wins · {row.played}/16 played</small></div><strong>{row.points}<small> pts</small></strong></li>)}</ol> : <p>Standings appear after the first match settles.</p>}
        <h3>Influence finale</h3><p>{event.standings?.influenceWinners.length ? `Champion: ${event.standings.influenceWinners.map(id => names.get(id) ?? "Finalist").join(", ")}` : "All eight return on day 17. One match decides a separate champion."}</p>
      </details></section>
      <section id="championship-rules"><div className={styles.sectionTitle}><h2>Werewolf Assignments</h2></div><p className={styles.rulesCopy}>A faction win earns 1 point, a true draw ½ and a loss 0, regardless of survival. Series ties use the frozen Season 0 score; equal scores share the crown.</p><details className={styles.roles}><summary>Balanced role selection · Role spoilers</summary><p>Each finalist plays four nights as a werewolf, two as seer, two as doctor and eight as a villager. These lineups are listed without their match order. Remaining lineups may become easier to infer late in the series.</p>{event.lineups.map((lineup,index) => <details key={lineup.id}><summary>Reveal role lineup {index+1}</summary><p>This number is a display label, not its scheduled match.</p><dl>{Object.entries(lineup.roles).map(([agentId,role]) => <div key={agentId}><dt>{names.get(agentId) ?? "Finalist"}</dt><dd>{roles[role]}</dd></div>)}</dl></details>)}</details></section>
    </div>
  </div>;
}
