"use client";
import {useEffect, useRef, type ReactNode} from "react";
import styles from "./workspace.module.css";

/** Focused Studio tools keep editing state in their mounted workspace owner. */
export function StudioDialog({title, onClose, wide, children}: {title: string; onClose: () => void; wide?: boolean; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {dialog?.close(); previous?.focus();};
  }, []);
  return <dialog ref={ref} className={`${styles.dialog} ${wide ? styles.wideDialog : ""}`} aria-label={title} onCancel={onClose}>
    <header><h2>{title}</h2><button autoFocus aria-label="Close panel" onClick={onClose}>×</button></header>
    <div className={styles.dialogBody}>{children}</div>
    <footer><button onClick={onClose}>Done</button></footer>
  </dialog>;
}
