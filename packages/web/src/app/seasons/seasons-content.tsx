"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { SeasonWatch } from "./season-watch";
import type { SeasonGame } from "./season-games";
import { AgentVisualUpdateControl } from "./agent-visual-update";
import { SeasonAgentPreview } from "./season-agent-preview";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch, getFreeQueueStatus, getSeasonDashboard, joinFreeQueue, leaveFreeQueue, listAgents, listSeasons, type FreeQueueStatus, type SavedAgent, type SeasonDashboard, type SeasonIdentity } from "@/lib/api";
import type { ChampionshipView } from "@/lib/championship";
import { SeasonStandings } from "@/app/games/free/free-game-content";
import { defaultSeason, recommendedSeasonAgent } from "./season-selection";
import styles from "./seasons.module.css";

const ChampionshipEventView = dynamic(() => import("@/app/events/championship-view").then(module => module.ChampionshipEventView));

export function SeasonsContent() {
  const { authenticated, openSignIn } = useAuth();
  const [seasons, setSeasons] = useState<SeasonIdentity[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<SeasonDashboard | null>(null);
  const [games, setGames] = useState<SeasonGame[]>([]);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [entryExpanded, setEntryExpanded] = useState(false);
  const [events, setEvents] = useState<ChampionshipView[]>([]);
  const [eventChoice, setEventChoice] = useState("");
  const [queue, setQueue] = useState<FreeQueueStatus | null>(null);
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const selectedSlug = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const load = () => listSeasons().then(items => {
      if (disposed) return;
      setSeasons(items);
      const requested = new URLSearchParams(window.location.search).get("season");
      const selected = defaultSeason(items, requested);
      setSlug(selected?.slug ?? null);
      if (!selected) setLoading(false);
    }).catch(err => { if (!disposed) { setError(err.message); setLoading(false); } });
    void load();
    window.addEventListener("popstate", load);
    return () => { disposed = true; window.removeEventListener("popstate", load); };
  }, []);

  const refresh = useCallback(async (selected: string) => {
    if (selectedSlug.current !== selected) return;
    const request = ++generation.current;
    try {
      const [ledger, status, owned, feed] = await Promise.all([getSeasonDashboard(selected), getFreeQueueStatus(), authenticated ? listAgents() : Promise.resolve([]), apiFetch<{games:SeasonGame[]}>(`/api/seasons/${encodeURIComponent(selected)}/games`).then(value => ({games:value.games,error:null as string|null})).catch(() => ({games:[] as SeasonGame[],error:"Season games are temporarily unavailable."}))]);
      // Only published event links come from the public season ledger. Never load producer data here.
      const championships = await Promise.all((ledger.championships ?? []).map(event => apiFetch<ChampionshipView>(`/api/championships/${encodeURIComponent(event.slug)}`)));
      if (request !== generation.current) return;
      setGames(feed.games); setGamesError(feed.error); setDashboard(ledger); setQueue(status); setAgents(owned); setEvents(championships); setError(null);
    } catch (err) { if (request === generation.current) setError(err instanceof Error ? err.message : "Could not load this season."); }
    finally { if (request === generation.current) setLoading(false); }
  }, [authenticated]);

  useEffect(() => {
    if (!slug) return;
    selectedSlug.current = slug;
    setLoading(true); setGames([]); setGamesError(null); setEntryExpanded(false); setDashboard(null); setEvents([]); setAgents([]); setQueue(null); setChoice(""); setEventChoice("");
    void refresh(slug);
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(slug); }, 15000);
    return () => {
      // Invalidate late requests on selection/unmount; this counter is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++generation.current; window.clearInterval(timer);
    };
  }, [slug, refresh]);

  function selectSeason(value: string) {
    const url = new URL(window.location.href); url.searchParams.set("season", value);
    window.history.pushState(null, "", url); setSlug(value);
  }
  const season = dashboard?.season;
  const featuredEvent = events.find(event => event.slug === eventChoice) ?? events.find(event => event.status === "running") ?? events[0];
  const accepting = Boolean(season && season.id === queue?.acceptingSeasonId && season.status === "active");
  const scheduledOpening = season?.status === "active" && Boolean(season.admissionStartsAt && Date.parse(season.admissionStartsAt) > Date.now());
  const entry = accepting ? queue?.userEntry : null;
  const suggested = dashboard ? recommendedSeasonAgent(agents, dashboard.agentStandings) : undefined;
  const agent = agents.find(item => item.id === choice) ?? agents.find(item => item.id === entry?.agentProfileId) ?? suggested;
  async function enroll(leave = false) {
    if (!season || busy) return;
    setBusy(true); setError(null);
    try {
      if (leave) await leaveFreeQueue(season.id);
      else if (agent) await joinFreeQueue(agent.id, season.id);
      await refresh(season.slug);
    } catch (err) { setError(err instanceof Error ? err.message : "Entry could not be updated."); }
    finally { setBusy(false); }
  }

  return <div className={styles.hub}>
    <header className={styles.navigation}>
      <Link href="/seasons" className={styles.wordmark}>Seasons <span>/ The House</span></Link>
      {seasons.length > 0 && <label>Choose a season<select aria-label="Choose a season" value={slug ?? ""} onChange={event => selectSeason(event.target.value)} disabled={busy}>{seasons.map(item => <option key={item.id} value={item.slug}>{item.name} · {item.status === "active" ? "Active" : item.status === "closing" ? "Closing" : "Final"}</option>)}</select></label>}
    </header>
    {error && <p role="alert" className={styles.error}>{error} <button onClick={() => slug ? void refresh(slug) : window.location.reload()}>Try again</button></p>}
    {loading ? <div role="status" className={styles.loading}>Opening the season…</div> : !season ? <section className={styles.hero}><h1>The next season awaits.</h1><p>No season has been announced yet.</p></section> : <>
      {events.length > 1 && <label className={styles.eventSelect}>Championship<select value={featuredEvent?.slug ?? ""} onChange={event => setEventChoice(event.target.value)}>{events.map(event => <option key={event.id} value={event.slug}>{event.name}</option>)}</select></label>}
      {featuredEvent && <ChampionshipEventView key={featuredEvent.id} event={featuredEvent} />}
      {(!events.length || accepting) && <section className={styles.seasonMasthead} aria-labelledby="season-title">
        <div className={styles.seasonIdentity}>
          <h1 id="season-title">{season.name}</h1>
          <p className={styles.entryStatus}>{accepting ? "Entries open" : scheduledOpening ? "Opening soon" : season.status === "final" ? "Final standings" : "Entries closed"}</p>
          {accepting ? <p>{entry ? `${entry.agentName} is in the queue` : agent ? `${agent.name} · Not yet joined` : "Your seat is waiting."}</p> : <p>{scheduledOpening ? `Entry opens ${new Date(season.admissionStartsAt!).toLocaleString()}.` : season.status === "final" ? "The season is complete." : "Already-drawn games can finish."}</p>}
          {accepting && !entry && (!authenticated ? <button className={styles.joinAction} onClick={openSignIn}>Sign in to join</button> : !agent ? <Link className={styles.joinAction} href={`/agents/create?flow=daily_free&seasonId=${encodeURIComponent(season.id)}&season=${encodeURIComponent(season.slug)}`}>Create agent</Link> : <button disabled={busy} className={styles.joinAction} onClick={() => void enroll()}>{busy ? "Joining…" : `Join ${season.name}`}</button>)}
        </div>
        {accepting && <div className={styles.mastheadArt}><SeasonAgentPreview key={`${agent?.id}:${agent?.avatarUrl}:${agent?.transparentBodyUrl}`} agent={agent}/></div>}
        {accepting && authenticated && agent && <button className={styles.manageEntry} aria-expanded={entryExpanded} aria-controls="season-entry-controls" onClick={()=>setEntryExpanded(value=>!value)}>{entryExpanded ? "Close entry" : entry ? "Manage entry" : "Choose agent"} <span aria-hidden="true">{entryExpanded ? "−" : "+"}</span></button>}
      </section>}
      {accepting && entryExpanded && <section id="season-entry-controls" className={styles.entryPanel} aria-label="Manage season entry">
        <div><p className={styles.entryStatus}>{entry && entry.agentProfileId === agent?.id ? "In the season queue" : "Not yet joined"}</p><h2>{agent?.name}</h2>{entry && agent?.id !== entry.agentProfileId && <p>Currently queued: {entry.agentName}</p>}</div>
        <div className={styles.entryControls}>
          {agents.length > 1 && <label className={styles.agentSelect}>Your agent<select aria-label="Your season agent" value={agent?.id ?? ""} onChange={event => setChoice(event.target.value)} disabled={busy}>{agents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {agent && <>
            {(!entry || entry.agentProfileId !== agent.id) && <button disabled={busy} className={styles.primary} onClick={() => void enroll()}>{busy ? "Updating entry…" : entry ? "Switch agent" : `Join ${season.name}`}</button>}
            {entry && entry.agentProfileId === agent.id && queue?.eligibility === "temporarily-ineligible" && <p role="status">{queue.ineligibilityReason === "active-game" ? "Playing a game" : "Temporarily unavailable"}</p>}
            <div className={styles.actions}><AgentVisualUpdateControl key={agent.id} agent={agent} onComplete={() => { if (slug) void refresh(slug); }}/>{entry && <button disabled={busy} onClick={() => void enroll(true)}>{busy ? "Updating…" : "Leave queue"}</button>}</div>
          </>}
        </div>
      </section>}
      {!events.length && <SeasonWatch key={season.id} games={games} seasonName={season.name} seasonSlug={season.slug} loading={loading} error={gamesError} nextDrawAt={accepting ? queue?.nextDrawAt : null}/>}
      <section className={styles.ledger} aria-label="Season standings">
        {events.length > 0 && <div className={styles.ledgerHeading}><h2>The season that brought us here</h2><p>Season points are separate from championship results.</p></div>}
        <SeasonStandings dashboard={{...dashboard, championships: []}} loading={false} seasons={[]} onSelectSeason={selectSeason} />
        <Link className={styles.history} href={`/games/season/${encodeURIComponent(season.slug)}`}>Explore this season’s games →</Link>
      </section>
    </>}
  </div>;
}
