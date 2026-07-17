"use client";

import type { AgentAvatarSize } from "./agent-avatar";
import { AgentAvatar } from "./agent-avatar";
import { AgentAvatarPreview } from "./agent-avatar-preview";
import type { GamePlayer, PersonaKey } from "@/lib/api";
import { PERSONAS, getPersonaLabel } from "@/lib/personas";

export type GamePlayerAvatarSource = Pick<
  GamePlayer,
  "name" | "persona" | "personaKey" | "avatarUrl" | "currentAgent"
>;

export interface GamePlayerAvatarPreviewModel {
  name: string;
  persona: string;
  personaKey: PersonaKey | null;
  role: string;
  avatarUrl: string | null;
  gamesPlayed: number | null;
  gamesWon: number | null;
  winRate: number | null;
}

export function getGamePlayerAvatarPreviewModel(
  player: GamePlayerAvatarSource,
): GamePlayerAvatarPreviewModel {
  const personaKey =
    toPersonaKey(player.personaKey) ?? toPersonaKey(player.persona);
  const currentCompetition = player.currentAgent?.competition;

  return {
    name: player.name,
    persona: player.persona,
    personaKey,
    role: personaKey
      ? getPersonaLabel(personaKey)
      : player.persona.trim() || "Agent",
    avatarUrl:
      player.currentAgent?.avatarUrl
      ?? player.avatarUrl
      ?? null,
    gamesPlayed: currentCompetition?.gamesPlayed ?? null,
    gamesWon: currentCompetition?.wins ?? null,
    winRate: currentCompetition?.winRate ?? null,
  };
}

export function GamePlayerAvatarPreview({
  player,
  size = "10",
}: {
  player: GamePlayerAvatarSource;
  size?: AgentAvatarSize;
}) {
  const model = getGamePlayerAvatarPreviewModel(player);

  return (
    <span
      className="inline-flex shrink-0 [&>button]:grid [&>button]:min-h-11 [&>button]:min-w-11 [&>button]:place-items-center"
      onClick={(event) => event.stopPropagation()}
    >
      <AgentAvatarPreview
        avatarUrl={model.avatarUrl}
        persona={model.persona}
        personaKey={model.personaKey}
        role={model.role}
        name={model.name}
        gamesPlayed={model.gamesPlayed}
        gamesWon={model.gamesWon}
        size={size}
        previewContent={<GamePlayerAvatarPreviewContent model={model} />}
      />
    </span>
  );
}

export function GamePlayerAvatarPreviewContent({
  model,
}: {
  model: GamePlayerAvatarPreviewModel;
}) {
  const currentRecord =
    model.gamesPlayed !== null
    && model.gamesWon !== null
    && model.winRate !== null
      ? {
          gamesPlayed: model.gamesPlayed,
          gamesWon: model.gamesWon,
          winRate: model.winRate,
        }
      : null;

  return (
    <>
      <div className="flex justify-center">
        <AgentAvatar
          avatarUrl={model.avatarUrl}
          personaKey={model.personaKey}
          persona={model.persona}
          name={model.name}
          size="32"
        />
      </div>
      <div className="mt-3 text-center">
        <p className="truncate text-sm font-semibold text-text-primary">
          {model.name}
        </p>
        <p className="influence-copy-muted mt-0.5 text-xs">{model.role}</p>
      </div>
      <p className="influence-copy-muted mt-3 border-t border-white/10 pt-3 text-[10px] font-semibold uppercase tracking-wide">
        Current record
      </p>
      {currentRecord ? (
        <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
          <CurrentRecordStat
            value={currentRecord.gamesPlayed}
            label={currentRecord.gamesPlayed === 1 ? "game" : "games"}
          />
          <CurrentRecordStat
            value={currentRecord.gamesWon}
            label={currentRecord.gamesWon === 1 ? "win" : "wins"}
          />
          <CurrentRecordStat
            value={`${Math.round(currentRecord.winRate * 100)}%`}
            label="win rate"
          />
        </dl>
      ) : (
        <p className="influence-copy-muted mt-2 text-center text-xs">
          Current stats unavailable
        </p>
      )}
    </>
  );
}

function CurrentRecordStat({
  value,
  label,
}: {
  value: number | string;
  label: string;
}) {
  return (
    <div>
      <dt className="influence-copy-muted text-[10px] uppercase tracking-wide">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-text-primary">{value}</dd>
    </div>
  );
}

const PERSONA_KEYS = new Set<string>(PERSONAS.map((persona) => persona.key));

function toPersonaKey(value: string | null | undefined): PersonaKey | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && PERSONA_KEYS.has(normalized)
    ? normalized as PersonaKey
    : null;
}
