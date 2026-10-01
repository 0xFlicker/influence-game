"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getWerewolfPresentation, stopWerewolf } from "@/lib/werewolf-api";
import { usePermissions } from "@/hooks/use-permissions";
import type { WerewolfAudience } from "@influence/engine/werewolf/observation";
import type { WerewolfPresentation } from "@influence/engine/werewolf/presentation";
import { WerewolfPlayer } from "./werewolf-player";
import { replayMoment } from "./replay-moment";
import styles from "./werewolf-player.module.css";

export function WerewolfViewer({ slug }: { slug: string }) {
  const [audience, setAudience] = useState<WerewolfAudience>("mystery");
  const [cursor, setCursor] = useState<number | null>(1);
  const [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [waiting, setWaiting] = useState(false);
  const [read, setRead] = useState<{ key: string; value: WerewolfPresentation } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [stopping, setStopping] = useState(false);
  const { hasPermission } = usePermissions();
  const publication = useRef<{ slug: string; cutoff: string } | null>(null);
  const key = `${slug}:${audience}:${cursor}`;
  // Never paint a future prefix or another audience while a request is pending.
  const data = read?.key === key ? read.value : null;
  const moment = data ? replayMoment(data.view) : null;
  const error = failure?.key === key ? failure.message : null;
  useEffect(() => {
    const controller = new AbortController();
    let fetching = false, finished = false;
    const refresh = async () => {
      if (fetching || finished) return;
      fetching = true;
      try {
        const value = await getWerewolfPresentation(slug, audience, cursor, controller.signal, publication.current?.slug === slug ? publication.current.cutoff : undefined);
        if (!controller.signal.aborted) {
          publication.current = { slug, cutoff: value.publicationCutoff };
          // Keep this moment's published picture stable while following the live frontier.
          setRead(previous => ({ key, value: previous?.key === key && previous.value.view.cursor === value.view.cursor ? { ...value, scene: previous.value.scene } : value }));
          setFailure(null); finished = value.status !== "in_progress";
        }
      } catch (e) {
        if (!controller.signal.aborted) { setRead(null); setFailure({ key, message: e instanceof Error ? e.message : "Could not load game" }); }
      } finally { fetching = false; }
    };
    void refresh(); const timer = setInterval(() => { void refresh(); }, 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [slug, audience, cursor, key]);
  const advance = useCallback(() => {
    if (!data) return;
    if (data.view.cursor < data.latestCursor) { setCursor(data.view.cursor + 1); setWaiting(false); }
    else if (data.status === "in_progress") setWaiting(true);
    else { setPlaying(false); setWaiting(false); }
  }, [data]);
  useEffect(() => { if (playing && waiting) advance(); }, [playing, waiting, advance]);
  const seek = useCallback((position: number | null) => { setPlaying(false); setWaiting(false); setCursor(position); }, []);
  const toggle = useCallback(() => {
    if (!data) return;
    if (cursor === null) setCursor(data.view.cursor);
    setPlaying(value => !value);
  }, [data, cursor]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof Element && event.target.closest("input,select,textarea,button,a,summary,[contenteditable=true],[role=dialog]")) return;
      if (event.code === "Space") { event.preventDefault(); toggle(); }
      if (data && event.code === "ArrowRight") { event.preventDefault(); seek(Math.min(data.latestCursor, data.view.cursor + 1)); }
      if (data && event.code === "ArrowLeft") { event.preventDefault(); seek(Math.max(1, data.view.cursor - 1)); }
    };
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, [toggle, seek, data]);
  return <div className={styles.player}>
    <Link href="/werewolf" className="text-sm text-white/50 hover:text-white">← Werewolf games</Link>
    <header className={styles.header}><div><p className={styles.eyebrow}>Werewolf · {cursor === null ? "Latest moment" : "Visual replay"}</p><h1>{slug}</h1></div>
      <fieldset className={styles.modes}><legend className="sr-only">Spectator mode</legend>{(["mystery", "omniscient"] as const).map(mode => <button key={mode} aria-pressed={audience === mode} onClick={() => { setAudience(mode); seek(1); }}>{mode === "mystery" ? "Mystery" : "Omniscient"}</button>)}</fieldset>
    </header>
    <p className={`${styles.meta} mb-4`}>{audience === "mystery" ? "Roles stay hidden until the ending. Follow the public conversation." : "All roles are visible. Private pack discussion and night decisions are included."}</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {data ? <WerewolfPlayer key={`${slug}:${audience}:${data.view.cursor}`} data={data} playing={playing && !waiting} speed={speed} onAdvance={advance} /> : <div className={styles.stage}><p role="status" className={styles.loading}>{error ? "Replay unavailable" : "Loading the village…"}</p></div>}
    <div className={styles.transport}>
      <div className={styles.controls}>
        <button onClick={() => seek(1)}>Beginning</button>
        <button disabled={!data || data.view.cursor <= 1} onClick={() => data && seek(data.view.cursor - 1)}>Previous</button>
        <button disabled={!data} onClick={toggle}>{playing ? "Pause" : "Play"}</button>
        <button disabled={!data || data.view.cursor >= data.latestCursor} onClick={() => data && seek(data.view.cursor + 1)}>Next</button>
        <button onClick={() => seek(null)}>Latest</button>
        <label>Speed<select aria-label="Playback speed" value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[0.75, 1, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
        <span className={styles.progress}>{waiting ? "Caught up · waiting for the next moment" : data ? `${data.view.cursor} / ${data.latestCursor} moments` : "…"}</span>
      </div>
      <label className={styles.seek}>Position<input aria-label="Replay position" type="range" min={1} max={data?.latestCursor ?? Math.max(1, cursor ?? 1)} value={data?.view.cursor ?? cursor ?? 1} disabled={!data} onChange={e => seek(Number(e.target.value))} /></label>
      <p className={styles.meta}>Space to play or pause · Arrow keys to step · Playback pauses while this tab is hidden</p>
    </div>
    {data && <>
      {moment?.spoken && moment.cue && <details className={styles.ledger}><summary>Performance note</summary><p className={styles.cue}>{moment.cue}</p></details>}
      {moment && moment.details.length > 0 && <details className={styles.ledger}><summary>{data.view.entries.at(-1)?.kind === "result" ? "Cast and winners" : "Decision details"}</summary><ul>{moment.details.map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
      <div className={styles.cast}>{data.view.players.map(player => <span key={player.id} data-alive={player.alive}>{player.name} · {player.role ?? "Role unknown"} · {player.alive ? "Alive" : "Dead"}</span>)}</div>
      <p className={styles.meta}>{data.view.phase === "complete" ? "Game complete" : `Day ${data.view.day} · ${data.view.phase}`} · {data.view.players.filter(p => p.alive).length} alive</p>
      {data.status === "suspended" && <p role="status" className={styles.error}>The game stopped after an execution error. Committed play remains available.</p>}
      {data.status === "cancelled" && <p role="status" className={styles.error}>An operator stopped this game.</p>}
      <details className={styles.ledger}><summary>Transcript to this moment</summary><ol>{data.view.entries.map((entry, index) => {
        const moment = replayMoment({ ...data.view, entries: [entry] });
        return <li key={index}><p className={styles.meta}>{moment.title}</p>{moment.actor && <strong>{moment.speaker}</strong>}<p>{moment.text}</p>{moment.cue && <p className={styles.cue}>Performance note · {moment.cue}</p>}{moment.details.map((line, i) => <p key={i}>{line}</p>)}</li>;
      })}</ol></details>
      {data.status === "in_progress" && hasPermission("stop_game") && <button className="mt-4" disabled={stopping} onClick={async () => { setStopping(true); try { await stopWerewolf(data.view.gameId); } catch (e) { setFailure({ key, message: e instanceof Error ? e.message : "Could not stop game" }); } finally { setStopping(false); } }}>Stop game</button>}
    </>}
  </div>;
}
