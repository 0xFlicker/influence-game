import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PublicIdentityOnboarding } from "../components/public-identity-onboarding";
import {
  applyAvailableIdentitySuggestion,
  applyIdentityCollision,
  cancelIdentityChanges,
  classifyAuthenticatedIdentityPayload,
  changeIdentityDisplayName,
  changeIdentityHandle,
  completeIdentitySave,
  createIdentityFormState,
  derivePublicHandle,
  identityDismissalKey,
  identityPromptDecision,
  identitySaveHandoffPublicId,
  markIdentitySaveFailed,
  markIdentitySaving,
  normalizeAuthenticatedPublicIdentity,
} from "../components/public-identity-onboarding-model";

describe("public identity onboarding model", () => {
  it("tracks an untouched derived handle with display-name edits", () => {
    expect(createIdentityFormState({ displayName: "Legacy Player", handle: null }).handle)
      .toBe("legacy-player");
    let state = createIdentityFormState({
      displayName: "Anonymous",
      handle: null,
    });
    state = changeIdentityDisplayName(state, "Flick");
    expect(state.handle).toBe("flick");
    state = changeIdentityDisplayName(state, "Ox Flick");
    expect(state.handle).toBe("ox-flick");
    expect(state.handleDirty).toBe(false);
  });

  it("preserves a manually edited or persisted handle", () => {
    let state = createIdentityFormState({ displayName: "Flick", handle: null });
    state = changeIdentityDisplayName(state, "Flick");
    state = changeIdentityHandle(state, "oxflick");
    state = changeIdentityDisplayName(state, "Changed Name");
    expect(state.handle).toBe("oxflick");
    expect(state.handleDirty).toBe(true);

    const persisted = changeIdentityDisplayName(
      createIdentityFormState({ displayName: "Flick", handle: "flick" }),
      "Changed Name",
    );
    expect(persisted.handle).toBe("flick");
    expect(persisted.handleDirty).toBe(true);
  });

  it("auto-replaces only an untouched collision and suggests beside a manual collision", () => {
    const derived = changeIdentityDisplayName(
      createIdentityFormState({ displayName: "Anonymous", handle: null }),
      "Flick",
    );
    expect(applyIdentityCollision(derived, "flick-2").handle).toBe("flick-2");

    const manual = changeIdentityHandle(derived, "flick-team");
    const collided = applyIdentityCollision(manual, "flick-2");
    expect(collided.handle).toBe("flick-team");
    expect(collided.collisionSuggestion).toBe("flick-2");
  });

  it("locks edits while saving and rejects stale derived-handle suggestions", () => {
    const flick = changeIdentityDisplayName(
      createIdentityFormState({ displayName: "Anonymous", handle: null }),
      "Flick",
    );
    const saving = markIdentitySaving(flick);
    expect(changeIdentityDisplayName(saving, "Later")).toBe(saving);
    expect(changeIdentityHandle(saving, "later")).toBe(saving);
    expect(applyAvailableIdentitySuggestion(saving, "Flick", "flick-2")).toBe(saving);

    const later = changeIdentityDisplayName(flick, "Later");
    expect(applyAvailableIdentitySuggestion(later, "Flick", "flick-2")).toBe(later);
    expect(applyAvailableIdentitySuggestion(later, "Later", "later-2").handle)
      .toBe("later-2");
  });

  it("reports exhausted collision recovery honestly", () => {
    const derived = changeIdentityDisplayName(
      createIdentityFormState({ displayName: "Anonymous", handle: null }),
      "Flick",
    );
    expect(applyIdentityCollision(derived, null)).toMatchObject({
      handle: "flick",
      error: "That handle is taken. Choose a different handle.",
    });
  });

  it("preserves values on failure, restores persisted values on cancel, and rebases on success", () => {
    const initial = createIdentityFormState({ displayName: "Flick", handle: "flick" });
    const changed = changeIdentityHandle(
      changeIdentityDisplayName(initial, "Ox Flick"),
      "oxflick",
    );
    const saving = markIdentitySaving(changed);
    const failed = markIdentitySaveFailed(saving, "Network unavailable");
    expect(failed.displayName).toBe("Ox Flick");
    expect(failed.handle).toBe("oxflick");
    expect(failed.status).toBe("error");

    expect(cancelIdentityChanges(failed)).toMatchObject({
      displayName: "Flick",
      handle: "flick",
      status: "idle",
    });

    const completed = completeIdentitySave({
      displayName: "Ox Flick",
      handle: "oxflick",
    });
    expect(cancelIdentityChanges(changeIdentityDisplayName(completed, "Later"))).toMatchObject({
      displayName: "Ox Flick",
      handle: "oxflick",
    });
  });

  it("enforces prompt precedence and permits dismissal only for migrated players", () => {
    expect(identityPromptDecision({
      signedIn: true,
      needsInvite: true,
      identityState: "required",
      identityResolved: true,
      dismissed: false,
    })).toBe("invite");
    expect(identityPromptDecision({
      signedIn: true,
      needsInvite: false,
      identityState: "required",
      identityResolved: true,
      dismissed: true,
    })).toBe("identity-required");
    expect(identityPromptDecision({
      signedIn: true,
      needsInvite: false,
      identityState: "deferrable",
      identityResolved: true,
      dismissed: false,
    })).toBe("identity-deferrable");
    expect(identityPromptDecision({
      signedIn: true,
      needsInvite: false,
      identityState: "deferrable",
      identityResolved: true,
      dismissed: true,
    })).toBe("downstream");
    expect(identityPromptDecision({
      signedIn: false,
      needsInvite: false,
      identityState: null,
      identityResolved: false,
      dismissed: false,
    })).toBe("none");
    expect(identityPromptDecision({
      signedIn: true,
      needsInvite: false,
      identityState: null,
      identityResolved: true,
      dismissed: false,
    })).toBe("downstream");
  });

  it("normalizes mixed-version auth payloads without dereferencing old producers", () => {
    const legacy = {
      id: "legacy-internal-id",
      displayName: "Legacy Player",
    };
    expect(normalizeAuthenticatedPublicIdentity(legacy)).toBeNull();
    expect(classifyAuthenticatedIdentityPayload(legacy)).toEqual({
      kind: "legacy",
    });
    expect(normalizeAuthenticatedPublicIdentity({
      publicId: "8d91d5d0-bb3f-4559-a51a-64e1d2236f21",
      handle: "flick",
      displayName: "Flick",
      publicIdentityOnboarding: {
        state: "complete",
        diagnosticCode: null,
      },
    })).toMatchObject({
      publicId: "8d91d5d0-bb3f-4559-a51a-64e1d2236f21",
      publicIdentityOnboarding: { state: "complete" },
    });
    expect(classifyAuthenticatedIdentityPayload({
      publicId: "8d91d5d0-bb3f-4559-a51a-64e1d2236f21",
      displayName: "Broken New Payload",
      publicIdentityOnboarding: { state: "required" },
    })).toEqual({
      kind: "invalid",
    });
    expect(classifyAuthenticatedIdentityPayload({
      id: "internal-id",
      publicId: "8d91d5d0-bb3f-4559-a51a-64e1d2236f21",
      handle: "broken-new-payload",
      displayName: "Broken New Payload",
    })).toEqual({
      kind: "invalid",
    });
  });

  it("keys browser-session dismissal by immutable public UUID", () => {
    expect(identityDismissalKey("8d91d5d0-bb3f-4559-a51a-64e1d2236f21"))
      .toBe("influence:public-identity:dismissed:8d91d5d0-bb3f-4559-a51a-64e1d2236f21");
  });

  it("arms a same-session handoff only for the active saved account", () => {
    const publicId = "8d91d5d0-bb3f-4559-a51a-64e1d2236f21";
    expect(identitySaveHandoffPublicId({
      signedIn: true,
      currentPublicId: publicId,
      savedPublicId: publicId,
    })).toBe(publicId);
    expect(identitySaveHandoffPublicId({
      signedIn: false,
      currentPublicId: publicId,
      savedPublicId: publicId,
    })).toBeNull();
    expect(identitySaveHandoffPublicId({
      signedIn: true,
      currentPublicId: "1bc88da1-8e1d-4f22-a749-8b80dbba54b4",
      savedPublicId: publicId,
    })).toBeNull();
  });

  it("keeps client derivation aligned with every server-reserved route", () => {
    for (const reserved of [
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
    ]) {
      expect(derivePublicHandle(reserved)).toBe(`${reserved}-player`);
    }
  });

  it("blocks dismissal for required players and exposes Not now for migrated players", () => {
    const baseIdentity = {
      publicId: "8d91d5d0-bb3f-4559-a51a-64e1d2236f21",
      handle: null,
      displayName: "Anonymous",
      publicIdentityOnboarding: { state: "required" as const, diagnosticCode: null },
    };
    const required = renderToString(createElement(PublicIdentityOnboarding, {
      identity: baseIdentity,
      onSaved: () => undefined,
      onDismiss: () => undefined,
    }));
    expect(required).not.toContain("Not now");
    expect(required).toContain("Create public profile");

    const deferrable = renderToString(createElement(PublicIdentityOnboarding, {
      identity: {
        ...baseIdentity,
        publicIdentityOnboarding: { state: "deferrable" as const, diagnosticCode: null },
      },
      onSaved: () => undefined,
      onDismiss: () => undefined,
    }));
    expect(deferrable).toContain("Not now");
  });
});
