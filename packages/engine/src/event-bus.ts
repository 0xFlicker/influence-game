/**
 * Influence Game - Event Bus
 *
 * RxJS-based pub/sub for in-process game events and messages.
 * No ElizaOS dependency.
 */

import { Subject, Observable, filter } from "rxjs";
import type { GameEvent, AgentAction, GameMessage, UUID } from "./types";

export class GameEventBus {
  private readonly _events$ = new Subject<GameEvent>();
  private readonly _actions$ = new Subject<AgentAction>();
  private readonly _messages$ = new Subject<GameMessage>();

  /** Observable stream of all game events (House → agents) */
  get events$(): Observable<GameEvent> {
    return this._events$.asObservable();
  }

  /** Observable stream of all agent actions (agents → House) */
  get actions$(): Observable<AgentAction> {
    return this._actions$.asObservable();
  }

  /** Observable stream of all messages (for logging/transcript) */
  get messages$(): Observable<GameMessage> {
    return this._messages$.asObservable();
  }

  /** Emit a game event (from House) */
  emitEvent(event: GameEvent): void {
    this._events$.next(event);
  }

  /** Submit an agent action (from agent) */
  submitAction(action: AgentAction): void {
    this._actions$.next(action);
  }

  /** Log a message to the transcript */
  logMessage(message: GameMessage): void {
    this._messages$.next(message);
  }

  /**
   * Wait for all agents to submit a specific action type within a timeout.
   * Returns the collected actions (may be fewer than expected if timeout fires).
   */
  collectActions<T extends AgentAction>(
    actionType: T["type"],
    expectedAgentIds: UUID[],
    timeoutMs: number,
  ): Promise<T[]> {
    return new Promise((resolve) => {
      const collected = new Map<UUID, T>();
      const remaining = new Set(expectedAgentIds);

      const sub = this._actions$
        .pipe(filter((a) => a.type === actionType))
        .subscribe((action) => {
          const typed = action as T;
          if (remaining.has((typed as { from: UUID }).from)) {
            remaining.delete((typed as { from: UUID }).from);
            collected.set((typed as { from: UUID }).from, typed);
            if (remaining.size === 0) {
              clearTimeout(timer);
              sub.unsubscribe();
              resolve(Array.from(collected.values()));
            }
          }
        });

      const timer = setTimeout(() => {
        sub.unsubscribe();
        resolve(Array.from(collected.values()));
      }, timeoutMs);
    });
  }

  /**
   * Wait for a single action from a specific agent within a timeout.
   * Returns null if timeout fires before the action arrives.
   */
  waitForAction<T extends AgentAction>(
    actionType: T["type"],
    agentId: UUID,
    timeoutMs: number,
  ): Promise<T | null> {
    return new Promise((resolve) => {
      const sub = this._actions$
        .pipe(
          filter(
            (a) =>
              a.type === actionType &&
              (a as { from: UUID }).from === agentId,
          ),
        )
        .subscribe((action) => {
          clearTimeout(timer);
          sub.unsubscribe();
          resolve(action as T);
        });

      const timer = setTimeout(() => {
        sub.unsubscribe();
        resolve(null);
      }, timeoutMs);
    });
  }

  complete(): void {
    this._events$.complete();
    this._actions$.complete();
    this._messages$.complete();
  }
}
