export type EditorStorageRead =
  | { ok: true; value: string | null }
  | { ok: false; value: null };

export function readEditorStorage(key: string): EditorStorageRead {
  try {
    return { ok: true, value: window.sessionStorage.getItem(key) };
  } catch {
    return { ok: false, value: null };
  }
}

export function writeEditorStorage(key: string, value: string): boolean {
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeEditorStorage(key: string): boolean {
  try {
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export const AGENT_EDITOR_DRAFT_VERSION = 4;

export function isAgentEditorDraft(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    draft.version === AGENT_EDITOR_DRAFT_VERSION &&
    typeof draft.savedAt === "string" &&
    typeof draft.creationRequestId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      draft.creationRequestId,
    ) &&
    validSnapshot(draft.base) &&
    validSnapshot(draft.current)
  );
}
function validSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    [
      "name",
      "backstory",
      "personality",
      "strategyStyle",
      "werewolfStrategyStyle",
      "performanceInstructions",
      "gender",
    ].every((key) => typeof snapshot[key] === "string") &&
    (snapshot.fullBodyReferenceUrl === null ||
      typeof snapshot.fullBodyReferenceUrl === "string") &&
    (snapshot.personaKey === null || typeof snapshot.personaKey === "string") &&
    (snapshot.voiceId == null || typeof snapshot.voiceId === "string") &&
    (snapshot.modelPreference == null ||
      snapshot.modelPreference === "default" ||
      (typeof snapshot.modelPreference === "object" &&
        !Array.isArray(snapshot.modelPreference) &&
        typeof (snapshot.modelPreference as Record<string, unknown>)
          .catalogId === "string"))
  );
}

export function agentEditorDraftKey(ownerId: string, scope: string): string {
  return `influence:agent-editor:${AGENT_EDITOR_DRAFT_VERSION}:${ownerId}:${scope}`;
}

export function agentEditRequestKey(ownerId: string, agentId: string): string {
  return `influence:agent-edit-request:${ownerId}:${agentId}`;
}

export function discardAgentDraft(ownerId: string, scope: string): boolean {
  const key = agentEditorDraftKey(ownerId, scope);
  try {
    for (const suffix of ["", ":visual-reference", ":interrupted"])
      window.sessionStorage.removeItem(`${key}${suffix}`);
    return true;
  } catch {
    return false;
  }
}

/** Inspect this tab only. Unknown or unreadable drafts must remain recoverable. */
export function findAgentDrafts(
  ownerId: string,
  agentId: string,
): { ok: true; scopes: string[] } | { ok: false } {
  try {
    const prefix = `influence:agent-editor:${AGENT_EDITOR_DRAFT_VERSION}:${ownerId}:`;
    const edit = `edit:${agentId}`;
    const review = `review:${agentId}:`;
    const scopes = new Set<string>();
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const scope = rest.endsWith(":visual-reference")
        ? rest.slice(0, -":visual-reference".length)
        : rest;
      if (scope.endsWith(":interrupted")) continue;
      if (
        scope === edit ||
        (scope.startsWith(review) && !scope.slice(review.length).includes(":"))
      )
        scopes.add(scope);
    }
    return { ok: true, scopes: [...scopes] };
  } catch {
    return { ok: false };
  }
}
