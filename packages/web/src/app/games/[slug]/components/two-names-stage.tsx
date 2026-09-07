"use client";

import { GamePlayerAvatarPreview } from "@/components/game-player-avatar-preview";
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
    | "two_names_plea"
    | "two_names_ballots_sealing";
}>;

export function TwoNamesStage({
  cue,
  roster,
  currentStateEntry,
}: {
  cue: TwoNamesCue;
  roster: readonly FormatPresentationRosterPlayer[];
  currentStateEntry: boolean;
}) {
  const facts = cue.after.twoNames;
  const finalistIds = facts?.finalistPlayerIds ?? facts?.initialNomineeIds;
  const showEmpoweredAnchor = cue.kind !== "two_names_empowered_intro";
  const showOverrideAnchor = Boolean(facts?.overrideHolderId)
    && cue.kind !== "two_names_override_draw"
    && cue.kind !== "two_names_initial_names";

  return (
    <section
      data-format-cue={cue.kind}
      data-presentation-current-entry={currentStateEntry ? "true" : undefined}
      className={`relative mx-auto flex ${cue.kind === "two_names_plea" ? "h-full min-h-0" : ""} w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0b0b0d] p-4 text-[#f5f1ea] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_80px_rgba(0,0,0,0.35)] md:px-6`}
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(231,189,112,0.09),transparent_34%),radial-gradient(circle_at_80%_80%,rgba(166,140,255,0.06),transparent_34%)]" />
      {showEmpoweredAnchor && facts?.empoweredId ? (
        <RoleAnchor role="Empowered" player={player(facts.empoweredId, roster)} side="left" />
      ) : null}
      {showOverrideAnchor && facts?.overrideHolderId ? (
        <RoleAnchor role="Override" player={player(facts.overrideHolderId, roster)} side="right" />
      ) : null}

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center pt-20">
        {cue.kind === "two_names_empowered_intro" ? (
          <PortraitReveal label="Empowered" player={player(cue.empoweredId, roster)} tone="gold" />
        ) : null}

        {cue.kind === "two_names_initial_names" ? (
          <div className="w-full">
            <p className="mb-7 text-center text-sm font-medium tracking-wide text-white/65">
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
          <div className="w-full text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#a68cff]">Override declined</p>
            <h2 className="mt-4 font-serif text-3xl md:text-5xl">
              {name(cue.overrideHolderId, roster)} leaves the names untouched
            </h2>
            <div className="mt-8"><DossierPair ids={cue.finalistPlayerIds} roster={roster} /></div>
          </div>
        ) : null}

        {cue.kind === "two_names_override_removed" && facts?.initialNomineeIds ? (
          <div className="w-full">
            <p className="mb-7 text-center text-xs font-semibold uppercase tracking-[0.3em] text-[#a68cff]">Override used</p>
            <DossierPair
              ids={facts.initialNomineeIds}
              roster={roster}
              removedId={cue.removedNomineeId}
            />
          </div>
        ) : null}

        {cue.kind === "two_names_replacement" ? (
          <div className="w-full">
            <p className="mb-7 text-center text-sm text-white/60">
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

        {cue.kind === "two_names_ballots_sealing" && finalistIds ? (
          <div className="w-full text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#ff7b91]">Exit voting begins</p>
            <div className="mt-8"><DossierPair ids={finalistIds} roster={roster} /></div>
            <p className="mt-4 text-xs text-white/55">Ballots sealed · {cue.sealedCount} of {cue.eligibleCount}</p>
            <div className="mt-3 flex items-center justify-center gap-2" aria-label={`${cue.sealedCount} of ${cue.eligibleCount} ballots sealed`}>
              {Array.from({ length: cue.eligibleCount }, (_, index) => (
                <span key={index} className={`h-2 w-2 rounded-full ${index < cue.sealedCount ? "bg-[#f5f1ea]" : "bg-white/15"}`} />
              ))}
            </div>
          </div>
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
  if (aggregate?.capability !== "two_names") return null;
  const isResult = cue.kind === "format_aggregate";
  // During roll call count only the published receipts, never the final aggregate.
  const totals = isResult ? aggregate.totals : Object.fromEntries(aggregate.finalistPlayerIds.map((id) => [
    id, cue.after.revealedBallots.filter((ballot) => ballot.targetId === id).length,
  ]));
  const tied = totals[aggregate.finalistPlayerIds[0]] === totals[aggregate.finalistPlayerIds[1]];
  return (
    <section data-format-cue={cue.kind} className="w-full rounded-2xl border border-white/10 bg-[#0b0b0d] p-4 sm:p-6" aria-live="polite">
      <p className="mb-5 text-center text-xs uppercase tracking-[0.25em] text-white/60">
        {isResult ? (tied ? "Tie · Empowered decides" : "Result locked") : `Roll call · ${cue.rollCallIndex + 1} of ${cue.rollCallCount}`}
      </p>
      <DossierPair ids={aggregate.finalistPlayerIds} roster={roster} totals={totals} />
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
    <div data-two-names-reveal="portrait" className="text-center">
      <p className={`mb-6 text-xs font-semibold uppercase tracking-[0.34em] ${tone === "gold" ? "text-[#e7bd70]" : "text-[#a68cff]"}`}>{label}</p>
      <div className={`mx-auto grid h-36 w-36 place-items-center rounded-full border p-3 ${tone === "gold" ? "border-[#e7bd70]/35 bg-[#e7bd70]/5" : "border-[#a68cff]/35 bg-[#a68cff]/5"}`}>
        <Avatar player={source} size="32" />
      </div>
      <h2 className="mt-6 font-serif text-5xl md:text-7xl" title={source.name}>{source.name}</h2>
    </div>
  );
}

function DossierPair({ ids, roster, removedId, enteringId, reveal = false, totals }: {
  ids: [string, string];
  roster: readonly FormatPresentationRosterPlayer[];
  removedId?: string;
  enteringId?: string;
  reveal?: boolean;
  totals?: Readonly<Record<string, number>>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:gap-6">
      {ids.map((id, index) => (
        <article
          key={id}
          data-nominee-id={id}
          data-two-names-reveal={reveal && (!enteringId || enteringId === id) ? "dossier" : undefined}
          data-dossier-index={index}
          style={{ opacity: removedId === id ? 0.28 : 1 }}
          className="relative min-w-0 rounded-[1.4rem] border border-white/10 bg-white/[0.035] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:p-3"
        >
          <div className="flex min-h-40 flex-col items-center justify-center rounded-[1rem] border border-white/[0.07] bg-black/25 px-2 py-5 md:min-h-48">
            <Avatar player={player(id, roster)} size="16" />
            <h3 className="mt-4 max-w-full truncate font-serif text-2xl md:text-4xl" title={name(id, roster)}>{name(id, roster)}</h3>
            {totals ? (
              <p className="mt-4 font-mono text-3xl" aria-label={`${name(id, roster)}: ${totals[id] ?? 0} exit vote${totals[id] === 1 ? "" : "s"}`}>
                {totals[id] ?? 0}<span className="mt-1 block font-sans text-[9px] uppercase tracking-[0.2em] text-white/50">Exit votes</span>
              </p>
            ) : <p className="mt-3 text-[9px] font-semibold uppercase tracking-[0.28em] text-[#ff7b91]">Nominated</p>}
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

function player(id: string, roster: readonly FormatPresentationRosterPlayer[]): FormatPresentationRosterPlayer {
  return roster.find((entry) => entry.id === id) ?? { id, name: id, persona: "" };
}

function name(id: string, roster: readonly FormatPresentationRosterPlayer[]): string {
  return player(id, roster).name;
}
