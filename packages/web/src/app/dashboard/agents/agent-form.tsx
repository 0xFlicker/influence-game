"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";
import {
  AGENT_GENDER_OPTIONS,
  ApiError,
  generatePersonality,
  getDraftAgentAvatarGeneration,
  requestDraftAgentAvatarGeneration,
  type AgentGender,
  type AvatarCompletion,
  type AgentProfileWriteParams,
  type GeneratePersonalityParams,
  type PersonaKey,
  type SavedAgent,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { PERSONAS } from "@/lib/personas";
import { AvatarUpload } from "@/components/avatar-upload";
import { isAvatarCompletionPending, isSameAvatarCompletion } from "./avatar-completion";
import { GrowingTextarea } from "./growing-textarea";
import { StrategyDiff } from "./strategy-diff";
import { readEditorStorage, removeEditorStorage, writeEditorStorage } from "./agent-editor-storage";

const DRAFT_VERSION = 1;

export interface StrategyComparison {
  baseline: string;
  initialWorking: string;
  baselineLabel: string;
  requireChange?: boolean;
}

interface AgentFormProps {
  initial?: SavedAgent;
  strategyComparison?: StrategyComparison;
  draftScope: string;
  onSubmit: (params: AgentProfileWriteParams, context: { creationRequestId: string }) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

interface EditorSnapshot {
  name: string;
  backstory: string;
  personality: string;
  strategyStyle: string;
  personaKey: PersonaKey | null;
  gender: AgentGender | "";
  explicitAvatarUrl?: string;
}

interface StoredEditorDraft {
  version: 1;
  savedAt: string;
  base: EditorSnapshot;
  current: EditorSnapshot;
  creationRequestId: string;
  draftAvatarUrl?: string;
  draftAvatarCompletion?: AvatarCompletion | null;
}

function createRequestId(): string {
  const browserCrypto = typeof globalThis.crypto === "undefined"
    ? undefined
    : globalThis.crypto as unknown as {
        randomUUID?: () => string;
        getRandomValues?: (values: Uint8Array) => Uint8Array;
      };
  if (browserCrypto?.randomUUID) return browserCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (browserCrypto?.getRandomValues) browserCrypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sameSnapshot(left: EditorSnapshot, right: EditorSnapshot): boolean {
  return left.name === right.name
    && left.backstory === right.backstory
    && left.personality === right.personality
    && left.strategyStyle === right.strategyStyle
    && left.personaKey === right.personaKey
    && left.gender === right.gender
    && left.explicitAvatarUrl === right.explicitAvatarUrl;
}

function normalizedStrategy(value: string): string {
  return value.trim();
}

function parseStoredDraft(value: string | null): StoredEditorDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredEditorDraft>;
    return parsed.version === DRAFT_VERSION
      && typeof parsed.savedAt === "string"
      && typeof parsed.creationRequestId === "string"
      && isUuid(parsed.creationRequestId)
      && parsed.base != null
      && parsed.current != null
      ? parsed as StoredEditorDraft
      : null;
  } catch {
    return null;
  }
}

export function AgentForm({
  initial,
  strategyComparison,
  draftScope,
  onSubmit,
  onCancel,
  submitLabel = "Save Agent",
}: AgentFormProps) {
  const { account } = useAuth();
  const isEditing = Boolean(initial);
  const initialStrategy = strategyComparison?.initialWorking ?? initial?.strategyStyle ?? "";
  const initialPersona = initial ? initial.personaKey : "strategic";
  const initialSnapshot = useMemo<EditorSnapshot>(() => ({
    name: initial?.name ?? "",
    backstory: initial?.backstory ?? "",
    personality: initial?.personality ?? "",
    strategyStyle: initialStrategy,
    personaKey: initialPersona,
    gender: initial?.gender ?? "",
    explicitAvatarUrl: initial?.avatarUrl ?? undefined,
  }), [initial, initialPersona, initialStrategy]);

  const [name, setName] = useState(initialSnapshot.name);
  const [backstory, setBackstory] = useState(initialSnapshot.backstory);
  const [personality, setPersonality] = useState(initialSnapshot.personality);
  const [strategyStyle, setStrategyStyle] = useState(initialSnapshot.strategyStyle);
  const [personaKey, setPersonaKey] = useState<PersonaKey | null>(initialSnapshot.personaKey);
  const [gender, setGender] = useState<AgentGender | "">(initialSnapshot.gender);
  const [explicitAvatarUrl, setExplicitAvatarUrl] = useState<string | undefined>(initialSnapshot.explicitAvatarUrl);
  const [draftAvatarUrl, setDraftAvatarUrl] = useState<string | undefined>();
  const [draftAvatarCompletion, setDraftAvatarCompletion] = useState<AvatarCompletion | null>(null);
  const [creationRequestId, setCreationRequestId] = useState(createRequestId);
  const [profileGenerating, setProfileGenerating] = useState(false);
  const [portraitStarting, setPortraitStarting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [personaExpanded, setPersonaExpanded] = useState(false);
  const [identityToolsExpanded, setIdentityToolsExpanded] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [portraitError, setPortraitError] = useState<string | null>(null);
  const [portraitStatusUnavailable, setPortraitStatusUnavailable] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<StoredEditorDraft | null>(null);
  const [restoreConflict, setRestoreConflict] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftPersisted, setDraftPersisted] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pollFailures = useRef(0);

  const selectedPersona = PERSONAS.find((persona) => persona.key === personaKey);
  const previewPersona = personaKey ?? "strategic";
  const avatarUrl = explicitAvatarUrl ?? draftAvatarUrl;
  const portraitPending = draftAvatarCompletion
    ? isAvatarCompletionPending(draftAvatarCompletion)
    : false;
  const boundPortraitPending = initial?.avatarCompletion
    ? isAvatarCompletionPending(initial.avatarCompletion)
    : false;
  const currentSnapshot: EditorSnapshot = useMemo(() => ({
    name,
    backstory,
    personality,
    strategyStyle,
    personaKey,
    gender,
    explicitAvatarUrl,
  }), [backstory, explicitAvatarUrl, gender, name, personaKey, personality, strategyStyle]);
  const dirty = !sameSnapshot(currentSnapshot, initialSnapshot);
  const draftStorageKey = account?.id
    ? `influence:agent-editor:${DRAFT_VERSION}:${account.id}:${draftScope}`
    : null;

  useEffect(() => {
    if (!draftStorageKey) return;
    const storedRead = readEditorStorage(draftStorageKey);
    if (!storedRead.ok) {
      setDraftStorageError("Local draft recovery is unavailable in this browser. You can still save the Agent normally.");
      setDraftReady(true);
      return;
    }
    const stored = parseStoredDraft(storedRead.value);
    if (!stored) {
      setDraftReady(true);
      return;
    }
    setPendingRestore(stored);
    setRestoreConflict(!sameSnapshot(stored.base, initialSnapshot));
  }, [draftStorageKey, initialSnapshot]);

  useEffect(() => {
    if (!draftStorageKey || !draftReady || pendingRestore) return;
    setDraftPersisted(false);
    if (!dirty && !draftAvatarCompletion) {
      if (!removeEditorStorage(draftStorageKey)) {
        setDraftStorageError("The old local draft could not be cleared. Saving the Agent still works.");
      }
      return;
    }
    const timeout = window.setTimeout(() => {
      const stored: StoredEditorDraft = {
        version: DRAFT_VERSION,
        savedAt: new Date().toISOString(),
        base: initialSnapshot,
        current: currentSnapshot,
        creationRequestId,
        draftAvatarUrl,
        draftAvatarCompletion,
      };
      if (writeEditorStorage(draftStorageKey, JSON.stringify(stored))) {
        setDraftPersisted(true);
        setDraftStorageError(null);
      } else {
        setDraftStorageError("This draft could not be stored locally. Save before leaving this page.");
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [creationRequestId, currentSnapshot, dirty, draftAvatarCompletion, draftAvatarUrl, draftReady, draftStorageKey, initialSnapshot, pendingRestore]);

  useEffect(() => {
    const requestId = draftAvatarCompletion?.generationRequestId;
    if (!requestId || !portraitPending || portraitStatusUnavailable) return;

    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await getDraftAgentAvatarGeneration(requestId);
        if (cancelled) return;
        pollFailures.current = 0;
        setPortraitError(null);
        setPortraitStatusUnavailable(false);
        setDraftAvatarCompletion((current) => isSameAvatarCompletion(current, result.avatarCompletion)
          ? current
          : result.avatarCompletion);
        if (result.avatarCompletion.status === "completed" && result.avatarCompletion.avatarUrl) {
          setDraftAvatarUrl(result.avatarCompletion.avatarUrl);
          return;
        }
        if (isAvatarCompletionPending(result.avatarCompletion)) {
          timer = window.setTimeout(() => void poll(), 2_500);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setDraftAvatarCompletion(null);
          setPortraitError("The saved portrait request is no longer available. Your text draft is safe.");
          return;
        }
        pollFailures.current += 1;
        if (pollFailures.current >= 3) {
          setPortraitStatusUnavailable(true);
          setPortraitError("Portrait status is temporarily unavailable. Generation may still finish in the background.");
          return;
        }
        timer = window.setTimeout(() => void poll(), 5_000 * pollFailures.current);
      }
    };

    timer = window.setTimeout(() => void poll(), 2_500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [draftAvatarCompletion?.generationRequestId, portraitPending, portraitStatusUnavailable]);

  function restoreDraft() {
    if (!pendingRestore) return;
    setName(pendingRestore.current.name);
    setBackstory(pendingRestore.current.backstory);
    setPersonality(pendingRestore.current.personality);
    setStrategyStyle(pendingRestore.current.strategyStyle);
    setPersonaKey(pendingRestore.current.personaKey);
    setGender(pendingRestore.current.gender);
    setExplicitAvatarUrl(pendingRestore.current.explicitAvatarUrl);
    setCreationRequestId(pendingRestore.creationRequestId);
    setDraftAvatarUrl(pendingRestore.draftAvatarUrl);
    setDraftAvatarCompletion(pendingRestore.draftAvatarCompletion ?? null);
    setPendingRestore(null);
    setDraftReady(true);
  }

  function discardStoredDraft() {
    if (draftStorageKey && !removeEditorStorage(draftStorageKey)) {
      setDraftStorageError("The local draft could not be cleared. Browser storage may be unavailable.");
      return;
    }
    setPendingRestore(null);
    setDraftReady(true);
  }

  async function startDraftPortrait(profile: Parameters<typeof requestDraftAgentAvatarGeneration>[0]) {
    setPortraitStarting(true);
    setPortraitError(null);
    setPortraitStatusUnavailable(false);
    pollFailures.current = 0;
    try {
      const draft = await requestDraftAgentAvatarGeneration(profile);
      setDraftAvatarCompletion(draft.avatarCompletion);
      if (draft.avatarCompletion.status === "completed" && draft.avatarCompletion.avatarUrl) {
        setDraftAvatarUrl(draft.avatarCompletion.avatarUrl);
      }
    } catch (error) {
      setPortraitError(error instanceof Error ? error.message : "Portrait generation could not be started.");
      setDraftAvatarCompletion({ status: "failed", retryable: true });
    } finally {
      setPortraitStarting(false);
    }
  }

  async function handleGenerate() {
    setProfileGenerating(true);
    setAiError(null);
    try {
      const params: GeneratePersonalityParams = {};
      if (name.trim() || backstory.trim() || personality.trim() || strategyStyle.trim()) {
        params.existingProfile = {
          name: name.trim() || undefined,
          backstory: backstory.trim() || undefined,
          personality: personality.trim() || undefined,
          strategyStyle: strategyStyle.trim() || undefined,
          ...(personaKey ? { personaKey } : {}),
          gender: gender || undefined,
        };
      } else {
        params.archetype = personaKey ?? "strategic";
        params.gender = gender || undefined;
      }
      const result = await generatePersonality(params);
      setName(result.name);
      setBackstory(result.backstory ?? "");
      setPersonality(result.personality);
      setStrategyStyle(result.strategyStyle ?? "");
      setPersonaKey(result.personaKey);
      setGender(result.gender);
      setProfileGenerating(false);

      if (!explicitAvatarUrl && !draftAvatarCompletion && !boundPortraitPending) {
        await startDraftPortrait({
          name: result.name,
          gender: result.gender,
          backstory: result.backstory ?? undefined,
          personality: result.personality,
          strategyStyle: result.strategyStyle ?? undefined,
          personaKey: result.personaKey,
        });
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI generation failed. Your existing text is unchanged.");
    } finally {
      setProfileGenerating(false);
    }
  }

  function focusField(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Agent name is required.";
    if (!personality.trim()) errors.personality = "Personality is required.";
    if (!gender) errors.gender = "Select a gender for this Agent.";
    if (strategyComparison?.requireChange
      && (normalizedStrategy(strategyStyle) === normalizedStrategy(strategyComparison.initialWorking)
        || normalizedStrategy(strategyStyle) === normalizedStrategy(strategyComparison.baseline))) {
      errors.strategyStyle = "Edit the suggested Strategy before saving this custom update.";
    }
    setValidationErrors(errors);
    const firstError = ["name", "gender", "strategyStyle", "personality"].find((field) => errors[field]);
    if (firstError) {
      focusField(firstError === "gender" ? "agent-gender-male" : `agent-${firstError}`);
      return;
    }

    setSubmitting(true);
    setSaveError(null);
    try {
      await onSubmit({
        name: name.trim(),
        personality: personality.trim(),
        backstory: backstory.trim(),
        strategyStyle: strategyStyle.trim(),
        personaKey: personaKey ?? undefined,
        gender: gender as AgentGender,
        avatarUrl: explicitAvatarUrl === initial?.avatarUrl ? undefined : explicitAvatarUrl,
        avatarGenerationRequestId: explicitAvatarUrl ? undefined : draftAvatarCompletion?.generationRequestId,
      }, { creationRequestId });
      if (draftStorageKey && !removeEditorStorage(draftStorageKey)) {
        setDraftStorageError("The saved Agent is safe, but its local recovery draft could not be cleared.");
      }
    } catch (error) {
      setSaveError(agentSaveErrorMessage(error));
      setSubmitting(false);
    }
  }

  function requestCancel() {
    if (dirty || draftAvatarCompletion) setConfirmDiscard(true);
    else onCancel();
  }

  function confirmCancel() {
    if (draftStorageKey && !removeEditorStorage(draftStorageKey)) {
      setDraftStorageError("The local draft could not be cleared. Browser storage may be unavailable.");
      setConfirmDiscard(false);
      return;
    }
    onCancel();
  }

  const hasProfileText = Boolean(name.trim() || backstory.trim() || personality.trim() || strategyStyle.trim());
  const requiredStrategyChangeMissing = Boolean(strategyComparison?.requireChange
    && (normalizedStrategy(strategyStyle) === normalizedStrategy(strategyComparison.initialWorking)
      || normalizedStrategy(strategyStyle) === normalizedStrategy(strategyComparison.baseline)));
  const submitDisabled = submitting
    || profileGenerating
    || portraitStarting
    || uploading
    || Boolean(pendingRestore)
    || requiredStrategyChangeMissing;

  return (
    <form onSubmit={handleSubmit} className="pb-28">
      {pendingRestore && (
        <section className="mb-6 rounded-xl border border-phase/30 bg-phase/10 p-4" aria-label="Saved local draft">
          <p className="text-sm font-semibold text-text-primary">
            {restoreConflict ? "A local draft was saved from an earlier Agent version." : "A local draft is available."}
          </p>
          <p className="mt-1 text-xs leading-5 text-white/55">
            Saved {new Date(pendingRestore.savedAt).toLocaleString()}. Restore it or keep the current saved version.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={restoreDraft} className="influence-button-primary min-h-11 rounded-lg px-4 text-sm font-semibold">Restore draft</button>
            <button type="button" onClick={discardStoredDraft} className="influence-button-secondary min-h-11 rounded-lg px-4 text-sm">Keep saved version</button>
          </div>
        </section>
      )}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.65fr)] lg:items-start lg:gap-8">
        <aside className="influence-panel order-2 rounded-2xl p-5 sm:p-6 lg:order-none lg:sticky lg:top-24">
          <div className="flex flex-col items-center">
            <AvatarUpload currentUrl={avatarUrl} persona={previewPersona} name={name || "Agent"} onUploaded={setExplicitAvatarUrl} onUploadingChange={setUploading} size="32" />
            {(portraitStarting || portraitPending || boundPortraitPending) && !explicitAvatarUrl && <p className="mt-2 text-center text-xs text-phase" aria-live="polite">Portrait generating in the background</p>}
            {draftAvatarCompletion?.status === "completed" && draftAvatarUrl && !explicitAvatarUrl && <p className="mt-2 text-center text-xs text-emerald-300" aria-live="polite">Portrait ready</p>}
          </div>

          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="agent-name" className="influence-section-title block mb-2">Agent name</label>
              <input id="agent-name" type="text" value={name} onChange={(event) => { setName(event.target.value); setValidationErrors((current) => ({ ...current, name: "" })); }} placeholder="e.g. ShadowPlay-7" maxLength={AGENT_PROFILE_LIMITS.name} aria-invalid={Boolean(validationErrors.name)} aria-describedby={validationErrors.name ? "agent-name-error" : "agent-name-help"} className="influence-field min-h-11 w-full rounded-lg px-4 py-2.5 text-base sm:text-sm" />
              <p id="agent-name-help" className="influence-copy-muted mt-1 text-xs">The public name used in games.</p>
              {validationErrors.name && <p id="agent-name-error" className="mt-1 text-xs text-red-300">{validationErrors.name}</p>}
            </div>

            <fieldset aria-required="true" aria-describedby={validationErrors.gender ? "agent-gender-error" : "agent-gender-help"}>
              <legend className="influence-section-title mb-2">Gender <span className="text-red-300" aria-hidden="true">*</span></legend>
              <div role="radiogroup" className="flex gap-2">
                {AGENT_GENDER_OPTIONS.map(({ value, label }) => (
                  <button id={`agent-gender-${value}`} key={value} type="button" role="radio" aria-checked={gender === value} data-selected={gender === value} onClick={() => { setGender(value); setValidationErrors((current) => ({ ...current, gender: "" })); }} className="influence-selection-card min-h-11 min-w-0 flex-[1_1_auto] whitespace-nowrap rounded-lg px-2 text-sm influence-copy data-[selected=true]:text-text-primary">{label}</button>
                ))}
              </div>
              <p id="agent-gender-help" className="influence-copy-muted mt-1 text-xs">Guides portrait generation.</p>
              {validationErrors.gender && <p id="agent-gender-error" className="mt-1 text-xs text-red-300">{validationErrors.gender}</p>}
            </fieldset>

            <button
              type="button"
              aria-expanded={identityToolsExpanded}
              onClick={() => setIdentityToolsExpanded((expanded) => !expanded)}
              className="influence-selection-card flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm text-text-primary lg:hidden"
            >
              <span>Persona &amp; AI tools</span>
              <span className="text-white/40" aria-hidden="true">{identityToolsExpanded ? "−" : "+"}</span>
            </button>

            <div className={`${identityToolsExpanded ? "space-y-5" : "hidden"} lg:block lg:space-y-5`}>
              <div>
                <p className="influence-section-title mb-2">Base persona</p>
                <button type="button" aria-expanded={personaExpanded} onClick={() => setPersonaExpanded((expanded) => !expanded)} className="influence-selection-card flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left">
                  <span className="flex min-w-0 items-center gap-2"><span aria-hidden="true">{selectedPersona?.icon ?? "○"}</span><span className="truncate text-sm font-medium text-text-primary">{selectedPersona?.name ?? "No base persona"}</span></span>
                  <span className="text-xs text-white/40">{personaExpanded ? "Close" : "Change"}</span>
                </button>
                {selectedPersona && <p className="mt-2 text-xs leading-5 text-white/45">{selectedPersona.description}</p>}
                {personaExpanded && (
                  <fieldset className="mt-3">
                    <legend className="sr-only">Choose a base persona</legend>
                    <div role="radiogroup" className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                      {PERSONAS.map((persona) => (
                        <button key={persona.key} type="button" role="radio" aria-checked={personaKey === persona.key} data-selected={personaKey === persona.key} onClick={() => { setPersonaKey(persona.key); setPersonaExpanded(false); }} className="influence-selection-card min-h-11 rounded-lg p-2 text-center text-xs influence-copy data-[selected=true]:text-text-primary"><span className="mr-1" aria-hidden="true">{persona.icon}</span>{persona.name}</button>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>

              <section className="rounded-xl border border-white/10 bg-black/15 p-4">
                <p className="text-sm font-semibold text-text-primary">AI profile help</p>
                <p className="mt-1 text-xs leading-5 text-white/45">
                  {explicitAvatarUrl
                    ? "Generate replaces the current profile text."
                    : "Generate replaces the current profile text and image."}
                </p>
                <button type="button" onClick={() => void handleGenerate()} disabled={profileGenerating} className="influence-button-primary mt-3 min-h-11 w-full rounded-lg px-4 text-sm font-semibold">{profileGenerating ? "Generating…" : hasProfileText ? "Refine with AI" : "Generate with AI"}</button>
                {aiError && <p role="alert" className="mt-2 text-xs leading-5 text-red-300">{aiError}</p>}
              </section>

              {!explicitAvatarUrl && draftAvatarCompletion && !portraitPending && draftAvatarCompletion.status !== "completed" && gender && name.trim() && personality.trim() && (
                <button type="button" onClick={() => void startDraftPortrait({ name: name.trim(), gender, backstory: backstory.trim() || undefined, personality: personality.trim(), strategyStyle: strategyStyle.trim() || undefined, personaKey: personaKey ?? "strategic" })} disabled={portraitStarting} className="influence-button-secondary min-h-11 w-full rounded-lg px-3 text-sm">Retry portrait</button>
              )}
              {portraitStatusUnavailable && <button type="button" onClick={() => { pollFailures.current = 0; setPortraitStatusUnavailable(false); }} className="influence-button-secondary min-h-11 w-full rounded-lg px-3 text-sm">Refresh portrait status</button>}
              {portraitError && <p role="status" className="text-xs leading-5 text-amber-200/80">{portraitError}</p>}
            </div>
          </div>
        </aside>

        <main className="contents min-w-0 lg:block lg:space-y-6">
          <section className="influence-panel order-1 rounded-2xl p-5 sm:p-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div><label htmlFor="agent-strategyStyle" className="text-lg font-semibold tracking-tight text-text-primary">Strategy</label><p id="agent-strategy-help" className="mt-1 max-w-2xl text-sm leading-6 text-white/50">How this Agent builds alliances, handles votes, protects itself, and changes course.</p></div>
              <span className="shrink-0 font-mono text-xs tabular-nums text-white/40">{strategyStyle.length}/{AGENT_PROFILE_LIMITS.strategyStyle}</span>
            </div>
            <div className={strategyComparison ? "grid items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" : ""}>
              {strategyComparison && <div className="order-2 xl:order-1"><StrategyDiff baseline={strategyComparison.baseline} working={strategyStyle} baselineLabel={strategyComparison.baselineLabel} /></div>}
              <div className="order-1 xl:order-2">
                <GrowingTextarea id="agent-strategyStyle" value={strategyStyle} onChange={(event) => { setStrategyStyle(event.target.value); setValidationErrors((current) => ({ ...current, strategyStyle: "" })); }} placeholder="Describe concrete priorities, alliance tactics, voting plans, fallback moves, and when to pivot." maxLength={AGENT_PROFILE_LIMITS.strategyStyle} aria-invalid={Boolean(validationErrors.strategyStyle)} aria-describedby={validationErrors.strategyStyle ? "agent-strategy-error" : "agent-strategy-help"} className="influence-field min-h-56 w-full rounded-xl px-4 py-4 text-base leading-7 lg:min-h-80" />
                {requiredStrategyChangeMissing && <p className="mt-2 text-xs leading-5 text-white/45">Edit the suggestion to save a custom Strategy update.</p>}
                {validationErrors.strategyStyle && <p id="agent-strategy-error" className="mt-2 text-sm text-red-300">{validationErrors.strategyStyle}</p>}
              </div>
            </div>
          </section>

          <section className="influence-panel order-3 rounded-2xl p-5 sm:p-6">
            <div className="flex items-end justify-between gap-4"><div><label htmlFor="agent-personality" className="text-base font-semibold text-text-primary">Personality</label><p id="agent-personality-help" className="mt-1 text-sm leading-6 text-white/45">How the Agent speaks, reacts, and behaves around other players.</p></div><span className="font-mono text-xs tabular-nums text-white/40">{personality.length}/{AGENT_PROFILE_LIMITS.personality}</span></div>
            <GrowingTextarea id="agent-personality" value={personality} onChange={(event) => { setPersonality(event.target.value); setValidationErrors((current) => ({ ...current, personality: "" })); }} placeholder="Describe how your Agent behaves, speaks, and makes decisions." maxLength={AGENT_PROFILE_LIMITS.personality} aria-invalid={Boolean(validationErrors.personality)} aria-describedby={validationErrors.personality ? "agent-personality-error" : "agent-personality-help"} className="influence-field mt-4 min-h-36 w-full rounded-xl px-4 py-4 text-base leading-7" />
            {validationErrors.personality && <p id="agent-personality-error" className="mt-2 text-sm text-red-300">{validationErrors.personality}</p>}
          </section>

          <section className="influence-panel order-4 rounded-2xl p-5 sm:p-6">
            <div className="flex items-end justify-between gap-4"><div><label htmlFor="agent-backstory" className="text-base font-semibold text-text-primary">Backstory <span className="text-sm font-normal text-white/35">optional</span></label><p id="agent-backstory-help" className="mt-1 text-sm leading-6 text-white/45">The history and motivation behind the Agent.</p></div><span className="font-mono text-xs tabular-nums text-white/40">{backstory.length}/{AGENT_PROFILE_LIMITS.backstory}</span></div>
            <GrowingTextarea id="agent-backstory" value={backstory} onChange={(event) => setBackstory(event.target.value)} placeholder="Where did this Agent come from, and what drives them?" maxLength={AGENT_PROFILE_LIMITS.backstory} aria-describedby="agent-backstory-help" className="influence-field mt-4 min-h-36 w-full rounded-xl px-4 py-4 text-base leading-7" />
          </section>
        </main>
      </div>

      {saveError && <p role="alert" className="mt-6 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">{saveError}</p>}
      {draftStorageError && <p role="status" className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100/80">{draftStorageError}</p>}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="hidden min-w-0 text-xs text-white/40 sm:block">{uploading ? "Uploading portrait…" : profileGenerating ? "Generating profile text…" : portraitPending ? "Portrait will finish after save." : dirty ? draftPersisted ? "Local draft saved in this tab." : "Unsaved changes." : "No unsaved changes."}</div>
          <div className="ml-auto flex w-full gap-3 sm:w-auto"><button type="button" onClick={requestCancel} className="influence-button-secondary min-h-11 flex-1 rounded-lg px-5 text-sm sm:flex-none">Cancel</button><button type="submit" disabled={submitDisabled} className="influence-button-primary min-h-11 flex-[1.35] rounded-lg px-6 text-sm font-semibold sm:flex-none">{submitting ? isEditing ? "Saving…" : "Creating…" : submitLabel}</button></div>
        </div>
      </div>

      {confirmDiscard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="discard-agent-title" className="influence-modal w-full max-w-md rounded-2xl p-6">
            <h2 id="discard-agent-title" className="text-lg font-semibold text-text-primary">Discard this draft?</h2>
            <p className="mt-2 text-sm leading-6 text-white/55">Your unsaved profile changes and any unattached portrait request will be removed from this tab.</p>
            <div className="mt-5 flex gap-3"><button type="button" onClick={() => setConfirmDiscard(false)} className="influence-button-secondary min-h-11 flex-1 rounded-lg px-4 text-sm">Keep editing</button><button type="button" onClick={confirmCancel} className="min-h-11 flex-1 rounded-lg border border-red-300/25 bg-red-400/10 px-4 text-sm font-semibold text-red-200 hover:bg-red-400/15">Discard</button></div>
          </section>
        </div>
      )}
    </form>
  );
}

function agentSaveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to save Agent.";
}
