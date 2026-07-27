import type { FormatPresentationCue, FormatPresentationRosterPlayer } from "./types";
import { ActiveFormatLabel } from "./active-format-label";
import { FormatEmpowerVoteStage } from "./format-empower-vote-stage";
import { FormatOfferStage } from "./format-offer-stage";

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4">
      {cue.after.activeFormatId ? (
        <ActiveFormatLabel formatId={cue.after.activeFormatId} />
      ) : null}
      <section
        data-presentation-cue={cue.key}
        data-format-cue={cue.kind}
        className="w-full rounded-xl border border-white/10 bg-white/[0.035] p-6 text-center"
        aria-live="polite"
      >
        <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
          Canonical format beat
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-white/95">
          {formatCueTitle(cue)}
        </h2>
        <p className="mt-3 text-sm leading-6 text-white/60">
          {formatCueDescription(cue)}
        </p>
      </section>
    </div>
  );
}

function playerName(
  playerId: string,
  roster: readonly FormatPresentationRosterPlayer[],
): string {
  return roster.find((player) => player.id === playerId)?.name ?? playerId;
}

function formatCueTitle(
  cue: Exclude<
    FormatPresentationCue,
    { kind: "empowered_tally" | "format_menu" | "format_selected" }
  >,
): string {
  switch (cue.kind) {
    case "safety_bounce_started":
      return "Safety Bounce begins";
    case "safety_bounce_pointer":
      return "Classification accepted";
    case "format_aggregate":
      return "Tally locked";
    case "format_roll_call":
      return "Ballot revealed";
    case "format_tiebreak":
      return "Tiebreak receipt";
    case "format_elimination":
      return "Format resolved";
  }
}

function formatCueDescription(
  cue: Exclude<
    FormatPresentationCue,
    { kind: "empowered_tally" | "format_menu" | "format_selected" }
  >,
): string {
  switch (cue.kind) {
    case "safety_bounce_started":
      return `${cue.starterId} starts Safe and owns the first choice.`;
    case "safety_bounce_pointer":
      return `${cue.actorId} classifies ${cue.targetId} as ${cue.classification}.`;
    case "format_aggregate":
      return `The ${cue.resolution.formatId} aggregate is final.`;
    case "format_roll_call":
      return `${cue.ballot.voterId} → ${cue.ballot.targetId}${
        cue.ballot.polarity ? ` (${cue.ballot.polarity})` : ""
      }`;
    case "format_tiebreak":
      return `${cue.tiebreakerId} breaks the tie.`;
    case "format_elimination":
      return `${cue.eliminatedId} is eliminated.`;
  }
}
