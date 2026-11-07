"use client";
import { captureProductEvent } from "@/lib/product-analytics";
import { agentModelLabel } from "@/components/agent-model-label";
import { PLAYER_VOICES } from "@influence/engine/voice-catalog";
import { OwnedCharacterImage } from "@/components/owned-character-image";
import { AgentVoicePicker } from "./voice-audition-picker";

import { PERSONAS } from "@/lib/personas";
import { ModelPreferencePicker } from "@/components/model-preference-picker";
import type { ModelPreference } from "@influence/engine/game-model-routing";
import { defaultWerewolfStrategy } from "@influence/engine/werewolf/strategy";

import {
  characterEditFields,
  VISUAL_FIELDS,
  type CharacterEditCommand,
  type CharacterField,
} from "@influence/engine/agent-creation-assistant";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";
import type { AgentCreationTraitId } from "@influence/engine/agent-creation-traits";
import {
  apiFetch,
  AGENT_GENDER_OPTIONS,
  ApiError,
  generatePersonality,
  generateAnonymousCharacter,
  type AgentGender,
  type CharacterImageDraft,
  type AgentProfileWriteParams,
  type GeneratePersonalityParams,
  type GeneratePersonalityResult,
  type PersonaKey,
  type SavedAgent,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { CharacterPortraitEditor } from "./character-portrait-editor";
import { AgentImageControl } from "@/components/agent-image-control";
import { GrowingTextarea } from "./growing-textarea";
import { StrategyDiff } from "./strategy-diff";
import styles from "./agent-workspace.module.css";
import { AgentOperationActivity } from "./agent-operation-activity";
import { CharacterFormation } from "./character-formation";
import {
  AgentCreationChat,
  type CharacterSection,
  type CharacterConversation,
} from "./agent-creation-chat";
import {
  AGENT_EDITOR_DRAFT_VERSION,
  agentEditRequestKey,
  findAgentDrafts,
  isAgentEditorDraft,
  readEditorStorage,
  removeEditorStorage,
  writeEditorStorage,
} from "./agent-editor-storage";

const DRAFT_VERSION = AGENT_EDITOR_DRAFT_VERSION;
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000;

export interface StrategyComparison {
  field?: "strategyStyle" | "werewolfStrategyStyle";
  baseline: string;
  initialWorking: string;
  baselineLabel: string;
  requireChange?: boolean;
}

interface AgentFormProps {
  publicPreview?: boolean;
  guided?: boolean;
  onAdvanced?: () => void;
  onAssistant?: () => void;
  initial?: SavedAgent;
  profileRequest?: boolean;
  strategyComparison?: StrategyComparison;
  showLiveChanges?: boolean;
  draftScope: string;
  onSubmit: (
    params: AgentProfileWriteParams,
    context: { creationRequestId: string },
  ) => Promise<SavedAgent | void>;
  imageRequest?: string;
  onCancel: () => void;
  submitLabel?: string;
}

export interface EditorSnapshot {
  voiceId?: string | null;
  modelPreference?: ModelPreference;
  visualDesign?: string | null;
  portraitCrop?: SavedAgent["portraitCrop"];
  headPosition?: SavedAgent["headPosition"];
  headSuggestion?: SavedAgent["headPosition"];
  name: string;
  backstory: string;
  personality: string;
  strategyStyle: string;
  werewolfStrategyStyle: string;
  performanceInstructions: string;
  fullBodyReferenceUrl: string | null;
  personaKey: PersonaKey | null;
  gender: AgentGender | "";
  explicitAvatarUrl?: string;
}

interface StoredEditorDraft {
  guided?: boolean;
  conversation?: CharacterConversation;
  version: 4;
  baseContentRevisionId?: string | null;
  candidateImage?: CharacterImageDraft | null;
  referenceRequest?: Record<string, unknown> | null;
  generationDeadline?: number | null;
  uploadPending?: boolean;
  unfinishedReplacement?: boolean;
  submission?: { id: string; fingerprint: string };
  savedAt: string;
  base: EditorSnapshot;
  current: EditorSnapshot;
  creationRequestId: string;
}

const imageFields = [
  "fullBodyReferenceUrl",
  "explicitAvatarUrl",
  "portraitCrop",
  "headPosition",
  "headSuggestion",
] as const;
type DraftConflict = keyof EditorSnapshot | "images";
export function mergeAgentDraft(
  base: EditorSnapshot,
  local: EditorSnapshot,
  remote: EditorSnapshot,
) {
  const merged = { ...remote },
    conflicts: DraftConflict[] = [];
  const equal = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const key of Object.keys(local) as (keyof EditorSnapshot)[]) {
    if ((imageFields as readonly string[]).includes(key)) continue;
    if (equal(local[key], base[key])) continue;
    Object.assign(merged, { [key]: local[key] });
    if (!equal(remote[key], base[key]) && !equal(remote[key], local[key]))
      conflicts.push(key);
  }
  const images = (snapshot: EditorSnapshot) =>
    imageFields.map((key) => snapshot[key] ?? null);
  if (!equal(images(local), images(base))) {
    for (const key of imageFields) Object.assign(merged, { [key]: local[key] });
    if (
      !equal(images(remote), images(base)) &&
      !equal(images(remote), images(local))
    )
      conflicts.push("images");
  }
  return { merged, conflicts };
}

function canonicalDraft(draft: StoredEditorDraft): string {
  return JSON.stringify({ ...draft, savedAt: "" }, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : value,
  );
}

function createRequestId(): string {
  const browserCrypto =
    typeof globalThis.crypto === "undefined"
      ? undefined
      : (globalThis.crypto as unknown as {
          randomUUID?: () => string;
          getRandomValues?: (values: Uint8Array) => Uint8Array;
        });
  if (browserCrypto?.randomUUID) return browserCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (browserCrypto?.getRandomValues) browserCrypto.getRandomValues(bytes);
  else
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sameSnapshot(left: EditorSnapshot, right: EditorSnapshot): boolean {
  return (
    (left.voiceId ?? null) === (right.voiceId ?? null) &&
    JSON.stringify(left.modelPreference ?? "default") ===
      JSON.stringify(right.modelPreference ?? "default") &&
    left.name === right.name &&
    (left.visualDesign ?? null) === (right.visualDesign ?? null) &&
    JSON.stringify(left.headPosition ?? null) ===
      JSON.stringify(right.headPosition ?? null) &&
    JSON.stringify(left.headSuggestion ?? null) ===
      JSON.stringify(right.headSuggestion ?? null) &&
    JSON.stringify(left.portraitCrop ?? null) ===
      JSON.stringify(right.portraitCrop ?? null) &&
    left.backstory === right.backstory &&
    left.personality === right.personality &&
    left.strategyStyle === right.strategyStyle &&
    left.werewolfStrategyStyle === right.werewolfStrategyStyle &&
    left.performanceInstructions === right.performanceInstructions &&
    left.fullBodyReferenceUrl === right.fullBodyReferenceUrl &&
    left.personaKey === right.personaKey &&
    left.gender === right.gender &&
    left.explicitAvatarUrl === right.explicitAvatarUrl
  );
}

function normalizedStrategy(value: string): string {
  return value.trim();
}

function parseStoredDraft(value: string | null): StoredEditorDraft | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isAgentEditorDraft(parsed) ? (parsed as StoredEditorDraft) : null;
  } catch {
    return null;
  }
}

