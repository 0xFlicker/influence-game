"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getAuthToken, resolveApiUrl } from "@/lib/api";

interface BannerAsset { id: string; altText: string; revision: number }

/** Only the results route mounts this component. Identity changes remount its loader. */
export function GameBanner({ gameId }: { gameId: string }) {
  const auth = useAuth();
  if (!auth.ready) return null;
  const token = auth.authenticated ? getAuthToken() : null;
  return <ResultsBanner key={`${gameId}:${auth.account?.id ?? "anonymous"}:${token ?? ""}`} gameId={gameId} token={token} />;
}

export function ResultsBanner({ gameId, token }: { gameId: string; token: string | null }) {
  const [image, setImage] = useState<{ url: string; alt: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let mounted = true;
    let controller: AbortController | undefined;
    let objectUrl: string | undefined;
    const base = `/api/games/${encodeURIComponent(gameId)}/assets`;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    async function refresh() {
      controller?.abort();
      const current = new AbortController(); controller = current;
      const options = { headers, signal: current.signal, cache: "no-store" as const, redirect: "error" as const };
      try {
        const response = await fetch(resolveApiUrl(`${base}?label=banner&limit=100`), options);
        if (response.status === 404) {
          if (!mounted || current.signal.aborted) return;
          if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = undefined;
          if (mounted && !current.signal.aborted) { setImage(null); setFailed(false); }
          return;
        }
        if (!response.ok) throw new Error("Banner lookup failed");
        const { assets } = await response.json() as { assets: BannerAsset[] };
        const banner = assets[0];
        let nextUrl: string | undefined;
        if (banner) {
          const content = await fetch(resolveApiUrl(`${base}/${encodeURIComponent(banner.id)}/content`), options);
          if (!content.ok) throw new Error("Banner download failed");
          const blob = await content.blob();
          if (mounted && !current.signal.aborted) nextUrl = URL.createObjectURL(blob);
        }
        if (!mounted || current.signal.aborted) { if (nextUrl) URL.revokeObjectURL(nextUrl); return; }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = nextUrl;
        setImage(nextUrl && banner ? { url: nextUrl, alt: banner.altText } : null); setFailed(false);
      } catch {
        if (mounted && !current.signal.aborted) {
          // Clear stale pixels when a replacement, deletion, or game-access change fails the refresh.
          if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = undefined;
          setImage(null); setFailed(true);
        }
      }
    }
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { mounted = false; controller?.abort(); window.removeEventListener("focus", onFocus); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [gameId, token, retry]);
  if (!image && !failed) return null;
  return <div className="mb-6" data-testid="game-results-banner">
    {image && (
      // eslint-disable-next-line @next/next/no-img-element -- API-delivered bytes use a revocable blob URL.
      <img src={image.url} alt={image.alt} className="max-h-[32rem] w-full rounded-lg object-contain" />
    )}
    {failed && <button type="button" onClick={() => setRetry((value) => value + 1)} className="text-sm text-[rgb(var(--text-secondary))]">Retry banner</button>}
  </div>;
}
