import {
  GamePlayerAvatarPreview,
  type GamePlayerAvatarSource,
} from "@/components/game-player-avatar-preview";
import type { GamePlayer } from "@/lib/api";
import type {
  MatchWatchAllianceCardModel,
  MatchWatchAllianceHuddleModel,
  MatchWatchAlliancePanelModel,
} from "./match-watch-alliance-model";

export function MatchWatchAlliancePanel({
  allianceModel,
  players = [],
}: {
  allianceModel: MatchWatchAlliancePanelModel;
  players?: readonly GamePlayer[];
}) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/55">
          Alliance
        </h3>
        {allianceModel.selectedPlayerName ? (
          <span className="truncate text-[7px] uppercase tracking-[0.12em] text-white/25">
            {allianceModel.selectedPlayerName}
          </span>
        ) : null}
      </div>

      {allianceModel.status === "ready" ? (
        <>
          <AllianceSummary
            proposalCount={allianceModel.summary.proposalCount}
            allianceCount={allianceModel.summary.allianceCount}
            huddleCount={allianceModel.summary.huddleCount}
            latestHuddleRound={allianceModel.summary.latestHuddleRound}
          />
          <AllianceCardList cards={allianceModel.cards} players={players} />
        </>
      ) : (
        <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-[10px] leading-5 text-white/38">
          {allianceModel.reason}
        </p>
      )}
    </section>
  );
}

export function AllianceSummary({
  proposalCount,
  allianceCount,
  huddleCount,
  latestHuddleRound,
}: {
  proposalCount: number;
  allianceCount: number;
  huddleCount: number;
  latestHuddleRound: number | null;
}) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2">
      <AllianceStat label="Alliances" value={String(allianceCount)} />
      <AllianceStat label="Proposals" value={String(proposalCount)} />
      <AllianceStat label="Huddles" value={String(huddleCount)} />
      <AllianceStat label="Latest" value={latestHuddleRound ? `R${latestHuddleRound}` : "—"} />
    </div>
  );
}

export function AllianceCardList({
  cards,
  compact = false,
  players = [],
}: {
  cards: readonly MatchWatchAllianceCardModel[];
  compact?: boolean;
  players?: readonly GamePlayer[];
}) {
  return (
    <div className="space-y-3">
      {cards.map((card) => (
        <AllianceCard
          key={card.id}
          card={card}
          compact={compact}
          players={players}
        />
      ))}
    </div>
  );
}

function AllianceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-2.5 py-2">
      <div className="text-[7px] uppercase tracking-[0.12em] text-white/28">{label}</div>
      <div className="mt-1 text-xs font-semibold text-white/82">{value}</div>
    </div>
  );
}

function AllianceCard({
  card,
  compact,
  players,
}: {
  card: MatchWatchAllianceCardModel;
  compact: boolean;
  players: readonly GamePlayer[];
}) {
  return (
    <div
      id={`alliance-${card.id}`}
      className="space-y-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2"
    >
      <AllianceMemberAvatars card={card} players={players} />
      <details className="group min-w-0">
        <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phase/70">
          <div className="min-w-0">
            <h4 className="truncate text-[11px] font-semibold text-white/84">{card.name}</h4>
            <p className="mt-1 truncate text-[8px] uppercase tracking-[0.12em] text-white/32">
              {card.status} / {card.memberNames.join(", ")}
            </p>
          </div>
          <span className="shrink-0 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[7px] uppercase tracking-[0.12em] text-white/35">
            {card.huddles.length} huddles
          </span>
        </summary>

        <div className="mt-3 border-t border-white/5 pt-3">
          {card.purpose ? (
            <p className="text-[10px] leading-5 text-white/58">{card.purpose}</p>
          ) : null}
          {card.latestOutcomeSummary ? (
            <p className="mt-2 rounded border border-cyan-300/10 bg-cyan-300/[0.04] px-2.5 py-2 text-[9px] leading-4 text-cyan-50/62">
              {card.latestOutcomeSummary}
            </p>
          ) : null}
          {card.consequences.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {card.consequences.map((consequence) => (
                <p
                  key={`${card.id}:${consequence.type}:${consequence.round}:${consequence.description}`}
                  className="rounded border border-amber-300/10 bg-amber-300/[0.04] px-2.5 py-2 text-[9px] leading-4 text-amber-50/62"
                >
                  Round {consequence.round}: {consequence.description}
                </p>
              ))}
            </div>
          ) : null}

          {card.huddles.length > 0 ? (
            <div className="mt-3 space-y-2">
              {card.huddles.map((huddle) => (
                <AllianceHuddle key={huddle.id} huddle={huddle} compact={compact} />
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[9px] italic leading-4 text-white/30">No huddle transcript captured.</p>
          )}
        </div>
      </details>
    </div>
  );
}

function AllianceMemberAvatars({
  card,
  players,
}: {
  card: MatchWatchAllianceCardModel;
  players: readonly GamePlayer[];
}) {
  return (
    <div className="flex min-w-0 gap-1 overflow-x-auto pb-0.5" aria-label={`${card.name} members`}>
      {card.members.map((member) => {
        const player = players.find((candidate) =>
          (member.id && candidate.id === member.id)
          || candidate.name === member.name
        );
        return (
          <span
            key={`${card.id}:${member.id ?? member.name}`}
            className="rounded-full ring-1 ring-black/70"
          >
            <GamePlayerAvatarPreview
              player={player ?? allianceMemberAvatarSource(member)}
              size="6"
            />
          </span>
        );
      })}
    </div>
  );
}

function allianceMemberAvatarSource(
  member: MatchWatchAllianceCardModel["members"][number],
): GamePlayerAvatarSource {
  return {
    name: member.name,
    persona: member.persona ?? member.personaKey ?? member.name,
    personaKey: member.personaKey,
    avatarUrl: member.avatarUrl,
  };
}

function AllianceHuddle({
  huddle,
  compact,
}: {
  huddle: MatchWatchAllianceHuddleModel;
  compact: boolean;
}) {
  const visibleMessages = compact ? huddle.messages.slice(0, 2) : huddle.messages;
  const hiddenCount = huddle.messages.length - visibleMessages.length;

  return (
    <details className="rounded-md border border-white/10 bg-black/20 px-2.5 py-2" open={!compact}>
      <summary className="cursor-pointer list-none text-[8px] uppercase tracking-[0.12em] text-white/38">
        Round {huddle.round} / {huddle.window} / pass {huddle.pass}
      </summary>
      <div className="mt-2 space-y-2">
        {huddle.outcomeSummary ? (
          <p className="rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[9px] leading-4 text-white/52">
            {huddle.outcomeSummary}
          </p>
        ) : null}
        {visibleMessages.map((message) => (
          <p key={`${message.timestamp}:${message.fromName}:${message.text}`} className="text-[9px] leading-4 text-white/60">
            <span className="font-semibold text-white/76">{message.fromName}: </span>
            {message.text}
          </p>
        ))}
        {hiddenCount > 0 ? (
          <p className="text-[8px] italic leading-4 text-white/32">
            {hiddenCount} more messages in this huddle.
          </p>
        ) : null}
      </div>
    </details>
  );
}
