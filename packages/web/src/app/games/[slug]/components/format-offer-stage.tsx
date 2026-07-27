import {
  formatPresentationMetadata,
  type LaunchFormatId,
} from "@influence/engine/format-presentation-metadata";

export function FormatOfferStage({
  offeredFormatIds,
  selectedFormatId,
  revealRules,
  selectionStage = null,
  empoweredName,
}: {
  offeredFormatIds: readonly [LaunchFormatId, LaunchFormatId];
  selectedFormatId: LaunchFormatId | null;
  revealRules: boolean;
  selectionStage?: "choice_legible" | "rules_reveal" | null;
  empoweredName: string;
}) {
  return (
    <section
      data-format-cue={selectedFormatId ? "format_selected" : "format_menu"}
      aria-labelledby="format-offer-heading"
      className="mx-auto w-full max-w-4xl"
    >
      <div className="text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-100/45">
          Card Duel
        </p>
        <h2
          id="format-offer-heading"
          className="mt-2 text-2xl font-semibold text-white sm:text-3xl"
        >
          {selectedFormatId ? "Format selected" : "The House offers two formats"}
        </h2>
        <p className="mt-2 break-words text-sm text-white/50">
          {empoweredName} chooses the round format.
        </p>
      </div>

      <div
        role="group"
        aria-label="House format offer"
        className="mt-6 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2"
      >
        {offeredFormatIds.map((formatId) => {
          const metadata = formatPresentationMetadata(formatId);
          const cardState = !selectedFormatId
            ? "offered"
            : selectedFormatId === formatId
              ? "selected"
              : "unselected";
          const showsRules = revealRules && cardState === "selected";
          return (
            <article
              key={formatId}
              data-format-card={formatId}
              data-card-state={cardState}
              data-selection-stage={selectionStage ?? "offer"}
              data-unselected-fade={
                cardState !== "unselected"
                  ? "not-applicable"
                  : selectionStage === "rules_reveal"
                    ? "applied"
                    : "deferred"
              }
              tabIndex={0}
              aria-current={cardState === "selected" ? "true" : undefined}
              className={`min-w-0 rounded-xl border p-4 outline-none focus-visible:ring-2 focus-visible:ring-cyan-100/70 sm:p-5 ${
                cardState === "selected" && selectionStage === "rules_reveal"
                  ? "border-cyan-100/55 bg-cyan-200/[0.12] sm:col-span-2 sm:mx-auto sm:w-[min(100%,32rem)] sm:scale-[1.02]"
                  : cardState === "selected"
                    ? "border-cyan-100/55 bg-cyan-200/[0.12] sm:scale-[1.02]"
                  : cardState === "unselected" && selectionStage === "rules_reveal"
                    ? "border-white/[0.06] bg-white/[0.015] opacity-35"
                    : "border-white/15 bg-white/[0.04]"
              }`}
            >
              <p className="text-[9px] uppercase tracking-[0.18em] text-white/35">
                {cardState === "selected"
                  ? "Selected"
                  : cardState === "unselected"
                    ? "Not selected"
                    : "Offered format"}
              </p>
              <h3 className="mt-2 break-words text-xl font-semibold text-white sm:text-2xl">
                {metadata.displayName}
              </h3>
              {showsRules ? (
                <p
                  data-format-rules={formatId}
                  className="mt-4 border-t border-cyan-100/15 pt-4 text-sm leading-6 text-white/70"
                >
                  {metadata.conciseRules}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
