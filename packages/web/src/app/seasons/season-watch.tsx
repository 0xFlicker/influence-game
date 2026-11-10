"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { featuredSeasonGame, playableSeasonGame, seasonGameLabel, type SeasonGame } from "./season-games";
import styles from "./seasons.module.css";
import {WerewolfWatchChoices} from "@/components/games/werewolf/werewolf-watch-choices";
const Player=dynamic(()=>import("./season-game-player").then(module=>module.SeasonGamePlayer),{ssr:false,loading:()=> <p role="status" className={styles.playerLoading}>Opening the watch room…</p>});
export function SeasonWatch({games,seasonName,seasonSlug,loading,error,nextDrawAt}:{games:SeasonGame[];seasonName:string;seasonSlug:string;loading:boolean;error:string|null;nextDrawAt?:string|null}) {
  const [chosen,setChosen]=useState<SeasonGame|null>(null);
  const [playing,setPlaying]=useState<SeasonGame|null>(null);
  const [audience,setAudience]=useState<"mystery"|"omniscient"|null>(null);
  const selected=chosen ? games.find(game=>game.id===chosen.id) ?? chosen : featuredSeasonGame(games);
  const game=playing ?? selected;
  const kind=game?.gameKind === "werewolf" ? "Werewolf" : "Influence";
  function play(value:SeasonGame, mode = audience) { if(!playableSeasonGame(value) || value.gameKind === "werewolf" && !mode)return;setChosen(value);if (mode) setAudience(mode);setPlaying(value); }
  return <section className={styles.seasonWatch} aria-labelledby="season-watch-title">
    <header className={styles.watchHeading}><h2 id="season-watch-title">Watch this season</h2><Link prefetch={false} href={`/games/season/${encodeURIComponent(seasonSlug)}`}>All {seasonName} games <span aria-hidden="true">→</span></Link></header>
    <div className={styles.watchGrid}>
      <div>
        <div className={styles.seasonPlayer} data-testid="season-player" data-playing={Boolean(playing)} data-audience={playing?.gameKind === "werewolf" ? audience ?? undefined : undefined}>
          {playing ? <Player key={playing.id} game={playing} audience={audience} onAudienceChange={setAudience}/> : <div className={styles.seasonPoster} data-kind={game?.gameKind??"influence"}>
            {loading && !game ? <p role="status">Finding this season’s games…</p> : error && !game ? <p role="alert">{error}</p> : !game ? <><h3>No games to watch.</h3><p>No games in this season yet.</p></> : <>
              <span className={styles.watchBadge}>{game.status === "in_progress" ? "Live now" : game.status === "completed" ? "Replay" : seasonGameLabel(game)}</span>
              {playableSeasonGame(game) && (game.gameKind !== "werewolf" || audience) && <button className={styles.bigPlay} onClick={()=>play(game)} aria-label={`${seasonGameLabel(game)}: ${game.slug}`}><span aria-hidden="true">▶</span></button>}
              <div className={styles.posterCaption}><div><span>{kind}</span><h3>{game.slug}</h3></div>{playableSeasonGame(game) ? game.gameKind === "werewolf" ? <div className="w-full max-w-sm"><WerewolfWatchChoices onWatch={mode=>play(game,mode)} /></div> : <button className={styles.watchAction} onClick={()=>play(game)}>{seasonGameLabel(game)} <span aria-hidden="true">↗</span></button> : <Link prefetch={false} className={styles.watchAction} href={`/games/${game.slug}`}>View game →</Link>}</div>
            </>}
          </div>}
        </div>
        <div className={styles.playerCaption} data-testid="season-player-caption" data-playing={Boolean(playing)} aria-hidden={!playing}><span>{game ? `${kind} · ${game.slug}` : ""}</span><div><button disabled={!playing} onClick={()=>setPlaying(null)}>Close player</button></div></div>
      </div>
      <aside className={styles.seasonEpisodes} aria-label="From this season"><h3>From this season</h3>
        {games.length ? <ol>{games.slice(0,5).map(item=><li key={item.id}><button aria-pressed={item.id===game?.id} className={styles.episodeChoice} onClick={()=>{setChosen(item);setPlaying(playableSeasonGame(item) && (item.gameKind !== "werewolf" || audience) ? item : null);}}><span className={styles.episodeArt} data-kind={item.gameKind} aria-hidden="true"/><span><strong>{item.slug}</strong><small>{item.gameKind === "werewolf" ? "Werewolf" : "Influence"} · {item.status === "completed" ? "Replay" : item.status === "in_progress" ? "Live" : seasonGameLabel(item)}</small></span></button></li>)}</ol> : <p>{loading ? "Loading games…" : "No games available."}</p>}
        {nextDrawAt && <p className={styles.drawTime}>Next draw <time dateTime={nextDrawAt}>{new Date(nextDrawAt).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"})} UTC</time></p>}
      </aside>
    </div>
  </section>;
}
