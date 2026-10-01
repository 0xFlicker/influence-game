"use client";
import {useRef, useState, type ReactNode, type RefObject} from "react";
import {autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift, size, useDismiss, useFloating, useInteractions, useMergeRefs} from "@floating-ui/react";
const SPEED_OPTIONS = [{value: 0.5, label: "0.5×"}, {value: 1, label: "1×"}, {value: 2, label: "2×"}, {value: 4, label: "4×"}];
interface WatchTransportProps {
 fullscreen: boolean; fullscreenButton: RefObject<HTMLButtonElement | null>; toggleFullscreen: () => void | Promise<void>; fullscreenError: string | null;
 header?: ReactNode; isPlaying: boolean; togglePlay: () => void; speed: number; onSpeed: (speed: number) => void;
 goToBeginning: () => void; goToPrevScene: () => void; stepBackOneCue: () => void; advanceMessage: () => void; goToNextScene: () => void; goToEnd: () => void;
 settings?: ReactNode; live: boolean; cursor: number; count: number;
}
export function WatchTransport({fullscreen, fullscreenButton, toggleFullscreen, fullscreenError, header, isPlaying, togglePlay, speed, onSpeed, goToBeginning, goToPrevScene, stepBackOneCue, advanceMessage, goToNextScene, goToEnd, live, cursor, count, settings}: WatchTransportProps) {
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
 return <>
 <div className="relative flex justify-end gap-2">
 <button {...getReferenceProps()} ref={referenceRef} type="button" aria-label="Player settings" aria-expanded={open} onClick={event => {setPortalRoot(event.currentTarget.closest<HTMLElement>('[data-player-fullscreen="true"]') ?? undefined);setOpen(value => !value);}} className="mb-2 grid size-12 place-items-center rounded-lg text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 3 3-1 1-3 3-1 1-3-2-2 1-3-3-2-3 1-2-2Z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <button ref={fullscreenButton} type="button" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFullscreen()} className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
          <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
            <path d={fullscreen ? "M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6" : "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"} />
          </svg>
        </button>
        {open && <FloatingPortal root={portalRoot}>
        <FloatingFocusManager context={context} modal={false} returnFocus={settingsButton}>
        <div {...getFloatingProps()} onClick={event => event.stopPropagation()} ref={setFloating} tabIndex={-1} role="dialog" aria-label="Player settings" style={floatingStyles} className="z-[200] w-[min(22rem,85vw)] overflow-y-auto rounded-xl border border-white/25 bg-zinc-950 p-5 text-sm text-white shadow-2xl">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Player settings</h2><button aria-label="Close settings" onClick={() => {setOpen(false);settingsButton.current?.focus();}} className="px-2 text-white/70">✕</button></div>
          {settings}
          <h3 className="mb-3 mt-4 font-semibold">Keyboard shortcuts</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-white/80"><dt>Space</dt><dd>Play / pause</dd><dt>Click, Enter, →</dt><dd>Reveal / dismiss speech, then advance</dd><dt>←</dt><dd>Previous contribution</dd><dt>[ / ]</dt><dd>Previous / next group</dd><dt>1 / 2 / 3 / 4</dt><dd>0.5× / 1× / 2× / 4×</dd><dt>Escape</dt><dd>Close settings or fullscreen</dd></dl>
        </div></FloatingFocusManager></FloatingPortal>}
 </div>
        {fullscreenError && <p role="alert" className="text-xs text-amber-200">{fullscreenError}</p>}
        {!fullscreen && header}
        {/* Mobile: compact 2-row layout */}
        <div className="md:hidden flex flex-col gap-2 max-w-sm mx-auto">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label={isPlaying ? "Pause replay" : "Play replay"}
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="text-xs text-white/50 hover:text-white transition-colors px-3 py-2 rounded-lg border border-white/10 active:border-white/30"
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <div className="flex items-center gap-0.5">
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSpeed(opt.value);
                  }}
                  className={`text-[10px] px-1.5 py-1.5 rounded transition-colors ${
                    speed === opt.value
                      ? "bg-white/10 text-white border border-white/20"
                      : "text-white/25 border border-transparent"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-1.5">
              <button
                type="button"
                aria-label="Go to replay start"
                onClick={(e) => { e.stopPropagation(); goToBeginning(); }}
                disabled={cursor === 0}
                className="text-xs text-white/40 active:text-white transition-colors px-2.5 py-2 rounded-lg border border-white/10 disabled:opacity-20"
              >
                ⏮
              </button>
              <button
                type="button"
                aria-label="Previous room or scene"
                onClick={(e) => { e.stopPropagation(); goToPrevScene(); }}
                disabled={cursor === 0}
                className="text-xs text-white/40 active:text-white transition-colors px-2.5 py-2 rounded-lg border border-white/10 disabled:opacity-20"
              >
                ◀◀
              </button>
              <button
                type="button"
                aria-label="Previous dialogue step"
                title="Previous dialogue step (←)"
                onClick={(e) => { e.stopPropagation(); stepBackOneCue(); }}
                disabled={cursor === 0}
                className="text-sm text-white/50 active:text-white transition-colors size-9 rounded-lg border border-white/10 disabled:opacity-20"
              >
                ◀
              </button>
              <span className="text-[10px] text-white/20 px-1 min-w-[3rem] text-center">
                {cursor + 1}/{count}
              </span>
              <button
                type="button"
                aria-label="Next dialogue step"
                title="Next dialogue step (→)"
                onClick={(e) => { e.stopPropagation(); advanceMessage(); }}
                disabled={cursor >= count - 1}
                className="text-sm text-white/50 active:text-white transition-colors size-9 rounded-lg border border-white/10 disabled:opacity-20"
              >
                ▶
              </button>
              <button
                type="button"
                aria-label="Next scene"
                onClick={(e) => { e.stopPropagation(); goToNextScene(); }}
                disabled={cursor >= count - 1}
                className="text-xs text-white/40 active:text-white transition-colors px-2.5 py-2 rounded-lg border border-white/10 disabled:opacity-20"
              >
                ▶▶
              </button>
              <button
                type="button"
                aria-label="Go to replay end"
                onClick={(e) => { e.stopPropagation(); goToEnd(); }}
                className="text-xs text-white/40 active:text-white transition-colors px-2.5 py-2 rounded-lg border border-white/10"
              >
                ⏭
              </button>
            </div>
        </div>

        {/* Desktop: single-row layout */}
        <div className="hidden md:flex items-center justify-between max-w-3xl mx-auto">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="text-sm text-white/50 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20"
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Go to replay start"
              onClick={(e) => { e.stopPropagation(); goToBeginning(); }}
              disabled={cursor === 0}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              ⏮ Start
            </button>
            <button
              type="button"
              aria-label="Previous room or scene"
              onClick={(e) => { e.stopPropagation(); goToPrevScene(); }}
              disabled={cursor === 0}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              type="button"
              aria-label="Previous dialogue step"
              title="Previous dialogue step (←)"
              onClick={(e) => { e.stopPropagation(); stepBackOneCue(); }}
              disabled={cursor === 0}
              className="text-sm text-white/50 hover:text-white transition-colors size-9 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              ◀
            </button>
            <button
              type="button"
              aria-label="Next dialogue step"
              title="Next dialogue step (→)"
              onClick={(e) => { e.stopPropagation(); advanceMessage(); }}
              disabled={cursor >= count - 1}
              className="text-sm text-white/50 hover:text-white transition-colors size-9 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              ▶
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToNextScene(); }}
              disabled={cursor >= count - 1}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToEnd(); }}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20"
            >
              {live ? "Live ⏭" : "End ⏭"}
            </button>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-xs text-white/20 mr-1">Speed:</span>
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSpeed(opt.value);
                }}
                className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                  speed === opt.value
                    ? "bg-white/10 text-white border border-white/20"
                    : "text-white/30 hover:text-white/60 border border-transparent"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>


        </div>
        
</>; }
