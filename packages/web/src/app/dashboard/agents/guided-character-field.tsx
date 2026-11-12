"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import {
  autoUpdate, flip, FloatingPortal, offset, safePolygon, shift, size,
  useDismiss, useFloating, useHover, useInteractions, useRole,
} from "@floating-ui/react";
import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";
import { PERSONAS } from "@/lib/personas";
import { ArchetypePicker } from "./archetype-picker";
import { AgentWorkspacePanel } from "./agent-workspace-panel";
import type { CharacterSection } from "./agent-creation-chat";
import styles from "./agent-workspace.module.css";

function Sparkle() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z" /></svg>;
}

/** Reading a fixture never queues an AI edit or changes the draft. */
export function GuidedCharacterField({
  section, label, value, onRefine, onApply, disabled, aiDisabled, selected, updating,
}: {
  section: CharacterSection;
  label: string;
  value: string;
  onRefine: () => void;
  onApply?: (value: string) => void;
  disabled: boolean;
  aiDisabled: boolean;
  selected: boolean;
  updating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState(value);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refineFrame = useRef<number | null>(null);
  const inputId = useId();
  const editable = Boolean(onApply) && (section === "name" || section === "personaKey");
  const text = section === "personaKey"
    ? PERSONAS.find(persona => persona.key === value)?.name ?? "No archetype selected."
    : value || "No details yet.";
  const { refs, floatingStyles, context } = useFloating({
    open: hovered && !open && !editable,
    onOpenChange: setHovered,
    placement: "bottom-start",
    strategy: "fixed",
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12, crossAxis: true }), size({
      padding: 12,
      apply({ availableHeight, elements }) {
        elements.floating.style.maxHeight = `${Math.max(0, Math.min(440, availableHeight))}px`;
      },
    })],
    whileElementsMounted: autoUpdate,
  });
  const { setReference, setFloating } = refs;
  const hover = useHover(context, {
    enabled: !open && !editable && !!value,
    delay: { open: 600, close: 150 },
    mouseOnly: true,
    move: false,
    handleClose: safePolygon(),
  });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss, role]);
  useEffect(() => {
    if (open && editable) (input.current ?? document.getElementById(inputId))?.focus({ preventScroll: true });
  }, [open, editable, inputId]);
  useEffect(() => () => {
    if (refineFrame.current !== null) window.cancelAnimationFrame(refineFrame.current);
  }, []);
  function show(event: MouseEvent<HTMLButtonElement>) {
    setAnchor(event.currentTarget.parentElement);
    setHovered(false);
    setDraft(value);
    setOpen(true);
  }
  function refine() {
    setOpen(false);
    setHovered(false);
    // The dialog restores its trigger first, then hand focus to the composer.
    refineFrame.current = window.requestAnimationFrame(() => {
      refineFrame.current = null;
      onRefine();
    });
  }
  const selectedPersona = PERSONAS.find(persona => persona.key === draft);
  const canApply = section === "name" ? !!draft.trim() : !!selectedPersona;
  function apply() {
    if (disabled || !canApply) return;
    onApply?.(draft.trim());
    setOpen(false);
  }
  return (
    <>
      <div className={styles.guidedField} ref={setReference} {...getReferenceProps()}>
        <button
          type="button"
          disabled={editable ? disabled : aiDisabled}
          onClick={editable ? show : onRefine}
          aria-label={`Revise ${label}`}
          aria-haspopup={editable ? "dialog" : undefined}
          aria-pressed={selected}
          data-updating={updating || undefined}
          aria-busy={updating}
          className={`agent-creation-fixture min-w-0 rounded-lg border p-2 text-left ${selected ? "border-amber-200/70 bg-amber-200/15" : "border-amber-200/20"}`}
        >
          <span className="block pr-9 text-[10px] uppercase tracking-wide text-white/45">{label}</span>
          <span className="agent-creation-fixture-copy mt-2 line-clamp-2 text-sm leading-5">{text}</span>
        </button>
        <button
          className={styles.guidedFieldArrow}
          type="button"
          disabled={editable && disabled}
          aria-label={editable ? `Edit ${label}` : `View full ${label}`}
          aria-haspopup="dialog"
          onClick={show}
        >
          <span aria-hidden="true">↗</span>
        </button>
      </div>
      {hovered && !open && !editable && (
        <FloatingPortal>
          <div ref={setFloating} style={floatingStyles} className={styles.guidedFieldPreview} {...getFloatingProps()}>
            <strong>{label}</strong>
            <p>{text}</p>
          </div>
        </FloatingPortal>
      )}
      <AgentWorkspacePanel
        open={open}
        title={label}
        onClose={() => setOpen(false)}
        showCloseButton={!editable}
        className={editable ? styles.guidedIdentityDialog : undefined}
        anchor={anchor}
      >
        {editable ? (
            <div className={styles.guidedIdentityBar}>
              <button type="button" aria-label="Cancel" onClick={() => setOpen(false)}><span aria-hidden="true">×</span></button>
              {section === "name" ? (
                <input ref={input} aria-label="Name" value={draft} maxLength={AGENT_PROFILE_LIMITS.name} disabled={disabled} onInput={event => setDraft(event.currentTarget.value)} autoComplete="off" onKeyDown={event => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    apply();
                  }
                }} />
              ) : (
                <ArchetypePicker id={inputId} value={selectedPersona?.key ?? null} onChange={setDraft} disabled={disabled} />
              )}
              <button type="button" className={styles.primary} disabled={disabled || !canApply} onClick={apply}>OK</button>
              <button type="button" aria-label={`Change ${label} with AI`} disabled={aiDisabled} onClick={refine}><Sparkle /></button>
            </div>
        ) : (
          <>
            <p className={styles.guidedFullText}>{text}</p>
            <div className={styles.guidedReadActions}>
              <button type="button" disabled={aiDisabled} onClick={refine}><Sparkle /> Refine</button>
            </div>
          </>
        )}
      </AgentWorkspacePanel>
    </>
  );
}
