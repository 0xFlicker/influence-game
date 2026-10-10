"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductionPresentationSettings } from "@influence/engine/production-moments/settings";
import { ProductionSceneInspector } from "./production-scenes";
import { PRODUCTION_LABELS, THINKING_LABELS, SPEECH_LABELS, productionLabelKey, selectProductionMoments, validateProductionTags, type ProductionMoment, type ProductionRecipe, type ProductionMomentKind } from "@influence/engine/production-moments";
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
import {StudioCutRules, initialRecipe, recipeSummary} from "./studio-cut-rules";
import {StudioWorkspaceLayout} from "./studio-workspace-layout";
import {StudioShortcutHints} from "./studio-shortcut-hints";
import {allowsStudioShortcut, matchStudioShortcut, studioLayerOpen, studioSaveChord, studioShortcutProps} from "./studio-shortcuts";
import {Nav} from "@/components/nav";
import {ADMIN_ENTRIES, permitsAdminEntry} from "../admin-sections";
import styles from "./workspace.module.css";
import "../../games/episodes.css";


const initialSettings: ProductionPresentationSettings = {width: 1280, height: 720, fps: 30, reducedMotion: false, music: true, volume: .3, profile: parseTimingProfile()};
const panelTitles = {presentation:"Presentation",recordings:"Local recordings",export:"Export selected cut",cut:"Selected cut rule",scene:"Scene versions & production",tools:"Studio tools",navigation:"The House navigation",source:"Source settings",keyboard:"Keyboard hints"};
const characterPreference = "house.studio.character-shortcuts.v1";
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
  const [episode, setEpisode] = useState(false), [trailer, setTrailer] = useState(false), [tools, setTools] = useState(false), [episodeTools, setEpisodeTools] = useState(false), [navigation, setNavigation] = useState(false);
  const sourceGeneration = useRef(0);
  function changeScope(next: string) {
    if (next === audience) return;
    sourceGeneration.current++;
    session.clearMatching(key => key.startsWith("draft:") && key.includes(root));
    const filter = {predicate: (query: {queryKey: readonly unknown[]}) => query.queryKey[0] === "admin" && query.queryKey[1] === session.scope && String(query.queryKey[2]).startsWith(`${root}/source`)};
    void client.cancelQueries(filter); client.removeQueries(filter);
    const query = new URLSearchParams(params); query.set("audience", next); query.delete("moment"); query.delete("scene"); query.delete("version"); query.delete("thinking"); router.replace(`/admin/production/games/${encodeURIComponent(game.id)}?${query}`);
  }
  const identity = <div className={styles.identity}><Link href={`/admin/production?${library}`} aria-label="Back to production library">←</Link><div><h1>{game.title ?? game.slug}</h1><p>{game.gameKind === "werewolf" ? "Werewolf" : "Influence"} · {game.status === "suspended" ? "Paused accepted prefix" : game.status === "completed" ? "Completed episode" : `Game visual operations · ${game.status.replaceAll("_", " ")}`}</p></div></div>;
  const gameActions = <>{game.capabilities.episodeEdit && episodeEdit && <button onClick={() => {setEpisodeTools(false); setEpisode(true);}}>Episode presentation</button>}{game.capabilities.trailerRead && episodeRead && <button onClick={() => {setEpisodeTools(false); setTrailer(true);}}>Trailer & poster</button>}{visualRead && <button onClick={() => {setEpisodeTools(false); setTools(true);}}>Game production and recovery</button>}</>;
  return <section className={styles.studio} data-production-workspace>
    {editorial && !blocked && <>
      <MomentWorkspace key={`${game.id}:${audience}`} game={game} audience={audience} thinking={thinking} readScopeGeneration={() => sourceGeneration.current} identity={identity} onOpenEpisodeTools={() => setEpisodeTools(true)} onOpenGameTools={() => setTools(true)} scopeControls={<>{game.gameKind === "werewolf" && <StudioSelect label="Production audience" value={audience} onChange={changeScope} options={[{value:"mystery",label:"Mystery"},{value:"omniscient",label:"Omniscient"}]} />}{audience !== "mystery" && <label className={styles.check}><input aria-label="Play thinking in Source" type="checkbox" checked={thinking} onChange={event => {const query = new URLSearchParams(params); query.set("thinking", event.target.checked ? "on" : "off"); query.delete("moment"); router.replace(`/admin/production/games/${encodeURIComponent(game.id)}?${query}`, {scroll:false});}} /> Play thinking in Source</label>}</>} />
    </>}
    {(!editorial || blocked) && <><header className={styles.commandBar}>{identity}<div className={styles.commands}>{gameActions}<button onClick={() => setNavigation(true)}>Navigation</button></div></header><div className={styles.sourceProgress}>{blocked ? <p role="alert">Production access changed. Private editing data has been cleared. Refresh to check current permissions.</p> : <p>Use the game production tools available to your current permissions.</p>}</div></>}
    {navigation && <StudioDialog title="The House navigation" onClose={() => setNavigation(false)}><StudioNavigation /></StudioDialog>}
    {episodeTools && <StudioDialog title="Episode tools" onClose={() => setEpisodeTools(false)}><div className={styles.actions}>{gameActions}</div></StudioDialog>}
    {visualRead && tools && <StudioDialog title="Game production and recovery" wide onClose={() => setTools(false)}>{game.gameKind === "influence" && (influenceRecovery || !editorial) ? <VisualOperations gameId={game.id} hideIndependentMedia={editorial} /> : <GameProductionRecovery gameId={game.id} />}</StudioDialog>}
    {episode && game.capabilities.episodeEdit && episodeEdit && <EpisodeEditor gameId={game.id} onClose={() => setEpisode(false)} onSaved={async () => {await client.invalidateQueries({queryKey: ["admin", session.scope, root]});}} />}
    {trailer && game.capabilities.trailerRead && episodeRead && <AdminPostgameMediaPanel game={{id: game.id, slug: game.slug}} canManage={game.capabilities.trailerRender && episodeEdit} onClose={() => setTrailer(false)} />}
  </section>;
}

