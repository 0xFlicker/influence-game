import type { RetrospectiveOutcomeSource, RetrospectiveStateV1 } from "./retrospective";

/** Public progress from an already validated canonical prefix; never the private dossier. */
export interface RetrospectiveProgress {
  outcome: RetrospectiveOutcomeSource | null;
  status: "unavailable" | "pending" | "in_progress" | "completed";
  statementCount: number;
  requiredStatements: number;
  nextActorId: string | null;
}

export function retrospectiveProgress(
  outcome: RetrospectiveOutcomeSource | null,
  retrospective: RetrospectiveStateV1 | null,
  originalPlayerCount: number,
  executionCompleted = false,
): RetrospectiveProgress {
  const completed = retrospective?.completedAtEventSequence != null;
  // A completed game without an epilogue has nothing pending. Its outcome remains valid.
  const absent = executionCompleted && !retrospective;
  return {
    outcome,
    status: !outcome || absent ? "unavailable" : completed ? "completed" : retrospective ? "in_progress" : "pending",
    statementCount: retrospective?.statements.length ?? 0,
    requiredStatements: absent ? 0 : originalPlayerCount,
    nextActorId: retrospective && !completed
      ? retrospective.definition.speakerIds[retrospective.statements.length] ?? null : null,
  };
}
