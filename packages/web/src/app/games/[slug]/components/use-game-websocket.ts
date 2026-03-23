"use client";

import { useEffect, useRef, useState } from "react";
import type { WsGameEvent } from "@/lib/api";
import type { ConnStatus } from "./types";

let WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3000";

/** Called by RuntimeConfigProvider once runtime config is fetched. */
export function setWsBase(url: string): void {
  WS_BASE = url;
}

export function useGameWebSocket(
  gameId: string,
  enabled: boolean,
  onEvent: (ev: WsGameEvent) => void,
): ConnStatus {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let retryDelay = 1000;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;

      const ws = new WebSocket(`${WS_BASE}/ws/games/${gameId}`);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        retryDelay = 1000;
        setStatus("live");
      };

      ws.onclose = () => {
        if (cancelled) return;
        // Add ±10% jitter to avoid thundering herd when multiple viewers reconnect
        const jitter = retryDelay * 0.1 * (Math.random() * 2 - 1);
        const delay = retryDelay + jitter;
        setStatus("reconnecting");
        retryTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30_000);
          connect();
        }, delay);
      };

      ws.onerror = (event) => {
        console.warn(`[useGameWebSocket] WebSocket error for game ${gameId}:`, event);
        // onclose always follows onerror — let onclose handle status transition & reconnect
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as WsGameEvent;
          onEventRef.current(data);
        } catch (err) {
          console.warn(`[useGameWebSocket] Malformed WebSocket frame for game ${gameId}:`, err, ev.data);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      wsRef.current?.close();
    };
  }, [gameId, enabled]);

  return status;
}
