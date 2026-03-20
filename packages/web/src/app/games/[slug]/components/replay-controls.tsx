"use client";

export function ReplayControls({
  current,
  total,
  onPrev,
  onNext,
  onFirst,
  onLast,
}: {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
}) {
  const btnCls =
    "text-xs border border-white/10 hover:border-white/25 text-white/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed";
  return (
    <div className="flex items-center gap-2 justify-center py-3 border-t border-white/10">
      <button onClick={onFirst} disabled={current === 0} className={btnCls}>
        ⏮
      </button>
      <button onClick={onPrev} disabled={current === 0} className={btnCls}>
        ←
      </button>
      <span className="text-xs text-white/30 px-2">
        {current + 1} / {total}
      </span>
      <button onClick={onNext} disabled={current >= total - 1} className={btnCls}>
        →
      </button>
      <button onClick={onLast} disabled={current >= total - 1} className={btnCls}>
        ⏭
      </button>
    </div>
  );
}
