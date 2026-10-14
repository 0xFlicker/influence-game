"use client";

import { useCallback, useId, useRef, useState } from "react";
import {
  autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift, size,
  useClick, useDismiss, useFloating, useInteractions, useListNavigation, useMergeRefs, useRole,
} from "@floating-ui/react";
import styles from "./studio-select.module.css";

interface StudioSelectProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** DOM-positioned Studio select, including dialog top layers. */
export function StudioSelect({ label, value, options, onChange, disabled = false }: StudioSelectProps) {
  const labelId = useId(), valueId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | undefined>(undefined);
  const isDisabled = disabled || options.length === 0;
  const selectedIndex = options.findIndex(option => option.value === value);
  const menuOpen = open && !isDisabled;
  const onOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen && isDisabled) return;
    if (nextOpen) {
      const fullscreen = document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : undefined;
      setPortalRoot(trigger.current?.closest<HTMLElement>("dialog") ?? fullscreen);
    }
    else setActiveIndex(null);
    setOpen(nextOpen);
  }, [isDisabled]);
  const { refs: { setReference, setFloating }, floatingStyles, context } = useFloating({
    open: menuOpen, onOpenChange, placement: "bottom-start", strategy: "fixed", whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 12 }), shift({ padding: 12 }), size({ padding: 12, apply({ availableHeight, availableWidth, rects, elements }) {
      const width = Math.max(0, availableWidth);
      Object.assign(elements.floating.style, {
        maxHeight: `${Math.max(0, availableHeight)}px`, maxWidth: `${width}px`, minWidth: `${Math.min(rects.reference.width, width)}px`,
      });
    } })],
  });
  const referenceRef = useMergeRefs([trigger, setReference]);
  const click = useClick(context, { enabled: !isDisabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const navigation = useListNavigation(context, {
    listRef: list, activeIndex, selectedIndex: selectedIndex < 0 ? null : selectedIndex,
    onNavigate: setActiveIndex, focusItemOnOpen: true, loop: false, enabled: !isDisabled,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([click, dismiss, role, navigation]);

  return <div className={styles.field}>
    <span id={labelId} className={styles.label}>{label}</span>
    <button {...getReferenceProps({
      onKeyDown: event => { if (menuOpen && event.key === "Escape") event.preventDefault(); },
    })} ref={referenceRef} type="button" disabled={isDisabled} aria-labelledby={`${labelId} ${valueId}`} className={styles.trigger}>
      <span id={valueId} className={styles.value}>{options[selectedIndex]?.label ?? "Choose…"}</span>
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={styles.chevron}>
        <path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    {menuOpen && <FloatingPortal root={portalRoot}>
      <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus={trigger}>
        <div {...getFloatingProps({
          onKeyDown: event => { if (event.key === "Escape") event.preventDefault(); },
        })} ref={setFloating} style={floatingStyles} aria-labelledby={labelId} className={styles.menu}>
          {/* eslint-disable-next-line react-hooks/refs -- Callback refs populate Floating UI's navigation list after commit, not during render. */}
          {options.map((option, index) => <button key={option.value} {...getItemProps({
            onClick: () => { onChange(option.value); onOpenChange(false); },
          })} ref={element => { list.current[index] = element; }} type="button" role="option"
            aria-selected={value === option.value} tabIndex={activeIndex === index ? 0 : -1} data-active={activeIndex === index || undefined} className={styles.option}>
            <span className={styles.check} aria-hidden="true">{value === option.value ? "✓" : ""}</span>
            <span>{option.label}</span>
          </button>)}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>}
  </div>;
}
