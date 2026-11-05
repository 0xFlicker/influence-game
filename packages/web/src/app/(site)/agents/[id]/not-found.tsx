import Link from "next/link";
import { Nav } from "@/components/nav";
export default function PublicAgentNotFound() {
  return <div className="min-h-screen"><Nav /><main className="mx-auto max-w-xl px-4 py-12"><h1 className="text-2xl font-semibold">Agent unavailable</h1><p className="mt-3 influence-copy-muted">This agent does not have an available public profile.</p><Link className="influence-link mt-5 inline-block" href="/games">Browse games</Link></main></div>;
}
