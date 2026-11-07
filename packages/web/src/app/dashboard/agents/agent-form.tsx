"use client";
import {
  AgentGenerations,
  useAgentGenerations,
  type AgentGeneration,
} from "./agent-generations";
import { captureProductEvent } from "@/lib/product-analytics";
import { agentModelLabel } from "@/components/agent-model-label";
import { PLAYER_VOICES } from "@influence/engine/voice-catalog";
import { OwnedCharacterImage } from "@/components/owned-character-image";
import { AgentVoicePicker } from "./voice-audition-picker";

import { ArchetypePicker } from "./archetype-picker";
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
import { GrowingTextarea } from "./growing-textarea";
import { StrategyDiff } from "./strategy-diff";
import styles from "./agent-workspace.module.css";
import {
  AgentIssueNotice,
  useAgentIssue,
  type AgentIssue,
} from "./agent-issue";
import { AgentWorkspacePanel } from "./agent-workspace-panel";
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
  const [activityOpen, setActivityOpen] = useState(false);
  const [conversation, setConversation] = useState<CharacterConversation>();
  const [conversationKey, setConversationKey] = useState(0);
  const [advancedSection, setAdvancedSection] = useState<
    "character" | "strategy" | "appearance"
  >("character");
  const referenceEpoch = useRef(0);
  const reviewRef = useRef<HTMLElement>(null);
  const [guidedScope, setGuidedScope] = useState<
    { section: CharacterSection } | undefined
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
  const [referenceError, setReferenceError] = useAgentIssue("artwork");
  const referenceRequest = useRef<{
    agentId?: string;
    draftScope: string;
    operation: "create" | "edit";
    requestId: string;
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
  const [saveError, setSaveError] = useAgentIssue("save");
  const [aiError, setAiError] = useAgentIssue("assistant");
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
  const [draftStorageError, setDraftStorageError] = useAgentIssue("draft");
  const discardInFlight = useRef(false);
  const [discarding, setDiscarding] = useState(false);
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
  const [generationNotice, setGenerationNotice] = useAgentIssue("assistant");
  const generationBusy = profileGenerating || referenceBusy;
  useEffect(
    () => () => {
      generationEpoch.current += 1;
      referenceEpoch.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (!reviewOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    reviewRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [reviewOpen]);

  function beginGeneration() {
    const epoch = ++generationEpoch.current;
    setGenerationDeadline(Date.now() + GENERATION_TIMEOUT_MS);
    setGenerationNotice(null);
    return epoch;
  }

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
  useEffect(() => {
    if (reviewOpen && !dirty) setReviewOpen(false);
  }, [reviewOpen, dirty]);
  const anonymousDraftKey = `influence:agent-editor:${DRAFT_VERSION}:anonymous:${draftScope}`;
  const draftStorageKey = draftOwner
    ? `influence:agent-editor:${DRAFT_VERSION}:${draftOwner}:${draftScope}`
    : null;

  const [remoteReady, setRemoteReady] = useState(false);
  const draftRecovering = authenticated && !remoteReady;
  const generations = useAgentGenerations();
  const imageGenerationBlocked =
    generations.loading ||
    !!generations.error ||
    generations.rows.some((row) => row.blocksGeneration);

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
            setDraftStorageError("draft_unreadable");
          }
        }
        setRemoteReady(true);
      })
      .catch((cause) => {
        if (active) {
          remoteBlocked.current = true;
          setDraftStorageError(cause, "draft_load_failed");
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
    setDraftStorageError,
  ]);
  const persistRemote = useCallback(
    (document: StoredEditorDraft): Promise<void> => {
      if (!authenticated) return Promise.resolve();
      if (!remoteReady)
        return Promise.reject(
          new ApiError(503, "Draft recovery unavailable", "draft_load_failed"),
        );
      const next = remoteWrites.current.then(async () => {
        if (discardInFlight.current) return;
        if (boundAccount.current !== activeAccount.current)
          throw new Error("account_changed");
        const result = await apiFetch<{ version: string }>(remotePath, {
          method: "PUT",
          body: JSON.stringify({ version: remoteVersion.current, document }),
        });
        remoteVersion.current = result.version;
        remoteBlocked.current = false;
      });
      remoteWrites.current = next.catch((cause) => {
        remoteBlocked.current = true;
        setDraftStorageError(cause);
      });
      return next;
    },
    [authenticated, remoteReady, remotePath, setDraftStorageError],
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
    [draftStorageKey, setGenerationNotice],
  );
  useEffect(() => {
    if (!generationDeadline) return;
    const timer = window.setTimeout(
      () => interruptGeneration("assistant_timeout"),
      Math.max(0, generationDeadline - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [generationDeadline, interruptGeneration]);

  useEffect(() => {
    if (!draftStorageKey) return;
    const storedRead = readEditorStorage(draftStorageKey);
    if (!storedRead.ok) {
      setDraftStorageError("draft_local_unavailable");
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
        setDraftStorageError("draft_unreadable");
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
    setDraftStorageError,
  ]);

  useEffect(() => {
    if (
      !draftStorageKey ||
      discarding ||
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
        setDraftStorageError("draft_local_unavailable");
      }
      return;
    }
    const timeout = window.setTimeout(() => {
      if (discardInFlight.current) return;
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
        void persistRemote(stored)
          .then(() => {
            setDraftPersisted(true);
            setDraftStorageError(null);
          })
          .catch(() => setDraftPersisted(false));
      } else {
        setDraftStorageError("draft_failed");
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [
    setDraftStorageError,
    discarding,
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
    if (!pendingRestore || !remoteReady || restoreAlternatives) return;
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
          .catch((cause) => setReferenceError(cause))
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
      setGenerationNotice("assistant_timeout");
    submission.current = pendingRestore.submission;
    setPendingRestore(null);
    setActivityOpen(conflicts.length > 0);
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
    setAiError(null);
    setReferenceError(null);
    setSaveError(null);
    setDraftStorageError(null);
    setGenerationNotice(null);
    setReviewOpen(false);
    return true;
  }

  async function deleteRemoteDraft() {
    await remoteWrites.current;
    if (authenticated)
      await apiFetch(remotePath, {
        method: "DELETE",
        body: JSON.stringify({ version: remoteVersion.current }),
      });
    remoteVersion.current = null;
  }

  async function discardArtwork() {
    const ids = new Set([
      imageRequest,
      referenceRequest.current?.requestId,
      candidateImage?.requestId,
      pendingRestore?.referenceRequest?.requestId,
      pendingRestore?.candidateImage?.requestId,
    ]);
    for (const id of ids)
      if (typeof id === "string") {
        try {
          await apiFetch(
            "/api/agent-profiles/visual-references/" + id + "/decision",
            { method: "POST", body: JSON.stringify({ decision: "discarded" }) },
          );
        } catch (cause) {
          if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
        }
      }
  }

  async function clearStoredDraft() {
    if (discardInFlight.current) return;
    discardInFlight.current = true;
    setDiscarding(true);
    generationEpoch.current++;
    referenceEpoch.current++;
    try {
      await deleteRemoteDraft();
      await discardArtwork();
    } catch (cause) {
      setDraftStorageError(cause, "discard_failed");
      discardInFlight.current = false;
      setDiscarding(false);
      return;
    }
    if (!retireDraft()) {
      setDraftStorageError("discard_failed");
      discardInFlight.current = false;
      setDiscarding(false);
      return;
    }
    discardInFlight.current = false;
    setDiscarding(false);
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
    if (draftRecovering || generationBusy || uploading || submitting) return;
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
    if (
      draftRecovering ||
      generationBusy ||
      uploading ||
      submitting ||
      profileRequestBlocked
    )
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
      if (epoch === generationEpoch.current) setAiError(error);
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
      setAiError("request_unavailable");
      return;
    }
    if (!incoming.value) {
      profileRequestChecked.current = true;
      return;
    }
    const drafts = findAgentDrafts(account.id, initial.id);
    if (!drafts.ok) {
      profileRequestChecked.current = true;
      setAiError("draft_load_failed");
      return;
    }
    if (!draftReady && !drafts.scopes.length) return;
    profileRequestChecked.current = true;
    setChangeRequest(incoming.value);
    if (drafts.scopes.length || pendingRestore) {
      setProfileRequestBlocked(true);
      setAiError("draft_pending");
      return;
    }
    if (!removeEditorStorage(key)) {
      setProfileRequestBlocked(true);
      setAiError("request_unavailable");
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
    if (draftRecovering) return false;
    if ((options?.appearance || options?.images) && imageGenerationBlocked) {
      generations.refresh();
      return false;
    }
    if (anonymous) {
      requestAccount();
      return false;
    }
    if (boundAccount.current !== activeAccount.current) {
      setAiError("account_changed");
      return false;
    }
    const request = options?.message ?? changeRequest;
    if (!request.trim() && (isEditing || creationTraitIds.length === 0)) {
      setAiError("assistant_input");
      return;
    }
    const savedReference = draftStorageKey
      ? readEditorStorage(`${draftStorageKey}:visual-reference`)
      : null;
    if (
      (options?.appearance || options?.images) &&
      (referenceRequest.current || (savedReference?.ok && savedReference.value))
    ) {
      setAiError("image_pending");
      return;
    }
    const epoch = beginGeneration();
    setProfileGenerating(true);
    setAiError(null);
    setSaveError(null);
    setAssistantNote(null);
    try {
      const params: GeneratePersonalityParams = {
        selectedFields: options?.appearance
          ? ["visualDesign"]
          : (options?.sections as CharacterField[] | undefined),
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
      const editedFields = params.selectedFields?.length
        ? characterEditFields(
            params.existingProfile ?? {},
            params.selectedFields,
          )
        : null;
      const change = (section: CharacterSection) =>
        editedFields ? editedFields.includes(section) : !options?.appearance;
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
      if (change("visualDesign")) setVisualDesign(result.visualDesign);
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
            name: change("name") ? result.name : name,
            personaKey: change("personaKey")
              ? result.personaKey
              : (personaKey ?? "strategic"),
            performanceInstructions: change("performanceInstructions")
              ? result.performanceInstructions
              : performanceInstructions,
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
      setAiError(error);
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

    if (submitDisabled) return;
    captureProductEvent("agent_editor_review_opened", { editing: isEditing });
    setReviewOpen(true);
  }

  async function submitDraft() {
    if (anonymous) {
      requestAccount();
      return;
    }
    if (boundAccount.current !== activeAccount.current) {
      setSaveError("account_changed");
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
        setDraftStorageError("discard_failed");
      }
    } catch (error) {
      setSaveError(error);
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
    if (discardInFlight.current) return;
    discardInFlight.current = true;
    setDiscarding(true);
    generationEpoch.current++;
    referenceEpoch.current++;
    try {
      await deleteRemoteDraft();
      await discardArtwork();
    } catch (cause) {
      setDraftStorageError(cause, "discard_failed");
      discardInFlight.current = false;
      setDiscarding(false);
      return;
    }
    if (!retireDraft()) {
      setDraftStorageError("discard_failed");
      setConfirmDiscard(false);
      discardInFlight.current = false;
      setDiscarding(false);
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
  const missingRequired = [
    !name.trim() && "name",
    !personality.trim() && "personality",
    !gender && "gender",
  ].filter((field): field is string => Boolean(field));
  const artworkBlocked = Boolean(
    referenceError && ["discard", "reload"].includes(referenceError.recovery),
  );
  const submitDisabled =
    draftRecovering ||
    !dirty ||
    missingRequired.length > 0 ||
    unreadableDraft ||
    Boolean(pendingRestore) ||
    draftConflicts.length > 0 ||
    submitting ||
    profileGenerating ||
    ((referenceBusy || Boolean(candidateImage)) && !fullBodyReferenceUrl) ||
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
      generations.retire(result.requestId, "reference");
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
        cause,
        decision === "selected"
          ? "artwork_select_failed"
          : "artwork_discard_failed",
      );
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
      errorCode: string | null;
      retryable: boolean;
    }>(
      "/api/agent-profiles/visual-references/" +
        encodeURIComponent(imageRequest),
    )
      .then((job) => {
        if (job.status === "ready") setCandidateImage(job.result);
        else if (job.status === "failed")
          setReferenceError(
            new ApiError(
              409,
              job.error ?? "Image preparation failed",
              job.errorCode ?? undefined,
              job.retryable,
            ),
          );
      })
      .catch((cause) => setReferenceError(cause));
  }, [imageRequest, remoteReady, setReferenceError]);
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
      setReferenceError(cause);
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
        errorCode: string | null;
        retryable: boolean;
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
        throw new ApiError(409, "Artwork changed", "artwork_changed");
      if (job.status === "failed")
        throw new ApiError(
          409,
          job.error ?? "Image preparation failed",
          job.errorCode ?? undefined,
          job.retryable,
        );
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
  }

  async function cancelGeneration(row: AgentGeneration) {
    generations.retire(row.id, row.source);
    if (
      row.id !== referenceRequest.current?.requestId &&
      row.id !== candidateImage?.requestId &&
      row.id !== imageRequest
    )
      return;
    ++referenceEpoch.current;
    referenceRequest.current = null;
    setReferenceBusy(false);
    setCandidateImage(null);
    setUnfinishedReplacement(false);
    setGenerationDeadline(null);
    setReferenceError(null);
    if (draftStorageKey)
      removeEditorStorage(draftStorageKey + ":visual-reference");
  }
  async function reviewGeneration(row: AgentGeneration) {
    try {
      const job = await apiFetch<{
        status: string;
        result: CharacterImageDraft | null;
      }>("/api/agent-profiles/visual-references/" + row.id);
      if (job.status !== "ready" || !job.result)
        throw new ApiError(409, "Artwork changed", "artwork_changed");
      setCandidateImage(job.result);
    } catch (cause) {
      setReferenceError(cause);
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
      setReferenceError("draft_conflict");
      return false;
    }
    if (imageGenerationBlocked) {
      generations.refresh();
      return false;
    }
    if (!remoteReady || remoteBlocked.current) {
      setReferenceError("draft_load_failed");
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
        setReferenceError("draft_unreadable");
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
      setDraftStorageError("draft_local_unavailable");
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
      if (epoch !== referenceEpoch.current) return false;
      const existing = await apiFetch<{ status: string }>(
        "/api/agent-profiles/visual-references/" +
          referenceRequest.current!.requestId,
      ).catch((cause) => {
        if (cause instanceof ApiError && cause.status === 404) return null;
        throw cause;
      });
      if (epoch !== referenceEpoch.current) return false;
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
      if (error instanceof ApiError && error.code === "generation_pending")
        generations.refresh();
      else setReferenceError(error);
      return false;
    } finally {
      if (epoch === referenceEpoch.current) setReferenceBusy(false);
    }
  }

  async function saveLocalDraft() {
    if (unreadableDraft) {
      setDraftStorageError("draft_unreadable");
      return false;
    }
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
    )
      return true;
    if (!draftStorageKey) {
      setDraftStorageError("sign_in");
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
      setDraftStorageError(localSaved ? null : "draft_local_unavailable");
      return true;
    } catch (cause) {
      setDraftStorageError(cause);
      return false;
    }
  }

  const activeIssue =
    (draftStorageError?.code !== "draft_local_unavailable"
      ? draftStorageError
      : null) ??
    saveError ??
    generations.error ??
    referenceError ??
    aiError ??
    generationNotice ??
    draftStorageError;
  function recoverIssue(issue: AgentIssue) {
    if (issue.code === "generations_load_failed") {
      generations.refresh();
      return;
    }
    if (issue.recovery === "discard") {
      setReviewOpen(false);
      setConfirmDiscard(true);
      return;
    }
    if (issue.recovery === "reload") {
      window.location.reload();
      return;
    }
    if (issue.recovery === "sign_in") {
      requestAccount();
      return;
    }
    if (issue.scope === "draft") {
      void saveLocalDraft();
      return;
    }
    if (issue.scope === "save") {
      void submitDraft();
      return;
    }
    if (issue.scope === "artwork") {
      void (imageRequest ? retrySelectedJob() : generateReference());
    }
  }
  const issueNotice = activeIssue && (
    <AgentIssueNotice
      issue={activeIssue}
      onAction={
        reviewOpen &&
        activeIssue.scope === "save" &&
        activeIssue.recovery === "retry"
          ? undefined
          : () => recoverIssue(activeIssue)
      }
      agentId={initial?.id}
      requestId={referenceRequest.current?.requestId ?? imageRequest}
    />
  );

  const moderationState =
    initial?.ownerContent?.reviewState ?? initial?.reviewState;
  const moderationLabel =
    moderationState === "accepted" || !initial?.ownerContent?.submitted
      ? null
      : initial.ownerContent.submitted.disposition === "rejected"
        ? "Changes need revision"
        : moderationState === "reviewing"
          ? "Reviewing"
          : moderationState === "held"
            ? "Held for moderation"
            : null;
  const currentGeneration = generations.rows.find((row) =>
    initial?.id ? row.agentId === initial.id : row.draftScope === draftScope,
  );
  const currentGenerationLabel = currentGeneration
    ? currentGeneration.status === "ready"
      ? "Image ready"
      : currentGeneration.status === "stopped"
        ? "Generation stopped"
        : currentGeneration.status === "queued"
          ? "Queued"
          : "Preparing image"
    : null;
  const activityCount =
    generations.rows.length +
    Number(Boolean(activeIssue)) +
    Number(
      Boolean(pendingRestore || restoreAlternatives || draftConflicts.length),
    ) +
    Number(Boolean(moderationLabel)) +
    Number(headConfirmationRequired);

  const preferences = !anonymous ? (
    <section className={styles.preferences} aria-label="Model and voice">
      <ModelPreferencePicker
        compact
        value={modelPreference}
        onChange={setModelPreference}
        disabled={submitting || draftRecovering}
      />
      <AgentVoicePicker
        value={voiceId}
        onChange={setVoiceId}
        disabled={submitting || draftRecovering}
      />
    </section>
  ) : null;

  return (
    <form
      data-agent-workspace
      onSubmit={handleSubmit}
      className={styles.workspace}
      data-editing={isEditing}
      data-mode={guided ? "guided" : "advanced"}
      data-has-art={Boolean(
        fullBodyReferenceUrl || avatarUrl || candidateImage || referenceBusy,
      )}
    >
      <fieldset disabled={submitting || discarding} className="contents">
        <legend className="sr-only">Agent draft</legend>
        <header className={styles.heading}>
          <h1>{name || (isEditing ? "Edit agent" : "Create your agent")}</h1>
          <div className={styles.headerActions}>
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
            <button
              type="button"
              onClick={() => {
                if (pendingRestore || restoreAlternatives || unreadableDraft) {
                  onCancel();
                  return;
                }
                void saveLocalDraft().then((saved) => {
                  if (saved) onCancel();
                });
              }}
            >
              Close
            </button>
          </div>
        </header>
        <div className={styles.layout}>
          <aside className={styles.art}>
            {" "}
            <div className={styles.artStage}>
              {candidateImage ? null : fullBodyReferenceUrl || avatarUrl ? (
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
              ) : null}
              {candidateImage && (
                <div className={styles.candidateReady}>
                  <h2>Artwork ready</h2>
                  <div
                    className={styles.artComparison}
                    data-compare={Boolean(fullBodyReferenceUrl || avatarUrl)}
                  >
                    {(fullBodyReferenceUrl || avatarUrl) && (
                      <figure>
                        <OwnedCharacterImage
                          src={
                            fullBodyReferenceUrl ===
                            initial?.fullBodyReferenceUrl
                              ? (initial?.transparentBodyUrl ??
                                fullBodyReferenceUrl ??
                                avatarUrl!)
                              : (fullBodyReferenceUrl ?? avatarUrl!)
                          }
                          alt="Current selected artwork"
                        />
                        <figcaption>Current</figcaption>
                      </figure>
                    )}
                    <figure>
                      <OwnedCharacterImage
                        src={candidateImage.fullBodyReferenceUrl}
                        alt="New artwork candidate"
                      />
                      <figcaption>New</figcaption>
                    </figure>
                  </div>
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
                  <div className={styles.footerActions}>
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
                </div>
              )}
            </div>
            <div className={styles.artActions}>
              <button
                type="button"
                disabled={
                  draftRecovering ||
                  imageGenerationBlocked ||
                  unreadableDraft ||
                  Boolean(pendingRestore) ||
                  referenceBusy ||
                  artworkBlocked ||
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
                  disabled={referenceBusy || artworkBlocked || submitting}
                  onClick={() => {
                    setGuidedScope({ section: "visualDesign" });
                    setGuided(true);
                    onAssistant?.();
                  }}
                >
                  Revise
                </button>
              )}
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
          </aside>
          <div className={styles.content}>
            <div
              hidden={!guided}
              className={guided ? styles.guidedContent : "hidden"}
            >
              <AgentCreationChat
                key={conversationKey}
                conversation={conversation}
                onConversationChange={setConversation}
                scope={guidedScope}
                onGenderChange={(value) => {
                  setGender(value);
                  setValidationErrors((current) => ({
                    ...current,
                    gender: "",
                  }));
                }}
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
                  draftRecovering ||
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
                onIssue={setAiError}
                editing={isEditing}
                preferences={guided ? preferences : null}
              />
            </div>
            <div
              hidden={guided}
              className={guided ? "hidden" : styles.advancedContent}
            >
              <div className={styles.tabHeader}>
                <div
                  className={styles.sectionNav}
                  role="tablist"
                  aria-label="Agent sections"
                  onKeyDown={(event) => {
                    const sections = [
                      "character",
                      "strategy",
                      "appearance",
                    ] as const;
                    const index = sections.indexOf(advancedSection);
                    const next =
                      event.key === "ArrowRight"
                        ? (index + 1) % 3
                        : event.key === "ArrowLeft"
                          ? (index + 2) % 3
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? 2
                              : null;
                    if (next === null) return;
                    event.preventDefault();
                    setAdvancedSection(sections[next]!);
                    document
                      .getElementById(`agent-tab-${sections[next]}`)
                      ?.focus();
                  }}
                >
                  {(["character", "strategy", "appearance"] as const).map(
                    (section) => (
                      <button
                        type="button"
                        key={section}
                        role="tab"
                        id={`agent-tab-${section}`}
                        aria-controls="agent-editor-panel"
                        aria-selected={advancedSection === section}
                        tabIndex={advancedSection === section ? 0 : -1}
                        onClick={() => setAdvancedSection(section)}
                      >
                        {section[0].toUpperCase() + section.slice(1)}
                      </button>
                    ),
                  )}
                </div>
                {missingDetails &&
                  (!name.trim() || !personality.trim() || !gender) && (
                    <button
                      type="button"
                      className={styles.complete}
                      disabled={generationBusy}
                      onClick={() => void completeMissingDetails()}
                    >
                      Complete
                    </button>
                  )}
              </div>
              <div
                id="agent-editor-panel"
                role="tabpanel"
                aria-labelledby={`agent-tab-${advancedSection}`}
                tabIndex={0}
                className={styles.tabPanel}
              >
                <aside
                  hidden={advancedSection !== "character"}
                  className={styles.identity}
                >
                  <div className="grid gap-5 lg:grid-cols-2">
                    <div>
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
                        id={
                          validationErrors.name
                            ? "agent-name-error"
                            : "agent-name-help"
                        }
                        className={styles.fieldHint}
                        data-error={Boolean(validationErrors.name)}
                      >
                        {validationErrors.name ||
                          "The public name used in games."}
                      </p>
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
                        id={
                          validationErrors.gender
                            ? "agent-gender-error"
                            : "agent-gender-help"
                        }
                        className={styles.fieldHint}
                        data-error={Boolean(validationErrors.gender)}
                      >
                        {validationErrors.gender ||
                          "Guides portrait generation. Choose one or let AI fill it."}
                      </p>
                    </fieldset>
                    <ArchetypePicker
                      id="agent-archetype"
                      value={personaKey}
                      onChange={setPersonaKey}
                      disabled={generationBusy || submitting}
                    />
                  </div>
                </aside>

                <div className={styles.fields}>
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
                      className={styles.refineLink}
                      aria-label="Refine Werewolf strategy"
                      onClick={() => {
                        setGuidedScope({ section: "werewolfStrategyStyle" });
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
                    <p
                      aria-hidden={!validationErrors.werewolfStrategyStyle}
                      className={styles.fieldError}
                      role={
                        validationErrors.werewolfStrategyStyle
                          ? "alert"
                          : undefined
                      }
                    >
                      {validationErrors.werewolfStrategyStyle}
                    </p>
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
                          className={styles.refineLink}
                          aria-label="Refine Influence strategy"
                          onClick={() => {
                            setGuidedScope({ section: "strategyStyle" });
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
                          How this Agent builds alliances, handles votes,
                          protects itself, and changes course.
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
                        <p
                          aria-hidden={!validationErrors.strategyStyle}
                          id="agent-strategy-error"
                          className={styles.fieldError}
                        >
                          {validationErrors.strategyStyle}
                        </p>
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
                          className={styles.refineLink}
                          aria-label="Refine Personality"
                          onClick={() => {
                            setGuidedScope({ section: "personality" });
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
                    <p
                      aria-hidden={!validationErrors.personality}
                      id="agent-personality-error"
                      className={styles.fieldError}
                    >
                      {validationErrors.personality}
                    </p>
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
                          className={styles.refineLink}
                          aria-label="Refine Backstory"
                          onClick={() => {
                            setGuidedScope({ section: "backstory" });
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
                      className={styles.refineLink}
                      aria-label="Refine Performance"
                      onClick={() => {
                        setGuidedScope({ section: "performanceInstructions" });
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
                      className={styles.refineLink}
                      aria-label="Refine Appearance"
                      disabled={referenceBusy}
                      onClick={() => {
                        setGuidedScope({ section: "visualDesign" });
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
                          draftRecovering ||
                          imageGenerationBlocked ||
                          generationBusy ||
                          artworkBlocked ||
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
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
        {!guided && preferences}

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
        <footer className={styles.editorFooter} aria-label="Editor actions">
          <div className={styles.footerStatus}>
            {activeIssue && !reviewOpen && !activityOpen ? (
              issueNotice
            ) : (
              <>
                <div role="status" className={styles.footerMessage}>
                  {restoreAlternatives ? (
                    <>
                      <span>Two drafts differ </span>
                      <button
                        type="button"
                        aria-label="Choose draft"
                        onClick={() => setActivityOpen(true)}
                      >
                        Choose
                      </button>
                    </>
                  ) : pendingRestore ? (
                    activityOpen ? (
                      "Draft available"
                    ) : (
                      <button
                        type="button"
                        disabled={!remoteReady}
                        onClick={applyDraft}
                      >
                        Resume
                      </button>
                    )
                  ) : draftConflicts.length ? (
                    <>
                      <span>Draft conflicts </span>
                      <button
                        type="button"
                        aria-label="Resolve draft conflicts"
                        onClick={() => setActivityOpen(true)}
                      >
                        Resolve
                      </button>
                    </>
                  ) : profileGenerating ? (
                    "Updating draft text…"
                  ) : uploading || referenceBusy ? (
                    <AgentOperationActivity
                      stage={uploading ? "upload" : referenceStage}
                      startedAt={referenceStartedAt}
                    />
                  ) : headConfirmationRequired ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPortraitEditorSource(
                          fullBodyReferenceUrl ?? avatarUrl ?? null,
                        )
                      }
                    >
                      Confirm
                    </button>
                  ) : currentGenerationLabel ? (
                    <span>{currentGenerationLabel}</span>
                  ) : generations.loading ? (
                    "Checking image requests…"
                  ) : moderationLabel ? (
                    <span>{moderationLabel}</span>
                  ) : dirty && missingRequired.length ? (
                    <>
                      <span>Required fields </span>
                      <button
                        type="button"
                        aria-label="Complete required fields"
                        onClick={() => setActivityOpen(true)}
                      >
                        Complete
                      </button>
                    </>
                  ) : (
                    ""
                  )}
                </div>
                <span>
                  {draftRecovering && !draftStorageError
                    ? "Loading draft…"
                    : pendingRestore || restoreAlternatives
                      ? "Draft available"
                      : dirty
                        ? draftPersisted
                          ? "Draft saved"
                          : draftStorageError
                            ? "Draft not saved"
                            : "Saving draft…"
                        : "No changes"}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            className={styles.activityTrigger}
            aria-label="Activity"
            aria-haspopup="dialog"
            aria-expanded={activityOpen}
            onClick={() => setActivityOpen(true)}
          >
            Activity <span>{activityCount}</span>
          </button>
          <div className={styles.footerActions}>
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
          </div>
        </footer>
        <AgentWorkspacePanel
          open={activityOpen}
          title="Activity"
          onClose={() => setActivityOpen(false)}
        >
          {moderationLabel && (
            <section className={styles.panelSection}>
              <h3>{moderationLabel}</h3>
              <p>
                {initial?.ownerContent?.reviewMessage ??
                  (initial?.ownerContent?.submitted?.disposition === "rejected"
                    ? "Edit this submission before saving it again."
                    : moderationState === "held"
                      ? "This submission needs moderator review."
                      : "Your latest submission is being reviewed.")}
              </p>
            </section>
          )}
          {activeIssue && issueNotice}
          <AgentGenerations
            currentAgentId={initial?.id}
            currentDraftScope={draftScope}
            rows={generations.rows.filter(
              (row) => row.id !== candidateImage?.requestId,
            )}
            onCancelled={(row) =>
              void cancelGeneration(row).then(() => setActivityOpen(false))
            }
            onReview={(row) =>
              void reviewGeneration(row).then(() => setActivityOpen(false))
            }
            disabled={submitting}
          />
          {restoreAlternatives && (
            <section className={styles.review} aria-label="Choose draft">
              <h2>Two drafts differ</h2>
              <p>
                Choose which version to resume. Saving it will replace the other
                account draft.
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
                                    werewolfStrategyStyle: "Werewolf strategy",
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
                Saved {new Date(pendingRestore.savedAt).toLocaleString()}. Apply
                it to the editor, or clear it to keep working from this version.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={applyDraft}
                  disabled={!remoteReady}
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
          {!!draftConflicts.length && (
            <section className={styles.review} aria-label="Draft conflicts">
              <h2>Resolve draft conflicts</h2>
              <p>
                These fields changed both in your draft and in the saved agent.
                Choose which value to keep.
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
                      setPerformanceInstructions(next.performanceInstructions);
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
          {headConfirmationRequired && (
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
          )}{" "}
          {dirty && missingRequired.length > 0 && (
            <p className={styles.requiredHint}>
              Before review, add{" "}
              {missingRequired.map((field, index) => (
                <span key={field}>
                  {index > 0 ? ", " : ""}
                  <button
                    type="button"
                    onClick={() =>
                      focusField(
                        field === "gender"
                          ? "agent-gender-male"
                          : `agent-${field}`,
                      )
                    }
                  >
                    {field}
                  </button>
                </span>
              ))}
              .
            </p>
          )}
          {!activityCount && !missingRequired.length && <p>No activity.</p>}
        </AgentWorkspacePanel>
        {reviewOpen && (
          <div className={styles.reviewBackdrop}>
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="agent-review-title"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setReviewOpen(false);
                }
                if (event.key === "Tab") {
                  const buttons = Array.from(
                    reviewRef.current?.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ) ?? [],
                  );
                  const first = buttons[0],
                    last = buttons.at(-1);
                  if (
                    event.shiftKey &&
                    (document.activeElement === first ||
                      document.activeElement === reviewRef.current)
                  ) {
                    event.preventDefault();
                    last?.focus();
                  } else if (
                    !event.shiftKey &&
                    document.activeElement === last
                  ) {
                    event.preventDefault();
                    first?.focus();
                  }
                }
              }}
              ref={reviewRef}
              tabIndex={-1}
              className={styles.review}
              aria-label="Review changes"
            >
              <h2 id="agent-review-title">
                {isEditing ? "Review changes" : "Review character"}
              </h2>
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
                  <ins>
                    {agentModelLabel(modelPreference) ?? "House choice"}
                  </ins>
                </div>
              )}
              {voiceId !== (initialSnapshot.voiceId ?? null) && (
                <div className={styles.change}>
                  <header>
                    <strong>Voice</strong>
                    <button
                      type="button"
                      onClick={() =>
                        setVoiceId(initialSnapshot.voiceId ?? null)
                      }
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
                    {PLAYER_VOICES.find((voice) => voice.id === voiceId)
                      ?.name ?? "Automatic"}
                  </ins>
                </div>
              )}
              {imageFields.some(
                (field) =>
                  JSON.stringify(currentSnapshot[field]) !==
                  JSON.stringify(initialSnapshot[field]),
              ) && (
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
              {issueNotice}
              <p className={styles.hint}>
                Your changes will be automatically reviewed.
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
          </div>
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
                Discard draft?
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/55">
                Unsaved changes and new artwork will be removed.
                {isEditing && " Your saved agent stays."}
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
