"use client";
import { useEffect, useRef, useState } from "react";
import { campaignIdeaKey } from "./season-one-entry";

/** Transfers only composer text. Never submits a message or changes authentication. */
export function CampaignIdeaHandoff({
  requestId,
  ready,
  hasConversation,
  onApply,
}: {
  requestId?: string;
  ready: boolean;
  hasConversation: boolean;
  onApply: (text: string) => void;
}) {
  const handled = useRef<string | null>(null);
  const [idea, setIdea] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!requestId || !ready || handled.current === requestId) return;
    handled.current = requestId;
    try {
      const text = sessionStorage.getItem(campaignIdeaKey(requestId));
      if (!text) return;
      // Synchronize the external session-storage handoff after draft recovery.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (hasConversation) setIdea(text);
      else {
        onApply(text);
        sessionStorage.removeItem(campaignIdeaKey(requestId));
      }
    } catch {
      setError(
        "Your starting idea could not be read from browser storage. Return to the character page to copy it, or write it here.",
      );
    }
  }, [requestId, ready, hasConversation, onApply]);
  function apply() {
    if (!idea || !requestId) return;
    onApply(idea);
    try {
      sessionStorage.removeItem(campaignIdeaKey(requestId));
      setIdea(null);
    } catch {
      setError(
        "Your idea is in the composer, but its temporary browser copy could not be cleared.",
      );
    }
  }
  if (!idea && !error) return null;
  return (
    <aside className="mx-auto w-full max-w-3xl p-4">
      {idea && (
        <>
          <p>Your starting idea is ready. Your existing draft has been kept.</p>
          <blockquote className="my-3">{idea}</blockquote>
          <button
            type="button"
            className="influence-button-secondary rounded px-4 py-2"
            onClick={apply}
          >
            Use this idea in the composer
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
