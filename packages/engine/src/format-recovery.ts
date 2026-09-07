/**
 * Pure format-kernel recovery helpers shared by the runner and API selector.
 *
 * Canonical events own format truth. These helpers reconstruct only the minimum
 * current-round runtime state needed at phase-entry checkpoints and reject
 * inconsistent prefixes fail-closed.
 */

import type { CanonicalGameEvent } from "./canonical-events";
import { buildFormatPressureProjection } from "./format-pressure";
import {
  LEGACY_FORMAT_MANIFEST,
  formatsAvailableForSelection,
  isLaunchFormatId,
  resolveFormatManifest,
  type LaunchFormatId,
} from "./formats";
import type { FormatKernelState } from "./phases/phase-runner-context";
import { Phase, type UUID } from "./types";

export type FormatResumeCoordinate =
  | "format_menu"
  | "format_pick"
  | "format_mingle"
  | "format_resolve";

const FORMAT_RESOLUTION_EVENT_TYPES = new Set<CanonicalGameEvent["type"]>([
  "format.ballot_cast",
  "format.ballot_forfeited",
  "format.safety_bounce_started",
  "format.safety_bounce_pointer",
  "format.resolved",
]);

export function isFormatResumeCoordinate(value: string): value is FormatResumeCoordinate {
  return (
    value === "format_menu" ||
    value === "format_pick" ||
    value === "format_mingle" ||
    value === "format_resolve"
  );
}

function currentRoundNumber(events: readonly CanonicalGameEvent[]): number {
  let round = 0;
  for (const event of events) {
    if (event.type === "round.started") {
      round = event.payload.round;
    }
  }
  return round;
}

function eventsInRound(
  events: readonly CanonicalGameEvent[],
  round: number,
): CanonicalGameEvent[] {
  return events.filter((event) => event.round === round);
}

function livingPlayerIdsAtSequence(
  events: readonly CanonicalGameEvent[],
  throughSequence = Number.POSITIVE_INFINITY,
): UUID[] {
  const roster = events.find((event) => event.type === "game.roster_initialized");
  if (!roster || roster.type !== "game.roster_initialized") return [];
  const living = new Set(
    roster.payload.players
      .filter((player) => player.status === "alive")
      .map((player) => player.id),
  );
  for (const event of events) {
    if (event.sequence > throughSequence) break;
    if (event.type === "player.eliminated") living.delete(event.payload.playerId);
  }
  return roster.payload.players
    .map((player) => player.id)
    .filter((playerId) => living.has(playerId));
}

/** Resolve the empowered player for a specific round from canonical events. */
export function resolveEmpoweredIdForRound(
  events: readonly CanonicalGameEvent[],
  round: number,
): UUID | null {
  const roundEvents = eventsInRound(events, round);
  for (let index = roundEvents.length - 1; index >= 0; index -= 1) {
    const event = roundEvents[index];
    if (event?.type === "vote.empowered_set") {
      return event.payload.empowered;
    }
  }
  for (let index = roundEvents.length - 1; index >= 0; index -= 1) {
    const event = roundEvents[index];
    if (event?.type === "vote.empower_tally_resolved" && event.payload.tied === null) {
      return event.payload.empowered;
    }
  }
  return null;
}

function resolveCurrentRoundEmpoweredId(
  events: readonly CanonicalGameEvent[],
  round: number,
): UUID | null {
  return resolveEmpoweredIdForRound(events, round);
}

export function currentRoundFromEvents(events: readonly CanonicalGameEvent[]): number {
  return currentRoundNumber(events);
}

function historicalLastSelectedFormat(
  events: readonly CanonicalGameEvent[],
): LaunchFormatId | null {
  const manifest = formatManifestFromCanonicalEvents(events);
  let lastSelected: LaunchFormatId | null = null;
  for (const event of events) {
    if (event.type === "format.selected") {
      if (
        !isLaunchFormatId(event.payload.formatId)
        || !formatsAvailableForSelection(manifest, {
          round: event.round,
          livingIds: livingPlayerIdsAtSequence(events, event.sequence),
        }).includes(event.payload.formatId)
      ) {
        throw new Error(`Canonical format selection is outside the frozen manifest: ${event.payload.formatId}`);
      }
      lastSelected = event.payload.formatId;
    }
  }
  return lastSelected;
}

/** Read the frozen game-start manifest, preserving the original trio for historical logs. */
export function formatManifestFromCanonicalEvents(
  events: readonly CanonicalGameEvent[],
): LaunchFormatId[] {
  const start = events.find((event) => event.type === "game.roster_initialized");
  if (!start || start.type !== "game.roster_initialized") {
    throw new Error("Canonical event log is missing game.roster_initialized");
  }
  return start.payload.formatManifest === undefined
    ? [...LEGACY_FORMAT_MANIFEST]
    : resolveFormatManifest(start.payload.formatManifest);
}

