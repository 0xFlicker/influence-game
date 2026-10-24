import type { VisualPresentationBeat } from "./visual-presentation";
import type { VoteLedgerState } from "./vote-ledger-model";

/** Static environments for portrait staging; accepted visual-mode scenes keep their own art. */
export const INFLUENCE_ROOMS = {
  lobby: "/visual/influence/rooms-v1/lobby.jpg",
  mingle: [
    "/visual/influence/rooms-v1/mingle-1.jpg",
    "/visual/influence/rooms-v1/mingle-2.jpg",
    "/visual/influence/rooms-v1/mingle-3.jpg",
    "/visual/influence/rooms-v1/mingle-4.jpg",
    "/visual/influence/rooms-v1/mingle-5.jpg",
  ],
  empower: "/visual/influence/rooms-v1/empower.jpg",
  council: "/visual/influence/rooms-v1/council.jpg",
} as const;

/** Select from structured room/ballot identity, never the displayed caption or speech. */
export function influenceRoomBackground(beat: VisualPresentationBeat, ledger?: VoteLedgerState | null): string | undefined {
  if (beat.kind === "portrait-room") {
    return beat.roomNumber === null ? INFLUENCE_ROOMS.lobby
      : INFLUENCE_ROOMS.mingle[beat.roomNumber - 1] ?? INFLUENCE_ROOMS.lobby;
  }
  if (beat.kind !== "portrait") return undefined;
  if (beat.purpose === "Introduction") return INFLUENCE_ROOMS.lobby;
  if (beat.purpose === "Ballot") return (beat.ballotPurpose ?? ledger?.current.choice) === "empower"
    ? INFLUENCE_ROOMS.empower : INFLUENCE_ROOMS.council;
  return undefined;
}
