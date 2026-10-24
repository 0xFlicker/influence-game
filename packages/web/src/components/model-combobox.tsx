"use client";

import { useCallback, useId, useRef, useState } from "react";
import {
  autoUpdate, flip, FloatingPortal, offset, shift, size,
  useDismiss, useFloating, useInteractions, useListNavigation, useMergeRefs, useRole,
} from "@floating-ui/react";
import styles from "./model-combobox.module.css";

export function ModelCombobox({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<Array<HTMLDivElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | undefined>();
  const selected = options.find(option => option.value === value);
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const matches = options.filter(option => words.every(word => normalize(`${option.label} ${option.value}`).includes(word)));
  const menuOpen = open && !disabled;

  const changeOpen = useCallback((next: boolean) => {
    if (next && disabled) return;
    if (next) {
      setPortalRoot(input.current?.closest<HTMLElement>("dialog")
        ?? (document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : undefined));
    }
    setOpen(next);
    setQuery("");
    setActiveIndex(null);
  }, [disabled]);
  const { refs: { setReference, setPositionReference, setFloating }, floatingStyles, context } = useFloating({
    open: menuOpen, onOpenChange: changeOpen, placement: "bottom-start", strategy: "fixed", whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 12 }), shift({ padding: 12 }), size({ padding: 12, apply({ rects, availableHeight, availableWidth, elements }) {
      Object.assign(elements.floating.style, {
        width: `${Math.min(rects.reference.width, availableWidth)}px`,
        maxHeight: `${Math.max(0, Math.min(320, availableHeight))}px`,
      });
    } })],
  });
  const referenceRef = useMergeRefs([input, setReference]);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "combobox" });
  const navigation = useListNavigation(context, {
    listRef: list, activeIndex, onNavigate: setActiveIndex,
    virtual: true, loop: false, enabled: !disabled,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([dismiss, role, navigation]);

  function select(next: string) {
    changeOpen(false);
    onChange(next);
  }

  return <div className={styles.field}>
    <label htmlFor={id} className={styles.label}>{label}</label>
    <div ref={setPositionReference} className={styles.control}>
      {/* eslint-disable-next-line react-hooks/refs -- Floating UI combines event callbacks; these read refs only during interaction. */}
      <input {...getReferenceProps({
        onFocus: () => changeOpen(true),
        onClick: () => { if (!menuOpen) changeOpen(true); },
        onInput: event => {
          setQuery((event.currentTarget as HTMLInputElement).value);
          setOpen(true);
          setActiveIndex(0);
        },
        onKeyDown: event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            if (!menuOpen) changeOpen(true);
            else if (activeIndex !== null && matches[activeIndex]) select(matches[activeIndex].value);
          }
          if (event.key === "Tab") changeOpen(false);
        },
      })} ref={referenceRef} id={id} disabled={disabled} value={menuOpen ? query : selected?.label ?? value}
        placeholder="Search models…" autoComplete="off" spellCheck={false} aria-autocomplete="list" className={styles.input} />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label={menuOpen ? "Close model choices" : "Open model choices"}
        className={styles.toggle} onMouseDown={event => event.preventDefault()}
        onClick={() => { const next = !menuOpen; if (next) input.current?.focus(); changeOpen(next); }}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
    {menuOpen && <FloatingPortal root={portalRoot}>
      <div {...getFloatingProps()} ref={setFloating} style={floatingStyles} aria-label={label} className={styles.menu}>
        {/* eslint-disable-next-line react-hooks/refs -- Callback refs populate Floating UI's navigation list after commit. */}
        {matches.map((option, index) => <div key={option.value} {...getItemProps({
          onMouseDown: event => event.preventDefault(),
          onClick: () => select(option.value),
        })} ref={element => { list.current[index] = element; }} role="option" aria-selected={option.value === value}
          id={`${id}-option-${index}`} data-active={activeIndex === index || undefined} className={styles.option}>
          <span className={styles.check} aria-hidden="true">{option.value === value ? "✓" : ""}</span>
          <span className={styles.name}>{option.label}{option.value !== "default" && <span className={styles.identifier}>{option.value}</span>}</span>
        </div>)}
        {matches.length === 0 && <div className={styles.empty} role="status">No matching models.</div>}
      </div>
    </FloatingPortal>}
  </div>;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[-_:./]+/g, " ").trim();
}
