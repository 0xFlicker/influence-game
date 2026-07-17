export interface AgentAvatarPreviewState {
  hovered: boolean;
  focused: boolean;
  pinned: boolean;
  suppressed: boolean;
}

export type AgentAvatarPreviewEvent =
  | { type: "hover"; active: boolean }
  | { type: "focus"; active: boolean }
  | { type: "toggle-pin" }
  | { type: "dismiss" };

export type AgentAvatarPreviewStats =
  | {
      kind: "unavailable";
      message: "Current stats unavailable";
    }
  | {
      kind: "empty";
      message: "No games yet";
    }
  | {
      kind: "record";
      gamesPlayed: number;
      gamesWon: number;
      winRate: number;
    };

export function createAgentAvatarPreviewState(): AgentAvatarPreviewState {
  return {
    hovered: false,
    focused: false,
    pinned: false,
    suppressed: false,
  };
}

export function isAgentAvatarPreviewOpen(state: AgentAvatarPreviewState): boolean {
  return !state.suppressed && (state.hovered || state.focused || state.pinned);
}

export function reduceAgentAvatarPreviewState(
  state: AgentAvatarPreviewState,
  event: AgentAvatarPreviewEvent,
): AgentAvatarPreviewState {
  switch (event.type) {
    case "hover":
      return clearSuppressionWhenInactive({
        ...state,
        hovered: event.active,
      });
    case "focus":
      return clearSuppressionWhenInactive({
        ...state,
        focused: event.active,
      });
    case "toggle-pin":
      if (state.pinned) {
        return {
          ...state,
          pinned: false,
          suppressed: state.hovered || state.focused,
        };
      }
      return {
        ...state,
        pinned: true,
        suppressed: false,
      };
    case "dismiss":
      return {
        ...state,
        pinned: false,
        suppressed: state.hovered || state.focused,
      };
  }
}

export function getAgentAvatarPreviewStats(
  gamesPlayed: number | null,
  gamesWon: number | null,
): AgentAvatarPreviewStats {
  if (
    gamesPlayed === null
    || gamesWon === null
    || gamesPlayed < 0
    || gamesWon < 0
  ) {
    return {
      kind: "unavailable",
      message: "Current stats unavailable",
    };
  }

  if (gamesPlayed === 0) {
    return {
      kind: "empty",
      message: "No games yet",
    };
  }

  return {
    kind: "record",
    gamesPlayed,
    gamesWon,
    winRate: Math.round((gamesWon / gamesPlayed) * 100),
  };
}

function clearSuppressionWhenInactive(
  state: AgentAvatarPreviewState,
): AgentAvatarPreviewState {
  if (state.hovered || state.focused || state.pinned) {
    return state;
  }
  return {
    ...state,
    suppressed: false,
  };
}
