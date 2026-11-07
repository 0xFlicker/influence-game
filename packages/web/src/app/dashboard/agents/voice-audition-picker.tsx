"use client";
import { useEffect, useRef, useState, useId } from "react";
import {
  PLAYER_VOICES,
  VOICE_AUDITION_VERSION,
} from "@influence/engine/voice-catalog";
import { apiFetchMedia } from "@/lib/api";
import { captureProductEvent } from "@/lib/product-analytics";
import styles from "./agent-workspace.module.css";
export function AgentVoicePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [playing, setPlaying] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const id = useId(),
    root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const player = useRef<HTMLAudioElement | null>(null),
    url = useRef<string | null>(null),
    epoch = useRef(0);
  function stop() {
    epoch.current++;
    player.current?.pause();
    player.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setPlaying(null);
  }
  useEffect(
    () => () => {
      epoch.current++;
      player.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        stop();
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stop();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    root.current?.querySelector("input")?.focus();
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  async function audition(id: string) {
    stop();
    if (playing === id) return;
    captureProductEvent("agent_voice_audition_played", { voice_id: id });
    const request = epoch.current;
    setPlaying(id);
    setError(null);
    try {
      const blob = await apiFetchMedia(
        `/api/agent-profiles/voice-samples/${VOICE_AUDITION_VERSION}/${id}`,
      );
      if (request !== epoch.current) return;
      url.current = URL.createObjectURL(blob);
      const audio = new Audio(url.current);
      player.current = audio;
      audio.onended = () => {
        if (request === epoch.current) stop();
      };
      await audio.play();
    } catch (cause) {
      if (request === epoch.current) {
        stop();
        setError(
          cause instanceof Error ? cause.message : "Sample could not play",
        );
      }
    }
  }
  return (
    <div ref={root} className={styles.voice}>
      <label htmlFor={id}>Voice</label>
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={id + "-options"}
        onClick={() => {
          stop();
          setOpen(!open);
        }}
      >
        {PLAYER_VOICES.find((voice) => voice.id === value)?.name ?? "Automatic"}{" "}
        ⌄
      </button>
      {open && (
        <div
          id={id + "-options"}
          className={styles.voiceMenu}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              stop();
              setOpen(false);
            }
          }}
        >
          <input
            aria-label="Find a voice"
            placeholder="Find a voice…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              stop();
              onChange(null);
              setOpen(false);
            }}
          >
            Automatic
          </button>
          {PLAYER_VOICES.filter((voice) =>
            voice.name.toLowerCase().includes(query.toLowerCase()),
          ).map((voice) => (
            <div key={voice.id} className={styles.voiceOption}>
              <button
                type="button"
                aria-pressed={value === voice.id}
                onClick={() => {
                  stop();
                  onChange(voice.id);
                  setOpen(false);
                }}
              >
                {voice.name}
              </button>
              <button
                type="button"
                aria-label={`${playing === voice.id ? "Stop" : "Play"} ${voice.name}`}
                onClick={() => void audition(voice.id)}
              >
                {playing === voice.id ? "Stop" : "Play"}
              </button>
            </div>
          ))}
          <p className={styles.hint}>
            “Every promise matters. Let&apos;s see who keeps theirs.”
          </p>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