function parseOfferedFormats(
  offered: readonly string[],
): [LaunchFormatId, LaunchFormatId] | null {
  if (offered.length !== 2) return null;
  const first = offered[0];
  const second = offered[1];
  if (!first || !second || !isLaunchFormatId(first) || !isLaunchFormatId(second)) {
    return null;
  }
  if (first === second) return null;
  return [first, second];
}

/**
 * Validate that the durable prefix is coherent for a format phase-entry resume.
 * Returns null when valid, or a stable diagnostic reason string when not.
 */
export function validateFormatResumePrerequisites(
  actorCoordinate: FormatResumeCoordinate,
  canonicalEvents: readonly CanonicalGameEvent[],
): string | null {
  const round = currentRoundNumber(canonicalEvents);
  if (round < 1) return `${actorCoordinate}_missing_round_started`;

  const empoweredId = resolveCurrentRoundEmpoweredId(canonicalEvents, round);
  if (!empoweredId) return `${actorCoordinate}_missing_empowered`;

  const roundEvents = eventsInRound(canonicalEvents, round);
  const formatManifest = formatManifestFromCanonicalEvents(canonicalEvents);
  const selection = roundEvents.find((event) => event.type === "format.selected");
  const availableFormats = formatsAvailableForSelection(formatManifest, {
    round,
    livingIds: livingPlayerIdsAtSequence(
      canonicalEvents,
      selection?.sequence,
    ),
  });
  const menus = roundEvents.filter((event) => event.type === "format.menu_offered");
  const selections = roundEvents.filter((event) => event.type === "format.selected");
  const resolutionFacts = roundEvents.filter((event) =>
    FORMAT_RESOLUTION_EVENT_TYPES.has(event.type),
  );
  const formatMingleAllocations = roundEvents.filter(
    (event) =>
      event.type === "mingle.rooms_allocated" && event.phase === Phase.FORMAT_MINGLE,
  );

  if (actorCoordinate === "format_menu") {
    if (menus.length > 0) return "format_menu_unexpected_menu_offered";
    if (selections.length > 0) return "format_menu_unexpected_format_selected";
    if (formatMingleAllocations.length > 0) {
      return "format_menu_unexpected_format_mingle_allocation";
    }
    if (resolutionFacts.length > 0) return "format_menu_unexpected_resolution_facts";
    return null;
  }


  if (availableFormats.length === 1) {
    const onlyFormat = availableFormats[0]!;
    if (menus.length > 0) return `${actorCoordinate}_unexpected_menu_offered`;
    if (selections.length === 0) return `${actorCoordinate}_missing_format_selected`;
    if (selections.length > 1) return `${actorCoordinate}_duplicate_format_selected`;
    const selectedEvent = selections[0];
    if (!selectedEvent || selectedEvent.type !== "format.selected") {
      return `${actorCoordinate}_missing_format_selected`;
    }
    if (selectedEvent.payload.empoweredId !== empoweredId) {
      return `${actorCoordinate}_selection_empowered_mismatch`;
    }
    if (selectedEvent.payload.formatId !== onlyFormat) {
      return `${actorCoordinate}_selection_outside_manifest`;
    }
    if (actorCoordinate === "format_pick") {
      if (formatMingleAllocations.length > 0) return "format_pick_unexpected_format_mingle_allocation";
      if (resolutionFacts.length > 0) return "format_pick_unexpected_resolution_facts";
      return null;
    }
    if (actorCoordinate === "format_mingle") {
      if (formatMingleAllocations.length > 0) return "format_mingle_unexpected_format_mingle_allocation";
      if (resolutionFacts.length > 0) return "format_mingle_unexpected_resolution_facts";
      return null;
    }
    if (formatMingleAllocations.length === 0) return "format_resolve_missing_format_mingle_allocation";
    if (resolutionFacts.length > 0) return "format_resolve_unexpected_resolution_facts";
    return null;
  }

  if (menus.length === 0) return `${actorCoordinate}_missing_menu_offered`;
  if (menus.length > 1) return `${actorCoordinate}_duplicate_menu_offered`;
  const menu = menus[0];
  if (!menu || menu.type !== "format.menu_offered") {
    return `${actorCoordinate}_missing_menu_offered`;
  }
  if (menu.payload.empoweredId !== empoweredId) {
    return `${actorCoordinate}_menu_empowered_mismatch`;
  }
  const offeredFormats = parseOfferedFormats(menu.payload.offeredFormatIds);
  if (!offeredFormats) return `${actorCoordinate}_invalid_offered_formats`;
  if (!offeredFormats.every((formatId) => availableFormats.includes(formatId))) {
    return `${actorCoordinate}_offered_format_outside_manifest`;
  }

  if (actorCoordinate === "format_pick") {
    if (selections.length > 0) return "format_pick_unexpected_format_selected";
    if (formatMingleAllocations.length > 0) {
      return "format_pick_unexpected_format_mingle_allocation";
    }
    if (resolutionFacts.length > 0) return "format_pick_unexpected_resolution_facts";
    return null;
  }

  if (selections.length === 0) return `${actorCoordinate}_missing_format_selected`;
  if (selections.length > 1) return `${actorCoordinate}_duplicate_format_selected`;
  const selectedEvent = selections[0];
  if (!selectedEvent || selectedEvent.type !== "format.selected") {
    return `${actorCoordinate}_missing_format_selected`;
  }
  if (selectedEvent.payload.empoweredId !== empoweredId) {
    return `${actorCoordinate}_selection_empowered_mismatch`;
  }
  if (!isLaunchFormatId(selectedEvent.payload.formatId)) {
    return `${actorCoordinate}_invalid_selected_format`;
  }
  if (!offeredFormats.includes(selectedEvent.payload.formatId)) {
    return `${actorCoordinate}_selection_not_in_menu`;
  }

  if (actorCoordinate === "format_mingle") {
    if (formatMingleAllocations.length > 0) {
      return "format_mingle_unexpected_format_mingle_allocation";
    }
    if (resolutionFacts.length > 0) return "format_mingle_unexpected_resolution_facts";
    return null;
  }

  // format_resolve — phase entry after format Mingle allocation, before any resolution facts.
  if (formatMingleAllocations.length === 0) {
    return "format_resolve_missing_format_mingle_allocation";
  }
  if (resolutionFacts.length > 0) return "format_resolve_unexpected_resolution_facts";
  return null;
}

