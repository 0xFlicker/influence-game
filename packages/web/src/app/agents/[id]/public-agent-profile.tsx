import Link from "next/link";
import type { ParticipationFilter } from "@influence/engine/house-participation";
import type { PublicAgentProfile } from "@/lib/api";
import { PlayerProfileLink } from "@/components/player-profile-link";
import { AwardShelf } from "@/components/award-shelf";
import { ParticipationRows, participationFilters } from "@/components/participation-history";
import { OwnerAgentActions } from "./owner-agent-actions";
import { ProfileArtwork } from "./profile-artwork";
import { HouseShareButton } from "@/components/house-share-button";
import styles from "@/components/public-profile.module.css";

export function PublicAgentProfileView({ profile, gameKind = "all", agentId }: {
  profile: PublicAgentProfile;
  gameKind?: ParticipationFilter;
  agentId?: string;
}) {
  const { competition, werewolfRecord } = profile;
  const hasWerewolfResults = werewolfRecord.wins + werewolfRecord.losses + werewolfRecord.draws > 0;
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.identity}>
            <p className={styles.eyebrow}>{profile.role?.label ?? "Agent"}</p>
            <h1 className={styles.title}>{profile.name}</h1>
            {profile.owner && (
              <p className="mt-4 flex flex-wrap gap-x-2 text-sm text-text-secondary sm:mt-5">
                <span>Architect</span>
                <PlayerProfileLink player={profile.owner} className="influence-link font-semibold">
                  {profile.owner.displayName}
                </PlayerProfileLink>
              </p>
            )}
            <div className={styles.actions}>
              <Link className={styles.action} href="#agent-history">Game history <span aria-hidden="true">↓</span></Link>
              <HouseShareButton
                href={profile.profileHref}
                label={`Share ${profile.name} profile`}
                title={`${profile.name} — The House`}
                buttonText="Share"
                className={styles.action}
              />
            </div>
          </div>
          <div className={styles.stage}><ProfileArtwork {...profile} /></div>
        </div>
      </header>
      <div className={styles.content}>
        {agentId && <OwnerAgentActions key={agentId} agentId={agentId} agentName={profile.name} />}
        {profile.awards.length > 0 && <div className={styles.rules}><AwardShelf awards={profile.awards} inline /></div>}
        <div className="grid gap-7 md:grid-cols-2 md:gap-10">
          <section aria-labelledby="agent-record" className={styles.rules}>
            <h2 id="agent-record" className="text-xl font-semibold tracking-tight text-text-primary">Rated Influence record</h2>
            <p className="mt-1 text-sm text-text-secondary">Eligible public free-track games</p>
            <dl className="mt-4 grid grid-cols-3 gap-3">
              <Metric label="Games" value={competition.gamesPlayed} />
              <Metric label="Wins" value={competition.wins} />
              <Metric label="Win rate" value={`${Math.round(competition.winRate * 100)}%`} />
            </dl>
          </section>
          <section aria-labelledby="werewolf-record" className={styles.rules}>
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
        <section aria-labelledby="agent-history" className={styles.rules}>
          <h2 id="agent-history" className="text-2xl font-semibold tracking-tight text-text-primary">Recent completed games</h2>
          <p className="mt-1 text-sm text-text-secondary">Up to 20 public games. Contains spoilers.</p>
          <nav aria-label="History game type" className="mt-4 flex flex-wrap gap-2">
            {participationFilters.map(filter => (
              <Link
                key={filter.kind}
                href={`${profile.profileHref}${filter.kind === "all" ? "" : `?game=${filter.kind}`}`}
                scroll={false}
                aria-current={gameKind === filter.kind ? "page" : undefined}
                className={styles.historyFilter}
              >
                {filter.label}
              </Link>
            ))}
          </nav>
          <ParticipationRows entries={profile.recentResults} inline />
        </section>
      </div>
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
