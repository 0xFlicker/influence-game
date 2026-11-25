import Link from "next/link";
import type { ParticipationFilter } from "@influence/engine/house-participation";
import type { PublicAgentProfile } from "@/lib/api";
import { PlayerProfileLink } from "@/components/player-profile-link";
import { AwardShelf } from "@/components/award-shelf";
import { ParticipationRows, participationFilters } from "@/components/participation-history";
import { OwnerAgentActions } from "./owner-agent-actions";
import { ProfileArtwork } from "./profile-artwork";
import styles from "./public-agent-profile.module.css";

export function PublicAgentProfileView({ profile, gameKind = "all", agentId }: {
  profile: PublicAgentProfile;
  gameKind?: ParticipationFilter;
  agentId?: string;
}) {
  const { competition, werewolfRecord } = profile;
  const hasWerewolfResults = werewolfRecord.wins + werewolfRecord.losses + werewolfRecord.draws > 0;
  return (
    <div className="min-w-0 space-y-9 sm:space-y-12">
      <header className={`${styles.hero} overflow-hidden rounded-xl`}>
        <div className="min-w-0 px-6 py-7 md:px-10 lg:px-14">
          <p className="text-sm font-medium text-text-secondary">{profile.role?.label ?? "Agent"}</p>
          <h1 className="mt-2 break-words text-[clamp(2.5rem,6.4vw,5.5rem)] font-bold leading-[1.02] tracking-[-0.055em] text-text-primary">
            {profile.name}
          </h1>
          {profile.owner && (
            <p className="mt-4 flex flex-wrap gap-x-2 break-words text-sm text-text-secondary sm:mt-5">
              <span>Architect</span>
              <PlayerProfileLink player={profile.owner} className="influence-link font-semibold">
                {profile.owner.displayName}
              </PlayerProfileLink>
            </p>
          )}
        </div>
        <ProfileArtwork
          name={profile.name}
          avatarUrl={profile.avatarUrl}
          fullBodyImageUrl={profile.fullBodyImageUrl}
          role={profile.role}
          competition={competition}
        />
      </header>
      {agentId && <OwnerAgentActions agentId={agentId} agentName={profile.name} />}
      <AwardShelf awards={profile.awards} />
      <div className="grid gap-7 md:grid-cols-2 md:gap-10">
        <section aria-labelledby="agent-record" className="border-t border-white/15 pt-5">
          <h2 id="agent-record" className="text-xl font-semibold tracking-tight text-text-primary">Rated Influence record</h2>
          <p className="mt-1 text-sm text-text-secondary">Eligible public free-track games</p>
          <dl className="mt-4 grid grid-cols-3 gap-3">
            <Metric label="Games" value={competition.gamesPlayed} />
            <Metric label="Wins" value={competition.wins} />
            <Metric label="Win rate" value={`${Math.round(competition.winRate * 100)}%`} />
          </dl>
        </section>
        <section aria-labelledby="werewolf-record" className="border-t border-white/15 pt-5">
          <h2 id="werewolf-record" className="text-xl font-semibold tracking-tight text-text-primary">Recent Werewolf record</h2>
          <p className="mt-1 text-sm text-text-secondary">Faction outcomes from up to 20 public games</p>
          {hasWerewolfResults ? (
            <dl className="mt-4 grid grid-cols-3 gap-3">
              <Metric label="Wins" value={werewolfRecord.wins} />
              <Metric label="Losses" value={werewolfRecord.losses} />
              <Metric label="Draws" value={werewolfRecord.draws} />
            </dl>
          ) : <p className="mt-4 text-sm text-text-secondary">No public Werewolf results yet.</p>}
        </section>
      </div>
      <section aria-labelledby="agent-history" className={`${styles.history} border-t border-white/15 pt-6`}>
        <h2 id="agent-history" className="text-2xl font-semibold tracking-tight text-text-primary">Recent completed games</h2>
        <p className="mt-1 text-sm text-text-secondary">Up to 20 public games. Contains spoilers.</p>
        <nav aria-label="History game type" className="mt-4 flex flex-wrap gap-2">
          {participationFilters.map(filter => (
            <Link
              key={filter.kind}
              href={`${profile.profileHref}${filter.kind === "all" ? "" : `?game=${filter.kind}`}`}
              scroll={false}
              aria-current={gameKind === filter.kind ? "page" : undefined}
              className="influence-button-secondary inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {filter.label}
            </Link>
          ))}
        </nav>
        <ParticipationRows entries={profile.recentResults} />
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="mt-1 break-words text-3xl font-semibold tabular-nums tracking-tight text-text-primary sm:text-4xl">{value}</dd>
    </div>
  );
}