/**
 * Rebuild the minimum FormatKernelState for resume.
 * Non-format targets only restore anti-repeat history.
 */
export function buildFormatKernelStateForResume(params: {
  actorCoordinate: string;
  canonicalEvents: readonly CanonicalGameEvent[];
  getPlayerName: (id: UUID) => string;
}): FormatKernelState {
  const lastSelectedFormat = historicalLastSelectedFormat(params.canonicalEvents);
  const emptyActive: FormatKernelState = {
    offeredFormats: null,
    selectedFormat: null,
    pressure: null,
    lastSelectedFormat,
  };

  if (!isFormatResumeCoordinate(params.actorCoordinate)) {
    return emptyActive;
  }

  if (params.actorCoordinate === "format_menu") {
    // Active menu/selection must be empty so the menu handler offers exactly once.
    return emptyActive;
  }


  const formatManifest = formatManifestFromCanonicalEvents(params.canonicalEvents);
  const round = currentRoundNumber(params.canonicalEvents);
  const roundEvents = eventsInRound(params.canonicalEvents, round);
  const selection = roundEvents.find((event) => event.type === "format.selected");
  const availableFormats = formatsAvailableForSelection(formatManifest, {
    round,
    livingIds: livingPlayerIdsAtSequence(
      params.canonicalEvents,
      selection?.sequence,
    ),
  });
  if (availableFormats.length === 1) {
    const selectedEvent = roundEvents.find((event) => event.type === "format.selected");
    if (!selectedEvent || selectedEvent.type !== "format.selected") return emptyActive;
    const selectedFormat = availableFormats[0]!;
    const empoweredId = selectedEvent.payload.empoweredId;
    return {
      offeredFormats: null,
      selectedFormat,
      lastSelectedFormat: selectedFormat,
      pressure: buildFormatPressureProjection({
        empoweredId,
        empoweredName: params.getPlayerName(empoweredId),
        offeredFormats: [selectedFormat],
        selectedFormat,
      }),
    };
  }

  const menu = roundEvents.find((event) => event.type === "format.menu_offered");
  if (!menu || menu.type !== "format.menu_offered") {
    return emptyActive;
  }

  const offeredFormats = parseOfferedFormats(menu.payload.offeredFormatIds);
  if (!offeredFormats) return emptyActive;

  const empoweredId = menu.payload.empoweredId;
  const empoweredName = params.getPlayerName(empoweredId);

  if (params.actorCoordinate === "format_pick") {
    return {
      offeredFormats,
      selectedFormat: null,
      // Prior-round selection only — current round has not locked yet.
      lastSelectedFormat,
      pressure: buildFormatPressureProjection({
        empoweredId,
        empoweredName,
        offeredFormats,
        selectedFormat: null,
      }),
    };
  }

  const selectedEvent = roundEvents.find((event) => event.type === "format.selected");
  if (!selectedEvent || selectedEvent.type !== "format.selected") {
    return emptyActive;
  }
  if (!isLaunchFormatId(selectedEvent.payload.formatId)) {
    return emptyActive;
  }
  const selectedFormat = selectedEvent.payload.formatId;

  return {
    offeredFormats,
    selectedFormat,
    lastSelectedFormat: selectedFormat,
    pressure: buildFormatPressureProjection({
      empoweredId,
      empoweredName,
      offeredFormats,
      selectedFormat,
    }),
  };
}
