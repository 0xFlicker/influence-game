"use client";
import { useEffect, useRef, useState } from "react";
import { FALSE_FLOOR, HOUSE_DISCORD_URL } from "@/lib/product-identity";

type SupportContext = {
  agentId?: string;
  requestId?: string;
  issueCode?: string;
};
type Contact =
  | { kind: "support"; context: SupportContext }
  | { kind: "allowance"; paused: boolean };

export function SupportLink({
  className,
  ...context
}: SupportContext & { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      aria-haspopup="dialog"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent<SupportContext>("support:contact", {
            detail: context,
          }),
        );
      }}
    >
      Support
    </button>
  );
}

export function GenerationContactModal() {
  const ref = useRef<HTMLDialogElement>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    function allowance(event: Event) {
      setCopyStatus("");
      setContact({
        kind: "allowance",
        paused: (event as CustomEvent<string>).detail === "generation_paused",
      });
    }
    function support(event: Event) {
      setCopyStatus("");
      setContact({
        kind: "support",
        context: (event as CustomEvent<SupportContext>).detail,
      });
    }
    window.addEventListener("generation:contact", allowance);
    window.addEventListener("support:contact", support);
    return () => {
      window.removeEventListener("generation:contact", allowance);
      window.removeEventListener("support:contact", support);
    };
  }, []);
  useEffect(() => {
    if (contact && !ref.current?.open) ref.current?.showModal();
  }, [contact]);
  const support = contact?.kind === "support";
  const paused = contact?.kind === "allowance" && contact.paused;
  const context = contact?.kind === "support" ? contact.context : {};
  const reference = [
    context.agentId && `Agent: ${context.agentId}`,
    context.requestId && `Request: ${context.requestId}`,
    context.issueCode && `Issue: ${context.issueCode}`,
  ]
    .filter(Boolean)
    .join("\n");
  const email = support
    ? `mailto:${FALSE_FLOOR.supportEmail}?subject=${encodeURIComponent("Agent help")}&body=${encodeURIComponent("What happened:\n\n" + reference)}`
    : `mailto:${FALSE_FLOOR.supportEmail}`;
  async function copyReference() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Couldn’t copy. Select the reference below.");
    }
  }
  return (
    <dialog
      ref={ref}
      aria-labelledby="generation-contact-title"
      aria-describedby="generation-contact-description"
      onClose={() => setContact(null)}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-[#514a3b] bg-[#17130f] p-6 text-[#efe8dc] shadow-2xl backdrop:bg-black/70"
    >
      <h2 id="generation-contact-title" className="font-serif text-2xl">
        {support
          ? "Get help"
          : paused
            ? "Generation is paused"
            : "Need more generations?"}
      </h2>
      <p
        id="generation-contact-description"
        className="my-4 text-sm leading-6 text-[#b4b1a5]"
      >
        {support
          ? `Tell us what happened and what you were trying to do.${reference ? " Include the reference below so we can find your request." : ""}`
          : paused
            ? "Generation is paused for your account. Contact us for help."
            : "You’ve reached your current generation allowance. Contact us and we can help you get more."}
      </p>
      {support ? (
        <div className="space-y-4 border-y border-[#514a3b] py-4 text-sm">
          <div>
            <a
              className="text-[#e2c695] underline underline-offset-4"
              href={HOUSE_DISCORD_URL}
              target="_blank"
              rel="noreferrer"
            >
              Discord
            </a>
            <p className="mt-2 leading-6 text-[#b4b1a5]">
              Join The House Discord and ask for help with your agent.
            </p>
          </div>
          <div>
            <a
              className="break-all text-[#e2c695] underline underline-offset-4"
              href={email}
            >
              {FALSE_FLOOR.supportEmail}
            </a>
            <p className="mt-2 leading-6 text-[#b4b1a5]">
              {reference
                ? "Email us directly. The reference is included in your message."
                : "Email us directly for help with your agent."}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-4">
          <a
            className="rounded bg-[#e2c695] px-4 py-2 text-[#17130f]"
            href={HOUSE_DISCORD_URL}
            target="_blank"
            rel="noreferrer"
          >
            Ask on Discord
          </a>
          <a className="py-2 underline" href={email}>
            Email
          </a>
          <a
            className="py-2 underline"
            href="https://x.com/0xflick"
            target="_blank"
            rel="noreferrer"
          >
            Contact on X
          </a>
        </div>
      )}
      {support && reference && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <h3 className="font-medium">Reference</h3>
            <button
              type="button"
              className="text-[#e2c695] underline underline-offset-4"
              onClick={() => void copyReference()}
            >
              Copy
            </button>
          </div>
          <p role="status" className="text-sm text-[#b4b1a5]">
            {copyStatus}
          </p>
          <pre className="mt-2 select-text whitespace-pre-wrap break-all rounded-lg bg-black/20 p-3 font-mono text-xs leading-6 text-[#b4b1a5]">
            {reference}
          </pre>
        </div>
      )}
      <form method="dialog" className="mt-6 flex justify-end">
        <button className="rounded border border-[#514a3b] px-4 py-2">
          {support ? "Close" : "Dismiss"}
        </button>
      </form>
    </dialog>
  );
}
