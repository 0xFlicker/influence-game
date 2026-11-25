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
import { AgentCarousel } from "./agent-carousel";
import profileStyles from "@/components/public-profile.module.css";
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
    <div className={profileStyles.page}>
      <header className={profileStyles.hero}>
        <div className={profileStyles.heroInner}>
          <div className={profileStyles.identity}>
            <p className={profileStyles.eyebrow}>Architect</p>
            <h1 className={profileStyles.title}>{identity.displayName}</h1>
            {identity.handle && <p className="mt-4 text-sm text-text-secondary">@{identity.handle}</p>}
            <div className={profileStyles.actions}>
              <Link className={profileStyles.action} href={`${playerProfileHref(identity)}/history`}>Game history <span aria-hidden="true">↗</span></Link>
              <PublicProfileShareButton identity={identity} />
            </div>
          </div>
          {featured.length > 0 && <AgentCarousel agents={featured} />}
        </div>
      </header>

      <div className={profileStyles.content}>
        {profile.awards?.length ? <div className={profileStyles.rules}><AwardShelf awards={profile.awards} inline /></div> : null}
        <div className="grid gap-7 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
          <CareerSection profile={profile} />
          <section aria-labelledby="profile-werewolf" className={profileStyles.rules}>
            <h2 id="profile-werewolf" className="text-xl font-semibold tracking-tight text-text-primary">Recent Werewolf record</h2>
            <p className="mt-1 text-sm text-text-secondary">Faction outcomes from up to 20 public appearances</p>
            {hasWerewolfRecord(profile.werewolfRecord) ? <WerewolfMetrics record={profile.werewolfRecord} />
              : <p className="mt-4 text-sm text-text-secondary">No public Werewolf results yet.</p>}
          </section>
        </div>
        <CurrentSeasonSection profile={profile} />
        <AgentRosterSection agents={agents} />
      </div>
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
      className={profileStyles.rules}
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

          <div className="min-w-0">
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
      className={profileStyles.rules}
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
      <div className={profileStyles.rules}>
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
        <EmptyState>No active agents yet.</EmptyState>
      ) : (
        <div className={`mt-5 ${styles.roster}`}>
          {agents.map((agent) => (
            <article
              key={agent.profileHref ?? agent.name}
              className={styles.rosterEntry}
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

              <div className={styles.rosterRecords}>
                {agent.competition.gamesPlayed > 0 && <section aria-label="Rated Influence">
                  <h4 className="text-sm font-medium text-text-primary">Rated Influence</h4>
                  <dl className="mt-3 grid min-w-0 grid-cols-3 gap-3">
                    <Metric label="Games" value={agent.competition.gamesPlayed} />
                    <Metric label="Wins" value={agent.competition.wins} />
                    <Metric label="Win rate" value={formatWinRate(agent.competition.winRate)} />
                  </dl>
                </section>}
                {hasWerewolfRecord(agent.werewolfRecord) && <section aria-label="Recent Werewolf">
                  <h4 className="text-sm font-medium text-text-primary">Werewolf in this architect’s recent games</h4>
                  <WerewolfMetrics record={agent.werewolfRecord} />
                </section>}
                {agent.competition.gamesPlayed === 0 && !hasWerewolfRecord(agent.werewolfRecord) &&
                  <p className="text-sm text-text-secondary">No public results yet.</p>}
              </div>
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
    <p className="mt-3 text-sm text-text-secondary">{children}</p>
  );
}

function formatHundredths(value: number): string {
  return (value / 100).toFixed(2);
}

function formatWinRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}
