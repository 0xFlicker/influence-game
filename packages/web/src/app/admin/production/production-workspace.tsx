"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductionPresentationSettings } from "@influence/engine/production-moments/settings";
import { ProductionSceneInspector } from "./production-scenes";
import { selectProductionMoments, validateProductionTags, type ProductionMoment, type ProductionSelection } from "@influence/engine/production-moments";
import { ApiError, resolveApiUrl } from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";
import { loadProductionStudioSource, prepareProductionAssets, productionGameRoot, productionLibraryFilters, type LoadedProductionSource, type MomentAnnotation, type ProductionLibraryGame } from "@/lib/production-studio";
import type { CachedAsset } from "@/lib/replay-export/assets";
import { compilePresentation } from "@/lib/replay-export/presentation";
import { parseTimingProfile } from "@/lib/replay-export/timing";
import {importBrowserSpeech, prepareBrowserSpeech, disposeBrowserSpeech, type BrowserSpeechImport} from "@/lib/replay-export/speech-browser";
import type { ReplayManifest } from "@/lib/replay-export/manifest";
import type {ExportCue} from "@/lib/replay-export/cues";
import { useAdminRead, useAdminSession, useAdminValue, type Operation } from "../admin-session";
import { EpisodeEditor } from "../episode-editor";
import { AdminPostgameMediaPanel } from "../admin-postgame-media";
import { GameProductionRecovery } from "../production-recovery-tools";
import { VisualOperations } from "../games/[id]/visual/visual-operations";
import { ProductionPreview, type ProductionPreviewHandle, type PresentationAnchor } from "./production-preview";
import {StudioDialog} from "./studio-dialog";
import {StudioSelect} from "./studio-select";
import styles from "./workspace.module.css";
import "../../games/episodes.css";


const initialSettings: ProductionPresentationSettings = {width: 1280, height: 720, fps: 30, reducedMotion: false, music: true, volume: .3, profile: parseTimingProfile()};
function message(error: unknown) {return error instanceof Error ? error.message : "Production request failed";}
const clock = (frames: number, fps: number) => `${Math.floor(frames / fps / 60)}:${String(Math.floor(frames / fps) % 60).padStart(2, "0")}.${String(frames % fps).padStart(2, "0")}`;
function geometry(ratio: string, longest: number) {const short = Math.round(longest * 9 / 16 / 2) * 2; return ratio === "1:1" ? {width: longest, height: longest} : ratio === "9:16" ? {width: short, height: longest} : {width: longest, height: short};}
function momentName(cue: ExportCue | undefined) {return cue?.picture.kind === "thinking" ? cue.picture.actor.name : cue?.speech?.speaker ?? cue?.label;}

export function ProductionWorkspace({gameId}: {gameId: string}) {
  const metadata = useAdminRead<ProductionLibraryGame>(productionGameRoot(gameId));
  if (!metadata.data) return <div>{metadata.error ? <p role="alert">{metadata.error}</p> : <p role="status">Loading game production capabilities…</p>}<Link href="/admin/production">← Production library</Link></div>;
  return <GameWorkspace key={gameId} game={metadata.data} />;
}

function GameWorkspace({game}: {game: ProductionLibraryGame}) {
  const params = useSearchParams(), router = useRouter(), session = useAdminSession(), client = useQueryClient();
  const { roles, hasPermission } = usePermissions();
  const producer = roles.includes("producer") || roles.includes("sysop");
  const editorial = game.capabilities.editorial && producer;
  const episodeRead = hasPermission("view_admin") || hasPermission("manage_roles");
  const episodeEdit = hasPermission("manage_postgame_media") || hasPermission("manage_roles");
  const visualRead = game.capabilities.visualRead && (game.gameKind === "influence" ? hasPermission("view_admin") || producer && game.status === "completed" : producer);
  const influenceRecovery = game.capabilities.influenceRecovery && hasPermission("start_game");
  const root = productionGameRoot(game.id), [blocked] = useAdminValue(`access-denied:${root}`, false);
  const audience = game.gameKind === "influence" ? "public" : params.get("audience") === "omniscient" ? "omniscient" : "mystery";
  const thinking = audience !== "mystery" && params.get("thinking") !== "off";
  const library = productionLibraryFilters(new URLSearchParams(params.get("return") ?? ""));
  const [episode, setEpisode] = useState(false), [trailer, setTrailer] = useState(false), [tools, setTools] = useState(false), [episodeTools, setEpisodeTools] = useState(false);
  function changeScope(next: string) {
    session.clearMatching(key => key.startsWith("draft:") && key.includes(root));
    const filter = {predicate: (query: {queryKey: readonly unknown[]}) => query.queryKey[0] === "admin" && query.queryKey[1] === session.scope && String(query.queryKey[2]).startsWith(`${root}/source`)};
    void client.cancelQueries(filter); client.removeQueries(filter);
    const query = new URLSearchParams(params); query.set("audience", next); query.delete("moment"); query.delete("scene"); query.delete("version"); query.delete("thinking"); router.replace(`/admin/production/games/${encodeURIComponent(game.id)}?${query}`);
  }
  const identity = <div className={styles.identity}><Link href={`/admin/production?${library}`} aria-label="Back to production library">←</Link><div><h1>{game.title ?? game.slug}</h1><p>{game.gameKind === "werewolf" ? "Werewolf" : "Influence"} · {game.status === "suspended" ? "Paused accepted prefix" : game.status === "completed" ? "Completed episode" : `Game visual operations · ${game.status.replaceAll("_", " ")}`}</p></div></div>;
  const gameActions = <>{game.capabilities.episodeEdit && episodeEdit && <button onClick={() => {setEpisodeTools(false); setEpisode(true);}}>Episode presentation</button>}{game.capabilities.trailerRead && episodeRead && <button onClick={() => {setEpisodeTools(false); setTrailer(true);}}>Trailer & poster</button>}{visualRead && <button onClick={() => {setEpisodeTools(false); setTools(true);}}>Game production and recovery</button>}</>;
  return <section className={styles.studio} data-production-workspace>
    {editorial && !blocked && <>
      <MomentWorkspace key={`${game.id}:${audience}`} game={game} audience={audience} thinking={thinking} identity={identity} onOpenEpisodeTools={() => setEpisodeTools(true)} onOpenGameTools={() => setTools(true)} scopeControls={<>{game.gameKind === "werewolf" && <StudioSelect label="Production audience" value={audience} onChange={changeScope} options={[{value:"mystery",label:"Mystery"},{value:"omniscient",label:"Omniscient"}]} />}{audience !== "mystery" && <label><input type="checkbox" checked={thinking} onChange={event => {const query = new URLSearchParams(params); query.set("thinking", event.target.checked ? "on" : "off"); query.delete("moment"); router.replace(`/admin/production/games/${encodeURIComponent(game.id)}?${query}`);}} /> Show thinking moments</label>}</>} />
    </>}
    {(!editorial || blocked) && <><header className={styles.commandBar}>{identity}<div className={styles.commands}>{gameActions}</div></header><div className={styles.sourceProgress}>{blocked ? <p role="alert">Production access changed. Private editing data has been cleared. Refresh to check current permissions.</p> : <p>Use the game production tools available to your current permissions.</p>}</div></>}
    {episodeTools && <StudioDialog title="Episode tools" onClose={() => setEpisodeTools(false)}><div className={styles.actions}>{gameActions}</div></StudioDialog>}
    {visualRead && tools && <StudioDialog title="Game production and recovery" wide onClose={() => setTools(false)}>{game.gameKind === "influence" && (influenceRecovery || !editorial) ? <VisualOperations gameId={game.id} hideIndependentMedia={editorial} /> : <GameProductionRecovery gameId={game.id} />}</StudioDialog>}
    {episode && game.capabilities.episodeEdit && episodeEdit && <EpisodeEditor gameId={game.id} onClose={() => setEpisode(false)} onSaved={async () => {await client.invalidateQueries({queryKey: ["admin", session.scope, root]});}} />}
    {trailer && game.capabilities.trailerRead && episodeRead && <AdminPostgameMediaPanel game={{id: game.id, slug: game.slug}} canManage={game.capabilities.trailerRender && episodeEdit} onClose={() => setTrailer(false)} />}
  </section>;
}

