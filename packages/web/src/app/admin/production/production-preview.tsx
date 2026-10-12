"use client";
import { Player, type PlayerRef, type CallbackListener } from "@remotion/player";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ReplayFrame } from "@/remotion/house-replay/frame";
import { retainPresentationAnchor, type CompiledPresentation, type PresentationMoment } from "@/lib/replay-export/presentation";
import { cueIndexAt, type ReplayManifest } from "@/lib/replay-export/manifest";
import styles from "./workspace.module.css";
import {boundedFrame, boundedScroll, centeredScroll, edgeScrollSpeed, maximumZoom, pixelFrame, playbackScroll, visibleScroll, wheelPixels} from "./timeline-viewport";
import {matchStudioShortcut, studioShortcutProps, type PreviewCommand} from "./studio-shortcuts";

export type ProductionPreviewHandle = {pauseAndRetainAnchor: () => void; seekMoment: (id: string, at?: "start" | "content") => void; runShortcut: (command: PreviewCommand) => boolean};
export type PresentationAnchor = {momentId: string; offsetMs: number} | {momentId: string; at: "content"} | null;
const time = (frame: number, fps: number) => `${Math.floor(frame / fps / 60)}:${String(Math.floor(frame / fps) % 60).padStart(2, "0")}.${String(frame % fps).padStart(2, "0")}`;

