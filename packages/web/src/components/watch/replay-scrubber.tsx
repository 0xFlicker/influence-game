"use client";
import {useRef, useState} from "react";

/** A drag previews locally; only its final position may load another replay window. */
export function ReplayScrubber({frame, frameCount, fps, onSeek, onScrubStart, onScrubEnd}: {
  frame: number; frameCount: number; fps: number;
  onSeek: (position: number) => void | Promise<void>;
  onScrubStart?: () => void; onScrubEnd?: () => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<{value: number | null} | null>(null);
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
  return <input aria-label="Replay position" type="range" min={0} max={Math.max(0,frameCount - 1)} step={1} aria-valuetext={`${((preview ?? frame) / fps).toFixed(2)} seconds`}
    value={Math.min(Math.max(0,preview ?? frame),Math.max(0,frameCount - 1))} disabled={frameCount === 0}
    onPointerDown={event => {
      if (event.button !== 0) return;
      revision.current++;
      drag.current = {value:null};
      event.currentTarget.setPointerCapture(event.pointerId);
      onScrubStart?.();
    }}
    onPointerUp={() => finish()} onPointerCancel={() => finish(true)}
    onLostPointerCapture={() => finish()} onBlur={() => finish()}
    onInput={event => {
      const value = Number(event.currentTarget.value);
      if (drag.current) {drag.current.value = value; setPreview(value);}
      else void seek(value);
    }}
    onClick={event => event.stopPropagation()}
    className="mt-1 block h-4 w-full cursor-pointer touch-none accent-white disabled:cursor-default" />;
}
