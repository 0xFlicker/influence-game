"use client";
import Link from "next/link";
import { useState } from "react";
import type { HouseParticipation, ParticipationFilter } from "@influence/engine/house-participation";
import { participationFilters } from "@/components/participation-history";
import styles from "./dashboard.module.css";

const HISTORY_PAGE_SIZE = 3;

export function DashboardHistory({ entries, loading, error }: { entries: HouseParticipation[]; loading: boolean; error: string | null }) {
  const [kind, setKind] = useState<ParticipationFilter>("all");
  const [page, setPage] = useState(0);
  const filtered = entries.filter(entry => kind === "all" || entry.gameKind === kind);
  // Temporary UI-only pagination: the owner-history endpoint currently returns
  // the entire list. Replace this slice with server pagination when that API
  // supports owner history and game-kind filtering; do not paginate one server
  // page again or substitute the public games list for private owner history.
  const pageCount = Math.ceil(filtered.length / HISTORY_PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visibleEntries = filtered.slice(currentPage * HISTORY_PAGE_SIZE, (currentPage + 1) * HISTORY_PAGE_SIZE);
  return <section aria-labelledby="dashboard-history-title">
    <div className={styles.sectionHead}><div><h2 id="dashboard-history-title">Your game history</h2><p>Completed games</p></div></div>
    <div className={styles.historyFilters} aria-label="History game type">{participationFilters.map(filter => <button type="button" key={filter.kind} aria-pressed={kind === filter.kind} onClick={() => { setKind(filter.kind); setPage(0); }}>{filter.label}</button>)}</div>
    {error && entries.length > 0 && <p className={styles.message} role="alert">{error} Showing the last loaded history.</p>}
    {loading && !entries.length ? <p className={styles.message} role="status">Loading history…</p> : error && !entries.length ? <p className={styles.message} role="alert">{error}</p> : filtered.length ? <><ol className={styles.historyList}>{visibleEntries.map(entry => <li className={styles.historyItem} key={`${entry.gameId}:${entry.playerId}`}>
      <p className={styles.historyKind}>{entry.gameKind === "werewolf" ? "Werewolf" : "Influence"} · {new Date(entry.completedAt).toLocaleDateString("en-US", { timeZone: "UTC" })}</p>
      <Link className={styles.historyTitle} href={`/games/${entry.gameSlug}`}>{entry.gameTitle}</Link>
      <p className={styles.historyDetail}>{entry.agentName} <span aria-hidden="true">·</span> <Link className={styles.link} href={`/games/${entry.gameSlug}/results`}>View results · Spoilers</Link></p>
    </li>)}</ol>{pageCount > 1 && <nav className={styles.historyPagination} aria-label="Game history pages">
      <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0}>Previous</button>
      <span aria-live="polite">Page {currentPage + 1} of {pageCount}</span>
      <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount - 1}>Next</button>
    </nav>}</> : <p className={styles.message}>No completed games in this history yet.</p>}
  </section>;
}
