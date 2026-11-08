"use client";
import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { apiFetchMedia, resolveApiUrl } from "@/lib/api";
/** Draft bytes require owner authentication; accepted assets use the same stable source URL. */
export function OwnedCharacterImage({
  src,
  alt,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string }) {
  const [loaded, setLoaded] = useState<{ source: string; url: string } | null>(
      null,
    ),
    [failed, setFailed] = useState<string | null>(null);
  const privateSource = src.includes("/api/agent-profiles/images/");
  useEffect(() => {
    if (!privateSource) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const path = new URL(src, window.location.origin).pathname;
    void apiFetchMedia(path, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ source: src, url: objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(src);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, privateSource]);
  if (privateSource && (!loaded || loaded.source !== src))
    return failed === src ? (
      <p role="alert">Image unavailable</p>
    ) : (
      <span role="status">Loading image…</span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- original pixels preserve crop and full-body coordinates
    <img
      {...props}
      alt={alt}
      src={privateSource ? loaded!.url : resolveApiUrl(src)}
    />
  );
}
