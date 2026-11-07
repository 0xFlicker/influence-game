"use client";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./agent-workspace.module.css";

/** Details open above the workspace without taking space from its editor. */
export function AgentWorkspacePanel({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
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
      ref={dialog}
      className={styles.workspacePanel}
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
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className={styles.panelBody}>{children}</div>
    </dialog>
  );
}
