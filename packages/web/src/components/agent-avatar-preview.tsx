"use client";

import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  type OpenChangeReason,
} from "@floating-ui/react";
import { useCallback, useId, useReducer, type ReactNode } from "react";
import type { PersonaKey } from "@/lib/api";
import { getPersonaLabel } from "@/lib/personas";
import { AgentAvatar, type AgentAvatarSize } from "./agent-avatar";
import {
  createAgentAvatarPreviewState,
  getAgentAvatarPreviewStats,
  isAgentAvatarPreviewOpen,
  reduceAgentAvatarPreviewState,
} from "./agent-avatar-preview-model";

export interface PublicAgentAvatarPreview {
  avatarUrl?: string | null;
  personaKey?: PersonaKey | null;
  role?: string | null;
  name: string;
  gamesPlayed: number | null;
  gamesWon: number | null;
}

interface AgentAvatarPreviewProps extends PublicAgentAvatarPreview {
  size?: AgentAvatarSize;
  /**
   * Authorized surfaces may compose richer informational content without
   * adding private fields to PublicAgentAvatarPreview.
   */
  previewContent?: ReactNode;
}

export function AgentAvatarPreview({
  avatarUrl,
  personaKey,
  role,
  name,
  gamesPlayed,
  gamesWon,
  size = "10",
  previewContent,
}: AgentAvatarPreviewProps) {
  const [interaction, dispatch] = useReducer(
    reduceAgentAvatarPreviewState,
    undefined,
    createAgentAvatarPreviewState,
  );
  const previewId = useId();
  const open = isAgentAvatarPreviewOpen(interaction);
  const onOpenChange = useCallback(
    (nextOpen: boolean, _event?: Event, reason?: OpenChangeReason) => {
      switch (reason) {
        case "hover":
        case "safe-polygon":
          dispatch({ type: "hover", active: nextOpen });
          return;
        case "focus":
        case "focus-out":
          dispatch({ type: "focus", active: nextOpen });
          return;
        default:
          if (!nextOpen) {
            dispatch({ type: "dismiss" });
          }
      }
    },
    [],
  );
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    placement: "bottom-start",
    strategy: "fixed",
    middleware: [
      offset(8),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
    ],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, {
    handleClose: safePolygon(),
    move: false,
    mouseOnly: true,
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context, {
    escapeKey: true,
    outsidePress: true,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
  ]);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={`View ${name} portrait and stats`}
        aria-describedby={previewId}
        {...getReferenceProps({
          onClick: () => dispatch({ type: "toggle-pin" }),
        })}
        className="block shrink-0 rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <AgentAvatar
          avatarUrl={avatarUrl}
          personaKey={personaKey}
          persona={personaKey ?? "strategic"}
          name={name}
          size={size}
        />
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            id={previewId}
            role="tooltip"
            style={floatingStyles}
            {...getFloatingProps()}
            className="influence-panel z-50 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl p-4 shadow-2xl"
          >
            {previewContent ?? (
              <AgentAvatarPreviewContent
                avatarUrl={avatarUrl}
                personaKey={personaKey}
                role={role}
                name={name}
                gamesPlayed={gamesPlayed}
                gamesWon={gamesWon}
              />
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export function AgentAvatarPreviewContent({
  avatarUrl,
  personaKey,
  role,
  name,
  gamesPlayed,
  gamesWon,
}: PublicAgentAvatarPreview) {
  const stats = getAgentAvatarPreviewStats(gamesPlayed, gamesWon);
  const roleLabel = role?.trim() || getPersonaLabel(personaKey);

  return (
    <>
      <div className="flex justify-center">
        <AgentAvatar
          avatarUrl={avatarUrl}
          personaKey={personaKey}
          persona={personaKey ?? "strategic"}
          name={name}
          size="32"
        />
      </div>
      <div className="mt-3 text-center">
        <p className="truncate text-sm font-semibold text-text-primary">{name}</p>
        <p className="influence-copy-muted mt-0.5 text-xs">{roleLabel}</p>
      </div>
      {stats.kind === "record" ? (
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-center">
          <Stat value={stats.gamesPlayed} label={stats.gamesPlayed === 1 ? "game" : "games"} />
          <Stat value={stats.gamesWon} label={stats.gamesWon === 1 ? "win" : "wins"} />
          <Stat value={`${stats.winRate}%`} label="win rate" />
        </dl>
      ) : (
        <p className="influence-copy-muted mt-3 border-t border-white/10 pt-3 text-center text-xs">
          {stats.message}
        </p>
      )}
    </>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <dt className="influence-copy-muted text-[10px] uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-text-primary">{value}</dd>
    </div>
  );
}