function MomentWorkspace({game, audience, thinking, identity, scopeControls, onOpenEpisodeTools, onOpenGameTools}: {game: ProductionLibraryGame; audience: "public" | "mystery" | "omniscient"; thinking: boolean; identity: ReactNode; scopeControls: ReactNode; onOpenEpisodeTools: () => void; onOpenGameTools: () => void}) {
  const params = useSearchParams(), router = useRouter(), session = useAdminSession(), client = useQueryClient();
  // Load the complete authorized catalog once. Thinking visibility selects
  // from that pin; it must not request newer history or published visuals.
  const sourceThinking = audience !== "mystery";
  const root = productionGameRoot(game.id), scope = `${root}/source?audience=${audience}&thinking=${sourceThinking ? "on" : "off"}`;
  const [blocked] = useAdminValue(`access-denied:${root}`, false);
  const [settings, setSettings] = useState(initialSettings), [saved, setSaved] = useState<Record<string, MomentAnnotation>>({});
  const [predicateKey, setPredicateKey] = useState("cut"), [predicateValue, setPredicateValue] = useState("youtube");
  const [includeOpening, setIncludeOpening] = useState(false), [includeResult, setIncludeResult] = useState(false);
  const [notice, setNotice] = useState<string | null>(null), [refreshing, setRefreshing] = useState(false);
  const [exportCommand, setExportCommand] = useState<string | null>(null);
  const [panel, setPanel] = useState<"presentation" | "recordings" | "export" | "cut" | "scene" | null>(null);
  const [search, setSearch] = useState(""), [mobilePanel, setMobilePanel] = useState("moments");
  const [activeId, setActiveId] = useState<string | null>(null), [following, setFollowing] = useState(true), [pinnedId, setPinnedId] = useState(params.get("moment"));
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const [cutConflict, setCutConflict] = useState(false), [cutNeedsReview, setCutNeedsReview] = useState(false);
  const [refreshed, setRefreshed] = useState<{scope: string; source: LoadedProductionSource} | null>(null);
  const selectionOperationKey = `operation:${root}/selection`;
  const [selectionOperation] = useAdminValue<Operation | undefined>(selectionOperationKey, undefined);
  const [speechImport, setSpeechImport] = useState<{id: string; value: BrowserSpeechImport} | null>(null), [importing, setImporting] = useState(false);
  const importRequest = useRef<AbortController | null>(null);
  const anchor = useRef<PresentationAnchor>(params.get("moment") ? {momentId: params.get("moment")!, offsetMs: 0} : null);
  const readAnchor = useCallback(() => anchor.current, []);
  const retainAnchor = useCallback((next: PresentationAnchor) => {anchor.current = next;}, []);
  const [playback, setPlayback] = useState({muted: true, volume: .5});
  const preview = useRef<ProductionPreviewHandle>(null), alive = useRef(true);
  const assetCaches = useRef(new Map<string, {assets: Map<string, CachedAsset>; urls: Map<string, string>}>());
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useEffect(() => () => {importRequest.current?.abort();}, []);
  useEffect(() => () => {if (speechImport) disposeBrowserSpeech(speechImport.value);}, [speechImport]);
  const query = useQuery({queryKey: ["admin", session.scope, scope], enabled: !blocked, staleTime: Infinity, retry: false, refetchOnWindowFocus: false, queryFn: ({signal}) => {
    return loadProductionStudioSource((url, abort) => session.read(url, abort), {gameId: game.id, gameKind: game.gameKind, audience, thinking: sourceThinking, signal});
  }});
  const loaded = blocked ? null : refreshed?.scope === scope ? refreshed.source : query.data;
  useEffect(() => {
    for (const [hash, cache] of assetCaches.current) if (hash !== loaded?.snapshot.sourceHash) {
      // Prepared queries contain these object URLs. Evict them together so a
      // later visibility toggle cannot revive a revoked cached presentation.
      const filter = {predicate: (query: {queryKey: readonly unknown[]}) => {
        const resource = String(query.queryKey[2]), recordings = resource.endsWith(":recordings");
        return query.queryKey[0] === "admin" && query.queryKey[1] === session.scope && resource.startsWith(`${root}/source?`) && (resource.endsWith(":media") || recordings) && query.queryKey[3] === hash;
      }};
      void client.cancelQueries(filter); client.removeQueries(filter);
      cache.urls.forEach(url => URL.revokeObjectURL(url)); assetCaches.current.delete(hash);
    }
  }, [loaded?.snapshot.sourceHash, client, root, session.scope]);
  useEffect(() => {
    const caches = assetCaches.current;
    return () => {
      // The session survives library navigation; this workspace's prepared
      // URLs and annotation overlays do not. Re-entry must read fresh source.
      const filter = {predicate: (query: {queryKey: readonly unknown[]}) => query.queryKey[0] === "admin" && query.queryKey[1] === session.scope && String(query.queryKey[2]).startsWith(`${root}/source?`)};
      void client.cancelQueries(filter); client.removeQueries(filter);
      caches.forEach(cache => cache.urls.forEach(url => URL.revokeObjectURL(url))); caches.clear();
    };
  }, [client, root, session.scope]);
  const annotations = useMemo(() => Object.fromEntries([...(loaded?.annotations ?? []), ...Object.values(saved)].map(annotation => [annotation.momentId, annotation.tags])), [loaded, saved]);
  const view = params.get("view") === "cut" ? "cut" : "source";
  const selection: ProductionSelection = {mode: "tagged", thinking, predicate: {[predicateKey]: predicateValue}, includeOpening, includeResult};
  let selectionError: string | null = null, selectedIds: string[] = [];
  try {if (loaded) selectedIds = selectProductionMoments(loaded.catalog, selection, annotations).map(moment => moment.id);} catch (error) {selectionError = message(error);}
  const selectedKey = JSON.stringify(selectedIds);
  const stableSelectedIds = useMemo(() => JSON.parse(selectedKey) as string[], [selectedKey]);
  const playableIds = useMemo(() => view === "source" ? loaded?.catalog.moments.filter(moment => thinking || moment.kind !== "thinking").map(moment => moment.id) ?? [] : stableSelectedIds, [view, loaded, stableSelectedIds, thinking]);
  const media = useQuery({queryKey: ["admin", session.scope, `${scope}:media`, loaded?.snapshot.sourceHash, JSON.stringify(playableIds)], enabled: Boolean(loaded) && !blocked, staleTime: Infinity, retry: false, refetchOnWindowFocus: false, queryFn: ({signal}) => {
    const hash = loaded!.snapshot.sourceHash;
    let cache = assetCaches.current.get(hash);
    if (!cache) {cache = {assets: new Map(), urls: new Map()}; assetCaches.current.set(hash, cache);}
    return prepareProductionAssets(loaded!.presentation.filter(moment => playableIds.includes(moment.id)).flatMap(moment => moment.segments), signal, cache.assets, {read: (url, abort) => session.readMedia(url, abort), urls: cache.urls});
  }});
  const readyPresentation = useMemo(() => {
    if (!loaded || !media.data) return null;
    let offset = 0;
    return loaded.presentation.map(moment => {
      if (!playableIds.includes(moment.id)) return moment;
      const segments = media.data.cues.slice(offset, offset + moment.segments.length); offset += moment.segments.length;
      return {...moment, segments};
    });
  }, [loaded, media.data, playableIds]);
  const recordings = useQuery({queryKey: ["admin", session.scope, `${scope}:recordings`, loaded?.snapshot.sourceHash, speechImport?.id, JSON.stringify(playableIds)], enabled: !!speechImport && !!readyPresentation && !blocked, staleTime: Infinity, retry: false, refetchOnWindowFocus: false, queryFn: ({signal}) => prepareBrowserSpeech(speechImport!.value, readyPresentation!, playableIds, signal)});
  const attachedPresentation = speechImport ? recordings.data?.source ?? null : readyPresentation;
  const assets = useMemo(() => media.data ? {...media.data.assets, ...(speechImport ? recordings.data?.assets : {})} : null, [media.data, speechImport, recordings.data]);
  const all = useMemo(() => attachedPresentation && assets ? compilePresentation({source: attachedPresentation, selectedIds: playableIds, profile: settings.profile, fps: settings.fps, assets, music: settings.music, volume: settings.volume}) : null, [attachedPresentation, playableIds, assets, settings]);
  const base = useMemo<ReplayManifest | null>(() => loaded && all && assets ? {schema: "house.replay-export", version: 2, game: {id: game.id, slug: game.slug, kind: game.gameKind, ...(audience !== "public" ? {audience} : {})}, ...settings, thinking, cues: all.cues, timeline: all.timeline, audio: all.audio, assets, staticFiles: {}, boundary: {eventSequence: loaded.snapshot.throughEventSequence, cursor: loaded.snapshot.throughCursor, publicationCutoff: loaded.snapshot.publicationCutoff}, range: {fromFrame: 0, untilFrame: Math.ceil(all.audio.durationMs * settings.fps / 1000)}, revision: `${loaded.snapshot.sourceHash}:${speechImport?.id ?? "no-recordings"}`, dirty: false} : null, [loaded, all, assets, settings, game.id, game.slug, game.gameKind, audience, thinking, speechImport]);
  const visibleMoments = useMemo(() => loaded?.catalog.moments.filter(moment => thinking || moment.kind !== "thinking") ?? [], [loaded, thinking]);
  const inspected = visibleMoments.find(moment => moment.id === (following ? activeId : pinnedId)) ?? visibleMoments.find(moment => moment.id === params.get("moment")) ?? visibleMoments[0];
  const presentationById = useMemo(() => new Map(loaded?.presentation.map(moment => [moment.id, moment]) ?? []), [loaded]);
  const contextPicture = inspected ? presentationById.get(inspected.id)?.segments[0]?.picture : undefined;
  const contextSceneId = contextPicture?.kind === "werewolf" || contextPicture?.kind === "thinking" ? contextPicture.scene?.id : contextPicture?.kind === "influence" && contextPicture.beat?.kind === "scene" ? contextPicture.beat.sceneId : null;
  const visiblePresentation = useMemo(() => {const visible = new Set(visibleMoments.map(moment => moment.id)); return attachedPresentation?.filter(moment => visible.has(moment.id));}, [attachedPresentation, visibleMoments]);
  const sourceTimings = useMemo(() => all ?? (loaded ? compilePresentation({source: loaded.presentation, selectedIds: visibleMoments.map(moment => moment.id), profile: settings.profile, fps: settings.fps, assets: {}, music:false, volume:0}) : null), [all, loaded, visibleMoments, settings.profile, settings.fps]);
  const timingById = useMemo(() => new Map(sourceTimings?.moments.map(moment => [moment.id, moment])), [sourceTimings]);
  const cutTiming = useMemo(() => loaded ? view === "cut" ? all : compilePresentation({source: attachedPresentation ?? loaded.presentation,selectedIds:stableSelectedIds,profile:settings.profile,fps:settings.fps,assets:assets ?? {},music:settings.music,volume:settings.volume}) : null, [loaded,view,all,attachedPresentation,stableSelectedIds,settings.profile,settings.fps,settings.music,settings.volume,assets]);
  const cutDuration = Math.ceil((cutTiming?.audio.durationMs ?? 0) * settings.fps / 1000);
  const listed = visibleMoments.filter(moment => (view === "source" || stableSelectedIds.includes(moment.id)) && (() => {const cue = presentationById.get(moment.id)?.segments[0]; return `${cue?.label} ${cue?.timing.thinking ?? ""} ${cue?.speech?.text ?? ""}`.toLowerCase().includes(search.toLowerCase());})());
  const onActiveMomentChange = useCallback((state: {momentId: string | null; view: "source" | "cut"; revision: string}) => {if (state.view === view && state.revision === base?.revision) setActiveId(state.momentId);}, [view,base?.revision]);
  useEffect(() => {if (following && activeId) rows.current.get(activeId)?.scrollIntoView({block:"nearest"});}, [following, activeId]);
  function navigate(key: string, value: string) {const next = new URLSearchParams(params); next.set(key, value); router.replace(`/admin/production/games/${encodeURIComponent(game.id)}?${next}`, {scroll: false});}
  function edit(action: () => void) {preview.current?.pauseAndRetainAnchor(); action();}
  function changeView(next: "source" | "cut") {edit(() => navigate("view", next)); setSearch(""); setFollowing(true);}
  function selectMoment(id: string) {anchor.current = {momentId:id,offsetMs:0}; preview.current?.seekMoment(id); setActiveId(id); setPinnedId(id); setFollowing(true); const next = new URLSearchParams(params); next.set("moment",id); next.delete("scene"); next.delete("version"); router.replace(`/admin/production/games/${encodeURIComponent(game.id)}?${next}`,{scroll:false});}
  function openPanel(next: typeof panel) {preview.current?.pauseAndRetainAnchor(); setPanel(next);}
  function setTiming(key: "readingRate" | "thinkingRate" | "conversationGapMs" | "motionScale", value: string) {edit(() => {const profile = {...settings.profile}; if (!value) delete profile[key]; else profile[key] = Number(value); try {setSettings({...settings, profile: parseTimingProfile(profile)}); setNotice(null);} catch (error) {setNotice(message(error));}});}
  async function refreshPublished() {
    if (!loaded) return;
    preview.current?.pauseAndRetainAnchor(); setRefreshing(true); setNotice(null);
    try {
      const result = await loadProductionStudioSource((url, signal) => session.read(url, signal), {gameId: game.id, gameKind: game.gameKind, audience, thinking: sourceThinking, signal: AbortSignal.timeout(120_000), snapshot: loaded.snapshot, refreshVisuals: true});
      if (alive.current) {setRefreshed({scope,source:result}); setNotice("Published visuals refreshed at the same accepted source boundary.");}
    } catch (error) {if (alive.current) setNotice(message(error));} finally {if (alive.current) setRefreshing(false);}
  }
  async function freeze(retryExact = false) {
    if (!retryExact && (!loaded || !selectedIds.length || selectionError || cutConflict || cutNeedsReview || !base)) return;
    if (retryExact && selectionOperation?.phase !== "unknown") return;
    preview.current?.pauseAndRetainAnchor(); setNotice(null);
    try {
      const input = retryExact ? selectionOperation!.body : {snapshot: loaded!.snapshot, audience, thinking: sourceThinking, selection, expectedMomentIds: stableSelectedIds, recordings: recordings.data?.recordings.filter(recording => stableSelectedIds.includes(recording.momentId)) ?? [], settings, copy: {title: loaded!.title ?? game.title ?? game.slug}};
      const descriptor = await session.execute<Record<string, unknown>>(selectionOperationKey, `${root}/selection`, input);
      if (!descriptor || !alive.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(descriptor, null, 2)], {type: "application/json"}));
      const link = document.createElement("a"); link.href = url; link.download = `${game.slug}-selection.json`; link.click(); URL.revokeObjectURL(url);
      const hasRecordings = Array.isArray(descriptor.recordings) && descriptor.recordings.length > 0;
      const apiOrigin = new URL(resolveApiUrl("/api/auth/me"), window.location.origin).origin;
      setExportCommand(`bun run replay:export -- --selection ${game.slug}-selection.json --api-base-url ${apiOrigin} --web-base-url ${window.location.origin}${hasRecordings ? " --speech-manifest your-speech-manifest.json" : ""} --output .renders/${game.slug}.mp4`);
      setNotice("Frozen selected IDs downloaded. Run the local command shown in Export to encode the movie.");
    } catch (error) {if (alive.current) {if (error instanceof ApiError && error.status === 409) setCutConflict(true); setNotice(message(error));}}
  }
  async function refreshTags() {
    if (!loaded) return;
    preview.current?.pauseAndRetainAnchor(); setRefreshing(true); setNotice(null);
    try {
      const result = await loadProductionStudioSource((url, signal) => session.read(url, signal), {gameId: game.id, gameKind: game.gameKind, audience, thinking: sourceThinking, signal: AbortSignal.timeout(120_000), snapshot: loaded.snapshot});
      if (alive.current) {setRefreshed({scope,source:result}); setSaved(current => {const revisions = new Map(result.annotations.map(annotation => [annotation.momentId,annotation.revision])); return Object.fromEntries(Object.entries(current).filter(([id,annotation]) => annotation.revision > (revisions.get(id) ?? 0)));}); setCutConflict(false); setCutNeedsReview(true); setNotice("Saved tags refreshed at the pinned source boundary. Review the selected cut before downloading.");}
    } catch (error) {if (alive.current) setNotice(message(error));} finally {if (alive.current) setRefreshing(false);}
  }
  async function importRecordings(files: File[]) {
    if (!loaded) return;
    preview.current?.pauseAndRetainAnchor(); importRequest.current?.abort();
    const request = new AbortController(); importRequest.current = request; setImporting(true); setNotice(null);
    try {
      const value = await importBrowserSpeech(files, loaded.presentation, request.signal);
      if (request.signal.aborted || !alive.current) {disposeBrowserSpeech(value); return;}
      setSpeechImport({id: crypto.randomUUID(), value}); setNotice(`${value.bindings.size} local recording references imported. Audio stays in this browser; use the same manifest and files for local export.`);
    } catch (error) {if (!request.signal.aborted && alive.current) setNotice(message(error));} finally {if (!request.signal.aborted && alive.current) setImporting(false);}
  }
  const header = <header className={styles.commandBar}>{identity}<div className={styles.commands}><button onClick={() => {preview.current?.pauseAndRetainAnchor(); onOpenEpisodeTools();}}>Episode tools</button><button disabled={!loaded} onClick={() => openPanel("presentation")}>Presentation</button><button disabled={!loaded} onClick={() => openPanel("recordings")}>Recordings</button><button disabled={!loaded} className={styles.primary} onClick={() => openPanel("export")}>Export…</button></div></header>;
  if (!loaded) return <>{header}<div className={styles.sourceProgress}>{query.error ? <><p role="alert">{message(query.error)} <button onClick={() => void query.refetch()}>Retry source</button></p><button onClick={() => openPanel("scene")}>Scene versions…</button></> : <p role="status">Loading the complete accepted source prefix and media metadata…</p>}</div>{panel === "scene" && <StudioDialog title="Scene versions & production" wide onClose={() => setPanel(null)}><ProductionSceneInspector game={game} audience={audience} onOpenGameTools={() => {setPanel(null); onOpenGameTools();}} /></StudioDialog>}</>;
  const ratio = settings.width === settings.height ? "1:1" : settings.width < settings.height ? "9:16" : "16:9";
  return <>
    {header}
    <div className={styles.scopeBar}><span>Source pinned at event {loaded.snapshot.throughEventSequence}{loaded.snapshot.throughCursor ? ` / audience cursor ${loaded.snapshot.throughCursor}` : ""}. Visuals stay pinned until refreshed.</span><div className={styles.scopeControls} onChangeCapture={() => preview.current?.pauseAndRetainAnchor()}>{scopeControls}</div></div>
    <nav className={styles.mobileTabs} aria-label="Editor panels"><button aria-pressed={mobilePanel === "moments" && view === "source"} onClick={() => {changeView("source"); setMobilePanel("moments");}}>Source</button><button aria-pressed={mobilePanel === "moments" && view === "cut"} onClick={() => {changeView("cut"); setMobilePanel("moments");}}>Selected cut</button><button aria-pressed={mobilePanel === "properties"} onClick={() => setMobilePanel("properties")}>Properties</button><button onClick={() => openPanel("cut")}>Cut rule</button></nav>
    <div className={styles.workspace} data-mobile-panel={mobilePanel}>
      <section className={styles.browser} aria-label="Source moment browser">
        <div className={styles.browserHeading}><div className={styles.segmented}><button aria-pressed={view === "source"} onClick={() => changeView("source")}>Source</button><button aria-pressed={view === "cut"} onClick={() => changeView("cut")}>Selected cut</button></div><button onClick={() => openPanel("cut")}>Cut rule <span>{predicateKey}={predicateValue}</span></button></div>
        <div className={styles.search}><input aria-label="Find a moment" placeholder="Find a moment, speaker or phrase" value={search} onChange={event => setSearch(event.target.value)} /><span>{view === "source" ? `${listed.length} moments` : `${selectedIds.length} in cut · ${clock(cutDuration, settings.fps)}`}</span></div>
        <div className={styles.listHead}><span>Moment</span><span>Duration</span><span>Cut</span></div>
        <div className={styles.momentList}>{listed.length ? listed.map(moment => {
          const cue = presentationById.get(moment.id)?.segments[0], timing = timingById.get(moment.id), text = moment.kind === "thinking" ? cue?.timing.thinking : cue?.speech?.text;
          return <div key={moment.id} data-moment-id={moment.id}><button ref={element => {if (element) rows.current.set(moment.id,element); else rows.current.delete(moment.id);}} className={styles.moment} aria-pressed={inspected?.id === moment.id} data-active={activeId === moment.id} onClick={() => selectMoment(moment.id)}>
            <span className={styles.momentCopy}><span className={styles.kind} data-kind={moment.kind}>{moment.kind}</span><strong>{momentName(cue) ?? moment.kind}</strong><small>{text ?? cue?.label ?? moment.kind}</small></span><span className={styles.duration}>{clock(timing ? timing.endFrame - timing.startFrame : 0, settings.fps)}</span><span className={styles.cutTag}>{stableSelectedIds.includes(moment.id) ? "Included" : "—"}</span>
          </button></div>;
        }) : <div className={styles.empty}><h3>{view === "cut" ? "No moments in this cut" : "No matches"}</h3><p>{selectionError ?? (view === "cut" ? "Tag a thought or speech in Source, then return here." : "Try another speaker or phrase.")}</p><button onClick={() => {changeView("source"); setSearch("");}}>Browse source</button></div>}</div>
        <div className={styles.browserFoot}><span>Click a moment to seek and edit. Scrub to discover.</span><button onClick={() => changeView("cut")}>Watch cut →</button></div>
      </section>
      {base && attachedPresentation && all ? <ProductionPreview ref={preview} compiled={all} onActiveMomentChange={onActiveMomentChange} readAnchor={readAnchor} onAnchorChange={retainAnchor} playback={playback} onPlaybackChange={setPlayback} base={base} source={visiblePresentation!} selectedIds={stableSelectedIds} view={view} onViewChange={changeView} emptyLabel={selectionError ?? "No saved moments match this exact tag predicate. Tag a source moment or choose another value."} /> : <>
        <section className={styles.monitor} aria-label="Playable preview"><div className={styles.sectionHeading}><h2>{view === "source" ? "Source preview" : "Selected cut"}</h2></div><div className={styles.monitorStage}><div className={styles.empty}>{recordings.error ? <p role="alert">{message(recordings.error)} <button onClick={() => void recordings.refetch()}>Retry local recordings</button></p> : media.error ? <p role="alert">{message(media.error)} <button onClick={() => void media.refetch()}>Retry selected media</button></p> : <p role="status">Preparing media for {view === "source" ? "source preview" : "selected cut"}…</p>}</div></div></section><section className={styles.timelinePanel}><p className={styles.statusLine}>Preparing the intended preview. Select a moment to retain its position.</p></section>
      </>}
      <aside className={styles.properties} aria-label="Moment properties" data-selected-moment={inspected?.id}>
        <div className={styles.sectionHeading}><h2>Moment properties</h2>{following ? <span>Follows playhead</span> : <button onClick={() => setFollowing(true)}>Follow playhead</button>}<button onClick={() => openPanel("scene")}>Scene versions…</button></div>
        {inspected && <MomentInspector key={inspected.id} gameId={game.id} audience={audience} thinking={sourceThinking} loaded={loaded} moment={inspected} annotation={saved[inspected.id] ?? loaded.annotations.find(item => item.momentId === inspected.id) ?? {momentId: inspected.id, tags: {}, revision: 0}} onPin={() => {setPinnedId(inspected.id); setFollowing(false); preview.current?.pauseAndRetainAnchor();}} onSaved={annotation => {preview.current?.pauseAndRetainAnchor(); setSaved(previous => ({...previous, [annotation.momentId]: annotation}));}} />}
      </aside>
    </div>
    {notice && <div className={styles.statusLine} role="status" title={notice}>{notice}</div>}
    {panel && <StudioDialog title={{presentation:"Presentation",recordings:"Local recordings",export:"Export selected cut",cut:"Selected cut rule",scene:"Scene versions & production"}[panel]} wide={panel === "scene"} onClose={() => setPanel(null)}>
      {panel === "presentation" && <><p className={styles.dialogIntro}>These choices shape the movie. The monitor stays fitted to the editing workspace.</p><div className={styles.settingsGrid}>
        <StudioSelect label="Aspect ratio" value={ratio} onChange={value => edit(() => setSettings({...settings,...geometry(value,Math.max(settings.width,settings.height))}))} options={[{value:"16:9",label:"Landscape · 16:9"},{value:"9:16",label:"Portrait · 9:16"},{value:"1:1",label:"Square · 1:1"}]} />
        <label className={styles.check}><input type="checkbox" checked={settings.reducedMotion} onChange={event => edit(() => setSettings({...settings,reducedMotion:event.target.checked}))} />Reduced motion</label>
        <label className={styles.check}><input type="checkbox" checked={settings.music} onChange={event => edit(() => setSettings({...settings,music:event.target.checked}))} />Music</label>
        {(["readingRate","thinkingRate","conversationGapMs","motionScale"] as const).map(key => <label key={key} className={styles.settingField}><span>{{readingRate:"Speech reading rate",thinkingRate:"Thought reading rate",conversationGapMs:"Conversation gap",motionScale:"Motion scale"}[key]}</span><small>{key === "conversationGapMs" ? "Milliseconds between conversations" : key === "motionScale" ? "Camera and fade duration multiplier" : "1× is the game default; higher reads faster"}</small><div><input aria-label={key} type="number" min={key === "conversationGapMs" ? 0 : .1} step={key === "conversationGapMs" ? 50 : .1} value={settings.profile[key] ?? ""} placeholder={key === "conversationGapMs" ? "Game default" : "1.0"} onChange={event => setTiming(key,event.target.value)} /><span>{key === "conversationGapMs" ? "ms" : "×"}</span><button onClick={() => setTiming(key,"")}>Reset</button></div></label>)}
      </div></>}
      {panel === "cut" && <><p className={styles.dialogIntro}>Include moments whose saved tags match exactly. Thinking and speech are separate choices.</p><div className={styles.tagFields}><label>Tag key<input aria-label="Cut tag key" value={predicateKey} onChange={event => edit(() => setPredicateKey(event.target.value))} /></label><label>Value<input aria-label="Cut tag value" value={predicateValue} onChange={event => edit(() => setPredicateValue(event.target.value))} /></label></div>{selectionError && <p role="alert" className={styles.warning}>{selectionError}</p>}<div className={styles.checks}><label className={styles.check}><input type="checkbox" checked={includeOpening} disabled={!visibleMoments.some(moment => moment.kind === "opening")} onChange={event => edit(() => setIncludeOpening(event.target.checked))} />Add episode opening</label><label className={styles.check}><input type="checkbox" checked={includeResult} disabled={!visibleMoments.some(moment => moment.kind === "result")} onChange={event => edit(() => setIncludeResult(event.target.checked))} />Add game result</label></div><p className={styles.dialogIntro}>Optional opening/result additions need no matching tag. {selectedIds.length} moments in this cut · {clock(cutDuration,settings.fps)}.</p><div className={styles.actions}><button disabled={!!selectionError} className={styles.primary} onClick={() => {changeView("cut"); setPanel(null);}}>Watch selected cut</button><button disabled={refreshing} onClick={() => void refreshTags()}>Refresh saved tags</button>{cutNeedsReview && <button onClick={() => {changeView("cut"); setCutNeedsReview(false); setPanel(null);}}>Review refreshed cut</button>}</div></>}
      {panel === "recordings" && <><p className={styles.dialogIntro}>Choose an existing speech manifest and its audio files together. Speaker, text and alignment must match accepted speech exactly. Audio stays in this browser; use the same files for local export.</p><label className={styles.settingField}>Speech manifest and audio<input aria-label="Import local recordings" type="file" multiple accept=".json,audio/*,.wav,.mp3,.m4a,.ogg" disabled={importing} onChange={event => {const files=[...(event.target.files ?? [])]; event.target.value=""; if (files.length) void importRecordings(files);}} /></label>{importing && <p role="status">Validating the complete permitted speech manifest…</p>}{speechImport && <><p>{speechImport.value.bindings.size} recording references imported. No audio is uploaded.</p><button onClick={() => edit(() => setSpeechImport(null))}>Remove local recordings</button></>}</>}
      {panel === "export" && <><p className={styles.dialogIntro}>{selectedIds.length} saved moments · {ratio} · {clock(cutDuration,settings.fps)}. Export uses the reviewed presentation and pinned visuals.</p><div className={styles.settingsGrid}><StudioSelect label="Output size" value={String(Math.max(settings.width,settings.height))} onChange={value => edit(() => setSettings({...settings,...geometry(ratio,Number(value))}))} options={[{value:"640",label:"640 pixels · draft"},{value:"1280",label:"1280 pixels · HD"},{value:"1920",label:"1920 pixels · full HD"}]} /><StudioSelect label="Frames per second" value={String(settings.fps)} onChange={value => edit(() => setSettings({...settings,fps:Number(value)}))} options={[{value:"24",label:"24 fps"},{value:"30",label:"30 fps"},{value:"60",label:"60 fps"}]} /></div><div className={styles.exportSummary}><strong>{settings.width} × {settings.height} / {settings.fps} fps</strong><p>The downloaded JSON freezes exact moments, visuals and presentation settings. Run local export against the source API; browser sign-in opens when needed. A prepared bundle renders offline.</p>{exportCommand && <code>{exportCommand}</code>}</div>
        {game.status === "suspended" && <p className={styles.warning}>Paused games preview a fixed accepted prefix. Local export requires a completed game.</p>}{view !== "cut" && <button onClick={() => changeView("cut")}>Watch selected cut</button>}{cutConflict && <p role="alert" className={styles.warning}>Saved tags changed after this cut was reviewed. Refresh saved tags and review the refreshed cut before downloading.</p>}{cutNeedsReview && <button onClick={() => {changeView("cut"); setCutNeedsReview(false); setPanel(null);}}>Review refreshed cut</button>}{(cutConflict || cutNeedsReview) && <button disabled={refreshing} onClick={() => void refreshTags()}>Refresh saved tags</button>}{selectionError && <p role="alert" className={styles.warning}>{selectionError}</p>}
        {selectionOperation?.phase === "unknown" && <div role="alert" className={styles.warning}><strong>Export response unavailable</strong><p>Your exact request is retained. Retry it before starting another export; later cut changes do not replace this request.</p><button onClick={() => void freeze(true)}>Retry exact export request</button></div>}
        <button className={styles.primary} disabled={view !== "cut" || !base || !selectedIds.length || !!selectionError || cutConflict || cutNeedsReview || game.status !== "completed" || selectionOperation?.phase === "submitting" || selectionOperation?.phase === "unknown"} onClick={() => void freeze()}>{selectionOperation?.phase === "submitting" ? "Freezing selection…" : "Download selected export"}</button>
      </>}
      {panel === "scene" && <><ProductionSceneInspector game={game} source={loaded} audience={audience} contextSceneId={contextSceneId} onOpenGameTools={() => {setPanel(null); onOpenGameTools();}} /><div className={styles.actions}><button disabled={refreshing} onClick={() => void refreshPublished()}>Refresh published visuals</button><button onClick={() => {setPanel(null); onOpenGameTools();}}>Game production and recovery</button></div><p className={styles.dialogIntro}>Publishing and gameplay resume are separate. Refresh explicitly to use published visuals at the same source boundary.</p></>}
      {refreshing && <p role="status">Refreshing the pinned source snapshot…</p>}{notice && <p role="status" className={styles.status}>{notice}</p>}
    </StudioDialog>}
  </>;
}

