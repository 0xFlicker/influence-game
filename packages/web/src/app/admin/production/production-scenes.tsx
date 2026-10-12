"use client";
/* eslint-disable @next/next/no-img-element -- The inspector compares exact original media. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePermissions } from "@/hooks/use-permissions";
import { useAdminRead, useAdminSession } from "../admin-session";
import { useMissingProductionScene, ReconcileAttempt } from "../production-recovery-tools";
import { SceneRepairPanel, isActiveMediaJob, type MediaRecords, type MediaAttempt } from "../games/[id]/visual/scene-repair-panel";
import { EvidenceImage } from "../games/[id]/visual/visual-operations";
import { productionGameRoot, type LoadedProductionSource, type ProductionLibraryGame } from "@/lib/production-studio";
import styles from "./studio.module.css";
import {StudioSelect} from "./studio-select";

interface SceneSummary {
  key: string; previewHash: string; sceneId: string | null; roomId: string; roomName: string; round: number | null;
  boundarySequence: number; afterDialogueSequence: number | null; participants: {id: string; name: string}[];
  available: boolean; originalFailed: boolean; latestVersion: number | null; publishedVersion: number | null; activeJob: {id: string; status: string; step: string; version: number} | null; attention: boolean;
}
interface SceneIndex {gameId: string; items: SceneSummary[]; nextOffset: number | null; total: number}
interface SceneDetail {scene: SceneSummary; media: MediaRecords; attempts: (MediaAttempt & {imageEvidenceUrl?: string})[]; uncertainAttemptIds: string[]; requiresReconciliation: boolean; pages: {nextVersionOffset: number | null; nextJobOffset: number | null; nextPublicationOffset: number | null; nextRequestOffset: number | null; nextAttemptOffset: number | null}}

/** Reads are bounded to one scene; repair, review and publication retain their existing owner. */
export function ProductionSceneInspector({game, source, audience, contextSceneId, onOpenGameTools}: {game: ProductionLibraryGame; source?: LoadedProductionSource; audience: "public" | "mystery" | "omniscient"; contextSceneId?: string | null; onOpenGameTools: () => void}) {
  const params = useSearchParams(), router = useRouter();
  const [offset, setOffset] = useState(0), [image, setImage] = useState<{url: string; label: string} | null>(null);
  const root = productionGameRoot(game.id), index = useAdminRead<SceneIndex>(`${root}/scenes?offset=${offset}&limit=50&audience=${audience}`);
  const selected = params.get("scene") ?? index.data?.items.find(scene => scene.sceneId === contextSceneId)?.key ?? index.data?.items[0]?.key;
  const selectedVersion = params.get("version");
  function choose(key: string) {const next = new URLSearchParams(params); next.set("scene", key); next.delete("version"); router.replace(`/admin/production/games/${encodeURIComponent(game.id)}?${next}`, {scroll: false});}
  return <section className={styles.inspectorScene} aria-label="Scene inspector"><div className={styles.panelTitle}><h2>Scene versions</h2><span>Comparison still</span></div><p className={styles.hint}>Comparison leaves the playhead and published preview in place.</p>
    {index.error && <p role="alert" className={styles.warning}>{index.error}</p>}
    {!index.data && !index.error && <p role="status">Loading scene index…</p>}
    {index.data && <><StudioSelect label="Inspect scene" value={index.data.items.some(scene => scene.key === selected) ? selected! : ""} onChange={choose} options={index.data.items.map(scene => ({value:scene.key,label:`${scene.roomName} · ${scene.round ?? "Opening"}${scene.attention ? " · Needs attention" : ""}`}))} /><div className={styles.tagActions}>{offset > 0 && <button onClick={() => setOffset(Math.max(0, offset - 50))}>Previous scenes</button>}{index.data.nextOffset !== null && <button onClick={() => setOffset(index.data!.nextOffset!)}>More scenes</button>}</div>{!index.data.total && <p>No generated scenes. Portrait moments remain fully editable.</p>}</>}
    {selected && <SelectedScene key={selected} game={game} source={source} audience={audience} sceneKey={selected} versionId={selectedVersion} onOpenGameTools={onOpenGameTools} onOpen={(url, label) => setImage({url, label})} onVersionChange={id => {const next = new URLSearchParams(params); next.set("scene", selected); next.set("version", id); router.replace(`/admin/production/games/${encodeURIComponent(game.id)}?${next}`, {scroll: false});}} />}
    {image && <ComparisonImage image={image} onClose={() => setImage(null)} />}
  </section>;
}

