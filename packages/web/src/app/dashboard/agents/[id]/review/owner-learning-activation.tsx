"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./owner-learning-review.css";
import {
  dismissOwnerLearningPrompt,
  getAuthToken,
  getOwnerLearningEligibleInputs,
  recordOwnerLearningPromptImpression,
  type OwnerLearningEligibleInputs,
} from "@/lib/api";
import { formatAvailabilityTimestamp, reviewEntryPath, reviewPath } from "./owner-learning-model";

export function OwnerLearningActivationView({
  eligible,
  contextAgentId,
  contextGameId,
  onDismiss,
}: {
  eligible: OwnerLearningEligibleInputs;
  contextAgentId?: string;
  contextGameId?: string;
  onDismiss?: () => void;
}) {
  const profiles = contextGameId ? eligible.profiles.filter(profile => profile.games.some(game => game.gameId === contextGameId)) : eligible.profiles;
  if (contextGameId && !profiles.length) return null;
  if (eligible.openReview) {
    const profile = eligible.profiles.find((entry) => entry.agentProfileId === eligible.openReview?.agentProfileId);
    return (
      <section className="olm-activation" data-variant="resume" data-testid="owner-learning-activation">
        <div><p>Owner review in progress</p><h2>Return to {profile?.name ?? "your open agent review"}</h2>
          <span>Your saved stage and game evidence are waiting. One owner review stays open at a time.</span></div>
        <Link href={reviewPath(eligible.openReview.agentProfileId, eligible.openReview.id)}>Resume review →</Link>
      </section>
    );
  }

  const profile = profiles.find((entry) => entry.agentProfileId === contextAgentId)
    ?? profiles.find((entry) => entry.agentProfileId === eligible.recommendedAgentProfileId)
    ?? profiles[0];
  if (!profile || (eligible.credit.mode === "metered"
    && eligible.credit.balance === 0
    && !eligible.credit.nextAvailableAt)) return null;
  const prominent = eligible.prompt.prominent && !eligible.prompt.suppressedByDismissal;
  const availability = activationAvailability(eligible);
  return (
    <section
      className="olm-activation"
      data-variant={prominent ? "prominent" : "subtle"}
      data-testid="owner-learning-activation"
    >
      <div>
        <p>{prominent ? "Three-game pattern ready" : availability.label}</p>
        <h2>{prominent ? `The room has more to say about ${profile.name}.` : `Review ${profile.name}'s latest game.`}</h2>
        <span>{prominent
          ? "Compare accepted actions and counterplay across the latest eligible games."
          : availability.detail}</span>
      </div>
      <div className="olm-activation-actions">
        {onDismiss && <button type="button" onClick={onDismiss}>Not now</button>}
        <Link href={`${reviewEntryPath(profile.agentProfileId)}?game=${profile.gameKind}`}>{prominent ? "Review the pattern" : "Open game review"} →</Link>
      </div>
    </section>
  );
}

export function OwnerLearningActivation({
  enabled,
  contextAgentId,
  contextGameId,
}: {
  enabled: boolean;
  contextAgentId?: string;
  contextGameId?: string;
}) {
  const [eligible, setEligible] = useState<OwnerLearningEligibleInputs | null>(null);
  const impressedWatermark = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !getAuthToken()) {
      setEligible(null);
      return;
    }
    try {
      setEligible(await getOwnerLearningEligibleInputs());
    } catch {
      setEligible(null);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
    const onSession = () => void load();
    window.addEventListener("auth:session-ready", onSession);
    return () => window.removeEventListener("auth:session-ready", onSession);
  }, [load]);

  useEffect(() => {
    const threshold = eligible?.prompt.threshold;
    const completion = eligible?.credit.latestEligibleCompletion;
    if (
      (contextGameId && !eligible?.profiles.some(profile => profile.games.some(game => game.gameId === contextGameId)))
      || !threshold
      || !completion
      || !eligible
      || (eligible.credit.mode === "metered" && eligible.credit.balance !== 1)
      || eligible.prompt.suppressedByDismissal
      || eligible.openReview
    ) return;
    const watermark = `${completion.completionAt}:${completion.gameId}:${threshold}`;
    if (impressedWatermark.current === watermark) return;
    impressedWatermark.current = watermark;
    void recordOwnerLearningPromptImpression(threshold).catch(() => undefined);
  }, [eligible, contextGameId]);

  async function dismiss() {
    try {
      await dismissOwnerLearningPrompt();
    } finally {
      await load();
    }
  }

  if (!eligible) return null;
  return (
    <OwnerLearningActivationView
      eligible={eligible}
      contextAgentId={contextAgentId}
      contextGameId={contextGameId}
      onDismiss={
        !contextGameId && !contextAgentId
        && eligible.prompt.threshold
        && !eligible.prompt.suppressedByDismissal
        && eligible.prompt.prominent
          ? () => void dismiss()
          : undefined
      }
    />
  );
}

function activationAvailability(eligible: OwnerLearningEligibleInputs): { label: string; detail: string } {
  if (eligible.credit.mode === "unlimited") {
    return {
      label: "Unlimited sysop reviews",
      detail: "Open the recorded facts first, then start a private test review with unlimited sysop access.",
    };
  }
  if (eligible.credit.balance === 1) {
    return {
      label: "1 review credit available",
      detail: "Open the recorded facts first, then decide whether to purchase strategic analysis.",
    };
  }
  if (eligible.credit.nextAvailableAt) {
    return {
      label: "0 review credits",
      detail: `Next review available ${formatAvailabilityTimestamp(eligible.credit.nextAvailableAt)}. You can inspect the recorded facts now.`,
    };
  }
  return { label: "0 review credits", detail: "Complete another qualifying game to earn one." };
}
