"use client";

import { useState } from "react";
import { GamePlayerAvatarPreview } from "@/components/game-player-avatar-preview";
import { RoomBackdrop } from "./stage-backdrop";
import { INFLUENCE_ROOMS } from "./influence-rooms";
import type {
  FormatPresentationCue,
  FormatPresentationRosterPlayer,
} from "./types";

type TwoNamesCue = Extract<FormatPresentationCue, {
  kind:
    | "two_names_empowered_intro"
    | "two_names_initial_names"
    | "two_names_override_draw"
    | "two_names_mingle_complete"
    | "two_names_override_declined"
    | "two_names_override_removed"
    | "two_names_replacement"
    | "two_names_plea";
}>;

export function TwoNamesStage({
  cue,
  roster,
  currentStateEntry,
  controlsInset = 0,
}: {
  cue: TwoNamesCue;
  roster: readonly FormatPresentationRosterPlayer[];
  currentStateEntry: boolean;
  controlsInset?: number;
}) {
  const facts = cue.after.twoNames;
  const showEmpoweredAnchor = cue.kind !== "two_names_empowered_intro";
  const showOverrideAnchor = Boolean(facts?.overrideHolderId)
    && cue.kind !== "two_names_override_draw"
    && cue.kind !== "two_names_initial_names";

  return (
    <section
      data-format-cue={cue.kind}
      style={{paddingBottom:controlsInset + 16}}
      data-presentation-current-entry={currentStateEntry ? "true" : undefined}
      className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#0b0b0d] p-4 text-[#f5f1ea] md:px-8"
      aria-live="polite"
    >
      <RoomBackdrop source={INFLUENCE_ROOMS.council} />
      {showEmpoweredAnchor && facts?.empoweredId ? (
        <RoleAnchor role="Empowered" player={player(facts.empoweredId, roster)} side="left" />
      ) : null}
      {showOverrideAnchor && facts?.overrideHolderId ? (
        <RoleAnchor role="Override" player={player(facts.overrideHolderId, roster)} side="right" />
      ) : null}

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center pt-16 pb-4">
        {cue.kind === "two_names_empowered_intro" ? (
          <PortraitReveal label="Empowered" player={player(cue.empoweredId, roster)} tone="gold" />
        ) : null}

        {cue.kind === "two_names_initial_names" ? (
          <div className="flex min-h-0 w-full flex-1 flex-col">
            <p className="mb-4 shrink-0 text-center text-sm font-medium tracking-wide text-white/65">
              {name(cue.empoweredId, roster)} nominates:
            </p>
            <DossierPair ids={cue.nomineeIds} roster={roster} reveal />
          </div>
        ) : null}

        {cue.kind === "two_names_override_draw" ? (
          <PortraitReveal label="Override" player={player(cue.overrideHolderId, roster)} tone="violet" />
        ) : null}

        {cue.kind === "two_names_mingle_complete" ? (
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/45">
              {cue.window === "initial_names" ? "First Mingle complete" : "Final Mingle complete"}
            </p>
          </div>
        ) : null}

        {cue.kind === "two_names_override_declined" ? (
          <div className="flex min-h-0 w-full flex-1 flex-col text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#a68cff]">Override declined</p>
            <h2 className="mt-4 font-serif text-3xl md:text-5xl">
              {name(cue.overrideHolderId, roster)} leaves the names untouched
            </h2>
            <div className="mt-4 flex min-h-0 flex-1"><DossierPair ids={cue.finalistPlayerIds} roster={roster} /></div>
          </div>
        ) : null}

        {cue.kind === "two_names_override_removed" && facts?.initialNomineeIds ? (
          <div className="flex min-h-0 w-full flex-1 flex-col">
            <p className="mb-4 shrink-0 text-center text-xs font-semibold uppercase tracking-[0.3em] text-[#a68cff]">Override used</p>
            <DossierPair
              ids={facts.initialNomineeIds}
              roster={roster}
              removedId={cue.removedNomineeId}
            />
          </div>
        ) : null}

        {cue.kind === "two_names_replacement" ? (
          <div className="flex min-h-0 w-full flex-1 flex-col">
            <p className="mb-4 shrink-0 text-center text-sm text-white/60">
              {name(cue.empoweredId, roster)} nominates:
            </p>
            <DossierPair
              ids={cue.finalistPlayerIds}
              roster={roster}
              enteringId={cue.replacementNomineeId}
              reveal
            />
          </div>
        ) : null}

        {cue.kind === "two_names_plea" ? (
          <Plea cue={cue} roster={roster} />
        ) : null}

      </div>
    </section>
  );
}

