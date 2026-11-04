"use client";

/* eslint-disable react-hooks/refs -- Floating UI exposes callback refs, not mutable render-time ref reads. */
import { FloatingPortal, autoUpdate, flip, offset, safePolygon, shift, useDismiss, useFloating, useFocus, useHover, useInteractions, type OpenChangeReason } from "@floating-ui/react";
import { useCallback, useId, useReducer } from "react";
import type { PublicAward } from "@/lib/championship";
import { SeasonZeroMark } from "./award-shelf";
import { createAgentAvatarPreviewState, isAgentAvatarPreviewOpen, reduceAgentAvatarPreviewState } from "./agent-avatar-preview-model";

/** Icon-only roster achievements. Hover/focus previews; tap/click pins; Escape/outside press dismisses. */
export function AwardIcons({ awards, agentName }: { awards: PublicAward[]; agentName: string }) {
  if (!awards.length) return null;
  return <ul aria-label={`${agentName} badges`} className="mt-2 flex flex-wrap gap-1">
    {awards.map(award => <li key={award.id}><AwardIcon award={award} agentName={agentName} /></li>)}
  </ul>;
}

function AwardIcon({ award, agentName }: { award: PublicAward; agentName: string }) {
  const [interaction, dispatch] = useReducer(reduceAgentAvatarPreviewState, undefined, createAgentAvatarPreviewState);
  const open = isAgentAvatarPreviewOpen(interaction), id = useId();
  const onOpenChange = useCallback((nextOpen: boolean, _event?: Event, reason?: OpenChangeReason) => {
    if (reason === "hover" || reason === "safe-polygon") dispatch({ type: "hover", active: nextOpen });
    else if (reason === "focus" || reason === "focus-out") dispatch({ type: "focus", active: nextOpen });
    else if (!nextOpen) dispatch({ type: "dismiss" });
  }, []);
  const { refs, floatingStyles, context } = useFloating({ open, onOpenChange, placement: "bottom-start", strategy: "fixed",
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })], whileElementsMounted: autoUpdate });
  const hover = useHover(context, { handleClose: safePolygon(), move: false, mouseOnly: true });
  const focus = useFocus(context), dismiss = useDismiss(context, { escapeKey: true, outsidePress: true });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss]);
  return <>
    <button ref={refs.setReference} type="button" aria-label={`${agentName}: ${award.title}`} aria-describedby={open ? id : undefined}
      {...getReferenceProps({ onClick: () => dispatch({ type: "toggle-pin" }) })}
      className="flex h-11 w-11 items-center justify-center rounded-lg outline-none hover:bg-amber-300/10 focus-visible:ring-2 focus-visible:ring-amber-200 [&_svg]:h-9 [&_svg]:w-8">
      {award.theme === "season-0" ? <SeasonZeroMark code={award.code} /> : <svg aria-hidden="true" viewBox="0 0 64 72" fill="none" className="text-amber-200"><path d="M32 3 58 16v29L32 68 6 45V16Z" stroke="currentColor" strokeWidth="2" /><path d="m32 17 5 12 13 1-10 9 3 13-11-7-11 7 3-13-10-9 13-1Z" stroke="currentColor" strokeWidth="2" /></svg>}
    </button>
    {open && <FloatingPortal><div ref={refs.setFloating} id={id} role="tooltip" style={floatingStyles} {...getFloatingProps()}
      className="influence-panel z-50 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl p-3 shadow-2xl">
      <p className="text-sm font-semibold text-text-primary">{award.title}</p>
      <p className="mt-1 text-xs influence-copy-muted">Awarded <time dateTime={award.awardedAt}>{new Date(award.awardedAt).toISOString().slice(0, 10)}</time></p>
    </div></FloatingPortal>}
  </>;
}
