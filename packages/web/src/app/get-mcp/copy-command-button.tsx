"use client";

import { useState } from "react";

const DEFAULT_BUTTON_CLASS =
  "influence-button-secondary w-full shrink-0 rounded-md px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] md:w-auto md:py-1.5";

export function CopyCommandButton({
  command,
  label = "Copy",
  copiedLabel = "Copied",
  title = "Copy command",
  className = DEFAULT_BUTTON_CLASS,
}: {
  command: string;
  label?: string;
  copiedLabel?: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={() => void copyCommand()}
      className={className}
      title={title}
      aria-label={title}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
