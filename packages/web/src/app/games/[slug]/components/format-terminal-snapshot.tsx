import type { ViewerDecisionEvent } from "@/lib/api";
import { FormatOfferStage } from "./format-offer-stage";
import { FormatPresentation } from "./format-presentation";
import {
  compileFormatPresentationPrefix,
} from "./format-presentation-model";
import type { FormatPresentationRosterPlayer } from "./types";

/**
 * A terminal format game may be incomplete, but its accepted prefix is still
 * useful. This component compiles only typed viewer decisions and renders the
 * last valid cue without playback controls or synthetic completion.
 */
export function FormatTerminalSnapshot({
  gameId,
  roster,
  decisions,
  eligiblePlayerIdsByRound,
  loading = false,
}: {
  gameId: string;
  roster: readonly FormatPresentationRosterPlayer[];
  decisions: readonly ViewerDecisionEvent[];
  eligiblePlayerIdsByRound?: ReadonlyMap<number, readonly string[]>;
  loading?: boolean;
}) {
  const compilation = compileFormatPresentationPrefix({
    gameId,
    gameKernel: "format",
    roster,
    decisions,
    eligiblePlayerIdsByRound,
  });
  const lastCue = compilation.cues.at(-1) ?? null;
  const selectedFormatId = compilation.snapshot.activeFormatId;
  const offeredFormatIds = compilation.snapshot.offeredFormatIds;
  const unresolvedBallot = decisions.some(
    (decision) => (
      decision.round === compilation.snapshot.round
      && decision.type === "format.ballot_cast"
    ),
  ) && compilation.snapshot.resolution === null;

  return (
    <section
      aria-label="Read-only format snapshot"
      data-format-terminal-snapshot
      data-format-terminal-trust={compilation.status}
      className="w-full max-w-5xl rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
          Read-only format snapshot
        </p>
        <p className="text-xs text-white/35">
          Trusted through sequence {compilation.snapshot.canonicalSequence}
        </p>
      </div>

      {selectedFormatId && offeredFormatIds && (
        lastCue?.kind === "format_selected" || unresolvedBallot
      ) ? (
        <FormatOfferStage
          offeredFormatIds={offeredFormatIds}
          selectedFormatId={selectedFormatId}
          revealRules
          selectionStage="rules_reveal"
          empoweredName={playerName(compilation.snapshot.empoweredId, roster)}
        />
      ) : lastCue ? (
        <FormatPresentation
          cue={lastCue}
          roster={roster}
          currentStateEntry
        />
      ) : (
        <p
          role="status"
          className="rounded-lg border border-amber-200/15 bg-amber-200/[0.04] p-4 text-sm text-amber-100/70"
        >
          {loading
            ? "Loading trusted format state…"
            : "Trusted format presentation evidence is unavailable."}
        </p>
      )}

      {unresolvedBallot ? (
        <p className="mt-4 rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs text-white/55">
          Ballot sealed when the game ended. No result has been inferred.
        </p>
      ) : null}
      {compilation.status === "incomplete" ? (
        <p className="mt-4 rounded-lg border border-amber-200/15 bg-amber-200/[0.04] px-3 py-2 text-xs text-amber-100/70">
          Presentation incomplete: {compilation.diagnostic?.message}
        </p>
      ) : null}
    </section>
  );
}

function playerName(
  playerId: string | null,
  roster: readonly FormatPresentationRosterPlayer[],
): string {
  if (!playerId) return "The Empowered agent";
  return roster.find((player) => player.id === playerId)?.name ?? playerId;
}
