"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAuthToken,
  type WsGameEvent,
  type WsPublicationEvent,
  type WsPublicationPayload,
  type WsViewerEvent,
} from "@/lib/api";
import type { ConnStatus } from "./types";

function browserWebSocketBase(): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

let WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ?? browserWebSocketBase();

/** Called by RuntimeConfigProvider once runtime config is fetched. */
export function setWsBase(url: string): void {
  WS_BASE = url;
}

/**
 * Orders the overlap between reconnect catch-up and live pub/sub delivery.
 * The server may send the same publication down both lanes, or live N+1 may
 * arrive before catch-up N. Only a contiguous, unseen suffix is released.
 */
export class GamePublicationBuffer {
  private readonly gameId: string;
  private readonly pending = new Map<number, WsPublicationEvent>();
  private appliedSequence: number;

  constructor(gameId: string, afterPublicationSequence = 0) {
    if (!Number.isSafeInteger(afterPublicationSequence) || afterPublicationSequence < 0) {
      throw new Error("afterPublicationSequence must be a non-negative safe integer");
    }
    this.gameId = gameId;
    this.appliedSequence = afterPublicationSequence;
  }

  get cursor(): number {
    return this.appliedSequence;
  }

  accept(event: WsPublicationEvent): WsPublicationPayload[] {
    if (event.gameId !== this.gameId) return [];
    if (!Number.isSafeInteger(event.publicationSequence) || event.publicationSequence < 1) {
      return [];
    }
    if (event.publicationSequence <= this.appliedSequence) return [];

    const pending = this.pending.get(event.publicationSequence);
    if (pending) {
      if (JSON.stringify(pending) !== JSON.stringify(event)) {
        throw new Error(
          `Conflicting publication ${this.gameId}:${event.publicationSequence}`,
        );
      }
      return [];
    }
    this.pending.set(event.publicationSequence, event);
    const ready: WsPublicationPayload[] = [];
    while (true) {
      const nextSequence = this.appliedSequence + 1;
      const next = this.pending.get(nextSequence);
      if (!next) break;
      this.pending.delete(nextSequence);
      this.appliedSequence = nextSequence;
      ready.push(next.payload);
    }
    return ready;
  }
}

export function useGameWebSocket(
  gameLocator: string,
  canonicalGameId: string,
  enabled: boolean,
  onEvent: (ev: WsViewerEvent) => void,
  initialPublicationSequence = 0,
): ConnStatus {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const publicationBuffer = useMemo(
    () => new GamePublicationBuffer(canonicalGameId, initialPublicationSequence),
    [canonicalGameId, initialPublicationSequence],
  );
  useEffect(() => { onEventRef.current = onEvent; });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let retryDelay = 1000;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;

      const token = getAuthToken();
      const url = new URL(`${WS_BASE}/ws/games/${gameLocator}`);
      url.searchParams.set(
        "afterPublicationSequence",
        String(publicationBuffer.cursor),
      );
      if (token) {
        url.searchParams.set("token", token);
      }
      const ws = new WebSocket(url.toString());
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
        console.warn(`[useGameWebSocket] WebSocket error for game ${canonicalGameId}:`, event);
        // onclose always follows onerror — let onclose handle status transition & reconnect
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as WsGameEvent;
          if (data.type === "publication") {
            for (const payload of publicationBuffer.accept(data)) {
              onEventRef.current(payload);
            }
            return;
          }
          onEventRef.current(data);
        } catch (err) {
          console.warn(`[useGameWebSocket] Malformed WebSocket frame for game ${canonicalGameId}:`, err, ev.data);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      wsRef.current?.close();
    };
  }, [gameLocator, canonicalGameId, enabled, publicationBuffer]);

  return status;
}
