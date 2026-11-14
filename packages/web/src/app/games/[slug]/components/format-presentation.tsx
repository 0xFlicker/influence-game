import {getFormatRegistration} from "@influence/engine/format-rules";
import { useMemo, type ReactNode } from "react";
import { publicMediaDeliveryView } from "@/lib/public-media-delivery";
import { usePublicMediaDelivery } from "@/lib/public-media-delivery-context";
import type { FormatPresentationCue, FormatPresentationRosterPlayer } from "./types";
import { ActiveFormatLabel } from "./active-format-label";
import { FormatBallotReveal } from "./format-ballot-reveal";
import { FormatEmpowerVoteStage } from "./format-empower-vote-stage";
import {FormatMenuStage} from "./format-menu-stage";
import { FormatOfferStage } from "./format-offer-stage";
import { FormatResolutionStage } from "./format-resolution-stage";
import { SafetyBounceStage } from "./safety-bounce-stage";
import { TwoNamesRoleAnchors, TwoNamesStage, TwoNamesVoteStage, TwoNamesResultStage } from "./two-names-stage";
import { FORMAT_PRESENTATION_METADATA } from "@influence/engine/format-presentation-metadata";
import {ResultStage, formatResultPlayers} from "./result-stage";
import {resultRoom} from "./influence-rooms";
import {TimedSpeech} from "./timed-speech";

/**
 * True when this cue paints its own full-stage room backdrop (a ResultStage
 * or a Two Names result stage). Stage roots must suppress their fallback
 * scenery for these cues, or the same room renders twice: once across the
 * stage and again inset inside the result section.
 */
export function formatPresentationOwnsBackdrop(cue: FormatPresentationCue, currentStateEntry: boolean): boolean {
  if (cue.kind === "format_selected" && cue.stage === "rules_reveal" && !currentStateEntry) return true;
  if (cue.kind === "format_menu" && cue.resultsPresentation && cue.compactEmpower) return true;
  if (cue.kind.startsWith("two_names_")) return true;
  if ((cue.kind === "format_aggregate" || cue.kind === "format_elimination") && cue.after.activeFormatId === "two_names") return true;
  const specialized = cue.kind.startsWith("two_names_") || cue.kind.startsWith("safety_bounce_")
    || cue.after.activeFormatId === "two_names";
  return Boolean(cue.resultsPresentation && !specialized);
}

export function FormatPresentation(sourceProps: Parameters<typeof FormatPresentationContent>[0]) {
  const publicDelivery = usePublicMediaDelivery();
  const delivery = useMemo(() => publicMediaDeliveryView({cue:sourceProps.cue, roster:sourceProps.roster}, publicDelivery), [sourceProps.cue, sourceProps.roster, publicDelivery]);
  const props = {...sourceProps, ...delivery};
  const {cue, roster} = props;
  if (cue.kind === "format_selected" && cue.stage === "rules_reveal" && !props.currentStateEntry) {
    const metadata = FORMAT_PRESENTATION_METADATA[cue.formatId];
    return <ResultStage packed compactCast players={formatResultPlayers(cue, roster)} background={resultRoom(cue.phase)}>
      <section data-format-cue="format_selected" data-format-rules={cue.formatId} data-format-auto-selected={!cue.before.offeredFormatIds ? cue.formatId : undefined} className="flex min-h-0 flex-1 flex-col gap-2 px-2 py-1">
        <div className="shrink-0"><p className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/60">Format selected</p>
          <h2 className="text-xl font-semibold text-white">{metadata.displayName}</h2></div>
        <TimedSpeech text={metadata.conciseRules} elapsedMs={props.elapsedMs ?? 0} progress={Math.min(1, (props.elapsedMs ?? 0) / cue.baseDurationMs)} className="text-sm leading-5 text-white/90" />
      </section>
    </ResultStage>;
  }
  if(cue.kind === "format_menu" && cue.resultsPresentation && cue.compactEmpower) {
    const player=roster.find(player=>player.id===cue.empoweredId);
    if(!player) throw new Error("Format menu references a missing Empowered player");
    return <ResultStage packed background={resultRoom(cue.phase)}><FormatMenuStage player={player} offeredFormatIds={cue.offeredFormatIds} /></ResultStage>;
  }
  const specialized = cue.kind.startsWith("two_names_") || cue.kind.startsWith("safety_bounce_")
    || cue.after.activeFormatId === "two_names";
  const content = <FormatPresentationContent {...props} />;
  return cue.resultsPresentation && !specialized
    ? <ResultStage compactCast={cue.compactEmpower} packed={Boolean(cue.compactEmpower && (cue.kind === "empowered_tally" || cue.kind === "empowered_tie"))} players={cue.compactEmpower && (cue.kind === "empowered_tally" || cue.kind === "empowered_tie") ? [] : formatResultPlayers(cue, roster)} background={resultRoom(cue.phase)}>{content}</ResultStage>
    : content;
}

