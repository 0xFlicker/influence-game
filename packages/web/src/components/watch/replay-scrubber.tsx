"use client";
import {useRef, useState} from "react";

/** A drag previews locally; only its final position may load another replay window. */
export function ReplayScrubber({frame, frameCount, fps, onSeek, onScrubStart, onScrubEnd}: {
  frame: number; frameCount: number; fps: number;
  onSeek: (position: number) => void | Promise<void>;
  onScrubStart?: () => void; onScrubEnd?: () => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<{value: number | null; left: number; width: number; touch: boolean} | null>(null);
  const revision = useRef(0);
  const seek = async (value: number) => {
    const request = ++revision.current;
    setPreview(value);
    try { await onSeek(value); }
    finally { if (revision.current === request) setPreview(null); }
  };
  const finish = (cancelled = false) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (!cancelled && current.value !== null) void seek(current.value);
    else setPreview(null);
    onScrubEnd?.();
  };
  const previewPointer = (clientX: number) => {
    const current = drag.current;
    if (!current || current.width <= 0) return;
    current.value = Math.round(Math.max(0, Math.min(1, (clientX-current.left)/current.width)) * Math.max(0,frameCount-1));
    setPreview(current.value);
  };
  return <input aria-label="Replay position" type="range" min={0} max={Math.max(0,frameCount - 1)} step={1} aria-valuetext={`${((preview ?? frame) / fps).toFixed(2)} seconds`}
    value={Math.min(Math.max(0,preview ?? frame),Math.max(0,frameCount - 1))} disabled={frameCount === 0}
    onPointerDown={event => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      // WebKit's native range track click does not consistently begin a drag.
      // Own pointer dragging; retain native keyboard and accessibility input.
      event.preventDefault();
      event.currentTarget.focus();
      revision.current++;
      const bounds = event.currentTarget.getBoundingClientRect();
      drag.current = {value:null, left:bounds.left, width:bounds.width, touch:false};
      event.currentTarget.setPointerCapture(event.pointerId);
      onScrubStart?.();
      previewPointer(event.clientX);
    }}
    onPointerMove={event => {if (!drag.current?.touch) previewPointer(event.clientX);}}
    onPointerUp={() => {if (!drag.current?.touch) finish();}}
    onPointerCancel={() => {if (!drag.current?.touch) finish(true);}}
    onLostPointerCapture={() => {if (!drag.current?.touch) finish();}} onBlur={() => finish()}
    // WebKit's native range recognizer cancels pointer events on touch. Keep
    // native touch input and commit its local preview at the touch boundary.
    onTouchStart={() => {
      revision.current++;
      drag.current = {value:null, left:0, width:0, touch:true};
      onScrubStart?.();
    }}
    onTouchEnd={() => finish()} onTouchCancel={() => finish(true)}
    onInput={event => {
      const value = Number(event.currentTarget.value);
      if (drag.current) {drag.current.value = value; setPreview(value);}
      else void seek(value);
    }}
    onClick={event => event.stopPropagation()}
    className="mt-1 block h-4 w-full cursor-pointer touch-none accent-white disabled:cursor-default" />;
}