export function TwoNamesRoleAnchors({
  cue,
  roster,
}: {
  cue: FormatPresentationCue;
  roster: readonly FormatPresentationRosterPlayer[];
}) {
  const facts = cue.after.twoNames;
  if (!facts?.empoweredId) return null;
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <RoleAnchor role="Empowered" player={player(facts.empoweredId, roster)} side="left" compact />
      {facts.overrideHolderId ? <RoleAnchor role="Override" player={player(facts.overrideHolderId, roster)} side="right" compact /> : <span />}
    </div>
  );
}

export function TwoNamesVoteStage({ cue, roster }: {
  cue: Extract<FormatPresentationCue, { kind: "format_roll_call" | "format_aggregate" }>;
  roster: readonly FormatPresentationRosterPlayer[];
}) {
  const aggregate = cue.after.resolution?.aggregate;
  const finalistPlayerIds = aggregate?.capability === "two_names" ? aggregate.finalistPlayerIds : cue.after.twoNames?.finalistPlayerIds;
  if (!finalistPlayerIds) return null;
  const isResult = cue.kind === "format_aggregate";
  // During roll call count only the published receipts, never the final aggregate.
  const totals = isResult && aggregate?.capability === "two_names" ? aggregate.totals : Object.fromEntries(finalistPlayerIds.map((id) => [
    id, cue.after.revealedBallots.filter((ballot) => ballot.targetId === id).length,
  ]));
  const tied = totals[finalistPlayerIds[0]] === totals[finalistPlayerIds[1]];
  return (
    <section data-format-cue={cue.kind} className="w-full max-w-2xl px-4 py-3" aria-live="polite">
      <p className="mb-5 text-center text-xs uppercase tracking-[0.25em] text-white/60">
        {isResult ? (tied ? "Tie · Empowered decides" : "Result locked") : `Roll call · ${cue.rollCallIndex + 1} of ${cue.rollCallCount}`}
      </p>
      <dl aria-label="Two Names vote totals" className="flex justify-center gap-10 text-center">
        {finalistPlayerIds.map(id => <div key={id}>
          <dt className="font-medium text-white">{name(id, roster)}</dt>
          <dd className="mt-2 text-3xl font-semibold text-white" aria-label={`${name(id, roster)}: ${totals[id] ?? 0} exit vote${totals[id] === 1 ? "" : "s"}`}>
            {totals[id] ?? 0}<span className="block text-xs font-normal text-white/50">Exit votes</span>
          </dd>
        </div>)}
      </dl>
      {cue.kind === "format_roll_call" ? (
        <p className="mt-5 text-center text-sm text-white/80">
          <strong>{name(cue.ballot.voterId, roster)}</strong> votes to exit <strong>{cue.ballot.targetId ? name(cue.ballot.targetId, roster) : "—"}</strong>
        </p>
      ) : null}
      {!isResult && tied ? <p className="mt-3 text-center text-xs uppercase tracking-widest text-[#e7bd70]">Tie</p> : null}
    </section>
  );
}

function RoleAnchor({ player: source, role, side, compact = false }: {
  player: FormatPresentationRosterPlayer;
  role: "Empowered" | "Override";
  side: "left" | "right";
  compact?: boolean;
}) {
  return (
    <div
      className={`${compact ? "relative" : "absolute top-5 z-20 md:top-7"} ${!compact && side === "left" ? "left-5 md:left-8" : ""} ${!compact && side === "right" ? "right-5 md:right-8" : ""} flex items-center gap-2 rounded-full border border-white/10 bg-black/50 py-1.5 pl-1.5 pr-3`}
    >
      <Avatar player={source} size="8" />
      <span className="min-w-0 text-left">
        <span className={`block text-[9px] font-semibold uppercase tracking-[0.22em] ${role === "Empowered" ? "text-[#e7bd70]" : "text-[#a68cff]"}`}>{role}</span>
        <span className="block max-w-28 truncate text-xs text-white/80" title={source.name}>{source.name}</span>
      </span>
    </div>
  );
}