function SelectedScene({game, source, audience, sceneKey, versionId, onOpen, onVersionChange, onOpenGameTools}: {game: ProductionLibraryGame; source?: LoadedProductionSource; audience: string; sceneKey: string; versionId: string | null; onOpen: (url: string, label: string) => void; onVersionChange: (id: string) => void; onOpenGameTools: () => void}) {
  const root = productionGameRoot(game.id), session = useAdminSession(), [offset, setOffset] = useState(0);
  const {roles,hasPermission} = usePermissions();
  const canRepair = game.capabilities.sceneRepair && (game.gameKind === "influence" && game.status !== "completed"
    ? hasPermission("start_game") : roles.includes("producer") || roles.includes("sysop"));
  const query = new URLSearchParams({audience, offset: String(offset), limit: "25"}); if (versionId) query.set("versionId", versionId);
  const detailUrl = `${root}/scenes/${encodeURIComponent(sceneKey)}?${query}`;
  const detail = useAdminRead<SceneDetail>(detailUrl);
  const refetch = detail.refresh;
  const refresh = useCallback(async () => {await refetch();}, [refetch]);
  const {operation, render} = useMissingProductionScene(game.id, refresh);
  const [confirm, setConfirm] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const active = detail.data?.media.jobs.some(isActiveMediaJob);
  useEffect(() => {if (!active) return; const interval = setInterval(() => void refetch(), 3000); return () => clearInterval(interval);}, [active, refetch]);
  const sceneId = detail.data?.scene.sceneId;
  const uses = useMemo(() => source?.presentation.filter(moment => moment.segments.some(cue => {
    const picture = cue.picture;
    if (picture.kind === "werewolf" || picture.kind === "thinking") return sceneId && picture.scene?.id === sceneId;
    return sceneId && picture.kind === "influence" && picture.beat?.kind === "scene" && picture.beat.sceneId === sceneId;
  })).length, [source?.presentation, sceneId]);
  if (!detail.data) return detail.error ? <p role="alert" className={styles.warning}>{detail.error}</p> : <p role="status">Loading selected scene versions…</p>;
  const {scene, media, attempts} = detail.data;
  const mediaPrefix = game.gameKind === "influence" && game.status !== "completed" ? "/api/admin/games" : "/api/admin/production/games";
  const readPrefix = "/api/admin/production/games";
  const busy = operation?.phase === "submitting" || !!active, unknown = operation?.phase === "unknown";
  async function renderMissing() {
    try {
      await render(scene); setConfirm(false);
    } catch (error) {setNotice(error instanceof Error ? error.message : "Render request failed");}
  }
  return <div><h3>{scene.roomName}</h3><p className={styles.hint}>{scene.participants.map(person => person.name).join(" · ")}<br />{uses === undefined ? "Source moment usage is unavailable until the accepted source loads." : `Used by ${uses} source moments.`} Publishing changes their shared visual; gameplay remains separate.</p><button onClick={() => void refresh()}>Refresh selected scene</button>
    {detail.data.requiresReconciliation && <p role="alert" className={styles.warning}>More than 100 provider requests need reconciliation. Reconcile receipts before requesting another render.</p>}
    {!scene.sceneId ? game.gameKind === "influence" && game.status !== "completed" ? <p className={styles.hint}>This accepted boundary uses game-owned visual recovery. <button onClick={onOpenGameTools}>Open game production and recovery</button> to repair it.</p> : canRepair && <><button disabled={busy || unknown || detail.data.requiresReconciliation} onClick={() => setConfirm(true)}>Render missing image</button>{confirm && <div className={styles.warning}><p>This requests a new paid image from the existing production service. Review the candidate before publication.</p><button disabled={busy || detail.data.requiresReconciliation} onClick={() => void renderMissing()}>Confirm render for this scene</button><button onClick={() => setConfirm(false)}>Cancel</button></div>}{unknown && <button disabled={busy} onClick={() => void renderMissing()}>Check exact render request</button>}</> : <SceneRepairPanel key={`${scene.sceneId}:${versionId ?? "latest"}`} gameId={game.id} sceneId={scene.sceneId} originalFailed={scene.originalFailed} media={media} attempts={attempts} uncertainAttemptIds={detail.data.uncertainAttemptIds} renderDisabled={detail.data.requiresReconciliation} versionId={versionId} onVersionChange={onVersionChange} canOperate={canRepair && offset === 0} apiPrefix={mediaPrefix} readApiPrefix={readPrefix} publicationAudience="viewers" requirePublication={game.gameKind === "werewolf"} refresh={refresh} refreshError={detail.error} onOpen={onOpen} />}
    {notice && <p role="alert" className={styles.warning}>{notice}</p>}{detail.error && <p role="alert" className={styles.warning}>{detail.error}</p>}
    <div className={styles.tagActions}>{offset > 0 && <button onClick={() => setOffset(Math.max(0, offset - 25))}>Newer scene records</button>}{detail.data.pages && Object.values(detail.data.pages).some(next => next !== null) && <button onClick={() => setOffset(offset + 25)}>Older scene records</button>}</div>{offset > 0 && <p className={styles.hint}>Open the newest scene records to run repair or publication.</p>}
    <details id="provider-attempts"><summary>Selected-scene receipts · {attempts.length}</summary>{attempts.map(attempt => <details key={attempt.id}><summary>{attempt.id} · {attempt.status} · {attempt.costMicrousd === null ? "Unpriced" : `$${(attempt.costMicrousd / 1_000_000).toFixed(4)}`}</summary><pre className={styles.receipt}>{JSON.stringify(attempt, null, 2)}</pre>{attempt.imageEvidenceUrl && <EvidenceImage gameId={game.id} id={attempt.id} kind="attempt" apiPrefix={readPrefix} onOpen={url => onOpen(url, `Attempt ${attempt.id}`)} />}{attempt.status === "needs_reconciliation" && canRepair && <ReconcileAttempt gameId={game.id} attemptId={attempt.id} refresh={refresh} apiPrefix={mediaPrefix} readAttempt={async () => (await session.read<SceneDetail>(detailUrl)).attempts.find(row => row.id === attempt.id)} />}</details>)}</details>
  </div>;
}

function ComparisonImage({image, onClose}: {image: {url: string; label: string}; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {const element = dialog.current; element?.showModal(); return () => element?.close();}, []);
  return <dialog ref={dialog} aria-label={image.label} className={styles.imageDialog} onCancel={onClose}><header><strong>{image.label}</strong><button autoFocus onClick={onClose}>Close comparison</button></header><img src={image.url} alt={image.label} /></dialog>;
}
