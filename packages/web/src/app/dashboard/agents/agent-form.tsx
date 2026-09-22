"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";
import {
  apiFetch,
  AGENT_GENDER_OPTIONS,
  ApiError,
  generatePersonality,
  getDraftAgentAvatarGeneration,
  type AgentGender,
  type CharacterImageDraft,
  type AvatarCompletion,
  type AgentProfileWriteParams,
  type GeneratePersonalityParams,
  type PersonaKey,
  type SavedAgent,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { PERSONAS } from "@/lib/personas";
import { CharacterPortraitEditor } from "./character-portrait-editor";
import { AvatarUpload } from "@/components/avatar-upload";
import { isAvatarCompletionPending, isSameAvatarCompletion } from "./avatar-completion";
import { GrowingTextarea } from "./growing-textarea";
import { StrategyDiff } from "./strategy-diff";
import { readEditorStorage, removeEditorStorage, writeEditorStorage } from "./agent-editor-storage";

const DRAFT_VERSION = 3;
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000;

export interface StrategyComparison {
  baseline: string;
  initialWorking: string;
  baselineLabel: string;
  requireChange?: boolean;
}

interface AgentFormProps {
  initial?: SavedAgent;
  strategyComparison?: StrategyComparison;
  showLiveChanges?: boolean;
  draftScope: string;
  onSubmit: (params: AgentProfileWriteParams, context: { creationRequestId: string }) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

interface EditorSnapshot {
  visualDesign?: string | null;
  portraitCrop?: SavedAgent["portraitCrop"];
  name: string;
  backstory: string;
  personality: string;
  strategyStyle: string;
  performanceInstructions: string;
  fullBodyReferenceUrl: string | null;
  personaKey: PersonaKey | null;
  gender: AgentGender | "";
  explicitAvatarUrl?: string;
}

interface StoredEditorDraft {
  version: 3;
  baseContentRevisionId?: string | null;
  generationDeadline?: number | null;
  uploadPending?: boolean;
  unfinishedReplacement?: boolean;
  submission?: { id: string; fingerprint: string };
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
    && (left.visualDesign ?? null) === (right.visualDesign ?? null)
    && JSON.stringify(left.portraitCrop ?? null) === JSON.stringify(right.portraitCrop ?? null)
    && left.backstory === right.backstory
    && left.personality === right.personality
    && left.strategyStyle === right.strategyStyle
    && left.performanceInstructions === right.performanceInstructions
    && left.fullBodyReferenceUrl === right.fullBodyReferenceUrl
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
  showLiveChanges = false,
  draftScope,
  onSubmit,
  onCancel,
  submitLabel = "Save Agent",
}: AgentFormProps) {
  const { account } = useAuth();
  const isEditing = Boolean(initial);
  const showStrategyComparison = showLiveChanges && Boolean(strategyComparison);
  const initialStrategy = strategyComparison?.initialWorking ?? initial?.strategyStyle ?? "";
  const initialPersona = initial ? initial.personaKey : "strategic";
  const initialSnapshot = useMemo<EditorSnapshot>(() => ({
    visualDesign: initial?.visualDesign ?? null,
    portraitCrop: initial?.portraitCrop ?? null,
    name: initial?.name ?? "",
    backstory: initial?.backstory ?? "",
    personality: initial?.personality ?? "",
    strategyStyle: initialStrategy,
    performanceInstructions: initial?.performanceInstructions ?? "",
    fullBodyReferenceUrl: initial?.fullBodyReferenceUrl ?? null,
    personaKey: initialPersona,
    gender: initial?.gender ?? "",
    explicitAvatarUrl: initial?.avatarUrl ?? undefined,
  }), [initial, initialPersona, initialStrategy]);

  const [visualDesign, setVisualDesign] = useState(initialSnapshot.visualDesign);
  const [portraitCrop, setPortraitCrop] = useState(initialSnapshot.portraitCrop);
  const [name, setName] = useState(initialSnapshot.name);
  const [backstory, setBackstory] = useState(initialSnapshot.backstory);
  const [personality, setPersonality] = useState(initialSnapshot.personality);
  const [strategyStyle, setStrategyStyle] = useState(initialSnapshot.strategyStyle);
  const [performanceInstructions, setPerformanceInstructions] = useState(initialSnapshot.performanceInstructions);
  const [fullBodyReferenceUrl, setFullBodyReferenceUrl] = useState(initialSnapshot.fullBodyReferenceUrl);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const referenceRequest = useRef<{ requestId: string; name: string; personaKey: string; avatarUrl: string | null; fullBodyReferenceUrl: string | null; performanceInstructions: string; visualDesign: string } | null>(null);
  const [portraitEditorSource, setPortraitEditorSource] = useState<string | null>(null);
  const [personaKey, setPersonaKey] = useState<PersonaKey | null>(initialSnapshot.personaKey);
  const [gender, setGender] = useState<AgentGender | "">(initialSnapshot.gender);
  const [explicitAvatarUrl, setExplicitAvatarUrl] = useState<string | undefined>(initialSnapshot.explicitAvatarUrl);
  const [draftAvatarUrl, setDraftAvatarUrl] = useState<string | undefined>();
  const [draftAvatarCompletion, setDraftAvatarCompletion] = useState<AvatarCompletion | null>(null);
  const [baseContentRevisionId, setBaseContentRevisionId] = useState(initial?.contentRevisionId ?? null);
  const [creationRequestId, setCreationRequestId] = useState(createRequestId);
  const [profileGenerating, setProfileGenerating] = useState(false);
  const [portraitUploading, setUploading] = useState(false);
  const [fullBodyUploading, setFullBodyUploading] = useState(false);
  const uploading = portraitUploading || fullBodyUploading;
  const [submitting, setSubmitting] = useState(false);
  const [personaExpanded, setPersonaExpanded] = useState(false);
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
  const generationEpoch = useRef(0);
  const submission = useRef<{ id: string; fingerprint: string } | undefined>(undefined);
  const [generationDeadline, setGenerationDeadline] = useState<number | null>(null);
  const [unfinishedReplacement, setUnfinishedReplacement] = useState(false);
  const [confirmGenerationCancel, setConfirmGenerationCancel] = useState(false);
  const [confirmIncompleteSave, setConfirmIncompleteSave] = useState(false);
  const confirmationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!confirmGenerationCancel && !confirmIncompleteSave) return;
    const dialog = confirmationRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));
    buttons[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmGenerationCancel(false);
        setConfirmIncompleteSave(false);
      } else if (event.key === "Tab") {
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.shiftKey ? index <= 0 : index === buttons.length - 1) {
          event.preventDefault();
          buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [confirmGenerationCancel, confirmIncompleteSave]);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const generationBusy = profileGenerating || referenceBusy || Boolean(draftAvatarCompletion && isAvatarCompletionPending(draftAvatarCompletion));
  useEffect(() => () => { generationEpoch.current += 1; }, []);

  function beginGeneration() {
    const epoch = ++generationEpoch.current;
    setGenerationDeadline(Date.now() + GENERATION_TIMEOUT_MS);
    setGenerationNotice(null);
    return epoch;
  }

  const selectedPersona = PERSONAS.find((persona) => persona.key === personaKey);
  const previewPersona = personaKey ?? "strategic";
  const avatarUrl = explicitAvatarUrl ?? draftAvatarUrl;
  const portraitPending = draftAvatarCompletion
    ? isAvatarCompletionPending(draftAvatarCompletion)
    : false;
  const currentSnapshot: EditorSnapshot = useMemo(() => ({
    visualDesign,
    portraitCrop,
    name,
    backstory,
    personality,
    strategyStyle,
    performanceInstructions,
    fullBodyReferenceUrl,
    personaKey,
    gender,
    explicitAvatarUrl,
  }), [visualDesign, portraitCrop, backstory, explicitAvatarUrl, gender, name, personaKey, personality, strategyStyle, performanceInstructions, fullBodyReferenceUrl]);
  const dirty = !sameSnapshot(currentSnapshot, initialSnapshot);
  const draftStorageKey = account?.id
    ? `influence:agent-editor:${DRAFT_VERSION}:${account.id}:${draftScope}`
    : null;

  const interruptGeneration = useCallback((message: string) => {
    generationEpoch.current += 1;
    if (draftStorageKey) writeEditorStorage(`${draftStorageKey}:interrupted`, String(Date.now()));
    setGenerationDeadline(null);
    setProfileGenerating(false);
    setReferenceBusy(false);
    setDraftAvatarCompletion(null);
    setUnfinishedReplacement(true);
    setGenerationNotice(message);
  }, [draftStorageKey]);
  useEffect(() => {
    if (!generationDeadline) return;
    const timer = window.setTimeout(() => interruptGeneration("Generation timed out. Your selected assets and text are unchanged; late results will not be applied."), Math.max(0, generationDeadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [generationDeadline, interruptGeneration]);


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
    if (!dirty && !draftAvatarCompletion && !generationDeadline && !unfinishedReplacement && !uploading) {
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
        baseContentRevisionId,
        draftAvatarUrl,
        draftAvatarCompletion,
        generationDeadline,
        uploadPending: uploading,
        unfinishedReplacement,
        submission: submission.current,
      };
      if (writeEditorStorage(draftStorageKey, JSON.stringify(stored))) {
        setDraftPersisted(true);
        setDraftStorageError(null);
      } else {
        setDraftStorageError("This draft could not be stored locally. Save before leaving this page.");
      }
    }, 500);
  return () => window.clearTimeout(timeout);
  }, [baseContentRevisionId, generationDeadline, unfinishedReplacement, uploading, creationRequestId, currentSnapshot, dirty, draftAvatarCompletion, draftAvatarUrl, draftReady, draftStorageKey, initialSnapshot, pendingRestore]);

  useEffect(() => {
    const requestId = draftAvatarCompletion?.generationRequestId;
    if (!requestId || !portraitPending || portraitStatusUnavailable) return;

    let cancelled = false;
    const epoch = generationEpoch.current;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await getDraftAgentAvatarGeneration(requestId);
        if (cancelled || epoch !== generationEpoch.current) return;
        pollFailures.current = 0;
        setPortraitError(null);
        setPortraitStatusUnavailable(false);
        setDraftAvatarCompletion((current) => isSameAvatarCompletion(current, result.avatarCompletion)
          ? current
          : result.avatarCompletion);
        if (result.avatarCompletion.status === "completed" && result.avatarCompletion.avatarUrl) {
          setDraftAvatarUrl(result.avatarCompletion.avatarUrl);
          setGenerationDeadline(null);
          return;
        }
        if (!isAvatarCompletionPending(result.avatarCompletion)) {
          setGenerationDeadline(null);
          setUnfinishedReplacement(true);
          setPortraitError(result.avatarCompletion.reason ?? "Portrait generation did not complete.");
        }
        if (isAvatarCompletionPending(result.avatarCompletion)) {
          timer = window.setTimeout(() => void poll(), 2_500);
        }
      } catch (error) {
        if (cancelled || epoch !== generationEpoch.current) return;
        if (error instanceof ApiError && error.status === 404) {
          setDraftAvatarCompletion(null);
          setGenerationDeadline(null);
          setUnfinishedReplacement(true);
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

  function applyDraft() {
    if (!pendingRestore) return;
    setVisualDesign(pendingRestore.current.visualDesign ?? null);
    setPortraitCrop(pendingRestore.current.portraitCrop ?? null);
    setName(pendingRestore.current.name);
    setBackstory(pendingRestore.current.backstory);
    setPersonality(pendingRestore.current.personality);
    setStrategyStyle(pendingRestore.current.strategyStyle);
    setPerformanceInstructions(pendingRestore.current.performanceInstructions);
    setFullBodyReferenceUrl(pendingRestore.current.fullBodyReferenceUrl);
    setPersonaKey(pendingRestore.current.personaKey);
    setGender(pendingRestore.current.gender);
    setExplicitAvatarUrl(pendingRestore.current.explicitAvatarUrl);
    setCreationRequestId(pendingRestore.creationRequestId);
    setBaseContentRevisionId(pendingRestore.baseContentRevisionId ?? null);
    setDraftAvatarUrl(pendingRestore.draftAvatarUrl);
    const pending = Boolean(pendingRestore.generationDeadline);
    const interruption = draftStorageKey ? readEditorStorage(`${draftStorageKey}:interrupted`) : null;
    const interruptedAt = interruption?.ok ? Number(interruption.value) : 0;
    const canResume = pending && (pendingRestore.generationDeadline! - GENERATION_TIMEOUT_MS > interruptedAt) && pendingRestore.generationDeadline! > Date.now() && pendingRestore.draftAvatarCompletion && isAvatarCompletionPending(pendingRestore.draftAvatarCompletion);
    setDraftAvatarCompletion(canResume ? pendingRestore.draftAvatarCompletion! : null);
    setGenerationDeadline(canResume ? pendingRestore.generationDeadline! : null);
    setUnfinishedReplacement(Boolean(pendingRestore.unfinishedReplacement || pendingRestore.uploadPending || (pending && !canResume)));
    if (pendingRestore.uploadPending || (pending && !canResume)) setGenerationNotice("The previous preparation was interrupted. Its result will not be applied. Your draft is preserved.");
    submission.current = pendingRestore.submission;
    setPendingRestore(null);
    setDraftReady(true);
  }

  function clearStoredDraft() {
    if (draftStorageKey && !removeEditorStorage(draftStorageKey)) {
      setDraftStorageError("The local draft could not be cleared. Browser storage may be unavailable.");
      return;
    }
    setPendingRestore(null);
    setDraftReady(true);
  }

  async function handleGenerate() {
    const savedReference = draftStorageKey ? readEditorStorage(`${draftStorageKey}:visual-reference`) : null;
    if (referenceRequest.current || (savedReference?.ok && savedReference.value)) {
      setAiError("The previous image request is unfinished. Retry that reference request or save the current draft before starting a different character generation.");
      return;
    }
    const epoch = beginGeneration();
    setProfileGenerating(true);
    setAiError(null);
    try {
      const params: GeneratePersonalityParams = {};
      if (name.trim() || backstory.trim() || personality.trim() || strategyStyle.trim()
        || performanceInstructions.trim() || visualDesign?.trim() || avatarUrl || fullBodyReferenceUrl) {
        params.existingProfile = {
          name: name.trim() || undefined,
          backstory: backstory.trim() || undefined,
          personality: personality.trim() || undefined,
          strategyStyle: strategyStyle.trim() || undefined,
          ...(personaKey ? { personaKey } : {}),
          gender: gender || undefined,
          performanceInstructions,
          visualDesign: visualDesign ?? "",
          avatarUrl: avatarUrl ?? null,
          fullBodyReferenceUrl,
        };
      } else {
        params.archetype = personaKey ?? "strategic";
        params.gender = gender || undefined;
      }
      const result = await generatePersonality(params);
      if (epoch !== generationEpoch.current) return;
      setGenerationDeadline(null);
      setName(result.name);
      setBackstory(result.backstory ?? "");
      setPersonality(result.personality);
      setStrategyStyle(result.strategyStyle ?? "");
      setPersonaKey(result.personaKey);
      setGender(result.gender);
      setPerformanceInstructions(result.performanceInstructions);
      setVisualDesign(result.visualDesign);
      setProfileGenerating(false);

      await generateReference({ name: result.name, personaKey: result.personaKey, performanceInstructions: result.performanceInstructions, visualDesign: result.visualDesign });
    } catch (error) {
      if (epoch !== generationEpoch.current) return;
      setGenerationDeadline(null);
      setUnfinishedReplacement(true);
      setAiError(error instanceof Error ? error.message : "AI generation failed. Your existing text is unchanged.");
    } finally {
      if (epoch === generationEpoch.current) setProfileGenerating(false);
    }
  }

  function focusField(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (generationBusy || uploading || submitting) return;
    if (unfinishedReplacement) { setConfirmIncompleteSave(true); return; }
    await submitDraft();
  }

  async function submitDraft() {
    if (generationBusy || uploading || submitting) return;
    setConfirmIncompleteSave(false);
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
      const params: AgentProfileWriteParams = {
        name: name.trim(),
        personality: personality.trim(),
        backstory: backstory.trim(),
        strategyStyle: strategyStyle.trim(),
        performanceInstructions: performanceInstructions.trim(),
        fullBodyReferenceUrl,
        personaKey: personaKey ?? undefined,
        gender: gender as AgentGender,
        avatarUrl: avatarUrl,
        visualDesign,
        portraitCrop,
        expectedContentRevisionId: baseContentRevisionId,
      };
      const fingerprint = JSON.stringify(params);
      if (!submission.current || submission.current.fingerprint !== fingerprint) submission.current = { id: createRequestId(), fingerprint };
      saveLocalDraft();
      await onSubmit({ ...params, submissionId: submission.current.id }, { creationRequestId });
      if (draftStorageKey && !removeEditorStorage(draftStorageKey)) {
        setDraftStorageError("The saved Agent is safe, but its local recovery draft could not be cleared.");
      }
    } catch (error) {
      setSaveError(agentSaveErrorMessage(error));
      setSubmitting(false);
    }
  }

  function requestCancel() {
    if (dirty || draftAvatarCompletion || generationBusy || uploading) setConfirmDiscard(true);
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
    || generationBusy
    || referenceBusy
    || profileGenerating
    || uploading
    || requiredStrategyChangeMissing;

  async function generateReference(refined?: { name: string; personaKey: string; performanceInstructions: string; visualDesign: string }) {
    const epoch = beginGeneration();
    setReferenceBusy(true);
    setReferenceError(null);
    const referenceStorageKey = `${draftStorageKey}:visual-reference`;
    const saved = readEditorStorage(referenceStorageKey);
    if (saved.ok && saved.value && !referenceRequest.current) {
      try { referenceRequest.current = JSON.parse(saved.value); }
      catch { setReferenceError("Saved reference request is unreadable. Restore the draft before generating again."); setReferenceBusy(false); setGenerationDeadline(null); setUnfinishedReplacement(true); return; }
    }
    referenceRequest.current ??= { requestId: createRequestId(), name, personaKey: personaKey ?? "", avatarUrl: avatarUrl ?? null, fullBodyReferenceUrl, performanceInstructions, visualDesign: visualDesign ?? "", ...refined };
    if (!writeEditorStorage(referenceStorageKey, JSON.stringify(referenceRequest.current))) {
      setReferenceError("The reference request could not be saved. Enable session storage before generating."); setReferenceBusy(false); setGenerationDeadline(null); setUnfinishedReplacement(true); return;
    }
    try {
      const result = await apiFetch<CharacterImageDraft>("/api/agent-profiles/visual-reference", { method: "POST", body: JSON.stringify(referenceRequest.current) });
      if (epoch !== generationEpoch.current) return;
      setGenerationDeadline(null);
      setFullBodyReferenceUrl(result.fullBodyReferenceUrl);
      if (result.avatarUrl && result.portraitCrop) {
        setExplicitAvatarUrl(result.avatarUrl);
        setPortraitCrop(result.portraitCrop);
        setUnfinishedReplacement(false);
      } else {
        setUnfinishedReplacement(true);
        setReferenceError(result.cropWarning ?? "Choose a portrait crop to finish the character.");
      }
      removeEditorStorage(referenceStorageKey);
      referenceRequest.current = null;
    } catch (error) {
      if (epoch !== generationEpoch.current) return;
      setGenerationDeadline(null);
      setUnfinishedReplacement(true);
      setReferenceError(error instanceof Error ? error.message : "Reference generation failed");
    } finally { if (epoch === generationEpoch.current) setReferenceBusy(false); }
  }

  function saveLocalDraft() {
    if (!draftStorageKey) { setDraftStorageError("Sign in to save a draft in this tab."); return; }
    const stored: StoredEditorDraft = { version: DRAFT_VERSION, savedAt: new Date().toISOString(), base: initialSnapshot,
      current: currentSnapshot, creationRequestId, baseContentRevisionId, draftAvatarUrl, draftAvatarCompletion, generationDeadline, uploadPending: uploading, unfinishedReplacement, submission: submission.current };
    const saved = writeEditorStorage(draftStorageKey, JSON.stringify(stored));
    setDraftPersisted(saved);
    setDraftStorageError(saved ? null : "This draft could not be stored locally. Keep this tab open.");
  }

  return (
    <form onSubmit={handleSubmit} className="pb-28">
      {pendingRestore && (
        <section className="mb-6 rounded-xl border border-phase/30 bg-phase/10 p-4" aria-label="Saved local draft">
          <p className="text-sm font-semibold text-text-primary">
            {restoreConflict ? "A local draft was saved from an earlier Agent version." : "A local draft is available."}
          </p>
          <p className="mt-1 text-xs leading-5 text-white/55">
            Saved {new Date(pendingRestore.savedAt).toLocaleString()}. Apply it to the editor, or clear it to keep working from this version.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={applyDraft} className="influence-button-primary min-h-11 rounded-lg px-4 text-sm font-semibold">Apply draft</button>
            <button type="button" onClick={clearStoredDraft} className="influence-button-secondary min-h-11 rounded-lg px-4 text-sm">Clear draft</button>
          </div>
        </section>
      )}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-8 xl:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="influence-panel order-1 rounded-2xl p-5 sm:p-6 lg:order-none lg:sticky lg:top-24">
          <div className="flex flex-col items-center">
            <AvatarUpload onUploadError={() => setUnfinishedReplacement(true)} disabled={generationBusy || submitting} onEdit={() => setPortraitEditorSource(portraitCrop?.sourceUrl ?? fullBodyReferenceUrl ?? avatarUrl ?? null)} currentUrl={avatarUrl} persona={previewPersona} name={name || "Agent"} onUploaded={(url) => { setExplicitAvatarUrl(url); setPortraitCrop(null); }} onUploadingChange={setUploading} size="32" />
            {(portraitPending) && !explicitAvatarUrl && <p className="mt-2 text-center text-xs text-phase" aria-live="polite">Portrait generating in the background</p>}
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

            <div className="space-y-5">
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
                  Refines your profile, performance and look, then generates a full-body image and matching portrait. Changes stay in this draft.
                </p>
                <button type="button" onClick={() => void handleGenerate()} disabled={generationBusy || uploading || submitting} className="influence-button-primary mt-3 min-h-11 w-full rounded-lg px-4 text-sm font-semibold">{profileGenerating ? "Generating…" : hasProfileText ? "Refine with AI" : "Generate with AI"}</button>
                {aiError && <p role="alert" className="mt-2 text-xs leading-5 text-red-300">{aiError}</p>}
              </section>

              {portraitStatusUnavailable && <button type="button" onClick={() => { pollFailures.current = 0; setPortraitStatusUnavailable(false); }} className="influence-button-secondary min-h-11 w-full rounded-lg px-3 text-sm">Refresh portrait status</button>}
              {portraitError && <p role="status" className="text-xs leading-5 text-amber-200/80">{portraitError}</p>}
            </div>
          </div>
        </aside>

        <main className="contents min-w-0 lg:block lg:space-y-6">
          <section className="influence-panel order-2 rounded-2xl p-5 sm:p-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div><label htmlFor="agent-strategyStyle" className="text-lg font-semibold tracking-tight text-text-primary">Strategy</label><p id="agent-strategy-help" className="mt-1 max-w-2xl text-sm leading-6 text-white/50">How this Agent builds alliances, handles votes, protects itself, and changes course.</p></div>
              <span className="shrink-0 font-mono text-xs tabular-nums text-white/40">{strategyStyle.length}/{AGENT_PROFILE_LIMITS.strategyStyle}</span>
            </div>
            <div className={showStrategyComparison ? "grid items-start gap-4 xl:grid-cols-2 xl:items-stretch" : ""}>
              {showStrategyComparison && strategyComparison && <div className="order-2 min-w-0 xl:order-1"><StrategyDiff baseline={strategyComparison.baseline} working={strategyStyle} baselineLabel={strategyComparison.baselineLabel} className="xl:h-[40rem] xl:overflow-hidden" /></div>}
              <div className="order-1 xl:order-2">
                <GrowingTextarea id="agent-strategyStyle" value={strategyStyle} onChange={(event) => { setStrategyStyle(event.target.value); setValidationErrors((current) => ({ ...current, strategyStyle: "" })); }} placeholder="Describe concrete priorities, alliance tactics, voting plans, fallback moves, and when to pivot." maxLength={AGENT_PROFILE_LIMITS.strategyStyle} aria-invalid={Boolean(validationErrors.strategyStyle)} aria-describedby={validationErrors.strategyStyle ? "agent-strategy-error" : "agent-strategy-help"} className={`influence-field min-h-56 w-full rounded-xl px-4 py-4 text-base leading-7 lg:min-h-80 ${showStrategyComparison ? "xl:!h-[40rem] xl:!overflow-y-auto xl:resize-none" : ""}`} />
                {strategyComparison?.requireChange && (
                  <p className="mt-2 min-h-5 text-xs leading-5 text-white/45" aria-live="polite">
                    {requiredStrategyChangeMissing
                      ? "Edit the suggestion to save a custom Strategy update."
                      : "Custom Strategy change ready to save."}
                  </p>
                )}
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
          <section className="influence-panel order-5 rounded-2xl p-5 sm:p-6">
            <label htmlFor="agent-performance" className="text-base font-semibold text-text-primary">Character performance</label>
            <p id="agent-performance-help" className="mt-1 text-sm leading-6 text-white/45">How your character carries themselves: posture, gestures, mannerisms, movement and vocal delivery.</p>
            <GrowingTextarea id="agent-performance" value={performanceInstructions} onChange={(event) => setPerformanceInstructions(event.target.value)} maxLength={AGENT_PROFILE_LIMITS.performanceInstructions} aria-describedby="agent-performance-help" className="influence-field mt-4 min-h-36 w-full rounded-xl px-4 py-4 text-base leading-7" />
            <label htmlFor="agent-visual-design" className="mt-5 block text-base font-semibold text-text-primary">Visual design</label>
            <p className="mt-1 text-sm leading-6 text-white/45">Appearance, clothing and distinctive details shared by the portrait and full-body reference.</p>
            <GrowingTextarea id="agent-visual-design" value={visualDesign ?? ""} onChange={(event) => setVisualDesign(event.target.value)} maxLength={8000} className="influence-field mt-4 min-h-28 w-full rounded-xl px-4 py-4 text-base leading-7" />
            <div className="mt-5">
              <h3 className="mb-3 text-sm font-semibold text-text-primary">Full-body reference</h3>
              <button type="button" disabled={generationBusy || uploading || submitting || !name.trim()} onClick={() => void generateReference()} className="mb-3 rounded-lg border border-white/20 px-4 py-2 text-sm disabled:opacity-50">{referenceBusy ? "Generating reference…" : referenceRequest.current ? "Retry reference request" : "Generate full-body reference"}</button>
              {referenceError && <p role="alert" className="mb-3 text-sm text-red-300">{referenceError}</p>}
              <AvatarUpload onUploadError={() => setUnfinishedReplacement(true)} disabled={generationBusy || submitting} onEdit={() => setPortraitEditorSource(fullBodyReferenceUrl)} currentUrl={fullBodyReferenceUrl} persona={previewPersona} name={name} onUploaded={setFullBodyReferenceUrl} onUploadingChange={setFullBodyUploading} presentation="full-body" />
            </div>
          </section>
        </main>
      </div>

      {portraitEditorSource && <CharacterPortraitEditor sourceUrl={portraitEditorSource} initialCrop={portraitCrop} name={name} onClose={() => setPortraitEditorSource(null)} onPendingChange={setUploading} onFailure={() => setUnfinishedReplacement(true)} onApply={(result) => { setExplicitAvatarUrl(result.avatarUrl); setPortraitCrop(result.portraitCrop); setUnfinishedReplacement(false); setReferenceError(null); }} />}
      {(generationBusy || uploading) && <p role="status" className="mt-4 text-sm text-white/60">Preparation is in progress. Save draft keeps changes in this tab; it does not update your Agent.</p>}
      {generationNotice && <p role="status" className="mt-4 text-sm text-amber-200">{generationNotice}</p>}
      {saveError && <p role="alert" className="mt-6 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">{saveError}</p>}
      {draftStorageError && <p role="status" className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100/80">{draftStorageError}</p>}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="hidden min-w-0 text-xs text-white/40 sm:block">{uploading ? "Uploading image…" : profileGenerating ? "Generating profile text…" : generationBusy ? "Generation in progress. Save draft keeps changes in this tab; it does not update your Agent." : dirty ? draftPersisted ? "Local draft saved in this tab." : "Unsaved changes." : "No unsaved changes."}</div>
          <div className="ml-auto flex w-full flex-wrap gap-3 sm:w-auto"><button type="button" onClick={saveLocalDraft} className="influence-button-secondary min-h-11 rounded-lg px-4 text-sm">Save draft</button>{generationBusy && <button type="button" onClick={() => setConfirmGenerationCancel(true)} className="influence-button-secondary min-h-11 rounded-lg px-4 text-sm">Cancel generation</button>}<button type="button" onClick={requestCancel} className="influence-button-secondary min-h-11 flex-1 rounded-lg px-5 text-sm sm:flex-none">Cancel</button><button type="submit" disabled={submitDisabled} className="influence-button-primary min-h-11 flex-[1.35] rounded-lg px-6 text-sm font-semibold sm:flex-none">{submitting ? isEditing ? "Saving…" : "Creating…" : submitLabel}</button></div>
        </div>
      </div>

      {(confirmGenerationCancel || confirmIncompleteSave) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <section ref={confirmationRef} role="dialog" aria-modal="true" aria-labelledby="generation-confirm-title" className="influence-modal w-full max-w-md rounded-2xl p-6">
            <h2 id="generation-confirm-title" className="text-lg font-semibold">{confirmGenerationCancel ? "Cancel generation?" : "Save without the unfinished replacement?"}</h2>
            <p className="mt-2 text-sm leading-6 text-white/55">{confirmGenerationCancel ? "Its result will not be applied. An already dispatched request may still consume your allowance. Your selected assets and text will be kept." : "The replacement did not complete. This saves your current text and selected assets; any late result will not be attached."}</p>
            <div className="mt-5 flex gap-3"><button type="button" className="influence-button-secondary min-h-11 rounded-lg px-4" onClick={() => { setConfirmGenerationCancel(false); setConfirmIncompleteSave(false); }}>Keep editing</button><button type="button" className="influence-button-primary min-h-11 rounded-lg px-4" onClick={() => { if (confirmGenerationCancel) { interruptGeneration("Generation canceled. Late results will not be applied."); setConfirmGenerationCancel(false); } else void submitDraft(); }}>{confirmGenerationCancel ? "Cancel generation" : "Save selected assets"}</button></div>
          </section>
        </div>
      )}
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
