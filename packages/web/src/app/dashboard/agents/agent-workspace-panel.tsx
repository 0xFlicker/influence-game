"use client";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { autoUpdate, flip, offset, shift, size, useFloating } from "@floating-ui/react";
import styles from "./agent-workspace.module.css";

/** Details open above the workspace without taking space from its editor. */
export function AgentWorkspacePanel({
  open,
  title,
  onClose,
  children,
  showCloseButton = true,
  className,
  anchor,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  showCloseButton?: boolean;
  className?: string;
  anchor?: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { refs, floatingStyles, isPositioned } = useFloating({
    open: open && !!anchor,
    elements: { reference: anchor },
    placement: "bottom-start",
    strategy: "fixed",
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12, crossAxis: true }), size({
      padding: 12,
      apply({ availableHeight, elements }) {
        elements.floating.style.maxHeight = `${Math.max(0, Math.min(700, availableHeight))}px`;
      },
    })],
  });
  const { setFloating } = refs;
  const setDialog = useCallback((element: HTMLDialogElement | null) => {
    dialog.current = element;
    setFloating(element);
  }, [setFloating]);
  useEffect(() => {
    if (!open) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={setDialog}
      style={anchor ? { ...floatingStyles, right: "auto", bottom: "auto", opacity: isPositioned ? 1 : 0 } : undefined}
      data-anchored={!!anchor || undefined}
      className={[styles.workspacePanel, className].filter(Boolean).join(" ")}
      data-workspace-panel
      aria-label={title}
      onCancel={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        {showCloseButton && (
          <button type="button" onClick={onClose}>
            Close
          </button>
        )}
      </header>
      <div className={styles.panelBody}>{children}</div>
    </dialog>
  );
}
