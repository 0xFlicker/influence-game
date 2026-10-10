"use client";
import { Player, type PlayerRef, type CallbackListener } from "@remotion/player";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent, type CSSProperties } from "react";
import { ReplayFrame } from "@/remotion/house-replay/frame";
import { retainPresentationAnchor, type CompiledPresentation, type PresentationMoment } from "@/lib/replay-export/presentation";
import { cueIndexAt, type ReplayManifest } from "@/lib/replay-export/manifest";
import styles from "./workspace.module.css";

export type ProductionPreviewHandle = {pauseAndRetainAnchor: () => void; seekMoment: (id: string) => void};
export type PresentationAnchor = {momentId: string; offsetMs: number} | null;
const time = (frame: number, fps: number) => `${Math.floor(frame / fps / 60)}:${String(Math.floor(frame / fps) % 60).padStart(2, "0")}.${String(frame % fps).padStart(2, "0")}`;

/** One Player owns time and all composition audio. Editing preserves a semantic moment anchor. */
export const ProductionPreview = forwardRef<ProductionPreviewHandle, {
  base: ReplayManifest; source: PresentationMoment[]; selectedIds: string[]; view: "source" | "cut";
  compiled: CompiledPresentation; onActiveMomentChange: (state: {momentId: string | null; view: "source" | "cut"; revision: string}) => void;
  onViewChange: (view: "source" | "cut") => void; emptyLabel: string;
  readAnchor: () => PresentationAnchor; onAnchorChange: (anchor: PresentationAnchor) => void;
  playback: {muted: boolean; volume: number}; onPlaybackChange: (playback: {muted: boolean; volume: number}) => void;
}>(function ProductionPreview({base, source, compiled, selectedIds, view, onViewChange, onActiveMomentChange, emptyLabel, readAnchor, onAnchorChange, playback, onPlaybackChange}, ref) {
  const ids = useMemo(() => view === "source" ? source.map(moment => moment.id) : selectedIds, [view, source, selectedIds]);
  const manifest = useMemo<ReplayManifest | null>(() => compiled.cues.length ? {...base, ...compiled, range: {fromFrame: 0, untilFrame: Math.ceil(compiled.audio.durationMs * base.fps / 1000)}} : null, [base, compiled]);
  const [position, setPosition] = useState({key: "", frame: 0});
  const [transport, setTransport] = useState({key: "", playing: false, buffering: false});
  const {muted, volume} = playback;
  const [zoom, setZoom] = useState(1), [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const player = useRef<PlayerRef>(null), container = useRef<HTMLDivElement>(null);
  const drag = useRef<{pointer: number; playing: boolean} | null>(null);
  const playerKey = useMemo(() => `${base.revision}:${view}:${JSON.stringify(ids)}:${JSON.stringify(base.profile)}:${base.width}:${base.height}:${base.fps}:${base.reducedMotion}:${retry}`, [base.revision, view, ids, base.profile, base.width, base.height, base.fps, base.reducedMotion, retry]);
  // A replacement Player starts paused, even when a cached bundle lets this host
  // remain mounted. Transport events only describe their exact Player instance.
  const playing = transport.key === playerKey && transport.playing, buffering = transport.key === playerKey && transport.buffering;
  const initialPosition = useMemo(() => {
    const anchor = readAnchor();
    return {key: playerKey, frame: retainPresentationAnchor(source, compiled, anchor ? {momentId: anchor.momentId, offsetFrames: Math.round(anchor.offsetMs * base.fps / 1000)} : null) ?? 0};
  }, [source, compiled, readAnchor, base.fps, playerKey]);
  const initialFrame = initialPosition.frame;
  const frame = position.key === initialPosition.key ? position.frame : initialFrame, duration = manifest?.range.untilFrame ?? 0;
  const indexes = useMemo(() => {
    const moments = new Map(compiled.moments.map((moment, index) => [moment.id, {...moment, index}]));
    const firstCues = new Map<string, (typeof compiled.cues)[number]>();
    for (const cue of compiled.cues) if (cue.momentId && !firstCues.has(cue.momentId)) firstCues.set(cue.momentId, cue);
    return {moments, firstCues};
  }, [compiled]);
  const activeCue = compiled.cues[cueIndexAt(compiled.timeline, frame / base.fps * 1000)];
  const active = activeCue?.momentId ? indexes.moments.get(activeCue.momentId) : undefined;
  const activeId = active?.id ?? null;
  useEffect(() => {onActiveMomentChange({momentId: activeId, view, revision: base.revision});}, [activeId, view, base.revision, onActiveMomentChange]);
  const timelineMoments = useMemo(() => compiled.moments.map(moment => {
    const cue = indexes.firstCues.get(moment.id);
    return <div key={moment.id} className={styles.timelineMoment} data-kind={cue?.timing.kind} style={{left: `${moment.startFrame / duration * 100}%`, width: `${(moment.endFrame - moment.startFrame) / duration * 100}%`}}><span>{cue?.label}</span></div>;
  }), [compiled.moments, indexes, duration]);

  useEffect(() => {
    const host = player.current;
    if (!host) return;
    const changed: CallbackListener<"frameupdate"> = event => setPosition({key: playerKey, frame: event.detail.frame});
    const update = (patch: Partial<Pick<typeof transport, "playing" | "buffering">>) => setTransport(current => ({...(current.key === playerKey ? current : {key: playerKey, playing: false, buffering: false}), ...patch}));
    const started = () => update({playing: true}), stopped = () => update({playing: false}), waiting = () => update({buffering: true}), ready = () => update({buffering: false});
    const failed: CallbackListener<"error"> = event => {update({playing: false, buffering: false}); setNotice(`Preview failed: ${event.detail.error.message}`);};
    host.addEventListener("frameupdate", changed); host.addEventListener("play", started); host.addEventListener("pause", stopped); host.addEventListener("ended", stopped); host.addEventListener("waiting", waiting); host.addEventListener("resume", ready); host.addEventListener("error", failed);
    return () => {host.removeEventListener("frameupdate", changed); host.removeEventListener("play", started); host.removeEventListener("pause", stopped); host.removeEventListener("ended", stopped); host.removeEventListener("waiting", waiting); host.removeEventListener("resume", ready); host.removeEventListener("error", failed);};
  }, [playerKey]);
  function pauseAndRetainAnchor() {
    const currentFrame = player.current?.getCurrentFrame() ?? frame;
    const cue = compiled.cues[cueIndexAt(compiled.timeline, currentFrame / base.fps * 1000)];
    const moment = cue?.momentId ? indexes.moments.get(cue.momentId) : undefined;
    if (moment) onAnchorChange({momentId: moment.id, offsetMs: (currentFrame - moment.startFrame) / base.fps * 1000});
    player.current?.pause(); setTransport({key: playerKey, playing: false, buffering: false});
  }
  function seek(next: number) {
    if (!manifest) return;
    const bounded = Math.max(0, Math.min(duration - 1, Math.round(next)));
    const cue = compiled.cues[cueIndexAt(compiled.timeline, bounded / base.fps * 1000)];
    const moment = cue?.momentId ? indexes.moments.get(cue.momentId) : undefined;
    if (moment) onAnchorChange({momentId: moment.id, offsetMs: (bounded - moment.startFrame) / base.fps * 1000});
    player.current?.seekTo(bounded); setPosition({key: playerKey, frame: bounded});
  }
  function seekMoment(id: string) {
    const moment = indexes.moments.get(id);
    if (!moment) {setNotice("This moment is omitted from the selected cut. Switch to Source to seek it."); return;}
    player.current?.pause(); seek(moment.startFrame); setNotice(null);
  }
  useImperativeHandle(ref, () => ({pauseAndRetainAnchor, seekMoment}));
  function pointerFrame(event: PointerEvent<HTMLDivElement>) {const bounds = event.currentTarget.getBoundingClientRect(); return (event.clientX - bounds.left) / bounds.width * Math.max(0, duration - 1);}
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!manifest) return;
    drag.current = {pointer: event.pointerId, playing: player.current?.isPlaying() ?? false};
    player.current?.pause(); player.current?.mute(); event.currentTarget.setPointerCapture(event.pointerId); seek(pointerFrame(event));
  }
  function pointerFinish(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    if (drag.current?.pointer !== event.pointerId) return;
    const resume = drag.current.playing && !cancelled; drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!muted) player.current?.unmute();
    if (resume) player.current?.play();
  }
  function stepMoment(direction: -1 | 1) {const next = compiled.moments[(active?.index ?? -1) + direction]; if (next) seekMoment(next.id);}
  async function fullscreen() {try {if (document.fullscreenElement) await document.exitFullscreen(); else await container.current?.closest<HTMLElement>("[data-production-workspace]")?.requestFullscreen();} catch (error) {setNotice(`Fullscreen unavailable: ${error instanceof Error ? error.message : "Request failed"}`);}}
  return <div className={styles.previewLayout} data-production-preview data-preview-view={view} data-preview-revision={base.revision}>
    <section className={styles.monitor} aria-label="Playable preview">
    <div className={styles.sectionHeading}><h2>{view === "source" ? "Source preview" : "Selected cut"}</h2><span>{base.width} × {base.height} / {base.fps} fps · Fit monitor</span><button onClick={() => void fullscreen()}>Fullscreen</button></div>
    <div ref={container} className={styles.monitorStage} style={{"--studio-ratio": base.width / base.height} as CSSProperties}>
    <div className={styles.preview} data-preview-frame={frame} data-preview-moment={active?.id ?? "empty"}>
      {manifest ? <Player key={playerKey} ref={player} component={ReplayFrame} inputProps={{manifest, preview: true}} durationInFrames={duration} compositionWidth={base.width} compositionHeight={base.height} fps={base.fps} initialFrame={initialFrame} initiallyMuted={muted} initialVolume={volume} numberOfSharedAudioTags={0} controls={false} clickToPlay={false} spaceKeyToPlayOrPause={false} moveToBeginningWhenEnded={false} style={{width: "100%", height: "100%"}} errorFallback={({error}) => <div className={styles.empty} role="alert"><p>Preview failed: {error.message}</p><button onClick={() => {pauseAndRetainAnchor(); setRetry(value => value + 1); setNotice(null);}}>Retry intended frame</button></div>} /> : <div className={styles.empty}><h3>Empty cut</h3><p>{emptyLabel}</p><button onClick={() => {pauseAndRetainAnchor(); onViewChange("source");}}>Browse source</button></div>}
    </div></div><div className={styles.monitorCaption}><span>{activeCue?.label ?? "No playable moment"}</span><span>Pinned published visuals</span></div>
    </section>
    <section className={styles.timelinePanel} aria-label="Timeline and playback">
    <div className={styles.transport} aria-label="Playback controls"><button disabled={!manifest} onClick={() => stepMoment(-1)} aria-label="Previous moment">Previous</button><button disabled={!manifest} onClick={() => {player.current?.pause(); seek(frame - 1);}} aria-label="Previous frame">−1</button><button className={styles.playButton} disabled={!manifest} onClick={() => player.current?.toggle()}>{playing ? "Pause" : "Play"}</button><button disabled={!manifest} onClick={() => {player.current?.pause(); seek(frame + 1);}} aria-label="Next frame">+1</button><button disabled={!manifest} onClick={() => stepMoment(1)} aria-label="Next moment">Next</button><output aria-label="Playhead">{time(frame, base.fps)} / {time(duration, base.fps)}</output><label className={styles.exactFrame}>Frame<input aria-label="Seek frame" type="number" min={0} max={Math.max(0, duration - 1)} value={frame} disabled={!manifest} onChange={event => {player.current?.pause(); seek(Number(event.target.value));}} /></label><button aria-pressed={muted} onClick={() => {if (muted) player.current?.unmute(); else player.current?.mute(); onPlaybackChange({...playback, muted: !muted});}}>{muted ? "Unmute" : "Mute"}</button><label className={styles.volume}>Volume<input aria-label="Playback volume" type="range" min={0} max={1} step={.05} value={volume} onChange={event => {const next = Number(event.target.value); onPlaybackChange({...playback, volume: next}); player.current?.setVolume(next);}} /></label></div>
    <div className={styles.timelineHeader}><strong>{activeCue?.label ?? "No playable moment"}</strong><label>Timeline zoom<input aria-label="Timeline zoom" type="range" min={1} max={8} step={.5} value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label></div>
    <div className={styles.timelineScroll}><div className={styles.timeline} style={{width: `${zoom * 100}%`}} role="slider" tabIndex={manifest ? 0 : -1} aria-label="Timeline playhead" aria-valuemin={0} aria-valuemax={Math.max(0, duration - 1)} aria-valuenow={Math.min(frame, Math.max(0, duration - 1))} onPointerDown={pointerDown} onPointerMove={event => {if (drag.current?.pointer === event.pointerId) seek(pointerFrame(event));}} onPointerUp={event => pointerFinish(event, false)} onPointerCancel={event => pointerFinish(event, true)} onLostPointerCapture={event => pointerFinish(event, true)} onKeyDown={event => {if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {event.preventDefault(); player.current?.pause(); seek(event.key === "Home" ? 0 : event.key === "End" ? duration - 1 : frame + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? base.fps : 1));}}}>
      {timelineMoments}
      {manifest && <div className={styles.playhead} style={{left: `${Math.min(frame, duration - 1) / duration * 100}%`}}><span /></div>}
    </div></div>
    <div className={styles.statusLine} role="status">{buffering ? "Buffering the intended frame…" : notice ?? "Drag to seek. Moment selection and properties follow the playhead."}</div>
    </section>
  </div>;
});
