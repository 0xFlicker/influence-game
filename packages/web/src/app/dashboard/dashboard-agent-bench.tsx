import Link from "next/link";
import { AgentProfileLink } from "@/components/agent-profile-link";
import { OwnedCharacterImage } from "@/components/owned-character-image";
import { AgentAvatarPreview } from "@/components/agent-avatar-preview";
import type { SavedAgent } from "@/lib/api";
import { PERSONAS } from "@/lib/personas";
import styles from "./dashboard.module.css";

export function DashboardAgentBench({ agents, loading, error }: { agents: SavedAgent[]; loading: boolean; error: string | null }) {
  return <section aria-labelledby="dashboard-agents-title" data-testid="dashboard-agent-bench">
    <div className={styles.sectionHead}><div><h2 id="dashboard-agents-title">Your agents</h2><p>Meet your competitors</p></div><Link className={styles.link} href="/dashboard/agents">Manage agents →</Link></div>
    {error && agents.length > 0 && <p className={styles.message} role="alert">{error} Showing the last loaded agents.</p>}
    {loading && !agents.length ? <p className={styles.message} role="status">Loading agents…</p> : error && !agents.length ? <p className={styles.message} role="alert">{error}</p> : !agents.length ? <p className={styles.message}>No saved agents yet. Create one to get started.</p> : agents.map(agent => <div className={styles.agent} key={agent.id}>
      {agent.avatarUrl?.includes("/api/agent-profiles/images/") ? <Link href={`/dashboard/agents/${encodeURIComponent(agent.id)}/profile`}><OwnedCharacterImage src={agent.avatarUrl} alt={`${agent.name} portrait`} className="h-16 w-16 rounded-full object-cover" /></Link> : <AgentAvatarPreview avatarUrl={agent.avatarUrl} personaKey={agent.personaKey} name={agent.name} gamesPlayed={agent.gamesPlayed} gamesWon={agent.gamesWon} size="16" />}
      <div className="min-w-0"><h3 className={styles.agentName}><AgentProfileLink agentId={agent.id}>{agent.name}</AgentProfileLink></h3><p className={styles.agentMeta}>{PERSONAS.find(persona => persona.key === agent.personaKey)?.name ?? "Agent"} · {agent.gamesPlayed} Influence {agent.gamesPlayed === 1 ? "game" : "games"}</p></div>
      <Link className={styles.edit} href={`/dashboard/agents/${encodeURIComponent(agent.id)}/edit`}>Edit</Link>
    </div>)}
    <Link className={`${styles.link} ${styles.create}`} href="/agents/create"><span aria-hidden="true">＋ </span>{agents.length ? "Create an agent" : "Create your first agent"}</Link>
  </section>;
}
