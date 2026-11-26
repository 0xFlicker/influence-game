"use client";
import { AgentIssueNotice, agentIssue, useAgentIssue } from "./agent-issue";
import { OwnedCharacterImage } from "@/components/owned-character-image";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import {
  squarePortraitCrop,
  portraitHeadRectangle,
  type PortraitCrop,
  type CharacterHeadPosition,
  type HeadRectangle,
} from "@influence/engine/character-portrait";
import { apiFetch, resolveApiUrl } from "@/lib/api";

type Box = "portrait" | "head";
type Point = { x: number; y: number };
type ImageSize = { width: number; height: number };
type Gesture = { box: Box; start: HeadRectangle } & (
  | { kind: "drag"; pointerId: number; origin: Point; resize: boolean; latest: HeadRectangle }
  | { kind: "pinch"; distance: number }
);

function remainingPortraitSide(rect: HeadRectangle, size: ImageSize) {
  return Math.min(size.width - rect.x * size.width, size.height - rect.y * size.height);
}

function resizePortrait(rect: HeadRectangle, size: ImageSize, pixels: number) {
  const limit = remainingPortraitSide(rect, size);
  const side = Math.min(limit, Math.max(32, pixels));
  return { ...rect, width: side / size.width, height: side / size.height };
}

function touchDistance(points: Map<number, Point>) {
  const [first, second] = points.values();
  return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
}

