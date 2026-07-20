import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  InviteCodesSection,
  LoginMethodsSection,
  ProfileIdentitySummary,
} from "../app/dashboard/profile/profile-content";

const source = readFileSync(
  join(import.meta.dir, "../app/dashboard/profile/profile-content.tsx"),
  "utf8",
);

describe("private profile public identity controls", () => {
  it("saves display name and handle together and warns before breaking old links", () => {
    expect(source).toContain("updateProfile(nameInput, handleInput)");
    expect(source).toContain("Changing your handle breaks links");
    expect(source).toContain("Your public UUID link stays stable");
    expect(source).toContain("HANDLE_TAKEN");
  });

  it("renders completion recovery and then the preferred public-profile link", () => {
    const identity = {
      publicId: "8d91d5d0-bb3f-4559-a51a-64e1d2236f21",
      handle: null,
      displayName: "Anonymous",
      publicIdentityOnboarding: { state: "deferrable" as const, diagnosticCode: null },
    };
    const incomplete = renderToString(createElement(ProfileIdentitySummary, {
      profile: identity,
      onEdit: () => undefined,
    }));
    expect(incomplete).toContain("Complete your public profile");
    expect(incomplete).not.toContain("View public profile");

    const complete = renderToString(createElement(ProfileIdentitySummary, {
      profile: {
        ...identity,
        handle: "flick",
        displayName: "Flick",
        publicIdentityOnboarding: { state: "complete" as const, diagnosticCode: null },
      },
      onEdit: () => undefined,
    }));
    expect(complete).toContain('href="/profile/flick"');
    expect(complete).toContain("View public profile");
  });

  it("renders no invite section at zero and reveals it with an available code", () => {
    const empty = renderToString(createElement(InviteCodesSection, {
      inviteCodes: { available: [], used: [], totalAvailable: 0, totalUsed: 0 },
      copiedCode: null,
      onCopy: () => undefined,
    }));
    expect(empty).toBe("");

    const available = renderToString(createElement(InviteCodesSection, {
      inviteCodes: {
        available: [{ code: "JOIN-US", createdAt: "2026-07-16T00:00:00Z" }],
        used: [],
        totalAvailable: 1,
        totalUsed: 0,
      },
      copiedCode: null,
      onCopy: () => undefined,
    }));
    expect(available).toContain("Invite Codes");
    expect(available).toContain("JOIN-US");
  });

  it("offers only additive email/password controls and exposes no provider subjects", () => {
    const add = renderToString(createElement(LoginMethodsSection, {
      email: "owner@example.test",
      loginMethods: { privy: true, emailPassword: false },
      onAddPassword: () => undefined,
      onResetPassword: () => undefined,
    }));
    expect(add).toContain("Privy");
    expect(add).toContain("Add email/password");
    expect(add).not.toContain("Reset password");

    const reset = renderToString(createElement(LoginMethodsSection, {
      email: "owner@example.test",
      loginMethods: { privy: true, emailPassword: true },
      onAddPassword: () => undefined,
      onResetPassword: () => undefined,
    }));
    expect(reset).toContain("Reset password");
    expect(reset).not.toContain("Add email/password");

    const combined = `${add}${reset}`;
    expect(combined).not.toContain("Unlink");
    expect(combined).not.toContain("Change email");
    expect(combined).not.toContain("Passkey");
    expect(combined).not.toContain("MFA");
    expect(combined).not.toContain("did:privy");
    expect(combined).not.toContain("user_");

    const existingOnly = renderToString(createElement(LoginMethodsSection, {
      email: "owner@example.test",
      loginMethods: { privy: true, emailPassword: false },
      canAddPassword: false,
      onAddPassword: () => undefined,
      onResetPassword: () => undefined,
    }));
    expect(existingOnly).not.toContain("Add email/password");
    expect(existingOnly).toContain("temporarily unavailable");
  });
});
