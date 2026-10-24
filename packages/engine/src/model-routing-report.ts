export interface ModelRoutingObservation {
  decision?: boolean;
  actorId: string; preferredCatalogId: string; actualCatalogId: string; accepted: boolean; failure?: string;
  estimatedCostMicrousd?: number | null; actualCostMicrousd?: number | null;
}

export function summarizeModelRouting(observations: ModelRoutingObservation[]) {
  const actors = new Map<string, { actorId: string; preferredCatalogId: string; accepted: number; preferred: number; failedAttempts: number;
    actualRoutes: Record<string, number>; failures: Record<string, number>; estimatedCostMicrousd: number; actualCostMicrousd: number; unpricedAttempts: number }>();
  for (const row of observations) {
    let actor = actors.get(row.actorId);
    if (!actor) { actor = { actorId: row.actorId, preferredCatalogId: row.preferredCatalogId, accepted: 0, preferred: 0, failedAttempts: 0, actualRoutes: {}, failures: {}, estimatedCostMicrousd: 0, actualCostMicrousd: 0, unpricedAttempts: 0 }; actors.set(row.actorId, actor); }
    if (row.accepted && row.decision !== false) {
      actor.accepted++; actor.preferred += Number(row.actualCatalogId === row.preferredCatalogId);
      actor.actualRoutes[row.actualCatalogId] = (actor.actualRoutes[row.actualCatalogId] ?? 0) + 1;
    } else if (!row.accepted) { actor.failedAttempts++; actor.failures[row.failure ?? "unresolved"] = (actor.failures[row.failure ?? "unresolved"] ?? 0) + 1; }
    actor.estimatedCostMicrousd += row.estimatedCostMicrousd ?? 0;
    actor.actualCostMicrousd += row.actualCostMicrousd ?? 0;
    if (row.estimatedCostMicrousd == null && row.actualCostMicrousd == null) actor.unpricedAttempts++;
  }
  return [...actors.values()].map(actor => ({ ...actor, preferredRouteShare: actor.accepted ? actor.preferred / actor.accepted : null,
    preferredRouteShareLabel: actor.accepted ? `${actor.preferred}/${actor.accepted}` : "No accepted model decisions" }));
}
