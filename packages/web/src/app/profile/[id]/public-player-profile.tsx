import { AgentProfileLink } from "@/components/agent-profile-link";
import { AwardIcons } from "@/components/award-icons";
import { AwardShelf } from "@/components/award-shelf";
import Link from "next/link";
import type { WerewolfParticipationRecord } from "@influence/engine/house-participation";
import { playerProfileHref } from "@/lib/player-profile-links";
import type { ReactNode } from "react";
import { AgentAvatarPreview } from "@/components/agent-avatar-preview";
import type {
  PublicRosterAgent,
  PublicPlayerProfile,
} from "@/lib/api";
import { PublicProfileShareButton } from "./public-profile-share-button";
import { FeaturedAgents } from "./featured-agents";
import styles from "./public-player-profile.module.css";

export function PublicPlayerProfileView({ profile }: { profile: PublicPlayerProfile }) {
  const { identity, agents, recentResults } = profile;
  const activity = new Map<string, number>();
  for (const [index, entry] of recentResults.entries()) {
    const href = `/agents/${encodeURIComponent(entry.agentProfileId ?? "")}`;
    if (!activity.has(href)) activity.set(href, recentResults.length - index);
  }
  const featured = [...agents].sort((left, right) =>
    Number(Boolean(right.fullBodyImageUrl)) - Number(Boolean(left.fullBodyImageUrl))
    || (activity.get(right.profileHref ?? "") ?? 0) - (activity.get(left.profileHref ?? "") ?? 0)
    || (right.awards?.length ?? 0) - (left.awards?.length ?? 0)
    || right.competition.wins - left.competition.wins,
  ).slice(0, 4);

  return (
    <div className={`${styles.profile} min-w-0 space-y-9 sm:space-y-12`}>
      <header className={`${styles.hero} rounded-xl`}>
        <div className="min-w-0 self-center px-6 py-7 sm:p-10">
          <p className="text-sm font-medium text-text-secondary">Architect</p>
          <h1 className="mt-2 break-words text-[clamp(2.45rem,5vw,4.5rem)] font-bold leading-[1.04] tracking-[-0.055em] text-text-primary">{identity.displayName}</h1>
          {identity.handle && <p className="mt-3 break-all text-sm text-text-secondary">@{identity.handle}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link className="influence-button-secondary inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" href={`${playerProfileHref(identity)}/history`}>Game history</Link>
            <PublicProfileShareButton identity={identity} />
          </div>
        </div>
        <FeaturedAgents agents={featured} />
      </header>

      <AwardShelf awards={profile.awards ?? []} />
      <div className="grid gap-7 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
        <CareerSection profile={profile} />
        <section aria-labelledby="profile-werewolf" className="min-w-0 border-t border-white/15 pt-5">
          <h2 id="profile-werewolf" className="text-xl font-semibold tracking-tight text-text-primary">Recent Werewolf record</h2>
          <p className="mt-1 text-sm text-text-secondary">Faction outcomes from up to 20 public appearances</p>
          {hasWerewolfRecord(profile.werewolfRecord) ? <WerewolfMetrics record={profile.werewolfRecord} />
            : <p className="mt-4 text-sm text-text-secondary">No public Werewolf results yet.</p>}
        </section>
      </div>
      <CurrentSeasonSection profile={profile} />
      <AgentRosterSection agents={agents} />
    </div>
  );
}

function hasWerewolfRecord(record: WerewolfParticipationRecord) {
  return record.wins + record.losses + record.draws > 0;
}

function WerewolfMetrics({ record }: { record: WerewolfParticipationRecord }) {
  return <dl className="mt-4 grid grid-cols-3 gap-3">
    <Metric label="Wins" value={record.wins} />
    <Metric label="Losses" value={record.losses} />
    <Metric label="Draws" value={record.draws} />
  </dl>;
}

function CurrentSeasonSection({
  profile,
}: {
  profile: PublicPlayerProfile;
}) {
  const currentSeason = profile.currentSeason;

  return (
    <section
      aria-labelledby="profile-current-season"
      className="influence-panel min-w-0 overflow-hidden rounded-xl p-5 sm:p-6"
    >
      <SectionHeading
        id="profile-current-season"
        eyebrow="Influence season"
        title={currentSeason?.season.name ?? "Architect standing"}
      />

      {!currentSeason ? (
        <EmptyState>No current season is active.</EmptyState>
      ) : (
        <div className="mt-5 min-w-0 space-y-4">
          {currentSeason.architectStanding ? (
            <dl className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric
                label="Architect standing"
                value={`#${currentSeason.architectStanding.rank}`}
              />
              <Metric
                label="Weighted points"
                value={formatHundredths(
                  currentSeason.architectStanding.totalPointsHundredths,
                )}
              />
              <Metric
                label="Season wins"
                value={currentSeason.architectStanding.wins}
              />
            </dl>
          ) : (
            <EmptyState>Not ranked in {currentSeason.season.name} yet.</EmptyState>
          )}

          <div className="min-w-0 border-t border-white/10 pt-4">
            <p className="influence-copy-muted text-xs font-semibold uppercase tracking-[0.14em]">
              Honors
            </p>
            {currentSeason.honors.agentChampion
              || currentSeason.honors.architectChampion ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {currentSeason.honors.architectChampion ? (
                    <Honor>Architect Champion</Honor>
                  ) : null}
                  {currentSeason.honors.agentChampion ? (
                    <Honor>Agent Champion</Honor>
                  ) : null}
                </div>
              ) : (
                <p className="influence-copy-muted mt-2 text-sm">
                  No season honors yet.
                </p>
              )}
          </div>
        </div>
      )}
    </section>
  );
}

