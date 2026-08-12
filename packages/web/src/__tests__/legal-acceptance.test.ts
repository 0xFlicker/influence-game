import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

describe("current legal acceptance", () => {
  it("blocks existing authenticated accounts until acceptance is recorded", () => {
    expect(providersSource).toContain("account.legal.accepted");
    expect(providersSource).toContain("const requiresLegalAcceptance");
    expect(providersSource).toContain("!account.legal.accepted");
    expect(providersSource).toContain("<LegalAcceptancePrompt");
    expect(providersSource).toContain('pathname !== "/terms"');
    expect(providersSource).toContain('pathname !== "/privacy"');
    expect(promptSource).toContain("Daily Dispatches");
    expect(promptSource).toContain("Agree and continue");
    expect(promptSource).toContain("Sign out");
  });

  it("posts explicit acceptance instead of trusting presentation state", () => {
    expect(apiSource).toContain('apiFetch("/api/auth/legal-acceptance"');
    expect(apiSource).toContain('termsVersion: "2026-08-12"');
    expect(apiSource).toContain('privacyVersion: "2026-08-12"');
    expect(apiSource).toContain("JSON.stringify(PRESENTED_LEGAL_ACCEPTANCE)");
    expect(apiSource).toContain("token, ...PRESENTED_LEGAL_ACCEPTANCE");
  });
});
