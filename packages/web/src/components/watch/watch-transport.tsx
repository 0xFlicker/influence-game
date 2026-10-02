"use client";
import {ShareMoment} from "./share-moment";
import {useLayoutEffect, useRef, useState, type ReactNode, type RefObject} from "react";
import {autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift, size, useDismiss, useFloating, useInteractions, useMergeRefs} from "@floating-ui/react";
import type {ThinkingOrder} from "./watch-director";
const SPEED_OPTIONS = [{value: 0.5, label: "0.5×"}, {value: 1, label: "1×"}, {value: 2, label: "2×"}, {value: 4, label: "4×"}];
interface WatchTransportProps {
 fullscreen: boolean; fullscreenButton: RefObject<HTMLButtonElement | null>; toggleFullscreen: () => void | Promise<void>; fullscreenError: string | null;
 shareHref?: string; header?: ReactNode; settings?: ReactNode; isPlaying: boolean; togglePlay: () => void; speed: number; onSpeed: (speed: number) => void;
 goToBeginning: () => void; goToPrevScene: () => void; onSeek: (position: number) => void; goToNextScene: () => void; goToEnd: () => void;
 thinking?: {enabled: boolean; onChange: (enabled: boolean) => void; order: ThinkingOrder; onOrderChange: (order: ThinkingOrder) => void}; live: boolean; cursor: number; count: number;
}
export function WatchTransport({fullscreen, fullscreenButton, toggleFullscreen, fullscreenError, header, isPlaying, togglePlay, speed, onSpeed, goToBeginning, goToPrevScene, onSeek, goToNextScene, goToEnd, live, cursor, count, thinking, settings, shareHref}: WatchTransportProps) {
 const transport = useRef<HTMLDivElement>(null);
 const [width, setWidth] = useState(0);
 const capacity = width >= 1280 ? 3 : width >= 1020 ? 2 : width >= 780 ? 1 : 0;
 useLayoutEffect(() => {
  const element = transport.current;
  if (!element) return;
  const measure = () => setWidth(element.clientWidth);
  measure();
  const observer = new ResizeObserver(measure);observer.observe(element);
  return () => observer.disconnect();
 }, []);
 const [open, setOpen] = useState(false);
 const [portalRoot, setPortalRoot] = useState<HTMLElement | undefined>(undefined);
 const settingsButton = useRef<HTMLButtonElement>(null);
 const {refs:{setReference,setFloating}, floatingStyles, context} = useFloating({
  open, onOpenChange:setOpen, placement:"top-end", strategy:"fixed", whileElementsMounted:autoUpdate,
  middleware:[offset(8), flip({padding:12}), shift({padding:12}), size({padding:12, apply({availableHeight,elements}) {elements.floating.style.maxHeight = `${Math.max(0,availableHeight)}px`;}})],
 });
 const referenceRef = useMergeRefs([settingsButton, setReference]);
 const dismiss = useDismiss(context);
 const {getReferenceProps,getFloatingProps} = useInteractions([dismiss]);
 const button = "inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-25 disabled:cursor-not-allowed";
 const speedControl = <fieldset className="min-w-0"><legend className="sr-only">Playback speed</legend><div className="flex items-center gap-1"><span className="mr-1 text-xs text-white/50">Speed</span>{SPEED_OPTIONS.map(option =>
  <button key={option.value} type="button" aria-pressed={speed === option.value} onClick={() => onSpeed(option.value)} className={`h-9 rounded-lg border px-2 text-xs ${speed === option.value ? "border-white/50 bg-white/15 text-white" : "border-transparent text-white/60 hover:bg-white/10"}`}>{option.label}</button>
 )}</div></fieldset>;
 const thinkingControl = thinking && <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-white/80"><input type="checkbox" checked={thinking.enabled} onChange={event => thinking.onChange(event.target.checked)} />Show thinking</label>;
 const orderControl = thinking && <label className="flex items-center gap-2 whitespace-nowrap text-xs text-white/60">Order<select aria-label="Thinking order" className="h-9 rounded-lg border border-white/20 bg-zinc-900 px-2 text-white/80" value={thinking.order} onChange={event => thinking.onOrderChange(event.target.value as ThinkingOrder)}><option value="thinking-first">Thinking first</option><option value="speech-first">Speech first</option></select></label>;
 return <>
  <div ref={transport} data-watch-transport className="flex min-w-0 items-center gap-1" onClick={event => event.stopPropagation()}>
    <button type="button" aria-label={isPlaying ? "Pause replay" : "Play replay"} title={isPlaying ? "Pause (Space)" : "Play (Space)"} onClick={togglePlay} className={button}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">{isPlaying ? <path d="M6 4h4v16H6zm8 0h4v16h-4z" /> : <path d="m6 3 15 9-15 9z" />}</svg>
      <span className={width >= 520 ? "text-xs" : "hidden"}>{isPlaying ? "Pause" : "Play"}</span>
    </button>
    <button type="button" aria-label="Previous room or scene" title="Previous ([)" disabled={cursor === 0 || count === 0} onClick={goToPrevScene} className={button}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h3v16H4zm16 0L8 12l12 8z" /></svg><span className={width >= 520 ? "text-xs" : "hidden"}>Previous</span>
    </button>
    <button type="button" aria-label="Next scene" title="Next (])" disabled={cursor >= count - 1} onClick={goToNextScene} className={button}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17 4h3v16h-3zM4 4v16l12-8z" /></svg><span className={width >= 520 ? "text-xs" : "hidden"}>Next</span>
    </button>
    <span className="min-w-0 truncate px-1 text-[10px] tabular-nums text-white/50" aria-label="Replay position count">{count ? cursor + 1 : 0}/{count}</span>
    <div className="min-w-0 flex-1" />
    {capacity >= 1 && <div className="mr-3 shrink-0">{speedControl}</div>}
    {capacity >= 2 && <div className="mr-3 shrink-0">{thinkingControl}</div>}
    {capacity >= 3 && <div className="mr-3 shrink-0">{orderControl}</div>}
    {live && <button type="button" aria-label="Go live" title="Go live" onClick={goToEnd} className={`${button} text-[10px] uppercase tracking-wider`}><span className="size-1.5 rounded-full bg-red-400" aria-hidden="true" />Live</button>}
    <button {...getReferenceProps()} ref={referenceRef} type="button" aria-label="Player settings" title="Player settings" aria-expanded={open} onClick={event => {setPortalRoot(event.currentTarget.closest<HTMLElement>('[data-player-fullscreen="true"]') ?? undefined);setOpen(value => !value);}} className={button}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 3 3-1 1-3 3-1 1-3-2-2 1-3-3-2-3 1-2-2Z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
    <button ref={fullscreenButton} type="button" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFullscreen()} className={button}>
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square"><path d={fullscreen ? "M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6" : "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"} /></svg>
    </button>
  </div>
  <input aria-label="Replay position" type="range" min={1} max={Math.max(1,count)} value={Math.min(Math.max(1,cursor + 1),Math.max(1,count))} disabled={count === 0}
    onChange={event => onSeek(Number(event.target.value))} onClick={event => event.stopPropagation()} className="mt-1 block h-4 w-full cursor-pointer accent-white disabled:cursor-default" />
  {fullscreenError && <p role="alert" className="text-xs text-amber-200">{fullscreenError}</p>}
  {open && <FloatingPortal root={portalRoot}>
    <FloatingFocusManager context={context} modal={false} returnFocus={settingsButton}>
      <div {...getFloatingProps()} onClick={event => event.stopPropagation()} ref={setFloating} tabIndex={-1} role="dialog" aria-label="Player settings" style={floatingStyles} className="z-[200] w-[min(22rem,85vw)] overflow-y-auto rounded-xl border border-white/25 bg-zinc-950 p-5 text-sm text-white shadow-2xl">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Player settings</h2><button type="button" aria-label="Close settings" onClick={() => {setOpen(false);settingsButton.current?.focus();}} className="px-2 text-white/70">✕</button></div>
        {header}
        {shareHref && <div className="mb-4"><ShareMoment key={shareHref} href={shareHref} /></div>}
        {settings && <div className="mb-4 border-b border-white/10 pb-4" onClick={event => {if (event.target instanceof Element && event.target.closest("button")) setOpen(false);}}>{settings}</div>}
        <div className="space-y-4">
          {capacity < 1 && speedControl}
          {capacity < 2 && thinkingControl}
          {capacity < 3 && orderControl}
        </div>
        <div className="mt-4 flex gap-2 border-t border-white/10 pt-4"><button type="button" onClick={() => {goToBeginning();setOpen(false);}} className="rounded-lg border border-white/20 px-3 py-2">Restart replay</button><button type="button" onClick={() => {goToEnd();setOpen(false);}} className="rounded-lg border border-white/20 px-3 py-2">{live ? "Go live" : "Go to end"}</button></div>
        <h3 className="mb-3 mt-4 font-semibold">Keyboard shortcuts</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-white/80"><dt>Space</dt><dd>Play / pause</dd><dt>Click, Enter, →</dt><dd>Reveal / dismiss speech, then advance</dd><dt>←</dt><dd>Previous contribution</dd><dt>[ / ]</dt><dd>Previous / next group</dd><dt>1 / 2 / 3 / 4</dt><dd>0.5× / 1× / 2× / 4×</dd><dt>Escape</dt><dd>Close settings or fullscreen</dd></dl>
      </div>
    </FloatingFocusManager>
  </FloatingPortal>}
 </>;
}
