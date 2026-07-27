import type { ReactNode } from "react";
import type { FormatPresentationCue, FormatPresentationRosterPlayer } from "./types";
import { ActiveFormatLabel } from "./active-format-label";
import { FormatBallotReveal } from "./format-ballot-reveal";
import { FormatEmpowerVoteStage } from "./format-empower-vote-stage";
import { FormatOfferStage } from "./format-offer-stage";
import { FormatResolutionStage } from "./format-resolution-stage";
import { SafetyBounceStage } from "./safety-bounce-stage";

export function FormatPresentation({
  cue,
  roster,
  currentStateEntry,
}: {
  cue: FormatPresentationCue;
  roster: readonly FormatPresentationRosterPlayer[];
  currentStateEntry: boolean;
}) {
  if (cue.kind === "empowered_tally") {
    return (
      <FormatEmpowerVoteStage
        empoweredId={cue.empoweredId}
        counts={cue.counts}
        receipts={cue.receipts}
        roster={roster}
      />
    );
  }

  if (cue.kind === "format_menu") {
    return (
      <FormatOfferStage
        offeredFormatIds={cue.offeredFormatIds}
        selectedFormatId={null}
        revealRules={false}
        empoweredName={playerName(cue.empoweredId, roster)}
      />
    );
  }

  if (cue.kind === "format_selected") {
    if (currentStateEntry) {
      return (
        <div className="flex justify-center">
          <ActiveFormatLabel formatId={cue.formatId} />
        </div>
      );
    }
    if (!cue.before.offeredFormatIds) {
      return (
        <section
          data-format-cue="format_selected"
          data-format-presentation="incomplete"
          role="status"
          className="mx-auto max-w-xl rounded-xl border border-amber-200/20 bg-amber-200/[0.04] p-6 text-center"
        >
          <h2 className="text-lg font-semibold text-white">Format presentation incomplete</h2>
          <p className="mt-2 text-sm text-white/55">
            The trusted offered pair is unavailable for this selection.
          </p>
        </section>
      );
    }
    return (
      <FormatOfferStage
        offeredFormatIds={cue.before.offeredFormatIds}
        selectedFormatId={cue.formatId}
        revealRules={cue.stage === "rules_reveal"}
        selectionStage={cue.stage}
        empoweredName={playerName(cue.empoweredId, roster)}
      />
    );
  }

  if (
    cue.kind === "safety_bounce_started"
    || cue.kind === "safety_bounce_pointer"
  ) {
    return (
      <PresentationShell cue={cue} currentStateEntry={currentStateEntry}>
        <SafetyBounceStage
          cue={cue}
          roster={roster}
          currentStateEntry={currentStateEntry}
        />
      </PresentationShell>
    );
  }

  if (cue.kind === "format_aggregate") {
    return (
      <PresentationShell cue={cue} currentStateEntry={currentStateEntry}>
        <FormatResolutionStage cue={cue} roster={roster} />
      </PresentationShell>
    );
  }

  if (cue.kind === "format_roll_call") {
    return (
      <PresentationShell cue={cue} currentStateEntry={currentStateEntry}>
        <FormatBallotReveal cue={cue} roster={roster} />
      </PresentationShell>
    );
  }

  if (cue.kind === "format_tiebreak") {
    return (
      <PresentationShell cue={cue} currentStateEntry={currentStateEntry}>
        <section
          data-format-cue="format_tiebreak"
          className="w-full rounded-2xl border border-white/10 bg-white/[0.035] p-6 text-center"
          aria-live="polite"
        >
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
            Tiebreak receipt
          </p>
          <h2 className="mt-3 text-xl font-semibold text-white">
            {playerName(cue.tiebreakerId, roster)} breaks the tie
          </h2>
          <p className="mt-3 text-sm text-white/55">
            Tied: {cue.tiedPlayerIds.map((id) => playerName(id, roster)).join(" · ")}
          </p>
        </section>
      </PresentationShell>
    );
  }

  if (cue.kind === "format_elimination") {
    return (
      <PresentationShell cue={cue} currentStateEntry={currentStateEntry}>
        <section
          data-format-cue="format_elimination"
          data-resolution-kind={cue.resolutionKind}
          className="w-full rounded-2xl border border-rose-300/20 bg-rose-300/[0.045] p-6 text-center"
          aria-live="polite"
        >
          <p className="text-[10px] uppercase tracking-[0.24em] text-rose-200/50">
            Format resolved
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white">
            {playerName(cue.eliminatedId, roster)} is eliminated
          </h2>
          <p className="mt-3 text-sm capitalize text-white/45">
            {cue.resolutionKind} resolution
          </p>
        </section>
      </PresentationShell>
    );
  }

  return null;
}

function PresentationShell({
  cue,
  children,
  currentStateEntry,
}: {
  cue: Exclude<
    FormatPresentationCue,
    { kind: "empowered_tally" | "format_menu" | "format_selected" }
  >;
  children: ReactNode;
  currentStateEntry: boolean;
}) {
  return (
    <div
      data-presentation-cue={cue.key}
      data-presentation-current-entry={currentStateEntry ? "true" : "false"}
      className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4"
    >
      {cue.after.activeFormatId ? (
        <ActiveFormatLabel formatId={cue.after.activeFormatId} />
      ) : null}
      {children}
    </div>
  );
}

function playerName(
  playerId: string,
  roster: readonly FormatPresentationRosterPlayer[],
): string {
  return roster.find((player) => player.id === playerId)?.name ?? playerId;
}
