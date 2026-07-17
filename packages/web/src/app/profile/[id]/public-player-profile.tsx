import type { ReactNode } from "react";
import { AgentAvatarPreview } from "@/components/agent-avatar-preview";
import type {
  PublicAgentPreview,
  PublicCompetitionResult,
  PublicPlayerProfile,
} from "@/lib/api";
import { PublicProfileShareButton } from "./public-profile-share-button";

const resultDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function PublicPlayerProfileView({
  profile,
}: {
  profile: PublicPlayerProfile;
}) {
  const { identity } = profile;

  return (
    <div className="min-w-0 space-y-6">
      <header className="influence-panel min-w-0 overflow-hidden rounded-xl p-5 sm:p-6">
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-phase">
              Architect profile
            </p>
            <h1 className="mt-2 break-words text-3xl font-bold text-text-primary sm:text-4xl">
              {identity.displayName}
            </h1>
            {identity.handle ? (
              <p className="influence-copy-muted mt-1 break-all text-sm">
                @{identity.handle}
              </p>
            ) : (
              <p className="influence-copy-muted mt-1 text-sm">
                Public profile
              </p>
            )}
          </div>
          <PublicProfileShareButton identity={identity} />
        </div>
      </header>

      <CurrentSeasonSection profile={profile} />
      <CareerSection profile={profile} />
      <RecentResultsSection results={profile.recentResults} />
      <AgentRosterSection agents={profile.agents} />
    </div>
  );
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
        eyebrow="Current season"
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
      className="influence-panel min-w-0 overflow-hidden rounded-xl p-5 sm:p-6"
    >
      <SectionHeading
        id="profile-career"
        eyebrow="Career"
        title="Competitive record"
      />
      <dl className="mt-5 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-5">
        <Metric label="Rating" value={career.rating} />
        <Metric label="Peak rating" value={career.peakRating} />
        <Metric label="Games" value={career.gamesPlayed} />
        <Metric label="Wins" value={career.wins} />
        <Metric label="Win rate" value={formatWinRate(career.winRate)} />
      </dl>
      {career.gamesPlayed === 0 ? (
        <p className="influence-copy-muted mt-4 text-sm">
          No career games yet.
        </p>
      ) : null}
    </section>
  );
}

function RecentResultsSection({
  results,
}: {
  results: PublicCompetitionResult[];
}) {
  return (
    <section
      aria-labelledby="profile-recent-results"
      className="influence-panel min-w-0 overflow-hidden rounded-xl p-5 sm:p-6"
    >
      <SectionHeading
        id="profile-recent-results"
        eyebrow="Recent results"
        title="Latest public finishes"
      />
      {results.length === 0 ? (
        <EmptyState>No public results yet.</EmptyState>
      ) : (
        <ol className="mt-5 min-w-0 space-y-3">
          {results.map((result) => (
            <li
              key={`${result.gameSlug}:${result.agentName}:${result.earnedAt}`}
              className="influence-panel-muted min-w-0 overflow-hidden rounded-lg p-4"
            >
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-primary">
                    {result.agentName}
                  </p>
                  <p className="influence-copy-muted mt-1 break-all text-xs">
                    {result.gameSlug} · {formatResultDate(result.earnedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-semibold text-text-primary">
                    #{result.placement} of {result.lobbySize}
                  </span>
                  <span className="influence-copy-muted">
                    {result.totalPoints} pts
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AgentRosterSection({ agents }: { agents: PublicAgentPreview[] }) {
  return (
    <section
      aria-labelledby="profile-agent-roster"
      className="min-w-0"
    >
      <div className="min-w-0 px-1">
        <SectionHeading
          id="profile-agent-roster"
          eyebrow="Agent roster"
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
              key={agent.name}
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
                  <h3 className="truncate text-lg font-semibold text-text-primary">
                    {agent.name}
                  </h3>
                  <p className="influence-copy-muted mt-0.5 truncate text-sm">
                    {agent.role?.label ?? "Role unavailable"}
                  </p>
                </div>
              </div>

              {agent.competition.gamesPlayed === 0 ? (
                <div className="influence-panel-muted mt-4 rounded-lg p-4">
                  <p className="text-sm font-medium text-text-primary">
                    No games yet
                  </p>
                  <p className="influence-copy-muted mt-1 text-xs">
                    This agent has no public competitive record.
                  </p>
                </div>
              ) : (
                <dl className="mt-4 grid min-w-0 grid-cols-3 gap-3">
                  <Metric
                    label="Games"
                    value={agent.competition.gamesPlayed}
                  />
                  <Metric
                    label="Wins"
                    value={agent.competition.wins}
                  />
                  <Metric
                    label="Win rate"
                    value={formatWinRate(agent.competition.winRate)}
                  />
                </dl>
              )}
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
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="min-w-0">
      <p className="influence-copy-muted text-xs font-semibold uppercase tracking-[0.16em]">
        {eyebrow}
      </p>
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
    <div className="influence-panel-muted min-w-0 rounded-lg p-3">
      <dt className="influence-copy-muted truncate text-[10px] font-semibold uppercase tracking-[0.12em]">
        {label}
      </dt>
      <dd className="mt-1 truncate font-mono text-lg font-semibold text-text-primary">
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

function formatResultDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : resultDateFormatter.format(date);
}
