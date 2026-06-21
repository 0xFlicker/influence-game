"use client";

import { useState } from "react";

export function CopyCommandButton({ command }: { command: string }) {
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
      className="influence-button-secondary w-full shrink-0 rounded-md px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] md:w-auto md:py-1.5"
      title="Copy command"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
