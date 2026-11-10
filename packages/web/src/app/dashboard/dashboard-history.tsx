"use client";
import Link from "next/link";
import type { HouseParticipation, ParticipationFilter } from "@influence/engine/house-participation";
import { participationFilters } from "@/components/participation-history";
import styles from "./dashboard.module.css";

export function DashboardHistory({ entries, loading, error, kind, page, hasNext, onKindChange, onPrevious, onNext, onRetry }: {
  entries: HouseParticipation[]; loading: boolean; error: string | null; kind: ParticipationFilter;
  page: number; hasNext: boolean; onKindChange: (kind: ParticipationFilter) => void;
  onPrevious: () => void; onNext: () => void; onRetry: () => void;
}) {
  return <section aria-labelledby="dashboard-history-title">
    <div className={styles.sectionHead}><div><h2 id="dashboard-history-title">Your game history</h2><p>Completed games</p></div></div>
    <div className={styles.historyFilters} aria-label="History game type">{participationFilters.map(filter => <button type="button" key={filter.kind} aria-pressed={kind === filter.kind} onClick={() => onKindChange(filter.kind)}>{filter.label}</button>)}</div>
    {loading ? <p className={styles.message} role="status">Loading history…</p> : error ? <p className={styles.message} role="alert">{error} <button type="button" className={styles.link} onClick={onRetry}>Try again</button></p> : entries.length ? <ol className={styles.historyList}>{entries.map(entry => <li className={styles.historyItem} key={`${entry.gameId}:${entry.playerId}`}>
      <p className={styles.historyKind}>{entry.gameKind === "werewolf" ? "Werewolf" : "Influence"} · {new Date(entry.completedAt).toLocaleDateString("en-US", { timeZone: "UTC" })}</p>
      <Link className={styles.historyTitle} href={`/games/${entry.gameSlug}`}>{entry.gameTitle}</Link>
      <p className={styles.historyDetail}>{entry.agentName} <span aria-hidden="true">·</span> <Link className={styles.link} href={`/games/${entry.gameSlug}/results`}>View results · Spoilers</Link></p>
    </li>)}</ol> : <p className={styles.message}>No completed games in this history yet.</p>}
    {!loading && !error && (page > 0 || hasNext) && <nav className={styles.historyPagination} aria-label="Game history pages">
      <button type="button" onClick={onPrevious} disabled={page === 0}>Previous</button>
      <span aria-live="polite">Page {page + 1}</span>
      <button type="button" onClick={onNext} disabled={!hasNext}>Next</button>
    </nav>}
  </section>;
}
