"use client";

import { useRef, useState } from "react";
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  useTypeahead,
} from "@floating-ui/react";
import { PERSONAS } from "@/lib/personas";
import type { PersonaKey } from "@/lib/api";
import styles from "./agent-workspace.module.css";

export function ArchetypePicker({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  value: PersonaKey | null;
  onChange: (value: PersonaKey) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | undefined>();
  const list = useRef<Array<HTMLElement | null>>([]);
  const names = useRef(PERSONAS.map((persona) => persona.name));
  const selectedIndex = PERSONAS.findIndex((persona) => persona.key === value);
  const selected = PERSONAS[selectedIndex];
  const { refs, floatingStyles, context } = useFloating({
    open: open && !disabled,
    onOpenChange(next) {
      if (next)
        setPortalRoot(
          refs.domReference.current?.closest<HTMLElement>("dialog") ??
            undefined,
        );
      setOpen(next);
    },
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ rects, availableHeight, availableWidth, elements }) {
          Object.assign(elements.floating.style, {
            width: `${Math.min(Math.max(280, rects.reference.width), availableWidth)}px`,
            maxHeight: `${Math.max(0, Math.min(360, availableHeight))}px`,
          });
        },
      }),
    ],
  });
  const { setReference, setFloating } = refs;
  const click = useClick(context, { enabled: !disabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const navigation = useListNavigation(context, {
    listRef: list,
    activeIndex,
    selectedIndex,
    onNavigate: setActiveIndex,
    loop: true,
  });
  const typeahead = useTypeahead(context, {
    listRef: names,
    activeIndex,
    selectedIndex,
    onMatch: setActiveIndex,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [click, dismiss, role, navigation, typeahead],
  );

  return (
    <div className={styles.archetype}>
      <label id={`${id}-label`} htmlFor={id}>
        Archetype
      </label>
      <button
        {...getReferenceProps()}
        type="button"
        id={id}
        ref={setReference}
        disabled={disabled}
        aria-labelledby={`${id}-label ${id}-value`}
        className={styles.archetypeTrigger}
      >
        <span id={`${id}-value`}>
          {selected && <span aria-hidden="true">{selected.icon} </span>}
          {selected?.name ?? "Choose an archetype"}
        </span>
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
        >
          <path
            d="m5 8 5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && !disabled && (
        <FloatingPortal root={portalRoot}>
          <FloatingFocusManager context={context} modal={false}>
            <div
              {...getFloatingProps()}
              ref={setFloating}
              style={floatingStyles}
              aria-labelledby={`${id}-label`}
              className={styles.archetypeMenu}
            >
              {PERSONAS.map((persona, index) => (
                <button
                  key={persona.key}
                  {...getItemProps({
                    onClick() {
                      onChange(persona.key);
                      setOpen(false);
                    },
                  })}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  tabIndex={index === activeIndex ? 0 : -1}
                  ref={(element) => {
                    list.current[index] = element;
                  }}
                >
                  <span aria-hidden="true">{persona.icon}</span>
                  <span>
                    <strong>{persona.name}</strong>
                    <small>{persona.description}</small>
                  </span>
                  <span aria-hidden="true">
                    {index === selectedIndex ? "✓" : ""}
                  </span>
                </button>
              ))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </div>
  );
}