export function AgentForm({
  publicPreview = false,
  guided: initialGuided = false,
  onAdvanced,
  onAssistant,
  initial,
  profileRequest = false,
  strategyComparison,
  showLiveChanges = false,
  draftScope,
  onSubmit,
  onCancel,
  imageRequest,
}: AgentFormProps) {
  const [guided, setGuided] = useState(initialGuided);
  const [conversation, setConversation] = useState<CharacterConversation>();
  const [conversationKey, setConversationKey] = useState(0);
  const [advancedSection, setAdvancedSection] = useState<
    "character" | "strategy" | "appearance"
  >("character");
  const referenceEpoch = useRef(0);
  const reviewRef = useRef<HTMLElement>(null);
  const [guidedScope, setGuidedScope] = useState<
    CharacterSection | undefined
  >();
  const {
    account,
    ready: authReady,
    authenticated,
    openCreateAccount,
  } = useAuth();
  const anonymous = publicPreview && !authenticated;
  const [anonymousUsed, setAnonymousUsed] = useState(false);
  const [draftOwner, setDraftOwner] = useState<string | null>(
    account?.id ?? null,
  );
  const boundAccount = useRef(account?.id ?? null),
    activeAccount = useRef(account?.id ?? null);
  activeAccount.current = account?.id ?? null;
  if (authenticated && !boundAccount.current)
    boundAccount.current = account?.id ?? null;
  const recoveredAnonymousDraft = useRef(false);
  useEffect(() => {
    if (authReady && !draftOwner)
      setDraftOwner(account?.id ?? (publicPreview ? "anonymous" : null));
  }, [account?.id, authReady, draftOwner, publicPreview]);
  useEffect(() => {
    if (!anonymous || !authReady) return;
    let active = true;
    apiFetch<{ used: boolean }>("/api/agent-profiles/anonymous")
      .then((result) => {
        if (active) setAnonymousUsed(result.used);
      })
      .catch((error: unknown) => {
        console.error("[creator] Could not read preview allowance", error);
        // Admission is always checked by the POST, even if this status read fails.
      });
    return () => {
      active = false;
    };
  }, [anonymous, authReady]);
  const isEditing = Boolean(initial);
  const comparingWerewolf =
    strategyComparison?.field === "werewolfStrategyStyle";
  const showWerewolfComparison =
    showLiveChanges &&
    Boolean(strategyComparison?.requireChange) &&
    comparingWerewolf;
  const showStrategyComparison =
    showLiveChanges &&
    Boolean(strategyComparison?.requireChange) &&
    !comparingWerewolf;
  const initialStrategy =
    (!comparingWerewolf ? strategyComparison?.initialWorking : undefined) ??
    initial?.strategyStyle ??
    "";
  const initialWerewolfStrategy =
    (comparingWerewolf ? strategyComparison?.initialWorking : undefined) ??
    initial?.werewolfStrategyStyle ??
    "";
  const initialPersona = initial ? initial.personaKey : "strategic";
  const initialSnapshot = useMemo<EditorSnapshot>(
    () => ({
      voiceId: initial?.ownerContent?.voiceId ?? initial?.voiceId ?? null,
      modelPreference: initial?.modelPreference ?? "default",
      visualDesign: initial?.visualDesign ?? null,
      portraitCrop: initial?.portraitCrop ?? null,
      headPosition: initial?.headPosition ?? null,
      headSuggestion: null,
      name: initial?.name ?? "",
      backstory: initial?.backstory ?? "",
      personality: initial?.personality ?? "",
      strategyStyle: initialStrategy,
      werewolfStrategyStyle: initialWerewolfStrategy,
      performanceInstructions: initial?.performanceInstructions ?? "",
      fullBodyReferenceUrl: initial?.fullBodyReferenceUrl ?? null,
      personaKey: initialPersona,
      gender: initial?.gender ?? "",
      explicitAvatarUrl: initial?.avatarUrl ?? undefined,
    }),
    [initial, initialPersona, initialStrategy, initialWerewolfStrategy],
  );

  const [voiceId, setVoiceId] = useState<string | null>(
    initialSnapshot.voiceId ?? null,
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [referenceStage, setReferenceStage] = useState("image");
  const [referenceStartedAt, setReferenceStartedAt] = useState<string | null>(
    null,
  );
  const [candidateImage, setCandidateImage] =
    useState<CharacterImageDraft | null>(null);
  const [visualDesign, setVisualDesign] = useState(
    initialSnapshot.visualDesign,
  );
  const [headPosition, setHeadPosition] = useState(
    initialSnapshot.headPosition,
  );
  const [headSuggestion, setHeadSuggestion] = useState(
    initialSnapshot.headSuggestion,
  );
  const [portraitCrop, setPortraitCrop] = useState(
    initialSnapshot.portraitCrop,
  );
  const [name, setName] = useState(initialSnapshot.name);
  const [backstory, setBackstory] = useState(initialSnapshot.backstory);
  const [personality, setPersonality] = useState(initialSnapshot.personality);
  const [modelPreference, setModelPreference] = useState<ModelPreference>(
    initialSnapshot.modelPreference ?? "default",
  );
  const [strategyStyle, setStrategyStyle] = useState(
    initialSnapshot.strategyStyle,
  );
  const [werewolfStrategyStyle, setWerewolfStrategyStyle] = useState(
    initialSnapshot.werewolfStrategyStyle,
  );
  const [performanceInstructions, setPerformanceInstructions] = useState(
    initialSnapshot.performanceInstructions,
  );
  const [fullBodyReferenceUrl, setFullBodyReferenceUrl] = useState(
    initialSnapshot.fullBodyReferenceUrl,
  );
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const referenceRequest = useRef<{
    agentId?: string;
    draftScope: string;
    operation: "create" | "edit";
    requestId: string;
    uploadSource?: string;
    name: string;
    personaKey: string;
    avatarUrl: string | null;
    fullBodyReferenceUrl: string | null;
    performanceInstructions: string;
    visualDesign: string;
  } | null>(null);
  const [portraitEditorSource, setPortraitEditorSource] = useState<
    string | null
  >(null);
  const [personaKey, setPersonaKey] = useState<PersonaKey | null>(
    initialSnapshot.personaKey,
  );
  const [gender, setGender] = useState<AgentGender | "">(
    initialSnapshot.gender,
  );
  const [explicitAvatarUrl, setExplicitAvatarUrl] = useState<
    string | undefined
  >(initialSnapshot.explicitAvatarUrl);
  const [baseContentRevisionId, setBaseContentRevisionId] = useState(
    initial?.latestContentRevisionId ?? initial?.contentRevisionId ?? null,
  );
  const [creationRequestId, setCreationRequestId] = useState(createRequestId);
  const [profileGenerating, setProfileGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [assistantNote, setAssistantNote] = useState<string | null>(null);
  const [changeRequest, setChangeRequest] = useState("");
  const profileRequestChecked = useRef(false);
  const [profileRequestBlocked, setProfileRequestBlocked] = useState(false);
  const [creationTraitIds, setCreationTraitIds] = useState<
    AgentCreationTraitId[]
  >([]);
  const [editHistory, setEditHistory] = useState<string[]>([]);
  const [allowAIChoose, setAllowAIChoose] = useState(!initial?.personaKey);
  const [pendingRestore, setPendingRestore] =
    useState<StoredEditorDraft | null>(null);
  const [restoreConflict, setRestoreConflict] = useState(false);
  const [restoreAlternatives, setRestoreAlternatives] = useState<{
    tab: StoredEditorDraft;
    account: StoredEditorDraft;
  } | null>(null);
  const [unreadableDraft, setUnreadableDraft] = useState(false);
  const [draftConflicts, setDraftConflicts] = useState<DraftConflict[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  const [draftPersisted, setDraftPersisted] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState<string | null>(
    null,
  );
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discardDialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!confirmDiscard) return;
    const previous = document.activeElement;
    discardDialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [confirmDiscard]);
  const generationEpoch = useRef(0);
  const submission = useRef<{ id: string; fingerprint: string } | undefined>(
    undefined,
  );
  const [generationDeadline, setGenerationDeadline] = useState<number | null>(
    null,
  );
  const [unfinishedReplacement, setUnfinishedReplacement] = useState(false);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const generationBusy = profileGenerating || referenceBusy;
  useEffect(
    () => () => {
      generationEpoch.current += 1;
      referenceEpoch.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (reviewOpen) {
      reviewRef.current?.focus();
      reviewRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [reviewOpen]);

  function beginGeneration() {
    const epoch = ++generationEpoch.current;
    setGenerationDeadline(Date.now() + GENERATION_TIMEOUT_MS);
    setGenerationNotice(null);
    return epoch;
  }

  const previewPersona = personaKey ?? "strategic";
  const avatarUrl = explicitAvatarUrl;
  const currentSnapshot: EditorSnapshot = useMemo(
    () => ({
      modelPreference,
      voiceId,
      visualDesign,
      portraitCrop,
      headPosition,
      headSuggestion,
      name,
      backstory,
      personality,
      strategyStyle,
      werewolfStrategyStyle,
      performanceInstructions,
      fullBodyReferenceUrl,
      personaKey,
      gender,
      explicitAvatarUrl,
    }),
    [
      voiceId,
      modelPreference,
      visualDesign,
      portraitCrop,
      headPosition,
      headSuggestion,
      backstory,
      explicitAvatarUrl,
      gender,
      name,
      personaKey,
      personality,
      strategyStyle,
      werewolfStrategyStyle,
      performanceInstructions,
      fullBodyReferenceUrl,
    ],
  );
  const dirty = !sameSnapshot(currentSnapshot, initialSnapshot);
  const anonymousDraftKey = `influence:agent-editor:${DRAFT_VERSION}:anonymous:${draftScope}`;
  const draftStorageKey = draftOwner
    ? `influence:agent-editor:${DRAFT_VERSION}:${draftOwner}:${draftScope}`
    : null;

  const [remoteReady, setRemoteReady] = useState(false);
  const remoteVersion = useRef<string | null>(null);
  const remoteBlocked = useRef(false);
  const remoteWrites = useRef<Promise<void>>(Promise.resolve());
  const remotePath =
    "/api/agent-profiles/drafts/" + encodeURIComponent(draftScope);
  useEffect(() => {
    if (!authenticated || !draftOwner) {
      setRemoteReady(true);
      return;
    }
    let active = true;
    setRemoteReady(false);
    remoteVersion.current = null;
    remoteBlocked.current = false;
    void apiFetch<{ version: string; document: StoredEditorDraft } | null>(
      remotePath,
    )
      .then((result) => {
        if (!active) return;
        remoteVersion.current = result?.version ?? null;
        if (result) {
          if (isAgentEditorDraft(result.document)) {
            const tabRead = draftStorageKey
              ? readEditorStorage(draftStorageKey)
              : null;
            const previewRead =
              !tabRead?.value && recoveredAnonymousDraft.current
                ? readEditorStorage(anonymousDraftKey)
                : null;
            const tab = parseStoredDraft(
              (tabRead?.ok ? tabRead.value : null) ??
                (previewRead?.ok ? previewRead.value : null),
            );
            if (tab && canonicalDraft(tab) !== canonicalDraft(result.document))
              setRestoreAlternatives({ tab, account: result.document });
            setPendingRestore(result.document);
            setRestoreConflict(
              !sameSnapshot(result.document.base, initialSnapshot),
            );
          } else {
            setUnreadableDraft(true);
            setDraftReady(false);
            setDraftStorageError(
              "The saved draft could not be read. Discard it explicitly before continuing.",
            );
          }
        }
        setRemoteReady(true);
      })
      .catch((cause) => {
        if (active) {
          remoteBlocked.current = true;
          setDraftStorageError(
            cause instanceof Error
              ? cause.message
              : "Draft recovery unavailable",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [
    authenticated,
    draftOwner,
    draftStorageKey,
    anonymousDraftKey,
    remotePath,
    initialSnapshot,
  ]);
  const persistRemote = useCallback(
    (document: StoredEditorDraft): Promise<void> => {
      if (!authenticated) return Promise.resolve();
      if (!remoteReady || remoteBlocked.current)
        return Promise.reject(
          new Error("Reload to recover the saved draft before continuing."),
        );
      const next = remoteWrites.current.then(async () => {
        if (boundAccount.current !== activeAccount.current)
          throw new Error(
            "Your account changed. Reopen the editor to continue.",
          );
        const result = await apiFetch<{ version: string }>(remotePath, {
          method: "PUT",
          body: JSON.stringify({ version: remoteVersion.current, document }),
        });
        remoteVersion.current = result.version;
      });
      remoteWrites.current = next.catch((cause) => {
        remoteBlocked.current = true;
        setDraftStorageError(
          cause instanceof Error ? cause.message : "Draft was not saved",
        );
      });
      return next;
    },
    [authenticated, remoteReady, remotePath],
  );

  const interruptGeneration = useCallback(
    (message: string) => {
      generationEpoch.current += 1;
      if (draftStorageKey)
        writeEditorStorage(
          `${draftStorageKey}:interrupted`,
          String(Date.now()),
        );
      setGenerationDeadline(null);
      setProfileGenerating(false);
      setReferenceBusy(false);
      setUnfinishedReplacement(true);
      setGenerationNotice(message);
    },
    [draftStorageKey],
  );
  useEffect(() => {
    if (!generationDeadline) return;
    const timer = window.setTimeout(
      () =>
        interruptGeneration(
          "Generation timed out. Your selected assets and text are unchanged; late results will not be applied.",
        ),
      Math.max(0, generationDeadline - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [generationDeadline, interruptGeneration]);

  useEffect(() => {
    if (!draftStorageKey) return;
    const storedRead = readEditorStorage(draftStorageKey);
    if (!storedRead.ok) {
      setDraftStorageError(
        "Local draft recovery is unavailable in this browser. You can still save the Agent normally.",
      );
      setDraftReady(true);
      return;
    }
    const anonymousRead =
      publicPreview && draftOwner !== "anonymous" && !storedRead.value
        ? readEditorStorage(anonymousDraftKey)
        : null;
    const stored = parseStoredDraft(
      storedRead.value ?? (anonymousRead?.ok ? anonymousRead.value : null),
    );
    recoveredAnonymousDraft.current = Boolean(
      stored && anonymousRead?.ok && anonymousRead.value,
    );
    if (!stored) {
      if (storedRead.value) {
        setUnreadableDraft(true);
        setDraftStorageError(
          "This tab has an unreadable draft. Discard it explicitly before continuing.",
        );
        return;
      }
      setDraftReady(true);
      return;
    }
    setPendingRestore(stored);
    setRestoreConflict(!sameSnapshot(stored.base, initialSnapshot));
  }, [
    draftStorageKey,
    initialSnapshot,
    anonymousDraftKey,
    draftOwner,
    publicPreview,
  ]);

  useEffect(() => {
    if (
      !draftStorageKey ||
      unreadableDraft ||
      !draftReady ||
      pendingRestore ||
      (authenticated && !remoteReady)
    )
      return;
    setDraftPersisted(false);
    if (
      !dirty &&
      !generationDeadline &&
      !unfinishedReplacement &&
      !uploading &&
      !referenceBusy &&
      !referenceRequest.current &&
      !candidateImage &&
      !conversation?.input &&
      !conversation?.messages.length &&
      guided === initialGuided
    ) {
      if (!removeEditorStorage(draftStorageKey)) {
        setDraftStorageError(
          "The old local draft could not be cleared. Saving the Agent still works.",
        );
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
        generationDeadline,
        uploadPending: uploading,
        unfinishedReplacement,
        submission: submission.current,
        referenceRequest: referenceRequest.current,
        candidateImage,
        guided,
        conversation,
      };
      if (writeEditorStorage(draftStorageKey, JSON.stringify(stored))) {
        setDraftStorageError(null);
        void persistRemote(stored)
          .then(() => setDraftPersisted(true))
          .catch(() => setDraftPersisted(false));
      } else {
        setDraftStorageError(
          "This draft could not be stored locally. Save before leaving this page.",
        );
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [
    unreadableDraft,
    initialGuided,
    referenceBusy,
    guided,
    conversation,
    candidateImage,
    persistRemote,
    authenticated,
    remoteReady,
    baseContentRevisionId,
    generationDeadline,
    unfinishedReplacement,
    uploading,
    creationRequestId,
    currentSnapshot,
    dirty,
    draftReady,
    draftStorageKey,
    initialSnapshot,
    pendingRestore,
  ]);

  function applyDraft() {
    if (!pendingRestore) return;
    setGuided(pendingRestore.guided ?? initialGuided);
    setConversation(pendingRestore.conversation);
    setConversationKey((value) => value + 1);
    if (pendingRestore.referenceRequest) {
      referenceRequest.current =
        pendingRestore.referenceRequest as typeof referenceRequest.current;
      if (draftStorageKey)
        writeEditorStorage(
          draftStorageKey + ":visual-reference",
          JSON.stringify(pendingRestore.referenceRequest),
        );
      const requestId = referenceRequest.current?.requestId;
      if (requestId) {
        const epoch = ++referenceEpoch.current;
        setReferenceBusy(true);
        void observeReference(requestId, epoch)
          .then((result) => {
            if (result) {
              setCandidateImage(result);
              referenceRequest.current = null;
            }
          })
          .catch((cause) =>
            setReferenceError(
              cause instanceof Error ? cause.message : "Progress unavailable",
            ),
          )
          .finally(() => {
            if (epoch === referenceEpoch.current) setReferenceBusy(false);
          });
      }
    }
    const { merged, conflicts } = mergeAgentDraft(
      pendingRestore.base,
      pendingRestore.current,
      initialSnapshot,
    );
    captureProductEvent("agent_editor_draft_restored", {
      conflicts: conflicts.length,
    });
    setDraftConflicts(conflicts);
    setCandidateImage(pendingRestore.candidateImage ?? null);
    setVoiceId(merged.voiceId ?? null);
    setVisualDesign(merged.visualDesign ?? null);
    setPortraitCrop(merged.portraitCrop ?? null);
    setHeadPosition(merged.headPosition ?? null);
    setHeadSuggestion(merged.headSuggestion ?? null);
    setName(merged.name);
    setBackstory(merged.backstory);
    setPersonality(merged.personality);
    setStrategyStyle(merged.strategyStyle);
    setWerewolfStrategyStyle(merged.werewolfStrategyStyle);
    setModelPreference(merged.modelPreference ?? "default");
    setPerformanceInstructions(merged.performanceInstructions);
    setFullBodyReferenceUrl(merged.fullBodyReferenceUrl);
    setPersonaKey(merged.personaKey);
    setGender(merged.gender);
    setExplicitAvatarUrl(merged.explicitAvatarUrl);
    setCreationRequestId(pendingRestore.creationRequestId);
    setBaseContentRevisionId(
      initial?.latestContentRevisionId ?? initial?.contentRevisionId ?? null,
    );
    setGenerationDeadline(null);
    setUnfinishedReplacement(
      Boolean(
        pendingRestore.unfinishedReplacement || pendingRestore.uploadPending,
      ),
    );
    if (pendingRestore.generationDeadline)
      setGenerationNotice(
        "The previous text update was interrupted. Your draft fields are retained.",
      );
    submission.current = pendingRestore.submission;
    setPendingRestore(null);
    setDraftReady(true);
  }

  // Retire only this tab's active draft pointers. Server receipts remain durable,
  // and the epoch prevents any outstanding request from applying a late result.
  function retireDraft() {
    if (draftStorageKey) {
      // Keep the interruption fence if removing either recoverable pointer fails.
      for (const suffix of ["", ":visual-reference", ":interrupted"]) {
        if (!removeEditorStorage(`${draftStorageKey}${suffix}`)) return false;
      }
    }
    if (recoveredAnonymousDraft.current) {
      if (!removeEditorStorage(anonymousDraftKey)) return false;
      recoveredAnonymousDraft.current = false;
    }
    generationEpoch.current += 1;
    referenceEpoch.current += 1;
    referenceRequest.current = null;
    setDraftReady(false);
    setGenerationDeadline(null);
    setProfileGenerating(false);
    setReferenceBusy(false);
    setUnfinishedReplacement(false);
    return true;
  }

  async function deleteRemoteDraft() {
    await remoteWrites.current;
    if (remoteBlocked.current)
      throw new Error(
        "The draft changed or could not be saved. Reload before discarding it.",
      );
    if (authenticated)
      await apiFetch(remotePath, {
        method: "DELETE",
        body: JSON.stringify({ version: remoteVersion.current }),
      });
    remoteVersion.current = null;
  }

  async function discardArtwork() {
    const ids = new Set([
      referenceRequest.current?.requestId,
      candidateImage?.requestId,
      pendingRestore?.referenceRequest?.requestId,
      pendingRestore?.candidateImage?.requestId,
    ]);
    for (const id of ids)
      if (typeof id === "string")
        await apiFetch(
          "/api/agent-profiles/visual-references/" + id + "/decision",
          { method: "POST", body: JSON.stringify({ decision: "discarded" }) },
        );
  }

  async function clearStoredDraft() {
    try {
      await deleteRemoteDraft();
      await discardArtwork();
    } catch (cause) {
      setDraftStorageError(
        cause instanceof Error ? cause.message : "Draft could not be discarded",
      );
      return;
    }
    if (!retireDraft()) {
      setDraftStorageError(
        "The local draft could not be cleared. Browser storage may be unavailable.",
      );
      return;
    }
    setPendingRestore(null);
    setRestoreAlternatives(null);
    setUnreadableDraft(false);
    setDraftStorageError(null);
    setDraftReady(true);
    if (profileRequestBlocked) {
      profileRequestChecked.current = false;
      setProfileRequestBlocked(false);
    }
  }

  const visualOffer =
    !visualDesign?.trim() ||
    !performanceInstructions.trim() ||
    !fullBodyReferenceUrl
      ? "This character is missing visual presentation details or a full-body reference. Would you like me to update their visuals?"
      : null;
  const missingDetails = [
    !name.trim() && "name",
    !personality.trim() && "personality",
    !gender && "gender",
    !personaKey && "archetype",
  ]
    .filter(Boolean)
    .join(", ");

  async function completeMissingDetails() {
    if (generationBusy || uploading || submitting) return;
    const fields = characterEditFields(
      {
        name,
        personaKey,
        gender,
        personality,
        backstory,
        strategyStyle,
        werewolfStrategyStyle,
        performanceInstructions,
        visualDesign,
      },
      [],
    );
    await handleGenerate({
      message:
        "Complete the missing details from this existing character. Infer missing gender and archetype from the character. Preserve all populated fields and existing images.",
      sections: fields,
    });
  }

  async function handleAdvancedSend(incomingMessage?: string) {
    if (generationBusy || uploading || submitting || profileRequestBlocked)
      return;
    const message =
      incomingMessage?.trim() ||
      changeRequest.trim() ||
      "Create a character using the selected ingredients.";
    const context = {
      name,
      personaKey: personaKey ?? "",
      gender,
      personality,
      backstory,
      strategyStyle,
      werewolfStrategyStyle,
      performanceInstructions,
      visualDesign: visualDesign ?? "",
      hasFullBody: Boolean(fullBodyReferenceUrl),
    };
    const prompt = assistantNote ?? visualOffer;
    const history = [
      ...editHistory,
      ...(prompt ? [`assistant: ${prompt}`] : []),
    ]
      .slice(-24)
      .map((line) => line.slice(0, 2000));
    const epoch = beginGeneration();
    setProfileGenerating(true);
    setAiError(null);
    try {
      const command = await apiFetch<CharacterEditCommand>(
        "/api/agent-profiles/edit-assistant",
        {
          method: "POST",
          body: JSON.stringify({ context, message, history }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (epoch !== generationEpoch.current) return;
      if (command.tool === "clarify") {
        setAssistantNote(command.message);
        setChangeRequest("");
        setEditHistory([...history, `user: ${message}`].slice(-22));
        return;
      }
      const fields = characterEditFields(context, command.fields);
      const images =
        command.tool === "update_visuals" ||
        command.fields.some((field) => VISUAL_FIELDS.includes(field));
      const success = await handleGenerate({
        message,
        sections: fields,
        images,
      });
      if (success) {
        setEditHistory([...history, `user: ${message}`].slice(-22));
        setAssistantNote(
          images
            ? "I updated the visual presentation. Review the character images before saving."
            : !fullBodyReferenceUrl
              ? "I updated the requested fields. This character still needs a full-body reference. Would you like me to update their visuals?"
              : "I updated the requested fields. Your existing visuals are unchanged.",
        );
      }
    } catch (error) {
      if (epoch === generationEpoch.current)
        setAiError(
          error instanceof Error
            ? error.message
            : "The assistant could not complete this turn.",
        );
    } finally {
      if (epoch === generationEpoch.current) {
        setProfileGenerating(false);
        setGenerationDeadline(null);
      }
    }
  }

  // A profile request is a one-shot handoff in this tab, not a URL or account record.
  useEffect(() => {
    if (
      !profileRequest ||
      profileRequestChecked.current ||
      !account?.id ||
      !initial ||
      draftScope !== `edit:${initial.id}`
    )
      return;
    const key = agentEditRequestKey(account.id, initial.id);
    const incoming = readEditorStorage(key);
    if (!incoming.ok) {
      profileRequestChecked.current = true;
      setAiError(
        "Could not read your request from this tab. Please enter it again.",
      );
      return;
    }
    if (!incoming.value) {
      profileRequestChecked.current = true;
      return;
    }
    const drafts = findAgentDrafts(account.id, initial.id);
    if (!drafts.ok) {
      profileRequestChecked.current = true;
      setAiError(
        "Could not check the existing draft. Your request remains in this tab.",
      );
      return;
    }
    if (!draftReady && !drafts.scopes.length) return;
    profileRequestChecked.current = true;
    setChangeRequest(incoming.value);
    if (drafts.scopes.length || pendingRestore) {
      setProfileRequestBlocked(true);
      setAiError(
        "An unfinished draft was found. Finish or discard it before sending this request. Your request remains in this tab.",
      );
      return;
    }
    if (!removeEditorStorage(key)) {
      setProfileRequestBlocked(true);
      setAiError(
        "Could not safely start the request. Check browser storage and try again; your text is shown here.",
      );
      return;
    }
    void handleAdvancedSend(incoming.value);
    // The ref makes this a one-shot handoff after draft recovery has settled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    account?.id,
    initial,
    draftScope,
    draftReady,
    pendingRestore,
    profileRequest,
  ]);

  function requestAccount() {
    saveLocalDraft();
    openCreateAccount();
  }

  function applyGeneratedCharacter(result: GeneratePersonalityResult) {
    setName(result.name);
    setBackstory(result.backstory ?? "");
    setPersonality(result.personality);
    setStrategyStyle(result.strategyStyle ?? "");
    setWerewolfStrategyStyle(result.werewolfStrategyStyle ?? "");
    setPersonaKey(result.personaKey);
    setGender(result.gender);
    setPerformanceInstructions(result.performanceInstructions);
    setVisualDesign(result.visualDesign);
    setAllowAIChoose(false);
  }

  async function handleAnonymousMessage(message: string) {
    try {
      const turn = await generateAnonymousCharacter(message, creationTraitIds);
      setAnonymousUsed(true);
      if (turn.profile) applyGeneratedCharacter(turn.profile);
      return { reply: turn.reply, hasCharacter: Boolean(turn.profile) };
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "anonymous_signup_required"
      ) {
        setAnonymousUsed(true);
        requestAccount();
      }
      throw error;
    }
  }

  async function handleGenerate(options?: {
    message: string;
    sections?: CharacterSection[];
    appearance?: boolean;
    images?: boolean;
    imageOperation?: "create" | "edit";
  }) {
    if (anonymous) {
      requestAccount();
      return false;
    }
    if (boundAccount.current !== activeAccount.current) {
      setAiError("Your account changed. Reopen the editor to continue.");
      return false;
    }
    const request = options?.message ?? changeRequest;
    if (!request.trim() && (isEditing || creationTraitIds.length === 0)) {
      setAiError(
        isEditing
          ? "Describe what you want changed before asking AI to update this Agent."
          : "Choose a few character ingredients or describe the Agent you want to create.",
      );
      return;
    }
    const savedReference = draftStorageKey
      ? readEditorStorage(`${draftStorageKey}:visual-reference`)
      : null;
    if (
      (options?.appearance || options?.images) &&
      (referenceRequest.current || (savedReference?.ok && savedReference.value))
    ) {
      setAiError(
        "The previous image request is unfinished. Retry that reference request, submit the selected assets, or discard the draft before starting a different character generation.",
      );
      return;
    }
    const epoch = beginGeneration();
    setProfileGenerating(true);
    setAiError(null);
    setSaveError(null);
    setAssistantNote(null);
    try {
      const params: GeneratePersonalityParams = {
        selectedFields: options?.sections as CharacterField[] | undefined,
        changeRequest: options
          ? `${options.appearance ? "Update visualDesign using this appearance request. Preserve the character's identity. " : "Develop a rich character prompt with concrete motivations, voice, flaws, relationships and game behavior. "}${options.sections?.length ? `Change only these sections: ${options.sections.join(", ")}. ` : ""}${request}`
          : request.trim() || undefined,
        allowPersonaChange: options
          ? !options.appearance &&
            (!options.sections?.length ||
              options.sections.includes("personaKey"))
          : allowAIChoose,
        ...(isEditing ? {} : { creationTraitIds }),
      };
      if (
        name.trim() ||
        backstory.trim() ||
        personality.trim() ||
        strategyStyle.trim() ||
        werewolfStrategyStyle.trim() ||
        performanceInstructions.trim() ||
        visualDesign?.trim() ||
        avatarUrl ||
        fullBodyReferenceUrl
      ) {
        params.existingProfile = {
          name: name.trim() || undefined,
          backstory: backstory.trim() || undefined,
          personality: personality.trim() || undefined,
          strategyStyle,
          werewolfStrategyStyle,
          personaKey: personaKey ?? undefined,
          gender: gender || undefined,
          performanceInstructions,
          visualDesign: visualDesign ?? "",
          avatarUrl: avatarUrl ?? null,
          fullBodyReferenceUrl,
        };
      } else {
        if (!allowAIChoose) params.archetype = personaKey ?? "strategic";
        params.gender = gender || undefined;
      }
      const result = await generatePersonality(params);
      if (epoch !== generationEpoch.current) return;
      setGenerationDeadline(null);
      const change = (section: CharacterSection) =>
        !options?.appearance &&
        (!options?.sections?.length || options.sections.includes(section));
      if (change("name")) setName(result.name);
      if (change("backstory")) setBackstory(result.backstory ?? "");
      if (change("personality")) setPersonality(result.personality);
      if (change("strategyStyle")) setStrategyStyle(result.strategyStyle ?? "");
      if (change("werewolfStrategyStyle"))
        setWerewolfStrategyStyle(result.werewolfStrategyStyle ?? "");
      if (change("personaKey")) setPersonaKey(result.personaKey);
      setAllowAIChoose(false);
      if (change("gender")) setGender(result.gender);
      if (change("performanceInstructions"))
        setPerformanceInstructions(result.performanceInstructions);
      if (options?.appearance || change("visualDesign"))
        setVisualDesign(result.visualDesign);
      setValidationErrors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([field]) => !change(field as CharacterSection),
          ),
        ),
      );
      setProfileGenerating(false);

      if (options?.appearance || options?.images) {
        const success = await generateReference(
          {
            name: options?.appearance ? name : result.name,
            personaKey: options?.appearance
              ? (personaKey ?? "strategic")
              : result.personaKey,
            performanceInstructions: options?.appearance
              ? performanceInstructions
              : result.performanceInstructions,
            visualDesign: result.visualDesign,
          },
          options?.imageOperation,
        );
        if (!success) return false;
      }
      setChangeRequest("");
      setAssistantNote(
        "I applied the requested profile changes to this draft. Review them above before saving.",
      );
      return true;
    } catch (error) {
      if (epoch !== generationEpoch.current) return;
      setGenerationDeadline(null);
      setUnfinishedReplacement(true);
      setAiError(
        error instanceof Error
          ? error.message
          : "AI generation failed. Your existing text is unchanged.",
      );
      return false;
    } finally {
      if (epoch === generationEpoch.current) setProfileGenerating(false);
    }
  }

  function focusField(id: string) {
    setGuided(false);
    setReviewOpen(false);
    setAdvancedSection(
      id.includes("strategy") || id.includes("Strategy")
        ? "strategy"
        : "character",
    );
    window.requestAnimationFrame(() => {
      const field = document.getElementById(id);
      field?.focus({ preventScroll: true });
      field?.scrollIntoView({ block: "center" });
    });
  }

  const headConfirmationRequired = Boolean(
    fullBodyReferenceUrl &&
      (!headPosition || headPosition.sourceUrl !== fullBodyReferenceUrl) &&
      (fullBodyReferenceUrl !== initialSnapshot.fullBodyReferenceUrl ||
        initialSnapshot.headPosition ||
        headSuggestion),
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (
      profileGenerating ||
      uploading ||
      submitting ||
      headConfirmationRequired
    )
      return;

    captureProductEvent("agent_editor_review_opened", { editing: isEditing });
    setReviewOpen(true);
  }

  async function submitDraft() {
    if (anonymous) {
      requestAccount();
      return;
    }
    if (boundAccount.current !== activeAccount.current) {
      setSaveError("Your account changed. Reopen the editor to continue.");
      return;
    }
    if (
      profileGenerating ||
      uploading ||
      submitting ||
      headConfirmationRequired
    )
      return;
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Agent name is required.";
    if (!personality.trim()) errors.personality = "Personality is required.";
    if (!gender) errors.gender = "Select a gender for this Agent.";
    if (
      strategyComparison?.requireChange &&
      (normalizedStrategy(
        comparingWerewolf ? werewolfStrategyStyle : strategyStyle,
      ) === normalizedStrategy(strategyComparison.initialWorking) ||
        normalizedStrategy(
          comparingWerewolf ? werewolfStrategyStyle : strategyStyle,
        ) === normalizedStrategy(strategyComparison.baseline))
    ) {
      errors[comparingWerewolf ? "werewolfStrategyStyle" : "strategyStyle"] =
        "Edit the suggested strategy before saving this custom update.";
    }
    setValidationErrors(errors);
    const firstError = [
      "name",
      "gender",
      "strategyStyle",
      "werewolfStrategyStyle",
      "personality",
    ].find((field) => errors[field]);
    if (firstError) {
      focusField(
        firstError === "gender" ? "agent-gender-male" : `agent-${firstError}`,
      );
      return;
    }

    setSubmitting(true);
    setSaveError(null);
    try {
      const params: AgentProfileWriteParams = {
        modelPreference,
        voiceId,
        name: name.trim(),
        personality: personality.trim(),
        backstory: backstory.trim(),
        strategyStyle: strategyStyle.trim(),
        werewolfStrategyStyle: werewolfStrategyStyle.trim(),
        performanceInstructions: performanceInstructions.trim(),
        fullBodyReferenceUrl,
        personaKey: personaKey ?? undefined,
        gender: gender as AgentGender,
        avatarUrl: avatarUrl,
        visualDesign,
        portraitCrop,
        headPosition,
        expectedContentRevisionId: baseContentRevisionId,
      };
      const fingerprint = JSON.stringify(params);
      if (!submission.current || submission.current.fingerprint !== fingerprint)
        submission.current = { id: createRequestId(), fingerprint };
      if (!(await saveLocalDraft()))
        throw new Error(
          "Save the recovery draft before submitting. Your changes are retained here.",
        );
      const saved = await onSubmit(
        { ...params, submissionId: submission.current.id },
        { creationRequestId },
      );
      if (referenceRequest.current || candidateImage) {
        const base = { ...currentSnapshot };
        await persistRemote({
          version: DRAFT_VERSION,
          savedAt: new Date().toISOString(),
          base,
          current: base,
          baseContentRevisionId:
            saved?.latestContentRevisionId ?? baseContentRevisionId,
          creationRequestId,
          referenceRequest: referenceRequest.current,
          candidateImage,
          guided,
          conversation,
        });
      } else await deleteRemoteDraft();
      if (!retireDraft()) {
        setDraftStorageError(
          "The saved Agent is safe, but its local recovery draft could not be cleared.",
        );
      }
    } catch (error) {
      setSaveError(agentSaveErrorMessage(error));
      setSubmitting(false);
    }
  }

  function requestCancel() {
    if (
      pendingRestore ||
      dirty ||
      generationBusy ||
      uploading ||
      unfinishedReplacement
    )
      setConfirmDiscard(true);
    else confirmCancel();
  }

  async function confirmCancel() {
    try {
      await deleteRemoteDraft();
      await discardArtwork();
    } catch (cause) {
      setDraftStorageError(
        cause instanceof Error ? cause.message : "Draft could not be discarded",
      );
      return;
    }
    if (!retireDraft()) {
      setDraftStorageError(
        "The local draft could not be cleared. Browser storage may be unavailable.",
      );
      setConfirmDiscard(false);
      return;
    }
    onCancel();
  }

  const requiredStrategyChangeMissing = Boolean(
    strategyComparison?.requireChange &&
      (normalizedStrategy(
        comparingWerewolf ? werewolfStrategyStyle : strategyStyle,
      ) === normalizedStrategy(strategyComparison.initialWorking) ||
        normalizedStrategy(
          comparingWerewolf ? werewolfStrategyStyle : strategyStyle,
        ) === normalizedStrategy(strategyComparison.baseline)),
  );
  const submitDisabled =
    unreadableDraft ||
    Boolean(pendingRestore) ||
    draftConflicts.length > 0 ||
    submitting ||
    profileGenerating ||
    uploading ||
    headConfirmationRequired ||
    requiredStrategyChangeMissing;

  async function decideCandidate(decision: "selected" | "discarded") {
    const result = candidateImage;
    if (!result) return;
    try {
      // Persist selection first so another tab cannot silently replace this decision.
      if (pendingRestore || draftConflicts.length)
        throw new Error("Resolve the saved draft before selecting artwork.");
      if (decision === "selected") {
        const current = {
          ...currentSnapshot,
          fullBodyReferenceUrl: result.fullBodyReferenceUrl,
          headPosition: null,
          headSuggestion: result.headSuggestion ?? null,
          explicitAvatarUrl:
            result.avatarUrl ?? currentSnapshot.explicitAvatarUrl,
          portraitCrop: result.portraitCrop ?? null,
        };
        await persistRemote({
          version: DRAFT_VERSION,
          savedAt: new Date().toISOString(),
          base: initialSnapshot,
          current,
          baseContentRevisionId,
          creationRequestId,
          guided,
          conversation,
        });
      }
      if (decision === "discarded")
        await persistRemote({
          version: DRAFT_VERSION,
          savedAt: new Date().toISOString(),
          base: initialSnapshot,
          current: currentSnapshot,
          baseContentRevisionId,
          creationRequestId,
          guided,
          conversation,
          referenceRequest: null,
          candidateImage: null,
        });
      await apiFetch(
        "/api/agent-profiles/visual-references/" +
          result.requestId +
          "/decision",
        { method: "POST", body: JSON.stringify({ decision }) },
      );
      if (decision === "selected") {
        setFullBodyReferenceUrl(result.fullBodyReferenceUrl);
        setHeadPosition(null);
        setHeadSuggestion(result.headSuggestion ?? null);
        if (result.avatarUrl) setExplicitAvatarUrl(result.avatarUrl);
        setPortraitCrop(result.portraitCrop ?? null);
        setPortraitEditorSource(result.fullBodyReferenceUrl);
      }
      setCandidateImage(null);
    } catch (cause) {
      setReferenceError(
        cause instanceof Error
          ? cause.message
          : "Artwork could not be selected",
      );
    }
  }
  async function uploadCharacter(file: File) {
    setUploading(true);
    setReferenceError(null);
    try {
      const form = new FormData();
      form.set("image", file);
      const { sourceUrl } = await apiFetch<{ sourceUrl: string }>(
        "/api/agent-profiles/images",
        { method: "POST", body: form },
      );
      referenceRequest.current = {
        agentId: initial?.id,
        draftScope,
        operation: "edit",
        requestId: createRequestId(),
        name: name || "Untitled agent",
        personaKey: personaKey ?? "",
        avatarUrl: avatarUrl ?? null,
        fullBodyReferenceUrl,
        performanceInstructions,
        visualDesign: visualDesign ?? "",
        uploadSource: sourceUrl,
      };
      await generateReference();
    } catch (cause) {
      setReferenceError(
        cause instanceof Error ? cause.message : "Upload failed",
      );
    } finally {
      setUploading(false);
    }
  }
  const initialImageRead = useRef(false);
  useEffect(() => {
    if (!imageRequest || initialImageRead.current || !remoteReady) return;
    initialImageRead.current = true;
    void apiFetch<{
      status: string;
      stage: string;
      result: CharacterImageDraft | null;
      error: string | null;
    }>(
      "/api/agent-profiles/visual-references/" +
        encodeURIComponent(imageRequest),
    )
      .then((job) => {
        if (job.status === "ready") setCandidateImage(job.result);
        else if (job.status === "failed")
          setReferenceError(
            job.error ?? "Preparation failed. Retry the saved image request.",
          );
      })
      .catch((cause) =>
        setReferenceError(
          cause instanceof Error ? cause.message : "Artwork unavailable",
        ),
      );
  }, [imageRequest, remoteReady]);
  async function retrySelectedJob() {
    if (!imageRequest) return;
    setReferenceBusy(true);
    setReferenceError(null);
    const epoch = ++referenceEpoch.current;
    try {
      await apiFetch(
        "/api/agent-profiles/visual-references/" + imageRequest + "/retry",
        { method: "POST" },
      );
      const result = await observeReference(imageRequest, epoch);
      if (result) setCandidateImage(result);
    } catch (cause) {
      setReferenceError(
        cause instanceof Error ? cause.message : "Retry failed",
      );
    } finally {
      if (epoch === referenceEpoch.current) setReferenceBusy(false);
    }
  }

  async function observeReference(
    requestId: string,
    epoch: number,
  ): Promise<CharacterImageDraft | null> {
    for (;;) {
      if (epoch !== referenceEpoch.current) return null;
      const job = await apiFetch<{
        status: string;
        stage: string;
        error: string | null;
        result: CharacterImageDraft | null;
        createdAt: string;
      }>(
        "/api/agent-profiles/visual-references/" +
          encodeURIComponent(requestId),
      );
      if (epoch !== referenceEpoch.current) return null;
      setReferenceStage(job.stage);
      setReferenceStartedAt(job.createdAt);
      if (job.status === "ready" && job.result) return job.result;
      if (job.status === "selected" || job.status === "discarded")
        throw new Error(
          "This artwork was already reviewed in another session.",
        );
      if (job.status === "failed")
        throw new Error(job.error ?? "Image preparation failed");
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
  }

  async function generateReference(
    refined?: {
      name: string;
      personaKey: string;
      performanceInstructions: string;
      visualDesign: string;
    },
    operation: "create" | "edit" = fullBodyReferenceUrl || avatarUrl
      ? "edit"
      : "create",
  ) {
    if (anonymous) {
      requestAccount();
      return false;
    }
    if (
      unreadableDraft ||
      pendingRestore ||
      draftConflicts.length ||
      boundAccount.current !== activeAccount.current
    ) {
      setReferenceError(
        "Resolve the draft or account conflict before generating.",
      );
      return false;
    }
    if (!remoteReady || remoteBlocked.current) {
      setReferenceError("Recover the saved draft before generating.");
      return false;
    }
    const epoch = ++referenceEpoch.current;
    setReferenceBusy(true);
    setReferenceError(null);
    const referenceStorageKey = `${draftStorageKey}:visual-reference`;
    const saved = readEditorStorage(referenceStorageKey);
    if (saved.ok && saved.value && !referenceRequest.current) {
      try {
        referenceRequest.current = JSON.parse(saved.value);
      } catch {
        setReferenceError(
          "Saved reference request is unreadable. Restore the draft before generating again.",
        );
        setReferenceBusy(false);
        setGenerationDeadline(null);
        setUnfinishedReplacement(true);
        return;
      }
    }
    referenceRequest.current ??= {
      agentId: initial?.id,
      draftScope,
      operation,
      requestId: createRequestId(),
      name,
      personaKey: personaKey ?? "",
      avatarUrl: avatarUrl ?? null,
      fullBodyReferenceUrl,
      performanceInstructions,
      visualDesign: visualDesign ?? "",
      ...refined,
    };
    if (
      !writeEditorStorage(
        referenceStorageKey,
        JSON.stringify(referenceRequest.current),
      )
    )
      setDraftStorageError(
        "Local recovery is unavailable. Your server draft is retained.",
      );
    try {
      await persistRemote({
        version: DRAFT_VERSION,
        savedAt: new Date().toISOString(),
        base: initialSnapshot,
        current: currentSnapshot,
        creationRequestId,
        baseContentRevisionId,
        referenceRequest: referenceRequest.current,
        generationDeadline,
      });
      const existing = await apiFetch<{ status: string }>(
        "/api/agent-profiles/visual-references/" +
          referenceRequest.current!.requestId,
      ).catch((cause) => {
        if (cause instanceof ApiError && cause.status === 404) return null;
        throw cause;
      });
      await apiFetch(
        existing?.status === "failed"
          ? "/api/agent-profiles/visual-references/" +
              referenceRequest.current!.requestId +
              "/retry"
          : "/api/agent-profiles/visual-reference",
        { method: "POST", body: JSON.stringify(referenceRequest.current) },
      );
      const result = await observeReference(
        referenceRequest.current!.requestId,
        epoch,
      );
      if (!result) return false;
      if (epoch !== referenceEpoch.current) return;
      setGenerationDeadline(null);
      setCandidateImage(result);
      setUnfinishedReplacement(false);
      removeEditorStorage(referenceStorageKey);
      referenceRequest.current = null;
      return true;
    } catch (error) {
      if (epoch !== referenceEpoch.current) return;
      setGenerationDeadline(null);
      setUnfinishedReplacement(true);
      if (error instanceof ApiError && error.code === "generation_exhausted") {
        removeEditorStorage(referenceStorageKey);
        referenceRequest.current = null;
      }
      setReferenceError(
        error instanceof Error ? error.message : "Reference generation failed",
      );
      return false;
    } finally {
      if (epoch === referenceEpoch.current) setReferenceBusy(false);
    }
  }

  async function saveLocalDraft() {
    if (unreadableDraft) {
      setDraftStorageError("Discard the unreadable draft before continuing.");
      return false;
    }
    if (!draftStorageKey) {
      setDraftStorageError("Sign in to save a draft.");
      return false;
    }
    const stored: StoredEditorDraft = {
      version: DRAFT_VERSION,
      savedAt: new Date().toISOString(),
      base: initialSnapshot,
      current: currentSnapshot,
      creationRequestId,
      baseContentRevisionId,
      generationDeadline,
      uploadPending: uploading,
      unfinishedReplacement,
      submission: submission.current,
      referenceRequest: referenceRequest.current,
      candidateImage,
      guided,
      conversation,
    };
    const localSaved = writeEditorStorage(
      draftStorageKey,
      JSON.stringify(stored),
    );
    setDraftPersisted(false);
    try {
      await persistRemote(stored);
      setDraftPersisted(true);
      setDraftStorageError(
        localSaved
          ? null
          : "Local recovery is unavailable. Your server draft is retained.",
      );
      return true;
    } catch (cause) {
      setDraftStorageError(
        cause instanceof Error ? cause.message : "Draft was not saved",
      );
      return false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.workspace}>
      <fieldset disabled={submitting} className="contents">
        <legend className="sr-only">Agent draft</legend>
        <header className={styles.heading}>
          <h1>{name || "Create agent"}</h1>
          <div className={styles.modes} aria-label="Editing mode">
            <button
              type="button"
              aria-pressed={guided}
              onClick={() => {
                captureProductEvent("agent_editor_mode_changed", {
                  mode: "guided",
                });
                setGuided(true);
                onAssistant?.();
              }}
            >
              Guided
            </button>
            <button
              type="button"
              aria-pressed={!guided}
              disabled={publicPreview && !authReady}
              onClick={() => {
                if (anonymous) {
                  requestAccount();
                  return;
                }
                captureProductEvent("agent_editor_mode_changed", {
                  mode: "advanced",
                });
                setGuided(false);
                onAdvanced?.();
              }}
            >
              Advanced
            </button>
          </div>
        </header>
        <div className={styles.layout}>
          <aside className={styles.art}>
            {fullBodyReferenceUrl || avatarUrl ? (
              <OwnedCharacterImage
                src={
                  fullBodyReferenceUrl
                    ? fullBodyReferenceUrl === initial?.fullBodyReferenceUrl
                      ? (initial?.transparentBodyUrl ?? fullBodyReferenceUrl)
                      : fullBodyReferenceUrl
                    : avatarUrl!
                }
                alt={name || "Character"}
              />
            ) : referenceBusy ? (
              <CharacterFormation name={name} />
            ) : (
              <p>Generate or upload a full-body image.</p>
            )}
            <div className={styles.artActions}>
              <button
                type="button"
                disabled={
                  unreadableDraft ||
                  Boolean(pendingRestore) ||
                  referenceBusy ||
                  submitting ||
                  !name.trim()
                }
                onClick={() => void generateReference(undefined, "create")}
              >
                {referenceRequest.current ? "Retry" : "Generate"}
              </button>
              {fullBodyReferenceUrl && (
                <button
                  type="button"
                  disabled={referenceBusy || submitting}
                  onClick={() => {
                    setGuidedScope("visualDesign");
                    setGuided(true);
                    onAssistant?.();
                  }}
                >
                  Revise
                </button>
              )}
              <label className={styles.upload}>
                Upload
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={
                    unreadableDraft ||
                    Boolean(pendingRestore) ||
                    referenceBusy ||
                    submitting ||
                    uploading
                  }
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadCharacter(file);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                disabled={(!fullBodyReferenceUrl && !avatarUrl) || submitting}
                onClick={() =>
                  setPortraitEditorSource(
                    fullBodyReferenceUrl ?? avatarUrl ?? null,
                  )
                }
              >
                Portrait
              </button>
            </div>
            {(referenceBusy || uploading) && (
              <AgentOperationActivity
                stage={uploading ? "upload" : referenceStage}
                startedAt={referenceStartedAt}
              />
            )}
            {candidateImage && (
              <div className={styles.activity}>
                <h2>Artwork ready</h2>
                <OwnedCharacterImage
                  src={candidateImage.fullBodyReferenceUrl}
                  alt="New artwork candidate"
                />
                {candidateImage.basedOn &&
                  (candidateImage.basedOn.name !== name ||
                    candidateImage.basedOn.visualDesign !== visualDesign ||
                    candidateImage.basedOn.performanceInstructions !==
                      performanceInstructions) && (
                    <p>
                      The character brief changed during preparation. Compare
                      this image with your current appearance before selecting
                      it.
                    </p>
                  )}
                <button
                  type="button"
                  onClick={() => void decideCandidate("selected")}
                >
                  Select
                </button>
                <button
                  type="button"
                  onClick={() => void decideCandidate("discarded")}
                >
                  Discard
                </button>
              </div>
            )}
          </aside>
          <div className={styles.content}>
            {restoreAlternatives && (
              <section className={styles.review} aria-label="Choose draft">
                <h2>Two drafts differ</h2>
                <p>
                  Choose which version to resume. Saving it will replace the
                  other account draft.
                </p>
                {(["tab", "account"] as const).map((source) => {
                  const draft = restoreAlternatives[source];
                  return (
                    <section key={source}>
                      <h3>
                        {source === "tab" ? "This tab" : "Account"}:{" "}
                        {draft.current.name || "Untitled agent"}
                      </h3>
                      <p className={styles.hint}>
                        Saved {new Date(draft.savedAt).toLocaleString()}
                      </p>
                      <details>
                        <summary>Contents</summary>
                        {(
                          [
                            "personality",
                            "backstory",
                            "strategyStyle",
                            "werewolfStrategyStyle",
                            "visualDesign",
                            "performanceInstructions",
                          ] as const
                        ).map(
                          (field) =>
                            draft.current[field] && (
                              <p key={field} className="whitespace-pre-wrap">
                                <strong>
                                  {
                                    {
                                      personality: "Personality",
                                      backstory: "Backstory",
                                      strategyStyle: "Influence strategy",
                                      werewolfStrategyStyle:
                                        "Werewolf strategy",
                                      visualDesign: "Appearance",
                                      performanceInstructions: "Performance",
                                    }[field]
                                  }
                                </strong>{" "}
                                {draft.current[field]}
                              </p>
                            ),
                        )}
                        <p>
                          {agentModelLabel(draft.current.modelPreference) ??
                            "House choice"}{" "}
                          ·{" "}
                          {PLAYER_VOICES.find(
                            (voice) => voice.id === draft.current.voiceId,
                          )?.name ?? "Automatic voice"}
                        </p>
                        {draft.current.fullBodyReferenceUrl && (
                          <OwnedCharacterImage
                            src={draft.current.fullBodyReferenceUrl}
                            alt={draft.current.name || "Draft artwork"}
                            className="max-h-64 w-full object-contain"
                          />
                        )}
                      </details>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingRestore(draft);
                          setRestoreConflict(
                            !sameSnapshot(draft.base, initialSnapshot),
                          );
                          setRestoreAlternatives(null);
                        }}
                      >
                        {source === "tab" ? "Tab" : "Account"}
                      </button>
                    </section>
                  );
                })}
              </section>
            )}
            {pendingRestore && !restoreAlternatives && (
              <section
                className="mb-6 rounded-xl border border-phase/30 bg-phase/10 p-4"
                aria-label="Saved local draft"
              >
                <p className="text-sm font-semibold text-text-primary">
                  {restoreConflict
                    ? "A local draft was saved from an earlier Agent version."
                    : "A local draft is available."}
                </p>
                <p className="mt-1 text-xs leading-5 text-white/55">
                  Saved {new Date(pendingRestore.savedAt).toLocaleString()}.
                  Apply it to the editor, or clear it to keep working from this
                  version.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={applyDraft}
                    className="influence-button-primary min-h-11 rounded-lg px-4 text-sm font-semibold"
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={clearStoredDraft}
                    className="influence-button-secondary min-h-11 rounded-lg px-4 text-sm"
                  >
                    Discard
                  </button>
                </div>
              </section>
            )}

            {unreadableDraft && (
              <section role="alert">
                <p>The stored draft is unreadable. It has been retained.</p>
                <button type="button" onClick={() => void clearStoredDraft()}>
                  Discard
                </button>
              </section>
            )}
            {profileGenerating && <p role="status">Updating draft text…</p>}
            {!!draftConflicts.length && (
              <section className={styles.review} aria-label="Draft conflicts">
                <h2>Resolve draft conflicts</h2>
                <p>
                  These fields changed both in your draft and in the saved
                  agent. Choose which value to keep.
                </p>
                {draftConflicts.map((field) => (
                  <div className={styles.change} key={field}>
                    <h3>
                      {
                        {
                          images: "Artwork and portrait",
                          name: "Name",
                          gender: "Gender",
                          personaKey: "Archetype",
                          personality: "Personality",
                          backstory: "Backstory",
                          strategyStyle: "Influence strategy",
                          werewolfStrategyStyle: "Werewolf strategy",
                          performanceInstructions: "Performance",
                          visualDesign: "Appearance",
                          modelPreference: "Preferred model",
                          voiceId: "Voice",
                          fullBodyReferenceUrl: "Artwork",
                          explicitAvatarUrl: "Portrait",
                          portraitCrop: "Portrait crop",
                          headPosition: "Head position",
                          headSuggestion: "Head position",
                        }[field]
                      }
                    </h3>
                    {field === "images" ? (
                      <div className={styles.candidate}>
                        {initialSnapshot.fullBodyReferenceUrl && (
                          <OwnedCharacterImage
                            src={initialSnapshot.fullBodyReferenceUrl}
                            alt="Current saved artwork"
                          />
                        )}
                        {fullBodyReferenceUrl && (
                          <OwnedCharacterImage
                            src={fullBodyReferenceUrl}
                            alt="Restored draft artwork"
                          />
                        )}
                      </div>
                    ) : (
                      <>
                        <del>{JSON.stringify(initialSnapshot[field])}</del>
                        <ins>{JSON.stringify(currentSnapshot[field])}</ins>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setDraftConflicts((fields) =>
                          fields.filter((value) => value !== field),
                        )
                      }
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...currentSnapshot };
                        if (field === "images") {
                          for (const key of imageFields)
                            Object.assign(next, {
                              [key]: initialSnapshot[key],
                            });
                        } else
                          Object.assign(next, {
                            [field]: initialSnapshot[field],
                          });
                        setName(next.name);
                        setPersonality(next.personality);
                        setBackstory(next.backstory);
                        setStrategyStyle(next.strategyStyle);
                        setWerewolfStrategyStyle(next.werewolfStrategyStyle);
                        setVisualDesign(next.visualDesign);
                        setPerformanceInstructions(
                          next.performanceInstructions,
                        );
                        setModelPreference(next.modelPreference ?? "default");
                        setVoiceId(next.voiceId ?? null);
                        setPersonaKey(next.personaKey);
                        setGender(next.gender);
                        setFullBodyReferenceUrl(next.fullBodyReferenceUrl);
                        setExplicitAvatarUrl(next.explicitAvatarUrl);
                        setHeadPosition(next.headPosition);
                        setHeadSuggestion(next.headSuggestion);
                        setPortraitCrop(next.portraitCrop);
                        setDraftConflicts((fields) =>
                          fields.filter((value) => value !== field),
                        );
                      }}
                    >
                      Current
                    </button>
                  </div>
                ))}
              </section>
            )}
            {!anonymous && (
              <section className={styles.preferences}>
                <ModelPreferencePicker
                  compact
                  value={modelPreference}
                  onChange={setModelPreference}
                  disabled={submitting}
                />
                <AgentVoicePicker
                  key={String(guided)}
                  value={voiceId}
                  onChange={setVoiceId}
                  disabled={submitting}
                />
              </section>
            )}
            <div hidden={!guided} className={guided ? "contents" : "hidden"}>
              <AgentCreationChat
                key={conversationKey}
                conversation={conversation}
                onConversationChange={setConversation}
                scope={guidedScope}
                anonymous={anonymous}
                anonymousUsed={anonymousUsed}
                onAnonymousMessage={handleAnonymousMessage}
                onRequireAccount={requestAccount}
                creationTraitIds={creationTraitIds}
                onCreationTraitIdsChange={setCreationTraitIds}
                profile={{
                  name,
                  personality,
                  backstory,
                  strategyStyle,
                  werewolfStrategyStyle,
                  performanceInstructions,
                  visualDesign: visualDesign ?? "",
                  personaKey: personaKey ?? "",
                  gender,
                }}
                onGenerate={async (message, sections) =>
                  Boolean(await handleGenerate({ message, sections }))
                }
                onAppearance={async (message, operation) =>
                  Boolean(
                    await handleGenerate({
                      message,
                      appearance: true,
                      imageOperation: operation,
                    }),
                  )
                }
                busy={profileGenerating || uploading}
                blocked={
                  unreadableDraft ||
                  Boolean(pendingRestore) ||
                  submitting ||
                  (publicPreview && !authReady)
                }
                headRequired={headConfirmationRequired}
                hasImage={Boolean(fullBodyReferenceUrl)}
                onHeadshot={() =>
                  setPortraitEditorSource(
                    fullBodyReferenceUrl ??
                      portraitCrop?.sourceUrl ??
                      avatarUrl ??
                      null,
                  )
                }
                submitDisabled={submitDisabled}
                submitLabel="Review"
              />
            </div>
            <div
              hidden={guided}
              className={guided ? "hidden" : "flex flex-col gap-6"}
            >
              <nav className={styles.sectionNav} aria-label="Agent sections">
                {(["character", "strategy", "appearance"] as const).map(
                  (section) => (
                    <button
                      type="button"
                      key={section}
                      aria-pressed={advancedSection === section}
                      onClick={() => setAdvancedSection(section)}
                    >
                      {section[0].toUpperCase() + section.slice(1)}
                    </button>
                  ),
                )}
              </nav>
              {missingDetails && (
                <p className={styles.hint}>
                  Missing: {missingDetails}.{" "}
                  <button
                    type="button"
                    disabled={generationBusy}
                    onClick={() => void completeMissingDetails()}
                  >
                    Complete
                  </button>
                </p>
              )}
              <aside
                hidden={advancedSection !== "character"}
                className={styles.identity}
              >
                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <label htmlFor="agent-archetype">Archetype</label>
                    <select
                      id="agent-archetype"
                      value={personaKey ?? ""}
                      onChange={(event) =>
                        setPersonaKey(event.target.value as PersonaKey)
                      }
                    >
                      <option value="" disabled>
                        Choose an archetype
                      </option>
                      {PERSONAS.map((persona) => (
                        <option key={persona.key} value={persona.key}>
                          {persona.name}
                        </option>
                      ))}
                    </select>
                    <label
                      htmlFor="agent-name"
                      className="influence-section-title block mb-2"
                    >
                      Agent name
                    </label>
                    <input
                      id="agent-name"
                      type="text"
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        setValidationErrors((current) => ({
                          ...current,
                          name: "",
                        }));
                      }}
                      placeholder="e.g. ShadowPlay-7"
                      maxLength={AGENT_PROFILE_LIMITS.name}
                      aria-invalid={Boolean(validationErrors.name)}
                      aria-describedby={
                        validationErrors.name
                          ? "agent-name-error"
                          : "agent-name-help"
                      }
                      className="influence-field min-h-11 w-full rounded-lg px-4 py-2.5 text-base sm:text-sm"
                    />
                    <p
                      id="agent-name-help"
                      className="influence-copy-muted mt-1 text-xs"
                    >
                      The public name used in games.
                    </p>
                    {validationErrors.name && (
                      <p
                        id="agent-name-error"
                        className="mt-1 text-xs text-red-300"
                      >
                        {validationErrors.name}
                      </p>
                    )}
                  </div>

                  <fieldset
                    aria-required="true"
                    aria-describedby={
                      validationErrors.gender
                        ? "agent-gender-error"
                        : "agent-gender-help"
                    }
                  >
                    <legend className="influence-section-title mb-2">
                      Gender{" "}
                      <span className="text-red-300" aria-hidden="true">
                        *
                      </span>
                    </legend>
                    <div
                      role="radiogroup"
                      aria-label="Gender"
                      aria-required="true"
                      aria-invalid={Boolean(validationErrors.gender)}
                      className="flex gap-2"
                    >
                      {AGENT_GENDER_OPTIONS.map(({ value, label }) => (
                        <button
                          id={`agent-gender-${value}`}
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={gender === value}
                          data-selected={gender === value}
                          onClick={() => {
                            setGender(value);
                            setValidationErrors((current) => ({
                              ...current,
                              gender: "",
                            }));
                          }}
                          className="influence-selection-card min-h-11 min-w-0 flex-[1_1_auto] whitespace-nowrap rounded-lg px-2 text-sm influence-copy data-[selected=true]:text-text-primary"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p
                      id="agent-gender-help"
                      className="influence-copy-muted mt-1 text-xs"
                    >
                      Guides portrait generation.
                      {!gender &&
                        " Choose one or let AI fill it from this character."}
                    </p>
                    {validationErrors.gender && (
                      <p
                        id="agent-gender-error"
                        className="mt-1 text-xs text-red-300"
                      >
                        {validationErrors.gender}
                      </p>
                    )}
                  </fieldset>
                </div>
              </aside>

              <div className="min-w-0 space-y-6">
                <section
                  hidden={advancedSection !== "strategy"}
                  className="influence-panel rounded-2xl p-5 sm:p-6"
                >
                  <label
                    htmlFor="agent-werewolfStrategyStyle"
                    className="text-lg font-semibold text-text-primary"
                  >
                    Werewolf strategy
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setGuidedScope("werewolfStrategyStyle");
                      setGuided(true);
                      onAssistant?.();
                    }}
                  >
                    Refine
                  </button>
                  <p
                    id="werewolf-strategy-help"
                    className="mt-1 mb-4 text-sm leading-6 text-white/50"
                  >
                    Use the same character in a different game. Describe how
                    they investigate, bluff, build trust, and adapt to their
                    secret role. Leave blank to use the Werewolf approach for
                    their archetype. Your notes replace that default.
                  </p>
                  {showWerewolfComparison && strategyComparison && (
                    <StrategyDiff
                      baseline={strategyComparison.baseline}
                      working={werewolfStrategyStyle}
                      baselineLabel={strategyComparison.baselineLabel}
                      className="mb-4"
                    />
                  )}
                  <GrowingTextarea
                    id="agent-werewolfStrategyStyle"
                    value={werewolfStrategyStyle}
                    onChange={(event) =>
                      setWerewolfStrategyStyle(event.target.value)
                    }
                    maxLength={AGENT_PROFILE_LIMITS.strategyStyle}
                    aria-describedby="werewolf-strategy-help"
                    placeholder="Optional notes. Leave blank to use this archetype’s Werewolf default."
                    className="influence-field min-h-40 w-full rounded-xl px-4 py-4 text-base leading-7"
                  />
                  {validationErrors.werewolfStrategyStyle && (
                    <p className="text-xs text-red-400" role="alert">
                      {validationErrors.werewolfStrategyStyle}
                    </p>
                  )}
                  {showWerewolfComparison &&
                    strategyComparison?.requireChange && (
                      <p
                        className="mt-2 text-sm text-white/60"
                        aria-live="polite"
                      >
                        {requiredStrategyChangeMissing
                          ? "Edit the suggestion to save your own Werewolf strategy."
                          : "Your Werewolf strategy update is ready to save."}
                      </p>
                    )}
                  {!werewolfStrategyStyle.trim() && (
                    <details className="mt-3 text-sm text-white/60">
                      <summary className="cursor-pointer">
                        Preview archetype default
                      </summary>
                      <p className="mt-2 leading-6">
                        {defaultWerewolfStrategy(personaKey)}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setWerewolfStrategyStyle(
                            defaultWerewolfStrategy(personaKey),
                          )
                        }
                        className="influence-button-secondary mt-3 min-h-11 rounded-lg px-4"
                      >
                        Customize this strategy
                      </button>
                    </details>
                  )}
                </section>
                <section
                  hidden={advancedSection !== "strategy"}
                  className="influence-panel rounded-2xl p-5 sm:p-6"
                >
                  <div className="mb-4 flex items-end justify-between gap-4">
                    <div>
                      <label
                        htmlFor="agent-strategyStyle"
                        className="text-lg font-semibold tracking-tight text-text-primary"
                      >
                        Influence strategy
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setGuidedScope("strategyStyle");
                          setGuided(true);
                          onAssistant?.();
                        }}
                      >
                        Refine
                      </button>
                      <p
                        id="agent-strategy-help"
                        className="mt-1 max-w-2xl text-sm leading-6 text-white/50"
                      >
                        How this Agent builds alliances, handles votes, protects
                        itself, and changes course.
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-white/40">
                      {strategyStyle.length}/
                      {AGENT_PROFILE_LIMITS.strategyStyle}
                    </span>
                  </div>
                  <div
                    className={
                      showStrategyComparison
                        ? "grid items-start gap-4 xl:grid-cols-2 xl:items-stretch"
                        : ""
                    }
                  >
                    {showStrategyComparison && strategyComparison && (
                      <div className="order-2 min-w-0 xl:order-1">
                        <StrategyDiff
                          baseline={strategyComparison.baseline}
                          working={strategyStyle}
                          baselineLabel={strategyComparison.baselineLabel}
                          className="xl:h-[40rem] xl:overflow-hidden"
                        />
                      </div>
                    )}
                    <div className="order-1 xl:order-2">
                      <GrowingTextarea
                        id="agent-strategyStyle"
                        value={strategyStyle}
                        onChange={(event) => {
                          setStrategyStyle(event.target.value);
                          setValidationErrors((current) => ({
                            ...current,
                            strategyStyle: "",
                          }));
                        }}
                        placeholder="Describe concrete priorities, alliance tactics, voting plans, fallback moves, and when to pivot."
                        maxLength={AGENT_PROFILE_LIMITS.strategyStyle}
                        aria-invalid={Boolean(validationErrors.strategyStyle)}
                        aria-describedby={
                          validationErrors.strategyStyle
                            ? "agent-strategy-error"
                            : "agent-strategy-help"
                        }
                        className={`influence-field min-h-56 w-full rounded-xl px-4 py-4 text-base leading-7 lg:min-h-80 ${showStrategyComparison ? "xl:!h-[40rem] xl:!overflow-y-auto xl:resize-none" : ""}`}
                      />
                      {!comparingWerewolf &&
                        strategyComparison?.requireChange && (
                          <p
                            className="mt-2 min-h-5 text-xs leading-5 text-white/45"
                            aria-live="polite"
                          >
                            {requiredStrategyChangeMissing
                              ? "Edit the suggestion to save a custom Strategy update."
                              : "Custom Strategy change ready to save."}
                          </p>
                        )}
                      {validationErrors.strategyStyle && (
                        <p
                          id="agent-strategy-error"
                          className="mt-2 text-sm text-red-300"
                        >
                          {validationErrors.strategyStyle}
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                <section
                  hidden={advancedSection !== "character"}
                  className="influence-panel rounded-2xl p-5 sm:p-6"
                >
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <label
                        htmlFor="agent-personality"
                        className="text-base font-semibold text-text-primary"
                      >
                        Personality
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setGuidedScope("personality");
                          setGuided(true);
                          onAssistant?.();
                        }}
                      >
                        Refine
                      </button>
                      <p
                        id="agent-personality-help"
                        className="mt-1 text-sm leading-6 text-white/45"
                      >
                        How the Agent speaks, reacts, and behaves around other
                        players.
                      </p>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-white/40">
                      {personality.length}/{AGENT_PROFILE_LIMITS.personality}
                    </span>
                  </div>
                  <GrowingTextarea
                    id="agent-personality"
                    value={personality}
                    onChange={(event) => {
                      setPersonality(event.target.value);
                      setValidationErrors((current) => ({
                        ...current,
                        personality: "",
                      }));
                    }}
                    placeholder="Describe how your Agent behaves, speaks, and makes decisions."
                    maxLength={AGENT_PROFILE_LIMITS.personality}
                    aria-invalid={Boolean(validationErrors.personality)}
                    aria-describedby={
                      validationErrors.personality
                        ? "agent-personality-error"
                        : "agent-personality-help"
                    }
                    className="influence-field mt-4 min-h-36 w-full rounded-xl px-4 py-4 text-base leading-7"
                  />
                  {validationErrors.personality && (
                    <p
                      id="agent-personality-error"
                      className="mt-2 text-sm text-red-300"
                    >
                      {validationErrors.personality}
                    </p>
                  )}
                </section>

                <section
                  hidden={advancedSection !== "character"}
                  className="influence-panel rounded-2xl p-5 sm:p-6"
                >
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <label
                        htmlFor="agent-backstory"
                        className="text-base font-semibold text-text-primary"
                      >
                        Backstory{" "}
                        <span className="text-sm font-normal text-white/35">
                          optional
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setGuidedScope("backstory");
                          setGuided(true);
                          onAssistant?.();
                        }}
                      >
                        Refine
                      </button>
                      <p
                        id="agent-backstory-help"
                        className="mt-1 text-sm leading-6 text-white/45"
                      >
                        The history and motivation behind the Agent.
                      </p>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-white/40">
                      {backstory.length}/{AGENT_PROFILE_LIMITS.backstory}
                    </span>
                  </div>
                  <GrowingTextarea
                    id="agent-backstory"
                    value={backstory}
                    onChange={(event) => setBackstory(event.target.value)}
                    placeholder="Where did this Agent come from, and what drives them?"
                    maxLength={AGENT_PROFILE_LIMITS.backstory}
                    aria-describedby="agent-backstory-help"
                    className="influence-field mt-4 min-h-36 w-full rounded-xl px-4 py-4 text-base leading-7"
                  />
                </section>
                <section
                  hidden={advancedSection !== "appearance"}
                  className="influence-panel rounded-2xl p-5 sm:p-6"
                >
                  <label
                    htmlFor="agent-performance"
                    className="text-base font-semibold text-text-primary"
                  >
                    Character performance
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setGuidedScope("performanceInstructions");
                      setGuided(true);
                      onAssistant?.();
                    }}
                  >
                    Refine
                  </button>
                  <p
                    id="agent-performance-help"
                    className="mt-1 text-sm leading-6 text-white/45"
                  >
                    How your character carries themselves: posture, gestures,
                    mannerisms, movement and vocal delivery.
                  </p>
                  <GrowingTextarea
                    id="agent-performance"
                    value={performanceInstructions}
                    onChange={(event) =>
                      setPerformanceInstructions(event.target.value)
                    }
                    maxLength={AGENT_PROFILE_LIMITS.performanceInstructions}
                    aria-describedby="agent-performance-help"
                    className="influence-field mt-4 min-h-36 w-full rounded-xl px-4 py-4 text-base leading-7"
                  />
                  <label
                    htmlFor="agent-visual-design"
                    className="mt-5 block text-base font-semibold text-text-primary"
                  >
                    Visual design
                  </label>
                  <button
                    type="button"
                    disabled={referenceBusy}
                    onClick={() => {
                      setGuidedScope("visualDesign");
                      setGuided(true);
                      onAssistant?.();
                    }}
                  >
                    Refine
                  </button>
                  <p className="mt-1 text-sm leading-6 text-white/45">
                    Appearance, clothing and distinctive details shared by the
                    portrait and full-body reference.
                  </p>
                  <GrowingTextarea
                    id="agent-visual-design"
                    value={visualDesign ?? ""}
                    onChange={(event) => setVisualDesign(event.target.value)}
                    maxLength={8000}
                    className="influence-field mt-4 min-h-28 w-full rounded-xl px-4 py-4 text-base leading-7"
                  />
                  <div className="mt-5">
                    <h3 className="mb-3 text-sm font-semibold text-text-primary">
                      Full-body reference
                    </h3>
                    <button
                      type="button"
                      disabled={
                        generationBusy ||
                        uploading ||
                        submitting ||
                        !name.trim()
                      }
                      onClick={() => void generateReference()}
                      className="mb-3 rounded-lg border border-white/20 px-4 py-2 text-sm disabled:opacity-50"
                    >
                      {referenceBusy
                        ? "Generating…"
                        : referenceRequest.current
                          ? "Retry"
                          : "Generate"}
                    </button>
                    {referenceError && (
                      <p role="alert" className="mb-3 text-sm text-red-300">
                        {referenceError}
                      </p>
                    )}
                    <AgentImageControl
                      disabled={generationBusy || submitting}
                      onEdit={() =>
                        setPortraitEditorSource(fullBodyReferenceUrl)
                      }
                      currentUrl={fullBodyReferenceUrl}
                      persona={previewPersona}
                      name={name}
                      presentation="full-body"
                    />
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
        {!guided && headConfirmationRequired && (
          <p role="status" className="text-sm text-amber-200">
            Confirm the head and portrait before saving this new full-body
            image.{" "}
            <button
              type="button"
              className="underline"
              onClick={() =>
                setPortraitEditorSource(
                  fullBodyReferenceUrl ?? avatarUrl ?? null,
                )
              }
            >
              Review character images
            </button>
            . Save draft keeps your work in this tab.
          </p>
        )}

        {portraitEditorSource && (
          <CharacterPortraitEditor
            key={portraitEditorSource}
            fullScreen={guided}
            sourceUrl={portraitEditorSource}
            initialCrop={portraitCrop}
            initialHead={headPosition ?? headSuggestion}
            confirmHead={portraitEditorSource === fullBodyReferenceUrl}
            name={name}
            onClose={() => setPortraitEditorSource(null)}
            onPendingChange={setUploading}
            onFailure={() => setUnfinishedReplacement(true)}
            onApply={(result) => {
              setExplicitAvatarUrl(result.avatarUrl);
              setPortraitCrop(result.portraitCrop);
              if (portraitEditorSource === fullBodyReferenceUrl) {
                setHeadPosition(result.headPosition);
                setHeadSuggestion(null);
              }
              setUnfinishedReplacement(false);
              setReferenceError(null);
            }}
          />
        )}
        {!guided && (generationBusy || uploading) && (
          <p role="status" className="mt-4 text-sm text-white/60">
            Preparation is in progress. Save draft keeps changes in this tab; it
            does not update your Agent.
          </p>
        )}
        {generationNotice && (
          <p role="status" className="mt-4 text-sm text-amber-200">
            {generationNotice}
          </p>
        )}
        {draftStorageError && (
          <p
            role="status"
            className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100/80"
          >
            {draftStorageError}
          </p>
        )}

        {guided && (aiError || referenceError) && (
          <p
            role="alert"
            className="shrink-0 bg-red-400/10 px-4 py-2 text-sm text-red-300"
          >
            {aiError || referenceError}
            {referenceRequest.current &&
              " Send again to retry the unfinished image request."}
          </p>
        )}
        {guided && Object.values(validationErrors).some(Boolean) && (
          <p role="alert" className="shrink-0 px-4 py-2 text-sm text-red-300">
            {Object.values(validationErrors).filter(Boolean).join(" ")}
          </p>
        )}
        {referenceError && (
          <p role="alert">
            {referenceError}
            {imageRequest && (
              <button
                type="button"
                onClick={() => void retrySelectedJob()}
                disabled={referenceBusy}
              >
                Retry
              </button>
            )}
          </p>
        )}
        {saveError && <p role="alert">{saveError}</p>}
        <footer className={styles.footer}>
          <span>
            {dirty
              ? draftPersisted
                ? "Draft saved"
                : "Saving draft…"
              : "No changes"}
          </span>
          <button
            type="button"
            onClick={() => {
              void saveLocalDraft().then((saved) => {
                if (saved) onCancel();
              });
            }}
          >
            Close
          </button>
          <button type="button" onClick={requestCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.primary}
            disabled={submitDisabled}
          >
            Review
          </button>
        </footer>
        {reviewOpen && (
          <section
            ref={reviewRef}
            tabIndex={-1}
            className={styles.review}
            aria-label="Review changes"
          >
            <h2>{isEditing ? "Review changes" : "Review character"}</h2>
            {(
              [
                "name",
                "gender",
                "personaKey",
                "personality",
                "backstory",
                "strategyStyle",
                "werewolfStrategyStyle",
                "visualDesign",
                "performanceInstructions",
              ] as const
            )
              .filter(
                (field) => currentSnapshot[field] !== initialSnapshot[field],
              )
              .map((field) => (
                <div className={styles.change} key={field}>
                  <header>
                    <strong>
                      {
                        {
                          name: "Name",
                          gender: "Gender",
                          personaKey: "Archetype",
                          personality: "Personality",
                          backstory: "Backstory",
                          strategyStyle: "Influence strategy",
                          werewolfStrategyStyle: "Werewolf strategy",
                          visualDesign: "Appearance",
                          performanceInstructions: "Performance",
                        }[field]
                      }
                    </strong>
                    <button
                      type="button"
                      onClick={() => {
                        const setters = {
                          name: setName,
                          gender: setGender,
                          personaKey: setPersonaKey,
                          personality: setPersonality,
                          backstory: setBackstory,
                          strategyStyle: setStrategyStyle,
                          werewolfStrategyStyle: setWerewolfStrategyStyle,
                          visualDesign: setVisualDesign,
                          performanceInstructions: setPerformanceInstructions,
                        };
                        const reset = setters[field] as (
                          value: (typeof initialSnapshot)[typeof field],
                        ) => void;
                        reset(initialSnapshot[field]);
                      }}
                    >
                      Undo
                    </button>
                  </header>
                  <del>{initialSnapshot[field] || "Not set"}</del>
                  <ins>{currentSnapshot[field] || "Cleared"}</ins>
                </div>
              ))}
            {JSON.stringify(modelPreference) !==
              JSON.stringify(initialSnapshot.modelPreference) && (
              <div className={styles.change}>
                <header>
                  <strong>Preferred model</strong>
                  <button
                    type="button"
                    onClick={() =>
                      setModelPreference(
                        initialSnapshot.modelPreference ?? "default",
                      )
                    }
                  >
                    Undo
                  </button>
                </header>
                <del>
                  {agentModelLabel(initialSnapshot.modelPreference) ??
                    "House choice"}
                </del>
                <ins>{agentModelLabel(modelPreference) ?? "House choice"}</ins>
              </div>
            )}
            {voiceId !== (initialSnapshot.voiceId ?? null) && (
              <div className={styles.change}>
                <header>
                  <strong>Voice</strong>
                  <button
                    type="button"
                    onClick={() => setVoiceId(initialSnapshot.voiceId ?? null)}
                  >
                    Undo
                  </button>
                </header>
                <del>
                  {PLAYER_VOICES.find(
                    (voice) => voice.id === initialSnapshot.voiceId,
                  )?.name ?? "Automatic"}
                </del>
                <ins>
                  {PLAYER_VOICES.find((voice) => voice.id === voiceId)?.name ??
                    "Automatic"}
                </ins>
              </div>
            )}
            {(fullBodyReferenceUrl !== initialSnapshot.fullBodyReferenceUrl ||
              avatarUrl !== initialSnapshot.explicitAvatarUrl ||
              JSON.stringify(portraitCrop) !==
                JSON.stringify(initialSnapshot.portraitCrop)) && (
              <div className={styles.change}>
                <h3>Artwork and portrait</h3>
                <div className={styles.candidate}>
                  {initialSnapshot.explicitAvatarUrl && (
                    <OwnedCharacterImage
                      src={initialSnapshot.explicitAvatarUrl}
                      alt="Previous portrait"
                    />
                  )}
                  {avatarUrl && (
                    <OwnedCharacterImage
                      src={avatarUrl}
                      alt="Selected portrait"
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFullBodyReferenceUrl(
                      initialSnapshot.fullBodyReferenceUrl,
                    );
                    setExplicitAvatarUrl(initialSnapshot.explicitAvatarUrl);
                    setPortraitCrop(initialSnapshot.portraitCrop);
                    setHeadPosition(initialSnapshot.headPosition);
                  }}
                >
                  Undo
                </button>
              </div>
            )}
            {referenceBusy && (
              <p role="status">
                Image preparation continues. This submission uses the selected
                artwork.
              </p>
            )}
            <p className={styles.hint}>
              After saving, the submission is reviewed. The last accepted
              version stays available.
            </p>
            <div className={styles.footer}>
              <button type="button" onClick={() => setReviewOpen(false)}>
                Back
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={submitDisabled}
                onClick={() => void submitDraft()}
              >
                {submitting ? "Saving…" : isEditing ? "Save" : "Create"}
              </button>
            </div>
          </section>
        )}

        {confirmDiscard && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            role="presentation"
          >
            <section
              ref={discardDialog}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setConfirmDiscard(false);
                }
                if (event.key === "Tab") {
                  const buttons =
                    discardDialog.current?.querySelectorAll<HTMLButtonElement>(
                      "button",
                    );
                  if (!buttons?.length) return;
                  const first = buttons[0]!,
                    last = buttons[buttons.length - 1]!;
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                  } else if (
                    !event.shiftKey &&
                    document.activeElement === last
                  ) {
                    event.preventDefault();
                    first.focus();
                  }
                }
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="discard-agent-title"
              className="influence-modal w-full max-w-md rounded-2xl p-6"
            >
              <h2
                id="discard-agent-title"
                className="text-lg font-semibold text-text-primary"
              >
                Discard this draft?
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/55">
                The draft will be deleted from your account and this tab.
                Unselected artwork will be discarded.
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDiscard(false)}
                  className="influence-button-secondary min-h-11 flex-1 rounded-lg px-4 text-sm"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={confirmCancel}
                  className="min-h-11 flex-1 rounded-lg border border-red-300/25 bg-red-400/10 px-4 text-sm font-semibold text-red-200 hover:bg-red-400/15"
                >
                  Discard
                </button>
              </div>
            </section>
          </div>
        )}
      </fieldset>
    </form>
  );
}

function agentSaveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to save Agent.";
}
