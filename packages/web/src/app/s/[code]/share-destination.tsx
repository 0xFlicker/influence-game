"use client";
import { useEffect } from "react";
import { SHARE_OPEN_QUERY } from "@/lib/share-attribution";

/** Initial HTML retains social metadata; browsers enter the normal full app. */
export function ShareDestination({ path, openTicket }: { path: string; openTicket?: string }) {
  useEffect(() => {
    const destination = new URL(path, location.origin);
    if (openTicket) destination.searchParams.set(SHARE_OPEN_QUERY, openTicket);
    window.location.replace(destination);
  }, [path, openTicket]);
  return <main className="p-8 text-white"><a href={path}>Open in the House</a></main>;
}