function MomentWorkspace({game, audience, thinking, readScopeGeneration, identity, scopeControls, onOpenEpisodeTools, onOpenGameTools}: {game: ProductionLibraryGame; audience: "public" | "mystery" | "omniscient"; thinking: boolean; readScopeGeneration: () => number; identity: ReactNode; scopeControls: ReactNode; onOpenEpisodeTools: () => void; onOpenGameTools: () => void}) {
  const params = useSearchParams(), router = useRouter(), session = useAdminSession(), client = useQueryClient();
  // Load the complete authorized catalog once. Thinking visibility selects
  // from that pin; it must not request newer history or published visuals.
  const sourceThinking = audience !== "mystery";
  const root = productionGameRoot(game.id), scope = `${root}/source?audience=${audience}&thinking=${sourceThinking ? "on" : "off"}`;
  const [blocked] = useAdminValue(`access-denied:${root}`, false);
  const [settings, setSettings] = useState(initialSettings), [saved, setSaved] = useState<Record<string, MomentAnnotation>>({});
  const [selection, setSelection] = useState<ProductionRecipe>(() => initialRecipe(sourceThinking));
  const [notice, setNotice] = useState<string | null>(null), [refreshing, setRefreshing] = useState(false);
  const [exportCommand, setExportCommand] = useState<string | null>(null);
  const [panel, setPanel] = useState<"presentation" | "recordings" | "export" | "cut" | "scene" | "tools" | "navigation" | "source" | "keyboard" | null>(null);
  const [search, setSearch] = useState(""), [mobilePanel, setMobilePanel] = useState("moments");
  const [characterShortcuts, setCharacterShortcuts] = useState(true);
  const [focusRequest, setFocusRequest] = useState<"search" | "tags" | null>(null);
  const searchInput = useRef<HTMLInputElement>(null), propertiesNode = useRef<HTMLElement>(null);
  const capturedPointers = useRef(new Map<number, Element[]>());
  const [typeFilter, setTypeFilter] = useState("all");
  const [layoutReset, setLayoutReset] = useState(0);
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
  const settlementGeneration = useRef(readScopeGeneration()).current;
  const assetCaches = useRef(new Map<string, {assets: Map<string, CachedAsset>; urls: Map<string, string>}>());
  useEffect(() => {alive.current = true; const pointers = capturedPointers.current; return () => {alive.current = false; pointers.clear();};}, []);
  useEffect(() => {try {setCharacterShortcuts(localStorage.getItem(characterPreference) !== "off");} catch (error) {setNotice(`Keyboard preference unavailable: ${message(error)}`);}}, []);
  useLayoutEffect(() => {
    if (!focusRequest) return;
    if (focusRequest === "search") searchInput.current?.focus({preventScroll:true});
    else {
      const metadata = propertiesNode.current?.querySelector<HTMLDetailsElement>("details");
      if (metadata) {metadata.open = true; const target = metadata.querySelector<HTMLElement>('input:not(:disabled),[data-add-tag]:not(:disabled)'); (target ?? propertiesNode.current)?.focus({preventScroll:true});}
    }
    setFocusRequest(null);
  }, [focusRequest,mobilePanel]);
  function setCharacterPreference(enabled: boolean) {
    setCharacterShortcuts(enabled);
    try {localStorage.setItem(characterPreference,enabled ? "on" : "off");} catch (error) {setNotice(`Keyboard preference lasts for this workspace only: ${message(error)}`);}
  }
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
  const base = useMemo<ReplayManifest | null>(() => loaded && all && assets ? {schema: "house.replay-export", version: 2, game: {id: game.id, slug: game.slug, kind: game.gameKind, ...(audience !== "public" ? {audience} : {})}, ...settings, thinking: view === "source" ? thinking : sourceThinking, cues: all.cues, timeline: all.timeline, audio: all.audio, assets, staticFiles: {}, boundary: {eventSequence: loaded.snapshot.throughEventSequence, cursor: loaded.snapshot.throughCursor, publicationCutoff: loaded.snapshot.publicationCutoff}, range: {fromFrame: 0, untilFrame: Math.ceil(all.audio.durationMs * settings.fps / 1000)}, revision: `${loaded.snapshot.sourceHash}:${speechImport?.id ?? "no-recordings"}`, dirty: false} : null, [loaded, all, assets, settings, game.id, game.slug, game.gameKind, audience, thinking, sourceThinking, view, speechImport]);
  const visibleMoments = useMemo(() => loaded?.catalog.moments ?? [], [loaded]);
  const inspected = visibleMoments.find(moment => moment.id === (following ? activeId : pinnedId)) ?? visibleMoments.find(moment => moment.id === params.get("moment")) ?? visibleMoments[0];
  const presentationById = useMemo(() => new Map(loaded?.presentation.map(moment => [moment.id, moment]) ?? []), [loaded]);
  const contextPicture = inspected ? presentationById.get(inspected.id)?.segments[0]?.picture : undefined;
  const contextSceneId = contextPicture?.kind === "werewolf" || contextPicture?.kind === "thinking" ? contextPicture.scene?.id : contextPicture?.kind === "influence" && contextPicture.beat?.kind === "scene" ? contextPicture.beat.sceneId : null;
  const visiblePresentation = useMemo(() => {const visible = new Set(visibleMoments.filter(moment => view !== "source" || thinking || moment.kind !== "thinking").map(moment => moment.id)); return attachedPresentation?.filter(moment => visible.has(moment.id));}, [attachedPresentation, visibleMoments, view, thinking]);
  const sourceTimings = useMemo(() => all && attachedPresentation && assets && view === "source" && !thinking ? compilePresentation({source: attachedPresentation, selectedIds: visibleMoments.map(moment => moment.id), profile: settings.profile, fps: settings.fps, assets, music:false, volume:0}) : all, [all, attachedPresentation, assets, view, thinking, visibleMoments, settings.profile, settings.fps]);
  const timingById = useMemo(() => new Map(sourceTimings?.moments.map(moment => [moment.id, moment])), [sourceTimings]);
  const cutTiming = useMemo(() => attachedPresentation && assets ? view === "cut" ? all : compilePresentation({source: attachedPresentation,selectedIds:stableSelectedIds,profile:settings.profile,fps:settings.fps,assets,music:settings.music,volume:settings.volume}) : null, [view,all,attachedPresentation,stableSelectedIds,settings.profile,settings.fps,settings.music,settings.volume,assets]);
  const cutDuration = Math.ceil((cutTiming?.audio.durationMs ?? 0) * settings.fps / 1000);
  const browsable = visibleMoments.filter(moment => view === "source" || stableSelectedIds.includes(moment.id));
  const listed = browsable.filter(moment => (typeFilter === "all" || typeFilter === "other" && !["speech", "thinking"].includes(moment.kind) || moment.kind === typeFilter) && (() => {const cue = presentationById.get(moment.id)?.segments[0]; return `${momentName(cue)} ${cue?.label} ${cue?.timing.thinking ?? ""} ${cue?.speech?.text ?? ""}`.toLowerCase().includes(search.toLowerCase());})());
  const onActiveMomentChange = useCallback((state: {momentId: string | null; view: "source" | "cut"; revision: string}) => {if (state.view === view && state.revision === base?.revision) setActiveId(state.momentId);}, [view,base?.revision]);
  useEffect(() => {if (following && activeId) rows.current.get(activeId)?.scrollIntoView({block:"nearest"});}, [following, activeId]);
  function navigate(key: string, value: string) {const next = new URLSearchParams(params); next.set(key, value); router.replace(`/admin/production/games/${encodeURIComponent(game.id)}?${next}`, {scroll: false});}
  function edit(action: () => void) {preview.current?.pauseAndRetainAnchor(); action();}
  function changeView(next: "source" | "cut") {edit(() => navigate("view", next)); setSearch(""); setFollowing(true); setMobilePanel("moments");}
  function followCurrentMoment() {setFollowing(true);}
  function keyboardAvailable() {
    // A divider acquires native capture during pointermove, before React's next
    // gotpointercapture event. Register the two drag surfaces on down (including
    // the divider's expanded hit area) and read native capture directly.
    for (const [id, targets] of capturedPointers.current) if (targets.every(target => !target.isConnected)) capturedPointers.current.delete(id);
    return alive.current && !blocked && session.active && readScopeGeneration() === settlementGeneration && !Array.from(capturedPointers.current).some(([id,targets]) => targets.some(target => target.isConnected && target.hasPointerCapture(id)));
  }
  function handleShortcut(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!keyboardAvailable() || event.defaultPrevented || !(event.target instanceof Element) || studioLayerOpen(document) || !allowsStudioShortcut(event.target,event.key)) return;
    const binding = matchStudioShortcut(event.nativeEvent,characterShortcuts);
    if (!binding || binding.id !== "help" && !loaded) return;
    const command = binding.id;
    switch (command) {
      case "source": changeView("source"); break;
      case "cut": changeView("cut"); break;
      case "search": preview.current?.pauseAndRetainAnchor(); setPinnedId(activeId ?? inspected?.id ?? null); setFollowing(false); setMobilePanel("moments"); setFocusRequest("search"); break;
      case "tags": if (!inspected) return; preview.current?.pauseAndRetainAnchor(); setPinnedId(inspected.id); setFollowing(false); setMobilePanel("properties"); setFocusRequest("tags"); break;
      case "follow": followCurrentMoment(); break;
      case "export": openPanel("export"); break;
      case "help": openPanel("keyboard"); break;
      default: if (!preview.current?.runShortcut(command)) return;
    }
    event.preventDefault();
  }
  function inspectMoment(id: string) {setPinnedId(id); setFollowing(false); seekMoment(id,"content"); const next = new URLSearchParams(params); next.set("moment",id); next.delete("scene"); next.delete("version"); router.replace(`/admin/production/games/${encodeURIComponent(game.id)}?${next}`,{scroll:false});}
  function seekMoment(id: string, at: "start" | "content" = "start") {
    const moment = visibleMoments.find(moment => moment.id === id);
    if (view === "source" && moment?.kind === "thinking" && !thinking) {preview.current?.pauseAndRetainAnchor(); setNotice("Thinking is not playing in Source. Enable Play thinking in Source in Source settings to seek it."); return;}
    if (view === "cut" && !stableSelectedIds.includes(id)) {preview.current?.pauseAndRetainAnchor(); setNotice("This moment is omitted from the selected cut. Switch to Source to seek it."); return;}
    anchor.current = at === "content" ? {momentId:id,at} : {momentId:id,offsetMs:0}; preview.current?.seekMoment(id,at); setPinnedId(id); setFollowing(at === "start"); setNotice(null);
  }
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
  const header = <header className={styles.commandBar}>{identity}<div className={styles.commands}><div className={styles.segmented}><button {...studioShortcutProps("source",characterShortcuts)} aria-pressed={view === "source"} onClick={() => changeView("source")}>Source</button><button {...studioShortcutProps("cut",characterShortcuts)} aria-pressed={view === "cut"} onClick={() => changeView("cut")}>Selected cut</button></div><button aria-label="Cut rules" title={recipeSummary(selection)} disabled={!loaded} onClick={() => openPanel("cut")}><span className={styles.cutRulesPrefix}>Cut </span>rules</button><button onClick={() => openPanel("tools")}>Tools</button><button {...studioShortcutProps("export",characterShortcuts)} disabled={!loaded} className={styles.primary} onClick={() => openPanel("export")}>Export…</button><button aria-label="The House navigation" title="The House navigation" onClick={() => openPanel("navigation")}>☰</button></div></header>;
  const tools = <div className={styles.actions}><button disabled={!loaded} onClick={() => openPanel("presentation")}>Presentation</button><button disabled={!loaded} onClick={() => openPanel("recordings")}>Recordings</button><button onClick={() => openPanel("source")}>Source settings</button><button onClick={() => openPanel("keyboard")}>Keyboard hints</button><button onClick={() => {preview.current?.pauseAndRetainAnchor(); setPanel(null); onOpenEpisodeTools();}}>Episode tools</button><button onClick={() => openPanel("scene")}>Scene versions…</button><button onClick={() => {localStorage.removeItem("house.studio.moments-width"); setLayoutReset(value => value + 1); setNotice("Workspace layout reset. Export geometry is unchanged.");}}>Reset layout</button></div>;
  const hints = <StudioShortcutHints characters={characterShortcuts} onCharactersChange={setCharacterPreference} />;
  if (!loaded) return <div className={styles.editingWorkspace} data-studio-shortcuts onKeyDown={handleShortcut}>{header}<div className={styles.sourceProgress}>{query.error ? <><p role="alert">{message(query.error)} <button onClick={() => void query.refetch()}>Retry source</button></p><button onClick={() => openPanel("scene")}>Scene versions…</button></> : <p role="status">Loading the complete accepted source prefix and media metadata…</p>}</div>{panel && <StudioDialog title={panelTitles[panel]} wide={panel === "scene"} onClose={() => setPanel(null)}>{panel === "scene" ? <ProductionSceneInspector game={game} audience={audience} onOpenGameTools={() => {setPanel(null); onOpenGameTools();}} /> : panel === "navigation" ? <StudioNavigation /> : panel === "source" ? scopeControls : panel === "keyboard" ? hints : tools}</StudioDialog>}</div>;
  const ratio = settings.width === settings.height ? "1:1" : settings.width < settings.height ? "9:16" : "16:9";
  const browser = <section className={styles.browser} aria-label="Source moment browser">
        <div className={styles.browserHeading}><h2>{view === "source" ? "Source moments" : "Cut moments"}</h2></div>
        <div className={styles.typeFilters} aria-label="Moment type filters">{["all", "thinking", "speech", "other"].map(kind => <button key={kind} aria-pressed={typeFilter === kind} onClick={() => setTypeFilter(kind)}>{kind === "all" ? "All" : kind === "thinking" ? "Thinking" : kind === "speech" ? "Speech" : "Other"}<span>{browsable.filter(moment => kind === "all" || kind === "other" && !["speech", "thinking"].includes(moment.kind) || moment.kind === kind).length}</span></button>)}</div>
        {typeFilter === "thinking" && <p className={styles.browserNote}>{audience === "mystery" ? "Thinking is unavailable in Mystery. Use Omniscient to edit private thoughts." : !browsable.some(moment => moment.kind === "thinking") ? view === "cut" ? "No thinking matches this cut. Browse Source to label thoughts." : "No accepted thinking is available in this source." : !thinking && view === "source" ? "Thinking is visible here, but not playing in Source. Enable it in Source settings to seek." : "Thinking is separate from speech. Labels save independently."}{audience === "mystery" && <button onClick={() => openPanel("source")}>Audience settings</button>}</p>}
        <div className={styles.search}><input ref={searchInput} {...studioShortcutProps("search",characterShortcuts)} aria-label="Find a moment" placeholder="Find a moment, speaker or phrase" value={search} onChange={event => setSearch(event.target.value)} /><span>{view === "source" ? `${listed.length} moments` : `${selectedIds.length} in cut · ${clock(cutDuration, settings.fps)}`}</span></div>
        <div className={styles.listHead}><span>Moment</span><span>Duration</span><span>Cut</span></div>
        <div className={styles.momentList}>{listed.length ? listed.map(moment => {
          const cue = presentationById.get(moment.id)?.segments[0], timing = timingById.get(moment.id), text = moment.kind === "thinking" ? cue?.timing.thinking : cue?.speech?.text;
          const labels = Object.entries(PRODUCTION_LABELS).filter(([label]) => annotations[moment.id]?.[`label.${label}`] === "true").map(([,name]) => name);
          return <div key={moment.id} className={styles.momentRow} data-moment-id={moment.id} data-active={activeId === moment.id}>
          <button ref={element => {if (element) rows.current.set(moment.id,element); else rows.current.delete(moment.id);}} className={styles.moment} aria-pressed={inspected?.id === moment.id} data-active={activeId === moment.id} onClick={() => inspectMoment(moment.id)}>
            <span className={styles.momentCopy}><span className={styles.kind} data-kind={moment.kind}>{moment.kind}</span><strong>{momentName(cue) ?? moment.kind}</strong><small>{text ?? cue?.label ?? moment.kind}</small>{labels.length > 0 && <span className={styles.savedLabels}>{labels.join(" · ")}</span>}</span><span className={styles.duration}>{clock(timing ? timing.endFrame - timing.startFrame : 0, settings.fps)}</span><span className={styles.cutTag}>{stableSelectedIds.includes(moment.id) ? "Included" : "—"}</span>
          </button><button className={styles.seekMoment} aria-label="Seek to moment" title="Seek to moment start and recenter timeline" onClick={() => seekMoment(moment.id)}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 1v5m0 8v5M1 10h5m8 0h5" stroke="currentColor" strokeWidth="1.5"/></svg></button></div>;
        }) : <div className={styles.empty}><h3>{view === "cut" ? "No matching moments" : "No matches"}</h3><p>{selectionError ?? (view === "cut" ? "Choose content types and labels in Cut rules, or label moments in Source." : "Try another type, speaker or phrase.")}</p><button onClick={() => {changeView("source"); setTypeFilter("all"); setSearch("");}}>Browse source</button></div>}</div>
        <div className={styles.browserFoot}><span>Click to see content · Target to start</span><button onClick={() => changeView("cut")}>Watch cut →</button></div>
      </section>;
  const properties = <aside ref={propertiesNode} tabIndex={-1} className={styles.properties} aria-label="Moment properties" data-selected-moment={inspected?.id}>
        <div className={styles.sectionHeading}><h2>Moment properties</h2>{following ? <span>Follows current moment</span> : <button {...studioShortcutProps("follow",characterShortcuts)} onClick={followCurrentMoment}>Follow current moment</button>}<button onClick={() => openPanel("scene")}>Scene versions…</button></div>
        {inspected && <MomentInspector key={inspected.id} gameId={game.id} audience={audience} thinking={sourceThinking} loaded={loaded} moment={inspected} keyboardAvailable={keyboardAvailable} annotation={saved[inspected.id] ?? loaded.annotations.find(item => item.momentId === inspected.id) ?? {momentId: inspected.id, tags: {}, revision: 0}} isCurrentWorkspace={() => alive.current && readScopeGeneration() === settlementGeneration} onPin={() => {setPinnedId(inspected.id); setFollowing(false); preview.current?.pauseAndRetainAnchor();}} onSaved={annotation => {setSaved(previous => ({...previous, [annotation.momentId]: annotation}));}} />}
      </aside>;
  const panelControls = <nav className={styles.mobileTabs} aria-label="Editor panels"><button aria-pressed={mobilePanel === "moments"} onClick={() => setMobilePanel("moments")}>Moments</button><button aria-pressed={mobilePanel === "properties"} onClick={() => setMobilePanel("properties")}>Properties</button><span>{audience === "mystery" ? "Mystery" : audience === "omniscient" ? "Omniscient" : "Influence"}</span><button onClick={() => openPanel("source")}>Source settings</button></nav>;
  const renderLayout = (monitor: ReactNode, transport: ReactNode) => <StudioWorkspaceLayout browser={browser} properties={properties} monitor={monitor} transport={transport} mobilePanel={mobilePanel} panelControls={panelControls} resetSignal={layoutReset} />;
  return <div className={styles.editingWorkspace} data-studio-shortcuts onKeyDown={handleShortcut} onPointerDown={event => capturedPointers.current.set(event.pointerId,Array.from(event.currentTarget.querySelectorAll('[role="separator"],[role="slider"]')))} onPointerUp={event => capturedPointers.current.delete(event.pointerId)} onPointerCancel={event => capturedPointers.current.delete(event.pointerId)} onGotPointerCapture={event => {if (event.target instanceof Element) capturedPointers.current.set(event.pointerId,[event.target]);}} onLostPointerCapture={event => capturedPointers.current.delete(event.pointerId)}>
    {header}
    {base && attachedPresentation && all ? <ProductionPreview ref={preview} compiled={all} onActiveMomentChange={onActiveMomentChange} readAnchor={readAnchor} onAnchorChange={retainAnchor} playback={playback} onPlaybackChange={setPlayback} base={base} source={visiblePresentation!} selectedIds={stableSelectedIds} view={view} onViewChange={changeView} renderLayout={renderLayout} onOpenHints={() => openPanel("keyboard")} characterShortcuts={characterShortcuts} keyboardAvailable={keyboardAvailable} emptyLabel={selectionError ?? "No moments match these type and label choices. Label source moments or change Cut rules."} /> : renderLayout(
      <section className={styles.monitor} aria-label="Playable preview"><div className={styles.sectionHeading}><h2>{view === "source" ? "Source preview" : "Selected cut"}</h2></div><div className={styles.monitorStage}><div className={styles.empty}>{recordings.error ? <p role="alert">{message(recordings.error)} <button onClick={() => void recordings.refetch()}>Retry local recordings</button></p> : media.error ? <p role="alert">{message(media.error)} <button onClick={() => void media.refetch()}>Retry selected media</button></p> : <p role="status">Preparing media for {view === "source" ? "source preview" : "selected cut"}…</p>}</div></div></section>, <section className={styles.timelinePanel}><p className={styles.statusLine}>Preparing the intended preview. Seek to a moment to retain its position.</p></section>)}
    {notice && <div className={styles.statusLine} role="status" title={notice}>{notice}</div>}
    {panel && <StudioDialog title={panelTitles[panel]} wide={panel === "scene"} onClose={() => setPanel(null)}>
      {panel === "tools" && tools}
      {panel === "keyboard" && hints}
      {panel === "navigation" && <StudioNavigation />}
      {panel === "source" && <><p className={styles.dialogIntro}>Source pinned at event {loaded.snapshot.throughEventSequence}{loaded.snapshot.throughCursor ? ` / audience cursor ${loaded.snapshot.throughCursor}` : ""}. Visuals stay pinned until explicitly refreshed.</p><div className={styles.checks} onChangeCapture={() => preview.current?.pauseAndRetainAnchor()}>{scopeControls}</div><p className={styles.dialogIntro}>{audience === "mystery" ? "Thinking is unavailable in Mystery. Use Omniscient to edit private thoughts." : "Source playback choices do not change cut rules or browser filters. Changing audience reads a different authorized source and clears private editing data."}</p></>}
      {panel === "presentation" && <><p className={styles.dialogIntro}>These choices shape the movie. The monitor stays fitted to the editing workspace.</p><div className={styles.settingsGrid}>
        <StudioSelect label="Aspect ratio" value={ratio} onChange={value => edit(() => setSettings({...settings,...geometry(value,Math.max(settings.width,settings.height))}))} options={[{value:"16:9",label:"Landscape · 16:9"},{value:"9:16",label:"Portrait · 9:16"},{value:"1:1",label:"Square · 1:1"}]} />
        <label className={styles.check}><input type="checkbox" checked={settings.reducedMotion} onChange={event => edit(() => setSettings({...settings,reducedMotion:event.target.checked}))} />Reduced motion</label>
        <label className={styles.check}><input type="checkbox" checked={settings.music} onChange={event => edit(() => setSettings({...settings,music:event.target.checked}))} />Music</label>
        {(["readingRate","thinkingRate","conversationGapMs","motionScale"] as const).map(key => <label key={key} className={styles.settingField}><span>{{readingRate:"Speech reading rate",thinkingRate:"Thought reading rate",conversationGapMs:"Conversation gap",motionScale:"Motion scale"}[key]}</span><small>{key === "conversationGapMs" ? "Milliseconds between conversations" : key === "motionScale" ? "Camera and fade duration multiplier" : "1× is the game default; higher reads faster"}</small><div><input aria-label={key} type="number" min={key === "conversationGapMs" ? 0 : .1} step={key === "conversationGapMs" ? 50 : .1} value={settings.profile[key] ?? ""} placeholder={key === "conversationGapMs" ? "Game default" : "1.0"} onChange={event => setTiming(key,event.target.value)} /><span>{key === "conversationGapMs" ? "ms" : "×"}</span><button onClick={() => setTiming(key,"")}>Reset</button></div></label>)}
      </div></>}
      {panel === "cut" && <><StudioCutRules recipe={selection} onChange={next => edit(() => setSelection(next))} kinds={[...new Set(visibleMoments.map(moment => moment.kind))] as ProductionMomentKind[]} />{selectionError && <p role="alert" className={styles.warning}>{selectionError}</p>}<p className={styles.dialogIntro}>{recipeSummary(selection)}. {selectedIds.length} moments in this cut · {clock(cutDuration,settings.fps)}.</p><div className={styles.actions}><button disabled={!!selectionError} className={styles.primary} onClick={() => {changeView("cut"); setPanel(null);}}>Watch selected cut</button><button disabled={refreshing} onClick={() => void refreshTags()}>Refresh saved tags</button>{cutNeedsReview && <button onClick={() => {changeView("cut"); setCutNeedsReview(false); setPanel(null);}}>Review refreshed cut</button>}</div></>}
      {panel === "recordings" && <><p className={styles.dialogIntro}>Choose an existing speech manifest and its audio files together. Speaker, text and alignment must match accepted speech exactly. Audio stays in this browser; use the same files for local export.</p><label className={styles.settingField}>Speech manifest and audio<input aria-label="Import local recordings" type="file" multiple accept=".json,audio/*,.wav,.mp3,.m4a,.ogg" disabled={importing} onChange={event => {const files=[...(event.target.files ?? [])]; event.target.value=""; if (files.length) void importRecordings(files);}} /></label>{importing && <p role="status">Validating the complete permitted speech manifest…</p>}{speechImport && <><p>{speechImport.value.bindings.size} recording references imported. No audio is uploaded.</p><button onClick={() => edit(() => setSpeechImport(null))}>Remove local recordings</button></>}</>}
      {panel === "export" && <><p className={styles.dialogIntro}>{selectedIds.length} saved moments · {ratio} · {clock(cutDuration,settings.fps)}. Export uses the reviewed presentation and pinned visuals.</p><div className={styles.settingsGrid}><StudioSelect label="Output size" value={String(Math.max(settings.width,settings.height))} onChange={value => edit(() => setSettings({...settings,...geometry(ratio,Number(value))}))} options={[{value:"640",label:"640 pixels · draft"},{value:"1280",label:"1280 pixels · HD"},{value:"1920",label:"1920 pixels · full HD"}]} /><StudioSelect label="Frames per second" value={String(settings.fps)} onChange={value => edit(() => setSettings({...settings,fps:Number(value)}))} options={[{value:"24",label:"24 fps"},{value:"30",label:"30 fps"},{value:"60",label:"60 fps"}]} /></div><div className={styles.exportSummary}><strong>{settings.width} × {settings.height} / {settings.fps} fps</strong><p>The downloaded JSON freezes exact moments, visuals and presentation settings. Run local export against the source API; browser sign-in opens when needed. A prepared bundle renders offline.</p>{exportCommand && <code>{exportCommand}</code>}</div>
        {game.status === "suspended" && <p className={styles.warning}>Paused games preview a fixed accepted prefix. Local export requires a completed game.</p>}{view !== "cut" && <button onClick={() => changeView("cut")}>Watch selected cut</button>}{cutConflict && <p role="alert" className={styles.warning}>Saved tags changed after this cut was reviewed. Refresh saved tags and review the refreshed cut before downloading.</p>}{cutNeedsReview && <button onClick={() => {changeView("cut"); setCutNeedsReview(false); setPanel(null);}}>Review refreshed cut</button>}{(cutConflict || cutNeedsReview) && <button disabled={refreshing} onClick={() => void refreshTags()}>Refresh saved tags</button>}{selectionError && <p role="alert" className={styles.warning}>{selectionError}</p>}
        {selectionOperation?.phase === "unknown" && <div role="alert" className={styles.warning}><strong>Export response unavailable</strong><p>Your exact request is retained. Retry it before starting another export; later cut changes do not replace this request.</p><button onClick={() => void freeze(true)}>Retry exact export request</button></div>}
        <button className={styles.primary} disabled={view !== "cut" || !base || !selectedIds.length || !!selectionError || cutConflict || cutNeedsReview || game.status !== "completed" || selectionOperation?.phase === "submitting" || selectionOperation?.phase === "unknown"} onClick={() => void freeze()}>{selectionOperation?.phase === "submitting" ? "Freezing selection…" : "Download selected export"}</button>
      </>}
      {panel === "scene" && <><ProductionSceneInspector game={game} source={loaded} audience={audience} contextSceneId={contextSceneId} onOpenGameTools={() => {setPanel(null); onOpenGameTools();}} /><div className={styles.actions}><button disabled={refreshing} onClick={() => void refreshPublished()}>Refresh published visuals</button><button onClick={() => {setPanel(null); onOpenGameTools();}}>Game production and recovery</button></div><p className={styles.dialogIntro}>Publishing and gameplay resume are separate. Refresh explicitly to use published visuals at the same source boundary.</p></>}
      {refreshing && <p role="status">Refreshing the pinned source snapshot…</p>}{notice && <p role="status" className={styles.status}>{notice}</p>}
    </StudioDialog>}
  </div>;
}

