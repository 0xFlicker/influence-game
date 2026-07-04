import { AllianceCardList, AllianceSummary } from "./match-watch-alliance-panel";
import type { CompletedAllianceArcsModel } from "./match-watch-alliance-model";

export function CompletedResultsAllianceArcs({
  model,
}: {
  model: CompletedAllianceArcsModel;
}) {
  return (
    <section id="alliance-arcs" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white/85">Alliance Arcs</h3>
          <p className="mt-1 text-xs leading-5 text-white/42">
            Named alliance proposals, huddles, and captured outcomes from the game.
          </p>
        </div>
        {model.status === "ready" ? (
          <span className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.14em] text-white/40">
            Public record
          </span>
        ) : null}
      </div>

      {model.status === "ready" ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <AllianceSummary
            proposalCount={model.summary.proposalCount}
            allianceCount={model.summary.allianceCount}
            huddleCount={model.summary.huddleCount}
            latestHuddleRound={model.summary.latestHuddleRound}
          />
          <AllianceCardList cards={model.cards} compact />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-white/45">
          {model.reason}
        </div>
      )}
    </section>
  );
}
