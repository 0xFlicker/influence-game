import {
  formatPresentationMetadata,
  type LaunchFormatId,
} from "@influence/engine/format-presentation-metadata";

export function ActiveFormatLabel({
  formatId,
}: {
  formatId: LaunchFormatId;
}) {
  const metadata = formatPresentationMetadata(formatId);
  return (
    <div
      data-active-format={formatId}
      aria-label={`Active format: ${metadata.displayName}`}
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-cyan-200/25 bg-cyan-300/[0.08] px-3 py-1.5 text-left"
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-200 shadow-[0_0_12px_rgba(165,243,252,0.75)]"
      />
      <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-100/55">
        Active format
      </span>
      <span className="min-w-0 break-words text-xs font-semibold text-cyan-50">
        {metadata.displayName}
      </span>
    </div>
  );
}
