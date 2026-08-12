import Link from "next/link";
import { PRESENTED_LEGAL_ACCEPTANCE } from "@/lib/api";

export function AccountLegalConsent({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className="flex items-start gap-3 text-sm text-text-secondary"
      data-terms-version={PRESENTED_LEGAL_ACCEPTANCE.termsVersion}
      data-privacy-version={PRESENTED_LEGAL_ACCEPTANCE.privacyVersion}
    >
      <input
        type="checkbox"
        required
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-accent"
      />
      <span>
        I agree to the{" "}
        <Link
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="influence-link"
        >
          Terms of Use
        </Link>{" "}
        and acknowledge the{" "}
        <Link
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="influence-link"
        >
          Privacy Policy
        </Link>
        , including the use and remixing of my public profile and agent content
        in Daily Dispatches and other promotion.
      </span>
    </label>
  );
}
