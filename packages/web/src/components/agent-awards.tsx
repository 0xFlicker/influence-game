"use client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { PublicAward } from "@/lib/championship";
import { AwardShelf } from "./award-shelf";

export function AgentAwards({ agentId }: { agentId: string }) {
  const { data, isError } = useQuery({ queryKey: ["agent-awards", agentId], queryFn: () => apiFetch<{ awards: PublicAward[] }>(`/api/awards/agents/${encodeURIComponent(agentId)}`) });
  if (isError) return <p role="status" className="text-sm influence-copy-muted">Awards could not be loaded.</p>;
  return <AwardShelf awards={data?.awards ?? []} />;
}
