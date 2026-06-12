import type {
  CanonicalEventEnvelope,
  CanonicalEventSource,
  CanonicalEventVisibility,
  CanonicalGameEvent,
  CanonicalGameEventType,
  CanonicalSourcePointer,
} from "./canonical-events";
import { assertCanonicalGameEvent } from "./canonical-events";
import type { Phase, UUID } from "./types";

export type CanonicalEventListener = (event: CanonicalGameEvent) => void;

function cloneCanonicalEvent(event: CanonicalGameEvent): CanonicalGameEvent {
  return structuredClone(event) as CanonicalGameEvent;
}

export interface CanonicalEventDraft<
  TType extends CanonicalGameEventType = CanonicalGameEventType,
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  gameId: UUID;
  round: number;
  phase: Phase | null;
  type: TType;
  payload: TPayload;
  timestamp: string;
  source?: CanonicalEventSource;
  visibility?: CanonicalEventVisibility;
  sourcePointers?: CanonicalSourcePointer[];
}

export interface CanonicalEventSubscriptionOptions {
  replayExisting?: boolean;
}

export class CanonicalEventLog {
  private readonly events: CanonicalGameEvent[] = [];
  private readonly listeners = new Set<CanonicalEventListener>();

  get nextSequence(): number {
    return this.events.length + 1;
  }

  append<
    TType extends CanonicalGameEventType,
    TPayload extends Record<string, unknown>,
  >(draft: CanonicalEventDraft<TType, TPayload>): CanonicalGameEvent {
    const event: CanonicalEventEnvelope<TType, TPayload> = {
      sequence: this.nextSequence,
      gameId: draft.gameId,
      round: draft.round,
      phase: draft.phase,
      type: draft.type,
      timestamp: draft.timestamp,
      source: draft.source ?? "engine",
      visibility: draft.visibility ?? "producer",
      payloadVersion: 1,
      sourcePointers: draft.sourcePointers ?? [],
      payload: draft.payload,
    };

    assertCanonicalGameEvent(event);
    this.events.push(event);
    for (const listener of this.listeners) {
      try {
        listener(cloneCanonicalEvent(event));
      } catch (error) {
        console.warn(
          `[canonical-event-log] listener error on event="${event.type}":`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    return cloneCanonicalEvent(event);
  }

  list(): readonly CanonicalGameEvent[] {
    return this.events.map(cloneCanonicalEvent);
  }

  subscribe(
    listener: CanonicalEventListener,
    options: CanonicalEventSubscriptionOptions = {},
  ): () => void {
    this.listeners.add(listener);
    if (options.replayExisting) {
      for (const event of this.events) listener(cloneCanonicalEvent(event));
    }
    return () => {
      this.listeners.delete(listener);
    };
  }
}