function StudioNavigation() {
  const access = usePermissions();
  return <><Nav menu /><nav aria-label="Administration" className={styles.actions}>{ADMIN_ENTRIES.filter(entry => permitsAdminEntry(entry, access)).map(entry => <Link key={entry.href} href={entry.href}>{entry.label}</Link>)}</nav></>;
}

function MomentInspector({gameId, audience, thinking, loaded, moment, annotation, isCurrentWorkspace, keyboardAvailable, onSaved, onPin}: {gameId: string; audience: string; thinking: boolean; loaded: LoadedProductionSource; moment: ProductionMoment; annotation: MomentAnnotation; isCurrentWorkspace: () => boolean; keyboardAvailable: () => boolean; onSaved: (annotation: MomentAnnotation) => void; onPin: () => void}) {
  const session = useAdminSession(), root = productionGameRoot(gameId), operationKey = `operation:${root}/moments/${moment.id}/annotation`;
  const [operation] = useAdminValue<Operation | undefined>(operationKey, undefined);
  const initialDraft = useRef({revision: annotation.revision, rows: Object.entries(annotation.tags)}).current;
  const draftKey = `draft:${root}:${audience}:moment:${moment.id}`;
  const [draft, setDraft] = useAdminValue<{revision: number; rows: [string, string][] }>(draftKey, initialDraft);
  const [error, setError] = useAdminValue<string | null>(`${draftKey}:error`, null), [conflict, setConflict] = useAdminValue<MomentAnnotation | null>(`${draftKey}:conflict`, null);
  const locked = operation?.phase === "submitting" || operation?.phase === "unknown";
  const mac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
  const labels = moment.kind === "thinking" ? THINKING_LABELS : moment.kind === "speech" ? SPEECH_LABELS : [];
  const dirty = draft.rows.length !== Object.keys(annotation.tags).length || draft.rows.some(([key, value]) => annotation.tags[key] !== value);
  const cue = loaded.presentation.find(item => item.id === moment.id)?.segments[0], text = moment.kind === "thinking" ? cue?.timing.thinking : cue?.speech?.text;
  async function save(revision = draft.revision, rows = draft.rows, labelsOnly = false) {
    // Fast checkbox marking and explicit metadata Save share this exact
    // revision/unknown-outcome owner. A checkbox leaves other metadata in draft.
    const current = session.get<Operation>(operationKey);
    if (current?.phase === "submitting" || labelsOnly && (current?.phase === "unknown" || conflict)) return;
    onPin(); setDraft({revision, rows}); setError(null);
    try {
      const labelKeys = new Set(labels.map(productionLabelKey));
      let input: Record<string, unknown>;
      if (current?.phase === "unknown") input = current.body;
      else {
        const replacement = labelsOnly ? [...Object.entries(annotation.tags).filter(([key]) => !labelKeys.has(key)), ...rows.filter(([key]) => labelKeys.has(key))] : rows;
        if (new Set(replacement.map(([key]) => key)).size !== replacement.length) throw new Error("Tag keys must be unique");
        const tags = validateProductionTags(Object.fromEntries(replacement));
        input = {snapshot: loaded.snapshot, audience, thinking, expectedRevision: revision, tags};
      }
      const result = await session.execute<MomentAnnotation>(operationKey, `${root}/moments/${encodeURIComponent(moment.id)}/annotation`, input);
      // Session setters remain valid when another moment is inspected. Fence by
      // workspace/audience access instead of the transient Properties component.
      if (result && isCurrentWorkspace() && session.active && !session.get(`access-denied:${root}`)) {
        // Accepted checkbox values always come from the result, including an
        // exact retry after an audience switch cleared the old draft. Rebase
        // only pending custom metadata; keep unfinished/duplicate rows editable.
        const pending = rows.filter(([key,value]) => !labelKeys.has(key) && (annotation.tags[key] !== value || rows.filter(([otherKey]) => otherKey === key).length > 1));
        const removed = new Set(Object.keys(annotation.tags).filter(key => !labelKeys.has(key) && !rows.some(([draftKey]) => draftKey === key)));
        const settled = Object.entries(result.tags).filter(([key]) => !removed.has(key) && !pending.some(([draftKey]) => draftKey === key));
        onSaved(result); setDraft({revision: result.revision, rows: [...settled,...pending]}); setConflict(null);
      }
    } catch (failure) {
      if (!isCurrentWorkspace() || !session.active || session.get(`access-denied:${root}`)) return;
      if (failure instanceof ApiError && failure.status === 409 && failure.payload?.current) {const current = failure.payload.current as MomentAnnotation; if (current.momentId === moment.id) {setConflict(current); onSaved(current);}}
      setError(message(failure));
    }
  }
  return <div className={styles.inspector} onKeyDown={event => {if (keyboardAvailable() && isCurrentWorkspace() && session.active && !session.get(`access-denied:${root}`) && !studioLayerOpen(document) && studioSaveChord(event.nativeEvent,mac)) {event.preventDefault(); event.stopPropagation(); if (dirty && !locked && !conflict) void save();}}}><div className={styles.propertiesBody} onFocusCapture={event => {if (event.target instanceof HTMLInputElement) onPin();}}>
    <div className={styles.propertyTitle}><span className={styles.kind} data-kind={moment.kind}>{moment.kind}</span><h3>{momentName(cue) ?? moment.kind}</h3></div>
    {labels.length > 0 && <fieldset className={styles.labelChoices} disabled={locked || !!conflict}><legend>Labels for this {moment.kind}</legend>{labels.map(label => <label className={styles.check} key={label}><input type="checkbox" checked={draft.rows.some(([key,value]) => key === productionLabelKey(label) && value === "true")} onChange={event => {const rows = draft.rows.filter(([key]) => key !== productionLabelKey(label)); if (event.target.checked) rows.push([productionLabelKey(label), "true"]); void save(draft.revision, rows, true);}} />{PRODUCTION_LABELS[label]}</label>)}</fieldset>}
    <p className={styles.draftStatus} role="status">{operation?.phase === "submitting" ? "Saving labels…" : conflict ? "Labels conflict. Compare the saved edit before retrying." : operation?.phase === "unknown" ? "Save response unavailable. Retry the exact label request." : error ? "Changes are unsaved. Review the error and retry." : dirty ? "Unsaved changes. Choose Save labels to apply them." : "Checkbox labels save immediately. Thinking and speech save independently."}</p>
    <p className={styles.provenance}>{moment.source.kind}{"eventSequence" in moment.source ? ` · event ${moment.source.eventSequence}` : "transcriptId" in moment.source ? ` · response ${moment.source.transcriptId}` : ""}</p>
    <p className={styles.fullText}>{text ?? "This moment presents accepted game facts or staging."}</p>
    <details className={styles.metadata}><summary>Other metadata</summary>
    <div className={styles.tagHeading}><h3>Flat key/value tags</h3></div>
    <div className={styles.tagRows}>{draft.rows.map(([key,value],index) => <div className={styles.tagRow} key={index}><label>Key<input aria-label={`Tag key ${index+1}`} disabled={locked} value={key} onChange={event => setDraft({...draft,rows:draft.rows.map((row,at) => at===index ? [event.target.value,row[1]] : row)})} /></label><label>Value<input aria-label={`Tag value ${index+1}`} disabled={locked} value={value} onChange={event => setDraft({...draft,rows:draft.rows.map((row,at) => at===index ? [row[0],event.target.value] : row)})} /></label><button aria-label={`Remove tag ${index+1}`} disabled={locked} onClick={() => {onPin();setDraft({...draft,rows:draft.rows.filter((_,at) => at!==index)});}}>×</button></div>)}</div>
    <button data-add-tag disabled={locked || draft.rows.length>=32} onClick={() => {onPin();setDraft({...draft,rows:[...draft.rows,["",""]]});}}>Add tag</button></details>
    {operation?.phase === "unknown" && <p role="alert" className={styles.warning}>The save response is unavailable. Retry the exact saved request before changing this draft.</p>}{error && <p role="alert" className={styles.warning}>{error}</p>}{conflict && <div className={styles.warning}><strong>Another edit was saved</strong><p>Saved: {Object.entries(conflict.tags).map(([key,value]) => `${key}=${value}`).join(" · ") || "No labels or tags"}</p><p>Your draft remains above.</p><button disabled={locked} onClick={() => {onPin();setDraft({revision:conflict.revision,rows:Object.entries(conflict.tags)});setConflict(null);setError(null);}}>Use saved labels</button><button disabled={locked} onClick={() => void save(conflict.revision)}>Retry my draft at revision {conflict.revision}</button></div>}
    </div><div className={styles.propertiesFoot}><span role="status">Saved revision {annotation.revision} · {operation?.phase === "submitting" ? "Saving…" : conflict ? "Conflict" : operation?.phase === "unknown" ? "Response unavailable" : error ? "Save failed" : dirty ? "Unsaved draft" : "Saved"}</span><button aria-keyshortcuts={mac ? "Meta+Enter" : "Control+Enter"} title={`Save changed metadata (${mac ? "⌘" : "Ctrl"}+Enter)`} className={styles.primary} disabled={operation?.phase === "submitting" || (!!conflict && operation?.phase !== "unknown")} onClick={() => void save()}>{operation?.phase === "submitting" ? "Saving…" : operation?.phase === "unknown" ? "Retry exact label request" : "Save labels"}</button></div>
  </div>;
}
