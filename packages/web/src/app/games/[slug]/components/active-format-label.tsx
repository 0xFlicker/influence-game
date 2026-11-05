import {
  formatPresentationMetadata,
  type LaunchFormatId,
} from "@influence/engine/format-presentation-metadata";

export function ActiveFormatLabel({
  formatId,
  onOpen,
  compact = false,
}: {
  formatId: LaunchFormatId;
  onOpen?: () => void;
  compact?: boolean;
}) {
  const metadata = formatPresentationMetadata(formatId);
  const content = <>
    {!compact && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-200 shadow-[0_0_12px_rgba(165,243,252,0.75)]" />}
    {!compact && <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-100/55">Active format</span>}
    <span className="min-w-0 break-words text-xs font-semibold text-cyan-50">{metadata.displayName}</span>
    <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-cyan-100/60 text-[10px] font-bold">i</span>
  </>;
  const style = "inline-flex max-w-full items-center gap-2 rounded-full border border-cyan-200/40 bg-black/85 px-3 py-1.5 text-left shadow-lg";
  if (onOpen) return <button type="button" data-active-format={formatId} data-replay-controls aria-label={`Read ${metadata.displayName} format rules`}
    aria-haspopup="dialog" title="Read format rules" onClick={onOpen} className={`${style} focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-100`}>{content}</button>;
  return (
    <div
      data-active-format={formatId}
      aria-label={`Active format: ${metadata.displayName}`}
      className={style}
    >
      {content}
    </div>
  );
}

/** Shared overlay; it does not change the scene's available geometry. */
export function ActiveFormatOverlay({formatId, onOpen}: {formatId: LaunchFormatId; onOpen?: () => void}) {
  return <div data-active-format-overlay className="absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-20 max-w-[calc(100%-1.5rem)]"><ActiveFormatLabel formatId={formatId} onOpen={onOpen} compact /></div>;
}