/** Original image coordinates are the authority; the preview and exported pixels use the same rectangle. */
export function CharacterPortraitEditor({
  sourceUrl,
  initialCrop,
  initialHead,
  confirmHead = false,
  actionLabel = confirmHead ? "Confirm" : "Apply",
  fullScreen = false,
  name,
  onApply,
  onClose,
  onPendingChange,
  onFailure,
}: {
  sourceUrl: string;
  initialCrop?: PortraitCrop | null;
  initialHead?: CharacterHeadPosition | null;
  confirmHead?: boolean;
  actionLabel?: string;
  fullScreen?: boolean;
  name: string;
  onApply: (value: {
    avatarUrl: string;
    portraitCrop: PortraitCrop;
    headPosition: CharacterHeadPosition | null;
  }) => void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
  onFailure: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const overflowMaskId = useId();
  const epoch = useRef(0);
  const [size, setSize] = useState<ImageSize | null>(null);
  const [crop, setCrop] = useState<PortraitCrop | null>(null);
  const hasHeadPosition = initialHead?.sourceUrl === sourceUrl;
  const [head, setHead] = useState<HeadRectangle>(
    hasHeadPosition
      ? initialHead.rect
      : { x: 0.35, y: 0.04, width: 0.3, height: 0.16 },
  );
  const [activeBox, setActiveBox] = useState<Box>(
    confirmHead && !hasHeadPosition ? "head" : "portrait",
  );
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Map<number, Point>());
  const [busy, setBusy] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [sourceError, setSourceError] = useState(false);
  const imageUrl = resolveApiUrl(sourceUrl);
  const [error, setError] = useAgentIssue("portrait");
  useEffect(() => {
    const element = dialog.current;
    const mountedEpoch = ++epoch.current;
    element?.showModal();
    return () => {
      epoch.current = mountedEpoch + 1;
      element?.close();
    };
  }, []);
  function adjust(x: number, y: number, side: number) {
    if (size) setCrop(squarePortraitCrop(sourceUrl, size, x, y, side));
  }
  function updateBox(box: Box, rect: HeadRectangle) {
    if (box === "portrait") setCrop({ ...rect, sourceUrl });
    else setHead(rect);
  }
  function beginGesture(event: PointerEvent<HTMLDivElement>) {
    if (!crop || busy || event.button !== 0) return;
    const mode = (event.target as HTMLElement).dataset.boxDrag;
    const origin = { x: event.clientX, y: event.clientY };
    const start = activeBox === "portrait" ? crop : head;

    if (event.pointerType === "touch") {
      if (touches.current.size === 2) return;
      touches.current.set(event.pointerId, origin);
      if (touches.current.size === 2) {
        const distance = touchDistance(touches.current);
        const previous = gesture.current;
        gesture.current = distance > 0 ? {
          kind: "pinch",
          distance,
          box: activeBox,
          start: previous?.kind === "drag" && previous.box === activeBox ? previous.latest : start,
        } : null;
      }
    } else if (gesture.current || !mode) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (touches.current.size < 2 && mode) {
      gesture.current = {
        kind: "drag", pointerId: event.pointerId, origin,
        box: activeBox, start, latest: start, resize: mode === "resize",
      };
    }
  }
  function moveGesture(event: PointerEvent<HTMLDivElement>) {
    const point = { x: event.clientX, y: event.clientY };
    const trackedTouch = touches.current.has(event.pointerId);
    if (trackedTouch) touches.current.set(event.pointerId, point);
    const current = gesture.current;
    if (!current || !size || busy) return;
    const { start, box } = current;

    if (current.kind === "pinch") {
      if (!trackedTouch) return;
      const scale = touchDistance(touches.current) / current.distance;
      if (box === "portrait") {
        updateBox(box, resizePortrait(start, size, start.width * size.width * scale));
      } else {
        const limit = Math.min((1 - start.x) / start.width, (1 - start.y) / start.height);
        const minimum = Math.max(0.01 / start.width, 0.01 / start.height);
        const factor = Math.min(limit, Math.max(minimum, scale));
        updateBox(box, {
          ...start,
          width: Math.min(1 - start.x, start.width * factor),
          height: Math.min(1 - start.y, start.height * factor),
        });
      }
      return;
    }
    if (current.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = (point.x - current.origin.x) / bounds.width;
    const dy = (point.y - current.origin.y) / bounds.height;
    if (!current.resize) {
      current.latest = {
        ...start,
        x: Math.max(0, Math.min(1 - start.width, start.x + dx)),
        y: Math.max(0, Math.min(1 - start.height, start.y + dy)),
      };
    } else if (box === "portrait") {
      const pixels = start.width * size.width + (dx * size.width + dy * size.height) / 2;
      current.latest = resizePortrait(start, size, pixels);
    } else {
      current.latest = {
        ...start,
        width: Math.min(1 - start.x, Math.max(0.01, start.width + dx)),
        height: Math.min(1 - start.y, Math.max(0.01, start.height + dy)),
      };
    }
    updateBox(box, current.latest);
  }
  function endGesture(event: PointerEvent<HTMLDivElement>) {
    const removedTouch = touches.current.delete(event.pointerId);
    const current = gesture.current;
    if (current?.kind === "pinch" ? removedTouch : current?.pointerId === event.pointerId)
      gesture.current = null;
  }
  async function apply() {
    if (!crop || !size || sourceError || busy) return;
    const current = epoch.current;
    setBusy(true);
    setError(null);
    onPendingChange(true);
    try {
      const result = await apiFetch<{
        avatarUrl: string;
        portraitCrop: PortraitCrop;
        headPosition: CharacterHeadPosition | null;
      }>("/api/agent-profiles/portrait-crop", {
        method: "POST",
        body: JSON.stringify({
          ...crop,
          ...(confirmHead ? { headRectangle: head } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (current !== epoch.current) return;
      if (confirmHead && result.headPosition?.sourceUrl !== sourceUrl) {
        throw new Error("The portrait response did not confirm the selected artwork.");
      }
      onApply(result);
      onClose();
    } catch (cause) {
      if (current !== epoch.current) return;
      setError(cause);
      onFailure();
    } finally {
      if (current === epoch.current) {
        setBusy(false);
        onPendingChange(false);
      }
    }
  }
  const headFitsCrop =
    !confirmHead ||
    Boolean(
      crop &&
        portraitHeadRectangle(
          {
            sourceUrl,
            sourceHash: "",
            sourceWidth: size?.width ?? 0,
            sourceHeight: size?.height ?? 0,
            rect: head,
          },
          crop,
        ),
    );
  const side = size && crop ? crop.width * size.width : 0;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="portrait-editor-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      className={`influence-modal overflow-hidden border border-white/15 bg-[#11111b] p-0 text-white backdrop:bg-black/80 ${fullScreen ? "m-0 h-dvh max-h-dvh w-screen max-w-none rounded-none" : "m-0 h-dvh max-h-dvh w-screen max-w-none rounded-none sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[min(960px,100vw)] sm:rounded-2xl"}`}
    >
      <div className={`grid h-full max-h-dvh grid-rows-[auto_minmax(0,1fr)] ${fullScreen ? "" : "sm:h-auto sm:max-h-[90dvh]"}`}>
        <header className="border-b border-white/15 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="portrait-editor-title" className="text-xl font-semibold">
              {confirmHead ? "Headshot preview" : "Portrait preview"}
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="influence-button-secondary min-h-11 rounded-lg px-3 py-2"
              >
                Close
              </button>
              <button
                type="button"
                disabled={!crop || busy || !size || sourceError || !headFitsCrop}
                onClick={() => void apply()}
                className="influence-button-primary min-h-11 rounded-lg px-3 py-2 disabled:opacity-50"
              >
                {busy ? "Applying…" : actionLabel}
              </button>
            </div>
          </div>
          {sourceError ? (
            <AgentIssueNotice
              issue={agentIssue("image_load_failed", "portrait")}
              onAction={() => {
                setSourceError(false);
                setError(null);
                setImageAttempt((attempt) => attempt + 1);
              }}
            />
          ) : error ? (
            <AgentIssueNotice issue={error} onAction={() => void apply()} />
          ) : !size ? (
            <p role="status" className="text-sm text-white/65">
              Loading artwork…
            </p>
          ) : null}
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7 sm:pb-7">
          <p className="mt-3 text-sm text-white/55">
            {confirmHead && (hasHeadPosition
              ? "Check the gold head box and the violet portrait crop. "
              : "Automatic head detection couldn’t locate a head. Adjust the gold head box first. ")}
            Drag to move. Drag the corner or pinch to resize.
          </p>
          <div role="group" aria-label="Box to adjust" className="mt-3 flex gap-2">
            <button
              type="button"
              aria-pressed={activeBox === "portrait"}
              disabled={busy}
              onClick={() => setActiveBox("portrait")}
              className={`min-h-11 rounded-lg border px-4 text-sm ${activeBox === "portrait" ? "border-violet-300 bg-violet-400/20" : "border-white/15"}`}
            >
              Portrait
            </button>
            {confirmHead && (
              <button
                type="button"
                aria-pressed={activeBox === "head"}
                disabled={busy}
                onClick={() => setActiveBox("head")}
                className={`min-h-11 rounded-lg border px-4 text-sm ${activeBox === "head" ? "border-amber-300 bg-amber-400/20" : "border-white/15"}`}
              >
                Head
              </button>
            )}
          </div>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:grid-cols-[minmax(0,1fr)_260px] sm:gap-4">
            <div className="z-10 flex items-center justify-center self-start rounded-xl bg-[#11111b] p-2 sm:sticky sm:top-0">
              <div
                className="relative touch-none overflow-hidden"
                onPointerDown={beginGesture}
                onPointerMove={moveGesture}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
                onLostPointerCapture={endGesture}
              >
                <OwnedCharacterImage
                  key={imageAttempt}
                  draggable={false}
                  src={imageUrl}
                  alt={`${name} full image`}
                  className="max-h-[43dvh] w-auto max-w-full select-none object-contain sm:max-h-[55dvh]"
                  onError={() => {
                    setSourceError(true);
                    setSize(null);
                    setCrop(null);
                    gesture.current = null;
                    touches.current.clear();
                  }}
                  onLoad={(event) => {
                    const next = {
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    };
                    setSourceError(false);
                    setSize(next);
                    setCrop(
                      initialCrop?.sourceUrl === sourceUrl
                        ? initialCrop
                        : squarePortraitCrop(
                            sourceUrl,
                            next,
                            next.width * 0.3,
                            next.height * 0.03,
                            Math.min(next.width, next.height) * 0.4,
                          ),
                    );
                  }}
                />
                {crop && (
                  <div
                    data-box-drag="move"
                    aria-label="Portrait box; drag to move"
                    className={`${activeBox === "portrait" ? "z-20 touch-none cursor-move" : "pointer-events-none"} absolute border-2 border-violet-300 shadow-[0_0_0_999px_rgba(0,0,0,0.15)]`}
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                      height: `${crop.height * 100}%`,
                    }}
                  >
                    <span className="pointer-events-none bg-black/80 px-1 text-xs text-violet-200">
                      Portrait
                    </span>
                    {activeBox === "portrait" && (
                      <span
                        data-box-drag="resize"
                        aria-label="Resize portrait box"
                        className="absolute -bottom-5 -right-5 flex h-11 w-11 cursor-se-resize items-center justify-center"
                      >
                        <span className="pointer-events-none h-4 w-4 rounded-sm border border-black bg-violet-300" />
                      </span>
                    )}
                  </div>
                )}
                {confirmHead && crop && size && !headFitsCrop && (
                  <svg
                    role="img"
                    aria-label="Head outside portrait crop"
                    viewBox="0 0 1000 1000"
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute inset-0 z-30 h-full w-full"
                  >
                    <defs>
                      <mask
                        id={overflowMaskId}
                        maskUnits="userSpaceOnUse"
                        x="0"
                        y="0"
                        width="1000"
                        height="1000"
                      >
                        <rect width="1000" height="1000" fill="white" />
                        <rect
                          x={crop.x * 1000}
                          y={crop.y * 1000}
                          width={crop.width * 1000}
                          height={crop.height * 1000}
                          fill="black"
                        />
                      </mask>
                      <pattern
                        id={`${overflowMaskId}-stripes`}
                        width="24"
                        height="24"
                        patternUnits="userSpaceOnUse"
                        patternTransform="rotate(45)"
                      >
                        <rect
                          width="24"
                          height="24"
                          fill="#fbbf24"
                          fillOpacity=".24"
                        />
                        <rect
                          width="6"
                          height="24"
                          fill="#fbbf24"
                          fillOpacity=".65"
                        />
                      </pattern>
                    </defs>
                    <rect
                      x={head.x * 1000}
                      y={head.y * 1000}
                      width={head.width * 1000}
                      height={head.height * 1000}
                      fill={`url(#${overflowMaskId}-stripes)`}
                      mask={`url(#${overflowMaskId})`}
                    />
                  </svg>
                )}
                {confirmHead && size && crop && (
                  <>
                    <div
                      data-box-drag="move"
                      aria-label="Head box; drag to move"
                      className={`${activeBox === "head" ? "z-20 touch-none cursor-move" : "pointer-events-none"} absolute border-2 border-amber-300`}
                      style={{
                        left: `${head.x * 100}%`,
                        top: `${head.y * 100}%`,
                        width: `${head.width * 100}%`,
                        height: `${head.height * 100}%`,
                      }}
                    >
                    <span className="pointer-events-none absolute bottom-0 right-0 bg-black/80 px-1 text-xs text-amber-200">
                        Head
                      </span>
                      {activeBox === "head" && (
                        <span
                          data-box-drag="resize"
                          aria-label="Resize head box"
                          className="absolute -bottom-5 -right-5 flex h-11 w-11 cursor-se-resize items-center justify-center"
                        >
                          <span className="pointer-events-none h-4 w-4 rounded-sm border border-black bg-amber-300" />
                        </span>
                      )}
                    </div>
                  {activeBox === "head" && (
                    <div
                      aria-label="Speech placement preview"
                      className="pointer-events-none absolute left-[5%] w-[90%] rounded-xl border border-white/25 bg-black/85 px-3 py-2 text-center text-xs"
                      style={{
                        top: `${Math.min(88, (head.y + head.height) * 100 + 3)}%`,
                      }}
                    >
                      Hello, I’m {name || "your character"}.
                    </div>
                  )}
                  </>
                )}
              </div>
            </div>
            <div className="contents sm:block sm:space-y-3">
              <figure className="text-center">
                <div className="relative mx-auto aspect-square w-20 overflow-hidden rounded-full border border-white/15 bg-black/30">
                  {crop && (
                    <OwnedCharacterImage
                      alt={`${name} portrait preview`}
                      src={imageUrl}
                      className="absolute max-w-none"
                      style={{
                        width: `${100 / crop.width}%`,
                        height: `${100 / crop.height}%`,
                        left: `${(-100 * crop.x) / crop.width}%`,
                        top: `${(-100 * crop.y) / crop.height}%`,
                      }}
                    />
                  )}
                </div>
                <figcaption className="mt-1 text-xs text-white/65">Headshot</figcaption>
              </figure>
              <details hidden={!size} className="col-span-2">
                <summary className="min-h-11 cursor-pointer py-3 text-sm text-white/65">
                  Precise adjustments
                </summary>
                {confirmHead && activeBox === "head" && (
                  <fieldset disabled={busy} className="space-y-3">
                    <legend className="mb-2 text-sm font-medium text-amber-200">
                      Head position
                    </legend>
                    <p className="text-xs text-white/55">
                      {initialHead
                        ? "Review the detected or previously selected position."
                        : "No confirmed position yet. Move the suggested box around the entire head."}{" "}
                      Use these controls to adjust the head box precisely.
                    </p>
                    {(["x", "y", "width", "height"] as const).map((key) => (
                      <label key={key} className="block text-xs">
                        {
                          {
                            x: "Head horizontal position",
                            y: "Head vertical position",
                            width: "Head width",
                            height: "Head height",
                          }[key]
                        }
                        <input
                          type="range"
                          min={key === "x" || key === "y" ? 0 : 0.01}
                          max={
                            key === "x"
                              ? 1 - head.width
                              : key === "y"
                                ? 1 - head.height
                                : key === "width"
                                  ? 1 - head.x
                                  : 1 - head.y
                          }
                          step="0.001"
                          value={head[key]}
                          onInput={(event) =>
                            setHead({
                              ...head,
                              [key]: Number(event.currentTarget.value),
                            })
                          }
                          className="mt-1 w-full accent-amber-300"
                        />
                      </label>
                    ))}
                  </fieldset>
                )}
                {activeBox === "portrait" && size && crop && (
                  <>
                    <label className="block text-sm">
                      Horizontal position
                      <input
                        aria-label="Horizontal position"
                        type="range"
                        min="0"
                        max={Math.max(0, size.width - side)}
                        step="1"
                        value={crop.x * size.width}
                        onInput={(e) =>
                          adjust(
                            Number(e.currentTarget.value),
                            crop.y * size.height,
                            side,
                          )
                        }
                        disabled={busy}
                        className="mt-2 w-full accent-violet-400"
                      />
                    </label>
                    <label className="block text-sm">
                      Vertical position
                      <input
                        aria-label="Vertical position"
                        type="range"
                        min="0"
                        max={Math.max(0, size.height - side)}
                        step="1"
                        value={crop.y * size.height}
                        onInput={(e) =>
                          adjust(
                            crop.x * size.width,
                            Number(e.currentTarget.value),
                            side,
                          )
                        }
                        disabled={busy}
                        className="mt-2 w-full accent-violet-400"
                      />
                    </label>
                    <label className="block text-sm">
                      Frame size
                      <input
                        aria-label="Frame size"
                        type="range"
                        min={Math.min(32, remainingPortraitSide(crop, size))}
                        max={remainingPortraitSide(crop, size)}
                        step="1"
                        value={side}
                        onInput={(event) =>
                          updateBox("portrait", resizePortrait(crop, size, Number(event.currentTarget.value)))
                        }
                        disabled={busy}
                        className="mt-2 w-full accent-violet-400"
                      />
                    </label>
                  </>
                )}
              </details>
              <div
                hidden={!size}
                className="col-span-2 grid text-xs leading-5"
                aria-live="polite"
                aria-atomic="true"
              >
                <p
                  aria-hidden={!headFitsCrop}
                  className={`col-start-1 row-start-1 text-white/45 ${headFitsCrop ? "" : "invisible"}`}
                >
                  Include hair and a little shoulder room. Cropping costs no
                  generation allowance.
                </p>
                <p
                  aria-hidden={headFitsCrop}
                  className={`col-start-1 row-start-1 text-amber-200 ${headFitsCrop ? "invisible" : ""}`}
                >
                  The striped part of the head is outside the portrait. Move or
                  expand the violet crop to include it.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