function FormatPresentationContent({
  cue,
  roster,
  currentStateEntry,
  controlsInset = 0,
  elapsedMs,
  reducedMotion,
}: {
  cue: FormatPresentationCue;
  roster: readonly FormatPresentationRosterPlayer[];
  currentStateEntry: boolean;
  controlsInset?: number;
  elapsedMs?: number;
  reducedMotion?: boolean;
}) {
  if (cue.kind === "empowered_tally" || cue.kind === "empowered_tie") {
    return (
      <FormatEmpowerVoteStage
        compact={cue.compactEmpower}
        empoweredId={cue.kind === "empowered_tally" ? cue.empoweredId : null}
        tiedPlayerIds={cue.kind === "empowered_tie" ? cue.tiedPlayerIds : []}
        resolutionMethod={cue.kind === "empowered_tally" ? cue.resolutionMethod : undefined}
        countedVotes={cue.kind === "empowered_tally" ? cue.countedVotes : undefined}
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
      const metadata = FORMAT_PRESENTATION_METADATA[cue.formatId];
      return (
        <section
          data-format-cue="format_selected"
          data-format-auto-selected={cue.formatId}
          className="mx-auto max-w-xl rounded-xl border border-cyan-200/20 bg-cyan-200/[0.04] p-6 text-center"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100/45">
            Format locked
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {metadata.displayName}
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/65">
            {metadata.conciseRules}
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
      <PresentationShell cue={cue} roster={roster} currentStateEntry={currentStateEntry}>
        <SafetyBounceStage
          cue={cue}
          roster={roster}
          currentStateEntry={currentStateEntry}
        />
      </PresentationShell>
    );
  }

  if (cue.kind === "two_names_empowered_intro" || cue.kind === "two_names_initial_names" || cue.kind === "two_names_override_draw" || cue.kind === "two_names_mingle_complete" || cue.kind === "two_names_override_declined" || cue.kind === "two_names_override_removed" || cue.kind === "two_names_replacement" || cue.kind === "two_names_plea") {
    return <TwoNamesStage elapsedMs={elapsedMs} reducedMotion={reducedMotion} cue={cue} roster={roster} currentStateEntry={currentStateEntry} controlsInset={controlsInset} />;
  }

  if ((cue.kind === "format_aggregate" || cue.kind === "format_elimination") && cue.after.activeFormatId === "two_names") {
    return <TwoNamesResultStage cue={cue} roster={roster} controlsInset={controlsInset} />;
  }

  if (cue.kind === "format_roll_call" && cue.after.activeFormatId === "two_names") {
    return (
      <PresentationShell cue={cue} roster={roster} currentStateEntry={currentStateEntry}>
        <TwoNamesVoteStage cue={cue} roster={roster} />
      </PresentationShell>
    );
  }

  if (cue.kind === "format_aggregate") {
    return (
      <PresentationShell cue={cue} roster={roster} currentStateEntry={currentStateEntry}>
        <FormatResolutionStage cue={cue} roster={roster} />
      </PresentationShell>
    );
  }

  if (cue.kind === "format_roll_call") {
    return (
      <PresentationShell cue={cue} roster={roster} currentStateEntry={currentStateEntry}>
        <FormatBallotReveal cue={cue} roster={roster} />
      </PresentationShell>
    );
  }

  if (cue.kind === "format_tiebreak") {
    return (
      <PresentationShell cue={cue} roster={roster} currentStateEntry={currentStateEntry}>
        <section
          data-format-cue="format_tiebreak"
          className="w-full px-6 py-8 text-center"
          aria-live="polite"
        >
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
            The deciding vote
          </p>
          <h2 className="mt-3 text-xl font-semibold text-white">
            {playerName(cue.tiebreakerId, roster)} must break the tie
          </h2>
          <p className="mt-3 text-sm text-white/55">
            Tied: {cue.tiedPlayerIds.map((id) => playerName(id, roster)).join(" · ")}
          </p>
        </section>
      </PresentationShell>
    );
  }

  if (cue.kind === "format_deciding_vote") {
    return <section data-format-cue="format_deciding_vote" className="text-center">
      <p className="text-sm text-amber-200">{playerName(cue.tiebreakerId, roster)} · Deciding vote</p>
      <p className="mt-3 text-2xl text-white">{playerName(cue.targetId, roster)}</p>
    </section>;
  }

  if (cue.kind === "format_elimination") {
    return (
      <PresentationShell cue={cue} roster={roster} currentStateEntry={currentStateEntry}>
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
          {cue.resultsPresentation && cue.after.resolution && <ResolvedFacts resolution={cue.after.resolution} playerId={cue.eliminatedId} />}
          {!cue.resultsPresentation && <p className="mt-3 text-sm capitalize text-white/45">
            {cue.resolutionKind} resolution
          </p>}
        </section>
      </PresentationShell>
    );
  }

  const unhandled: never = cue;
  throw new Error(`Unsupported format presentation cue: ${JSON.stringify(unhandled)}`);
}

function PresentationShell({
  cue,
  children,
  roster,
  currentStateEntry,
}: {
  cue: Exclude<
    FormatPresentationCue,
    { kind: "empowered_tally" | "format_menu" | "format_selected" }
  >;
  children: ReactNode;
  roster: readonly FormatPresentationRosterPlayer[];
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
      {cue.after.activeFormatId === "two_names" ? (
        <TwoNamesRoleAnchors cue={cue} roster={roster} />
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

/** Display only the accepted aggregate; never infer the method from House prose. */
function ResolvedFacts({resolution,playerId}:{resolution:import("./types").FormatResolutionPresentation;playerId:string}) {
  const aggregate = resolution.aggregate;
  const facts = aggregate.capability === "sealed_elim" || aggregate.capability === "two_names"
    ? aggregate.totals[playerId] === undefined ? "Vote total unavailable" : `${aggregate.totals[playerId]} votes`
    : aggregate.capability === "sealed_polarity"
      ? aggregate.nets[playerId] === undefined ? "Totals unavailable" : `${aggregate.savesReceived[playerId]} saves · ${aggregate.eliminateReceived[playerId]} exits · net ${aggregate.nets[playerId]}`
      : aggregate.vulnerablePlayerIds.length === 1 ? "Automatic exit · no final ballot"
        : aggregate.voteTotals[playerId] === undefined ? "Vote total unavailable" : `${aggregate.voteTotals[playerId]} final votes`;
  const registration = getFormatRegistration(resolution.formatId);
  const rule = registration.capability === "sealed_elim"
    ? registration.presentation.scoring === "highest_even" && aggregate.capability === "sealed_elim" && Object.values(aggregate.totals).every(total=>total%2!==0) ? "All totals odd · Empowered chooses" : {highest_total:"Highest total exits",fewest_positive:"Fewest positive votes exits",highest_even:"Highest qualifying even total exits"}[registration.presentation.scoring]
    : aggregate.capability === "sealed_polarity" ? "Lowest net score exits" : aggregate.capability === "two_names" ? "Higher nominee total exits" : "Final vulnerable vote";
  return <div className="mt-3 space-y-2 text-sm text-white/80"><p>{facts}</p><p>{rule}</p>{resolution.tiebreakerId && <p>Resolved by a deciding vote</p>}</div>;
}
