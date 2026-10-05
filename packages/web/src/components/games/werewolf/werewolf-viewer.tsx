"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import type {WerewolfAudience} from "@influence/engine/werewolf/observation";
import type {WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
import {GamePlayerAvatarPreview} from "@/components/game-player-avatar-preview";
import {WatchShell, ShellHeader} from "@/components/watch/watch-shell";
import {CastRail, MobileContextPanel} from "@/components/watch/watch-cast";
import {WatchInspector, InspectorSection} from "@/components/watch/watch-inspector";
import {useWatchMusic} from "@/components/watch/use-watch-music";
import {werewolfMusic} from "./werewolf-music";
import {WatchTransport} from "@/components/watch/watch-transport";
import {usePlayerFullscreen} from "@/components/watch/use-player-fullscreen";
import {WatchThinking} from "@/components/watch/watch-thinking";
import {useWatchPreferences, type WatchPreferenceScope} from "@/components/watch/use-watch-preferences";
import {WatchWaiting} from "@/components/watch/watch-waiting";
import {apiFetch} from "@/lib/api";
import type {WerewolfThinking as ThinkingData} from "@influence/engine/werewolf/thinking";
import {useWatchKeyboard} from "@/components/watch/use-watch-keyboard";
import {getWerewolfWatch, stopWerewolf} from "@/lib/werewolf-api";
import {usePermissions} from "@/hooks/use-permissions";
import {useWerewolfWatch} from "./use-werewolf-watch";
import {adjacentWerewolfPosition} from "./werewolf-watch-model";
import {WerewolfWatchStage} from "./werewolf-watch-stage";
import {WerewolfThinking} from "./werewolf-thinking";
import Link from "next/link";
import {gameResultsHref, werewolfMomentHref} from "@/lib/game-links";
import {replayMoment} from "./replay-moment";

export function WerewolfViewer({slug, audience, preferenceScope = "viewer", startCursor}: {slug: string; audience: WerewolfAudience; preferenceScope?: WatchPreferenceScope; startCursor?: number}) {
  const preferences = useWatchPreferences(preferenceScope);
  const [publication] = useState(() => new Date().toISOString());
  if (!preferences.ready) return <WatchWaiting label="Preparing the player…" />;
  return <WerewolfSession startCursor={startCursor} preferences={preferences} key={`${slug}:${audience}`} slug={slug} audience={audience} cutoff={publication} />;
}
function WerewolfSession({slug, audience, cutoff, preferences, startCursor}: {slug: string; audience: WerewolfAudience; cutoff: string; preferences: ReturnType<typeof useWatchPreferences>; startCursor?:number}) {
  const watch = useWerewolfWatch(slug, audience, cutoff, startCursor);
  const {director, snapshot, data, active} = watch;
  const frame = useRef<HTMLDivElement>(null);
  const fullscreen = usePlayerFullscreen(frame);
  const [selected, setSelected] = useState<string | null>(null);
  const {thinking, setThinking, thinkingOrder, setThinkingOrder} = preferences;
  const [inspecting, setInspecting] = useState(false), [transcript, setTranscript] = useState(false);
  const [stopping, setStopping] = useState(false), [stopError, setStopError] = useState<string | null>(null);
  const {hasPermission} = usePermissions();
  const cursor = active?.cursor ?? 1;
  const cue = director.getActiveCue();
  const eliminatedAtReveal = cue?.ballot && cue.moment.entry.kind === "vote" ? cue.moment.entry.result.eliminatedId : null;
  const players = (active?.snapshot.players ?? []).map(player => player.id === eliminatedAtReveal ? {...player, alive:true} : player);
  const selectedId = selected ?? players[0]?.id;
  const identity = data?.players.find(player => player.id === selectedId);
  const person = players.find(player => player.id === selectedId);
  const music = useWatchMusic({navigationRevision:watch.navigationRevision, section: werewolfMusic(active), playing: watch.follow,
    muted: preferences.musicMuted, volume: preferences.musicVolume, preparing: watch.preparing,
    holding: watch.holding, live: data?.status === "in_progress"});
  const toggle = () => {if (watch.follow) music.suspend(); else if (!preferences.musicMuted) music.unlock(); watch.toggle();};
  const seek = (position: number) => { music.suspend(); void watch.seek(position); };
  const adjacent = (direction: -1 | 1, kind: "scene" | "chapter") => seek(adjacentWerewolfPosition(data?.navigation ?? [], cursor, direction, kind));
  const back = () => {music.suspend(); watch.previous();};
  useWatchKeyboard({toggle, advance: () => director.manualAdvance(), back, previousChapter: () => adjacent(-1,"scene"), nextChapter: () => adjacent(1,"scene"), speed: value => director.setSpeed(value)});
  const contribution = cue ? replayMoment({...cue.moment.snapshot, entries:[cue.moment.entry]}) : null;
  const performer = contribution?.spoken ? contribution.actor : undefined;
  const thinkingCursor = cue?.moment.cursor;
  const gameId = data?.gameId;
  const actorId = performer?.id;
  const loadThinking = useCallback(async (signal: AbortSignal) => {
    if (audience !== "omniscient" || !gameId || !actorId || !thinkingCursor) return null;
    const result = await apiFetch<ThinkingData>(`/api/werewolf/${encodeURIComponent(gameId)}/thinking?audience=omniscient&cursor=${thinkingCursor}`, {signal, cache:"no-store"});
    return result.entries.filter(entry => entry.cursor === thinkingCursor && entry.actorId === actorId).map(entry => entry.thinking).join("\n\n") || null;
  }, [audience, gameId, actorId, thinkingCursor]);
  const cast = {counts: {totalPlayers: players.length}, phaseLabel: active ? `Day ${active.snapshot.day} · ${active.snapshot.phase}` : "Preparing", players: players.map(player => {
    const frozen = data?.players.find(p => p.id === player.id);
    const avatar = {name: player.name, avatarUrl: frozen?.avatarUrl ?? undefined, personaKey: player.personaKey ?? undefined, persona: player.personaKey ?? ""};
    return {id: player.id, name: player.name, isSelected: player.id === selectedId, statusLabel: player.alive ? "Alive" : "Out", statusClass: player.alive ? "border border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border border-rose-400/20 bg-rose-400/10 text-rose-200", portrait: <GamePlayerAvatarPreview player={avatar} size="8" />, smallPortrait: <GamePlayerAvatarPreview player={avatar} size="6" />, tags: <span className="text-[10px] text-white/45">{player.role ?? "Role unknown"}</span>};
  })};
  const header = {matchTitle: slug, roundLabel: active ? active.chapterId === "introduction" ? "Introductions" : active.chapterId === "ending" ? "Ending" : `Cycle ${active.snapshot.day}` : "Preparing", connectionLabel: data?.status === "in_progress" ? watch.follow ? "Following live" : "Live game" : data?.status ?? "Loading", counts: {alivePlayers: players.filter(p => p.alive).length, eliminatedPlayers: players.filter(p => !p.alive).length}};
  const inspect = <WatchInspector hero={identity && <div className="border-b border-white/10 p-4"><h2 className="text-xl text-white/90">{identity.name}</h2><p className="mt-1 text-xs text-white/50">{person?.role ?? "Role unknown"} · {person?.alive ? "Alive" : "Eliminated"}</p></div>} sections={[
    {id:"overview", label:"Overview", content:<InspectorSection title="Character" section={{cards: identity ? [{id:identity.id,title:identity.personaKey ?? identity.name,meta:person?.role ?? "",body:[identity.personality,identity.backstory].filter(Boolean).join("\n\n")}] : [],reason:"Choose a player."}} />},
    ...(audience === "omniscient" && thinking ? [{id:"thinking",label:"Thinking",content: active && selectedId ? <WerewolfThinking gameId={active.snapshot.gameId} cursor={cursor} players={players} actorId={selectedId} /> : null}] : []),
    {id:"strategy",label:"Strategy",content:<InspectorSection title="Strategy" section={{cards:[],reason:"No public strategy notes have been captured for this player yet."}} />},
  ]} />;
  return <WatchShell mode="replay" header={<ShellHeader model={header} gamePath={slug} showResultsCta={false} exitHref="/games" brand="THE HOUSE" />}
    cast={<CastRail model={cast} onSelectPlayer={setSelected} />}
    mobileCast={<div className="shrink-0 xl:hidden"><MobileContextPanel model={cast} onSelectPlayer={id => {setSelected(id);setInspecting(true);}} /><button className="px-3 py-1 text-xs text-white/60" onClick={() => setInspecting(true)}>Player info</button></div>}
    inspector={<div role={inspecting ? "dialog" : undefined} aria-modal={inspecting || undefined} aria-label={inspecting ? "Player information" : undefined} className={inspecting ? "fixed inset-3 z-50 flex min-h-0 flex-col bg-black xl:static" : "hidden min-h-0 xl:block"}>{inspecting && <button className="shrink-0 p-3 text-right text-sm text-white/70 xl:hidden" onClick={() => setInspecting(false)}>Close player info</button>}{inspect}</div>}
    theater={<section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/45">
      {(watch.error || stopError) && <div role="alert" className="shrink-0 p-2 text-xs text-amber-100">{watch.error ?? stopError} <button onClick={watch.retry}>Retry</button></div>}
      {(data?.status === "cancelled" || data?.status === "suspended") && <p role="status" className="shrink-0 p-2 text-xs text-amber-100">{data.status === "cancelled" ? "An operator stopped this game." : "This game stopped after an execution error."} Committed play remains available.</p>}
      <div ref={frame} data-player-fullscreen={fullscreen.fullscreen || undefined} className="relative flex min-h-0 flex-1 flex-col bg-black" style={fullscreen.fullscreen ? {position:"fixed",inset:0,width:"100vw",height:"100dvh",zIndex:1000} : undefined}>
        <WatchThinking director={director} cueKey={cue?.key ?? null} enabled={audience === "omniscient" && thinking} order={thinkingOrder} speaker={performer?.name ?? "Player"} load={loadThinking}>
        <WerewolfWatchStage navigationRevision={watch.navigationRevision} contextLabel={active ? replayMoment({...active.snapshot, entries:[active.entry]}).title : undefined} cue={director.getActiveCue()} scene={active?.mediaKey ? watch.media[active.mediaKey] ?? null : null} elapsed={watch.elapsed} reduced={snapshot.reducedMotion} director={director} holding={watch.holding} status={data?.status} />
        </WatchThinking>
        {watch.preparing && <p role="status" className="absolute right-3 top-2 text-xs text-white/40">Preparing…</p>}
        {active?.entry.kind === "result" && <Link className="self-center rounded-lg border border-white/20 px-4 py-2 text-sm text-white" href={gameResultsHref(slug)}>View final results</Link>}
        <div data-replay-controls className="shrink-0 border-t border-white/5 bg-black/70 px-1 py-2 sm:px-3">
          <WatchTransport shareHref={active ? werewolfMomentHref(slug,audience,active.cursor) : undefined} fullscreen={fullscreen.fullscreen} fullscreenButton={fullscreen.button} toggleFullscreen={fullscreen.toggle} fullscreenError={fullscreen.error} isPlaying={watch.follow} togglePlay={toggle} music={{muted:preferences.musicMuted, volume:preferences.musicVolume, status:music.status, onMute:() => {if (music.status === "blocked" || music.status === "unavailable") music.unlock(); else {preferences.setMusicMuted(!preferences.musicMuted); music.unlock();}}, onVolume:preferences.setMusicVolume, retry:music.unlock}} onScrubStart={music.beginScrub} onScrubEnd={music.endScrub} speed={snapshot.speed} onSpeed={value => director.setSpeed(value)} goToBeginning={() => {music.restart(); seek(1);}} goToPrevScene={() => adjacent(-1,"scene")} onSeek={seek} goToNextScene={() => adjacent(1,"scene")} goToEnd={() => {music.suspend(); if (data?.status === "in_progress") watch.goLive(); else seek(data?.latestCursor ?? 1);}} live={data?.status === "in_progress"} cursor={cursor - 1} count={data?.latestCursor ?? 1} settings={<div className="flex flex-col items-start gap-3 text-sm text-white/80">
        <span className="text-xs text-white/50" aria-label="Viewing mode">Viewing mode: {audience === "omniscient" ? "Omniscient" : "Mystery"}</span>
        {data?.status === "completed" && <Link href={gameResultsHref(slug)}>View results · Spoilers</Link>}
        <button onClick={() => setTranscript(value => !value)}>Transcript</button>
        {data?.status === "in_progress" && hasPermission("stop_game") && <button disabled={stopping} onClick={async () => {setStopping(true);try {await stopWerewolf(data.gameId);} catch(cause) {setStopError(cause instanceof Error ? cause.message : "Could not stop game");} finally {setStopping(false);}}}>Stop game</button>}
      </div>} thinking={audience === "omniscient" ? {enabled:thinking,onChange:setThinking,order:thinkingOrder,onOrderChange:setThinkingOrder} : undefined} />
        </div>
      {transcript && <div role="dialog" aria-modal="true" aria-label="Game transcript" className="absolute inset-4 z-40 flex flex-col overflow-hidden rounded-xl border border-white/20 bg-black p-4"><button className="self-end" onClick={() => setTranscript(false)}>Close transcript</button><RawTranscript key={`${cursor}`} slug={slug} audience={audience} cutoff={cutoff} cursor={cursor} /></div>}
      </div>
    </section>} />;
}
function RawTranscript({slug,audience,cutoff,cursor}: {slug:string;audience:WerewolfAudience;cutoff:string;cursor:number}) {
  const [start,setStart] = useState(Math.max(1,cursor-31));
  const [read,setRead] = useState<WerewolfWatchWindow | null>(null);
  const [error,setError] = useState<string | null>(null);
  useEffect(() => {const controller = new AbortController();void getWerewolfWatch(slug,audience,start,controller.signal,cutoff).then(value => {if(!controller.signal.aborted)setRead(value);}).catch(cause => {if(!controller.signal.aborted)setError(String(cause));});return () => controller.abort();},[slug,audience,start,cutoff]);
  return <><h2>Transcript through moment {cursor}</h2>{error && <p role="alert">{error}</p>}<ol className="flex-1 space-y-4 overflow-y-auto py-4">{read?.fromCursor === start && read.moments.filter(m=>m.cursor<=cursor).map(m=>{const line=replayMoment({...m.snapshot,entries:[m.entry]});return <li key={m.cursor}><p className="text-xs text-white/40">{line.title} · {line.speaker}</p><p>{line.text}</p>{line.cue && <p className="text-xs text-white/40">{line.cue}</p>}</li>;})}</ol><div className="flex gap-4"><button disabled={start===1} onClick={()=>setStart(Math.max(1,start-32))}>Earlier</button><button disabled={start+32>cursor} onClick={()=>setStart(start+32)}>Later</button></div></>;
}
