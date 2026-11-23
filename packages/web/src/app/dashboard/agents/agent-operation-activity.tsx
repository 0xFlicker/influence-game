"use client";
import { useEffect, useState } from "react";
import styles from "./agent-workspace.module.css";
const labels: Record<string, string> = {
  starting: "Starting image",
  image: "Generating image",
  background: "Removing background",
  portrait: "Preparing portrait",
  waiting: "Queued",
  upload: "Saving portrait",
  save: "Saving agent",
  entry_check: "Checking entry",
  join_game: "Joining game",
  join_queue: "Joining Daily Free",
  leave_queue: "Leaving Daily Free",
  switch_agent: "Switching agents",
  entry_review: "Profile in review",
};
export function AgentOperationActivity({
  stage,
  startedAt,
  indicator = false,
}: {
  stage: string;
  startedAt: string | null;
  indicator?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const seconds = startedAt
    ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
    : null;
  return (
    <span className={styles.operationSummary} data-indicator={indicator || undefined}>
      {indicator && <span className={styles.activityDot} aria-hidden="true" />}
      {labels[stage] ?? "Preparing image"}
      {seconds !== null && (
        <span aria-hidden="true">
          {" "}
          · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      )}
    </span>
  );
}
