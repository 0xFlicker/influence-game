"use client";

import { motion } from "motion/react";
import type {
  FormatPresentationCue,
  FormatPresentationRosterPlayer,
} from "./types";

type SafetyBounceCue = Extract<
  FormatPresentationCue,
  { kind: "safety_bounce_started" | "safety_bounce_pointer" }
>;

export function SafetyBounceStage({
  cue,
  roster,
  currentStateEntry = false,
}: {
  cue: SafetyBounceCue;
  roster: readonly FormatPresentationRosterPlayer[];
  currentStateEntry?: boolean;
}) {
  const board = cue.after.safetyBounce;
  if (!board) {
    return (
      <section
        data-format-cue={cue.kind}
        data-format-presentation="incomplete"
        role="status"
        className="w-full rounded-xl border border-amber-200/20 bg-amber-200/[0.04] p-6 text-center"
      >
        <h2 className="text-lg font-semibold text-white">Safety board unavailable</h2>
        <p className="mt-2 text-sm text-white/55">
          The trusted classification prefix is incomplete.
        </p>
      </section>
    );
  }

  const centerActorId = currentStateEntry
    ? board.currentActorId
    : cue.kind === "safety_bounce_started"
      ? cue.starterId
      : cue.actorId;
  const participatingIds = new Set([
    ...board.safePlayerIds,
    ...board.vulnerablePlayerIds,
    ...board.benchPlayerIds,
    centerActorId,
  ]);
  const safePlayerIds = board.safePlayerIds.filter((id) => id !== centerActorId);
  const vulnerablePlayerIds = board.vulnerablePlayerIds.filter(
    (id) => id !== centerActorId,
  );
  const benchPlayerIds = board.benchPlayerIds.filter((id) => id !== centerActorId);
  const participantRoster = roster.filter((player) => participatingIds.has(player.id));

  return (
    <section
      data-format-cue={cue.kind}
      data-safety-bounce-stage
      className="mx-auto w-full max-w-5xl rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-6"
    >
      <header className="text-center">
        <p className="text-[10px] uppercase tracking-[0.28em] text-white/35">
          Classification stage
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">
          Safety Bounce
        </h2>
        <p className="mt-2 text-sm text-white/50">
          Safe chooses Vulnerable. Vulnerable chooses Safe.
        </p>
      </header>

      {cue.kind === "safety_bounce_pointer" ? (
        <PointerReceipt cue={cue} roster={participantRoster} />
      ) : (
        <p className="mt-5 text-center text-sm text-emerald-200/80" aria-live="polite">
          {playerName(cue.starterId, participantRoster)} starts Safe and owns the first choice.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_minmax(9rem,0.8fr)_1fr]">
        <SafetyLane
          lane="safe"
          label="Safe"
          playerIds={safePlayerIds}
          roster={participantRoster}
        />

        <div className="order-first flex min-h-36 flex-col items-center justify-center rounded-xl border border-fuchsia-300/25 bg-fuchsia-300/[0.06] p-4 text-center sm:order-none">
          <p className="text-[10px] uppercase tracking-[0.22em] text-fuchsia-200/55">
            Choosing now
          </p>
          <motion.div
            layout
            data-board-member={centerActorId}
            data-center-actor={centerActorId}
            className="mt-3 w-full rounded-lg border border-fuchsia-200/25 bg-black/25 px-3 py-4"
          >
            <p className="break-words text-sm font-semibold text-white">
              {playerName(centerActorId, participantRoster)}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-fuchsia-200/60">
              Center actor
            </p>
          </motion.div>
        </div>

        <SafetyLane
          lane="vulnerable"
          label="Vulnerable"
          playerIds={vulnerablePlayerIds}
          roster={participantRoster}
        />
      </div>

      <SafetyLane
        lane="bench"
        label="Unclassified bench"
        playerIds={benchPlayerIds}
        roster={participantRoster}
        horizontal
      />
    </section>
  );
}

function PointerReceipt({
  cue,
  roster,
}: {
  cue: Extract<FormatPresentationCue, { kind: "safety_bounce_pointer" }>;
  roster: readonly FormatPresentationRosterPlayer[];
}) {
  return (
    <div className="mt-5">
      <div
        aria-hidden="true"
        className="flex min-h-8 flex-wrap items-center justify-center gap-2"
        data-pointer-cycle
        data-pointer-pacing={cue.pacing}
      >
        {cue.pointerCandidateIds.map((candidateId, index) => (
          <span
            key={`${candidateId}-${index}`}
            data-pointer-cycle-candidate="true"
            data-pointer-candidate-id={candidateId}
            data-canonical-target={
              index === cue.pointerCandidateIds.length - 1 ? "true" : undefined
            }
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/30"
          >
            {playerName(candidateId, roster)}
          </span>
        ))}
      </div>
      <p
        data-accepted-target={cue.targetId}
        aria-live="polite"
        className="mt-3 text-center text-sm font-medium text-white/85"
      >
        <span className="text-white/40">Accepted target · </span>
        {playerName(cue.targetId, roster)}
        <span className="text-white/40"> → </span>
        <span
          className={
            cue.classification === "safe"
              ? "text-emerald-300"
              : "text-rose-300"
          }
        >
          {cue.classification === "safe" ? "Safe" : "Vulnerable"}
        </span>
      </p>
    </div>
  );
}

function SafetyLane({
  lane,
  label,
  playerIds,
  roster,
  horizontal = false,
}: {
  lane: "safe" | "vulnerable" | "bench";
  label: string;
  playerIds: readonly string[];
  roster: readonly FormatPresentationRosterPlayer[];
  horizontal?: boolean;
}) {
  const laneClasses = {
    safe: "border-emerald-300/20 bg-emerald-300/[0.045]",
    vulnerable: "border-rose-300/20 bg-rose-300/[0.045]",
    bench: "border-white/10 bg-white/[0.025]",
  }[lane];

  return (
    <div
      data-lane={lane}
      className={`${horizontal ? "mt-3 min-h-24" : "min-h-36"} rounded-xl border p-3 ${laneClasses}`}
    >
      <p className="text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
        {label}
      </p>
      <div
        className={`mt-3 ${
          horizontal
            ? "flex flex-wrap justify-center gap-2"
            : "grid grid-cols-2 gap-2 sm:grid-cols-1"
        }`}
      >
        {playerIds.map((playerId) => (
          <motion.div
            layout
            key={playerId}
            data-board-member={playerId}
            className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-center"
          >
            <p className="break-words text-xs font-medium text-white/80">
              {playerName(playerId, roster)}
            </p>
          </motion.div>
        ))}
        {playerIds.length === 0 ? (
          <p className="col-span-full py-2 text-center text-xs text-white/20">—</p>
        ) : null}
      </div>
    </div>
  );
}

function playerName(
  playerId: string,
  roster: readonly FormatPresentationRosterPlayer[],
): string {
  return roster.find((player) => player.id === playerId)?.name ?? playerId;
}
