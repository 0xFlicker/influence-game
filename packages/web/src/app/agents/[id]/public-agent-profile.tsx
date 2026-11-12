import Link from "next/link";
import type { ParticipationFilter } from "@influence/engine/house-participation";
import type { PublicAgentProfile } from "@/lib/api";
import { AgentAvatarPreview } from "@/components/agent-avatar-preview";
import { PlayerProfileLink } from "@/components/player-profile-link";
import { AwardShelf } from "@/components/award-shelf";
import { ParticipationRows, participationFilters } from "@/components/participation-history";
import { OwnerAgentActions } from "./owner-agent-actions";

export function PublicAgentProfileView({ profile, gameKind = "all", agentId }: { profile: PublicAgentProfile; gameKind?: ParticipationFilter; agentId?: string }) {
  return <div className="min-w-0 space-y-6">
    <header className="influence-panel rounded-xl p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-phase">Agent profile</p>
      <div className="mt-4 flex min-w-0 items-start gap-4">
        <AgentAvatarPreview avatarUrl={profile.avatarUrl} personaKey={profile.role?.key} name={profile.name} gamesPlayed={profile.competition.gamesPlayed} gamesWon={profile.competition.wins} size="16" />
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-bold text-text-primary sm:text-4xl">{profile.name}</h1>
          <p className="mt-1 text-sm influence-copy-muted">{profile.role?.label ?? "Agent"}</p>
          {profile.owner && <p className="mt-3 break-words text-sm influence-copy-muted">Architect: <PlayerProfileLink player={profile.owner} className="influence-link">{profile.owner.displayName}</PlayerProfileLink></p>}
        </div>
      </div>
    </header>
    {agentId && <OwnerAgentActions agentId={agentId} agentName={profile.name} />}
    <AwardShelf awards={profile.awards} />
    <section aria-labelledby="agent-record" className="influence-panel rounded-xl p-5 sm:p-6">
      <h2 id="agent-record" className="influence-section-title">Rated Influence record</h2>
      <p className="mt-2 text-xs influence-copy-muted">Eligible public free-track Influence results.</p>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Metric label="Games" value={profile.competition.gamesPlayed} />
        <Metric label="Wins" value={profile.competition.wins} />
        <Metric label="Win rate" value={`${Math.round(profile.competition.winRate * 100)}%`} />
      </dl>
    </section>
    <section aria-labelledby="agent-history" className="influence-panel rounded-xl p-5 sm:p-6">
      <h2 id="agent-history" className="influence-section-title">Recent completed games</h2>
      <p className="mt-2 text-xs influence-copy-muted">Results · Spoilers · Up to 20 public participations</p>
      <nav aria-label="History game type" className="mt-3 flex flex-wrap gap-2">{participationFilters.map(filter => <Link key={filter.kind}
        href={`${profile.profileHref}${filter.kind === "all" ? "" : `?game=${filter.kind}`}`} scroll={false} aria-current={gameKind === filter.kind ? "page" : undefined}
        className={`${gameKind === filter.kind ? "influence-button-primary" : "influence-button-secondary"} rounded px-3 py-2 text-sm`}>{filter.label}</Link>)}</nav>
      <ParticipationRows entries={profile.recentResults} />
    </section>
  </div>;
}
function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="min-w-0"><dt className="text-xs influence-copy-muted">{label}</dt><dd className="mt-1 break-words text-xl font-semibold text-text-primary">{value}</dd></div>;
}