function PortraitReveal({ player: source, label, tone }: {
  player: FormatPresentationRosterPlayer;
  label: string;
  tone: "gold" | "violet";
}) {
  return (
    <div data-two-names-reveal="portrait" className="flex min-h-0 w-full flex-1 flex-col text-center">
      <p className={`mb-4 shrink-0 text-xs font-semibold uppercase tracking-[0.34em] ${tone === "gold" ? "text-[#e7bd70]" : "text-[#a68cff]"}`}>{label}</p>
      <CharacterArt player={source} prominent />
      <h2 className="mt-3 shrink-0 font-serif text-3xl md:text-5xl" title={source.name}>{source.name}</h2>
    </div>
  );
}

function DossierPair({ ids, roster, removedId, enteringId, reveal = false }: {
  ids: [string, string];
  roster: readonly FormatPresentationRosterPlayer[];
  removedId?: string;
  enteringId?: string;
  reveal?: boolean;
}) {
  return (
    <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-2 gap-4 md:gap-12">
      {ids.map((id, index) => (
        <article
          key={id}
          data-nominee-id={id}
          data-two-names-reveal={reveal && (!enteringId || enteringId === id) ? "dossier" : undefined}
          data-dossier-index={index}
          style={{ opacity: removedId === id ? 0.28 : 1 }}
          className="relative flex min-h-0 min-w-0 flex-col items-center"
        >
          <div className="flex min-h-0 w-full flex-1 flex-col items-center">
            <CharacterArt player={player(id, roster)} />
            <h3 className="mt-3 max-w-full shrink-0 text-center font-serif text-xl leading-tight md:text-3xl" title={name(id, roster)}>{name(id, roster)}</h3>
            <p className="mt-2 shrink-0 text-[9px] font-semibold uppercase tracking-[0.28em] text-[#ff7b91]">Nominated</p>
          </div>
          {removedId === id ? <span className="absolute left-[12%] top-1/2 h-0.5 w-[76%] -rotate-12 bg-[#ff7b91] shadow-[0_0_16px_rgba(255,123,145,0.65)]" aria-label="Removed" /> : null}
        </article>
      ))}
    </div>
  );
}

function Plea({ cue, roster }: {
  cue: Extract<TwoNamesCue, { kind: "two_names_plea" }>;
  roster: readonly FormatPresentationRosterPlayer[];
}) {
  const source = player(cue.speakerId, roster);
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-5 text-left">
      <div className="flex shrink-0 items-center gap-4">
        <Avatar player={source} size="16" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#ff7b91]">Final plea · {cue.ordinal + 1} of 2</p>
          <h2 className="mt-2 break-words font-serif text-3xl md:text-4xl">{source.name}</h2>
        </div>
      </div>
      <blockquote tabIndex={0} aria-label={`${source.name}'s final plea`} className="min-h-0 overflow-y-auto overscroll-contain break-words pr-2 font-serif text-lg leading-relaxed text-white/85 md:text-xl">
        {cue.status === "accepted" ? `“${cue.text}”` : "No plea was received"}
      </blockquote>
    </div>
  );
}

function Avatar({ player: source, size }: { player: FormatPresentationRosterPlayer; size: "8" | "16" | "32" }) {
  return <GamePlayerAvatarPreview player={{ ...source, persona: source.persona ?? "" }} size={size} />;
}

/** The visual API selects the cutout, or original full body when no cutout exists. */
function CharacterArt({player: source, prominent = false}: {player: FormatPresentationRosterPlayer; prominent?: boolean}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const body = source.fullBodyReferenceUrl;
  if (!body || body === failedSource) return <div data-two-names-art="portrait" className="flex min-h-0 flex-1 items-center justify-center"><Avatar player={source} size={prominent ? "32" : "16"} /></div>;
  return <div data-two-names-art="full-body" className="relative mx-auto min-h-0 w-full flex-1">
    {/* eslint-disable-next-line @next/next/no-img-element -- frozen cutout with historical portrait fallback */}
    <img src={body} alt={source.name} className="absolute inset-0 h-full w-full object-contain object-bottom" onError={() => setFailedSource(body)} />
  </div>;
}

function player(id: string, roster: readonly FormatPresentationRosterPlayer[]): FormatPresentationRosterPlayer {
  return roster.find((entry) => entry.id === id) ?? { id, name: id, persona: "" };
}

function name(id: string, roster: readonly FormatPresentationRosterPlayer[]): string {
  return player(id, roster).name;
}
