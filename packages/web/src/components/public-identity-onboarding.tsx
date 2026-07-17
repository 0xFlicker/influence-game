"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  suggestProfileHandle,
  updateProfile,
  type AuthenticatedPublicIdentity,
} from "@/lib/api";
import { containedFocusTargetIndex } from "./standing-daily-agent-prompt-model";
import {
  applyAvailableIdentitySuggestion,
  applyIdentityCollision,
  changeIdentityDisplayName,
  changeIdentityHandle,
  completeIdentitySave,
  createIdentityFormState,
  markIdentitySaveFailed,
  markIdentitySaving,
} from "./public-identity-onboarding-model";

const FOCUSABLE_SELECTOR =
  "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function PublicIdentityOnboarding({
  identity,
  onSaved,
  onDismiss,
}: {
  identity: AuthenticatedPublicIdentity;
  onSaved: (identity: AuthenticatedPublicIdentity) => void;
  onDismiss: () => void;
}) {
  const [form, setForm] = useState(() => createIdentityFormState(identity));
  const dialogRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const canDismiss = identity.publicIdentityOnboarding.state === "deferrable";

  useEffect(() => {
    setForm(createIdentityFormState(identity));
  }, [identity]);

  const dismiss = useCallback(() => {
    if (canDismiss && form.status !== "saving") onDismiss();
  }, [canDismiss, form.status, onDismiss]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    focusableElements(dialog)[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (canDismiss) {
          event.preventDefault();
          dismiss();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableElements(dialog!);
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex = containedFocusTargetIndex(items.length, activeIndex, event.shiftKey);
      if (nextIndex !== null) {
        event.preventDefault();
        items[nextIndex]?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [canDismiss, dismiss]);

  async function refreshDerivedSuggestion() {
    if (form.handleDirty || form.displayName.trim().length === 0) return;
    try {
      const suggestion = await suggestProfileHandle(form.displayName);
      setForm((current) => applyAvailableIdentitySuggestion(current, suggestion));
    } catch {
      // The final atomic write remains authoritative. Advisory failure is silent.
    }
  }

  async function save() {
    if (form.status === "saving") return;
    setForm((current) => markIdentitySaving(current));
    try {
      const updated = await updateProfile(form.displayName, form.handle);
      setForm(completeIdentitySave({
        displayName: updated.displayName,
        handle: updated.handle ?? form.handle,
      }));
      onSaved(updated);
    } catch (error) {
      if (error instanceof ApiError && error.code === "HANDLE_TAKEN") {
        const suggestion = typeof error.payload?.suggestion === "string"
          ? error.payload.suggestion
          : null;
        setForm((current) => applyIdentityCollision(current, suggestion));
      } else {
        setForm((current) => markIdentitySaveFailed(
          current,
          error instanceof Error ? error.message : "Could not save your profile. Try again.",
        ));
      }
      requestAnimationFrame(() => handleRef.current?.focus());
    }
  }

  const handleChanged = identity.handle !== null
    && form.handle.trim().toLowerCase() !== identity.handle.toLowerCase();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="public-identity-title"
        className="influence-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-2xl"
      >
        <p className="influence-section-title">Your public profile</p>
        <h2 id="public-identity-title" className="mt-2 text-2xl font-bold text-text-primary">
          Choose how players know you
        </h2>
        <p className="influence-copy mt-2 text-sm leading-6">
          Your display name appears in Influence. Your unique handle becomes your shareable profile URL.
        </p>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="influence-section-title">Display name</span>
            <input
              autoFocus
              type="text"
              value={form.displayName}
              maxLength={50}
              autoComplete="nickname"
              onChange={(event) => {
                setForm((current) => changeIdentityDisplayName(current, event.target.value));
              }}
              onBlur={() => void refreshDerivedSuggestion()}
              className="influence-field mt-2 min-h-11 w-full rounded-lg px-4 py-2.5 text-sm"
              placeholder="Flick"
            />
          </label>

          <label className="block">
            <span className="influence-section-title">Handle</span>
            <div className="influence-field mt-2 flex min-h-11 items-center rounded-lg px-4">
              <span className="influence-copy-muted text-sm" aria-hidden="true">@</span>
              <input
                ref={handleRef}
                type="text"
                value={form.handle}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => {
                  setForm((current) => changeIdentityHandle(current, event.target.value));
                }}
                className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-text-primary outline-none"
                placeholder="flick"
              />
            </div>
            <span className="influence-copy-muted mt-1 block text-xs">
              Letters, numbers, and hyphens. Handles are unique.
            </span>
          </label>

          {handleChanged && (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              Changing your handle breaks links that use @{identity.handle}. Your public UUID link stays stable.
            </p>
          )}

          {form.error && (
            <p role="alert" className="text-sm text-red-400">
              {form.error}
              {form.collisionSuggestion && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="influence-link"
                    onClick={() => {
                      setForm((current) => changeIdentityHandle(current, form.collisionSuggestion!));
                    }}
                  >
                    Use @{form.collisionSuggestion}
                  </button>
                </>
              )}
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          {canDismiss && (
            <button
              type="button"
              disabled={form.status === "saving"}
              onClick={dismiss}
              className="influence-button-secondary min-h-11 rounded-lg px-5 py-2.5 text-sm"
            >
              Not now
            </button>
          )}
          <button
            type="button"
            disabled={
              form.status === "saving"
              || form.displayName.trim().length === 0
              || form.handle.trim().length === 0
            }
            onClick={() => void save()}
            className="influence-button-primary min-h-11 rounded-lg px-5 py-2.5 text-sm font-semibold"
          >
            {form.status === "saving" ? "Saving…" : "Create public profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
