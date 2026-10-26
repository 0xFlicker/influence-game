import type { RenderMediaProgress } from "@remotion/renderer";

type Progress = Pick<RenderMediaProgress, "progress" | "renderedDoneIn" | "stitchStage" | "renderEstimatedTime">;
type Output = { isTTY?: boolean; columns?: number; write(text: string): unknown };

function duration(milliseconds: number, roundUp = false) {
  const seconds = Math.max(0, (roundUp ? Math.ceil : Math.floor)(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A single terminal line; redirected logs get occasional plain-text milestones. */
export function createRenderProgress({ stream = process.stderr, now = () => performance.now() }: { stream?: Output; now?: () => number } = {}) {
  const started = now();
  let fraction = 0, stage = "Rendering", frameEstimate = 0;
  let lastPrinted = -Infinity, lastBucket = -1, closed = false;
  function draw(final?: boolean) {
    const time = now(), elapsed = time - started;
    const percent = Math.floor(fraction * 100), bucket = Math.floor(percent / 10);
    if (final === undefined && (stream.isTTY
      ? time - lastPrinted < 250
      : bucket === lastBucket && time - lastPrinted < 30_000)) return;
    const estimate = fraction > 0 && elapsed >= 3000
      ? Math.max(frameEstimate, elapsed * (1 - fraction) / fraction) : null;
    const remaining = final === true ? "00:00" : estimate === null ? "estimating…" : `~${duration(estimate, true)}`;
    const label = final === false ? "Stopped" : final === true ? "Rendered" : stage;
    const detail = `${percent}% | ${duration(elapsed)} elapsed | ${remaining} left`;
    const width = Math.min(24, Math.max(0, (stream.columns ?? 100) - label.length - detail.length - 5));
    const filled = Math.round(fraction * width);
    const bar = stream.isTTY && width >= 8 ? `[${"=".repeat(filled)}${"-".repeat(width - filled)}] ` : "";
    const line = `${label} ${bar}${detail}`;
    stream.write(`${stream.isTTY ? "\r\u001b[2K" : ""}${line}${!stream.isTTY || final !== undefined ? "\n" : ""}`);
    lastPrinted = time; lastBucket = bucket;
  }
  const timer = setInterval(() => draw(), 1000);
  timer.unref();
  const onExit = () => finish(false);
  process.once("exit", onExit);
  function finish(completed: boolean) {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    process.removeListener("exit", onExit);
    if (completed) fraction = 1;
    draw(completed);
  }
  draw();
  return {
    update(progress: Progress) {
      if (closed || !Number.isFinite(progress.progress)) return;
      fraction = Math.max(fraction, Math.min(1, Math.max(0, progress.progress)));
      stage = progress.stitchStage === "muxing" ? "Muxing" : progress.renderedDoneIn !== null ? "Encoding" : "Rendering";
      frameEstimate = progress.renderedDoneIn === null && Number.isFinite(progress.renderEstimatedTime)
        ? Math.max(0, progress.renderEstimatedTime) : 0;
      draw();
    },
    finish,
  };
}