function MomentInspector({gameId, audience, thinking, loaded, moment, annotation, onSaved, onPin}: {gameId: string; audience: string; thinking: boolean; loaded: LoadedProductionSource; moment: ProductionMoment; annotation: MomentAnnotation; onSaved: (annotation: MomentAnnotation) => void; onPin: () => void}) {
  const session = useAdminSession(), root = productionGameRoot(gameId), operationKey = `operation:${root}/moments/${moment.id}/annotation`;
  const [operation] = useAdminValue<Operation | undefined>(operationKey, undefined);
  const initialDraft = useRef({revision: annotation.revision, rows: Object.entries(annotation.tags)}).current;
  const [draft, setDraft] = useAdminValue<{revision: number; rows: [string, string][] }>(`draft:${root}:${audience}:moment:${moment.id}`, initialDraft);
  const [error, setError] = useState<string | null>(null), [conflict, setConflict] = useState<MomentAnnotation | null>(null);
  const locked = operation?.phase === "submitting" || operation?.phase === "unknown";
  const cue = loaded.presentation.find(item => item.id === moment.id)?.segments[0], text = moment.kind === "thinking" ? cue?.timing.thinking : cue?.speech?.text;
  async function save(revision = draft.revision) {
    onPin(); setError(null);
    try {
      if (new Set(draft.rows.map(([key]) => key)).size !== draft.rows.length) throw new Error("Tag keys must be unique");
      const tags = validateProductionTags(Object.fromEntries(draft.rows));
      const result = await session.execute<MomentAnnotation>(operationKey, `${root}/moments/${encodeURIComponent(moment.id)}/annotation`, {snapshot: loaded.snapshot, audience, thinking, expectedRevision: revision, tags});
      if (result) {onSaved(result); setDraft({revision: result.revision, rows: Object.entries(result.tags)}); setConflict(null);}
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409 && failure.payload?.current) {const current = failure.payload.current as MomentAnnotation; if (current.momentId === moment.id) {setConflict(current); onSaved(current);}}
      setError(message(failure));
    }
  }
  return <><div className={styles.propertiesBody} onFocusCapture={event => {if (event.target instanceof HTMLInputElement) onPin();}}>
    <div className={styles.propertyTitle}><span className={styles.kind} data-kind={moment.kind}>{moment.kind}</span><h3>{momentName(cue) ?? moment.kind}</h3></div>
    <p className={styles.provenance}>{moment.source.kind}{"eventSequence" in moment.source ? ` · event ${moment.source.eventSequence}` : "transcriptId" in moment.source ? ` · response ${moment.source.transcriptId}` : ""}</p><p className={styles.fullText}>{text ?? "This moment presents accepted game facts or staging."}</p>
    <div className={styles.tagHeading}><h3>Moment tags</h3><span>Thinking and speech save independently</span></div>
    <div className={styles.tagRows}>{draft.rows.map(([key,value],index) => <div className={styles.tagRow} key={index}><label>Key<input aria-label={`Tag key ${index+1}`} disabled={locked} value={key} onChange={event => setDraft({...draft,rows:draft.rows.map((row,at) => at===index ? [event.target.value,row[1]] : row)})} /></label><label>Value<input aria-label={`Tag value ${index+1}`} disabled={locked} value={value} onChange={event => setDraft({...draft,rows:draft.rows.map((row,at) => at===index ? [row[0],event.target.value] : row)})} /></label><button aria-label={`Remove tag ${index+1}`} disabled={locked} onClick={() => {onPin();setDraft({...draft,rows:draft.rows.filter((_,at) => at!==index)});}}>×</button></div>)}</div>
    {operation?.phase === "unknown" && <p role="alert" className={styles.warning}>The save response is unavailable. Retry the exact saved tag request before changing this draft.</p>}{error && <p role="alert" className={styles.warning}>{error}</p>}{conflict && <div className={styles.warning}><strong>Another edit was saved</strong><p>Saved: {Object.entries(conflict.tags).map(([key,value]) => `${key}=${value}`).join(" · ") || "No tags"}</p><p>Your draft remains above.</p><button disabled={locked} onClick={() => {onPin();setDraft({revision:conflict.revision,rows:Object.entries(conflict.tags)});setConflict(null);setError(null);}}>Use saved tags</button><button disabled={locked} onClick={() => void save(conflict.revision)}>Retry my draft at revision {conflict.revision}</button></div>}
    </div><div className={styles.propertiesFoot}><span>Saved revision {annotation.revision}. Drafts stay local.</span><button disabled={locked || draft.rows.length>=32} onClick={() => {onPin();setDraft({...draft,rows:[...draft.rows,["cut","youtube"]]});}}>Add tag</button><button className={styles.primary} disabled={operation?.phase === "submitting"} onClick={() => void save()}>{operation?.phase === "submitting" ? "Saving…" : operation?.phase === "unknown" ? "Retry exact tag request" : "Save tags"}</button></div>
  </>;
}
