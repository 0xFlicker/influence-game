"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthenticatedPublicIdentity } from "@/app/providers";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { getAuthToken, listAgents, listGames, type GameSummary, type SavedAgent } from "@/lib/api";
import { playerProfileHref } from "@/lib/player-profile-links";
import { HOUSE_VENUE } from "@/lib/product-identity";
import { DashboardAgentBench } from "./dashboard-agent-bench";
import { DashboardHistory } from "./dashboard-history";
import { useDashboardHistory } from "./use-dashboard-history";
import { ProfileContent } from "./profile/profile-content";
import { JoinGameModal } from "./join-game-modal";
import { OwnerLearningActivation } from "./agents/[id]/review/owner-learning-activation";
import styles from "./dashboard.module.css";

export function McpSetupCard({ hasHistory }: { hasHistory: boolean }) {
  return <section className={styles.mcp} data-testid="dashboard-mcp-setup-card"><div><h2>Connect {HOUSE_VENUE.name} to your Chatbot or AI Agent</h2><p>{hasHistory ? "Use your House game history from an AI coding client without granting maintainer access or internal inspection." : "Join or complete an Influence game, then let an AI coding client read the games tied to your account."}</p></div><Link href="/get-mcp" className={styles.link}>Connect MCP →</Link></section>;
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="dashboard-settings-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className={styles.dialogHeader}><div><p className={styles.eyebrow}>Your account</p><h2 id="dashboard-settings-title">Settings</h2></div><button type="button" className={styles.close} onClick={onClose}>Close</button></div>
    <div className={styles.settingsContent}><ProfileContent onAuthAction={onClose} /></div>
  </dialog>;
}

export function DashboardContent() {
  const { account, authenticated } = useAuth();
  const accountId = account?.id;
  const { hasPermission } = usePermissions();
  const identity = useAuthenticatedPublicIdentity();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedJoinGameId = searchParams.get("joinGameId");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const history = useDashboardHistory(accountId, authenticated);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [dataOwner, setDataOwner] = useState<string | null>(null);
  const dataRequest = useRef(0);
  const invalidateDataRequest = useCallback(() => { dataRequest.current++; }, []);
  const [joinTarget, setJoinTarget] = useState<GameSummary | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    if (!authenticated || !accountId || !getAuthToken()) return;
    const request = ++dataRequest.current;
    setAgentsError(null);
    listAgents().then(value => { if (request === dataRequest.current) setAgents(value); }).catch(() => { if (request === dataRequest.current) setAgentsError("Could not load your agents."); }).finally(() => { if (request === dataRequest.current) setAgentsLoading(false); });
  }, [accountId, authenticated]);
  useEffect(() => {
    const initial = window.setTimeout(() => { setAgents([]); setAgentsLoading(true); setDataOwner(accountId ?? null); fetchData(); }, 0);
    window.addEventListener("auth:session-ready", fetchData);
    return () => { invalidateDataRequest(); window.clearTimeout(initial); window.removeEventListener("auth:session-ready", fetchData); };
  }, [accountId, fetchData, invalidateDataRequest]);
  useEffect(() => {
    if (!requestedJoinGameId) return;
    let active = true;
    listGames().then(games => {
      if (!active) return;
      const game = games.find(entry => entry.id === requestedJoinGameId);
      if (game) setJoinTarget(game); else setJoinError("That game is no longer available.");
    }).catch(() => { if (active) setJoinError("Could not load the requested game."); });
    return () => { active = false; };
  }, [requestedJoinGameId]);
  const displayName = identity?.displayName && identity.displayName !== "Anonymous" ? identity.displayName : account?.email ?? account?.walletAddress?.slice(0, 10) ?? "Player";
  const visibleAgents = authenticated && dataOwner === accountId ? agents : [];
  const closeJoin = () => { setJoinTarget(null); setJoinError(null); router.replace("/dashboard"); };
  return <div className={styles.dashboard}>
    {joinTarget && <JoinGameModal game={joinTarget} onClose={closeJoin} onSuccess={() => { closeJoin(); fetchData(); history.reload(); }} />}
    {joinError && <p role="alert" className={styles.message}>{joinError} <button type="button" onClick={closeJoin}>Dismiss</button></p>}
    <header className={styles.masthead}><div><p className={styles.eyebrow}>Your dashboard</p><h1>Welcome back,<br />{displayName}.</h1><p>Your agents and their stories in The House.</p></div><div className="flex flex-wrap gap-3">{hasPermission("create_game") && <Link href="/games/new" className={styles.settingsButton}>＋ Create game</Link>}<button type="button" className={styles.settingsButton} onClick={() => setSettingsOpen(true)}>⚙ &nbsp; Settings</button></div></header>
    <div className={styles.review}><OwnerLearningActivation enabled={authenticated} agents={visibleAgents} /></div>
    <div className={styles.columns}>
      <DashboardAgentBench agents={visibleAgents.slice(0, 3)} loading={dataOwner !== accountId || agentsLoading} error={agentsError} />
      <div><DashboardHistory entries={history.entries} loading={history.loading} error={history.error} kind={history.kind} page={history.page} hasNext={history.nextCursor !== null} onKindChange={history.setKind} onPrevious={history.previous} onNext={history.next} onRetry={history.retry} />
        <div className={styles.profileLine}><div><h3>Your public profile</h3><p>{identity?.displayName ?? "Complete your public identity"}{identity?.handle ? ` · @${identity.handle}` : ""}</p></div>{identity?.publicIdentityOnboarding.state === "complete" ? <Link className={styles.link} href={playerProfileHref(identity)}>View profile →</Link> : <button type="button" className={styles.link} onClick={() => setSettingsOpen(true)}>Complete profile →</button>}</div>
      </div>
    </div>
    <McpSetupCard hasHistory={history.hasAnyHistory} />
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
  </div>;
}