function CareerSection({ profile }: { profile: PublicPlayerProfile }) {
  const { career } = profile;

  return (
    <section
      aria-labelledby="profile-career"
      className="min-w-0 border-t border-white/15 pt-5"
    >
      <h2 id="profile-career" className="text-xl font-semibold tracking-tight text-text-primary">Influence competitive record</h2>
      <dl className="mt-5 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-5">
        <Metric label="Rating" value={career.rating} />
        <Metric label="Peak rating" value={career.peakRating} />
        <Metric label="Games" value={career.gamesPlayed} />
        <Metric label="Wins" value={career.wins} />
        <Metric label="Win rate" value={formatWinRate(career.winRate)} />
      </dl>
      {career.gamesPlayed === 0 ? (
        <p className="influence-copy-muted mt-4 text-sm">
          No Influence career games yet.
        </p>
      ) : null}
    </section>
  );
}

function AgentRosterSection({ agents }: { agents: PublicRosterAgent[] }) {
  return (
    <section
      aria-labelledby="profile-agent-roster"
      className="min-w-0"
    >
      <div className="min-w-0 px-1">
        <SectionHeading
          id="profile-agent-roster"
          title="Saved competitors"
        />
        <p className="influence-copy-muted mt-2 text-sm">
          {agents.length === 1
            ? "1 active agent"
            : `${agents.length} active agents`}
        </p>
      </div>

      {agents.length === 0 ? (
        <div className="influence-panel-dashed mt-5 rounded-xl p-6 text-center">
          <p className="influence-copy-muted text-sm">No active agents yet.</p>
        </div>
      ) : (
        <div className="mt-5 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          {agents.map((agent) => (
            <article
              key={agent.profileHref ?? agent.name}
              className="influence-panel min-w-0 overflow-hidden rounded-xl p-5"
            >
              <div className="flex min-w-0 items-center gap-4">
                <AgentAvatarPreview
                  avatarUrl={agent.avatarUrl}
                  personaKey={agent.role?.key ?? null}
                  role={agent.role?.label ?? null}
                  name={agent.name}
                  gamesPlayed={agent.competition.gamesPlayed}
                  gamesWon={agent.competition.wins}
                  size="12"
                />
                <div className="min-w-0">
                  <div className="min-w-0">
                    <h3 className="mr-2 inline break-words text-lg font-semibold text-text-primary">
                      <AgentProfileLink href={agent.profileHref} className="hover:underline focus-visible:underline">{agent.name}</AgentProfileLink>
                    </h3>{" "}
                    <AwardIcons awards={agent.awards ?? []} agentName={agent.name} inline />
                  </div>
                  {agent.role && <p className="mt-0.5 text-sm text-text-secondary">{agent.role.label}</p>}
                </div>
              </div>

              {agent.competition.gamesPlayed > 0 && <section aria-label="Rated Influence" className="mt-4 border-t border-white/10 pt-3">
                <h4 className="text-sm font-medium text-text-primary">Rated Influence</h4>
                <dl className="mt-3 grid min-w-0 grid-cols-3 gap-3">
                  <Metric label="Games" value={agent.competition.gamesPlayed} />
                  <Metric label="Wins" value={agent.competition.wins} />
                  <Metric label="Win rate" value={formatWinRate(agent.competition.winRate)} />
                </dl>
              </section>}
              {hasWerewolfRecord(agent.werewolfRecord) && <section aria-label="Recent Werewolf" className="mt-4 border-t border-white/10 pt-3">
                <h4 className="text-sm font-medium text-text-primary">Werewolf in this architect’s recent games</h4>
                <WerewolfMetrics record={agent.werewolfRecord} />
              </section>}
              {agent.competition.gamesPlayed === 0 && !hasWerewolfRecord(agent.werewolfRecord) &&
                <p className="mt-3 text-sm text-text-secondary">No public results yet.</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
}: {
  id: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <div className="min-w-0">
      {eyebrow && <p className="influence-copy-muted text-xs font-semibold">{eyebrow}</p>}
      <h2
        id={id}
        className="mt-1 break-words text-xl font-semibold text-text-primary"
      >
        {title}
      </h2>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="mt-1 break-words text-2xl font-semibold tabular-nums tracking-tight text-text-primary">
        {value}
      </dd>
    </div>
  );
}

function Honor({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-phase/30 bg-phase/10 px-3 py-1 text-xs font-semibold text-phase">
      {children}
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="influence-panel-dashed mt-5 rounded-lg p-5 text-center">
      <p className="influence-copy-muted text-sm">{children}</p>
    </div>
  );
}

function formatHundredths(value: number): string {
  return (value / 100).toFixed(2);
}

function formatWinRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}
