"use client";
import {useEffect, useRef, type ReactNode} from "react";
import styles from "./workspace.module.css";

/** Focused Studio tools keep editing state in their mounted workspace owner. */
export function StudioDialog({title, onClose, sidebar, children}: {title: string; onClose: () => void; sidebar?: ReactNode; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null), body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = ref.current, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {dialog?.close(); previous?.focus();};
  }, []);
  useEffect(() => {body.current?.scrollTo({top:0}); ref.current?.querySelector('nav [aria-current="page"]')?.scrollIntoView({block:"nearest",inline:"nearest"});}, [title]);
  return <dialog ref={ref} className={`${styles.dialog} ${sidebar ? styles.settingsDialog : ""}`} aria-label={title} onCancel={event => {event.preventDefault(); onClose();}}>
    <header><h2>{title}</h2><button autoFocus aria-label="Close panel" onClick={onClose}>×</button></header>
    {sidebar ? <div className={styles.dialogLayout}>{sidebar}<div ref={body} className={styles.dialogBody}>{children}</div></div> : <div ref={body} className={styles.dialogBody}>{children}</div>}
  </dialog>;
}
