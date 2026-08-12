import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountLegalConsent } from "../components/account-legal-consent";
import { LegalAcceptancePrompt } from "../components/legal-acceptance-prompt";

const promptSource = readFileSync(
  join(import.meta.dir, "../components/legal-acceptance-prompt.tsx"),
  "utf8",
);
const providersSource = readFileSync(
  join(import.meta.dir, "../app/providers.tsx"),
  "utf8",
);
const apiSource = readFileSync(
  join(import.meta.dir, "../lib/api.ts"),
  "utf8",
);
const webDockerfile = readFileSync(
  join(import.meta.dir, "../../../../Dockerfile.web"),
  "utf8",
);

describe("current legal acceptance", () => {
  it("renders the approved Terms of Use presentation", () => {
    const prompt = renderToStaticMarkup(createElement(LegalAcceptancePrompt, {
      onAccepted: () => {},
      onLogout: async () => {},
    }));
    expect(prompt).toContain("Terms of Use");
    expect(prompt).toContain("Review and accept");
    expect(prompt).toContain(
      "The House is provided by False Floor LLC. Please review and accept the Terms of Use to continue.",
    );
    expect(prompt).toContain("Accept and continue");

    const consent = renderToStaticMarkup(createElement(AccountLegalConsent, {
      checked: false,
      disabled: false,
      onChange: () => {},
    }));
    expect(consent).toContain('href="/terms"');
    expect(consent).toContain('href="/privacy"');
    expect(consent).toContain("I agree to the");
    expect(consent).toContain("and acknowledge the");
    expect(consent).not.toContain("Daily Dispatches");
  });

  it("blocks existing authenticated accounts until acceptance is recorded", () => {
    expect(providersSource).toContain("account.legal.accepted");
    expect(providersSource).toContain("const requiresLegalAcceptance");
    expect(providersSource).toContain("!account.legal.accepted");
    expect(providersSource).toContain("<LegalAcceptancePrompt");
    expect(providersSource).toContain('pathname !== "/terms"');
    expect(providersSource).toContain('pathname !== "/privacy"');
    expect(promptSource).toContain("Terms of Use");
    expect(promptSource).toContain("Review and accept");
    expect(promptSource).toContain("The House is provided by {FALSE_FLOOR.name}");
    expect(promptSource).not.toContain("Daily Dispatches");
    expect(promptSource).toContain("Accept and continue");
    expect(promptSource).toContain("Sign out");
  });

  it("posts explicit acceptance instead of trusting presentation state", () => {
    expect(apiSource).toContain('apiFetch("/api/auth/legal-acceptance"');
    expect(apiSource).toContain('termsVersion: "2026-08-12"');
    expect(apiSource).toContain('privacyVersion: "2026-08-12"');
    expect(apiSource).toContain("process.env.NEXT_PUBLIC_GIT_SHA");
    expect(webDockerfile).toContain("ENV NEXT_PUBLIC_GIT_SHA=${GIT_SHA}");
    expect(apiSource).toContain("JSON.stringify(PRESENTED_LEGAL_ACCEPTANCE)");
    expect(apiSource).toContain("token, ...PRESENTED_LEGAL_ACCEPTANCE");
  });
});