/** One Player owns time and all composition audio. Editing preserves a semantic moment anchor. */
export const ProductionPreview = forwardRef<ProductionPreviewHandle, {
  base: ReplayManifest; source: PresentationMoment[]; selectedIds: string[]; view: "source" | "cut";
  compiled: CompiledPresentation; onActiveMomentChange: (state: {momentId: string | null; view: "source" | "cut"; revision: string}) => void;
  onViewChange: (view: "source" | "cut") => void; emptyLabel: string;
  readAnchor: () => PresentationAnchor; onAnchorChange: (anchor: PresentationAnchor) => void;
  playback: {muted: boolean; volume: number}; onPlaybackChange: (playback: {muted: boolean; volume: number}) => void;
  renderLayout: (monitor: ReactNode, transport: ReactNode) => ReactNode;
  onOpenHints: () => void;
  characterShortcuts: boolean;
  keyboardAvailable: () => boolean;
}>(function ProductionPreview({base, source, compiled, selectedIds, view, onViewChange, onActiveMomentChange, emptyLabel, readAnchor, onAnchorChange, playback, onPlaybackChange, renderLayout, onOpenHints, characterShortcuts, keyboardAvailable}, ref) {
  const ids = useMemo(() => view === "source" ? source.map(moment => moment.id) : selectedIds, [view, source, selectedIds]);
  const manifest = useMemo<ReplayManifest | null>(() => compiled.cues.length ? {...base, ...compiled, range: {fromFrame: 0, untilFrame: Math.ceil(compiled.audio.durationMs * base.fps / 1000)}} : null, [base, compiled]);
  const [position, setPosition] = useState({key: "", frame: 0});
  const [transport, setTransport] = useState({key: "", playing: false, buffering: false});
  const {muted, volume} = playback;
  const [requestedZoom, setZoom] = useState(1), [retry, setRetry] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true), [viewportState, setViewportState] = useState({left: 0, maximum: 0});
  const [notice, setNotice] = useState<string | null>(null);
  const [monitorSize, setMonitorSize] = useState({width: 0, height: 0});
  const player = useRef<PlayerRef>(null), container = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null), timeline = useRef<HTMLDivElement>(null);
  const drag = useRef<{pointer: number; playing: boolean; clientX: number; element: HTMLDivElement; tick: number} | null>(null), dragAnimation = useRef<number | null>(null);
  const playerKey = useMemo(() => `${base.revision}:${view}:${JSON.stringify(ids)}:${JSON.stringify(base.profile)}:${base.width}:${base.height}:${base.fps}:${base.reducedMotion}:${retry}`, [base.revision, view, ids, base.profile, base.width, base.height, base.fps, base.reducedMotion, retry]);
  // A replacement Player starts paused, even when a cached bundle lets this host
  // remain mounted. Transport events only describe their exact Player instance.
  const playing = transport.key === playerKey && transport.playing, buffering = transport.key === playerKey && transport.buffering;
  const initialPosition = useMemo(() => {
    const anchor = readAnchor();
    return {key: playerKey, frame: retainPresentationAnchor(source, compiled, anchor && "offsetMs" in anchor ? {momentId: anchor.momentId, offsetFrames: Math.round(anchor.offsetMs * base.fps / 1000)} : anchor) ?? 0};
  }, [source, compiled, readAnchor, base.fps, playerKey]);
  const initialFrame = initialPosition.frame;
  const frame = position.key === initialPosition.key ? position.frame : initialFrame, duration = manifest?.range.untilFrame ?? 0;
  const zoomLimit = maximumZoom(duration, base.fps), zoom = Math.min(requestedZoom, zoomLimit);
  useLayoutEffect(() => {
    const stage = container.current;
    if (!stage) return;
    const fit = () => {const width = Math.min(stage.clientWidth, stage.clientHeight * base.width / base.height); setMonitorSize({width, height: width * base.height / base.width});};
    fit(); const observer = new ResizeObserver(fit); observer.observe(stage);
    return () => observer.disconnect();
  }, [base.width, base.height]);
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
  const seek = useCallback((next: number) => {
    if (!manifest) return;
    const bounded = boundedFrame(next, duration);
    const cue = compiled.cues[cueIndexAt(compiled.timeline, bounded / base.fps * 1000)];
    const moment = cue?.momentId ? indexes.moments.get(cue.momentId) : undefined;
    if (moment) onAnchorChange({momentId: moment.id, offsetMs: (bounded - moment.startFrame) / base.fps * 1000});
    player.current?.seekTo(bounded); setPosition({key: playerKey, frame: bounded});
  }, [manifest, duration, compiled, indexes, base.fps, onAnchorChange, playerKey]);
  const scrollToFrame = useCallback((next: number, center = false) => {
    const box = viewport.current;
    if (!box) return;
    box.scrollLeft = (center ? centeredScroll : visibleScroll)(next, duration, box.scrollWidth, box.clientWidth, box.scrollLeft);
  }, [duration]);
  useLayoutEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const measured = () => {
      scrollToFrame(player.current?.getCurrentFrame() ?? initialFrame, true);
      setViewportState({left: box.scrollLeft, maximum: Math.max(0, box.scrollWidth - box.clientWidth)});
    };
    measured();
    const observer = new ResizeObserver(measured); observer.observe(box);
    return () => observer.disconnect();
  }, [zoom, initialFrame, playerKey, scrollToFrame]);
  useEffect(() => {
    const box = viewport.current;
    if (box && autoScroll && playing && !drag.current) box.scrollLeft = playbackScroll(frame, duration, box.scrollWidth, box.clientWidth, box.scrollLeft);
  }, [frame, duration, playing, autoScroll]);
  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || !manifest || drag.current) return;
      event.preventDefault();
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        setAutoScroll(false);
        box.scrollLeft = boundedScroll(box.scrollLeft + wheelPixels(event.shiftKey ? event.deltaY || event.deltaX : event.deltaX, event.deltaMode, box.clientWidth), box.scrollWidth, box.clientWidth);
      } else {
        const delta = wheelPixels(event.deltaY, event.deltaMode, box.clientWidth);
        setZoom(current => Math.max(1, Math.min(zoomLimit, Math.min(current, zoomLimit) * Math.exp(-delta * .003))));
      }
    };
    box.addEventListener("wheel", wheel, {passive: false});
    return () => box.removeEventListener("wheel", wheel);
  }, [manifest, zoomLimit]);
  useEffect(() => () => {
    if (dragAnimation.current !== null) cancelAnimationFrame(dragAnimation.current);
    const captured = drag.current;
    drag.current = null;
    if (captured?.element.hasPointerCapture(captured.pointer)) captured.element.releasePointerCapture(captured.pointer);
  }, [playerKey]);
  function canControl() {return !!manifest && !!player.current && !drag.current;}
  function seekMoment(id: string, at: "start" | "content" = "start") {
    if (!canControl()) return;
    const moment = indexes.moments.get(id);
    if (!moment) {setNotice("This moment is omitted from the selected cut. Switch to Source to seek it."); return;}
    const target = at === "content" ? moment.contentFrame : moment.startFrame;
    player.current?.pause(); seek(target); scrollToFrame(target, true); setNotice(null);
  }
  function pointerFrame(clientX: number) {const box = viewport.current; return box ? pixelFrame(box.scrollLeft + clientX - box.getBoundingClientRect().left, duration, box.scrollWidth) : 0;}
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!manifest || !event.isPrimary || event.button !== 0) return;
    drag.current = {pointer: event.pointerId, playing: player.current?.isPlaying() ?? false, clientX: event.clientX, element: event.currentTarget, tick: performance.now()};
    player.current?.pause(); player.current?.mute(); event.currentTarget.setPointerCapture(event.pointerId); seek(pointerFrame(event.clientX));
    const edgeTick = (now: number) => {
      const captured = drag.current, box = viewport.current;
      if (!captured || !box) return;
      const bounds = box.getBoundingClientRect(), speed = edgeScrollSpeed(captured.clientX, bounds.left, bounds.width), previous = box.scrollLeft;
      box.scrollLeft = boundedScroll(previous + speed * Math.min(50, now - captured.tick) / 1000, box.scrollWidth, box.clientWidth);
      captured.tick = now;
      if (box.scrollLeft !== previous) seek(pointerFrame(captured.clientX));
      dragAnimation.current = requestAnimationFrame(edgeTick);
    };
    dragAnimation.current = requestAnimationFrame(edgeTick);
  }
  function pointerFinish(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    if (drag.current?.pointer !== event.pointerId) return;
    const resume = drag.current.playing && !cancelled; drag.current = null;
    if (dragAnimation.current !== null) {cancelAnimationFrame(dragAnimation.current); dragAnimation.current = null;}
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!muted) player.current?.unmute();
    if (resume) player.current?.play();
  }
  function togglePlayback() {if (canControl()) player.current!.toggle();}
  function toggleMute() {if (drag.current) return; if (muted) player.current?.unmute(); else player.current?.mute(); onPlaybackChange({...playback,muted:!muted});}
  function stepFrame(next: number) {if (!canControl()) return; player.current!.pause(); seek(next); scrollToFrame(next);}
  function stepBy(delta: number) {if (canControl()) stepFrame(player.current!.getCurrentFrame() + delta);}
  function stepMoment(direction: -1 | 1) {if (!canControl()) return; const current = player.current!.getCurrentFrame(), cue = compiled.cues[cueIndexAt(compiled.timeline, current / base.fps * 1000)], at = cue?.momentId ? indexes.moments.get(cue.momentId)?.index ?? -1 : -1; const next = compiled.moments[at + direction]; if (next) seekMoment(next.id);}
  async function fullscreen() {try {if (document.fullscreenElement) await document.exitFullscreen(); else await container.current?.closest<HTMLElement>("[data-production-workspace]")?.requestFullscreen();} catch (error) {setNotice(`Fullscreen unavailable: ${error instanceof Error ? error.message : "Request failed"}`);}}
  function runShortcut(command: PreviewCommand) {
    if (!keyboardAvailable() || !canControl()) return false;
    switch (command) {
      case "play": togglePlayback(); break;
      case "previousFrame": stepBy(-1); break;
      case "nextFrame": stepBy(1); break;
      case "previousSecond": stepBy(-base.fps); break;
      case "nextSecond": stepBy(base.fps); break;
      case "start": stepFrame(0); break;
      case "end": stepFrame(duration-1); break;
      case "previousMoment": stepMoment(-1); break;
      case "nextMoment": stepMoment(1); break;
      case "mute": toggleMute(); break;
      case "fullscreen": void fullscreen(); break;
    }
    return true;
  }
  useImperativeHandle(ref, () => ({pauseAndRetainAnchor, seekMoment, runShortcut}));
  const monitor = <section className={styles.monitor} aria-label="Playable preview">
    <div className={styles.sectionHeading}><h2>{view === "source" ? "Source preview" : "Selected cut"}</h2><span>{base.width} × {base.height} / {base.fps} fps · Fit monitor</span><button {...studioShortcutProps("fullscreen",characterShortcuts)} onClick={() => void fullscreen()}>Fullscreen</button></div>
    <div ref={container} className={styles.monitorStage} role="group" tabIndex={0} aria-label="Preview keyboard controls" onPointerDown={event => {if (event.target instanceof Element && !event.target.closest("button,input,a")) event.currentTarget.focus({preventScroll:true});}}>
    <div className={styles.preview} style={{width: monitorSize.width, height: monitorSize.height}} data-preview-frame={frame} data-preview-moment={active?.id ?? "empty"}>
      {manifest ? <Player key={playerKey} ref={player} component={ReplayFrame} inputProps={{manifest, preview: true}} durationInFrames={duration} compositionWidth={base.width} compositionHeight={base.height} fps={base.fps} initialFrame={initialFrame} initiallyMuted={muted} initialVolume={volume} numberOfSharedAudioTags={0} controls={false} clickToPlay={false} spaceKeyToPlayOrPause={false} moveToBeginningWhenEnded={false} style={{width: "100%", height: "100%"}} errorFallback={({error}) => <div className={styles.empty} role="alert"><p>Preview failed: {error.message}</p><button onClick={() => {pauseAndRetainAnchor(); setRetry(value => value + 1); setNotice(null);}}>Retry intended frame</button></div>} /> : <div className={styles.empty}><h3>Empty cut</h3><p>{emptyLabel}</p><button onClick={() => {pauseAndRetainAnchor(); onViewChange("source");}}>Browse source</button></div>}
    </div></div><div className={styles.monitorCaption}><span>{activeCue?.label ?? "No playable moment"}</span><span>Pinned published visuals</span></div>
    </section>;
  const timelinePanel = <section className={styles.timelinePanel} aria-label="Timeline and playback">
    <div className={styles.transport} aria-label="Playback controls"><button {...studioShortcutProps("previousMoment",characterShortcuts)} disabled={!manifest} onClick={() => stepMoment(-1)} aria-label="Previous moment">Previous</button><button {...studioShortcutProps("previousFrame",characterShortcuts)} disabled={!manifest} onClick={() => stepBy(-1)} aria-label="Previous frame">−1</button><button {...studioShortcutProps("play",characterShortcuts)} className={styles.playButton} disabled={!manifest} onClick={togglePlayback}>{playing ? "Pause" : "Play"}</button><button {...studioShortcutProps("nextFrame",characterShortcuts)} disabled={!manifest} onClick={() => stepBy(1)} aria-label="Next frame">+1</button><button {...studioShortcutProps("nextMoment",characterShortcuts)} disabled={!manifest} onClick={() => stepMoment(1)} aria-label="Next moment">Next</button><output aria-label="Playhead">{time(frame, base.fps)} / {time(duration, base.fps)}</output><label className={styles.exactFrame}>Frame<input aria-label="Seek frame" type="number" min={0} max={Math.max(0, duration - 1)} value={frame} disabled={!manifest} onChange={event => stepFrame(Number(event.target.value))} /></label><button {...studioShortcutProps("mute",characterShortcuts)} aria-pressed={muted} onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button><label className={styles.volume}>Volume<input aria-label="Playback volume" type="range" min={0} max={1} step={.05} value={volume} onChange={event => {const next = Number(event.target.value); onPlaybackChange({...playback, volume: next}); player.current?.setVolume(next);}} /></label></div>
    <div className={styles.timelineHeader}><strong>{activeCue?.label ?? "No playable moment"}</strong><div className={styles.timelineTools}><label><input aria-label="Auto-scroll timeline" type="checkbox" checked={autoScroll} onChange={event => {setAutoScroll(event.target.checked); if (event.target.checked) scrollToFrame(player.current?.getCurrentFrame() ?? frame, true);}} />Auto-scroll</label><button disabled={!manifest} onClick={() => scrollToFrame(player.current?.getCurrentFrame() ?? frame, true)}>Recenter</button><button onClick={() => setZoom(1)}>Fit</button><label>Zoom<input aria-label="Timeline zoom" type="range" min={0} max={Math.log2(maximumZoom(duration, base.fps))} step={.05} value={Math.log2(zoom)} onChange={event => setZoom(2 ** Number(event.target.value))} /></label></div></div>
    <div ref={viewport} className={styles.timelineScroll} onScroll={event => {const box = event.currentTarget; setViewportState({left: box.scrollLeft, maximum: Math.max(0, box.scrollWidth - box.clientWidth)});}} onPointerDown={event => {if (event.target === event.currentTarget) setAutoScroll(false);}}><div ref={timeline} className={styles.timeline} style={{width: `${zoom * 100}%`}} role="slider" tabIndex={manifest ? 0 : -1} aria-label="Timeline playhead" aria-valuemin={0} aria-valuemax={Math.max(0, duration - 1)} aria-valuenow={Math.min(frame, Math.max(0, duration - 1))} onPointerDown={pointerDown} onPointerMove={event => {if (drag.current?.pointer === event.pointerId) {drag.current.clientX = event.clientX; seek(pointerFrame(event.clientX));}}} onPointerUp={event => pointerFinish(event, false)} onPointerCancel={event => pointerFinish(event, true)} onLostPointerCapture={event => pointerFinish(event, true)} onKeyDown={event => {if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(event.key)) {const binding = matchStudioShortcut(event.nativeEvent,false,event.key === "ArrowUp" ? "ArrowRight" : event.key === "ArrowDown" ? "ArrowLeft" : event.key); if (binding && runShortcut(binding.id as PreviewCommand)) event.preventDefault();}}}>
      {timelineMoments}
      {manifest && <div className={styles.playhead} style={{left: `${Math.min(frame, duration - 1) / duration * 100}%`}}><span /></div>}
    </div></div>
    <div className={styles.timelineFooter}><input className={styles.timelinePan} aria-label="Timeline horizontal position" type="range" min={0} max={viewportState.maximum} step={1} value={viewportState.left} disabled={!manifest || !viewportState.maximum} onChange={event => {setAutoScroll(false); if (viewport.current) viewport.current.scrollLeft = Number(event.target.value);}} /><button {...studioShortcutProps("help",characterShortcuts)} aria-label="Keyboard hints" onClick={onOpenHints}>⌨</button></div>
    <div className={styles.statusLine} role="status">{buffering ? "Buffering the intended frame…" : notice ?? "Drag to seek · Wheel to zoom · Shift+wheel to pan"}</div>
    </section>;
  return <div className={styles.previewLayout} data-production-preview data-preview-view={view} data-preview-revision={base.revision}>{renderLayout(monitor, timelinePanel)}</div>;
});
