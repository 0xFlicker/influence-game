import type {
  AuthenticatedPublicIdentity,
  PublicIdentityOnboardingState,
} from "@/lib/api";

export type IdentityFormStatus = "idle" | "saving" | "error";

export interface PublicIdentityFormState {
  persistedDisplayName: string;
  persistedHandle: string | null;
  displayName: string;
  handle: string;
  handleDirty: boolean;
  status: IdentityFormStatus;
  error: string | null;
  collisionSuggestion: string | null;
}

export function createIdentityFormState(identity: {
  displayName: string;
  handle: string | null;
}): PublicIdentityFormState {
  return {
    persistedDisplayName: identity.displayName,
    persistedHandle: identity.handle,
    displayName: identity.displayName === "Anonymous" ? "" : identity.displayName,
    handle: identity.handle
      ?? (identity.displayName === "Anonymous" ? "" : derivePublicHandle(identity.displayName)),
    handleDirty: identity.handle !== null,
    status: "idle",
    error: null,
    collisionSuggestion: null,
  };
}

export function changeIdentityDisplayName(
  state: PublicIdentityFormState,
  displayName: string,
): PublicIdentityFormState {
  if (state.status === "saving") return state;
  return {
    ...state,
    displayName,
    handle: state.handleDirty ? state.handle : derivePublicHandle(displayName),
    status: "idle",
    error: null,
    collisionSuggestion: null,
  };
}

export function changeIdentityHandle(
  state: PublicIdentityFormState,
  handle: string,
): PublicIdentityFormState {
  if (state.status === "saving") return state;
  return {
    ...state,
    handle,
    handleDirty: true,
    status: "idle",
    error: null,
    collisionSuggestion: null,
  };
}

export function markIdentitySaving(state: PublicIdentityFormState): PublicIdentityFormState {
  return {
    ...state,
    status: "saving",
    error: null,
    collisionSuggestion: null,
  };
}

export function markIdentitySaveFailed(
  state: PublicIdentityFormState,
  error: string,
): PublicIdentityFormState {
  return {
    ...state,
    status: "error",
    error,
  };
}

export function applyIdentityCollision(
  state: PublicIdentityFormState,
  suggestion: string | null,
): PublicIdentityFormState {
  return {
    ...state,
    handle: !state.handleDirty && suggestion ? suggestion : state.handle,
    collisionSuggestion: state.handleDirty ? suggestion : null,
    status: "error",
    error: suggestion
      ? state.handleDirty
        ? `That handle is taken. Try ${suggestion}.`
        : "That handle was taken, so we found another available option."
      : "That handle is taken. Choose a different handle.",
  };
}

export function applyAvailableIdentitySuggestion(
  state: PublicIdentityFormState,
  requestedDisplayName: string,
  suggestion: string,
): PublicIdentityFormState {
  if (
    state.status === "saving"
    || state.handleDirty
    || state.displayName !== requestedDisplayName
  ) {
    return state;
  }
  return {
    ...state,
    handle: suggestion,
    collisionSuggestion: null,
  };
}

export function cancelIdentityChanges(state: PublicIdentityFormState): PublicIdentityFormState {
  return createIdentityFormState({
    displayName: state.persistedDisplayName,
    handle: state.persistedHandle,
  });
}

export function completeIdentitySave(
  identity: { displayName: string; handle: string },
): PublicIdentityFormState {
  return createIdentityFormState(identity);
}

export type IdentityPromptDecision =
  | "none"
  | "invite"
  | "identity-required"
  | "identity-deferrable"
  | "downstream";

export function identityPromptDecision(input: {
  signedIn: boolean;
  needsInvite: boolean;
  identityState: PublicIdentityOnboardingState | null;
  identityResolved?: boolean;
  dismissed: boolean;
}): IdentityPromptDecision {
  if (!input.signedIn) return "none";
  if (input.needsInvite) return "invite";
  if (input.identityState === "required") return "identity-required";
  if (input.identityState === "deferrable" && !input.dismissed) {
    return "identity-deferrable";
  }
  if (input.identityState === null) {
    return input.identityResolved ? "downstream" : "none";
  }
  return "downstream";
}

export function normalizeAuthenticatedPublicIdentity(
  value: unknown,
): AuthenticatedPublicIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const onboarding = candidate.publicIdentityOnboarding;
  if (!onboarding || typeof onboarding !== "object") return null;
  const onboardingRecord = onboarding as Record<string, unknown>;
  const state = onboardingRecord.state;
  if (
    typeof candidate.publicId !== "string"
    || (candidate.handle !== null && typeof candidate.handle !== "string")
    || typeof candidate.displayName !== "string"
    || (state !== "complete" && state !== "required" && state !== "deferrable")
  ) {
    return null;
  }

  const diagnosticCode = onboardingRecord.diagnosticCode;
  return {
    publicId: candidate.publicId,
    handle: candidate.handle,
    displayName: candidate.displayName,
    publicIdentityOnboarding: {
      state,
      diagnosticCode:
        diagnosticCode === "created_at_missing"
        || diagnosticCode === "created_at_invalid"
        || diagnosticCode === "created_at_timezone_required"
          ? diagnosticCode
          : null,
    },
  };
}

export type AuthenticatedIdentityPayload =
  | {
      kind: "current";
      identity: AuthenticatedPublicIdentity;
    }
  | {
      kind: "legacy";
    }
  | {
      kind: "invalid";
    };

export function classifyAuthenticatedIdentityPayload(
  value: unknown,
): AuthenticatedIdentityPayload {
  const identity = normalizeAuthenticatedPublicIdentity(value);
  if (identity) return { kind: "current", identity };
  if (value === undefined) return { kind: "legacy" };
  if (
    value
    && typeof value === "object"
    && !("publicIdentityOnboarding" in value)
    && !("publicId" in value)
    && !("handle" in value)
    && typeof (value as Record<string, unknown>).id === "string"
  ) {
    return { kind: "legacy" };
  }
  return { kind: "invalid" };
}

export function identityDismissalKey(publicId: string): string {
  return `influence:public-identity:dismissed:${publicId}`;
}

export function derivePublicHandle(displayName: string): string {
  let handle = displayName
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 30)
    .replace(/-+$/g, "");
  if (!handle) return "player";
  if (handle.length < 3) handle = `${handle}-player`.slice(0, 30);
  if ([
    "about",
    "admin",
    "anonymous",
    "api",
    "dashboard",
    "games",
    "get-mcp",
    "health",
    "house",
    "internal",
    "oauth",
    "privacy",
    "profile",
    "rules",
    "runtime-config",
    "system",
  ].includes(handle)) {
    return `${handle}-player`.slice(0, 30);
  }
  return handle;
}
