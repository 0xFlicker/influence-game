"use client";
import { useEffect } from "react";

/** Initial HTML retains social metadata; browsers enter the normal full app. */
export function ShareDestination({path}: {path: string}) {
  useEffect(() => { window.location.replace(path); }, [path]);
  return <main className="p-8 text-white"><a href={path}>Open in the House</a></main>;
}
