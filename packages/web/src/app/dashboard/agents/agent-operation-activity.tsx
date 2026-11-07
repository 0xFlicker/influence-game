"use client";
import { useEffect, useState } from "react";
import styles from "./agent-workspace.module.css";
const labels: Record<string, string> = {
  image: "Generating image",
  background: "Removing background",
  portrait: "Preparing portrait",
  waiting: "Queued",
  upload: "Uploading image",
};
export function AgentOperationActivity({
  stage,
  startedAt,
}: {
  stage: string;
  startedAt: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = startedAt
    ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
    : null;
  return (
    <div className={styles.activity}>
      <p role="status">{labels[stage] ?? "Preparing image"}</p>
      {seconds !== null && (
        <small aria-hidden="true">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}{" "}
          elapsed
        </small>
      )}
    </div>
  );
}
